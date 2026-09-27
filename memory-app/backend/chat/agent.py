"""The tool-calling loop for one chat turn, streamed as NDJSON events.

Events (one JSON object per line):
  {"type": "token", "content": "..."}                 part of the assistant's reply
  {"type": "activity", "tool": "search_notes"}        a tool is running
  {"type": "notice", "message": "..."}                 waiting on Groq's rate limit, retrying
  {"type": "note_changed", "action": "...", "note": {...}}  a note was changed
  {"type": "ask_user", "tool_call_id": "...", "question": "...", "options": [...]}
  {"type": "messages", "messages": [...]}             new history entries for the client to keep
  {"type": "error", "message": "...", "hint": "..."}
  {"type": "done"}
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import openai
from fastapi.concurrency import run_in_threadpool

import groq_client
import store
from chat import tools
from chat.prompt import system_prompt
from config import settings
from errors import UNEXPECTED, AppError
from routes_notes import present

log = logging.getLogger("memchat")


def event(kind: str, **data: Any) -> str:
    return json.dumps({"type": kind, **data}) + "\n"


# Replies are shown as written, and the UI uses no em or en dashes. The model
# uses them anyway, so they are replaced as the text streams.
PLAIN_PUNCTUATION = str.maketrans({
    "‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "―": "-",
    " ": " ", " ": " ", " ": " ",
})

GENERAL = "From general knowledge:"
NOTHING_IN_NOTES = "Nothing in your notes about that.\n\n"


class _Opening:
    """Makes sure a general-knowledge answer says first that the notes had nothing.

    A reply that begins with "From general knowledge:" has no notes-backed part,
    so it must open with the one-line "nothing in your notes". The model does not
    always write it, so the start of each reply is held back until it is clear
    whether it begins that way, and the line is added when it is missing.
    """

    def __init__(self) -> None:
        self.buffer = ""
        self.decided = False

    def feed(self, piece: str) -> str:
        if self.decided:
            return piece
        self.buffer += piece
        start = self.buffer.lstrip()
        if len(start) < len(GENERAL) and GENERAL.startswith(start):
            return ""  # could still be "From general knowledge:"; keep holding
        return self._release(start)

    def flush(self) -> str:
        return "" if self.decided else self._release(self.buffer.lstrip())

    def _release(self, start: str) -> str:
        self.decided = True
        out = (NOTHING_IN_NOTES + start) if start.startswith(GENERAL) else self.buffer
        self.buffer = ""
        return out


async def _complete(messages: list[dict], schemas: list[dict]) -> AsyncIterator[tuple[str, Any]]:
    """Stream one model response. Yields ("token", text) pieces, then ("message", assistant_message)."""
    stream = await groq_client.async_client().chat.completions.create(
        model=settings.groq_chat_model, messages=messages, tools=schemas, tool_choice="auto",
        temperature=0.2, stream=True, reasoning_effort=settings.chat_reasoning_effort,
        stream_options={"include_usage": True},
    )
    text: list[str] = []
    calls: dict[int, dict] = {}
    opening = _Opening()
    async for chunk in stream:
        if getattr(chunk, "usage", None):
            log.info("chat call used %s prompt + %s completion tokens",
                     chunk.usage.prompt_tokens, chunk.usage.completion_tokens)
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta.content:
            if piece := opening.feed(delta.content.translate(PLAIN_PUNCTUATION)):
                text.append(piece)
                yield "token", piece
        for tc in delta.tool_calls or []:
            slot = calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
            if tc.id:
                slot["id"] = tc.id
            if tc.function and tc.function.name:
                slot["name"] += tc.function.name
            if tc.function and tc.function.arguments:
                slot["arguments"] += tc.function.arguments
    if rest := opening.flush():
        text.append(rest)
        yield "token", rest
    message: dict = {"role": "assistant", "content": "".join(text) or None}
    if calls:
        message["tool_calls"] = [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
            for _, c in sorted(calls.items())
        ]
    yield "message", message


# A rate limit shorter than this is waited out (with a notice); longer ones
# end the turn with the named problem so the user is not left waiting.
RATE_LIMIT_MAX_WAIT = 10


def _question(call: dict) -> tuple[str, list[dict]]:
    """Parse ask_user arguments defensively; the model's JSON is not trusted."""
    try:
        args = json.loads(call["function"]["arguments"] or "{}")
    except ValueError:
        args = {}
    question = str(args.get("question") or "Which one do you mean?")
    options = []
    for opt in args.get("options") or []:
        if isinstance(opt, dict) and opt.get("label"):
            options.append({
                "label": str(opt["label"])[:200],
                "value": str(opt.get("value") or "choose")[:40],
                "note_id": str(opt["note_id"]) if opt.get("note_id") else None,
            })
    return question, options[:8]


def _confirmation_text(turn: tools.Turn, text: str, options: list[dict]) -> str:
    """A delete confirmation must name the note's title, type and last edit.

    The model does not always include all three, so when exactly one option is
    confirm_delete, the question is written from the note itself.
    """
    confirms = [o for o in options if o["value"] == "confirm_delete" and o["note_id"]]
    if len(confirms) != 1:
        return text
    try:
        note = store.get(turn.user_id, confirms[0]["note_id"])
    except AppError:
        return text
    return f'Delete the {note["type"]} note "{note["title"]}", last edited {tools._day(note["updated"])}?'


async def run_turn(turn: tools.Turn, prior: list[dict], new: list[dict]) -> AsyncIterator[str]:
    """prior: the client's history. new: this request's additions; grows as the turn runs."""
    turn.messages = prior + new
    system = {"role": "system", "content": system_prompt(turn.today, turn.voice)}
    schemas = tools.schemas(turn.voice)
    try:
        for _ in range(settings.chat_max_tool_rounds):
            assistant: dict = {}
            for attempt in (1, 2):
                emitted = False
                try:
                    async for kind, value in _complete([system, *turn.messages], schemas):
                        if kind == "token":
                            emitted = True
                            yield event("token", content=value)
                        else:
                            assistant = value
                    break
                except openai.RateLimitError as exc:
                    problem = groq_client.problem_from(exc)  # records the limit for /health
                    wait = groq_client.retry_after(exc)
                    if attempt == 2 or emitted or wait > RATE_LIMIT_MAX_WAIT:
                        raise
                    log.info("Groq rate limit: waiting %.0fs before retrying", wait)
                    yield event("notice", message=f"{problem.message}. Trying again in {int(wait) + 1} seconds.")
                    await asyncio.sleep(wait)
                except openai.APIError as exc:
                    # The model produced a tool call Groq rejected. Ask again once,
                    # unless text already reached the user (a retry would repeat it).
                    if attempt == 2 or emitted or not groq_client.is_tool_call_error(exc):
                        raise
                    log.warning("Groq rejected a tool call, retrying once: %s", exc)
            turn.messages.append(assistant)
            new.append(assistant)
            calls = assistant.get("tool_calls") or []
            if not calls:
                break

            question = None
            for call in calls:
                name = call["function"]["name"]
                if name == "ask_user" and question is None:
                    question = call  # answered later by the user, not by us
                    continue
                if name == "ask_user":
                    result = {"error": "Only one question can be asked at a time."}
                else:
                    yield event("activity", tool=name)
                    before = len(turn.changes)
                    result = await run_in_threadpool(tools.execute, turn, name, call["function"]["arguments"])
                    for change in turn.changes[before:]:
                        yield event("note_changed", action=change["action"], note=present(change["note"]))
                tool_message = {"role": "tool", "tool_call_id": call["id"], "content": json.dumps(result)}
                turn.messages.append(tool_message)
                new.append(tool_message)

            if question:
                text, options = _question(question)
                text = await run_in_threadpool(_confirmation_text, turn, text, options)
                yield event("ask_user", tool_call_id=question["id"], question=text, options=options)
                break
        else:
            note = "I stopped after several steps without finishing. Please try asking in a different way."
            new.append({"role": "assistant", "content": note})
            yield event("token", content=note)
    except AppError as exc:
        yield event("error", message=exc.problems[0].message, hint=exc.problems[0].hint)
    except openai.OpenAIError as exc:
        log.exception("Groq call failed during chat")
        problem = groq_client.problem_from(exc)
        yield event("error", message=problem.message, hint=problem.hint)
    except Exception:
        log.exception("chat turn failed")
        yield event("error", message=UNEXPECTED.message, hint=UNEXPECTED.hint)
    yield event("messages", messages=new)
    yield event("done")
