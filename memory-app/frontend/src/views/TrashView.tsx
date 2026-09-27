import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { api, type Note } from '../api'
import { RestoreIcon, TrashIcon } from '../icons'
import { TypeBadge } from '../components/NoteCard'
import { daysSince, formatDate } from '../lib/format'
import { riseProps, SECTION_DELAY } from '../lib/motion'

interface Props {
  version: number
  onChanged: (note?: Note) => void
  onProblem: (err: unknown) => void
}

export default function TrashView({ version, onChanged, onProblem }: Props) {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [retention, setRetention] = useState(30)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listTrash()
      .then((r) => {
        if (cancelled) return
        setNotes(r.notes)
        setRetention(r.retention_days)
      })
      .catch((err) => !cancelled && onProblem(err))
    return () => {
      cancelled = true
    }
  }, [version, onProblem])

  async function act(id: string, action: () => Promise<Note | void>) {
    setBusy(id)
    try {
      const note = await action()
      // AnimatePresence plays the exit; the refresh then finds it gone too.
      setNotes((ns) => ns?.filter((n) => n.id !== id) ?? null)
      onChanged(note ?? undefined)
    } catch (err) {
      onProblem(err)
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  return (
    <section className="view" aria-label="Trash">
      <div className="view-head">
        <h1 className="view-title">
          Trash
          {notes && notes.length > 0 && (
            <span className="view-count" aria-label={`${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`}>
              {notes.length}
            </span>
          )}
        </h1>
        <p className="muted view-lede">Deleted notes stay here for {retention} days, then are removed permanently.</p>
      </div>
      {notes === null ? (
        <p className="muted">Loading trash</p>
      ) : notes.length === 0 ? (
        <div className="empty">
          <h2>The trash is empty</h2>
          <p>Notes you delete wait here, so they can be restored, before they are removed for good.</p>
        </div>
      ) : (
        <ul className="card-grid trash-grid">
          <AnimatePresence initial>
          {notes.map((n, i) => {
            const left = Math.max(0, retention - daysSince(n.deleted_at!))
            return (
              <motion.li key={n.id} className="trash-item" {...riseProps(i, SECTION_DELAY.trash)}>
                <div className="note-card-head">
                  <TypeBadge type={n.type} />
                  <span className="note-card-date">Deleted {formatDate(n.deleted_at!)}</span>
                </div>
                <span className="note-card-title">{n.title}</span>
                <span className="note-card-preview">
                  {left === 0 ? 'Removed permanently at the next restart' : `Removed permanently in ${left} ${left === 1 ? 'day' : 'days'}`}
                </span>
                {confirming === n.id ? (
                  <div className="confirm" role="group" aria-label="Confirm permanent delete">
                    <p>Permanently delete "{n.title}"? This cannot be undone.</p>
                    <div className="confirm-actions">
                      <button type="button" className="button danger" disabled={busy === n.id} onClick={() => void act(n.id, () => api.purgeNote(n.id))}>
                        Delete permanently
                      </button>
                      <button type="button" className="button" onClick={() => setConfirming(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="trash-actions">
                    <button type="button" className="button" disabled={busy === n.id} onClick={() => void act(n.id, () => api.restoreNote(n.id))}>
                      <RestoreIcon />
                      Restore
                    </button>
                    <button type="button" className="button quiet" onClick={() => setConfirming(n.id)}>
                      <TrashIcon />
                      Delete permanently
                    </button>
                  </div>
                )}
              </motion.li>
            )
          })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}
