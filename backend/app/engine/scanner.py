import docker
from sqlalchemy.orm import Session
from ..models.scan import Scan
from datetime import datetime
from .semgrep_scanner import SemgrepScanner
from .gitleaks_scanner import GitleaksScanner
from .dependency_scanner import DependencyScanner
from .iac_scanner import IacScanner
from .base_scanner import ScannerError
from .scoring import scoring_service
from ..models.finding import Finding

# Severity order, used only to pick which of two duplicate findings survives.
# An unknown value ranks with MEDIUM so it wins neither more nor less than a
# real one by accident.
SEVERITY_RANK = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "INFO": 0}


def deduplicate_findings(findings) -> list:
    """Collapse findings where two scanners flagged the same weakness at the
    same location, keeping the highest severity. Mutates survivors in place;
    returns the ids of the rows the caller should delete.

    Without this, a secret that both Semgrep and Gitleaks report is scored
    twice and listed twice in the report. The key is (file, line, weakness
    class): the class is what makes the match cross-tool, because every scanner
    uses its own type label. Rows with no line number are skipped: those are
    package-level dependency findings, where an identical key means two
    different vulnerable packages rather than one finding reported twice.
    """
    groups: dict = {}
    for f in findings:
        if not f.line_number:
            continue
        groups.setdefault((f.file_path, f.line_number, f.cwe or f.vulnerability_type), []).append(f)

    drop_ids = []
    for group in groups.values():
        if len(group) < 2:
            continue
        # Highest severity wins; a tie keeps the lowest id, so the survivor
        # does not depend on dict iteration order.
        best = min(group, key=lambda f: (-SEVERITY_RANK.get(f.severity.upper(), 2), f.id))
        others = [f for f in group if f is not best]
        # Name the other rules that flagged this spot, so collapsing a finding
        # does not hide that a second tool saw it too.
        also = ", ".join(sorted({f.vulnerability_type for f in others
                                 if f.vulnerability_type != best.vulnerability_type}))
        if also:
            best.description = f"{best.description} (also reported as: {also})"
        drop_ids.extend(f.id for f in others)
    return drop_ids

class ScannerService:
    def __init__(self):
        self._client = None

    @property
    def client(self):
        if self._client is None:
            try:
                self._client = docker.from_env()
            except Exception as e:
                print(f"Could not connect to Docker daemon: {e}")
                return None
        return self._client

    def run_full_scan(self, scan_id: int, project_path: str, db: Session):
        if self.client is None:
            print("Skipping scan: Docker daemon is not available")
            scan = db.query(Scan).filter(Scan.id == scan_id).first()
            if scan:
                scan.status = "FAILED"
                db.commit()
            return

        # Update scan status to RUNNING
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if not scan:
            return

        scan.status = "RUNNING"
        scan.start_time = datetime.utcnow()
        db.commit()

        try:
            # List of all active scanners in the pipeline
            scanners = [
                SemgrepScanner(self.client),
                GitleaksScanner(self.client),
                DependencyScanner(self.client),
                IacScanner(self.client),
            ]

            # Run each scanner in sequence, recording which ones failed.
            failures = []
            for scanner in scanners:
                try:
                    scanner.scan(scan_id, project_path, db)
                except ScannerError as e:
                    print(f"Scanner {e.tool} failed: {e.detail}")
                    failures.append(f"{e.tool}: {e.detail}")

            # Collapse what the scanners double-reported before scoring, so a
            # weakness two tools flagged is scored once and listed once.
            db.flush()
            rows = db.query(Finding).filter(Finding.scan_id == scan_id).all()
            drop_ids = deduplicate_findings(rows)
            if drop_ids:
                db.query(Finding).filter(Finding.id.in_(drop_ids)).delete(synchronize_session=False)
                db.commit()

            # Score whatever the surviving scanners found, so partial results
            # are still visible rather than discarded.
            scoring_service.calculate_score(scan_id, db)

            # A scan whose scanners failed is not complete: reporting COMPLETED
            # with a clean score would hide a broken pipeline as a clean repo.
            if failures:
                scan.status = "FAILED"
                scan.error_detail = " | ".join(failures)[:500]
            else:
                scan.status = "COMPLETED"
        except Exception as e:
            print(f"Critical scan pipeline error: {e}")
            scan.status = "FAILED"
            scan.error_detail = f"Pipeline error: {str(e)[:500]}"
        finally:
            scan.end_time = datetime.utcnow()
            if scan.start_time:
                delta = scan.end_time - scan.start_time
                scan.duration_seconds = delta.total_seconds()
            db.commit()

scanner_service = ScannerService()


if __name__ == "__main__":
    from types import SimpleNamespace

    # SimpleNamespace, not namedtuple: the survivor's description is rewritten in
    # place, and a namedtuple would reject the assignment that a real row allows.
    def finding(i, sev, v_type, cwe, line=42, file="app.py", desc="d"):
        return SimpleNamespace(id=i, severity=sev, file_path=file, line_number=line,
                               vulnerability_type=v_type, cwe=cwe, description=desc)

    # Semgrep's hardcoded-credential rule and Gitleaks both see the one secret.
    cross_tool = [
        finding(1, "HIGH", "python.lang.security.audit.hardcoded-password", "CWE-798"),
        finding(2, "CRITICAL", "Secret-Leak", "CWE-798"),
    ]
    dropped = deduplicate_findings(cross_tool)
    assert dropped == [1], dropped
    assert cross_tool[1].severity == "CRITICAL"
    assert "also reported as: python.lang.security.audit.hardcoded-password" in cross_tool[1].description

    # A severity tie keeps the lowest id, so dict order cannot change the result.
    tied = [finding(7, "HIGH", "A", "CWE-79"), finding(3, "HIGH", "B", "CWE-79")]
    assert deduplicate_findings(tied) == [7]

    # Distinct weaknesses at the same spot are two findings, not one.
    distinct = [finding(1, "HIGH", "A", "CWE-79"), finding(2, "HIGH", "B", "CWE-89")]
    assert deduplicate_findings(distinct) == []

    # Dependency findings have no line number: an identical key there is two
    # vulnerable packages, and collapsing them would hide a real vulnerability.
    packages = [
        finding(1, "CRITICAL", "Dependency-Vulnerability", None, line=0, file="requirements.txt"),
        finding(2, "HIGH", "Dependency-Vulnerability", None, line=0, file="requirements.txt"),
    ]
    assert deduplicate_findings(packages) == []

    # Two Checkov policies on the same resource land on the same file and line.
    # They are distinct weaknesses (no CWE, distinct check ids), so collapsing
    # them would hide a real misconfiguration.
    policies = [
        finding(1, "MEDIUM", "CKV_AWS_18", None),
        finding(2, "HIGH", "CKV_AWS_145", None),
    ]
    assert deduplicate_findings(policies) == []

    print("cross-tool deduplication OK")
