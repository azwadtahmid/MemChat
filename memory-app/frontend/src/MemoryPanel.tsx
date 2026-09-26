import { forwardRef, useEffect, useRef, useState } from 'react'
import type { MemoryItem } from './api'
import { CloseIcon, MemoryIcon } from './icons'
import type { UserIdentity } from './userId'

export interface Retrieved {
  query: string
  // null while the search is still running.
  memories: MemoryItem[] | null
}

/* ---------- Rail: the collapsed state, always visible on the right edge ---------- */

interface RailProps {
  count: number
  open: boolean
  saving: boolean
  // Increments each time new memories are saved; re-keys the count and icon
  // so their one-shot CSS animations play again.
  pulseKey: number
  onOpen: () => void
}

export const MemoryRail = forwardRef<HTMLButtonElement, RailProps>(function MemoryRail(
  { count, open, saving, pulseKey, onOpen },
  ref,
) {
  const pulsed = pulseKey > 0
  return (
    <button
      ref={ref}
      type="button"
      className="rail"
      onClick={onOpen}
      aria-expanded={open}
      aria-controls="memory-panel"
      aria-label={`Open memory panel, ${count} stored ${count === 1 ? 'memory' : 'memories'}`}
    >
      <span key={`icon-${pulseKey}`} className={pulsed ? 'rail-icon pulse' : 'rail-icon'}>
        <MemoryIcon />
      </span>
      <span key={`count-${count}`} className={pulsed ? 'rail-count bump' : 'rail-count'}>
        {count}
      </span>
      {saving && <span className="rail-saving" aria-hidden="true" />}
    </button>
  )
})

/* ---------- Panel: slides over the chat ---------- */

interface PanelProps {
  open: boolean
  onClose: () => void
  identity: UserIdentity
  retrieved: Retrieved | null
  allMemories: MemoryItem[]
  savesPending: number
  saveNote: string | null
  clearing: boolean
  canClear: boolean
  onClear: () => void
}

function MemoryList({ items, showScore }: { items: MemoryItem[]; showScore: boolean }) {
  return (
    <ul className={showScore ? 'memory-list retrieved' : 'memory-list'}>
      {items.map((m) => (
        <li key={m.id}>
          <span>{m.memory}</span>
          {showScore && m.score != null && (
            <span className="score" title="Similarity score from the vector search">
              {m.score.toFixed(2)}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function MemoryPanel(props: PanelProps) {
  const {
    open,
    onClose,
    identity,
    retrieved,
    allMemories,
    savesPending,
    saveNote,
    clearing,
    canClear,
    onClear,
  } = props
  const [confirming, setConfirming] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  const count = allMemories.length
  const showConfirm = confirming && open && canClear

  return (
    <aside
      id="memory-panel"
      className="panel"
      data-open={open}
      aria-label="Memory"
      inert={!open}
    >
      <div className="panel-head">
        <h2>Memory</h2>
        <button
          ref={closeRef}
          type="button"
          className="icon-button"
          onClick={() => {
            setConfirming(false)
            onClose()
          }}
          aria-label="Close memory panel"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="panel-body">
        <section>
          <h3>Retrieved for this message</h3>
          {retrieved === null ? (
            <p className="muted">Send a message to see which memories are used for its reply.</p>
          ) : (
            <>
              <p className="query">{retrieved.query}</p>
              {retrieved.memories === null ? (
                <p className="muted">Searching memories</p>
              ) : retrieved.memories.length === 0 ? (
                <p className="muted">No stored memory matched this message.</p>
              ) : (
                <MemoryList items={retrieved.memories} showScore />
              )}
            </>
          )}
        </section>

        {(savesPending > 0 || saveNote) && (
          <section aria-live="polite">
            {savesPending > 0 ? (
              <p className="save-note saving">
                Saving to memory. The model extracts facts from the exchange first, which can take
                over a minute. A new reply waits until this finishes.
              </p>
            ) : (
              <p className="save-note">{saveNote}</p>
            )}
          </section>
        )}

        <section>
          <div className="section-head">
            <h3>All memories</h3>
            <span className="count">{count}</span>
          </div>
          {count === 0 ? (
            <p className="muted">Nothing stored yet.</p>
          ) : (
            <MemoryList items={allMemories} showScore={false} />
          )}

          {showConfirm ? (
            <div className="confirm" role="group" aria-label="Confirm clearing memories">
              <p>
                Delete all {count} stored {count === 1 ? 'memory' : 'memories'}? This cannot be
                undone.
              </p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="button danger"
                  disabled={clearing}
                  onClick={() => {
                    onClear()
                    setConfirming(false)
                  }}
                >
                  {clearing ? 'Clearing' : 'Delete all'}
                </button>
                <button type="button" className="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="button quiet"
              disabled={!canClear || clearing}
              onClick={() => setConfirming(true)}
            >
              {clearing ? 'Clearing' : 'Clear all memories'}
            </button>
          )}
        </section>

        <section>
          <h3>Your ID</h3>
          <code className="user-id">{identity.id}</code>
          <p className="muted">
            {identity.persisted
              ? "Your memories are stored under this ID, which is kept in this browser's storage. Clearing site data for this page starts a new, empty history."
              : 'This browser is blocking site storage, so this ID and its memories last only until the page is reloaded.'}
          </p>
        </section>
      </div>
    </aside>
  )
}
