import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool

import health
import store
from config import settings
from errors import register
from chat.routes import router as chat_router
from routes_notes import router as notes_router

logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s: %(message)s")
log = logging.getLogger("memchat")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Prepare the collection and purge trash older than the retention period.
    # If Qdrant is down now, the server still starts; ensure_collection() runs
    # (and purges) on the first request that reaches Qdrant.
    try:
        await run_in_threadpool(store.ensure_collection)
    except Exception as exc:
        log.warning("Qdrant not ready at startup, will retry on first request: %s", exc)
    yield


app = FastAPI(title="MemChat", lifespan=lifespan)
register(app)
# Every header request() in the frontend sends must be listed, or the browser's
# preflight rejects the call. Audio plays through a plain <audio src>, which
# needs no CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["X-User-Id", "X-Client-Date", "Content-Type"],
)
app.include_router(notes_router)
app.include_router(chat_router)


@app.get("/health")
async def get_health():
    """Which dependency is failing, if any. Needs no user id: it reads no user data."""
    status = await health.check()
    return {
        "ok": not status["problems"],
        "services": status["services"],
        "problems": [vars(p) for p in status["problems"].values()],
        "config": {
            "chat_model": settings.groq_chat_model,
            "transcribe_model": settings.groq_transcribe_model,
            "embed_model": settings.embed_model,
            "collection": settings.notes_collection,
            "trash_retention_days": settings.trash_retention_days,
            "audio_notes": settings.audio_notes,
        },
    }
