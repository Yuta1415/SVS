import asyncio
import io
import logging
import os
import shutil
import socket
import subprocess
import zipfile
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..core.config import settings
from ..models.scan import Scan

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB compressed

# A 50MB ceiling alone does not stop a zip bomb: a malicious archive can
# declare gigabytes of uncompressed data behind a few megabytes of compressed
# payload and exhaust the scan directory / inode table on extraction. The
# ratio cap catches the classic 42.zip-style bomb; the absolute cap catches a
# bomb assembled from many merely-well-compressed files.
MAX_UNCOMPRESSED_TOTAL = 500 * 1024 * 1024  # 500MB extracted
MAX_COMPRESSION_RATIO = 100

logger = logging.getLogger(__name__)

class IngestionService:
    def __init__(self, upload_dir: str = settings.UPLOAD_DIR):
        self.upload_dir = upload_dir
        os.makedirs(self.upload_dir, exist_ok=True)

    def _is_internal_ip(self, ip):
        """Check if an IP address is private or reserved (SSRF Protection)."""
        try:
            import ipaddress
            addr = ipaddress.ip_address(ip)
            return addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_reserved
        except ValueError:
            return True # Treat invalid IPs as internal for safety

    def validate_repo_url(self, url: str):
        """Validate the repo URL to prevent SSRF and command injection."""
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https", "ssh", "git"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Unsupported repository protocol. Use HTTP, HTTPS, or SSH."
            )

        if not parsed.netloc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid repository URL."
            )

        try:
            # Resolve hostname to all available IPs
            hostname = parsed.hostname
            addr_info = socket.getaddrinfo(hostname, None)
            for family, type, proto, canonname, sockaddr in addr_info:
                ip = sockaddr[0]
                if self._is_internal_ip(ip):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Internal network addresses are blocked for security reasons."
                    )
        except socket.gaierror:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not resolve repository hostname."
            )

    def _generate_scan_dir(self, scan_id: int) -> str:
        return os.path.join(self.upload_dir, f"scan_{scan_id}")

    def _discard_failed_ingestion(self, scan: Scan, extract_path: str, db: Session) -> None:
        try:
            if os.path.exists(extract_path):
                shutil.rmtree(extract_path)
        except OSError:
            logger.exception("Could not clean failed ingestion directory %s", extract_path)
        db.delete(scan)
        db.commit()

    def _check_zip_bomb(self, content: bytes, zip_ref: zipfile.ZipFile):
        """Reject archives whose extracted size is implausible for their
        compressed size, or implausibly large in absolute terms."""
        total_uncompressed = sum(info.file_size for info in zip_ref.infolist())
        if total_uncompressed > MAX_UNCOMPRESSED_TOTAL:
            raise HTTPException(
                status_code=400,
                detail=f"Archive would extract to {total_uncompressed // (1024*1024)}MB, "
                       f"above the {MAX_UNCOMPRESSED_TOTAL // (1024*1024)}MB limit"
            )
        # Compressed size is only knowable from the bytes we already hold, not
        # from the archive's own headers, so it is the honest denominator.
        ratio = total_uncompressed / len(content) if content else 0
        if ratio > MAX_COMPRESSION_RATIO:
            raise HTTPException(
                status_code=400,
                detail=f"Compression ratio {ratio:.0f}x exceeds the {MAX_COMPRESSION_RATIO}x "
                       f"limit (possible zip bomb)"
            )

    async def ingest_zip(self, file, db: Session, project_id: int) -> Scan:
        # Read at most one byte above the cap so an oversized upload is rejected
        # without materializing an unbounded request body in memory.
        content = bytearray()
        while len(content) <= MAX_FILE_SIZE:
            chunk = await file.read(min(1024 * 1024, MAX_FILE_SIZE + 1 - len(content)))
            if not chunk:
                break
            content.extend(chunk)
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")

        # Create scan record first to get ID
        scan = Scan(project_id=project_id, status="PENDING")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        extract_path = self._generate_scan_dir(scan.id)
        try:
            os.makedirs(extract_path, exist_ok=True)
            with zipfile.ZipFile(io.BytesIO(content)) as zip_ref:
                # Size the archive before extracting it, not after: a zip bomb
                # only reveals itself in the headers, and by the time
                # extractall has written half a terabyte the disk is gone.
                self._check_zip_bomb(content, zip_ref)
                # Skip extracting heavy/irrelevant directories (node_modules,
                # .git, venv, __pycache__, etc.) to speed up scanning and
                # reduce disk usage.
                _skip = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'build', '.tox'}
                members = [m for m in zip_ref.namelist() if not any(part in m.split('/') for part in _skip)]
                # Extraction is disk-bound and can take seconds on a large
                # archive. Run it off the event loop so other requests, such as
                # the dashboard's status poll, are not stalled behind it.
                await asyncio.to_thread(zip_ref.extractall, extract_path, members=members)
        except zipfile.BadZipFile:
            self._discard_failed_ingestion(scan, extract_path, db)
            raise HTTPException(status_code=400, detail="Invalid zip archive")
        except HTTPException:
            self._discard_failed_ingestion(scan, extract_path, db)
            raise
        except OSError as e:
            self._discard_failed_ingestion(scan, extract_path, db)
            raise HTTPException(status_code=500, detail=f"Could not prepare archive for scanning: {e}") from e
        except Exception:
            self._discard_failed_ingestion(scan, extract_path, db)
            raise

        return scan

    async def ingest_git(self, repo_url: str, db: Session, project_id: int,
                         branch: str | None = None) -> Scan:
        self.validate_repo_url(repo_url)

        # Create scan record first
        scan = Scan(project_id=project_id, status="PENDING")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        extract_path = self._generate_scan_dir(scan.id)

        try:
            # Attempt shallow clone with timeout for slow networks
            os.makedirs(extract_path, exist_ok=True)

            # Clone with depth=1 to reduce download size. A branch/tag is
            # optional; omitting it preserves Git's default-branch behavior.
            command = ["git", "clone", "--depth=1"]
            if branch and branch.strip():
                command.extend(["--branch", branch.strip()])
            command.extend([repo_url, "."])
            # A clone can run for minutes. Run it in a worker thread so the
            # event loop keeps serving status polls while it progresses.
            # GIT_TERMINAL_PROMPT=0 turns a credential prompt into a fast
            # failure instead of a silent wait until the timeout.
            result = await asyncio.to_thread(
                subprocess.run,
                command,
                cwd=extract_path,
                capture_output=True,
                text=True,
                timeout=300,  # 5 minute clone timeout
                env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
            )
            
            if result.returncode != 0:
                error_msg = result.stderr[:500] if result.stderr else "Unknown clone error"
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to clone repository: {error_msg}"
                )
        except subprocess.TimeoutExpired:
            self._discard_failed_ingestion(scan, extract_path, db)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Repository clone timed out (over 5 minutes). The repository may be very large or network is slow."
            )
        except HTTPException:
            self._discard_failed_ingestion(scan, extract_path, db)
            raise
        except OSError as e:
            self._discard_failed_ingestion(scan, extract_path, db)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to clone repository: {e!s}"
            ) from e
        except Exception:
            self._discard_failed_ingestion(scan, extract_path, db)
            raise

        return scan

ingestion_service = IngestionService()


if __name__ == "__main__":
    # A bomb is a lie told in the headers: tiny payload, enormous file_size.
    # zipfile.writestr() overwrites file_size with the real length, so the
    # forged entries are assembled by hand rather than written through ZipFile.
    import io

    svc = IngestionService.__new__(IngestionService)

    class _FakeZip:
        def __init__(self, entries):
            self._entries = entries
        def infolist(self):
            return self._entries

    def _entry(declared_size):
        info = zipfile.ZipInfo("bomb.txt")
        info.file_size = declared_size
        return info

    # 1MB of incompressible bytes, honestly declared: passes both caps.
    # os.urandom matters -- 1MB of b"x" is a real 1000:1 compression and would
    # be legitimately refused by the ratio cap.
    import os

    real = os.urandom(1024 * 1024)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("ok.txt", real)
    svc._check_zip_bomb(buf.getvalue(), _FakeZip([_entry(len(real))]))

    # 200MB declared over 1KB of payload: under the absolute cap, so only the
    # ratio cap can catch it.
    try:
        svc._check_zip_bomb(b"0" * 1024, _FakeZip([_entry(200 * 1024 * 1024)]))
    except HTTPException as e:
        assert e.status_code == 400 and "zip bomb" in e.detail, e.detail
    else:
        raise AssertionError("compression-ratio bomb was accepted")

    try:
        svc._check_zip_bomb(b"0" * 1024, _FakeZip([_entry(MAX_UNCOMPRESSED_TOTAL + 1)]))
    except HTTPException as e:
        assert e.status_code == 400 and "MB limit" in e.detail, e.detail
    else:
        raise AssertionError("absolute-size bomb was accepted")

    print("ingestion self-check OK")
