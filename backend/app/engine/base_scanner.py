import os
import shutil
import subprocess
import sys
from abc import ABC, abstractmethod

from sqlalchemy.orm import Session

from ..models.finding import Finding


class ScannerError(RuntimeError):
    """A local scanner failed, timed out, or produced no report.

    Carries the tool name so the pipeline can tell the user *which* scanner
    broke instead of reporting a clean bill of health for a scan that never
    actually ran.
    """

    def __init__(self, tool: str, detail: str):
        self.tool = tool
        self.detail = detail
        super().__init__(f"{tool}: {detail}")


class BaseScanner(ABC):
    @abstractmethod
    def scan(self, scan_id: int, project_path: str, db: Session):
        """
        Run the scan and save findings to the database.
        Returns the number of findings found.
        """

    DEFAULT_TIMEOUT = 1800

    def _run_command(self, tool: str, command: list[str], cwd: str | None = None,
                     timeout: int | None = None, accept_exit_codes=(0,)) -> str:
        """Run a local scanner and return stdout, preserving useful failures."""
        timeout = timeout or self.DEFAULT_TIMEOUT
        executable = command[0]
        # Resolve the executable: check PATH first, then fall back to the
        # venv's Scripts directory (so local dev works without run-svs.bat).
        resolved = shutil.which(executable)
        if resolved is None and not os.path.isabs(executable):
            search_dirs = [
                os.path.dirname(sys.executable),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links"),
                os.path.join(os.environ.get("ProgramFiles", ""), "Git", "cmd"),
            ]
            for search_dir in search_dirs:
                for candidate_name in (executable, executable + ".exe", executable + ".cmd", executable + ".bat"):
                    candidate = os.path.join(search_dir, candidate_name)
                    if os.path.isfile(candidate):
                        resolved = candidate
                        break
                if resolved:
                    break
        if resolved is None and not os.path.isabs(executable):
            raise ScannerError(tool, f"required executable '{executable}' was not found on PATH")
        if resolved is not None:
            command = [resolved] + list(command[1:])

        try:
            result = subprocess.run(
                command,
                cwd=cwd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as e:
            raise ScannerError(tool, f"timed out after {timeout}s") from e
        except OSError as e:
            raise ScannerError(tool, f"could not start '{executable}': {e}") from e

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        if result.returncode not in accept_exit_codes:
            detail = stderr or stdout or "no output"
            raise ScannerError(tool, f"exited {result.returncode}: {detail[-500:]}")
        if result.returncode != 0 and not stdout and tool != "Gitleaks":
            detail = stderr or "no output"
            raise ScannerError(tool, f"exited {result.returncode} without a report: {detail[-500:]}")
        return stdout

    @staticmethod
    def _repo_relative_path(project_path: str, path: str | None) -> str:
        if not path:
            return "unknown"
        # Handle both / and \\ as separators so Windows-style paths work on
        # Linux (CI) too.  A path is absolute if it starts with / or has a
        # drive letter (C:\\, C:/).
        use_backslash = "\\" in path
        norm_path = path.replace("\\", "/")
        norm_project = project_path.replace("\\", "/")
        is_abs = os.path.isabs(norm_path) or (len(norm_path) > 1 and norm_path[1] == ":")
        if not is_abs:
            return path
        try:
            relative = os.path.relpath(norm_path, norm_project)
        except ValueError:
            return path
        if relative == os.pardir or relative.startswith(os.pardir + "/"):
            return path
        if use_backslash:
            relative = relative.replace("/", "\\")
        return relative

    def _save_finding(self, db: Session, scan_id: int, v_type: str, severity: str,
                     file_path: str, line: int, desc: str, remediation: str = None,
                     cwe: str = None):
        finding = Finding(
            scan_id=scan_id,
            vulnerability_type=v_type,
            severity=severity.upper(),
            file_path=file_path,
            line_number=line,
            description=desc,
            remediation=remediation,
            cwe=cwe,
        )
        db.add(finding)
