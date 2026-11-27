import json
import logging
import os
import shutil
import sys

from sqlalchemy.orm import Session

from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer

logger = logging.getLogger(__name__)


class TrivyScanner(BaseScanner):
    """Scan container images and filesystems for vulnerabilities and secrets.

    Trivy is the de-facto standard for container image scanning. It detects
    CVEs in OS packages, language-specific dependencies, and IaC misconfigs.
    In SVS, it scans the project's Dockerfiles and any container images
    referenced in the repository.
    """

    def _has_docker_files(self, project_path: str) -> bool:
        """Check if the repo contains Docker-related files worth scanning."""
        for root, _, files in os.walk(project_path):
            if os.path.basename(root) == ".git":
                continue
            for name in files:
                if name.startswith("Dockerfile") or name in ("docker-compose.yml", "docker-compose.yaml", ".dockerignore"):
                    return True
                if name.endswith((".tar", ".tgz", ".tar.gz")):
                    return True
        return False

    def scan(self, scan_id: int, project_path: str, db: Session):
        if not self._has_docker_files(project_path):
            return 0

        # Check if trivy is installed
        trivy_path = shutil.which("trivy")
        if trivy_path is None:
            for candidate_dir in (
                os.path.dirname(sys.executable),
                os.path.join(os.environ.get("LOCALAPPDATA", ""), "Microsoft", "WinGet", "Links"),
            ):
                for ext in ("", ".exe"):
                    candidate = os.path.join(candidate_dir, "trivy" + ext)
                    if os.path.isfile(candidate):
                        trivy_path = candidate
                        break
                if trivy_path:
                    break
        if trivy_path is None:
            # Trivy is optional — skip silently if not installed
            logger.info("Trivy not found on PATH, skipping container scan")
            return 0

        try:
            # Scan the filesystem for vulnerabilities, secrets, and misconfigs
            output = self._run_command(
                "Trivy",
                [
                    trivy_path, "fs",
                    "--format", "json",
                    "--scanners", "vuln,secret,misconfig",
                    "--quiet",
                    project_path,
                ],
                accept_exit_codes=(0, 1),
                timeout=600,
            )

            if not output:
                return 0

            data = json.loads(output)
            norm = FindingNormalizer()
            findings_count = 0

            # Trivy returns results grouped by target (file or image)
            for result in data.get("Results", []):
                target = result.get("Target", "unknown")

                # Vulnerabilities
                for vuln in result.get("Vulnerabilities", []) or []:
                    normalized = norm.normalize_trivy_vuln(vuln, target, project_path)
                    if normalized:
                        self._save_finding(db, scan_id, **normalized)
                        findings_count += 1

                # Secrets
                for secret in result.get("Secrets", []) or []:
                    normalized = norm.normalize_trivy_secret(secret, target, project_path)
                    if normalized:
                        self._save_finding(db, scan_id, **normalized)
                        findings_count += 1

                # Misconfigs
                for misconfig in result.get("Misconfigurations", []) or []:
                    normalized = norm.normalize_trivy_misconfig(misconfig, target, project_path)
                    if normalized:
                        self._save_finding(db, scan_id, **normalized)
                        findings_count += 1

            db.commit()
            return findings_count

        except ScannerError:
            raise
        except json.JSONDecodeError as e:
            raise ScannerError("Trivy", f"unparseable report: {e}") from e
        except Exception as e:
            raise ScannerError("Trivy", str(e)) from e


if __name__ == "__main__":
    print("Trivy scanner module")