import asyncio
import io
import os
import subprocess
import zipfile

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.engine.ingestion as ingestion_module
from app.engine.ingestion import IngestionService
from app.models.base import Base
from app.models.project import Project
from app.models.scan import Scan
from app.models.user import User


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'ingestion.db'}")
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    user = User(username="local", email="local@example.test", hashed_password="!")
    session.add(user)
    session.commit()
    project = Project(name="test", repo_url="test.zip", owner_id=user.id)
    session.add(project)
    session.commit()
    try:
        yield session, project.id
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


class AsyncUpload:
    def __init__(self, content: bytes):
        self.stream = io.BytesIO(content)
        self.read_sizes = []

    async def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        return self.stream.read(size)


def zip_bytes(name: str, content: bytes) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(name, content)
    return buffer.getvalue()


def test_zip_ingestion_extracts_source_and_creates_scan(db, tmp_path):
    session, project_id = db
    service = IngestionService(os.fspath(tmp_path / "uploads"))

    scan = asyncio.run(service.ingest_zip(
        AsyncUpload(zip_bytes("src/app.py", b"print('hello')")),
        session,
        project_id,
    ))

    assert scan.status == "PENDING"
    assert (tmp_path / "uploads" / f"scan_{scan.id}" / "src" / "app.py").read_text() == "print('hello')"
    assert session.query(Scan).filter(Scan.id == scan.id).one()


def test_invalid_zip_is_rejected_without_orphan_scan_or_directory(db, tmp_path):
    session, project_id = db
    service = IngestionService(os.fspath(tmp_path / "uploads"))

    with pytest.raises(HTTPException, match="Invalid zip archive"):
        asyncio.run(service.ingest_zip(AsyncUpload(b"not a zip"), session, project_id))

    assert session.query(Scan).count() == 0
    assert list((tmp_path / "uploads").iterdir()) == []


def test_zip_bomb_is_rejected_without_orphan_scan_or_directory(db, tmp_path):
    session, project_id = db
    service = IngestionService(os.fspath(tmp_path / "uploads"))

    with pytest.raises(HTTPException, match="possible zip bomb"):
        asyncio.run(service.ingest_zip(
            AsyncUpload(zip_bytes("large.txt", b"x" * (2 * 1024 * 1024))),
            session,
            project_id,
        ))

    assert session.query(Scan).count() == 0
    assert list((tmp_path / "uploads").iterdir()) == []


def test_oversized_upload_is_bounded_and_does_not_create_scan(db, tmp_path, monkeypatch):
    session, project_id = db
    service = IngestionService(os.fspath(tmp_path / "uploads"))
    monkeypatch.setattr(ingestion_module, "MAX_FILE_SIZE", 8)
    upload = AsyncUpload(b"x" * 100)

    with pytest.raises(HTTPException, match="50MB limit"):
        asyncio.run(service.ingest_zip(upload, session, project_id))

    assert max(upload.read_sizes) <= 9
    assert session.query(Scan).count() == 0
    assert list((tmp_path / "uploads").iterdir()) == []


def test_git_ingestion_uses_requested_branch(db, tmp_path, monkeypatch):
    session, project_id = db
    service = IngestionService(os.fspath(tmp_path / "uploads"))
    monkeypatch.setattr(service, "validate_repo_url", lambda url: None)
    commands = []

    def fake_run(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(subprocess, "run", fake_run)

    scan = asyncio.run(service.ingest_git(
        "https://example.test/repo.git", session, project_id, "release/1.0",
    ))

    assert scan.status == "PENDING"
    assert commands == [[
        "git", "clone", "--depth=1", "--branch", "release/1.0",
        "https://example.test/repo.git", ".",
    ]]


def test_failed_git_clone_cleans_up_scan_and_directory(db, tmp_path, monkeypatch):
    session, project_id = db
    service = IngestionService(os.fspath(tmp_path / "uploads"))
    monkeypatch.setattr(service, "validate_repo_url", lambda url: None)

    def fake_run(command, **kwargs):
        return subprocess.CompletedProcess(command, 128, "", "repository not found")

    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(HTTPException, match="Failed to clone repository"):
        asyncio.run(service.ingest_git("https://example.test/repo.git", session, project_id))

    assert session.query(Scan).count() == 0
    assert list((tmp_path / "uploads").iterdir()) == []
