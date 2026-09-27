import { useEffect, useRef, useState } from 'react'
import { identity, type Health, type NoteType, type Problem } from './api'
import { AllIcon, DiaryIcon, LogoMark, NotesIcon, TrashIcon } from './icons'
import { TYPE_LABEL } from './lib/format'
import { TYPE_ICON } from './typeIcons'

export type Tab = 'notes' | 'diary' | 'trash'
export type Filter = NoteType | 'all'

interface Props {
  tab: Tab
  onTab: (tab: Tab) => void
  filter: Filter
  onFilter: (filter: Filter) => void
  health: Health | null
  problems: Problem[]
  checking: boolean
  onRecheck: () => void
  onPrivacy: () => void
}

const TABS: { id: Tab; label: string; Icon: typeof NotesIcon }[] = [
  { id: 'notes', label: 'Notes', Icon: NotesIcon },
  { id: 'diary', label: 'Diary', Icon: DiaryIcon },
  { id: 'trash', label: 'Trash', Icon: TrashIcon },
]

// Diary has its own view, so it is not repeated as a filter.
const FILTERS: Filter[] = ['all', 'text', 'list', 'audio']

const SERVICE_ROWS: { key: string; label: (h: Health) => string; states: Record<string, string> }[] = [
  { key: 'qdrant', label: () => 'Qdrant', states: { up: 'reachable', down: 'not reachable' } },
  { key: 'groq', label: () => 'Groq', states: { up: 'reachable', down: 'not reachable' } },
  {
    key: 'groq_chat_model',
    label: (h) => h.config.chat_model,
    states: { available: 'available', missing: 'not available', unknown: 'unknown (Groq is down)' },
  },
  {
    key: 'groq_transcribe_model',
    label: (h) => h.config.transcribe_model,
    states: { available: 'available', missing: 'not available', unknown: 'unknown (Groq is down)' },
  },
  {
    key: 'embeddings',
    label: () => 'Embeddings',
    states: { loaded: 'loaded', downloaded: 'downloaded', not_downloaded: 'downloads on first use', error: 'could not load' },
  },
]

function FilterGlyph({ filter }: { filter: Filter }) {
  const Icon = filter === 'all' ? AllIcon : TYPE_ICON[filter]
  return <Icon className="rail-glyph" />
}

/**
 * The left rail (a top bar below 900px): the mark, the three views, and below
 * a rule the type filters. The active view carries the vermillion stroke; the
 * active filter full-strength ink and a hairline ink rule.
 */
export default function Rail({ tab, onTab, filter, onFilter, health, problems, checking, onRecheck, onPrivacy }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const state = checking && !health ? 'checking' : problems.length > 0 ? 'down' : 'up'
  const label = state === 'checking' ? 'checking' : state === 'down' ? `unavailable (${problems.length})` : 'connected'

  // Close the status popover on Escape or on a click outside it.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function onPointer(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  return (
    <header className="rail">
      <a
        className="brand"
        href="/"
        aria-label="MemChat, notes view"
        onClick={(e) => {
          e.preventDefault()
          onTab('notes')
        }}
      >
        <LogoMark size={34} className="brand-mark" />
        <span className="wordmark">MemChat</span>
      </a>

      <nav className="rail-group rail-views" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className="rail-item"
            data-accent="seal"
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => onTab(t.id)}
          >
            <t.Icon className="rail-glyph" />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="rail-group rail-filters" role="group" aria-label="Show notes of type">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className="rail-item"
            data-accent="ink"
            aria-pressed={tab === 'notes' && filter === f}
            onClick={() => onFilter(f)}
          >
            <FilterGlyph filter={f} />
            {f === 'all' ? 'All' : TYPE_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="status" ref={wrapRef}>
        <button type="button" className="rail-privacy" onClick={onPrivacy}>
          How your notes are kept
        </button>
        <button
          ref={buttonRef}
          type="button"
          className="status-button"
          data-state={state}
          aria-expanded={open}
          aria-controls="status-popover"
          onClick={() => setOpen((o) => !o)}
        >
          <span className="status-dot" aria-hidden="true" />
          {label}
        </button>

        {open && (
          <div className="popover" id="status-popover" role="dialog" aria-label="Connection details">
            <dl className="details">
              <dt>User</dt>
              <dd>{identity.id}</dd>
              {health && (
                <>
                  <dt>Collection</dt>
                  <dd>{health.config.collection}</dd>
                </>
              )}
            </dl>
            <div className="health">
              <h2>Backend health</h2>
              {health ? (
                <dl className="details">
                  {SERVICE_ROWS.map((row) => (
                    <div key={row.key} className="details-row">
                      <dt>{row.label(health)}</dt>
                      <dd>{row.states[health.services[row.key]] ?? health.services[row.key]}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>{checking ? 'Checking.' : 'The backend did not answer the health check.'}</p>
              )}
              {problems.length > 0 && (
                <ul className="problem-list">
                  {problems.map((p) => (
                    <li key={p.message}>
                      {p.message}
                      {p.hint && <span className="banner-hint">{p.hint}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="muted">
              {identity.persisted
                ? "Your notes are stored under this ID, kept in this browser's storage. Clearing site data for this page starts a new, empty set of notes."
                : 'This browser is blocking site storage, so this ID and its notes last only until the page is reloaded.'}
            </p>
            <div className="popover-actions">
              <button type="button" className="text-button" onClick={onRecheck} disabled={checking}>
                {checking ? 'Checking' : 'Check again'}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setOpen(false)
                  onPrivacy()
                }}
              >
                Privacy
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
