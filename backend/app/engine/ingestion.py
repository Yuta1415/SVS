import io
import os
import socket
import zipfile
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from ..models.scan import Scan

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB compressed

# A 50MB ceiling alone does not stop a zip bomb: a malicious archive can
# declare gigabytes of uncompressed data behind a few megabytes of compressed
# payload and exhaust the scan directory / inode table on extraction. The
# ratio cap catches the classic 42.zip-style bomb; the absolute cap catches a
# bomb assembled from many merely-well-compressed files.
MAX_UNCOMPRESSED_TOTAL = 500 * 1024 * 1024  # 500MB extracted
MAX_COMPRESSION_RATIO = 100

class IngestionService:
    def __init__(self, upload_dir: str = "/tmp/svs_uploads"):
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
        # Validate size
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")

        # Create scan record first to get ID
        scan = Scan(project_id=project_id, status="PENDING")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        # Extract to isolated dir
        extract_path = self._generate_scan_dir(scan.id)
        os.makedirs(extract_path, exist_ok=True)

        try:
            with zipfile.ZipFile(io.BytesIO(content)) as zip_ref:
                # Size the archive before extracting it, not after: a zip bomb
                # only reveals itself in the headers, and by the time
                # extractall has written half a terabyte the disk is gone.
                self._check_zip_bomb(content, zip_ref)
                zip_ref.extractall(extract_path)
        except zipfile.BadZipFile:
            db.delete(scan)
            db.commit()
            raise HTTPException(status_code=400, detail="Invalid zip archive")

        return scan

    async def ingest_git(self, repo_url: str, db: Session, project_id: int) -> Scan:
        self.validate_repo_url(repo_url)

        # Create scan record first
        scan = Scan(project_id=project_id, status="PENDING")
        db.add(scan)
        db.commit()
        db.refresh(scan)

        extract_path = self._generate_scan_dir(scan.id)

        try:
            # Attempt shallow clone with timeout for slow networks
            import subprocess
            os.makedirs(extract_path, exist_ok=True)
            
            # Clone with depth=1 to reduce download size
            result = subprocess.run(
                ["git", "clone", "--depth=1", repo_url, "."],
                cwd=extract_path,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute clone timeout
            )
            
            if result.returncode != 0:
                error_msg = result.stderr[:500] if result.stderr else "Unknown clone error"
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Failed to clone repository: {error_msg}"
                )
        except subprocess.TimeoutExpired:
            db.delete(scan)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Repository clone timed out (over 5 minutes). The repository may be very large or network is slow."
            )
        except Exception as e:
            db.delete(scan)
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to clone repository: {e!s}"
            )

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
