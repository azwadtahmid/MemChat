import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { api, localDate, type Note } from '../api'
import { PlusIcon } from '../icons'
import { monthLabel } from '../lib/format'
import { riseProps, SECTION_DELAY } from '../lib/motion'

interface Props {
  version: number
  highlights: Record<string, string>
  onOpen: (note: Note) => void
  onToday: () => void
  onProblem: (err: unknown) => void
}

/** Diary entries, newest first, grouped by month. */
export default function DiaryView({ version, highlights, onOpen, onToday, onProblem }: Props) {
  const [entries, setEntries] = useState<Note[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .listNotes('diary')
      .then((notes) => {
        if (cancelled) return
        const day = (n: Note) => n.entry_date ?? n.created.slice(0, 10)
        setEntries([...notes].sort((a, b) => day(b).localeCompare(day(a))))
      })
      .catch((err) => !cancelled && onProblem(err))
    return () => {
      cancelled = true
    }
  }, [version, onProblem])

  const groups: { month: string; notes: Note[] }[] = []
  for (const n of entries ?? []) {
    const month = monthLabel(n.entry_date ?? n.created.slice(0, 10))
    if (groups.at(-1)?.month !== month) groups.push({ month, notes: [] })
    groups.at(-1)!.notes.push(n)
  }
  const hasToday = entries?.some((n) => n.entry_date === localDate())

  return (
    <section className="view" aria-label="Diary">
      <div className="view-head">
        <h1 className="view-title">
          Diary
          {entries && entries.length > 0 && (
            <span className="view-count" aria-label={`${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}>
              {entries.length}
            </span>
          )}
        </h1>
      </div>
      <div className="new-note">
        <button type="button" className="new-note-button" onClick={onToday}>
          <PlusIcon className="new-note-plus" />
          {hasToday ? "Add to today's entry" : "Write today's entry"}
        </button>
      </div>

      {entries === null ? (
        <p className="muted">Loading diary</p>
      ) : entries.length === 0 ? (
        <div className="empty">
          <h2>No entries yet</h2>
          <p>Each day gets one entry, titled with its date. Write today's to begin; anything you add later the same day joins it.</p>
        </div>
      ) : (
        groups.map((g, m) => (
          <section key={g.month} className="diary-month">
            <h2>{g.month}</h2>
            <ol className="timeline">
              {g.notes.map((n, i) => (
                // Each month group starts a little after the one above it.
                <motion.li key={n.id} {...riseProps(i, SECTION_DELAY.diary + m * SECTION_DELAY.diaryMonth)}>
                  <button
                    type="button"
                    className="timeline-entry"
                    data-highlight={highlights[n.id] ? 'true' : undefined}
                    onClick={() => onOpen(n)}
                  >
                    <span className="timeline-date">{n.title}</span>
                    <span className="note-card-preview">
                      {n.body.trim() ? (n.body.length > 220 ? `${n.body.slice(0, 220)}...` : n.body) : 'Empty entry'}
                    </span>
                  </button>
                </motion.li>
              ))}
            </ol>
          </section>
        ))
      )}
    </section>
  )
}
