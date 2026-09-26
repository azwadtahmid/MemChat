import { useEffect, useRef, useState } from 'react'
import type { Health, ModelState, Problem } from './api'

const MODEL_LABEL: Record<ModelState, string> = {
  pulled: 'pulled',
  missing: 'not pulled',
  unknown: 'unknown (Ollama is down)',
}

interface Props {
  health: Health | null
  userId: string
  problems: Problem[]
  checking: boolean
  onRecheck: () => void
}

export default function Header({ health, userId, problems, checking, onRecheck }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const state = checking && !health ? 'checking' : problems.length > 0 ? 'down' : 'up'
  const label =
    state === 'checking'
      ? 'checking'
      : state === 'down'
        ? `unavailable (${problems.length})`
        : 'connected'

  // Close on Escape or on a click outside the control.
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
    <header className="topbar">
      <span className="wordmark">MemChat</span>

      <div className="status" ref={wrapRef}>
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
            {health && (
              <dl className="details">
                <dt>Model</dt>
                <dd>{health.config.model}</dd>
                <dt>Collection</dt>
                <dd>{health.config.collection}</dd>
                <dt>User</dt>
                <dd>{userId}</dd>
              </dl>
            )}
            <div className="health">
              <h2>Backend health</h2>
              {health ? (
                <dl className="details">
                  <dt>Qdrant</dt>
                  <dd>{health.services.qdrant === 'up' ? 'reachable' : 'not reachable'}</dd>
                  <dt>Ollama</dt>
                  <dd>{health.services.ollama === 'up' ? 'running' : 'not running'}</dd>
                  {Object.entries(health.services.models).map(([name, state]) => (
                    <div key={name} className="details-row">
                      <dt>{name}</dt>
                      <dd>{MODEL_LABEL[state]}</dd>
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
            <button type="button" className="button" onClick={onRecheck} disabled={checking}>
              {checking ? 'Checking' : 'Check again'}
            </button>
          </div>
        )}
      </div>
    </header>
  )
}
