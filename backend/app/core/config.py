from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Security Vulnerability Scanner"
    DATABASE_URL: str = "postgresql://svs_user:svs_password@db:5432/svs_database"
    UPLOAD_DIR: str = "/tmp/svs_uploads"

    # Comma-separated, so a deploy can list several origins.
    CORS_ORIGINS: str = "http://localhost:3000"

    # Redis Configuration
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    class Config:
        env_file = ".env"

settings = Settings()
