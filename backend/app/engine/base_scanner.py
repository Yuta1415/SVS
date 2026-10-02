import time
from abc import ABC, abstractmethod

import docker
from requests.exceptions import ReadTimeout
from sqlalchemy.orm import Session

from ..models.finding import Finding


class ScannerError(RuntimeError):
    """A scanner container failed, timed out, or produced no report.

    Carries the tool name so the pipeline can tell the user *which* scanner
    broke instead of reporting a clean bill of health for a scan that never
    actually ran.
    """

    def __init__(self, tool: str, detail: str):
        self.tool = tool
        self.detail = detail
        super().__init__(f"{tool}: {detail}")


class BaseScanner(ABC):
    def __init__(self, docker_client: docker.DockerClient):
        self.client = docker_client

    @abstractmethod
    def scan(self, scan_id: int, project_path: str, db: Session):
        """
        Run the scan and save findings to the database.
        Returns the number of findings found.
        """

    # ponytail: a hung scanner used to block container.wait() forever, leaving
    # the scan stuck on RUNNING and the Celery task wedged with no cleanup.
    # Increased to 30 min for slow/large repositories. Individual scanners can
    # override this per-call if they need more time.
    DEFAULT_TIMEOUT = 1800

    def _run_container(self, image: str, command, volumes, network_disabled=True,
                       mem_limit="512m", working_dir=None, timeout=None,
                       accept_exit_codes=(0,), **kwargs) -> str:
        """Run a scanner container to completion and return its stdout.

        Detached + wait, instead of detach=False, because several tools exit
        non-zero on a successful scan and detach=False would raise before we
        could read the report. accept_exit_codes extends the set that counts as
        success: gitleaks and npm audit both exit 1 to report *findings*, so
        their callers pass (0, 1) or the cleanest repo would scan as FAILED.

        Only stdout is returned: most of these tools write the JSON report to
        stdout and progress chatter to stderr. Gitleaks is the exception, it
        will not stream JSON at all without --report-path, so its caller reads
        the report back from the mounted scan directory instead.

        Raises ScannerError on a timeout, a failure to start, or an exit code
        outside accept_exit_codes that produced no stdout. An empty stdout with
        an accepted exit code is returned as-is: gitleaks and npm audit
        legitimately print nothing when the code is clean, and that is not a
        failure.
        """
        timeout = timeout or self.DEFAULT_TIMEOUT
        try:
            container = self.client.containers.run(
                image=image,
                command=command,
                volumes=volumes,
                network_disabled=network_disabled,
                mem_limit=mem_limit,
                working_dir=working_dir,
                detach=True,
                **kwargs,
            )
        except Exception as e:
            raise ScannerError(image, f"could not start container: {e}")

        deadline = time.time() + timeout
        try:
            while True:
                remaining = deadline - time.time()
                if remaining <= 0:
                    try:
                        container.kill()
                    except Exception:
                        pass
                    raise ScannerError(image, f"timed out after {timeout}s")
                # docker-py raises ReadTimeout when the wait poll expires with
                # the container still running; re-arm and keep waiting until
                # our own deadline hits.
                try:
                    result = container.wait(timeout=int(remaining) + 1)
                    break
                except ReadTimeout:
                    continue

            stdout = container.logs(stdout=True, stderr=False).decode("utf-8", errors="replace").strip()
            if not stdout and result.get("StatusCode") not in accept_exit_codes:
                stderr = container.logs(stdout=False, stderr=True).decode("utf-8", errors="replace").strip()
                raise ScannerError(image, f"exited {result['StatusCode']}: {stderr[-500:] or 'no output'}")
            return stdout
        finally:
            container.remove()

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
