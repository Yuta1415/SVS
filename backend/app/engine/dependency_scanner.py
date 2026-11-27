import json
import os
import shutil
import sys

from sqlalchemy.orm import Session

from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer


class DependencyScanner(BaseScanner):
    @staticmethod
    def _npm_command(args: list[str]) -> list[str]:
        npm_path = shutil.which("npm")
        if npm_path is None:
            raise ScannerError("SCA Audit", "required executable 'npm' was not found on PATH")
        if os.name != "nt" or not npm_path.lower().endswith((".cmd", ".bat")):
            return [npm_path, *args]

        node_path = shutil.which("node")
        npm_cli = os.path.join(os.path.dirname(npm_path), "node_modules", "npm", "bin", "npm-cli.js")
        if node_path is None or not os.path.isfile(npm_cli):
            raise ScannerError("SCA Audit", "could not resolve Node.js and npm's CLI script")
        return [node_path, npm_cli, *args]

    def scan(self, scan_id: int, project_path: str, db: Session):
        skip_dirs = {".git", "node_modules", ".venv", "venv", "__pycache__"}
        manifests = []
        for root, dirs, files in os.walk(project_path):
            dirs[:] = [name for name in dirs if name not in skip_dirs]
            if "requirements.txt" in files:
                manifests.append(("python", os.path.join(root, "requirements.txt")))
            if "package.json" in files:
                manifests.append(("javascript", os.path.join(root, "package.json")))

        findings_count = 0
        for manifest_type, manifest_path in manifests:
            if manifest_type == "python":
                findings_count += self._scan_python(scan_id, manifest_path, project_path, db)
            else:
                findings_count += self._scan_javascript(scan_id, manifest_path, project_path, db)
        return findings_count

    def _scan_python(self, scan_id: int, requirements_path: str, project_path: str, db: Session):
        try:
            output = self._run_command(
                "SCA Audit",
                [sys.executable, "-m", "pip_audit", "-r", requirements_path, "--format", "json"],
                # pip-audit exits 1 when it finds a vulnerability; that is a
                # successful report, not a broken scanner. Exit 2 is a usage or
                # network failure and still raises.
                accept_exit_codes=(0, 1),
                timeout=180,  # 3 minutes max for pip-audit CVE lookups
            )

            data = json.loads(output)
            norm = FindingNormalizer()

            findings_count = 0
            # pip-audit JSON: { "dependencies": [ { "name": "...", "version": "...", "vulns": [ ... ] } ] }
            for dep in data.get("dependencies", []):
                for vuln in dep.get("vulns", []):
                    normalized = norm.normalize_pip_audit(dep, vuln)
                    normalized["file_path"] = os.path.relpath(requirements_path, project_path)
                    self._save_finding(
                        db, scan_id,
                        **normalized
                    )
                    findings_count += 1

            db.commit()
            return findings_count
        except ScannerError:
            raise
        except Exception as e:
            raise ScannerError("SCA Audit", str(e)) from e

    def _scan_javascript(self, scan_id: int, package_json_path: str, project_path: str, db: Session):
        package_dir = os.path.dirname(package_json_path)
        try:
            lockfiles = ("package-lock.json", "npm-shrinkwrap.json")
            if not any(os.path.isfile(os.path.join(package_dir, name)) for name in lockfiles):
                self._run_command(
                    "SCA Audit",
                    self._npm_command([
                        "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund",
                    ]),
                    cwd=package_dir,
                    timeout=1800,
                )

            output = self._run_command(
                "SCA Audit",
                self._npm_command(["audit", "--json"]),
                cwd=package_dir,
                accept_exit_codes=(0, 1),
                timeout=180,
            )

            data = json.loads(output)
            # npm audit reports its own failures (missing lockfile, registry
            # unreachable) as a JSON error object with exit 1 and *empty
            # vulnerability data*, which would otherwise read as "clean".
            if "error" in data:
                err = data["error"]
                raise ScannerError("SCA Audit", f"npm audit: {err.get('summary', err)}")
            norm = FindingNormalizer()

            findings_count = 0
            # npm audit JSON: { "metadata": { "vulnerabilities": { "low": X, ... } }, "vulnerabilities": { "pkg": { "severity": "...", "via": [...] } } }
            vulns = data.get("vulnerabilities", {})

            for pkg, details in vulns.items():
                normalized = norm.normalize_npm_audit(pkg, details)
                normalized["file_path"] = os.path.relpath(package_json_path, project_path)
                self._save_finding(
                    db, scan_id,
                    **normalized
                )
                findings_count += 1

            db.commit()
            return findings_count
        except ScannerError:
            raise
        except Exception as e:
            raise ScannerError("SCA Audit", str(e)) from e
