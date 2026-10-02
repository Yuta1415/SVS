from datetime import datetime
from typing import Optional
from pydantic import BaseModel

class ScanOut(BaseModel):
    id: int
    project_id: int
    status: str
    created_at: Optional[datetime] = None
    score: Optional[int] = None
    error_detail: Optional[str] = None
    # The dashboard aggregates severity totals across every scan in one request,
    # so the counts travel with the scan instead of needing a findings call each.
    critical_count: Optional[int] = 0
    high_count: Optional[int] = 0
    medium_count: Optional[int] = 0
    low_count: Optional[int] = 0

    class Config:
        from_attributes = True
