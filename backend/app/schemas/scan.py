from datetime import datetime

from pydantic import BaseModel


class ScanOut(BaseModel):
    id: int
    project_id: int
    status: str
    created_at: datetime | None = None
    score: int | None = None
    error_detail: str | None = None
    # The dashboard aggregates severity totals across every scan in one request,
    # so the counts travel with the scan instead of needing a findings call each.
    critical_count: int | None = 0
    high_count: int | None = 0
    medium_count: int | None = 0
    low_count: int | None = 0

    class Config:
        from_attributes = True
