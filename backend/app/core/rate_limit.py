import redis
from fastapi import HTTPException, status
from .config import settings

# Initialize Redis client
redis_client = redis.Redis(
    host=settings.REDIS_HOST,
    port=settings.REDIS_PORT,
    decode_responses=True
)

def check_rate_limit(user_id: int, limit: int = 5, period: int = 3600):
    """
    Checks if a user has exceeded their scan limit for the current period.
    limit: Max number of allowed requests.
    period: Time window in seconds (default 1 hour).
    """
    key = f"rate_limit:user_{user_id}"

    # Use Redis pipeline for atomicity
    pipe = redis_client.pipeline()
    pipe.incr(key)
    pipe.ttl(key)
    results = pipe.execute()

    count = results[0]
    ttl = results[1]

    # Set expiration if it's a new key
    if ttl == -1:
        redis_client.expire(key, period)

    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Scan limit exceeded. You can only perform {limit} scans per hour."
        )
