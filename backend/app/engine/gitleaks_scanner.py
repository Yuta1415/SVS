import json
import os

from sqlalchemy.orm import Session

from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer


class GitleaksScanner(BaseScanner):
    def scan(self, scan_id: int, project_path: str, db: Session):
        # Bound before the try: if the container fails to start, the finally
        # below must still have a name to test.
        report_name = ".svs_gitleaks_report.json"
        report_path = os.path.join(project_path, report_name)
        try:
            # The report is written inside the mounted scan directory, so it has
            # to be writable. That is safe: the directory is deleted once the
            # scan finishes, and the file is picked up before then.
            self._run_container(
                image="zricethezav/gitleaks:v8.9.0@sha256:b2d25f43943b27b4b6f38f75cfb8a85ba68c802da54d4aabd74f1d006f122dc2",
                # --no-git + --source so we scan the plain directory tree.
                # Use shell invocation to avoid permission issues with direct binary call.
                # Exit 1 means leaks were found, not an error, so it has to be
                # in accept_exit_codes or every dirty repo scans as FAILED.
                command=["sh", "-c",
                         f"gitleaks detect --no-git --source /src --report-format json --report-path /src/{report_name} --no-banner"],
                volumes=[f"/tmp/svs_uploads/scan_{scan_id}:/src"],
                network_disabled=True,
                mem_limit="256m",
                accept_exit_codes=(0, 1),
                timeout=1800,  # 30 minutes for large repos
            )

            # Gitleaks streams nothing to stdout: without --report-path it does
            # not emit parseable JSON at all. Read the file back from the mount
            # instead of trusting stdout.
            if not os.path.exists(report_path) or os.path.getsize(report_path) == 0:
                # No report file means no leaks, which is a clean scan.
                db.commit()
                return 0

            with open(report_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            norm = FindingNormalizer()
            for leak in data:
                normalized = norm.normalize_gitleaks(leak)
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
