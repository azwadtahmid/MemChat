"""Notes, trash and audio endpoints.

Every JSON endpoint takes the caller from the X-User-Id header (UserId).
GET /notes/{id}/audio is the one exception: it is authorised by a signed,
short-lived token in its URL, because <audio src> cannot send headers.
"""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Header, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import groq_client
import health
import store
from config import settings
from errors import AppError, Problem, audio_unavailable, bad_request, not_found
from identity import UserId, audio_token_valid, audio_url

router = APIRouter()

NoteType = Literal["text", "list", "diary", "audio"]
WritableType = Literal["text", "list", "diary"]  # audio notes are created by upload


def client_today(x_client_date: Annotated[str | None, Header(alias="X-Client-Date")] = None) -> date:
    """The caller's local date, so diary entries follow their day, not the server's."""
    if x_client_date:
        try:
            return date.fromisoformat(x_client_date)
        except ValueError:
            raise bad_request("X-Client-Date must look like 2026-09-26") from None
    return date.today()



def _recording_exists(relative: str) -> bool:
    try:
        return store.audio_file(relative).exists()
    except AppError:
        return False


def present(note: dict) -> dict:
    """What clients see: no owner id, no internal file path, undo as a flag."""
    out = {k: v for k, v in note.items() if k not in ("user_id", "audio_path", "previous_body")}
    out["has_undo"] = note.get("previous_body") is not None
    if note.get("type") == "audio" and note.get("audio_path") and not note.get("deleted"):
        # A recording lost with an ephemeral disk gets no link, so the editor can
        # say so instead of showing a player that silently fails.
        if _recording_exists(note["audio_path"]):
            out["audio_url"] = audio_url(note["id"], note["user_id"])
    return out


# ---------- Request bodies ----------


Tags = Annotated[list[Annotated[str, Field(max_length=64)]], Field(max_length=store.MAX_TAGS)]


class NoteIn(BaseModel):
    type: WritableType
    title: str = Field("", max_length=300)
    body: str = Field("", max_length=100_000)
    tags: Tags = Field(default_factory=list)


class NoteUpdate(BaseModel):
    title: str | None = Field(None, max_length=300)
    body: str | None = Field(None, max_length=100_000)
    # The note's "updated" value when the editor loaded it; a mismatch is a 409.
    expected_updated: str | None = None


class AppendIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


class NoteFilters(BaseModel):
    # A POST body rather than query parameters, so tags and search text stay out
    # of URLs and access logs.
    type: NoteType | None = None
    tags: Tags = Field(default_factory=list)  # a note must carry all of them
    created_from: datetime | None = None  # inclusive
    created_to: datetime | None = None  # exclusive

    def range(self) -> dict:
        if self.created_from and self.created_to and self.created_from >= self.created_to:
            raise bad_request("The start of the date range must be before its end")
        return {"tags": self.tags, "created_from": self.created_from, "created_to": self.created_to}


class SearchIn(NoteFilters):
    query: str = Field(min_length=1, max_length=500)


class TagsIn(BaseModel):
    tags: Tags


class PinIn(BaseModel):
    pinned: bool


# ---------- Notes ----------


@router.get("/notes")
async def list_notes(user_id: UserId, type: NoteType | None = None):
    await health.require(*health.READ)
    notes = await health.run(health.READ, store.list_notes, user_id, type)
    return {"notes": [present(n) for n in notes]}


@router.post("/notes/list")
async def list_notes_filtered(body: NoteFilters, user_id: UserId):
    """The notes list narrowed by tags and a created-date range: exact filters, no similarity search."""
    filters = body.range()
    await health.require(*health.READ)
    notes = await health.run(health.READ, store.list_notes, user_id, body.type, **filters)
    return {"notes": [present(n) for n in notes]}


@router.post("/notes/search")
async def search_notes(body: SearchIn, user_id: UserId):
    filters = body.range()
    await health.require(*health.WRITE)
    notes = await health.run(health.WRITE, store.search, user_id, body.query, body.type, **filters)
    return {"notes": [present(n) for n in notes]}


@router.post("/notes", status_code=201)
async def create_note(body: NoteIn, user_id: UserId,
                      x_client_date: Annotated[str | None, Header(alias="X-Client-Date")] = None):
    await health.require(*health.WRITE)
    note, appended = await health.run(
        health.WRITE, store.create, user_id, body.type, body.title, body.body,
        today=client_today(x_client_date), tags=body.tags,
    )
    return {"note": present(note), "appended_to_existing": appended}


@router.get("/notes/{note_id}")
async def get_note(note_id: str, user_id: UserId):
    await health.require(*health.READ)
    return {"note": present(await health.run(health.READ, store.get, user_id, note_id))}


@router.put("/notes/{note_id}")
async def update_note(note_id: str, body: NoteUpdate, user_id: UserId):
    if body.title is None and body.body is None:
        raise bad_request("Nothing to update")
    await health.require(*health.WRITE)
    note = await health.run(
        health.WRITE, store.update, user_id, note_id,
        title=body.title, body=body.body, expected_updated=body.expected_updated,
    )
    return {"note": present(note)}


@router.put("/notes/{note_id}/tags")
async def set_tags(note_id: str, body: TagsIn, user_id: UserId):
    await health.require(*health.READ)
    return {"note": present(await health.run(health.READ, store.set_tags, user_id, note_id, body.tags))}


@router.put("/notes/{note_id}/pin")
async def set_pinned(note_id: str, body: PinIn, user_id: UserId):
    await health.require(*health.READ)
    return {"note": present(await health.run(health.READ, store.set_pinned, user_id, note_id, body.pinned))}


@router.post("/notes/{note_id}/append")
async def append_to_note(note_id: str, body: AppendIn, user_id: UserId):
    await health.require(*health.WRITE)
    return {"note": present(await health.run(health.WRITE, store.append, user_id, note_id, body.text))}


@router.post("/notes/{note_id}/undo")
async def undo_note(note_id: str, user_id: UserId):
    await health.require(*health.WRITE)
    return {"note": present(await health.run(health.WRITE, store.undo, user_id, note_id))}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user_id: UserId):
    """Soft delete: the note moves to the trash."""
    await health.require(*health.READ)
    return {"note": present(await health.run(health.READ, store.soft_delete, user_id, note_id))}


# ---------- Trash ----------


@router.get("/trash")
async def list_trash(user_id: UserId):
    await health.require(*health.READ)
    notes = await health.run(health.READ, store.list_notes, user_id, deleted=True)
    return {"notes": [present(n) for n in notes], "retention_days": settings.trash_retention_days}


@router.post("/trash/{note_id}/restore")
async def restore_note(note_id: str, user_id: UserId):
    await health.require(*health.READ)
    return {"note": present(await health.run(health.READ, store.restore, user_id, note_id))}


@router.delete("/trash/{note_id}")
async def purge_note(note_id: str, user_id: UserId):
    """Permanent delete: removes the Qdrant point and any audio file."""
    await health.require(*health.READ)
    await health.run(health.READ, store.purge, user_id, note_id)
    return {"deleted": True}


# ---------- Audio ----------

AUDIO_TYPES = {
    "audio/webm": ".webm", "video/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a",
    "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav",
}


async def _read_audio(file: UploadFile) -> tuple[str, bytes]:
    base_type = (file.content_type or "").split(";")[0].strip().lower()
    suffix = AUDIO_TYPES.get(base_type)
    if not suffix:
        raise bad_request(f"Unsupported audio format {base_type or 'unknown'}")
    data = await file.read(settings.audio_max_mb * 1024 * 1024 + 1)
    if len(data) > settings.audio_max_mb * 1024 * 1024:
        raise bad_request(f"Recordings can be at most {settings.audio_max_mb} MB")
    if not data:
        raise bad_request("The recording is empty")
    return suffix, data


@router.post("/notes/audio", status_code=201)
async def create_audio_note(
    user_id: UserId,
    file: Annotated[UploadFile, File()],
    title: Annotated[str, Form(max_length=300)] = "",
    x_client_date: Annotated[str | None, Header(alias="X-Client-Date")] = None,
):
    """Save the recording, transcribe it with Whisper on Groq, and store the transcript as the note body."""
    if not settings.audio_notes:
        raise audio_unavailable()
    await health.require(*health.AUDIO)
    suffix, data = await _read_audio(file)
    today = client_today(x_client_date)
    note_id = str(uuid.uuid4())
    relative = store.save_audio(user_id, note_id, suffix, data)
    try:
        transcript = await health.run(health.AUDIO, groq_client.transcribe, f"recording{suffix}", data)
        note, _ = await health.run(
            health.AUDIO, store.create, user_id, "audio",
            title or f"Audio note, {today.day} {today:%B %Y}", transcript,
            today=today, note_id=note_id, audio_path=relative,
        )
    except Exception:
        store.audio_file(relative).unlink(missing_ok=True)
        raise
    return {"note": present(note)}


@router.get("/notes/{note_id}/audio")
async def get_audio(note_id: str, expires: Annotated[int, Query()], sig: Annotated[str, Query(max_length=100)]):
    """Serve a recording. Authorised by the signed URL from GET /notes/{id}, not by X-User-Id."""
    await health.require(*health.READ)
    payload = await health.run(health.READ, store.owner_of, note_id)
    if not payload or not payload.get("audio_path") or payload.get("deleted"):
        raise not_found()
    if not audio_token_valid(note_id, payload["user_id"], expires, sig):
        raise AppError(403, "link_expired",
                       [Problem("notes", "This audio link has expired", "Reopen the note to get a fresh link.")])
    path = store.audio_file(payload["audio_path"])
    if not path.exists():
        raise not_found()
    media = {".webm": "audio/webm", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav"}
    return FileResponse(path, media_type=media.get(path.suffix, "application/octet-stream"))


@router.post("/transcribe")
async def transcribe(user_id: UserId, file: Annotated[UploadFile, File()]):
    """Voice input for the chat: returns text only and stores nothing."""
    await health.require(*health.TRANSCRIBE)
    suffix, data = await _read_audio(file)
    text = await health.run(health.TRANSCRIBE, groq_client.transcribe, f"voice{suffix}", data)
    return {"text": text}
