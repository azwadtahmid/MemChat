import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { api, type Note, type NoteType } from '../api'
import AudioRecorder from '../components/AudioRecorder'
import DateRange from '../components/DateRange'
import NoteCard from '../components/NoteCard'
import { PrivacyLine } from '../components/Privacy'
import { CloseIcon, PlusIcon, SearchIcon } from '../icons'
import { ANY_TIME, bounds, isActive, type RangeChoice } from '../lib/dateRange'
import { TYPE_LABEL } from '../lib/format'
import { SECTION_DELAY, UI } from '../lib/motion'
import type { Filter } from '../Rail'
import { TYPE_ICON } from '../typeIcons'

interface Props {
  filter: Filter
  version: number // bumps when notes change elsewhere (chat, editor)
  highlights: Record<string, string> // note id -> what the assistant just did to it
  audioAvailable: boolean // false in the hosted version, where recordings cannot be kept
  tag: string | null // filter: only notes carrying this tag
  onTag: (tag: string | null) => void
  range: RangeChoice // filter: created within this range
  onRange: (range: RangeChoice) => void
  onOpen: (note: Note) => void
  onCreate: (type: Exclude<NoteType, 'audio'>) => void // creates the note and opens the editor
  onProblem: (err: unknown) => void
  onPrivacy: () => void
}

const PICK: NoteType[] = ['text', 'list', 'diary', 'audio']

const TITLE: Record<Filter, string> = {
  all: 'Notes',
  text: 'Text notes',
  list: 'Lists',
  diary: 'Diary entries',
  audio: 'Audio notes',
}

const NEW_LABEL: Record<Filter, string> = {
  all: 'New note',
  text: 'New text note',
  list: 'New list',
  diary: "Today's diary entry",
  audio: 'Record an audio note',
}

const PICK_HINT: Record<NoteType, string> = {
  text: 'A page of writing',
  list: 'Items to tick off',
  diary: "Today's entry, one per day",
  audio: 'Speak it; it is transcribed',
}

const AUDIO_UNAVAILABLE = 'Not available in the hosted version yet'

const EMPTY_FILTERED: Record<NoteType, { title: string; body: string }> = {
  text: { title: 'No text notes yet', body: 'Start one with New text note above.' },
  list: { title: 'No lists yet', body: 'Start one with New list above, or ask the assistant to make one.' },
  diary: { title: 'No diary entries yet', body: "Today's entry opens from the control above." },
  audio: { title: 'No audio notes yet', body: 'Record one above. It is transcribed so you can search it.' },
}

export default function NotesView({
  filter,
  version,
  highlights,
  audioAvailable,
  tag,
  onTag,
  range,
  onRange,
  onOpen,
  onCreate,
  onProblem,
  onPrivacy,
}: Props) {
  const [query, setQuery] = useState('')
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [recording, setRecording] = useState(false)
  const newRef = useRef<HTMLDivElement>(null)
  const newButtonRef = useRef<HTMLButtonElement>(null)

  // A different filter closes anything half open.
  const [shownFilter, setShownFilter] = useState(filter)
  if (shownFilter !== filter) {
    setShownFilter(filter)
    setPicking(false)
    setRecording(false)
  }

  // List, or search when there is a query. Waits for typing to pause. The tag
  // and date range are exact filters applied to either, never a separate mode.
  const rangeKey = JSON.stringify(range)
  useEffect(() => {
    let cancelled = false
    const filters = {
      type: filter === 'all' ? undefined : filter,
      tags: tag ? [tag] : undefined,
      ...bounds(JSON.parse(rangeKey) as RangeChoice),
    }
    const narrowed = !!filters.tags || !!filters.created_from || !!filters.created_to
    const q = query.trim()
    const timer = window.setTimeout(
      () => {
        ;(q ? api.searchNotes(q, filters) : narrowed ? api.filterNotes(filters) : api.listNotes(filters.type))
          .then((found) => !cancelled && setNotes(found))
          .catch((err) => !cancelled && onProblem(err))
      },
      q ? 300 : 0,
    )
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [filter, query, tag, rangeKey, version, onProblem])

  // Close the type options on a click elsewhere or Escape.
  useEffect(() => {
    if (!picking) return
    const onPointer = (e: PointerEvent) => {
      if (!newRef.current?.contains(e.target as Node)) setPicking(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPicking(false)
        newButtonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [picking])

  function create(type: NoteType) {
    if (type === 'audio' && !audioAvailable) return
    setPicking(false)
    if (type === 'audio') setRecording(true)
    else onCreate(type)
  }

  const searching = query.trim() !== ''
  const narrowed = tag !== null || isActive(range)
  const count = notes && !searching ? notes.length : null
  // A new filter or search is a new list: keyed, so it swaps rather than
  // animating every card out. Deletions within the same list animate out.
  const listKey = `${filter}|${query.trim()}|${tag}|${rangeKey}`

  return (
    <section className="view notes-view" aria-labelledby="notes-title">
      <div className="view-head">
        <h1 className="view-title" id="notes-title">
          {TITLE[filter]}
          {count !== null && (
            <span className="view-count" aria-label={`${count} ${count === 1 ? 'note' : 'notes'}`}>
              {count}
            </span>
          )}
        </h1>
        <label className="search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your notes"
            aria-label="Search notes"
          />
        </label>
        <div className="search-filters">
          <DateRange value={range} onChange={onRange} />
          {tag && (
            <p className="tag-filter">
              <span className="date-range-label">Tagged</span>
              <span className="tag">{tag}</span>
              <button type="button" className="tag-remove" aria-label={`Stop filtering by ${tag}`} onClick={() => onTag(null)}>
                <CloseIcon />
              </button>
            </p>
          )}
        </div>
      </div>

      <div className="new-note" ref={newRef}>
        {recording ? (
          <AudioRecorder
            onCreated={(note) => {
              setRecording(false)
              onOpen(note)
            }}
            onCancel={() => setRecording(false)}
          />
        ) : (
          <>
            <button
              ref={newButtonRef}
              type="button"
              className="new-note-button"
              aria-disabled={filter === 'audio' && !audioAvailable ? true : undefined}
              aria-describedby={filter === 'audio' && !audioAvailable ? 'audio-unavailable' : undefined}
              aria-expanded={filter === 'all' ? picking : undefined}
              aria-controls={filter === 'all' ? 'new-note-options' : undefined}
              onClick={() => (filter === 'all' ? setPicking((p) => !p) : create(filter))}
            >
              <PlusIcon className="new-note-plus" />
              {NEW_LABEL[filter]}
            </button>
            {filter === 'audio' && !audioAvailable && (
              <p className="new-note-note" id="audio-unavailable">
                {AUDIO_UNAVAILABLE}. Recordings cannot be stored here, so none is taken.
              </p>
            )}
            <AnimatePresence initial={false}>
              {picking && (
                <motion.ul
                  id="new-note-options"
                  className="new-note-options"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0, transition: UI }}
                  exit={{ opacity: 0, y: -4, transition: { duration: 0.14 } }}
                >
                  {PICK.map((t) => {
                    const Icon = TYPE_ICON[t]
                    // Kept focusable with aria-disabled, so the reason is read out.
                    const off = t === 'audio' && !audioAvailable
                    return (
                      <li key={t}>
                        <button
                          type="button"
                          className="new-note-option"
                          aria-disabled={off || undefined}
                          onClick={() => create(t)}
                        >
                          <Icon className="new-note-glyph" />
                          <span className="new-note-name">{TYPE_LABEL[t]}</span>
                          <span className="new-note-hint" data-off={off || undefined}>
                            {off ? AUDIO_UNAVAILABLE : PICK_HINT[t]}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {notes === null ? (
        <ul className="card-grid" aria-busy="true" aria-label="Loading notes">
          {[0, 1, 2].map((i) => (
            <li key={i} className="card-skeleton" />
          ))}
        </ul>
      ) : notes.length === 0 ? (
        <div className="empty">
          {narrowed ? (
            <>
              <h2>Nothing matches these filters</h2>
              <p>
                {searching ? 'Try other words, or widen the filters.' : 'No notes carry that tag in that time.'}{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    onTag(null)
                    onRange(ANY_TIME)
                  }}
                >
                  Clear the filters
                </button>
              </p>
            </>
          ) : searching ? (
            <>
              <h2>Nothing matches that search</h2>
              <p>Search looks for meaning, so try describing the note in other words.</p>
            </>
          ) : filter === 'all' ? (
            <>
              <h2>Nothing written yet</h2>
              <p>Start with New note above, or open the assistant on the right and ask it to begin a list for you.</p>
              <PrivacyLine onMore={onPrivacy} />
            </>
          ) : (
            <>
              <h2>{EMPTY_FILTERED[filter].title}</h2>
              <p>
                {filter === 'audio' && !audioAvailable
                  ? 'Audio notes are not available in the hosted version yet.'
                  : EMPTY_FILTERED[filter].body}
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          {searching && <p className="muted list-note">Closest matches first.</p>}
          <ul className="card-grid" key={listKey}>
            <AnimatePresence initial>
              {notes.map((n, i) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  index={i}
                  section={SECTION_DELAY.notes}
                  change={highlights[n.id]}
                  activeTag={tag}
                  onOpen={onOpen}
                  onTag={(t) => onTag(t === tag ? null : t)}
                />
              ))}
            </AnimatePresence>
          </ul>
        </>
      )}
    </section>
  )
}
