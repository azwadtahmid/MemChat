"""Which dependency is failing, named precisely.

check() probes Qdrant, Groq and the embedding model. require() fails an
endpoint early with only the problems that endpoint cares about, and run()
re-checks after a failure so a service that died mid-request is still named.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any

import httpx
from fastapi.concurrency import run_in_threadpool

import embeddings
import groq_client
import store
from config import settings
from errors import AppError, Problem, ServiceUnavailable

log = logging.getLogger("memchat")

QDRANT, GROQ, EMBEDDINGS = "qdrant", "groq", "embeddings"
CHAT_MODEL, TRANSCRIBE_MODEL = "groq_chat_model", "groq_transcribe_model"
QDRANT_URL = f"http://{settings.qdrant_host}:{settings.qdrant_port}"

# The Groq probe is a real API call, so its result is reused briefly.
_GROQ_CACHE_SECONDS = 15
_groq_cache: tuple[float, dict[str, Problem]] | None = None


async def _probe_qdrant() -> Problem | None:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            (await client.get(f"{QDRANT_URL}/collections")).raise_for_status()
    except httpx.HTTPError:
        return Problem("qdrant", f"Qdrant is not reachable at {QDRANT_URL}",
                       "Start it from knowledge/mem0/docker with: docker compose up -d")
    try:
        await run_in_threadpool(store.ensure_collection)
    except Exception as exc:
        log.exception("could not prepare the notes collection")
        return Problem("qdrant", "Qdrant is running but the notes collection could not be prepared", str(exc)[:200])
    return None


async def _probe_groq() -> dict[str, Problem]:
    global _groq_cache
    rate_limit = groq_client.rate_limit_problem()
    if rate_limit:
        return {GROQ: rate_limit}
    if _groq_cache and time.time() - _groq_cache[0] < _GROQ_CACHE_SECONDS:
        return _groq_cache[1]
    problems = await run_in_threadpool(groq_client.check)
    _groq_cache = (time.time(), problems)
    return problems


def _probe_embeddings() -> Problem | None:
    if embeddings.last_error:
        return Problem("embeddings", "The embedding model could not be loaded",
                       "It downloads from Hugging Face on first use, so check your connection. Details are in the backend log.")
    return None


async def check() -> dict:
    qdrant, groq = await asyncio.gather(_probe_qdrant(), _probe_groq())
    problems = {k: p for k, p in ((QDRANT, qdrant), (EMBEDDINGS, _probe_embeddings())) if p}
    problems.update(groq)
    return {
        "services": {
            "qdrant": "down" if qdrant else "up",
            "groq": "down" if GROQ in groq else "up",
            "groq_chat_model": "unknown" if GROQ in groq else "missing" if CHAT_MODEL in groq else "available",
            "groq_transcribe_model": "unknown" if GROQ in groq else "missing" if TRANSCRIBE_MODEL in groq else "available",
            "embeddings": "error" if EMBEDDINGS in problems else
                          "loaded" if embeddings.is_loaded() else
                          "downloaded" if embeddings.is_cached() else "not_downloaded",
        },
        "problems": problems,
    }


async def require(*needs: str) -> None:
    status = await check()
    if problems := [p for k, p in status["problems"].items() if k in needs]:
        raise ServiceUnavailable(problems)


async def run(needs: tuple[str, ...], fn: Callable[..., Any], *args, **kwargs) -> Any:
    """Run a blocking store/Groq call off the event loop, naming any service that failed."""
    try:
        return await run_in_threadpool(fn, *args, **kwargs)
    except AppError:
        raise
    except Exception as exc:
        status = await check()
        if problems := [p for k, p in status["problems"].items() if k in needs]:
            log.warning("call failed because a service is down: %s", exc)
            raise ServiceUnavailable(problems) from exc
        raise


READ = (QDRANT,)
WRITE = (QDRANT, EMBEDDINGS)  # every content write re-embeds the note
AUDIO = (QDRANT, EMBEDDINGS, GROQ, TRANSCRIBE_MODEL)
TRANSCRIBE = (GROQ, TRANSCRIBE_MODEL)
CHAT = (QDRANT, EMBEDDINGS, GROQ, CHAT_MODEL)
