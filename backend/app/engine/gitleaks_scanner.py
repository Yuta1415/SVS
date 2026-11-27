import json
import os

from sqlalchemy.orm import Session

from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer


class GitleaksScanner(BaseScanner):
    def scan(self, scan_id: int, project_path: str, db: Session):
        # Bound before the try so cleanup can run even if the command fails.
        report_name = ".svs_gitleaks_report.json"
        report_path = os.path.join(project_path, report_name)
        try:
            self._run_command(
                "Gitleaks",
                ["gitleaks", "detect", "--no-git", "--source", project_path,
                 "--report-format", "json", "--report-path", report_path, "--no-banner"],
                accept_exit_codes=(0, 1),
                timeout=1800,  # 30 minutes for large repos
            )

            if not os.path.exists(report_path) or os.path.getsize(report_path) == 0:
                raise ScannerError("Gitleaks", "completed without producing a JSON report")

            with open(report_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            norm = FindingNormalizer()
            for leak in data:
                finding = dict(leak)
                finding["File"] = self._repo_relative_path(project_path, finding.get("File"))
                normalized = norm.normalize_gitleaks(finding)
                self._save_finding(
                    db, scan_id,
                    **normalized
                )

            db.commit()
            return len(data)
        except ScannerError:
            raise
        except Exception as e:
            raise ScannerError("Gitleaks", str(e)) from e
        finally:
            # The report carries the matched secrets in cleartext. Do not leave
            # it on disk for the scan directory's remaining lifetime.
            try:
                if os.path.exists(report_path):
                    os.remove(report_path)
            except OSError:
                pass
