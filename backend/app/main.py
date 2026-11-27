import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from .api import projects, scans
from .core.config import settings
from .database import engine
from .engine.tasks import recover_stale_scans
from .models.base import Base


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Scans are queued in-process, so anything left PENDING/RUNNING belongs to
    # a previous process and can never complete.
    recover_stale_scans()
    yield


app = FastAPI(title="Security Vulnerability Scanner (SVS) API", lifespan=lifespan)

# Create tables on startup (Alembic handles migrations for existing DBs).
# For fresh databases, create_all ensures tables exist before migrations run.
Base.metadata.create_all(bind=engine)

# Run Alembic migrations to apply any pending schema changes.
try:
    from alembic.config import Config
    from alembic import command
    alembic_cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    command.upgrade(alembic_cfg, "head")
except Exception as e:
    # Fall back to manual ALTER TABLE for environments without Alembic installed.
    # SQLite does not support ADD COLUMN IF NOT EXISTS, so check first.
    try:
        with engine.begin() as conn:
            existing_columns = {column["name"] for column in inspect(conn).get_columns("findings")}
            if "triage_status" not in existing_columns:
                conn.execute(text(
                    "ALTER TABLE findings ADD COLUMN triage_status VARCHAR(16) NOT NULL DEFAULT 'open'"
                ))
            if "cwe" not in existing_columns:
                conn.execute(text("ALTER TABLE findings ADD COLUMN cwe VARCHAR(16)"))
            scan_columns = {column["name"] for column in inspect(conn).get_columns("scans")}
            if "warning_detail" not in scan_columns:
                conn.execute(text("ALTER TABLE scans ADD COLUMN warning_detail TEXT"))
    except Exception as fallback_err:
        print(f"Migration fallback failed: {fallback_err}")

# ponytail: serve built React UI from frontend/dist; no nginx/port 3000 per PDF
frontend_dist = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")

# Origins come from settings so a deploy does not need a code change to allow
# its own domain. An empty list still permits same-origin requests.
origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(projects.router)
app.include_router(scans.router)

@app.get("/")
async def root():
    return {"message": "Welcome to the SVS API", "status": "online"}

@app.get("/health")
def health_check():
    # A process that is listening is not necessarily a process that can read
    # its database. Report the dependency, so a broken install is visible
    # instead of a green check over a server that fails every request.
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "healthy"}

if os.path.isdir(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")
