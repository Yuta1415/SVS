from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.engine.tasks as tasks
from app.models.base import Base
from app.models.project import Project
from app.models.scan import Scan
from app.models.user import User


def test_recover_stale_scans_fails_interrupted_rows_and_cleans_dirs(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'recovery.db'}")
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine)

    db = session_factory()
    user = User(username="local", email="local@example.test", hashed_password="!")
    db.add(user)
    db.commit()
    project = Project(name="recovery", repo_url="local.zip", owner_id=user.id)
    db.add(project)
    db.commit()

    pending = Scan(project_id=project.id, status="PENDING")
    running = Scan(project_id=project.id, status="RUNNING")
    completed = Scan(project_id=project.id, status="COMPLETED")
    db.add_all([pending, running, completed])
    db.commit()
    ids = (pending.id, running.id, completed.id)
    db.close()

    upload_dir = tmp_path / "uploads"
    for scan_id in ids:
        (upload_dir / f"scan_{scan_id}").mkdir(parents=True)

    monkeypatch.setattr(tasks, "SessionLocal", session_factory)
    monkeypatch.setattr(tasks.ingestion_service, "upload_dir", str(upload_dir))

    assert tasks.recover_stale_scans() == 2

    db = session_factory()
    try:
        rows = {scan.id: scan for scan in db.query(Scan).all()}
        assert rows[ids[0]].status == "FAILED"
        assert rows[ids[1]].status == "FAILED"
        assert rows[ids[0]].error_detail
        assert rows[ids[0]].end_time is not None
        # A completed scan is history, not an interrupted job.
        assert rows[ids[2]].status == "COMPLETED"
        assert rows[ids[2]].error_detail is None
    finally:
        db.close()
        engine.dispose()

    # The source of the interrupted scans will never be consumed; completed
    # scan directories are already cleaned by the worker and are left alone.
    assert not (upload_dir / f"scan_{ids[0]}").exists()
    assert not (upload_dir / f"scan_{ids[1]}").exists()
    assert (upload_dir / f"scan_{ids[2]}").exists()
