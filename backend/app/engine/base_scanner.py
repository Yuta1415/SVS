import os
import shutil
import subprocess
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
        if not os.path.isabs(executable) and shutil.which(executable) is None:
            raise ScannerError(tool, f"required executable '{executable}' was not found on PATH")

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
        if not path or not os.path.isabs(path):
            return path or "unknown"
        try:
            relative_path = os.path.relpath(path, project_path)
        except ValueError:
            return path
        if relative_path == os.pardir or relative_path.startswith(os.pardir + os.sep):
            return path
        return relative_path

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
