import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.base import Base
from app.models.scan import Scan
from app.models.finding import Finding
from app.engine.scoring import ScoringService

# Test Database Setup
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# The score is 100 / (1 + risk/25), NOT 100 - risk. risk is the weighted sum:
# Critical 10, High 7, Medium 4, Low 1, Info 0.
def risk_of(severities):
    weights = {"CRITICAL": 10, "HIGH": 7, "MEDIUM": 4, "LOW": 1, "INFO": 0}
    return sum(weights[s] for s in severities)

def expected_score(severities):
    return round(100 / (1 + risk_of(severities) / 25.0))


@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def _make_scan_with(db, severities):
    scan = Scan(project_id=1, status="COMPLETED")
    db.add(scan)
    db.commit()
    db.add_all(
        Finding(scan_id=scan.id, vulnerability_type=f"T{i}", severity=s,
                description="D", file_path="f")
        for i, s in enumerate(severities)
    )
    db.commit()
    return scan


def test_calculate_score_no_findings(db):
    # A clean repo is a perfect 100.
    scan = _make_scan_with(db, [])

    score = ScoringService().calculate_score(scan.id, db)

    assert score == 100
    assert scan.score == 100


def test_calculate_score_only_info(db):
    # INFO findings carry zero risk, so they cannot move the score.
    scan = _make_scan_with(db, ["INFO", "INFO"])

    score = ScoringService().calculate_score(scan.id, db)

    assert score == 100
    assert scan.score == 100


def test_calculate_score_mixed_findings(db):
    # 1 Critical (10) + 1 High (7) + 1 Medium (4) + 1 Low (1) = 22 risk
    # 100 / (1 + 22/25) = 53
    scan = _make_scan_with(db, ["CRITICAL", "HIGH", "MEDIUM", "LOW"])

    score = ScoringService().calculate_score(scan.id, db)

    assert score == expected_score(["CRITICAL", "HIGH", "MEDIUM", "LOW"]) == 53
    assert scan.score == 53
    assert scan.critical_count == 1
    assert scan.high_count == 1
    assert scan.medium_count == 1
    assert scan.low_count == 1


def test_calculate_score_never_reaches_zero(db):
    # The hyperbolic discount approaches 0 but never hits it, so an
    # arbitrarily bad repo still ranks below a merely bad one.
    scan = _make_scan_with(db, ["CRITICAL"] * 10)  # 100 risk -> 100/5 = 20

    score = ScoringService().calculate_score(scan.id, db)

    assert score == 20
    assert scan.score == 20


def test_score_stays_discriminative_at_scale(db):
    # The reason the formula is not a flat subtraction: 40 mediums used to
    # clamp to 0 alongside 80, making them indistinguishable.
    scan_40 = _make_scan_with(db, ["MEDIUM"] * 40)
    scan_80 = _make_scan_with(db, ["MEDIUM"] * 80)

    s40 = ScoringService().calculate_score(scan_40.id, db)
    s80 = ScoringService().calculate_score(scan_80.id, db)

    assert 0 < s80 < s40 < 100, f"score must stay discriminative: {s40}, {s80}"


def test_calculate_score_unknown_severity_falls_back_to_medium(db):
    # An unmapped severity must score as MEDIUM, not silently as zero.
    scan = _make_scan_with(db, ["UNKNOWN", "NONE"])  # 2 x MEDIUM = 8 risk -> 76

    score = ScoringService().calculate_score(scan.id, db)

    assert score == expected_score(["MEDIUM", "MEDIUM"]) == 76
    assert scan.score == 76


def test_calculate_score_is_monotonic(db):
    # More risk is always a strictly lower score, across severity classes.
    severities = [
        [],
        ["LOW"],
        ["MEDIUM"],
        ["HIGH"],
        ["CRITICAL"],
        ["CRITICAL", "CRITICAL"],
        ["CRITICAL"] * 11,
    ]
    scores = []
    for sev in severities:
        scan = _make_scan_with(db, sev)
        scores.append(ScoringService().calculate_score(scan.id, db))

    assert all(0 < s <= 100 for s in scores)
    assert scores == sorted(scores, reverse=True), f"not monotonic: {scores}"
