import { useState, type FormEvent } from 'react'
import { addItem, otherLines, parseChecklist, toggleLine } from '../lib/checklist'

interface Props {
  body: string
  onChange: (body: string) => void
}

/** Real checkboxes over a markdown body. Ticking rewrites that one "- [ ]" line. */
export default function Checklist({ body, onChange }: Props) {
  const [draft, setDraft] = useState('')
  const items = parseChecklist(body)
  const extra = otherLines(body)

  function add(e: FormEvent) {
    e.preventDefault()
    if (!draft.trim()) return
    onChange(addItem(body, draft))
    setDraft('')
  }

  return (
    <div className="checklist">
      {items.length === 0 ? (
        <p className="muted">No items yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.line}>
              <label className="check-item" data-checked={item.checked}>
                <input type="checkbox" checked={item.checked} onChange={() => onChange(toggleLine(body, item.line))} />
                <span>{item.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {extra && <p className="checklist-extra">{extra}</p>}
      <form className="add-item" onSubmit={add}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an item" aria-label="New list item" />
        <button type="submit" className="button" disabled={!draft.trim()}>
          Add
        </button>
      </form>
    </div>
  )
}
