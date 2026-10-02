from pydantic import BaseModel


class ProjectCreate(BaseModel):
    name: str
    repo_url: str

class ProjectOut(BaseModel):
    id: int
    name: str
    repo_url: str
    owner_id: int

    class Config:
        from_attributes = True
