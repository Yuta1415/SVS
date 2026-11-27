import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.engine.scanner import ScannerService
from app.engine.scanner import (
    DependencyScanner,
    GitleaksScanner,
    IacScanner,
    SemgrepScanner,
)
from app.models.base import Base
from app.models.project import Project
from app.models.scan import Scan

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

def test_full_scan_pipeline_orchestration(db, monkeypatch):
    # 1. Setup: Create a project and scan record
    project = Project(name="Integration Test Project", repo_url="http://fake/repo", owner_id=1)
    db.add(project)
    db.commit()

    scan = Scan(project_id=project.id, status="RUNNING")
    db.add(scan)
    db.commit()

    # 2. Define the path to the deliberately vulnerable fixture
    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "vulnerable_project")
    abs_fixture_path = os.path.abspath(fixture_path)

    # Keep this an orchestration test: scanner executables are separately
    # installed on the host and are not prerequisites for the unit suite.
    def save_finding(v_type, severity, file_path, line, description):
        def scan(scanner, scan_id, project_path, session):
            scanner._save_finding(
                session, scan_id, v_type, severity, file_path, line, description
            )
            session.commit()
            return 1
        return scan

    monkeypatch.setattr(
        SemgrepScanner, "scan",
        save_finding("python.lang.security.audit.sql-injection", "HIGH", "app.py", 3, "SQL injection"),
    )
    monkeypatch.setattr(
        GitleaksScanner, "scan",
        save_finding("Secret-Leak", "CRITICAL", "secrets.py", 1, "Hardcoded secret"),
    )
    monkeypatch.setattr(
        DependencyScanner, "scan",
        save_finding("Dependency-Vulnerability", "HIGH", "requirements.txt", 0, "Vulnerable package"),
    )
    monkeypatch.setattr(
        IacScanner, "scan",
        save_finding("CKV_AWS_18", "MEDIUM", "main.tf", 2, "Public bucket"),
    )

    # Run the full orchestration pipeline against the fixture directory.
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

    # Tool-specific assertions for the expected pipeline finding types.
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
