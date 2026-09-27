from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    # Read backend/.env regardless of which directory uvicorn is started from.
    # Unknown keys (such as the old OLLAMA_* and QDRANT_COLLECTION lines from the
    # mem0 version) are ignored.
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # ---------- Groq ----------
    groq_api_key: SecretStr = SecretStr("")
    groq_base_url: str = "https://api.groq.com/openai/v1"
    groq_chat_model: str = "openai/gpt-oss-120b"
    groq_transcribe_model: str = "whisper-large-v3"

    # ---------- Qdrant ----------
    # A full URL, so a hosted Qdrant Cloud endpoint works. Unset or empty means
    # the local Docker Qdrant, with no API key.
    qdrant_url: str = ""
    qdrant_api_key: str = ""
    # New names on purpose: QDRANT_COLLECTION and EMBEDDING_DIMS in an existing
    # .env still point at the old 768-dim mem0 collection.
    notes_collection: str = "notes"

    # ---------- Embeddings (fastembed, local, no Ollama) ----------
    embed_model: str = "BAAI/bge-small-en-v1.5"
    embed_dims: int = 384
    # fastembed defaults to the temp folder, which Windows cleanup can empty.
    embed_cache_dir: Path = BACKEND_DIR / ".model_cache"

    # ---------- Audio ----------
    # Local disk for now. Needs object storage before deploying to Render,
    # whose disk is wiped on every deploy and restart.
    audio_dir: Path = BACKEND_DIR / "audio_files"
    audio_max_mb: int = 25
    # Signs the short-lived audio URLs. If empty, a random secret is made at
    # startup, so links stop working when the backend restarts.
    audio_token_secret: SecretStr = SecretStr("")
    audio_token_ttl_seconds: int = 900

    # ---------- Behaviour ----------
    trash_retention_days: int = 30
    search_limit: int = 8
    chat_max_tool_rounds: int = 6
    # gpt-oss reasons before answering; its reasoning tokens count against Groq's
    # per-minute token limit, so keep it low unless answers need more thought.
    chat_reasoning_effort: str = "low"
    chat_search_limit: int = 5
    chat_history_messages: int = 40


settings = Settings()
