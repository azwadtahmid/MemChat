# MemChat

MemChat is a local chat app with persistent, per-user memory. Each message runs
the same loop as `knowledge/mem0/oss/memory_demo.py`:

1. Search the user's stored memories for the message (mem0 + Qdrant, `nomic-embed-text` embeddings).
2. Build a system prompt that includes those memories.
3. Stream a reply from `llama3.2:3b` through Ollama.
4. Save the exchange back into that user's memory (mem0 extracts facts with the same model).

```
memory-app/
  backend/    FastAPI: /chat (streaming), /memories, /health
  frontend/   React + Vite + TypeScript
```

Qdrant itself is defined outside this folder, in `knowledge/mem0/docker/docker-compose.yml`.

## Start everything (PowerShell, in this order)

Open a separate PowerShell window for each step. Every block starts from the repo
root, so it works no matter where the window opened.

### 1. Docker and Qdrant

Start **Docker Desktop** first and wait until it says it is running.

```powershell
Set-Location C:\Users\azwad\Downloads\ai-cookbook\knowledge\mem0\docker
docker compose up -d
```

Check it is up:

```powershell
docker version --format '{{.Server.Version}}'        # prints a version, not an error
docker ps --filter name=qdrant                        # STATUS shows "Up"
curl.exe http://localhost:6333/readyz                 # prints: all shards are ready
curl.exe http://localhost:6333/collections            # lists mem0_ollama
```

Memories are stored on disk in `knowledge/mem0/docker/qdrant_data` (a bind mount),
so they survive `docker compose down` and `docker compose up -d`.

### 2. Ollama

If the Ollama desktop app is running (llama icon in the system tray), Ollama is
already up. Otherwise:

```powershell
ollama serve
```

Check it is up, and that both models are pulled (in another window if `ollama serve` is running):

```powershell
curl.exe http://localhost:11434/api/version   # prints {"version":"..."}
ollama list                                    # shows llama3.2:3b and nomic-embed-text:latest
```

If a model is missing:

```powershell
ollama pull llama3.2:3b
ollama pull nomic-embed-text
```

### 3. Backend (port 8000)

First time only:

```powershell
Set-Location C:\Users\azwad\Downloads\ai-cookbook\memory-app\backend
Copy-Item .env.example .env
..\..\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Every time:

```powershell
Set-Location C:\Users\azwad\Downloads\ai-cookbook\memory-app\backend
..\..\.venv\Scripts\python.exe -m uvicorn main:app --port 8000
```

Calling the venv's `python.exe` directly means you do not need to activate the
venv, so PowerShell's script execution policy does not get in the way.

Check it is up (from another window):

```powershell
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json -Depth 4
```

`ok` should be `True`, with Qdrant and Ollama `up` and both models `pulled`. If
`ok` is `False`, the `problems` list says exactly what is wrong; see
[Troubleshooting](#troubleshooting).

### 4. Frontend (port 5173)

```powershell
Set-Location C:\Users\azwad\Downloads\ai-cookbook\memory-app\frontend
npm install        # first time only
npm run dev
```

Check it is up:

```powershell
(Invoke-RestMethod http://localhost:5173/api/health).ok   # True: Vite is reaching the backend
```

Then open http://localhost:5173. The top right should read **connected**. Click
it to see the model, collection, your user ID and the state of each service.

## Your user ID

Every browser gets its own ID (a random UUID) the first time it opens MemChat.
It is kept in the browser's localStorage, and every memory is stored under it,
so different browsers never see each other's memories. The ID is shown at the
bottom of the memory panel and in the status popover.

**Clearing site data for localhost:5173 (or using a private window) gives you a
new, empty ID.** The old memories are still in Qdrant but no longer reachable
from that browser.

This keeps users separate, but it is not authentication: anyone who knows an ID
can read its memories through the API. That is fine for local use on your own
machine; do not expose the backend to a network as-is.

Memories created before per-user IDs existed are stored under the old shared id
`default_user`. The app no longer accepts that id, so they are not visible in
the UI, but they are still in Qdrant.

## Configuration

`backend/.env` (copied from `.env.example`):

| Key | Default | Meaning |
|---|---|---|
| `OLLAMA_MODEL` | `llama3.2:3b` | Chat model, also used by mem0 to extract facts |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Embedding model |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | |
| `QDRANT_HOST` / `QDRANT_PORT` | `localhost` / `6333` | |
| `QDRANT_COLLECTION` | `mem0_ollama` | Same collection as the demo script |
| `EMBEDDING_DIMS` | `768` | Must match the embedding model |
| `MEMORY_TOP_K` | `3` | Memories retrieved per message |
| `MEM0_TELEMETRY` | `False` | mem0 sends usage data to PostHog when `True` |

There is deliberately no user id setting: the id always comes from the caller.

## API

Every memory endpoint requires `user_id`, a UUID. A missing or malformed id is
rejected with HTTP 422. These examples work in Windows PowerShell 5.1 and PowerShell 7:

```powershell
$u = [guid]::NewGuid().ToString()

# Health (no user id: it reads no user data)
curl.exe http://localhost:8000/health

# List and clear one user's memories
curl.exe "http://localhost:8000/memories?user_id=$u"
curl.exe -X DELETE "http://localhost:8000/memories?user_id=$u"

# Chat (streams). The JSON body is piped in on stdin, which avoids
# PowerShell 5.1 stripping the quotes out of command-line arguments.
@{ message = 'What do you remember about me?'; user_id = $u } | ConvertTo-Json -Compress |
  curl.exe -N -X POST http://localhost:8000/chat -H "Content-Type: application/json" --data-binary '@-'
```

`POST /chat` streams newline-delimited JSON, one event per line:

```
{"type": "memories", "memories": [...]}   memories retrieved for this message
{"type": "token", "content": "..."}        part of the reply
{"type": "done", "reply": "..."}           reply finished
{"type": "stored", "count": 2}             exchange saved to memory
{"type": "error", "message": "...", "hint": "..."}   generation or saving failed
```

Errors always have the same shape, and never contain a traceback:

```json
{"error": "service_unavailable",
 "problems": [{"service": "ollama",
               "message": "Ollama is not running at http://localhost:11434",
               "hint": "Start the Ollama app, or run: ollama serve"}]}
```

| Status | `error` | When |
|---|---|---|
| 503 | `service_unavailable` | Qdrant or Ollama is down, or a model is not pulled |
| 422 | `invalid_request` | `user_id` missing or not a UUID, or an empty message |
| 500 | `internal_error` | A bug; the traceback is in the backend window only |

`/chat` needs everything. `/memories` needs only Qdrant once the backend has
talked to Ollama once, so the memory list keeps working if Ollama stops later.

## Troubleshooting

The red banner at the top of the app names the problem. Find it below.

### "Qdrant is not reachable at http://localhost:6333"

- Docker Desktop is not running: start it, wait until it says running, then
  `docker compose up -d` from `knowledge\mem0\docker`.
- The container is stopped: `docker ps -a --filter name=qdrant` shows `Exited`.
  Run `docker compose up -d` from `knowledge\mem0\docker`.
- Something else is using port 6333:
  `Get-NetTCPConnection -LocalPort 6333 -State Listen | Select-Object OwningProcess`.

Then click **Check again** in the status popover.

### "Ollama is not running at http://localhost:11434"

- Start the Ollama app, or run `ollama serve`.
- If `ollama serve` says the address is already in use, Ollama is already
  running; check `curl.exe http://localhost:11434/api/version`.
- If Ollama runs on a different address, set `OLLAMA_BASE_URL` in `backend/.env`
  and restart the backend.

### "Model llama3.2:3b is not pulled" (or nomic-embed-text)

- Run the `ollama pull ...` command shown in the banner, then **Check again**.
- `ollama list` shows what is installed. The name in `backend/.env` must match
  it (`nomic-embed-text` matches `nomic-embed-text:latest`).

### "The backend is not running"

- Start it (step 3). If uvicorn says port 8000 is already in use, find what
  holds it: `Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess`.
- If uvicorn exits at startup, the error is in that window. The most common
  cause is a missing package: rerun the `pip install -r requirements.txt` line.

### "The backend hit an unexpected error"

A bug rather than a stopped service. The full traceback is printed in the
backend's PowerShell window; the UI deliberately does not show it.

### "The request is missing or has an invalid user_id"

The ID in this browser's storage was edited or corrupted. Clear site data for
localhost:5173 to get a new ID (this starts an empty history).

### Other things that look like errors but are not

- **Saving to memory takes one to two minutes.** After each reply, mem0 sends a
  long extraction prompt to the chat model, which is slow on CPU. A new message
  sent meanwhile waits behind it, because Ollama handles one request at a time.
- **The status check takes about two seconds when a service is down.** On
  Windows, a connection to a closed port takes about two seconds to fail.
- **The page loads with no styling.** Stop the frontend (Ctrl+C) and run
  `npm run dev` again.

## Notes

- mem0 API in the installed version (2.1.0): `search()` and `get_all()` take
  `filters={"user_id": ...}` and `top_k` (not `limit`); `add()` and
  `delete_all()` take `user_id=` directly.
- mem0's Ollama embedder contacts Ollama when it starts, and would download the
  embedding model if it were missing. The backend checks for the model first
  and reports it instead, so nothing is downloaded without you running `ollama pull`.
- **No conversation history is sent to the model**, same as the demo: each reply
  sees only the current message and the retrieved memories.
