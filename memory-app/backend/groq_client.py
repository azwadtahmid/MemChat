"""Groq, through the openai SDK (Groq's API is OpenAI-compatible).

Every Groq failure is turned into a named Problem here, so no other module
needs to know about openai exception types.
"""

import logging
import time

import openai
from openai import AsyncOpenAI, OpenAI

from config import settings
from errors import Problem, ServiceUnavailable

log = logging.getLogger("memchat")

_client: OpenAI | None = None

# Set when Groq answers 429; /health reports it until it expires.
rate_limited_until: float | None = None


def key_missing() -> bool:
    return not settings.groq_api_key.get_secret_value().strip()


def client() -> OpenAI:
    global _client
    if key_missing():
        raise ServiceUnavailable([missing_key_problem()])
    if _client is None:
        _client = OpenAI(
            api_key=settings.groq_api_key.get_secret_value(),
            base_url=settings.groq_base_url,
            timeout=60,
            max_retries=1,
        )
    return _client


_async_client: AsyncOpenAI | None = None


def async_client() -> AsyncOpenAI:
    """For streaming chat completions."""
    global _async_client
    if key_missing():
        raise ServiceUnavailable([missing_key_problem()])
    if _async_client is None:
        _async_client = AsyncOpenAI(
            api_key=settings.groq_api_key.get_secret_value(),
            base_url=settings.groq_base_url,
            timeout=60,
            max_retries=1,
        )
    return _async_client


def missing_key_problem() -> Problem:
    return Problem("groq", "GROQ_API_KEY is not set", "Add GROQ_API_KEY=... to memory-app/backend/.env, then restart the backend.")


def rate_limit_problem() -> Problem | None:
    if rate_limited_until and rate_limited_until > time.time():
        wait = int(rate_limited_until - time.time()) + 1
        return Problem("groq", "Groq is rate limiting requests", f"Try again in about {wait} seconds.")
    return None


def problem_from(exc: Exception) -> Problem:
    """Map an openai/Groq exception to a readable Problem."""
    global rate_limited_until
    if isinstance(exc, ServiceUnavailable):
        return exc.problems[0]
    if isinstance(exc, openai.RateLimitError):
        retry_after = exc.response.headers.get("retry-after") if exc.response is not None else None
        try:
            seconds = float(retry_after) if retry_after else 30.0
        except ValueError:
            seconds = 30.0
        rate_limited_until = time.time() + seconds
        return rate_limit_problem()  # type: ignore[return-value]
    if isinstance(exc, openai.AuthenticationError):
        return Problem("groq", "Groq rejected the API key", "Check GROQ_API_KEY in memory-app/backend/.env.")
    if isinstance(exc, (openai.APIConnectionError, openai.APITimeoutError)):
        return Problem("groq", "Groq is unreachable", "Check your internet connection.")
    if isinstance(exc, openai.APIStatusError):
        return Problem("groq", f"Groq returned an error (HTTP {exc.status_code})", "Details are in the backend log.")
    return Problem("groq", "The request to Groq failed", "Details are in the backend log.")


def check() -> Problem | None:
    """Health probe: can we reach Groq with this key right now?"""
    if key_missing():
        return missing_key_problem()
    if problem := rate_limit_problem():
        return problem
    try:
        client().models.list()
        return None
    except Exception as exc:
        log.warning("Groq health check failed: %s", exc)
        return problem_from(exc)


def transcribe(filename: str, data: bytes) -> str:
    try:
        result = client().audio.transcriptions.create(
            file=(filename, data), model=settings.groq_transcribe_model, response_format="json"
        )
    except Exception as exc:
        log.exception("transcription failed")
        raise ServiceUnavailable([problem_from(exc)]) from exc
    return (result.text or "").strip()
