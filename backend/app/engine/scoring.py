from sqlalchemy.orm import Session
from ..models.scan import Scan
from ..models.finding import Finding

class ScoringService:
    # Weighted risk points per finding. A critical finding is worth 10 high-risk
    # units, a low one is worth 1: these drive the deduction below.
    WEIGHTS = {
        "CRITICAL": 10,
        "HIGH": 7,
        "MEDIUM": 4,
        "LOW": 1,
        "INFO": 0
    }

    # ponytail: a flat 100 - deduction saturates at 0, so any repo with ~25+
    # medium findings scores identically to Juice-Shop (314 points) and the
    # score stops ranking anything. A hyperbolic discount keeps 100 for a clean
    # repo, never reaches 0, and stays discriminative at every scale:
    # 1 critical -> 71, 3 -> 45, Juice-Shop's 314 -> 7. Ceiling: no score can
    # ever hit 0, only approach it, which is the intended behaviour.
    DEDUCTION_SCALE = 25.0

    @staticmethod
    def calculate_score(scan_id: int, db: Session):
        # Fetch all findings for this scan
        findings = db.query(Finding).filter(Finding.scan_id == scan_id).all()

        risk_points = 0

        counts = {
            "CRITICAL": 0,
            "HIGH": 0,
            "MEDIUM": 0,
            "LOW": 0
        }

        for f in findings:
            severity = f.severity.upper()
            # An unmapped severity falls back to the MEDIUM weight rather than
            # silently scoring zero.
            risk_points += ScoringService.WEIGHTS.get(severity, 4)
            if severity in counts:
                counts[severity] += 1

        final_score = round(100 / (1 + risk_points / ScoringService.DEDUCTION_SCALE))

        # Update scan record
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if scan:
            scan.score = final_score
            scan.critical_count = counts["CRITICAL"]
            scan.high_count = counts["HIGH"]
            scan.medium_count = counts["MEDIUM"]
            scan.low_count = counts["LOW"]
            db.commit()

        return final_score

scoring_service = ScoringService()


if __name__ == "__main__":
    # Self-check for the formula above. Run: python -m app.engine.scoring
    from collections import namedtuple

    FakeFinding = namedtuple("FakeFinding", ["severity"])

    class FakeScan:
        """A mutable stand-in for the Scan row: calculate_score writes counts
        and the score onto it, so a namedtuple will not do."""
        def __init__(self):
            self.id = 1
            self.score = None
            self.critical_count = None
            self.high_count = None
            self.medium_count = None
            self.low_count = None

    class FakeQuery:
        def __init__(self, rows):
            self._rows = rows

        def filter(self, *a, **k):
            return self

        def all(self):
            return self._rows

        def first(self):
            return self._rows[0] if self._rows else None

    class FakeDb:
        """Implements only query()/commit(); the real Session is not needed to
        check arithmetic."""
        def __init__(self, findings):
            self.findings = findings
            self.committed = False

        def query(self, model):
            return FakeQuery(self.findings if model is Finding else [FakeScan()])

        def commit(self):
            self.committed = True

    def score_with(severities):
        db = FakeDb([FakeFinding(s) for s in severities])
        return ScoringService.calculate_score(1, db), db

    # A clean repo is a perfect 100 and the counts are all zero.
    s, db = score_with([])
    assert s == 100 and db.committed, f"clean repo should score 100, got {s}"

    # The saturation bug: 40 medium findings used to clamp to 0 alongside
    # Juice-Shop. It must now be strictly better than 80 medium findings.
    s40, _ = score_with(["MEDIUM"] * 40)
    s80, _ = score_with(["MEDIUM"] * 80)
    assert 0 < s80 < s40 < 100, f"score must stay discriminative: {s40}, {s80}"

    # Severity order must hold: a critical finding is worse than a high one.
    sc, _ = score_with(["CRITICAL"])
    sh, _ = score_with(["HIGH"])
    sl, _ = score_with(["LOW"])
    assert sc < sh < sl, f"severity ordering broken: critical={sc} high={sh} low={sl}"

    # An unknown severity must fall back to MEDIUM, not score zero.
    s_unknown, _ = score_with(["BOGUS"])
    s_medium, _ = score_with(["MEDIUM"])
    assert s_unknown == s_medium, f"unknown severity scored {s_unknown}, expected MEDIUM's {s_medium}"

    # Case-insensitivity: findings arrive as both "High" and "HIGH".
    assert score_with(["High"])[0] == sh, "mixed-case severity must match uppercase"

    print("scoring self-check OK: clean=100, 40 medium<80 medium, critical<high<low")
