import { useCallback, useEffect, useRef, useState } from 'react'
import { api, localDate, ServiceError, type Health, type Note, type NoteType, type Problem } from './api'
import ChatPanel from './components/ChatPanel'
import Privacy from './components/Privacy'
import { ANY_TIME, type RangeChoice } from './lib/dateRange'
import Rail, { type Filter, type Tab } from './Rail'
import Scenery from './scenery/Landscape'
import DiaryView from './views/DiaryView'
import EditorView from './views/EditorView'
import NotesView from './views/NotesView'
import TrashView from './views/TrashView'

type View =
  | { kind: Tab }
  | { kind: 'editor'; noteId: string | null; newType: NoteType; back: Tab; fresh?: boolean }

const CHAT_KEY = 'memchat.chatOpen'
const HIGHLIGHT_MS = 2200

function readChatOpen(): boolean {
  try {
    return localStorage.getItem(CHAT_KEY) === 'true'
  } catch {
    return false
  }
}

/** The vermillion-free seal on the chat tab: an ink seal impression. */
function Seal() {
  return (
    <svg className="seal" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.4 3.6c4.4-.3 8.8-.2 13.2.1.3 4.2.3 8.5 0 12.7-4.4.3-8.8.2-13.2-.1-.3-4.2-.3-8.5 0-12.7z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 7.1c2-.1 4-.1 6 .1M10 7.2v6M7.2 10.2c1.9-.1 3.8-.1 5.7 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export default function App() {
  const [view, setView] = useState<View>({ kind: 'notes' })
  const [filter, setFilter] = useState<Filter>('all')
  // Kept here rather than in the notes view, so they survive opening a note.
  const [tag, setTag] = useState<string | null>(null)
  const [range, setRange] = useState<RangeChoice>(ANY_TIME)
  const [health, setHealth] = useState<Health | null>(null)
  const [checking, setChecking] = useState(true)
  const [problems, setProblems] = useState<Problem[]>([])
  const [chatOpen, setChatOpen] = useState(readChatOpen)
  const [version, setVersion] = useState(0) // bumps whenever notes change
  const [highlights, setHighlights] = useState<Record<string, string>>({}) // note id -> chat action
  const [dirtyNote, setDirtyNote] = useState<string | null>(null)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const tabRef = useRef<HTMLButtonElement>(null)

  const tab: Tab = view.kind === 'editor' ? view.back : view.kind
  const retentionDays = health?.config.trash_retention_days ?? 30
  // Until the health check answers, assume audio works; the backend refuses it
  // with a plain message where recordings cannot be kept.
  const audioAvailable = health?.config.audio_notes ?? true

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_KEY, String(chatOpen))
    } catch {
      // Not persisted; the panel still works for this session.
    }
  }, [chatOpen])

  const closeChat = useCallback(() => {
    setChatOpen(false)
    // After the render that shows the tab again; a hidden element cannot take focus.
    window.setTimeout(() => tabRef.current?.focus(), 0)
  }, [])

  useEffect(() => {
    if (!chatOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeChat()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [chatOpen, closeChat])

  const checkHealth = useCallback(async () => {
    setChecking(true)
    try {
      const h = await api.health()
      setHealth(h)
      setProblems(h.problems)
    } catch (err) {
      setProblems(err instanceof ServiceError ? err.problems : [])
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void checkHealth()
  }, [checkHealth])

  // Failures from any view land in the banner as named problems, never raw errors.
  const onProblem = useCallback((err: unknown) => {
    if (err instanceof ServiceError) setProblems(err.problems)
    else {
      console.error(err)
      setProblems([{ service: 'backend', message: 'MemChat hit an unexpected error', hint: 'Details are in the browser console.' }])
    }
  }, [])

  const onDirtyChange = useCallback((noteId: string | null, dirty: boolean) => {
    setDirtyNote((current) => (dirty ? noteId : current === noteId ? null : current))
  }, [])

  function openNote(note: Note) {
    setHighlights(({ [note.id]: _seen, ...rest }) => rest)
    if (note.deleted) setView({ kind: 'trash' })
    else setView({ kind: 'editor', noteId: note.id, newType: note.type, back: tab === 'trash' ? 'notes' : tab })
  }

  // Choosing a filter from anywhere shows the notes with that filter.
  function chooseFilter(f: Filter) {
    setFilter(f)
    setView({ kind: 'notes' })
  }

  // Today's diary entry, created if it does not exist yet (the backend returns
  // the existing entry when there is one).
  async function openToday() {
    try {
      const existing = (await api.listNotes('diary')).find((n) => n.entry_date === localDate())
      if (existing) return setView({ kind: 'editor', noteId: existing.id, newType: 'diary', back: tab })
      const { note } = await api.createNote('diary', '', '')
      setVersion((v) => v + 1)
      setView({ kind: 'editor', noteId: note.id, newType: 'diary', back: tab, fresh: true })
    } catch (err) {
      onProblem(err)
    }
  }

  // New note: text and list notes are created straight away.
  async function createNote(type: Exclude<NoteType, 'audio'>) {
    if (type === 'diary') return void openToday()
    try {
      const { note } = await api.createNote(type, '', '')
      setVersion((v) => v + 1)
      setView({ kind: 'editor', noteId: note.id, newType: type, back: 'notes', fresh: true })
    } catch (err) {
      onProblem(err)
    }
  }

  function onSaved(note: Note) {
    setVersion((v) => v + 1)
    // A new note becomes an existing one once saved, so further saves update it.
    setView((v) => (v.kind === 'editor' && v.noteId === null && !note.deleted ? { ...v, noteId: note.id } : v))
  }

  // The assistant changed a note: refresh, and flash that note briefly.
  const onNoteChanged = useCallback((action: string, note: Note) => {
    setVersion((v) => v + 1)
    if (action === 'deleted') return
    setHighlights((h) => ({ ...h, [note.id]: action }))
    window.setTimeout(() => {
      setHighlights(({ [note.id]: _done, ...rest }) => rest)
    }, HIGHLIGHT_MS)
  }, [])

  return (
    <div className="shell">
      <Rail
        tab={tab}
        onTab={(t) => setView({ kind: t })}
        filter={filter}
        onFilter={chooseFilter}
        health={health}
        problems={problems}
        checking={checking}
        onRecheck={() => void checkHealth()}
        onPrivacy={() => setPrivacyOpen(true)}
      />

      <main className="field">
        {/* The ink landscape: top right of the field, clear of all text, and
            faded into the paper before the notes begin. */}
        <Scenery />

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

        {view.kind === 'notes' && (
          <NotesView
            filter={filter}
            version={version}
            highlights={highlights}
            audioAvailable={audioAvailable}
            tag={tag}
            onTag={setTag}
            range={range}
            onRange={setRange}
            onOpen={openNote}
            onCreate={(t) => void createNote(t)}
            onPrivacy={() => setPrivacyOpen(true)}
            onProblem={onProblem}
          />
        )}
        {view.kind === 'diary' && (
          <DiaryView version={version} highlights={highlights} onOpen={openNote} onToday={() => void openToday()} onProblem={onProblem} />
        )}
        {view.kind === 'trash' && <TrashView version={version} onChanged={() => setVersion((v) => v + 1)} onProblem={onProblem} />}
        {view.kind === 'editor' && (
          <EditorView
            key={view.noteId ?? `new-${view.newType}`}
            noteId={view.noteId}
            newType={view.newType}
            version={version}
            retentionDays={retentionDays}
            fresh={!!view.fresh}
            onDiscarded={() => setVersion((v) => v + 1)}
            onBack={() => setView({ kind: view.back })}
            onSaved={onSaved}
            onDirtyChange={onDirtyChange}
            onProblem={onProblem}
          />
        )}
      </main>

      {/* Click-away layer for the chat panel. Transparent: nothing tints the page. */}
      <div className="scrim" data-open={chatOpen} onClick={closeChat} aria-hidden="true" />

      <button
        ref={tabRef}
        type="button"
        className="chat-tab"
        data-hidden={chatOpen}
        onClick={() => setChatOpen(true)}
        aria-expanded={chatOpen}
        aria-controls="chat-panel"
      >
        <Seal />
        <span className="chat-tab-label">Assistant</span>
      </button>

      <Privacy open={privacyOpen} onClose={() => setPrivacyOpen(false)} retentionDays={retentionDays} />

      <ChatPanel
        open={chatOpen}
        onClose={closeChat}
        lockedNoteIds={dirtyNote ? [dirtyNote] : []}
        onNoteChanged={onNoteChanged}
        onOpenNote={openNote}
      />
    </div>
  )
}
