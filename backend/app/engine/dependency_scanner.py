import os
import json
from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer
from sqlalchemy.orm import Session

class DependencyScanner(BaseScanner):
    def scan(self, scan_id: int, project_path: str, db: Session):
        # Detect language
        if os.path.exists(os.path.join(project_path, "requirements.txt")):
            return self._scan_python(scan_id, project_path, db)
        elif os.path.exists(os.path.join(project_path, "package.json")):
            return self._scan_javascript(scan_id, project_path, db)
        return 0

    def _scan_python(self, scan_id: int, project_path: str, db: Session):
        try:
            # pip-audit with no arguments audits the *container's* environment,
            # not the project, so -r requirements.txt is required.
            output = self._run_container(
                image="python:3.11-slim@sha256:da047cb8f9d1d98e5c070f5300ba9f7274e33b8fc0e5be5ed88740aed1b95ba9",
                command=["sh", "-c",
                         "pip install --quiet pip-audit >/dev/null 2>&1 && "
                         "pip-audit -r requirements.txt --format json"],
                volumes=[f"/tmp/svs_uploads/scan_{scan_id}:/src:ro"],
                network_disabled=False, # pip-audit needs network to fetch CVE database
                mem_limit="512m",
                working_dir="/src",
                timeout=1800,  # 30 minutes for slow CVE lookups
            )

            data = json.loads(output)
            norm = FindingNormalizer()

            findings_count = 0
            # pip-audit JSON: { "dependencies": [ { "name": "...", "version": "...", "vulns": [ ... ] } ] }
            for dep in data.get("dependencies", []):
                for vuln in dep.get("vulns", []):
                    normalized = norm.normalize_pip_audit(dep, vuln)
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

    def _scan_javascript(self, scan_id: int, project_path: str, db: Session):
        try:
            # npm audit needs a lockfile; generate one first if the project
            # only ships a package.json. Mounted read-write for that write,
            # which is safe: the scan directory is deleted once the scan ends.
            #
            # --ignore-scripts: a scanner must never execute the target repo's
            # install/postinstall hooks, which are arbitrary code from
            # untrusted input. It is also what makes repos like frappe/hrms
            # scannable at all: their postinstall cds into subworkspaces and
            # shells out to yarn, failing the whole step.
            #
            # The `;` (not &&) keeps a failed lockfile generation from
            # short-circuiting the audit: npm audit exits 1 when it *finds*
            # vulnerabilities but still writes the JSON report to stdout.
            output = self._run_container(
                image="node:18.20-alpine@sha256:8d6421d663b4c28fd3ebc498332f249011d118945588d0a35cb9bc4b8ca09d9e",
                command=["sh", "-c",
                         "if [ ! -f package-lock.json ]; then "
                         "npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1; fi; "
                         "npm audit --json"],
                volumes=[f"/tmp/svs_uploads/scan_{scan_id}:/src"],
                network_disabled=False,
                mem_limit="512m",
                working_dir="/src",
                timeout=1800,  # 30 minutes for slow registry lookups
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
