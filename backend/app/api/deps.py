from fastapi import Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User

LOCAL_USERNAME = "local"


async def get_local_user(db: Session = Depends(get_db)) -> User:
    """Resolve the single operator of this instance.

    Auth was removed: SVS runs on the operator's own laptop and is not exposed
    publicly, so there is nothing to authenticate against. The users table
    survives because Project.owner_id has a non-nullable FK to it, and the
    historical projects and scans are worth more than a clean schema.

    The row is deterministic: every request resolves to the same local user, so
    new projects get a stable owner and the rate limiter still has one key.
    """
    user = db.query(User).filter(User.username == LOCAL_USERNAME).first()
    if user is None:
        # A fresh database has no users at all, so the local row has to be
        # created before anything can reference it. The password is unusable
        # noise: no endpoint ever checks it.
        user = User(
            username=LOCAL_USERNAME,
            email="local@svs.local",
            hashed_password="!",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user
