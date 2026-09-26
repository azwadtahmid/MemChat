import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearMemories,
  getHealth,
  listMemories,
  ServiceError,
  streamChat,
  type Health,
  type Problem,
  type MemoryItem,
} from './api'
import Chat, { type Message } from './Chat'
import Header from './Header'
import { MemoryPanel, MemoryRail, type Retrieved } from './MemoryPanel'
import { loadUserIdentity } from './userId'

const PANEL_KEY = 'memchat.panelOpen'

function problemsOf(err: unknown): Problem[] {
  if (err instanceof ServiceError) return err.problems
  // Anything else is a bug in the page itself: log it, never render it.
  console.error(err)
  return [
    {
      service: 'backend',
      message: 'MemChat hit an unexpected error',
      hint: 'Details are in the browser console. Reloading the page usually clears it.',
    },
  ]
}

const describe = (ps: Problem[]) => ps.map((p) => p.message).join('. ')

// localStorage can throw in private windows or when site data is blocked.
function readPanelOpen(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === 'true'
  } catch {
    return false
  }
}

export default function App() {
  // Read (or create) this browser's id once; every memory request is scoped to it.
  const [identity] = useState(loadUserIdentity)
  const [health, setHealth] = useState<Health | null>(null)
  const [checking, setChecking] = useState(true)
  const [problems, setProblems] = useState<Problem[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const [retrieved, setRetrieved] = useState<Retrieved | null>(null)
  const [allMemories, setAllMemories] = useState<MemoryItem[]>([])
  const [savesPending, setSavesPending] = useState(0)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [panelOpen, setPanelOpen] = useState(readPanelOpen)
  const [pulseKey, setPulseKey] = useState(0)
  const railRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_KEY, String(panelOpen))
    } catch {
      // Not persisted; the panel still works for this session.
    }
  }, [panelOpen])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
    railRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePanel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panelOpen, closePanel])

  const refreshMemories = useCallback(async () => {
    try {
      setAllMemories(await listMemories(identity.id))
    } catch (err) {
      setProblems(problemsOf(err))
    }
  }, [identity.id])

  const checkHealth = useCallback(async () => {
    setChecking(true)
    try {
      const h = await getHealth()
      setHealth(h)
      setProblems(h.problems)
      if (h.ok) await refreshMemories()
    } catch (err) {
      setProblems(problemsOf(err))
    } finally {
      setChecking(false)
    }
  }, [refreshMemories])

  useEffect(() => {
    void checkHealth()
  }, [checkHealth])

  const updateMessage = (id: string, change: (m: Message) => Partial<Message>) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...change(m) } : m)))

  async function send(text: string) {
    const replyId = crypto.randomUUID()
    setMessages((ms) => [
      ...ms,
      { id: crypto.randomUUID(), role: 'user', content: text, status: 'done', enterIndex: 0 },
      { id: replyId, role: 'assistant', content: '', status: 'streaming', phase: 'searching', enterIndex: 1 },
    ])
    setBusy(true)
    setRetrieved({ query: text, memories: null })

    let replyDone = false
    let saveSettled = false
    const settleSave = (note: string) => {
      saveSettled = true
      setSavesPending((n) => n - 1)
      setSaveNote(note)
    }

    try {
      await streamChat(identity.id, text, (e) => {
        switch (e.type) {
          case 'memories':
            setRetrieved({ query: text, memories: e.memories })
            updateMessage(replyId, () => ({ phase: 'generating' }))
            break
          case 'token':
            updateMessage(replyId, (m) => ({ content: m.content + e.content }))
            break
          case 'done':
            replyDone = true
            updateMessage(replyId, () => ({ status: 'done' }))
            setBusy(false)
            setSavesPending((n) => n + 1)
            break
          case 'stored':
            settleSave(
              e.count === 0
                ? 'The last exchange had nothing new to remember.'
                : `Saved ${e.count} ${e.count === 1 ? 'memory' : 'memories'} from the last exchange.`,
            )
            // Refresh first, then pulse, so the rail animates as its count changes.
            if (e.count > 0) void refreshMemories().then(() => setPulseKey((k) => k + 1))
            break
          case 'error':
            if (replyDone) settleSave(e.message)
            else updateMessage(replyId, () => ({ status: 'error', error: e.hint ? `${e.message}. ${e.hint}` : e.message }))
            break
        }
      })
      setProblems([])
    } catch (err) {
      const found = problemsOf(err)
      setProblems(found)
      updateMessage(replyId, () => ({ status: 'error', error: describe(found) }))
      setRetrieved(null)
    } finally {
      setBusy(false)
      // The connection closed before the backend reported the save result.
      if (replyDone && !saveSettled) settleSave('The connection closed before saving finished.')
    }
  }

  async function clearAll() {
    setClearing(true)
    try {
      await clearMemories(identity.id)
      setRetrieved(null)
      setSaveNote(null)
      await refreshMemories()
    } catch (err) {
      setProblems(problemsOf(err))
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="app">
      <Header
        health={health}
        userId={identity.id}
        problems={problems}
        checking={checking}
        onRecheck={() => void checkHealth()}
      />

      {problems.length > 0 && (
        <div className="banner" role="alert">
          <ul>
            {problems.map((p) => (
              <li key={p.message}>
                <strong>{p.message}</strong>
                {p.hint && <span className="banner-hint">{p.hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <main className="layout">
        <Chat messages={messages} busy={busy} onSend={(t) => void send(t)} />

        <MemoryRail
          ref={railRef}
          count={allMemories.length}
          open={panelOpen}
          saving={savesPending > 0}
          pulseKey={pulseKey}
          onOpen={() => setPanelOpen(true)}
        />

        <div className="scrim" data-open={panelOpen} onClick={closePanel} aria-hidden="true" />

        <MemoryPanel
          open={panelOpen}
          onClose={closePanel}
          identity={identity}
          retrieved={retrieved}
          allMemories={allMemories}
          savesPending={savesPending}
          saveNote={saveNote}
          clearing={clearing}
          canClear={!busy && savesPending === 0 && allMemories.length > 0}
          onClear={() => void clearAll()}
        />
      </main>
    </div>
  )
}
