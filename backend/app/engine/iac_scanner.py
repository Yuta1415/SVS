import json
import os
import sys

import checkov
from sqlalchemy.orm import Session

from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer

class IacScanner(BaseScanner):
    """Scan infrastructure-as-code (Dockerfile, Terraform, CloudFormation).

    Infrastructure files are part of the attack surface: a bucket left
    private=false or a container running as root is a live misconfiguration
    that Semgrep does not look for, and a repo can be perfectly clean
    application code and still deploy insecurely.
    """

    # Checkov supports a dozen frameworks; this is the subset an uploaded repo
    # realistically contains, and it skips a pure-Python repo. Kubernetes
    # manifests in an arbitrarily named directory are not detected, so a
    # k8s-only repo is skipped; add the glob when a real scan misses one.
    IAC_SUFFIXES = (".tf", ".tf.json", ".cf.json", ".template.json")

    def _has_iac(self, project_path: str) -> bool:
        for root, _, files in os.walk(project_path):
            if os.path.basename(root) == ".git":
                continue
            for name in files:
                if name.startswith("Dockerfile") or name.endswith(self.IAC_SUFFIXES):
                    return True
        return False

    def scan(self, scan_id: int, project_path: str, db: Session):
        # Avoid running a scanner that cannot find anything in this repository.
        if not self._has_iac(project_path):
            return 0

        try:
            output = self._run_command(
                "Checkov",
                [
                    sys.executable,
                    os.path.join(os.path.dirname(checkov.__file__), "main.py"),
                    "-d",
                    project_path,
                    "--output",
                    "json",
                    "--quiet",
                ],
                accept_exit_codes=(0, 1),
                timeout=1800,
            )
        except ScannerError:
            raise
        except Exception as e:
            raise ScannerError("Checkov", str(e)) from e

        if not output:
            raise ScannerError("Checkov", "completed without producing a JSON report")

        try:
            reports = json.loads(output)
        except json.JSONDecodeError as e:
            raise ScannerError("Checkov", f"unparseable report: {e}") from e

        # Checkov emits one JSON object per framework when several are detected
        # and a bare object when only one is; both shapes have to end up as one
        # list of failed checks.
        failed = []
        for report in (reports if isinstance(reports, list) else [reports]):
            errors = report.get("errors") or []
            if errors:
                raise ScannerError("Checkov", f"reported scan errors: {errors[0]}")
            failed.extend((report.get("results") or {}).get("failed_checks") or [])

        norm = FindingNormalizer()
        for res in failed:
            finding = dict(res)
            finding["file_path"] = self._repo_relative_path(
                project_path, finding.get("file_path")
            )
            self._save_finding(db, scan_id, **norm.normalize_checkov(finding))
        db.commit()
        return len(failed)


if __name__ == "__main__":
    # _has_iac is the gate that decides whether Checkov runs at all, so it
    # is the one piece of this scanner that can silently degrade a whole scan
    # (a repo with misconfigured Terraform scanned as clean because the walk
    # missed it, or a pure-Python repo paying for a scan that reports nothing).
    import tempfile

    s = IacScanner()

    with tempfile.TemporaryDirectory() as d:
        for rel in ["main.tf", "nested/dir/Dockerfile", "infra/cf.json",
                    "app/main.py", "README.md", ".git/objects/pack/abc.tf"]:
            p = os.path.join(d, rel.replace("/", os.sep))
            os.makedirs(os.path.dirname(p), exist_ok=True) if os.path.dirname(p) else None
            with open(p, "w") as fh:
                fh.write("FROM alpine\n")

        assert s._has_iac(d), "a .tf and a Dockerfile were not detected as IaC"
        assert not s._has_iac(tempfile.mkdtemp()), "an empty dir scanned as IaC"

        python_only = tempfile.mkdtemp()
        with open(os.path.join(python_only, "app.py"), "w") as fh:
            fh.write("print(1)\n")
        assert not s._has_iac(python_only), "a .py file was detected as IaC"

        # A Dockerfile with an extension (Dockerfile.dev) and .tf.json both count.
        with open(os.path.join(python_only, "Dockerfile.dev"), "w") as fh:
            fh.write("FROM alpine\n")
        assert s._has_iac(python_only), "Dockerfile.dev was not detected as IaC"
        os.remove(os.path.join(python_only, "Dockerfile.dev"))

        with open(os.path.join(python_only, "stack.tf.json"), "w") as fh:
            fh.write("{}\n")
        assert s._has_iac(python_only), ".tf.json was not detected as IaC"

    # The scan root and normalized paths have to agree so report paths remain
    # repository-relative.
    from .normalizer import FindingNormalizer

    norm = FindingNormalizer()
    got = norm.normalize_checkov({"check_id": "CKV_AWS_18", "check_name": "x",
                                 "resource": "aws_s3_bucket.a", "file_path": "/main.tf"})
    assert got["file_path"] == "main.tf", got["file_path"]

    print("iac_scanner detection + checkov path handling OK")
