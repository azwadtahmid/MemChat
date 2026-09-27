import { useState, type FormEvent } from 'react'
import { CloseIcon } from '../icons'

interface Props {
  tags: string[]
  busy: boolean
  onChange: (next: string[]) => void
}

/** A note's tags: each removable, and a field to add more. Saved as they change. */
export default function TagEditor({ tags, busy, onChange }: Props) {
  const [draft, setDraft] = useState('')

  function add(e: FormEvent) {
    e.preventDefault()
    // Commas separate several at once; the backend lowercases and de-duplicates.
    const added = draft.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean)
    if (!added.length) return
    onChange([...tags, ...added])
    setDraft('')
  }

  return (
    <div className="tag-editor" role="group" aria-label="Tags">
      <span className="tag-editor-label" aria-hidden="true">
        Tags
      </span>
      {tags.length > 0 && (
        <ul className="tag-list">
          {tags.map((t) => (
            <li key={t} className="tag">
              <span>{t}</span>
              <button
                type="button"
                className="tag-remove"
                aria-label={`Remove the tag ${t}`}
                disabled={busy}
                onClick={() => onChange(tags.filter((x) => x !== t))}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="tag-add" onSubmit={add}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={tags.length ? 'Add a tag' : 'Add a tag, like work'}
          aria-label="Add a tag"
          maxLength={32 * 4}
          disabled={busy}
        />
        <button type="submit" className="text-button" disabled={busy || !draft.trim()}>
          Add
        </button>
      </form>
    </div>
  )
}
