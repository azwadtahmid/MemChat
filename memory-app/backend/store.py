"""All Qdrant access for notes.

Every public function takes user_id and filters by it, and fetching a note by
id also checks its owner. There is no function that reads across users except
purge_expired(), which only deletes.

One point per note. Payload:
  user_id, type, title, body, created, updated,
  deleted, deleted_at, previous_body, audio_path (audio notes),
  entry_date (diary notes: the calendar day the entry belongs to)
"""

import logging
import re
import threading
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from qdrant_client import QdrantClient, models

import embeddings
from config import settings
from errors import bad_request, conflict, not_found

log = logging.getLogger("memchat")

NOTE_TYPES = ("text", "list", "diary", "audio")
COLLECTION = settings.notes_collection

_client: QdrantClient | None = None
_lock = threading.Lock()
_ready = False


def qdrant_url() -> str:
    return settings.qdrant_url.strip() or "http://localhost:6333"


def client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(url=qdrant_url(), api_key=settings.qdrant_api_key or None, timeout=5)
    return _client


def ensure_collection() -> None:
    """Create the collection and payload indexes once, then purge old trash."""
    global _ready
    if _ready:
        return
    with _lock:
        if _ready:
            return
        c = client()
        if not c.collection_exists(COLLECTION):
            c.create_collection(
                COLLECTION,
                vectors_config=models.VectorParams(size=settings.embed_dims, distance=models.Distance.COSINE),
            )
            log.info("created Qdrant collection %r", COLLECTION)
        else:
            size = c.get_collection(COLLECTION).config.params.vectors.size  # type: ignore[union-attr]
            if size != settings.embed_dims:
                raise RuntimeError(
                    f"Collection {COLLECTION!r} has {size}-dim vectors but the embedding model makes {settings.embed_dims}"
                )
        # Indexes make these filters exact lookups rather than scans.
        for field, schema in (
            ("user_id", models.PayloadSchemaType.KEYWORD),
            ("type", models.PayloadSchemaType.KEYWORD),
            ("deleted", models.PayloadSchemaType.BOOL),
            ("deleted_at", models.PayloadSchemaType.DATETIME),
            ("entry_date", models.PayloadSchemaType.KEYWORD),
        ):
            c.create_payload_index(COLLECTION, field, field_schema=schema)
        _ready = True
    purged = purge_expired()
    if purged:
        log.info("purged %d note(s) that had been in the trash for over %d days", purged, settings.trash_retention_days)


# ---------- Helpers ----------


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def diary_title(day: date) -> str:
    return f"{day:%A} {day.day} {day:%B %Y}"


def _match(key: str, value) -> models.FieldCondition:
    return models.FieldCondition(key=key, match=models.MatchValue(value=value))


def _owner_filter(user_id: str, *, deleted: bool | None = False, note_type: str | None = None,
                  extra: list[models.Condition] | None = None) -> models.Filter:
    must: list[models.Condition] = [_match("user_id", user_id)]
    if deleted is not None:
        must.append(_match("deleted", deleted))
    if note_type:
        must.append(_match("type", note_type))
    return models.Filter(must=must + (extra or []))


def _note(point_id, payload: dict) -> dict:
    return {"id": str(point_id), **payload}


def _point(user_id: str, note_id: str, *, include_deleted: bool = False) -> models.Record:
    try:
        uuid.UUID(note_id)
    except ValueError:
        raise not_found() from None
    found = client().retrieve(COLLECTION, ids=[note_id], with_payload=True)
    if not found or found[0].payload.get("user_id") != user_id:
        raise not_found()
    if found[0].payload.get("deleted") and not include_deleted:
        raise not_found()
    return found[0]


def _scroll(flt: models.Filter, limit: int = 1000) -> list[models.Record]:
    points, offset = [], None
    while len(points) < limit:
        batch, offset = client().scroll(
            COLLECTION, scroll_filter=flt, limit=min(256, limit - len(points)), offset=offset, with_payload=True
        )
        points += batch
        if offset is None:
            break
    return points


LIST_LINE = re.compile(r"^\s*- \[( |x|X)\] ")


def as_list_lines(text: str) -> str:
    """Make appended text into checklist lines: "eggs" becomes "- [ ] eggs"."""
    lines = []
    for line in text.splitlines():
        if not line.strip():
            continue
        if LIST_LINE.match(line):
            lines.append(line.rstrip())
        else:
            lines.append("- [ ] " + re.sub(r"^\s*[-*]\s+", "", line).strip())
    return "\n".join(lines)


# ---------- Reads ----------


def get(user_id: str, note_id: str, *, include_deleted: bool = False) -> dict:
    p = _point(user_id, note_id, include_deleted=include_deleted)
    return _note(p.id, p.payload)


def list_notes(user_id: str, note_type: str | None = None, *, deleted: bool = False) -> list[dict]:
    notes = [_note(p.id, p.payload) for p in _scroll(_owner_filter(user_id, deleted=deleted, note_type=note_type))]
    key = "deleted_at" if deleted else "updated"
    return sorted(notes, key=lambda n: n.get(key) or "", reverse=True)


def search(user_id: str, query: str, note_type: str | None = None, limit: int | None = None) -> list[dict]:
    result = client().query_points(
        COLLECTION,
        query=embeddings.embed_query(query),
        query_filter=_owner_filter(user_id, deleted=False, note_type=note_type),
        limit=limit or settings.search_limit,
        with_payload=True,
    )
    return [{**_note(p.id, p.payload), "score": round(p.score, 3)} for p in result.points]


def today_diary(user_id: str, today: date) -> dict | None:
    found = _scroll(
        _owner_filter(user_id, note_type="diary", extra=[_match("entry_date", today.isoformat())]), limit=1
    )
    return _note(found[0].id, found[0].payload) if found else None


# ---------- Writes ----------


def _write(point: models.Record, *, title: str | None = None, body: str | None = None) -> dict:
    """The only code path that changes a note's content.

    If the body changes, the old body is saved to previous_body in the same
    upsert, so edit, append, undo and checkbox ticks are all undoable.
    """
    payload = dict(point.payload)
    new_title = payload["title"] if title is None else title
    new_body = payload["body"] if body is None else body
    if new_body != payload["body"]:
        payload["previous_body"] = payload["body"]
    payload.update(title=new_title, body=new_body, updated=now_iso())
    client().upsert(
        COLLECTION,
        points=[models.PointStruct(id=point.id, vector=embeddings.embed_note(new_title, new_body), payload=payload)],
    )
    return _note(point.id, payload)


def create(user_id: str, note_type: str, title: str, body: str, *, today: date,
           note_id: str | None = None, audio_path: str | None = None) -> tuple[dict, bool]:
    """Create a note. Returns (note, appended_to_existing).

    Diary notes are one per day: if today's entry exists, the text is appended
    to it instead, and diary titles are always the date.
    """
    if note_type not in NOTE_TYPES:
        raise bad_request(f"Unknown note type {note_type!r}")
    extra: dict = {}
    if note_type == "diary":
        if existing := today_diary(user_id, today):
            if not body.strip():
                return existing, True
            return append(user_id, existing["id"], body), True
        title = diary_title(today)
        extra["entry_date"] = today.isoformat()
    if note_type == "list" and body.strip():
        body = as_list_lines(body)
    if note_type == "audio":
        extra["audio_path"] = audio_path
    title = title.strip() or "Untitled"
    ts = now_iso()
    payload = {
        "user_id": user_id, "type": note_type, "title": title, "body": body,
        "created": ts, "updated": ts, "deleted": False, "deleted_at": None, "previous_body": None,
        **extra,
    }
    point_id = note_id or str(uuid.uuid4())
    client().upsert(
        COLLECTION, points=[models.PointStruct(id=point_id, vector=embeddings.embed_note(title, body), payload=payload)]
    )
    return _note(point_id, payload), False


def update(user_id: str, note_id: str, *, title: str | None = None, body: str | None = None,
           expected_updated: str | None = None) -> dict:
    point = _point(user_id, note_id)
    if expected_updated and point.payload["updated"] != expected_updated:
        raise conflict(point.payload["title"])
    if point.payload["type"] == "diary":
        title = None  # diary titles are always the entry's date
    return _write(point, title=title, body=body)


def append(user_id: str, note_id: str, text: str) -> dict:
    point = _point(user_id, note_id)
    if not text.strip():
        raise bad_request("There is nothing to append")
    if point.payload["type"] == "list":
        text = as_list_lines(text)
    current = point.payload["body"].rstrip("\n")
    return _write(point, body=f"{current}\n{text.strip(chr(10))}" if current else text.strip("\n"))


def undo(user_id: str, note_id: str) -> dict:
    """Swap body and previous_body. Undoing twice redoes."""
    point = _point(user_id, note_id)
    if point.payload.get("previous_body") is None:
        raise bad_request("There is nothing to undo for this note")
    return _write(point, body=point.payload["previous_body"])


def soft_delete(user_id: str, note_id: str) -> dict:
    point = _point(user_id, note_id)
    patch = {"deleted": True, "deleted_at": now_iso()}
    client().set_payload(COLLECTION, payload=patch, points=[point.id])
    return _note(point.id, {**point.payload, **patch})


def restore(user_id: str, note_id: str) -> dict:
    point = _point(user_id, note_id, include_deleted=True)
    if not point.payload.get("deleted"):
        raise bad_request("That note is not in the trash")
    patch = {"deleted": False, "deleted_at": None}
    client().set_payload(COLLECTION, payload=patch, points=[point.id])
    return _note(point.id, {**point.payload, **patch})


def purge(user_id: str, note_id: str) -> None:
    """Permanent delete. Only notes already in the trash can be purged."""
    point = _point(user_id, note_id, include_deleted=True)
    if not point.payload.get("deleted"):
        raise bad_request("Move the note to the trash before deleting it permanently")
    client().delete(COLLECTION, points_selector=models.PointIdsList(points=[point.id]))
    _remove_audio(point.payload.get("audio_path"))


def purge_expired() -> int:
    """Permanently delete notes that have been in the trash too long (all users)."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.trash_retention_days)
    old = _scroll(
        models.Filter(must=[
            _match("deleted", True),
            models.FieldCondition(key="deleted_at", range=models.DatetimeRange(lt=cutoff)),
        ]),
        limit=10_000,
    )
    if old:
        client().delete(COLLECTION, points_selector=models.PointIdsList(points=[p.id for p in old]))
        for p in old:
            _remove_audio(p.payload.get("audio_path"))
    return len(old)


# ---------- Audio files ----------


def audio_file(relative: str) -> Path:
    """Resolve a stored audio_path, refusing anything outside audio_dir."""
    root = settings.audio_dir.resolve()
    path = (root / relative).resolve()
    if root not in path.parents:
        raise not_found()
    return path


def save_audio(user_id: str, note_id: str, suffix: str, data: bytes) -> str:
    relative = f"{user_id}/{note_id}{suffix}"
    path = audio_file(relative)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return relative


def _remove_audio(relative: str | None) -> None:
    if relative:
        try:
            audio_file(relative).unlink(missing_ok=True)
        except Exception:
            log.warning("could not remove audio file %s", relative, exc_info=True)


def owner_of(note_id: str) -> dict | None:
    """For the signed audio URL only: the token is checked against the owner."""
    try:
        uuid.UUID(note_id)
    except ValueError:
        return None
    found = client().retrieve(COLLECTION, ids=[note_id], with_payload=True)
    return found[0].payload if found else None
