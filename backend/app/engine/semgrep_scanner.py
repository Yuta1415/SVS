import json

from sqlalchemy.orm import Session

from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer


class SemgrepScanner(BaseScanner):
    def scan(self, scan_id: int, project_path: str, db: Session):
        try:
            # --config=auto downloads the ruleset from semgrep.dev, so the
            # container needs network. The scan dir is mounted at /src.
            # Increased timeout to 1800s (30 min) for slow/large repos.
            output = self._run_container(
                # Pinned by digest: a bare "semgrep/semgrep" follows whatever
            # upstream ships, including a ruleset or engine rewrite that
            # changes results between two scans of the same code.
            image="semgrep/semgrep:1.177.0@sha256:acaac22ffc7b7cc5926de0751b223bce0b2491c33d18422fa72f632c78d81198",
                command=["sh", "-c", "semgrep scan --json --config=auto /src"],
                volumes=[f"/tmp/svs_uploads/scan_{scan_id}:/src:ro"],
                network_disabled=False,
                mem_limit="512m",
                cpu_period=100000,
                cpu_quota=50000,
                timeout=1800,  # 30 minutes for slow repos
            )

            data = json.loads(output)
            results = data.get("results", [])
            norm = FindingNormalizer()

            for res in results:
                normalized = norm.normalize_semgrep(res)
                self._save_finding(
                    db, scan_id,
                    **normalized
                )

            db.commit()
            return len(results)
        except ScannerError:
            raise
        except Exception as e:
            raise ScannerError("Semgrep", str(e)) from e
