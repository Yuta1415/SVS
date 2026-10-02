from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .api import projects, scans
from .core.config import settings
from .database import engine
from .models.base import Base

# Create tables on startup (Initial Migration)
Base.metadata.create_all(bind=engine)

# create_all will not ALTER an existing table, so schema changes since the
# initial release are applied here, idempotently. ADD COLUMN IF NOT EXISTS is
# a no-op on an already-migrated database.
with engine.begin() as conn:
    conn.execute(
        text("ALTER TABLE findings ADD COLUMN IF NOT EXISTS triage_status VARCHAR(16) NOT NULL DEFAULT 'open'")
    )
    conn.execute(
        text("ALTER TABLE findings ADD COLUMN IF NOT EXISTS cwe VARCHAR(16)")
    )

app = FastAPI(title="Security Vulnerability Scanner (SVS) API")

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
async def health_check():
    return {"status": "healthy"}
