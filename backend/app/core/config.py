import os
import tempfile
from pathlib import Path

from pydantic_settings import BaseSettings

# The API is started from the backend/ directory, so a relative ".env" would
# look for backend/.env and silently ignore the repository-root file. Resolve
# the root once so local runs and the documented setup read the same config.
REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    PROJECT_NAME: str = "Security Vulnerability Scanner"
    DATABASE_URL: str = "postgresql://svs_user:svs_password@db:5432/svs_database"
    # Local dev uploads live under the project instead of the system temp dir:
    # scanners recurse the scan directory, and the system temp folder holds
    # unrelated caches that can make a scan hang or slow. A deploy can still
    # override DATABASE_URL / UPLOAD_DIR per environment.
    UPLOAD_DIR: str = str(REPO_ROOT / "backend" / "uploads")

    # Comma-separated, so a deploy can list several origins.
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Redis Configuration
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    class Config:
        env_file = str(REPO_ROOT / ".env")
        # The root .env also carries Compose-only values (POSTGRES_*,
        # FRONTEND_API_URL). They are not API settings, but they must not make
        # Settings fail validation.
        extra = "ignore"

settings = Settings()
