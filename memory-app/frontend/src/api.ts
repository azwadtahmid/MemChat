export interface MemoryItem {
  id: string
  memory: string
  score: number | null
  created_at: string | null
}

/** One thing that is wrong, named specifically, with how to fix it. */
export interface Problem {
  service: 'qdrant' | 'ollama' | 'model' | 'backend'
  message: string
  hint?: string
}

export type ModelState = 'pulled' | 'missing' | 'unknown'

export interface Health {
  ok: boolean
  services: {
    qdrant: 'up' | 'down'
    ollama: 'up' | 'down'
    models: Record<string, ModelState>
  }
  problems: Problem[]
  config: { model: string; collection: string }
}

// One line of the NDJSON stream returned by POST /chat.
export type ChatEvent =
  | { type: 'memories'; memories: MemoryItem[] }
  | { type: 'token'; content: string }
  | { type: 'done'; reply: string }
  | { type: 'stored'; count: number }
  | { type: 'error'; message: string; hint?: string }

/** Thrown for any failure the UI should show to the user as a list of problems. */
export class ServiceError extends Error {
  problems: Problem[]
  constructor(problems: Problem[]) {
    super(problems.map((p) => p.message).join('. '))
    this.problems = problems
  }
}

export const BACKEND_DOWN: Problem = {
  service: 'backend',
  message: 'The backend is not running',
  hint: 'Start it from memory-app/backend with: uvicorn main:app --port 8000',
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, init)
  } catch {
    throw new ServiceError([BACKEND_DOWN])
  }
  if (res.ok) return res

  // The backend always answers errors with {"problems": [...]}.
  let body: { problems?: Problem[] } | null = null
  try {
    body = await res.json()
  } catch {
    // Not JSON: the Vite proxy's own error page, meaning FastAPI is not running.
  }
  if (body?.problems?.length) throw new ServiceError(body.problems)
  if (res.status >= 500) throw new ServiceError([BACKEND_DOWN])
  throw new ServiceError([
    { service: 'backend', message: `The backend rejected the request (HTTP ${res.status})` },
  ])
}

export async function getHealth(): Promise<Health> {
  return (await request('/health')).json()
}

// Every memory request carries the caller's id; the backend rejects any request without one.
const userQuery = (userId: string) => `?user_id=${encodeURIComponent(userId)}`

export async function listMemories(userId: string): Promise<MemoryItem[]> {
  return (await (await request(`/memories${userQuery(userId)}`)).json()).memories
}

export async function clearMemories(userId: string): Promise<void> {
  await request(`/memories${userQuery(userId)}`, { method: 'DELETE' })
}

export async function streamChat(
  userId: string,
  message: string,
  onEvent: (e: ChatEvent) => void,
): Promise<void> {
  const res = await request('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, user_id: userId }),
  })

  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    // Chunks can split a line in half, so only parse up to the last newline.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line))
    }
  }
}
