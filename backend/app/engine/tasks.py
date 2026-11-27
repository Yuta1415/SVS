import logging
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from ..database import SessionLocal
from ..engine.ingestion import ingestion_service
from ..engine.scanner import scanner_service
from ..models.scan import Scan

logger = logging.getLogger(__name__)
executor = ThreadPoolExecutor(max_workers=2)


def run_security_scan(scan_id: int, project_id: int):
    return executor.submit(_run_scan_task, scan_id, project_id)


def recover_stale_scans() -> int:
    """Fail scans that were interrupted by a process restart.

    The queue lives in this process, so a restart loses every queued or
    in-flight job. Without this, those rows stay PENDING or RUNNING forever and
    the dashboard polls a scan that will never finish. Marking them FAILED with
    an explicit reason makes the state honest and the scan re-runnable.
    """
    db = SessionLocal()
    try:
        stale = (
            db.query(Scan)
            .filter(Scan.status.in_(("PENDING", "RUNNING")))
            .all()
        )
        if not stale:
            return 0

        now = datetime.utcnow()
        for scan in stale:
            scan.status = "FAILED"
            scan.error_detail = "Scan was interrupted by an application restart. Run it again."
            scan.end_time = now
            if scan.start_time:
                scan.duration_seconds = (now - scan.start_time).total_seconds()
            # Nothing will consume the extracted source now, so remove it
            # rather than leaving orphaned directories in the upload folder.
            shutil.rmtree(
                os.path.join(ingestion_service.upload_dir, f"scan_{scan.id}"),
                ignore_errors=True,
            )
        db.commit()
        logger.warning("Marked %d interrupted scan(s) as FAILED", len(stale))
        return len(stale)
    finally:
        db.close()


def _run_scan_task(scan_id: int, project_id: int) -> None:
    db = SessionLocal()
    project_path = os.path.join(ingestion_service.upload_dir, f"scan_{scan_id}")
    try:
        scanner_service.run_full_scan(scan_id, project_path, db)

    except Exception as exc:
        logger.exception("Security scan %s failed unexpectedly", scan_id)
        db.rollback()
        scan = db.query(Scan).filter(Scan.id == scan_id).first()
        if scan:
            scan.status = "FAILED"
            scan.error_detail = f"Worker error: {exc}"[:500]
            scan.end_time = datetime.utcnow()
            if scan.start_time:
                scan.duration_seconds = (scan.end_time - scan.start_time).total_seconds()
            db.commit()
    finally:
        try:
            if os.path.exists(project_path):
                shutil.rmtree(project_path)
                logger.info("Cleaned up scan directory: %s", project_path)
        except OSError:
            logger.exception("Error cleaning up scan directory %s", project_path)
        db.close()
