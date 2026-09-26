"""Who is calling: the X-User-Id header, and signed URLs for audio.

The user id is the only credential in the system, so it travels in a header,
never in a URL, where it would end up in access logs, browser history and
proxies. There is no query-parameter fallback.
"""

import base64
import hashlib
import hmac
import secrets
import time
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header

from config import settings


def _user_id(x_user_id: Annotated[UUID, Header(alias="X-User-Id")]) -> str:
    # Typed as UUID: a missing, empty or malformed header is a 422 before any
    # handler runs.
    return str(x_user_id)


UserId = Annotated[str, Depends(_user_id)]


# ---------- Signed audio URLs ----------
# <audio src> cannot send headers, so audio is fetched with a short-lived token.
# The token is an HMAC over (note id, owner id, expiry). The owner id is part of
# the signature but not of the URL; the server looks the note up and recomputes.

_SECRET = settings.audio_token_secret.get_secret_value().encode() or secrets.token_bytes(32)


def _signature(note_id: str, owner_id: str, expires: int) -> str:
    mac = hmac.new(_SECRET, f"{note_id}:{owner_id}:{expires}".encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac).decode().rstrip("=")


def audio_url(note_id: str, owner_id: str) -> str:
    expires = int(time.time()) + settings.audio_token_ttl_seconds
    return f"/notes/{note_id}/audio?expires={expires}&sig={_signature(note_id, owner_id, expires)}"


def audio_token_valid(note_id: str, owner_id: str, expires: int, sig: str) -> bool:
    if expires < time.time():
        return False
    return hmac.compare_digest(sig, _signature(note_id, owner_id, expires))
