# MemChat

A local notes app with an assistant that answers from your notes first (and from
general knowledge, clearly marked, when they have nothing) and can add to them. Four note types (text, list, diary, audio), a trash with restore, and a
chat panel available from every view.

```
memory-app/
  backend/     FastAPI: notes, trash, audio, chat (Qdrant + fastembed + Groq)
    chat/      the assistant: tool loop, tools and their rules, system prompt
    tests/     curl proof of isolation, chat rule checks, live chat scenarios
  frontend/    React + Vite + TypeScript
```

- **Storage:** Qdrant, one point per note, in a collection called `notes`.
- **Embeddings:** fastembed `BAAI/bge-small-en-v1.5` (384 dims), running locally.
  The model (about 65 MB) downloads from Hugging Face on first use.
- **Chat and transcription:** Groq. Chat uses `openai/gpt-oss-120b`,
  transcription uses `whisper-large-v3`.
- **No Ollama.** The earlier mem0 version needed it; this one does not.

Qdrant itself is defined outside this folder, in `knowledge/mem0/docker/docker-compose.yml`.

## Start everything (PowerShell, in this order)

Open a separate PowerShell window for each step. Every block starts from the repo
root, so it works wherever the window opened.

### 1. Docker and Qdrant

Start **Docker Desktop** first and wait until it says it is running.

```powershell
Set-Location C:\Users\azwad\Downloads\ai-cookbook\knowledge\mem0\docker
docker compose up -d
```

Check it is up:

```powershell
docker ps --filter name=qdrant                     # STATUS shows "Up"
curl.exe http://localhost:6333/readyz              # prints: all shards are ready
```

Notes are stored on disk in `knowledge/mem0/docker/qdrant_data` (a bind mount),
so they survive `docker compose down` and `docker compose up -d`.

### 2. Backend (port 8000)

First time only:

```powershell
Set-Location C:\Users\azwad\Downloads\ai-cookbook\memory-app\backend
..\..\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env        # set GROQ_API_KEY (https://console.groq.com/keys)
```

Every time:

```powershell
Set-Location C:\Users\azwad\Downloads\ai-cookbook\memory-app\backend
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
Set-Location C:\Users\azwad\Downloads\ai-cookbook\memory-app\frontend
npm install        # first time only
npm run dev
```

Check it is up:

```powershell
(Invoke-RestMethod http://localhost:5173/api/health).ok   # True: Vite reaches the backend
```

Open http://localhost:5173. The top right should read **connected**; click it
for the state of every dependency and your user ID.

## Environment variables

All live in `memory-app/backend/.env`. Only `GROQ_API_KEY` is required; every
other variable has the default shown.

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
| `QDRANT_HOST` | `localhost` | |
| `QDRANT_PORT` | `6333` | |
| `NOTES_COLLECTION` | `notes` | Qdrant collection, created automatically |
| `EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | fastembed model |
| `EMBED_DIMS` | `384` | Must match the embedding model |
| `EMBED_CACHE_DIR` | `backend/.model_cache` | Where the embedding model is kept after download |
| `AUDIO_DIR` | `backend/audio_files` | Where recordings are stored (see [Audio storage](#audio-storage-before-deploying)) |
| `AUDIO_MAX_MB` | `25` | Largest recording accepted (Groq's Whisper limit) |
| `AUDIO_TOKEN_SECRET` | random per start | Signs audio links. Set it so links survive restarts |
| `AUDIO_TOKEN_TTL_SECONDS` | `900` | How long an audio link works (15 minutes) |
| `TRASH_RETENTION_DAYS` | `30` | Trashed notes older than this are removed at startup |
| `SEARCH_LIMIT` | `8` | Results for the search box in the notes view |

`QDRANT_COLLECTION`, `EMBEDDING_DIMS`, `MEMORY_TOP_K`, `MEM0_TELEMETRY` and the
`OLLAMA_*` variables belong to the old mem0 version. They are ignored and can
be deleted from `.env`.

## How it works

### Your user ID

Each browser creates a random ID on first load and keeps it in localStorage.
Every request sends it in the `X-User-Id` header (never in a URL, so it stays
out of access logs and browser history). Notes, search, chat and trash are all
scoped to it. The ID is shown in the status popover.

**Clearing site data for localhost:5173, or a private window, gives you a new,
empty set of notes.** The ID is the only credential: anyone who has it can read
those notes. Fine on your own machine; add real authentication before exposing
the backend to a network.

Audio files are the one exception to the header rule, because an `<audio>`
element cannot send headers. `GET /notes/{id}` returns a signed link that
expires after 15 minutes and does not contain the user ID.

### Notes

- One Qdrant point per note: `user_id, type, title, body, created, updated,
  deleted, deleted_at, previous_body`, plus `audio_path` for audio notes and
  `entry_date` for diary notes.
- Every body is markdown. Lists are `- [ ]` and `- [x]` lines; ticking a box
  rewrites that line.
- **Undo:** every change to a body (edit, append, checkbox, undo) saves the old
  body to `previous_body` in the same write. Undo swaps them, so undo twice redoes.
  A title-only edit leaves the undo slot alone.
- **Diary:** one entry per day, titled with its date. Adding to the diary on a
  day that already has an entry appends to it.
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
says so rather than guessing. That answering style is set in the prompt
(`backend/chat/prompt.py`). These rules are enforced in code
(`backend/chat/tools.py`), not only in the prompt:

- Deleting requires a confirmation for that exact note, asked with the note's
  title, type and last-edited date (the server writes that question). If more
  than one note could be meant, it asks which one first, as a separate question.
- Voice messages cannot delete anything.
- Past diary entries cannot be changed, diary entries cannot be rewritten, and
  diary notes cannot be deleted from chat.
- A note open in the editor with unsaved changes is never written to; the
  assistant says which note it could not touch.

The browser keeps the chat history and sends it with each message, so the
backend stores no conversation state. "New conversation" clears it.

### Audio storage before deploying

Recordings are saved on local disk under `backend/audio_files/<user id>/`. **This
must move to object storage (for example S3 or Cloudflare R2) before deploying to
Render:** Render's disk is ephemeral and is wiped on every deploy and restart,
which would lose every recording while the notes still point at them. Only the
transcript is embedded and searchable; the audio file is for playback.

## API

Every endpoint except `/health` and the signed audio link requires the
`X-User-Id` header with a UUID; a missing or malformed one is rejected with 422.

```powershell
$h = @{ 'X-User-Id' = [guid]::NewGuid().ToString() }

Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8000/notes -Method Post -Headers $h -ContentType 'application/json' `
  -Body (@{ type = 'list'; title = 'Groceries'; body = "milk`nbread" } | ConvertTo-Json)
Invoke-RestMethod http://localhost:8000/notes -Headers $h
Invoke-RestMethod http://localhost:8000/notes/search -Method Post -Headers $h -ContentType 'application/json' `
  -Body (@{ query = 'shopping' } | ConvertTo-Json)
```

| Method and path | What it does |
|---|---|
| `GET /health` | Which dependency is failing, if any |
| `GET /notes?type=` | Your notes, most recently edited first |
| `POST /notes/search` | Similarity search (JSON body, so search text stays out of logs) |
| `POST /notes` | Create (diary: appends to today's entry if there is one) |
| `GET /notes/{id}` | One note, with a signed `audio_url` for audio notes |
| `PUT /notes/{id}` | Edit. Send `expected_updated` to get a 409 instead of overwriting newer changes |
| `POST /notes/{id}/append` | Add text to the end |
| `POST /notes/{id}/undo` | Swap back to the previous body |
| `DELETE /notes/{id}` | Move to the trash |
| `GET /trash` | Deleted notes |
| `POST /trash/{id}/restore` | Restore from the trash |
| `DELETE /trash/{id}` | Delete permanently |
| `POST /notes/audio` | Upload a recording; transcribed and saved as an audio note |
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

### "Qdrant is not reachable at http://localhost:6333"

Docker Desktop is not running, or the container is stopped
(`docker ps -a --filter name=qdrant` shows `Exited`). Start Docker Desktop, then
run `docker compose up -d` from `knowledge\mem0\docker`.

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

### "The backend hit an unexpected error"

A bug. The traceback is in the backend's PowerShell window; the app never shows it.

### "Microphone access is blocked"

Allow the microphone for localhost:5173 in the browser's address bar, then try again.

### "... was changed since you opened it"

The assistant (or another tab) edited the note while it was open. Your edits
are still on screen; copy anything you need, then load the latest version.

## Tests

With the backend running:

```powershell
Set-Location C:\Users\azwad\Downloads\ai-cookbook\memory-app\backend

# Isolation, header-only identity, undo, diary and trash (Git Bash required for this one)
& "C:\Program Files\Git\bin\bash.exe" -c "cd /c/Users/azwad/Downloads/ai-cookbook && PY=.venv/Scripts/python.exe bash memory-app/backend/tests/curl_checks.sh"

# Chat rules enforced in code, with a scripted fake model (no Groq tokens used)
..\..\.venv\Scripts\python.exe tests\chat_rules_test.py

# Real conversations with the real model (uses Groq tokens, takes a few minutes)
..\..\.venv\Scripts\python.exe tests\chat_live.py
```

Each test uses throwaway user IDs and deletes everything it created.
