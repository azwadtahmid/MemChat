"""Local text embeddings with fastembed (BAAI/bge-small-en-v1.5, 384 dims).

The model (about 67 MB) is downloaded from Hugging Face on first use and cached
in settings.embed_cache_dir. After that, embedding needs no network.
"""

import logging
import threading

from fastembed import TextEmbedding

from config import settings

log = logging.getLogger("memchat")

_model: TextEmbedding | None = None
_lock = threading.Lock()
last_error: str | None = None


def _get() -> TextEmbedding:
    global _model, last_error
    with _lock:
        if _model is None:
            try:
                _model = TextEmbedding(settings.embed_model, cache_dir=str(settings.embed_cache_dir))
                last_error = None
            except Exception as exc:
                last_error = str(exc)
                raise
        return _model


def is_loaded() -> bool:
    return _model is not None


def is_cached() -> bool:
    return settings.embed_cache_dir.exists() and any(settings.embed_cache_dir.rglob("*.onnx"))


def note_text(title: str, body: str) -> str:
    """What gets embedded for a note: the title carries a lot of meaning."""
    return f"{title}\n\n{body}".strip()


def embed_note(title: str, body: str) -> list[float]:
    return next(iter(_get().passage_embed([note_text(title, body)]))).tolist()


def embed_query(text: str) -> list[float]:
    return next(iter(_get().query_embed(text))).tolist()
