"""The tool-calling loop for one chat turn, streamed as NDJSON events.

Events (one JSON object per line):
  {"type": "token", "content": "..."}                 part of the assistant's reply
  {"type": "activity", "tool": "search_notes"}        a tool is running
  {"type": "note_changed", "action": "...", "note": {...}}  a note was changed
  {"type": "ask_user", "tool_call_id": "...", "question": "...", "options": [...]}
  {"type": "messages", "messages": [...]}             new history entries for the client to keep
  {"type": "error", "message": "...", "hint": "..."}
  {"type": "done"}
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import openai
from fastapi.concurrency import run_in_threadpool

import groq_client
from chat import tools
from chat.prompt import system_prompt
from config import settings
from errors import UNEXPECTED, AppError
from routes_notes import present

log = logging.getLogger("memchat")


def event(kind: str, **data: Any) -> str:
    return json.dumps({"type": kind, **data}) + "\n"


async def _complete(messages: list[dict], schemas: list[dict]) -> AsyncIterator[tuple[str, Any]]:
    """Stream one model response. Yields ("token", text) pieces, then ("message", assistant_message)."""
    stream = await groq_client.async_client().chat.completions.create(
        model=settings.groq_chat_model, messages=messages, tools=schemas, tool_choice="auto",
        temperature=0.2, stream=True,
    )
    text: list[str] = []
    calls: dict[int, dict] = {}
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta.content:
            text.append(delta.content)
            yield "token", delta.content
        for tc in delta.tool_calls or []:
            slot = calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
            if tc.id:
                slot["id"] = tc.id
            if tc.function and tc.function.name:
                slot["name"] += tc.function.name
            if tc.function and tc.function.arguments:
                slot["arguments"] += tc.function.arguments
    message: dict = {"role": "assistant", "content": "".join(text) or None}
    if calls:
        message["tool_calls"] = [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"] or "{}"}}
            for _, c in sorted(calls.items())
        ]
    yield "message", message


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


async def run_turn(turn: tools.Turn, prior: list[dict], new: list[dict]) -> AsyncIterator[str]:
    """prior: the client's history. new: this request's additions; grows as the turn runs."""
    turn.messages = prior + new
    system = {"role": "system", "content": system_prompt(turn.today, turn.voice)}
    schemas = tools.schemas(turn.voice)
    try:
        for _ in range(settings.chat_max_tool_rounds):
            assistant: dict = {}
            async for kind, value in _complete([system, *turn.messages], schemas):
                if kind == "token":
                    yield event("token", content=value)
                else:
                    assistant = value
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
