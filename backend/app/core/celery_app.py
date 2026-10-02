from celery import Celery
from .config import settings

# Configure Celery
# Broker: Redis (used to send the task)
# Backend: Redis (used to store the task result)
celery_app = Celery(
    "svs_worker",
    broker=f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/0",
    backend=f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}/0",
    include=["app.engine.tasks"]
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
)
