"""Tools the chat model can call, and the rules they enforce in code.

Every tool goes through store.py with the caller's user_id, so the model can
only ever see or change the caller's own notes. On top of that, the tools
refuse (and tell the model why) when:
  - the note is open in the editor with unsaved changes
  - a past diary entry would be changed, or any diary note deleted or rewritten
  - delete_note is called without a matching ask_user confirmation this turn
  - delete_note is called on a turn that came from voice input
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime

import store
from errors import AppError

log = logging.getLogger("memchat")

BODY_LIMIT = 1500  # characters of each note body shown to the model


@dataclass
class Turn:
    user_id: str
    today: date
    voice: bool
    locked: set[str]  # note ids open in the editor with unsaved changes
    messages: list[dict]  # this conversation so far, including this turn
    changes: list[dict] = field(default_factory=list)


class Refused(Exception):
    """A rule stopped the tool. The message goes back to the model."""


# ---------- Schemas ----------

NOTE_TYPE = {"type": "string", "enum": ["text", "list", "diary", "audio"]}
WRITABLE_TYPE = {"type": "string", "enum": ["text", "list", "diary"]}


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {
        "name": name, "description": description,
        "parameters": {"type": "object", "properties": properties, "required": required},
    }}


SCHEMAS = [
    _tool("search_notes", "Similarity search over the user's notes. Use for questions and to find a note to change.",
          {"query": {"type": "string"}, "type": NOTE_TYPE}, ["query"]),
    _tool("list_notes", "List the user's notes, newest first, optionally only one type. A straight lookup, not a search.",
          {"type": NOTE_TYPE}, []),
    _tool("create_note", "Create a note. For type diary this appends to today's entry if it exists.",
          {"type": WRITABLE_TYPE, "title": {"type": "string"}, "body": {"type": "string"}}, ["type", "title", "body"]),
    _tool("append_to_note", "Add text to the end of a note. For lists, one item per line.",
          {"note_id": {"type": "string"}, "text": {"type": "string"}}, ["note_id", "text"]),
    _tool("update_note", "Replace a note's title and/or body. Only when the user asks to rewrite or correct.",
          {"note_id": {"type": "string"}, "title": {"type": "string"}, "body": {"type": "string"}}, ["note_id"]),
    _tool("delete_note", "Move a note to the trash. Requires a confirm_delete answer from ask_user for this note first.",
          {"note_id": {"type": "string"}}, ["note_id"]),
    _tool("restore_note", "Restore a note from the trash.",
          {"note_id": {"type": "string"}}, ["note_id"]),
    _tool("ask_user", "Ask the user to choose. Shown as buttons with a free-text box. Each option carries a note_id where relevant.",
          {"question": {"type": "string"},
           "options": {"type": "array", "items": {"type": "object", "properties": {
               "label": {"type": "string"},
               "value": {"type": "string", "description": "choose, confirm_delete, cancel, or another short keyword"},
               "note_id": {"type": "string"}}, "required": ["label", "value"]}}},
          ["question", "options"]),
]


def schemas(voice: bool) -> list[dict]:
    # Voice turns never even see delete_note; the check in delete_note is the backstop.
    return [s for s in SCHEMAS if not (voice and s["function"]["name"] == "delete_note")]


# ---------- Helpers ----------


def _day(iso: str | None) -> str | None:
    if not iso:
        return None
    d = datetime.fromisoformat(iso)
    return f"{d.day} {d:%B %Y}"


def summary(note: dict, with_body: bool = True) -> dict:
    out = {"note_id": note["id"], "title": note["title"], "type": note["type"],
           "created": _day(note.get("created")), "last_edited": _day(note.get("updated"))}
    if note.get("entry_date"):
        out["diary_date"] = note["entry_date"]
    if with_body:
        body = note.get("body", "")
        out["body"] = body if len(body) <= BODY_LIMIT else body[:BODY_LIMIT] + " [truncated]"
    if "score" in note:
        out["relevance"] = note["score"]
    return out


def _writable(turn: Turn, note: dict) -> None:
    if note["id"] in turn.locked:
        raise Refused(f'"{note["title"]}" is open in the editor with unsaved changes, so it was not changed. '
                      "Tell the user which note you could not touch.")


def _past_diary(turn: Turn, note: dict) -> bool:
    return note["type"] == "diary" and note.get("entry_date") != turn.today.isoformat()


def _record(turn: Turn, action: str, note: dict) -> None:
    turn.changes.append({"action": action, "note": note})


def _confirmed_delete(turn: Turn, note_id: str) -> bool:
    """True if, since the user's last message, they answered an ask_user with confirm_delete for this note."""
    ask_ids: set[str] = set()
    for m in turn.messages:
        for call in m.get("tool_calls") or []:
            if call["function"]["name"] == "ask_user":
                ask_ids.add(call["id"])
    last_user = max((i for i, m in enumerate(turn.messages) if m["role"] == "user"), default=-1)
    for m in reversed(turn.messages[last_user + 1:]):
        if m["role"] == "tool" and m.get("tool_call_id") in ask_ids:
            try:
                answer = json.loads(m["content"])
            except (ValueError, TypeError):
                return False
            return answer.get("value") == "confirm_delete" and answer.get("note_id") == note_id
    return False


# ---------- Implementations ----------


def search_notes(turn: Turn, query: str, type: str | None = None) -> dict:
    found = store.search(turn.user_id, query, type)
    return {"results": [summary(n) for n in found]} if found else {"results": [], "note": "No matching notes."}


def list_notes(turn: Turn, type: str | None = None) -> dict:
    notes = store.list_notes(turn.user_id, type)
    return {"count": len(notes), "notes": [summary(n, with_body=False) for n in notes[:50]]}


def create_note(turn: Turn, type: str, title: str, body: str) -> dict:
    if type not in ("text", "list", "diary"):
        raise Refused("Only text, list and diary notes can be created from chat. Audio notes are recorded in the app.")
    if type == "diary" and (today := store.today_diary(turn.user_id, turn.today)):
        _writable(turn, today)
    note, appended = store.create(turn.user_id, type, title, body, today=turn.today)
    _record(turn, "appended" if appended else "created", note)
    return {"status": "appended to today's diary entry" if appended else "created", "note": summary(note)}


def append_to_note(turn: Turn, note_id: str, text: str) -> dict:
    note = store.get(turn.user_id, note_id)
    _writable(turn, note)
    if _past_diary(turn, note):
        raise Refused(f'"{note["title"]}" is a past diary entry and cannot be changed from chat. '
                      "Tell the user to edit it manually if they want to.")
    note = store.append(turn.user_id, note_id, text)
    _record(turn, "appended", note)
    return {"status": "appended", "note": summary(note)}


def update_note(turn: Turn, note_id: str, title: str | None = None, body: str | None = None) -> dict:
    note = store.get(turn.user_id, note_id)
    _writable(turn, note)
    if note["type"] == "diary":
        raise Refused("Diary entries cannot be rewritten from chat. Append to today's entry with create_note "
                      "type diary, or tell the user to edit it manually.")
    note = store.update(turn.user_id, note_id, title=title, body=body)
    _record(turn, "updated", note)
    return {"status": "updated", "note": summary(note)}


def delete_note(turn: Turn, note_id: str) -> dict:
    if turn.voice:
        raise Refused("This request came from voice input, which cannot delete. "
                      "Tell the user that deletion has to be typed or done manually.")
    note = store.get(turn.user_id, note_id)
    if note["type"] == "diary":
        raise Refused("Diary notes cannot be deleted from chat. Tell the user to do it manually.")
    _writable(turn, note)
    if not _confirmed_delete(turn, note_id):
        raise Refused(f'Not deleted: first call ask_user to confirm, naming "{note["title"]}", its type ({note["type"]}) '
                      f'and when it was last edited ({_day(note["updated"])}), with a confirm_delete option for note_id {note_id}.')
    note = store.soft_delete(turn.user_id, note_id)
    _record(turn, "deleted", note)
    return {"status": "moved to the trash (restorable)", "note": summary(note, with_body=False)}


def restore_note(turn: Turn, note_id: str) -> dict:
    note = store.restore(turn.user_id, note_id)
    _record(turn, "restored", note)
    return {"status": "restored from the trash", "note": summary(note, with_body=False)}


IMPLEMENTATIONS = {
    "search_notes": search_notes, "list_notes": list_notes, "create_note": create_note,
    "append_to_note": append_to_note, "update_note": update_note, "delete_note": delete_note,
    "restore_note": restore_note,
}


def execute(turn: Turn, name: str, arguments: str) -> dict:
    """Run one tool call. Expected failures come back as {"error": ...} for the model to explain."""
    fn = IMPLEMENTATIONS.get(name)
    if fn is None:
        return {"error": f"Unknown tool {name}"}
    try:
        args = json.loads(arguments or "{}")
        if not isinstance(args, dict):
            raise ValueError
    except ValueError:
        return {"error": "The tool arguments were not valid JSON. Try again."}
    args = {k: v for k, v in args.items() if v is not None}
    try:
        return fn(turn, **args)
    except Refused as exc:
        log.info("tool %s refused: %s", name, exc)
        return {"error": str(exc)}
    except TypeError:
        return {"error": f"Wrong arguments for {name}."}
    except AppError as exc:
        if exc.status == 503:
            raise  # a service is down: abort the turn with a named problem
        return {"error": exc.problems[0].message}
