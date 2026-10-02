import pytest
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.base import Base
from app.models.scan import Scan
from app.models.project import Project
from app.engine.scanner import ScannerService

# Test Database Setup
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture
def db():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)

def test_full_scan_pipeline_integration(db):
    # 1. Setup: Create a project and scan record
    project = Project(name="Integration Test Project", repo_url="http://fake/repo", owner_id=1)
    db.add(project)
    db.commit()

    scan = Scan(project_id=project.id, status="RUNNING")
    db.add(scan)
    db.commit()

    # 2. Define the path to the deliberately vulnerable fixture
    fixture_path = os.path.join("backend", "tests", "fixtures", "vulnerable_project")
    # Convert to absolute path because scanner expects it
    abs_fixture_path = os.path.abspath(fixture_path)

    # 3. Run the full scan pipeline
    scanner = ScannerService()
    try:
        scanner.run_full_scan(scan.id, abs_fixture_path, db)
    except Exception as e:
        pytest.fail(f"Full scan pipeline failed: {e}")

    # 4. Assertions: Check if known vulnerabilities were detected
    db.refresh(scan)
    assert scan.status == "COMPLETED"

    from app.models.finding import Finding
    findings = db.query(Finding).filter(Finding.scan_id == scan.id).all()

    assert len(findings) > 0, "No findings detected in vulnerable project"

    # Tool-specific assertions for high/critical findings
    gitleaks_findings = [f for f in findings if f.vulnerability_type == "Secret-Leak"]
    assert len(gitleaks_findings) > 0, "Gitleaks failed to detect secrets"
    assert any(f.severity in ["HIGH", "CRITICAL"] for f in gitleaks_findings), "Gitleaks findings not high/critical"

    pip_findings = [f for f in findings if f.vulnerability_type == "Dependency-Vulnerability" and f.file_path == "requirements.txt"]
    assert len(pip_findings) > 0, "pip-audit failed to detect vulnerable dependencies"
    assert any(f.severity in ["HIGH", "CRITICAL"] for f in pip_findings), "pip-audit findings not high/critical"

    # Checkov findings key on the check id, so exclude them or they would let a
    # Semgrep failure hide behind an IaC finding here.
    semgrep_findings = [f for f in findings
                        if f.vulnerability_type not in ["Secret-Leak", "Dependency-Vulnerability"]
                        and not f.vulnerability_type.startswith("CKV")]
    assert len(semgrep_findings) > 0, "Semgrep failed to detect vulnerabilities"
    assert any(f.severity in ["HIGH", "CRITICAL"] for f in semgrep_findings), "Semgrep findings not high/critical"

    print(f"Detected {len(findings)} vulnerabilities in integration test.")
