from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# ponytail: SQLite replaces PostgreSQL per SVS-Docker-Free-Workflow.pdf
# One file svs.db; no broker, no install.
engine = create_engine(
    "sqlite:///svs.db",
    connect_args={"check_same_thread": False, "timeout": 30},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
