"""POST /chat: one turn of the notes assistant, streamed as NDJSON.

The client keeps the conversation history (in the model's message format) and
sends it with each request, so the server holds no conversation state.
"""

import json
from typing import Annotated, Literal

from fastapi import APIRouter, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import health
from chat import agent, tools
from config import settings
from errors import bad_request
from identity import UserId
from routes_notes import client_today

router = APIRouter()

INTERRUPTED = json.dumps({"error": "This action was interrupted and did not complete."})


class AskAnswer(BaseModel):
    tool_call_id: str = Field(max_length=100)
    text: str = Field("", max_length=2000)  # the button label, or what the user typed
    value: str | None = Field(None, max_length=40)
    note_id: str | None = Field(None, max_length=64)


class ChatIn(BaseModel):
    history: list[dict] = Field(default_factory=list, max_length=400)
    message: str | None = Field(None, min_length=1, max_length=4000)
    answer: AskAnswer | None = None
    # How the user produced this turn. For an answer, the source of the turn it continues.
    source: Literal["typed", "voice"] = "typed"
    # Notes open in the editor with unsaved changes; the assistant will not write to them.
    locked_note_ids: list[str] = Field(default_factory=list, max_length=50)
    # The browser's UTC offset in minutes, so "notes from August" means the
    # user's August. Sent in the body, not a header, to keep CORS unchanged.
    tz_offset_minutes: int = Field(0, ge=-14 * 60, le=14 * 60)


def _clean(history: list[dict]) -> list[dict]:
    """Keep only well-formed user/assistant/tool messages, trimmed to recent turns."""
    out: list[dict] = []
    for m in history:
        role = m.get("role") if isinstance(m, dict) else None
        if role == "user" and isinstance(m.get("content"), str):
            out.append({"role": "user", "content": m["content"][:4000]})
        elif role == "assistant":
            msg: dict = {"role": "assistant", "content": m["content"][:20000] if isinstance(m.get("content"), str) else None}
            calls = [
                {"id": str(c["id"]), "type": "function",
                 "function": {"name": str(c["function"]["name"]), "arguments": str(c["function"].get("arguments") or "{}")}}
                for c in m.get("tool_calls") or []
                if isinstance(c, dict) and c.get("id") and isinstance(c.get("function"), dict) and c["function"].get("name")
            ]
            if calls:
                msg["tool_calls"] = calls
            if msg["content"] or calls:
                out.append(msg)
        elif role == "tool" and isinstance(m.get("tool_call_id"), str) and isinstance(m.get("content"), str):
            out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"][:20000]})
    # Trim to the most recent messages, starting at a user message so tool
    # calls and their results are never split.
    if len(out) > settings.chat_history_messages:
        tail = out[-settings.chat_history_messages:]
        first_user = next((i for i, m in enumerate(tail) if m["role"] == "user"), len(tail))
        out = tail[first_user:]
    return out


def _pending_question(history: list[dict]) -> str | None:
    """The ask_user call waiting for an answer at the end of the history, if any."""
    answered = {m["tool_call_id"] for m in history if m["role"] == "tool"}
    for m in reversed(history):
        if m["role"] == "user":
            return None
        for c in m.get("tool_calls") or []:
            if c["function"]["name"] == "ask_user" and c["id"] not in answered:
                return c["id"]
    return None


def _repair(history: list[dict], keep_open: str | None) -> list[dict]:
    """Give every unanswered tool call a result, so the model API accepts the history.

    A turn interrupted by an error or a closed tab would otherwise leave a call
    without a result and break every later request.
    """
    answered = {m["tool_call_id"] for m in history if m["role"] == "tool"}
    out: list[dict] = []
    for i, m in enumerate(history):
        out.append(m)
        missing = [c["id"] for c in m.get("tool_calls") or [] if c["id"] not in answered and c["id"] != keep_open]
        if missing:
            # Insert after this message's existing tool results.
            j = i + 1
            while j < len(history) and history[j]["role"] == "tool":
                out.append(history[j])
                j += 1
            out += [{"role": "tool", "tool_call_id": cid, "content": INTERRUPTED} for cid in missing]
            answered.update(missing)
    # Drop the duplicates of tool results copied forward above.
    seen, deduped = set(), []
    for m in out:
        key = (m["role"], m.get("tool_call_id")) if m["role"] == "tool" else None
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        deduped.append(m)
    return deduped


@router.post("/chat")
async def chat(body: ChatIn, user_id: UserId,
               x_client_date: Annotated[str | None, Header(alias="X-Client-Date")] = None):
    if (body.message is None) == (body.answer is None):
        raise bad_request("Send either a message or an answer to the assistant's question")
    await health.require(*health.CHAT)

    prior = _clean(body.history)
    new: list[dict] = []
    keep_open = None
    if body.answer:
        if _pending_question(prior) != body.answer.tool_call_id:
            raise bad_request("That question is no longer waiting for an answer")
        keep_open = body.answer.tool_call_id
        new.append({"role": "tool", "tool_call_id": body.answer.tool_call_id, "content": json.dumps({
            "answer": body.answer.text, "value": body.answer.value, "note_id": body.answer.note_id,
        })})
    else:
        new.append({"role": "user", "content": body.message})
    prior = _repair(prior, keep_open)

    turn = tools.Turn(
        user_id=user_id, today=client_today(x_client_date), voice=body.source == "voice",
        locked=set(body.locked_note_ids), messages=[], tz_offset_minutes=body.tz_offset_minutes,
    )
    return StreamingResponse(agent.run_turn(turn, prior, new), media_type="application/x-ndjson")
