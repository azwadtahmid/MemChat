// Each browser gets its own id, and every memory is stored under it. The id
// lives only in this browser's localStorage: clearing site data starts a new,
// empty history.

const KEY = 'memchat.userId'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface UserIdentity {
  id: string
  // False when the browser blocks localStorage; the id then lasts until reload.
  persisted: boolean
}

export function loadUserIdentity(): UserIdentity {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && UUID_RE.test(saved)) return { id: saved, persisted: true }
    const id = crypto.randomUUID()
    localStorage.setItem(KEY, id)
    return { id, persisted: true }
  } catch {
    return { id: crypto.randomUUID(), persisted: false }
  }
}
