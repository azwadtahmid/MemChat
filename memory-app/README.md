# MemChat

MemChat is a notes app with an assistant beside it. You write text notes,
checklists, a daily diary and (locally) audio notes; the assistant searches
them by meaning, answers from them with the note it used, and adds to them when
you ask. When your notes have nothing on a question, it says so and answers
from general knowledge, clearly marked. Notes carry tags, can be pinned, and
can be filtered by the date they were written.

**Live:** https://mem-chat.vercel.app

> The backend runs on Render's free tier, which sleeps when idle. The first
> request after a quiet spell can take up to 50 seconds while it wakes; the
> status at the bottom of the rail reads "checking" until then.

## Production architecture

```
 Browser
    │  https://mem-chat.vercel.app
    ▼
 Vercel ───────────── static React build (VITE_API_URL points at Render)
    │
    │  fetch, with the X-User-Id header
    ▼
 Render ───────────── FastAPI (memory-app/backend)
    │                   └─ fastembed BAAI/bge-small-en-v1.5, in process
    ├──────────────▶ Qdrant Cloud   notes, their vectors and payload indexes
    └──────────────▶ Groq           openai/gpt-oss-120b for chat,
                                    whisper-large-v3 for transcription
```

- **Vercel** serves the frontend, a static Vite build. It calls the backend
  directly at `VITE_API_URL`.
- **Render** runs FastAPI: the notes API, the assistant's tool loop, and the
  embeddings. CORS allows only the origins in `ALLOWED_ORIGINS`.
- **Qdrant Cloud** stores every note as one point: its vector plus a payload of
  owner, type, title, body, dates, tags and pin state.
- **Groq** runs the language model for the assistant (`openai/gpt-oss-120b`)
  and speech-to-text (`whisper-large-v3`).
- **fastembed** computes embeddings inside the backend process
  (`BAAI/bge-small-en-v1.5`, 384 dimensions), so no separate embedding
  service is needed. The model (about 65 MB) downloads on first use.

Locally the same code runs against Qdrant in Docker, with the frontend's Vite
dev server proxying `/api` to the backend.

```
memory-app/
  backend/     FastAPI: notes, trash, audio, chat (Qdrant + fastembed + Groq)
    chat/      the assistant: tool loop, tools and their rules, system prompt
    tests/     curl proof of isolation, chat rule checks, live chat scenarios
  frontend/    React + Vite + TypeScript, plain CSS
```

## Run it locally (PowerShell, in this order)

You need Docker Desktop, Python 3.11 or newer, Node.js (current LTS) and a
Groq API key. Open a separate PowerShell window for each step, and start each
one from the repository root.

### 1. Docker and Qdrant

Start **Docker Desktop** first and wait until it says it is running.

```powershell
Set-Location knowledge\mem0\docker
docker compose up -d
```

Qdrant's compose file lives outside `memory-app`, in
`knowledge/mem0/docker/docker-compose.yml`. Check it is up:

```powershell
docker ps --filter name=qdrant                     # STATUS shows "Up"
curl.exe http://localhost:6333/readyz              # prints: all shards are ready
```

Notes are stored on disk in `knowledge/mem0/docker/qdrant_data` (a bind mount),
so they survive `docker compose down` and `docker compose up -d`.

### 2. Backend (port 8000)

First time only, from the repository root:

```powershell
python -m venv .venv
Set-Location memory-app\backend
..\..\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env        # set GROQ_API_KEY (https://console.groq.com/keys)
```

Every time:

```powershell
Set-Location memory-app\backend
..\..\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

The backend reads `.env` only when it starts: restart it after editing `.env`.

Check it is up (from another window):

```powershell
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json -Depth 4
```

`ok` should be `True`, with `qdrant` and `groq` `up` and both Groq models
`available`. If not, `problems` says exactly what is wrong; see
[Troubleshooting](#troubleshooting).

### 3. Frontend (port 5173)

```powershell
Set-Location memory-app\frontend
npm install        # first time only
npm run dev
```

Check it is up:

```powershell
(Invoke-RestMethod http://localhost:5173/api/health).ok   # True: Vite reaches the backend
```

Open http://localhost:5173. The bottom of the rail should read **connected**;
click it for the state of every dependency and your user ID.

## Environment variables

### Backend: `memory-app/backend/.env`

Copy `.env.example` to `.env`. A blank value means the default below. Only
`GROQ_API_KEY` is required locally.

| Variable | Default | What it does |
|---|---|---|
| `GROQ_API_KEY` | (none, required) | Groq API key for chat and transcription |
| `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` | Groq's OpenAI-compatible endpoint |
| `GROQ_CHAT_MODEL` | `openai/gpt-oss-120b` | Chat model. Must support tool calling and be available to your key |
| `GROQ_TRANSCRIBE_MODEL` | `whisper-large-v3` | Speech-to-text for audio notes and voice input |
| `CHAT_REASONING_EFFORT` | `low` | `low`, `medium` or `high`. gpt-oss reasoning tokens count against Groq's per-minute limit |
| `CHAT_SEARCH_LIMIT` | `5` | Notes the assistant sees per search |
| `CHAT_MAX_TOOL_ROUNDS` | `6` | Most tool calls the assistant may chain in one reply |
| `CHAT_HISTORY_MESSAGES` | `40` | Most recent chat messages sent to the model |
| `QDRANT_URL` | `http://localhost:6333` | Full URL including the port. **Production:** the Qdrant Cloud cluster URL, with `:6333` |
| `QDRANT_API_KEY` | (none) | **Production:** the Qdrant Cloud API key. Not needed locally |
| `NOTES_COLLECTION` | `notes` | Qdrant collection, created automatically with its payload indexes |
| `EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | fastembed model |
| `EMBED_DIMS` | `384` | Must match the embedding model |
| `EMBED_CACHE_DIR` | `backend/.model_cache` | Where the embedding model is kept after download |
| `AUDIO_NOTES_ENABLED` | on, off on Render | Whether audio notes can be recorded. Detected from Render's `RENDER=true`; set `true` or `false` to override |
| `AUDIO_DIR` | `backend/audio_files` | Where recordings are stored |
| `AUDIO_MAX_MB` | `25` | Largest recording accepted (Groq's Whisper limit) |
| `AUDIO_TOKEN_SECRET` | random per start | Signs audio links. Set it so links survive restarts |
| `AUDIO_TOKEN_TTL_SECONDS` | `900` | How long an audio link works (15 minutes) |
| `TRASH_RETENTION_DAYS` | `30` | Trashed notes older than this are removed at startup |
| `SEARCH_LIMIT` | `8` | Results for the search box in the notes view |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | Browser origins allowed to call the API, comma separated, no trailing slash. **Production:** `https://mem-chat.vercel.app` |

`QDRANT_HOST`, `QDRANT_PORT`, `QDRANT_COLLECTION`, `EMBEDDING_DIMS`,
`MEMORY_TOP_K`, `MEM0_TELEMETRY` and the `OLLAMA_*` variables belong to earlier
versions. They are ignored and can be deleted from `.env`.

### Frontend: `memory-app/frontend/.env`

| Variable | Default | What it does |
|---|---|---|
| `VITE_API_URL` | `/api` | Backend origin, no trailing slash and no `/api`. Blank locally, so the Vite dev proxy is used. **Production:** `https://memchat-api.onrender.com`. Read at build time: redeploy after changing it |

### Production, in one place

| Where | Variable | Value |
|---|---|---|
| Render | `GROQ_API_KEY` | your Groq key |
| Render | `QDRANT_URL` | `https://<cluster>.<region>.cloud.qdrant.io:6333` |
| Render | `QDRANT_API_KEY` | your Qdrant Cloud key |
| Render | `ALLOWED_ORIGINS` | `https://mem-chat.vercel.app` |
| Render | `AUDIO_TOKEN_SECRET` | optional, any long random string |
| Vercel | `VITE_API_URL` | `https://memchat-api.onrender.com` |

## Your notes and who can see them

**Per-user isolation.** Each browser makes a random UUID on its first visit and
keeps it in localStorage. Every request sends it in the `X-User-Id` header,
never in a URL, so it stays out of access logs and browser history. Every
read, search, write and chat tool call is filtered by that ID in the backend
(`backend/store.py`), and fetching a note by ID also checks its owner, so one
browser cannot see or change another's notes. Audio playback is the one
request that cannot send a header; it uses a signed link that expires after 15
minutes and does not contain the user ID.

**Its limits.** This is isolation, not privacy from the operator:

- **Notes are stored unencrypted.** Titles and bodies sit in Qdrant as plain
  text, and whoever runs the backend and the Qdrant cluster can read them.
- **The UUID is the only credential.** There is no account or password. Anyone
  who has the ID can read those notes, and clearing this site's data (or using
  another browser or device) starts a new, empty set. The old notes cannot be
  recovered from the app.
- **The assistant sends note content to Groq.** When you use the assistant or
  speak a message, the relevant notes and your words go to Groq to produce the
  answer.
- **Deleted notes are purged after 30 days** in the trash
  (`TRASH_RETENTION_DAYS`).

The app says the same in plain words: a line in the empty notes view, and
"How your notes are kept" in the rail and the status popover.

## Known limitations

- **Audio notes are local only.** Recordings are files on the backend's disk,
  and Render's free-tier disk is wiped on every restart and deploy. The hosted
  backend therefore refuses new audio notes with a plain message, and the app
  marks the option as unavailable. A note whose recording is gone keeps its
  transcript and says the recording was not kept. Voice input in chat works
  everywhere, since it stores nothing. Hosting audio needs object storage
  (for example S3 or Cloudflare R2).
- **Chat history is not persisted.** The browser holds the conversation and
  sends it with each message; the backend keeps no chat state. Reloading the
  page or "New conversation" starts afresh.
- **No accounts.** Identity is the browser's UUID, with the limits above.

## How it works

### Notes

- One Qdrant point per note: `user_id, type, title, body, created, updated,
  deleted, deleted_at, previous_body, tags, pinned, pinned_at`, plus
  `audio_path` for audio notes and `entry_date` for diary notes. Payload
  indexes on `user_id`, `type`, `deleted`, `deleted_at`, `entry_date`, `tags`,
  `pinned` and `created` make every filter an exact lookup.
- Every body is markdown. Lists are `- [ ]` and `- [x]` lines; ticking a box
  rewrites that line.
- **Undo:** every change to a body (edit, append, checkbox, undo) saves the old
  body to `previous_body` in the same write. Undo swaps them, so undo twice redoes.
  A title-only edit leaves the undo slot alone.
- **Diary:** one entry per day, titled with its date. Adding to the diary on a
  day that already has an entry appends to it.
- **Tags** are lowercase and set in the editor; click one on a card to filter
  the notes view. **Pinned** notes sort above the rest. Neither counts as an
  edit: they do not change "last edited" or the note's embedding, so an open
  editor never sees them as a conflict.
- **Date filtering:** the "Created" control narrows the list and the similarity
  search by the date a note was created, in your own timezone, as a filter in
  the same Qdrant query.
- **Delete is soft:** the note moves to the trash and disappears from the notes
  view, search and the assistant. Restore brings it back; permanent delete
  removes the Qdrant point and any audio file.

### The assistant

It checks your notes first and cites the note title and date for every claim
that comes from them. When your notes have nothing relevant, it says so in one
line and answers from general knowledge, in a separate paragraph that starts
"From general knowledge:", so a notes-backed claim is never mixed up with a
general one. Questions about your own life or data (a passport number, what you
did last week) are answered only from notes; if the notes do not have it, it
says so rather than guessing. It can narrow a search by tag and by a date range
("what was I thinking about in August"), and add tags when it creates a note.
That answering style is set in the prompt (`backend/chat/prompt.py`). These
rules are enforced in code (`backend/chat/tools.py`), not only in the prompt:

- Deleting requires a confirmation for that exact note, asked with the note's
  title, type and last-edited date. If more than one note could be meant, it
  asks which one first, as a separate question.
- Voice messages cannot delete anything.
- Past diary entries cannot be changed, diary entries cannot be rewritten, and
  diary notes cannot be deleted from chat.
- A note open in the editor with unsaved changes is never written to; the
  assistant says which note it could not touch.
- It can add tags only when creating a note. It has no way to remove or change
  tags, and none to pin or unpin.

## API

Every endpoint except `/health` and the signed audio link requires the
`X-User-Id` header with a UUID; a missing or malformed one is rejected with 422.

```powershell
$h = @{ 'X-User-Id' = [guid]::NewGuid().ToString() }

Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8000/notes -Method Post -Headers $h -ContentType 'application/json' `
  -Body (@{ type = 'list'; title = 'Groceries'; body = "milk`nbread"; tags = @('home') } | ConvertTo-Json)
Invoke-RestMethod http://localhost:8000/notes -Headers $h
Invoke-RestMethod http://localhost:8000/notes/search -Method Post -Headers $h -ContentType 'application/json' `
  -Body (@{ query = 'shopping'; tags = @('home') } | ConvertTo-Json)
```

| Method and path | What it does |
|---|---|
| `GET /health` | Which dependency is failing, if any |
| `GET /notes?type=` | Your notes, pinned first, then most recently edited |
| `POST /notes/list` | The same list narrowed by `tags` and a `created_from` / `created_to` range (JSON body) |
| `POST /notes/search` | Similarity search, with the same optional filters (JSON body, so search text stays out of logs) |
| `POST /notes` | Create, optionally with `tags` (diary: appends to today's entry if there is one) |
| `GET /notes/{id}` | One note, with a signed `audio_url` for audio notes whose recording exists |
| `PUT /notes/{id}` | Edit. Send `expected_updated` to get a 409 instead of overwriting newer changes |
| `PUT /notes/{id}/tags` | Replace the note's tags |
| `PUT /notes/{id}/pin` | Pin or unpin |
| `POST /notes/{id}/append` | Add text to the end |
| `POST /notes/{id}/undo` | Swap back to the previous body |
| `DELETE /notes/{id}` | Move to the trash |
| `GET /trash` | Deleted notes |
| `POST /trash/{id}/restore` | Restore from the trash |
| `DELETE /trash/{id}` | Delete permanently |
| `POST /notes/audio` | Upload a recording; transcribed and saved as an audio note (501 where audio notes are off) |
| `GET /notes/{id}/audio?expires=&sig=` | Play a recording (signed link, no header) |
| `POST /transcribe` | Voice input for chat; returns text only |
| `POST /chat` | One assistant turn, streamed as newline-delimited JSON |

Errors always look like this and never contain a traceback:

```json
{"error": "service_unavailable",
 "problems": [{"service": "groq", "message": "Groq is rate limiting requests",
               "hint": "Try again in about 17 seconds."}]}
```

## Troubleshooting

The banner at the top of the app names the problem. Find it below, fix it, then
click **Check again** in the status popover.

### The hosted app says "checking" for a long time

The Render backend is waking from sleep. Give it up to 50 seconds.

### "Qdrant is not reachable at http://localhost:6333"

Docker Desktop is not running, or the container is stopped
(`docker ps -a --filter name=qdrant` shows `Exited`). Start Docker Desktop, then
run `docker compose up -d` from `knowledge\mem0\docker`. On Render, check
`QDRANT_URL` (with `:6333`) and `QDRANT_API_KEY`.

### "GROQ_API_KEY is not set"

Add `GROQ_API_KEY=...` to `memory-app\backend\.env`, then restart the backend.

### "Groq rejected the API key"

The key is wrong or revoked. Create a new one at https://console.groq.com/keys,
put it in `.env`, and restart the backend.

### "Groq is unreachable"

No internet connection, or Groq is down. Notes, search and the trash still work;
only the assistant, audio notes and voice input need Groq.

### "Groq is rate limiting requests"

Groq's free tier limits tokens per minute (8,000 for gpt-oss-120b on the account
this was built with). One assistant reply can use a large share of that. Short
waits (10 seconds or less) are retried automatically, and the reply says so;
longer ones end with this message and the wait time. To use fewer tokens, keep
`CHAT_REASONING_EFFORT=low` and lower `CHAT_SEARCH_LIMIT`.

### "Model ... is not available on Groq"

Groq retires models. The backend log lists the models your key can use; set
`GROQ_CHAT_MODEL` (it must support tool calling) or `GROQ_TRANSCRIBE_MODEL` in
`.env` and restart. `llama-3.3-70b-versatile` is no longer available, which is
why the default is `openai/gpt-oss-120b`.

### "The embedding model could not be loaded"

It downloads from Hugging Face the first time; check your connection. If the
download was interrupted, delete `backend\.model_cache` and restart.

### "The backend is not running"

Start it (step 2). If uvicorn says port 8000 is in use:
`Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess`.
On the hosted app, a request blocked by CORS looks the same: check that
`ALLOWED_ORIGINS` on Render includes the exact Vercel URL.

### "The backend hit an unexpected error"

A bug. The traceback is in the backend's log; the app never shows it.

### "Audio notes are not available in the hosted version yet"

Expected on Render; see [Known limitations](#known-limitations).

### "Microphone access is blocked"

Allow the microphone for the site in the browser's address bar, then try again.

### "... was changed since you opened it"

The assistant (or another tab) edited the note while it was open. Your edits
are still on screen; copy anything you need, then load the latest version.

## Tests

With Qdrant and the backend running, from the repository root:

```powershell
# Isolation, header-only identity, undo, diary and trash (needs Git Bash)
& "C:\Program Files\Git\bin\bash.exe" -c "PY=.venv/Scripts/python.exe bash memory-app/backend/tests/curl_checks.sh"

Set-Location memory-app\backend

# Chat rules enforced in code, tags, pins and date ranges, with a scripted fake model (no Groq tokens used)
..\..\.venv\Scripts\python.exe tests\chat_rules_test.py

# Real conversations with the real model (uses Groq tokens, takes a few minutes)
..\..\.venv\Scripts\python.exe tests\chat_live.py
```

Each test uses throwaway user IDs and deletes everything it created.
