"""Checks the chat rules that are enforced in code, with a scripted fake model.

The fake model makes exactly the tool calls each scenario needs, including the
mistakes a real model might make (deleting without confirming, writing to a
past diary entry, deleting by voice). Everything else is real: FastAPI, the
store, Qdrant and the embeddings. Needs Qdrant running; does not need Groq.

    cd memory-app/backend
    ..\\..\\.venv\\Scripts\\python.exe tests/chat_rules_test.py
"""

import json
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace as NS

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.stdout.reconfigure(newline="\n")

import httpx  # noqa: E402
import openai  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import groq_client  # noqa: E402
import health  # noqa: E402
import main  # noqa: E402
import store  # noqa: E402

# ---------- Fake Groq ----------

SCRIPT: list = []  # responses the fake model will give, in order
SEEN: list[dict] = []  # the requests it received


def text(t):
    return {"text": t}


def call(name, **args):
    return {"calls": [(name, args)]}


class FakeCompletions:
    async def create(self, **kw):
        SEEN.append(kw)
        step = SCRIPT.pop(0)
        if isinstance(step, Exception):
            raise step

        async def gen():
            if step.get("text"):
                for word in step["text"].split(" "):
                    yield NS(choices=[NS(delta=NS(content=word + " ", tool_calls=None))])
            for i, (name, args) in enumerate(step.get("calls", [])):
                yield NS(choices=[NS(delta=NS(content=None, tool_calls=[
                    NS(index=i, id=f"call_{uuid.uuid4().hex[:8]}", function=NS(name=name, arguments=json.dumps(args)))]))])
        return gen()


groq_client.async_client = lambda: NS(chat=NS(completions=FakeCompletions()))


async def groq_ok():
    return {}


health._probe_groq = groq_ok  # no key needed: Groq itself is faked

client = TestClient(main.app)
TODAY = date.today()
passed = failed = 0


def check(label, got, expected):
    global passed, failed
    ok = got == expected
    passed, failed = passed + ok, failed + (not ok)
    print(f"  {'PASS' if ok else 'FAIL'}  {label}" + ("" if ok else f"  (expected {expected!r}, got {got!r})"))


def turn(user, script, *, message=None, answer=None, history=(), source="typed", locked=()):
    SCRIPT[:] = script
    SEEN.clear()
    body = {"history": list(history), "source": source, "locked_note_ids": list(locked)}
    body["message" if message is not None else "answer"] = message if message is not None else answer
    r = client.post("/chat", json=body, headers={"X-User-Id": user, "X-Client-Date": TODAY.isoformat()})
    if r.status_code != 200:
        return {"status": r.status_code, "body": r.json()}
    events = [json.loads(line) for line in r.text.splitlines() if line.strip()]
    out = {"status": 200, "events": events, "types": [e["type"] for e in events]}
    out["messages"] = next(e["messages"] for e in events if e["type"] == "messages")
    out["history"] = list(history) + out["messages"]  # messages already includes the user message
    out["tool_results"] = [json.loads(m["content"]) for m in out["messages"] if m["role"] == "tool"]
    out["changed"] = [(e["action"], e["note"]["title"]) for e in events if e["type"] == "note_changed"]
    out["ask"] = next((e for e in events if e["type"] == "ask_user"), None)
    return out


def note(user, type_, title, body, day=TODAY):
    return store.create(user, type_, title, body, today=day)[0]


A, B = str(uuid.uuid4()), str(uuid.uuid4())
store.ensure_collection()

print("\n== Append goes to the existing list, and is undoable")
groceries = note(A, "list", "Groceries", "milk\nbread")
r = turn(A, [call("search_notes", query="grocery list"), call("append_to_note", note_id=groceries["id"], text="eggs"),
             text("Added eggs to Groceries.")], message="Add eggs to my grocery list")
check("one note changed: appended to Groceries", r["changed"], [("appended", "Groceries")])
check("no second list was created", len(store.list_notes(A, "list")), 1)
check("list line added", store.get(A, groceries["id"])["body"], "- [ ] milk\n- [ ] bread\n- [ ] eggs")
check("previous_body holds the pre-append body", store.get(A, groceries["id"])["previous_body"], "- [ ] milk\n- [ ] bread")

print("\n== Delete without confirmation is refused")
r = turn(A, [call("delete_note", note_id=groceries["id"]), text("I need to confirm first.")], message="delete groceries")
check("delete_note returned an error", "error" in r["tool_results"][0], True)
check("error asks for ask_user naming title/type/date", "ask_user" in r["tool_results"][0]["error"] and "Groceries" in r["tool_results"][0]["error"], True)
check("note still exists", store.get(A, groceries["id"])["deleted"], False)

print("\n== Two matches: pick one, then a separate confirmation, then delete")
shop2 = note(A, "list", "Groceries for the party", "crisps")
r1 = turn(A, [call("search_notes", query="groceries"),
              call("ask_user", question="Which list?", options=[
                  {"label": "Groceries", "value": "choose", "note_id": groceries["id"]},
                  {"label": "Groceries for the party", "value": "choose", "note_id": shop2["id"]}])],
          message="delete my groceries list")
check("paused with an ask_user carrying note_ids", [o["note_id"] for o in r1["ask"]["options"]], [groceries["id"], shop2["id"]])
check("nothing deleted yet", r1["changed"], [])
r2 = turn(A, [call("ask_user", question='Delete the list "Groceries for the party", last edited today?', options=[
              {"label": "Delete it", "value": "confirm_delete", "note_id": shop2["id"]},
              {"label": "Keep it", "value": "cancel"}])],
          answer={"tool_call_id": r1["ask"]["tool_call_id"], "text": "Groceries for the party", "value": "choose", "note_id": shop2["id"]},
          history=r1["history"])
check("second, separate question for confirmation", r2["ask"]["options"][0]["value"], "confirm_delete")
r3 = turn(A, [call("delete_note", note_id=groceries["id"]), text("done")],
          answer={"tool_call_id": r2["ask"]["tool_call_id"], "text": "Delete it", "value": "confirm_delete", "note_id": shop2["id"]},
          history=r2["history"])
check("confirmation for one note cannot delete another", "error" in r3["tool_results"][-1], True)
check("  ...the other note is untouched", store.get(A, groceries["id"])["deleted"], False)
r2b = turn(A, [call("ask_user", question='Delete the list "Groceries for the party"?', options=[
               {"label": "Delete it", "value": "confirm_delete", "note_id": shop2["id"]}, {"label": "Keep it", "value": "cancel"}])],
           answer={"tool_call_id": r1["ask"]["tool_call_id"], "text": "Groceries for the party", "value": "choose", "note_id": shop2["id"]},
           history=r1["history"])
r4 = turn(A, [call("delete_note", note_id=shop2["id"]), text("Moved it to the trash.")],
          answer={"tool_call_id": r2b["ask"]["tool_call_id"], "text": "Delete it", "value": "confirm_delete", "note_id": shop2["id"]},
          history=r2b["history"])
check("confirmed delete goes through", r4["changed"], [("deleted", "Groceries for the party")])
check("it is a soft delete (in the trash)", [n["id"] for n in store.list_notes(A, deleted=True)], [shop2["id"]])
stale = turn(A, [text("x")], answer={"tool_call_id": r1["ask"]["tool_call_id"], "text": "again"}, history=r4["history"])
check("answering an old question again is rejected -> 400", stale["status"], 400)

print("\n== Voice cannot delete")
r = turn(A, [call("delete_note", note_id=groceries["id"]), text("Deletion has to be typed.")],
         message="delete my groceries", source="voice")
check("delete_note is not offered on voice turns", "delete_note" in [t["function"]["name"] for t in SEEN[0]["tools"]], False)
check("voice turn prompt says so", "DICTATED BY VOICE" in SEEN[0]["messages"][0]["content"], True)
check("delete_note refused if attempted anyway", "voice" in r["tool_results"][0].get("error", ""), True)
check("note still exists", store.get(A, groceries["id"])["deleted"], False)

print("\n== Diary rules")
past = note(A, "diary", "", "Old entry.", day=TODAY - timedelta(days=3))
r = turn(A, [call("append_to_note", note_id=past["id"], text="edit"), text("x")], message="add to that old entry")
check("append to a past entry is refused", "past diary entry" in r["tool_results"][0].get("error", ""), True)
r = turn(A, [call("create_note", type="diary", title="x", body="Went swimming."), text("x")], message="diary: went swimming")
check("diary create makes today's entry, titled by date", r["changed"], [("created", store.diary_title(TODAY))])
r = turn(A, [call("create_note", type="diary", title="x", body="Then lunch."), text("x")], message="diary: then lunch")
check("second diary create appends to today's entry", r["changed"], [("appended", store.diary_title(TODAY))])
today_entry = store.today_diary(A, TODAY)
r = turn(A, [call("update_note", note_id=today_entry["id"], body="rewritten"), text("x")], message="rewrite today")
check("rewriting even today's entry is refused", "cannot be rewritten" in r["tool_results"][0].get("error", ""), True)
r = turn(A, [call("delete_note", note_id=past["id"]), text("x")], message="delete old diary")
check("deleting a diary note is refused", "Diary notes cannot be deleted" in r["tool_results"][0].get("error", ""), True)
check("past entry unchanged", store.get(A, past["id"])["body"], "Old entry.")

print("\n== A note open with unsaved changes is not touched")
r = turn(A, [call("append_to_note", note_id=groceries["id"], text="butter"), text("x")],
         message="add butter", locked=[groceries["id"]])
check("refused, naming the note", "Groceries" in r["tool_results"][0].get("error", "") and "unsaved" in r["tool_results"][0]["error"], True)
check("body unchanged", store.get(A, groceries["id"])["body"], "- [ ] milk\n- [ ] bread\n- [ ] eggs")

print("\n== Isolation through chat")
note(B, "text", "Cello practice", "Scales for twenty minutes.")
r = turn(B, [call("search_notes", query="groceries milk eggs"), text("x")], message="what's on my grocery list?")
check("B's search_notes never returns A's notes", [x["title"] for x in r["tool_results"][0]["results"]], ["Cello practice"])
r = turn(B, [call("list_notes"), text("x")], message="list my notes")
check("B's list_notes has only B's note", [x["title"] for x in r["tool_results"][0]["notes"]], ["Cello practice"])
r = turn(B, [call("append_to_note", note_id=groceries["id"], text="hacked"), text("x")], message="append")
check("B cannot append to A's note by id", r["tool_results"][0], {"error": "That note does not exist"})
r = turn(B, [call("restore_note", note_id=shop2["id"]), text("x")], message="restore")
check("B cannot restore A's trashed note", r["tool_results"][0], {"error": "That note does not exist"})
check("A's note unchanged", store.get(A, groceries["id"])["body"], "- [ ] milk\n- [ ] bread\n- [ ] eggs")

print("\n== Robustness")
dangling = [{"role": "user", "content": "hi"},
            {"role": "assistant", "content": None, "tool_calls": [{"id": "call_x", "type": "function",
                                                                   "function": {"name": "search_notes", "arguments": "{}"}}]}]
r = turn(A, [text("Hello.")], message="hello again", history=dangling)
sent = SEEN[0]["messages"]
check("a tool call left unanswered by an interrupted turn is repaired",
      any(m.get("role") == "tool" and m.get("tool_call_id") == "call_x" for m in sent), True)
r = turn(A, [openai.APIConnectionError(request=httpx.Request("POST", "https://api.groq.com"))], message="hi")
check("Groq failing mid-turn gives a named error, not a traceback",
      [e["message"] for e in r["events"] if e["type"] == "error"], ["Groq is unreachable"])

def rate_limited(seconds):
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    response = httpx.Response(429, headers={"retry-after": str(seconds)}, request=request)
    return openai.RateLimitError("Rate limit reached", response=response, body=None)


def rejected_tool_call():
    return openai.APIError("Tool call validation failed: parameters for tool list_notes did not match schema",
                           request=httpx.Request("POST", "https://api.groq.com"), body=None)


def reply_text(r):
    return "".join(e.get("content", "") for e in r["events"] if e["type"] == "token")


r = turn(A, [rate_limited(1), text("Here you go.")], message="hi")
check("short rate limit: the user is told, then it retries and answers",
      ([e["type"] for e in r["events"] if e["type"] in ("notice", "error")], "Here you go" in reply_text(r)),
      (["notice"], True))
check("  ...the notice names the limit and the wait",
      "rate limiting" in next(e["message"] for e in r["events"] if e["type"] == "notice"), True)
groq_client.rate_limited_until = None
r = turn(A, [rate_limited(45)], message="hi")
err = next(e for e in r["events"] if e["type"] == "error")
check("long rate limit: ends with the named problem and the wait",
      (err["message"], "45" in err["hint"] or "46" in err["hint"]), ("Groq is rate limiting requests", True))
check("  ...and /health reports it until it clears", groq_client.rate_limit_problem() is not None, True)
groq_client.rate_limited_until = None
r = turn(A, [rejected_tool_call(), text("Recovered.")], message="list my notes")
check("a tool call Groq rejects is retried once", "Recovered" in reply_text(r), True)
r = turn(A, [rejected_tool_call(), rejected_tool_call()], message="list my notes")
check("  ...and if it fails again, a readable message",
      [e["message"] for e in r["events"] if e["type"] == "error"], ["The assistant made an invalid request"])

print("\n== Tags, pins and date ranges")
C = str(uuid.uuid4())
H = {"X-User-Id": C, "X-Client-Date": TODAY.isoformat()}
work = client.post("/notes", json={"type": "text", "title": "Quarterly plan", "body": "Hire two engineers",
                                   "tags": ["#Work", " work ", "Planning"]}, headers=H).json()["note"]
check("tags are lowercased, trimmed, de-duplicated", work["tags"], ["work", "planning"])
home = note(C, "text", "Garden", "Plant tulip bulbs")
check("a note without tags reads as untagged and unpinned", (home["tags"], home["pinned"]), ([], False))
r = client.post("/notes/list", json={"tags": ["work"]}, headers=H).json()["notes"]
check("filtering by tag is an exact lookup", [n["title"] for n in r], ["Quarterly plan"])
r = client.post("/notes/list", json={"tags": ["work", "garden"]}, headers=H).json()["notes"]
check("several tags must all be present", r, [])

before = client.get(f"/notes/{home['id']}", headers=H).json()["note"]["updated"]
tagged = client.put(f"/notes/{home['id']}/tags", json={"tags": ["Home"]}, headers=H).json()["note"]
pinned = client.put(f"/notes/{home['id']}/pin", json={"pinned": True}, headers=H).json()["note"]
check("tags and pin are saved", (tagged["tags"], pinned["pinned"]), (["home"], True))
check("tagging and pinning leave updated alone", pinned["updated"], before)
store.update(C, work["id"], body="Hire two engineers and a designer")  # now the newest
r = client.get("/notes", headers=H).json()["notes"]
check("pinned notes sort first, even when older", [n["title"] for n in r], ["Garden", "Quarterly plan"])
r = client.post("/notes/search", json={"query": "flowers"}, headers=H).json()["notes"]
check("search results keep the pinned flag", r[0]["pinned"], True)

# Backdate one note to August to exercise the created-date range.
store.client().set_payload(store.COLLECTION, payload={"created": "2026-08-14T10:00:00+00:00"}, points=[home["id"]])
aug = {"created_from": "2026-08-01T00:00:00+00:00", "created_to": "2026-09-01T00:00:00+00:00"}
r = client.post("/notes/search", json={"query": "gardening", **aug}, headers=H).json()["notes"]
check("a date range narrows the similarity search", [n["title"] for n in r], ["Garden"])
r = client.post("/notes/list", json=aug, headers=H).json()["notes"]
check("the same range narrows the plain list", [n["title"] for n in r], ["Garden"])
r = client.post("/notes/list", json={"created_from": aug["created_to"], "created_to": aug["created_from"]}, headers=H)
check("a backwards range is refused", r.status_code, 400)

r = turn(C, [call("search_notes", query="what was I thinking about", date_from="2026-08-01", date_to="2026-08-31"),
             text("x")], message="what was I thinking about in August?")
check("chat search_notes takes date_from and date_to", [x["title"] for x in r["tool_results"][0]["results"]], ["Garden"])
r = turn(C, [call("list_notes", tags=["work"]), text("x")], message="list my work notes")
check("chat list_notes takes a tag filter", [x["title"] for x in r["tool_results"][0]["notes"]], ["Quarterly plan"])
r = turn(C, [call("create_note", type="text", title="Standup", body="Ship tags", tags=["Work", "meetings"]), text("x")],
         message="note: ship tags, tag it work and meetings")
check("chat can add tags when creating a note", r["tool_results"][0]["note"]["tags"], ["work", "meetings"])
r = turn(C, [call("update_note", note_id=work["id"], body="x", tags=[]), text("x")], message="remove the tags")
check("chat cannot pass tags to update_note", "error" in r["tool_results"][0], True)
check("so the tags survive", store.get(C, work["id"])["tags"], ["work", "planning"])
r = turn(C, [call("pin_note", note_id=work["id"]), text("x")], message="pin it")
check("chat has no pin tool", r["tool_results"][0], {"error": "Unknown tool pin_note"})
names = {s["function"]["name"] for s in __import__("chat.tools", fromlist=["SCHEMAS"]).SCHEMAS}
check("no tool can remove tags or pin", sorted(n for n in names if "tag" in n or "pin" in n), [])
for n in store.list_notes(C):
    store.soft_delete(C, n["id"])
    store.purge(C, n["id"])

print("\n== Answer format")
r = turn(A, [text("From general knowledge: boil it for about 5–6 minutes.")], message="how long to boil an egg?")
check("a general-only answer opens with the nothing-in-notes line",
      reply_text(r).startswith("Nothing in your notes about that.\n\nFrom general knowledge:"), True)
check("en and em dashes are replaced with plain hyphens", "–" in reply_text(r) or "—" in reply_text(r), False)
r = turn(A, [text("Milk and bread (Groceries, 26 September 2026).")], message="what's on my list?")
check("a notes-backed answer is left as written", reply_text(r).strip(), "Milk and bread (Groceries, 26 September 2026).")

print("\n== Cleanup")
for u in (A, B):
    for n in store.list_notes(u) + store.list_notes(u, deleted=True):
        if not n["deleted"]:
            store.soft_delete(u, n["id"])
        store.purge(u, n["id"])
    print(f"  {'A' if u == A else 'B'} notes left: {len(store.list_notes(u)) + len(store.list_notes(u, deleted=True))}")

print(f"\nRESULT: {passed} passed, {failed} failed")
