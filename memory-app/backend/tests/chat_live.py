"""Live chat scenarios against the running backend and the real Groq model.

Uses a throwaway user, seeds notes over HTTP, runs each scenario, answers the
model's ask_user questions the way a user would, and prints the transcript.
Paces itself for Groq's per-minute token limit; on a 429 it prints the error
event the UI would show, waits, and retries once.

    cd memory-app/backend
    ..\\..\\.venv\\Scripts\\python.exe tests/chat_live.py
"""

import json
import sys
import time
import uuid
from datetime import date

import httpx

sys.stdout.reconfigure(encoding="utf-8", newline="\n", line_buffering=True)
API = "http://localhost:8000"
USER = str(uuid.uuid4())
HEAD = {"X-User-Id": USER, "X-Client-Date": date.today().isoformat()}
PAUSE = 25  # seconds between turns, to stay under the per-minute token limit
http = httpx.Client(base_url=API, headers=HEAD, timeout=180)
history: list[dict] = []
rate_limit_seen = []


def seed(type_, title, body):
    return http.post("/notes", json={"type": type_, "title": title, "body": body}).json()["note"]


def send(payload: dict, retry: bool = True) -> dict:
    global history
    events = []
    with http.stream("POST", "/chat", json={"history": history, **payload}) as r:
        if r.status_code != 200:
            r.read()
            return {"status": r.status_code, "body": r.json()}
        for line in r.iter_lines():
            if line.strip():
                events.append(json.loads(line))
    errors = [e for e in events if e["type"] == "error"]
    if errors and "rate limiting" in errors[0]["message"] and retry:
        rate_limit_seen.append(errors[0])
        print(f"    [rate limited] UI would show: {errors[0]['message']} / {errors[0]['hint']}")
        wait = int("".join(c for c in errors[0]["hint"] if c.isdigit()) or 30) + 2
        print(f"    [waiting {wait}s, then retrying once]")
        time.sleep(wait)
        return send(payload, retry=False)
    # The messages event already includes this turn's user message or answer.
    history = history + next(e["messages"] for e in events if e["type"] == "messages")
    return {"status": 200, "events": events}


def show(result: dict) -> dict | None:
    if result["status"] != 200:
        print(f"    HTTP {result['status']}: {result['body']}")
        return None
    ev = result["events"]
    tools = [e["tool"] for e in ev if e["type"] == "activity"]
    if tools:
        print(f"    tools: {', '.join(tools)}")
    for e in ev:
        if e["type"] == "note_changed":
            print(f"    CHANGED: {e['action']} \"{e['note']['title']}\"")
    reply = "".join(e["content"] for e in ev if e["type"] == "token").strip()
    if reply:
        print(f"    reply: {reply}")
    for e in ev:
        if e["type"] == "error":
            print(f"    ERROR: {e['message']} / {e['hint']}")
    ask = next((e for e in ev if e["type"] == "ask_user"), None)
    if ask:
        print(f"    ASK: {ask['question']}")
        for o in ask["options"]:
            print(f"      [{o['value']}] {o['label']}  note_id={o['note_id']}")
    return ask


def say(text, **extra):
    global history
    print(f"\n  you: {text}" + (f"  ({extra})" if extra else ""))
    ask = show(send({"message": text, **extra}))
    time.sleep(PAUSE)
    return ask


def pick(ask, value=None, label_has=None, source="typed"):
    opt = next(o for o in ask["options"]
               if (value is None or o["value"] == value) and (label_has is None or label_has.lower() in o["label"].lower()))
    print(f"  you click: {opt['label']}")
    nxt = show(send({"answer": {"tool_call_id": ask["tool_call_id"], "text": opt["label"],
                                "value": opt["value"], "note_id": opt["note_id"]}, "source": source}))
    time.sleep(PAUSE)
    return nxt


def fresh():
    global history
    history = []


print(f"user: {USER}")
bike = seed("text", "Bike repair", "Rear brake pads are worn and need replacing. Chain needs oil.")
groceries = seed("list", "Groceries", "milk\nbread")
seed("text", "Wifi", "The router is in the hall cupboard. Restart it by holding the button for ten seconds.")

print("\n== 1. Answers from notes, with a citation")
fresh(); say("What do I need to fix on my bike?")

print("\n== 2a. Personal fact not in notes: says so, does not guess")
fresh(); say("What is my passport number?")

print("\n== 2b. General question, nothing in notes: one line, then marked general knowledge")
fresh(); say("How long should I boil an egg for a soft yolk?")

print("\n== 2c. Partly in notes: cited notes part first, then a separate general part")
fresh(); say("What do I need to fix on my bike, and how often do brake pads usually need replacing?")

print("\n== 2d. Fully in notes: cited, no general knowledge paragraph")
fresh(); say("What's on my grocery list?")

print("\n== 3. Add to an existing list (append, not a second list)")
fresh(); say("Add eggs to my grocery list")
print("    lists now:", [n["title"] for n in http.get("/notes", params={"type": "list"}).json()["notes"]])
print("    groceries body:", repr(http.get(f"/notes/{groceries['id']}").json()["note"]["body"]))

print("\n== 4. Nothing matches a create request: creates and says so")
fresh(); say("Start a packing list for camping with a tent and a sleeping bag")

print("\n== 5. Delete one clear match: confirmation names title, type and date")
fresh(); ask = say("Delete my bike repair note")
if ask:
    pick(ask, value="confirm_delete")
print("    bike note deleted:", http.get(f"/notes/{bike['id']}").status_code == 404)

print("\n== 6. Two plausible matches: pick first, then a separate confirmation")
party = seed("list", "Groceries for the party", "crisps\nlemonade")
fresh(); ask = say("Delete my groceries list")
if ask and any(o["value"] == "choose" for o in ask["options"]):
    ask = pick(ask, value="choose", label_has="party")
if ask:
    pick(ask, value="cancel")
print("    both lists still exist:", all(http.get(f"/notes/{n['id']}").status_code == 200 for n in (groceries, party)))

print("\n== 7. Voice cannot delete")
fresh(); say("Delete my packing list", source="voice")
print("    lists now:", [n["title"] for n in http.get("/notes", params={"type": "list"}).json()["notes"]])

print("\n== 8. Diary: goes to today's entry")
fresh(); say("Add to my diary: finished fixing the brakes and went for a ride")

print("\n== 9. A note open with unsaved changes is not touched")
fresh(); say("Add butter to my grocery list", locked_note_ids=[groceries["id"]])
print("    groceries body unchanged:", repr(http.get(f"/notes/{groceries['id']}").json()["note"]["body"]))

print("\n== Cleanup")
for listing in (http.get("/notes").json()["notes"], http.get("/trash").json()["notes"]):
    for n in listing:
        http.delete(f"/notes/{n['id']}")
        http.delete(f"/trash/{n['id']}")
print("  notes left:", len(http.get("/notes").json()["notes"]) + len(http.get("/trash").json()["notes"]))
print("  rate-limit events seen:", len(rate_limit_seen))
