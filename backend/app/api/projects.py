from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..api.deps import get_local_user
from ..database import get_db
from ..models.finding import Finding
from ..models.project import Project
from ..models.scan import Scan
from ..models.user import User
from ..schemas.project import ProjectCreate, ProjectOut

router = APIRouter(prefix="/projects", tags=["projects"])

@router.post("/", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(
    project_in: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    project = Project(
        name=project_in.name,
        repo_url=project_in.repo_url,
        owner_id=current_user.id
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project

@router.get("/", response_model=list[ProjectOut])
async def list_projects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    # No ownership filter: with auth removed this is a single-user instance, so
    # every project is the operator's. Filtering would hide the history that
    # was created under the old accounts.
    return db.query(Project).order_by(Project.id.desc()).all()

@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return project

@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_local_user)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Deleting a project used to 500 whenever it had scans: findings FK to
    # scans, scans FK to projects, neither with ON DELETE CASCADE, so the
    # database refused the delete. Clear the children first, then the project.
    scan_ids = [s.id for s in db.query(Scan).filter(Scan.project_id == project_id).all()]
    if scan_ids:
        db.query(Finding).filter(Finding.scan_id.in_(scan_ids)).delete(synchronize_session=False)
        db.query(Scan).filter(Scan.project_id == project_id).delete(synchronize_session=False)

    db.delete(project)
    db.commit()
