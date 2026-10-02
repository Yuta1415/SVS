import json
import os
from sqlalchemy.orm import Session
from .base_scanner import BaseScanner, ScannerError
from .normalizer import FindingNormalizer

# Digest-pinned, like every other image in the pipeline: a floating tag would let
# a tampered or broken image replace a working one between two scans with
# nothing in this repo changing.
CHECKOV_IMAGE = "bridgecrew/checkov:3.2.431@sha256:6fdac50c5eba95ed4bfc9a5c7b0c951d5a2ee495d3608f12d2aa565bda6e892f"


class IacScanner(BaseScanner):
    """Scan infrastructure-as-code (Dockerfile, Terraform, CloudFormation).

    Infrastructure files are part of the attack surface: a bucket left
    private=false or a container running as root is a live misconfiguration
    that Semgrep does not look for, and a repo can be perfectly clean
    application code and still deploy insecurely.
    """

    # ponytail: Checkov supports a dozen frameworks; this is the subset an
    # uploaded repo realistically contains, and it keeps a pure-Python repo
    # from paying for a container that would report nothing. Kubernetes
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
        # Same shape as the dependency scanner: no IaC files means no container,
        # rather than running a scan that can only find nothing.
        if not self._has_iac(project_path):
            return 0

        try:
            # --quiet keeps stdout to the JSON report; --output json sends it
            # there instead of the human-readable table. accept_exit_codes
            # covers both exit-code conventions Checkov has used for "checks
            # failed", so a repo with findings does not scan as FAILED.
            #
            # The image's ENTRYPOINT is /entrypoint.sh, which runs "checkov $@"
            # when GITHUB_ACTIONS is unset. So this is an argv list of checkov
            # flags, not a "sh -c" string: wrapping it in sh -c made the
            # entrypoint run "checkov sh -c ..." and argparse exited 2 with
            # "unrecognized arguments: sh".
            output = self._run_container(
                image=CHECKOV_IMAGE,
                command=["-d", "/src", "--output", "json", "--quiet"],
                volumes=[f"/tmp/svs_uploads/scan_{scan_id}:/src:ro"],
                network_disabled=True,
                mem_limit="512m",
                working_dir="/src",
                accept_exit_codes=(0, 1),
                timeout=1800,
            )
        except ScannerError:
            raise
        except Exception as e:
            raise ScannerError("Checkov", str(e)) from e

        if not output:
            return 0

        try:
            reports = json.loads(output)
        except json.JSONDecodeError as e:
            raise ScannerError("Checkov", f"unparseable report: {e}") from e

        # Checkov emits one JSON object per framework when several are detected
        # and a bare object when only one is; both shapes have to end up as one
        # list of failed checks.
        failed = []
        for report in (reports if isinstance(reports, list) else [reports]):
            failed.extend((report.get("results") or {}).get("failed_checks") or [])

        norm = FindingNormalizer()
        for res in failed:
            self._save_finding(db, scan_id, **norm.normalize_checkov(res))
        db.commit()
        return len(failed)


if __name__ == "__main__":
    # _has_iac is the gate that decides whether a container runs at all, so it
    # is the one piece of this scanner that can silently degrade a whole scan
    # (a repo with misconfigured Terraform scanned as clean because the walk
    # missed it, or a pure-Python repo paying for a container that reports
    # nothing). Its rules and the mount prefix the normalizer strips have to
    # agree, or findings land on paths nothing else recognises.
    import tempfile

    s = IacScanner(docker_client=None)

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

    # The mount prefix the scanner uses and the one the normalizer strips have
    # to be the same string, or paths silently stop matching between scan and
    # report.
    from .normalizer import FindingNormalizer

    norm = FindingNormalizer()
    got = norm.normalize_checkov({"check_id": "CKV_AWS_18", "check_name": "x",
                                 "resource": "aws_s3_bucket.a", "file_path": "/main.tf"})
    assert got["file_path"] == "main.tf", got["file_path"]

    print("iac_scanner detection + checkov path handling OK")
