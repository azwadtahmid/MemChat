import { useCallback, useEffect, useRef, useState } from 'react'
import { api, API_BASE, localDate, ServiceError, type Note, type NoteType } from '../api'
import Checklist from '../components/Checklist'
import TagEditor from '../components/TagEditor'
import { BackIcon, CheckIcon, PinIcon, RestoreIcon, TrashIcon } from '../icons'
import { TypeBadge } from '../components/NoteCard'
import { formatDate, formatDateTime } from '../lib/format'

interface Props {
  noteId: string | null // null: a new note, not saved yet
  newType: NoteType
  version: number // bumps when the chat changes notes
  retentionDays: number
  // Created a moment ago by the plus button. If it is left untouched, it is
  // removed on the way out so empty notes do not pile up.
  fresh: boolean
  onDiscarded: () => void
  onBack: () => void
  onSaved: (note: Note) => void
  onDirtyChange: (noteId: string | null, dirty: boolean) => void
  onProblem: (err: unknown) => void
}

function todayTitle(): string {
  return formatDate(`${localDate()}T12:00:00`)
}

export default function EditorView({
  noteId, newType, version, retentionDays, fresh, onBack, onSaved, onDiscarded, onDirtyChange, onProblem,
}: Props) {
  const [note, setNote] = useState<Note | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [rawList, setRawList] = useState(false)
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmTrash, setConfirmTrash] = useState(false)
  const [metaBusy, setMetaBusy] = useState(false)

  const type = note?.type ?? newType
  const isNew = noteId === null
  // An untitled note shows an empty title field rather than the word Untitled.
  const baseTitle = note && note.title !== 'Untitled' ? note.title : ''
  const dirty = isNew ? title.trim() !== '' || body.trim() !== '' : !!note && (title !== baseTitle || body !== note.body)

  // Whether this note was ever typed in or saved; see the fresh prop.
  const touched = useRef(false)
  if (dirty) touched.current = true
  const discard = useRef({ fresh, noteId, onDiscarded })
  discard.current = { fresh, noteId, onDiscarded }
  useEffect(
    () => () => {
      const { fresh: wasFresh, noteId: id, onDiscarded: done } = discard.current
      if (!wasFresh || touched.current || !id) return
      api
        .deleteNote(id)
        .then(() => api.purgeNote(id))
        .then(done)
        .catch(() => undefined) // best effort: an empty note left behind is harmless
    },
    [],
  )

  const load = useCallback(async () => {
    if (!noteId) return
    try {
      const n = await api.getNote(noteId)
      setNote(n)
      setTitle(n.title === 'Untitled' ? '' : n.title)
      setBody(n.body)
      setConflict(false)
    } catch (err) {
      onProblem(err)
    }
  }, [noteId, onProblem])

  useEffect(() => {
    void load()
  }, [load])

  // The chat changed notes: reload this one, unless the user is mid-edit
  // (the chat refuses to write to it then anyway).
  useEffect(() => {
    if (version && !dirty) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version])

  useEffect(() => onDirtyChange(noteId, dirty), [noteId, dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(noteId, false), [noteId, onDirtyChange])

  // Leaving the page with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const save = useCallback(
    async (nextTitle = title, nextBody = body) => {
      setSaving(true)
      setError(null)
      try {
        let saved: Note
        if (isNew) {
          saved = (await api.createNote(type, nextTitle, nextBody)).note
        } else {
          saved = await api.updateNote(note!.id, {
            title: type === 'diary' ? undefined : nextTitle.trim() || 'Untitled',
            body: nextBody,
            expected_updated: note!.updated,
          })
        }
        touched.current = true
        setNote(saved)
        setTitle(saved.title === 'Untitled' ? '' : saved.title)
        setBody(saved.body)
        onSaved(saved)
      } catch (err) {
        if (err instanceof ServiceError && err.status === 409) setConflict(true)
        else if (err instanceof ServiceError && err.status !== 503) setError(err.problems[0]?.message ?? 'Not saved.')
        else onProblem(err)
      } finally {
        setSaving(false)
      }
    },
    [title, body, isNew, type, note, onSaved, onProblem],
  )

  // Ticking a box on a clean note saves straight away; mid-edit it joins the draft.
  function changeList(next: string) {
    setBody(next)
    if (!dirty && !isNew) void save(title, next)
  }

  async function undo() {
    try {
      const n = await api.undoNote(note!.id)
      touched.current = true
      setNote(n)
      setTitle(n.title === 'Untitled' ? '' : n.title)
      setBody(n.body)
      onSaved(n)
    } catch (err) {
      onProblem(err)
    }
  }

  // Tags and pinning save at once and never touch the draft: the backend leaves
  // "updated" alone for them, so a later save does not see a conflict.
  async function changeMeta(write: () => Promise<Note>) {
    setMetaBusy(true)
    setError(null)
    try {
      const saved = await write()
      touched.current = true
      setNote((current) => (current ? { ...current, tags: saved.tags, pinned: saved.pinned } : saved))
      onSaved(saved)
    } catch (err) {
      if (err instanceof ServiceError && err.status !== 503) setError(err.problems[0]?.message ?? 'Not saved.')
      else onProblem(err)
    } finally {
      setMetaBusy(false)
    }
  }

  async function trash() {
    try {
      touched.current = true // deliberately trashed: do not also purge it
      onSaved(await api.deleteNote(note!.id))
      onBack()
    } catch (err) {
      onProblem(err)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (dirty && !saving) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, saving, save])

  if (!isNew && !note) return <p className="muted view">Loading note</p>

  return (
    <section className="view editor" aria-label="Editor">
      <div className="editor-bar">
        <button type="button" className="button quiet" onClick={onBack}>
          <BackIcon />
          Back
        </button>
        <TypeBadge type={type} />
        {note && (
          <button
            type="button"
            className="text-button pin-toggle"
            aria-pressed={!!note.pinned}
            disabled={metaBusy}
            onClick={() => void changeMeta(() => api.setPinned(note.id, !note.pinned))}
          >
            <PinIcon />
            {note.pinned ? 'Pinned' : 'Pin'}
          </button>
        )}
        <span className="editor-status" aria-live="polite">
          {saving ? 'Saving' : dirty ? 'Unsaved changes' : isNew ? '' : 'Saved'}
        </span>
      </div>

      {type === 'diary' ? (
        <h1 className="editor-title-static">{note?.title ?? todayTitle()}</h1>
      ) : (
        <input
          className="editor-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled"
          aria-label="Title"
          autoFocus={fresh}
          maxLength={300}
        />
      )}

      {note && (
        <p className="editor-dates">
          Created {formatDateTime(note.created)}. Last edited {formatDateTime(note.updated)}.
        </p>
      )}

      {note && (
        <TagEditor
          tags={note.tags ?? []}
          busy={metaBusy}
          onChange={(tags) => void changeMeta(() => api.setTags(note.id, tags))}
        />
      )}

      {conflict && (
        <div className="notice" role="alert">
          <p>This note was changed since you opened it, possibly by the assistant. Your edits are still here but were not saved.</p>
          <button type="button" className="button" onClick={() => void load()}>
            Load the latest version (discards your edits)
          </button>
        </div>
      )}

      {type === 'audio' &&
        note &&
        (note.audio_url ? (
          // The URL carries a short-lived signed token, not the user id.
          <audio className="audio-player" controls preload="metadata" src={`${API_BASE}${note.audio_url}`} />
        ) : (
          <p className="muted">The recording was not kept. The transcript below is all that remains of it.</p>
        ))}

      {type === 'list' && !rawList ? (
        <Checklist body={body} onChange={changeList} />
      ) : (
        <textarea
          className="editor-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-label={type === 'audio' ? 'Transcript' : 'Note'}
          placeholder={type === 'audio' ? 'Transcript' : type === 'list' ? '- [ ] item' : 'Write here'}
        />
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="editor-actions">
        <button type="button" className="button primary" onClick={() => void save()} disabled={!dirty || saving}>
          <CheckIcon />
          {saving ? 'Saving' : 'Save'}
        </button>
        {type === 'list' && (
          <button type="button" className="button quiet" onClick={() => setRawList((r) => !r)}>
            {rawList ? 'Show checkboxes' : 'Edit as text'}
          </button>
        )}
        {note?.has_undo && !dirty && (
          <button type="button" className="button quiet" onClick={() => void undo()}>
            <RestoreIcon />
            Undo last change
          </button>
        )}
        {note && !confirmTrash && (
          <button type="button" className="button quiet push-right" onClick={() => setConfirmTrash(true)}>
            <TrashIcon />
            Move to trash
          </button>
        )}
      </div>

      {note && confirmTrash && (
        <div className="confirm" role="group" aria-label="Confirm moving to trash">
          <p>
            Move "{note.title}" to the trash? It can be restored from the Trash view for {retentionDays} days.
          </p>
          <div className="confirm-actions">
            <button type="button" className="button danger" onClick={() => void trash()}>
              Move to trash
            </button>
            <button type="button" className="button" onClick={() => setConfirmTrash(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
