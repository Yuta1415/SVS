from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from datetime import datetime
from .base import Base

class Finding(Base):
    __tablename__ = "findings"

    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=False)
    vulnerability_type = Column(String, nullable=False) # e.g., "SQL Injection", "XSS"
    severity = Column(String, nullable=False) # INFO, LOW, MEDIUM, HIGH, CRITICAL
    file_path = Column(String, nullable=False)
    line_number = Column(Integer, nullable=True)
    description = Column(Text, nullable=False)
    remediation = Column(Text, nullable=True)
    # The weakness class, when the reporting tool names one (CWE-79, CWE-798,
    # ...). It is how remediation text survives a tool that ships none.
    cwe = Column(String(16), nullable=True)
    # ponytail: triage is persisted rather than held in client state, so a
    # reload keeps it. Default 'open' keeps every pre-existing finding visible.
    triage_status = Column(String(16), nullable=False, default="open")
    created_at = Column(DateTime, default=datetime.utcnow)

    scan = relationship("Scan", back_populates="findings")
