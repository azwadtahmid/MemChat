// Every call to the backend goes through request(), which adds the X-User-Id
// header (the user id never goes in a URL) and the caller's local date for
// diary entries.

import { loadUserIdentity } from './userId'

export const identity = loadUserIdentity()

// Where the backend lives. In dev, VITE_API_URL is unset and requests go to
// /api, which the Vite proxy forwards to the backend with /api stripped. In a
// production build there is no proxy, so VITE_API_URL names the backend's
// origin directly; its paths have no /api prefix, so none is added.
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '') || '/api'

export type NoteType = 'text' | 'list' | 'diary' | 'audio'

export interface Note {
  id: string
  type: NoteType
  title: string
  body: string
  created: string
  updated: string
  deleted: boolean
  deleted_at: string | null
  has_undo: boolean
  entry_date?: string
  audio_url?: string
  score?: number
}

/** One thing that is wrong, named specifically, with how to fix it. */
export interface Problem {
  service: string
  message: string
  hint?: string | null
}

export interface Health {
  ok: boolean
  services: Record<string, string>
  problems: Problem[]
  config: {
    chat_model: string
    transcribe_model: string
    embed_model: string
    collection: string
    trash_retention_days: number
  }
}

export interface AskOption {
  label: string
  value: string
  note_id: string | null
}

export type ChatEvent =
  | { type: 'token'; content: string }
  | { type: 'activity'; tool: string }
  | { type: 'notice'; message: string }
  | { type: 'note_changed'; action: string; note: Note }
  | { type: 'ask_user'; tool_call_id: string; question: string; options: AskOption[] }
  | { type: 'messages'; messages: unknown[] }
  | { type: 'error'; message: string; hint?: string | null }
  | { type: 'done' }

export class ServiceError extends Error {
  problems: Problem[]
  status: number
  constructor(problems: Problem[], status = 0) {
    super(problems.map((p) => p.message).join('. '))
    this.problems = problems
    this.status = status
  }
}

export const BACKEND_DOWN: Problem = {
  service: 'backend',
  message: 'The backend is not running',
  hint: 'Start it from memory-app/backend with: uvicorn main:app --port 8000',
}

export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-User-Id', identity.id)
  headers.set('X-Client-Date', localDate())
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  } catch {
    throw new ServiceError([BACKEND_DOWN])
  }
  if (res.ok) return res
  let body: { problems?: Problem[] } | null = null
  try {
    body = await res.json()
  } catch {
    // Not JSON: the Vite proxy's own error page, meaning FastAPI is not running.
  }
  if (body?.problems?.length) throw new ServiceError(body.problems, res.status)
  if (res.status >= 500) throw new ServiceError([BACKEND_DOWN], res.status)
  throw new ServiceError(
    [{ service: 'backend', message: `The backend rejected the request (HTTP ${res.status})` }],
    res.status,
  )
}

const json = async <T,>(res: Promise<Response>): Promise<T> => (await res).json()
const send = (method: string, body?: unknown): RequestInit => ({
  method,
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const api = {
  health: () => json<Health>(request('/health')),

  listNotes: (type?: NoteType) =>
    json<{ notes: Note[] }>(request(`/notes${type ? `?type=${type}` : ''}`)).then((r) => r.notes),
  // A POST body, so search text stays out of URLs and access logs.
  searchNotes: (query: string, type?: NoteType) =>
    json<{ notes: Note[] }>(request('/notes/search', send('POST', { query, type }))).then((r) => r.notes),
  getNote: (id: string) => json<{ note: Note }>(request(`/notes/${id}`)).then((r) => r.note),
  createNote: (type: NoteType, title: string, body: string) =>
    json<{ note: Note; appended_to_existing: boolean }>(request('/notes', send('POST', { type, title, body }))),
  updateNote: (id: string, change: { title?: string; body?: string; expected_updated?: string }) =>
    json<{ note: Note }>(request(`/notes/${id}`, send('PUT', change))).then((r) => r.note),
  undoNote: (id: string) => json<{ note: Note }>(request(`/notes/${id}/undo`, send('POST'))).then((r) => r.note),
  deleteNote: (id: string) => json<{ note: Note }>(request(`/notes/${id}`, send('DELETE'))).then((r) => r.note),

  listTrash: () => json<{ notes: Note[]; retention_days: number }>(request('/trash')),
  restoreNote: (id: string) =>
    json<{ note: Note }>(request(`/trash/${id}/restore`, send('POST'))).then((r) => r.note),
  purgeNote: (id: string) => request(`/trash/${id}`, send('DELETE')).then(() => undefined),

  createAudioNote: (audio: Blob, title = '') => {
    const form = new FormData()
    form.append('file', audio, `recording.${extension(audio.type)}`)
    form.append('title', title)
    return json<{ note: Note }>(request('/notes/audio', { method: 'POST', body: form })).then((r) => r.note)
  },
  transcribe: (audio: Blob) => {
    const form = new FormData()
    form.append('file', audio, `voice.${extension(audio.type)}`)
    return json<{ text: string }>(request('/transcribe', { method: 'POST', body: form })).then((r) => r.text)
  },
}

function extension(mime: string): string {
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4')) return 'm4a'
  return 'webm'
}

export interface ChatRequest {
  history: unknown[]
  message?: string
  answer?: { tool_call_id: string; text: string; value?: string | null; note_id?: string | null }
  source: 'typed' | 'voice'
  locked_note_ids: string[]
}

export async function streamChat(body: ChatRequest, onEvent: (e: ChatEvent) => void): Promise<void> {
  const res = await request('/chat', send('POST', body))
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    // Chunks can split a line in half, so only parse up to the last newline.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line))
  }
}
