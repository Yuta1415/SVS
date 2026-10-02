import tempfile

from fastapi import (
    APIRouter,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session

from ..api.deps import get_local_user
from ..database import get_db
from ..engine.ingestion import ingestion_service
from ..engine.reporting import ReportService
from ..engine.tasks import run_security_scan
from ..models.finding import Finding
from ..models.project import Project
from ..models.scan import Scan
from ..models.user import User
from ..schemas.scan import ScanOut

router = APIRouter(prefix="/scans", tags=["scans"])
report_service = ReportService()

# ponytail: tool is derived from vulnerability_type rather than stored as a
# column, so no migration is needed. Only correct while the scanners keep these
# exact v_type values; add a scanner_tool column if that changes.
def tool_for(v_type: str) -> str:
    if v_type == "Secret-Leak":
        return "Gitleaks"
    if v_type == "Dependency-Vulnerability":
        return "SCA Audit"
    # Checkov findings carry the check id (CKV_AWS_18) as their type, so a
    # distinct policy is a distinct rule in SARIF rather than one generic label.
    if v_type.startswith("CKV"):
        return "Checkov"
    return "Semgrep"

@router.get("/", response_model=list[ScanOut])
async def list_all_scans(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    # The dashboard's aggregates (average score, open criticals, scan volume) need
    # every scan at once. Without this the client would make one call per project.
    return db.query(Scan).order_by(Scan.created_at.desc()).all()

@router.post("/demo")
async def trigger_demo_scan(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    # Ensure a demo project exists. No ownership filter: with auth gone this is
    # a single-user instance, so any existing Demo Project is the operator's.
    repo_url = "https://github.com/juice-shop/juice-shop"

    project = db.query(Project).filter(
        Project.name == "Demo Project"
    ).first()

    if not project:
        project = Project(
            name="Demo Project",
            repo_url=repo_url,
            owner_id=current_user.id
        )
        db.add(project)
        db.commit()
        db.refresh(project)
    scan = await ingestion_service.ingest_git(repo_url, db, project.id)
    run_security_scan.delay(scan.id, project.id)

    return {"scan_id": scan.id, "status": scan.status, "message": "Demo scan queued for Juice-Shop."}

@router.get("/project/{project_id}", response_model=list[ScanOut])
async def list_project_scans(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    # The project's existence is the only check: no ownership filter without auth.
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    scans = db.query(Scan).filter(Scan.project_id == project_id).order_by(Scan.created_at.desc()).all()
    return scans

@router.post("/upload")
async def upload_zip(
    project_id: int = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    # The project's existence is the only check: no ownership filter without auth.
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Validate file extension
    if not file.filename.endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip archives are accepted")

    scan = await ingestion_service.ingest_zip(file, db, project_id)

    # Trigger the scan via Celery task
    run_security_scan.delay(scan.id, project_id)

    return {"scan_id": scan.id, "status": scan.status, "message": "Code ingested. Scan queued in background."}

@router.post("/git")
async def ingest_git(
    project_id: int = Form(...),
    repo_url: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    # The project's existence is the only check: no ownership filter without auth.
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    scan = await ingestion_service.ingest_git(repo_url, db, project_id)

    # Trigger the scan via Celery task
    run_security_scan.delay(scan.id, project_id)

    return {"scan_id": scan.id, "status": scan.status, "message": "Repository cloned. Scan queued in background."}

@router.get("/{scan_id}")
async def get_scan_status(scan_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_local_user)):
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    return {
        "id": scan.id,
        "status": scan.status,
        "score": scan.score,
        "project_id": scan.project_id,
        "created_at": scan.created_at.isoformat() if scan.created_at else None,
        "critical": scan.critical_count,
        "high": scan.high_count,
        "medium": scan.medium_count,
        "low": scan.low_count,
        "duration": scan.duration_seconds,
        "error_detail": scan.error_detail
    }

@router.get("/{scan_id}/findings")
async def list_scan_findings(
    scan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    return [
        {
            "id": f.id,
            "severity": f.severity.capitalize(),
            "title": f.vulnerability_type,
            "description": f.description,
            # The report view's remediation panel is driven straight off this
            # column, so omitting it would render the guidance section empty.
            "remediation": f.remediation or "No remediation guidance recorded.",
            "file": f.file_path,
            "line": f.line_number,
            "tool": tool_for(f.vulnerability_type),
            "status": f.triage_status or "open",
            "cwe": f.cwe,
        }
        for f in scan.findings
    ]

# The triage vocabulary the frontend's three buttons can set. Anything outside
# this set is a 400 rather than silently persisting an unfilterable value.
ALLOWED_TRIAGE = {"open", "resolved", "false_positive", "accepted"}

@router.patch("/{scan_id}/findings/{finding_id}", status_code=status.HTTP_200_OK)
async def update_finding_triage(
    scan_id: int,
    finding_id: int,
    triage: str = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user),
):
    """Persist a finding's triage decision.

    Triage used to be client-only: the buttons worked, then vanished on reload,
    which made them worse than absent. Now the column survives and the report
    view reads it straight back.
    """
    if triage not in ALLOWED_TRIAGE:
        raise HTTPException(status_code=400, detail=f"Invalid triage status. Use one of: {', '.join(sorted(ALLOWED_TRIAGE))}")

    finding = db.query(Finding).filter(Finding.id == finding_id, Finding.scan_id == scan_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")

    finding.triage_status = triage
    db.commit()
    db.refresh(finding)

    return {
        "id": finding.id,
        "scan_id": finding.scan_id,
        "status": finding.triage_status,
    }

@router.delete("/{scan_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scan(
    scan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user),
):
    """Delete a scan and every finding attached to it.

    Deleting a scan used to 500: findings hold an FK to scans with no ON DELETE
    CASCADE, so the row refused to go. Findings go first, then the scan.
    """
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    db.query(Finding).filter(Finding.scan_id == scan_id).delete(synchronize_session=False)
    db.delete(scan)
    db.commit()

@router.get("/{scan_id}/export")
async def export_scan_report(
    scan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    scan_data = {
        "score": scan.score,
        "severity_distribution": {
            "CRITICAL": scan.critical_count,
            "HIGH": scan.high_count,
            "MEDIUM": scan.medium_count,
            "LOW": scan.low_count,
        },
        "findings": [
            {
                "severity": f.severity,
                "file_path": f.file_path,
                "line": f.line_number,
                "desc": f.description,
                # The PDF's only actionable column: without this the report
                # tells a developer what is broken but never how to fix it.
                "remediation": f.remediation or "No remediation guidance recorded.",
                "triage": f.triage_status or "open",
                "cwe": f.cwe,
            }
            for f in scan.findings
        ],
        "project_name": scan.project.name if scan.project else f"Scan {scan_id}",
    }

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        success = report_service.generate_report(scan_data, tmp_path)
        if not success:
            raise HTTPException(status_code=500, detail="Failed to generate PDF report")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An error occurred while generating the report: {e!s}")

    return FileResponse(
        path=tmp_path,
        filename=f"scan_report_{scan_id}.pdf",
        media_type="application/pdf"
    )

# SARIF level is a closed vocabulary (none/note/warning/error), so the SVS
# severity buckets collapse into it. Criticals must not silently downgrade to
# "warning" in a SARIF-consuming CI gate.
SARIF_LEVEL = {"CRITICAL": "error", "HIGH": "error",
               "MEDIUM": "warning", "LOW": "note", "INFO": "none"}

@router.get("/{scan_id}/export/sarif")
async def export_scan_sarif(
    scan_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    """Emit findings as SARIF 2.1.0 for CI and IDE import.

    A second export format because the PDF is for humans reading a report and
    SARIF is for the tools already in a pipeline; one cannot serve the other.
    """
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    # ruleId prefers the weakness class, which is stable across tools, and
    # falls back to the tool-specific type so untitled findings still group.
    results = [
        {
            "ruleId": f.cwe or f.vulnerability_type,
            "level": SARIF_LEVEL.get(f.severity, "warning"),
            "message": {"text": f.description},
            "locations": [{
                "physicalLocation": {
                    "artifactLocation": {"uri": f.file_path},
                    "region": {"startLine": max(f.line_number or 0, 1)},
                }
            }],
            "properties": {
                "severity": f.severity,
                "tool": tool_for(f.vulnerability_type),
                "triage": f.triage_status or "open",
                "remediation": f.remediation or "No remediation guidance recorded.",
            },
        }
        for f in scan.findings
    ]

    sarif = {
        "$schema": "https://docs.oasis-open.org/sarif/sarif/v2.1.0/cs01/schemas/sarif-schema-2.1.0.json",
        "version": "2.1.0",
        "runs": [{
            "tool": {
                "driver": {
                    "name": "Security Vulnerability Scanner (SVS)",
                    "rules": [
                        {"id": rid, "name": rid, "shortDescription": {"text": desc}}
                        # ponytail: rules are enumerated from what this scan
                        # actually found rather than the full CWE catalogue,
                        # which keeps the payload proportional to the report.
                        for rid, desc in sorted({
                            (f.cwe or f.vulnerability_type, f.vulnerability_type)
                            for f in scan.findings
                        })
                    ],
                }
            },
            "results": results,
        }],
    }

    return JSONResponse(
        content=sarif,
        headers={
            "Content-Disposition": f'attachment; filename="scan_{scan_id}.sarif"'
        },
    )
