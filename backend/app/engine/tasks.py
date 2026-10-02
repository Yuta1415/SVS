import logging
from ..core.celery_app import celery_app
from ..database import SessionLocal
from ..engine.scanner import scanner_service
from ..models.scan import Scan
from ..core.config import settings
import os
import shutil

logger = logging.getLogger(__name__)

@celery_app.task(name="tasks.run_security_scan", bind=True, max_retries=3)
def run_security_scan(self, scan_id: int, project_id: int):
    db = SessionLocal()
    project_path = os.path.join(settings.UPLOAD_DIR, f"scan_{scan_id}")
    try:
        # Perform the full scan sequence (Semgrep -> Gitleaks -> Deps -> Scoring)
        scanner_service.run_full_scan(scan_id, project_path, db)

    except Exception as exc:
        # Update scan status to FAILED on error
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if scan:
            scan.status = "FAILED"
            db.commit()

        # Retry the task if it's a transient error
        raise self.retry(exc=exc, countdown=60)
    finally:
        try:
            if os.path.exists(project_path):
                shutil.rmtree(project_path)
                logger.info(f"Cleaned up scan directory: {project_path}")
        except Exception as e:
            logger.error(f"Error cleaning up scan directory {project_path}: {e}")
        db.close()
