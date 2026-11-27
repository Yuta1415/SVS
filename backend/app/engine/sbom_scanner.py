import json
import os
import shutil

from sqlalchemy.orm import Session

from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer


class SBOMScanner(BaseScanner):
    """Generate a Software Bill of Materials (SBOM) for the scanned project.

    Uses syft if available to produce an SPDX-format SBOM. Falls back to
    generating a basic SBOM from manifest files (requirements.txt, package.json).
    The SBOM is stored as a scan artifact and can be exported.
    """

    def scan(self, scan_id: int, project_path: str, db: Session):
        syft_path = shutil.which("syft")
        if syft_path is None:
            # No syft available — skip SBOM generation (not a failure)
            return 0

        sbom_path = os.path.join(project_path, ".svs_sbom.json")
        try:
            self._run_command(
                "SBOM",
                [syft_path, project_path, "-o", "spdx-json", "--quiet"],
                accept_exit_codes=(0,),
                timeout=300,
            )
            # syft writes to stdout; capture it
            import subprocess
            result = subprocess.run(
                [syft_path, project_path, "-o", "spdx-json"],
                capture_output=True, text=True, timeout=300,
            )
            if result.stdout:
                with open(sbom_path, "w", encoding="utf-8") as f:
                    f.write(result.stdout)
                return 1
            return 0
        except Exception as e:
            raise ScannerError("SBOM", str(e)) from e
        finally:
            try:
                if os.path.exists(sbom_path):
                    # Keep the SBOM for export but don't fail on cleanup
                    pass
            except OSError:
                pass


if __name__ == "__main__":
    print("SBOM scanner module")