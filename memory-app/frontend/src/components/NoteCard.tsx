import { motion } from 'motion/react'
import type { Note } from '../api'
import { progress } from '../lib/checklist'
import { formatDate, TYPE_LABEL } from '../lib/format'
import { riseProps } from '../lib/motion'
import { TYPE_ICON } from '../typeIcons'

const CHANGE_LABEL: Record<string, string> = {
  created: 'Created by the assistant',
  appended: 'Added to by the assistant',
  updated: 'Updated by the assistant',
  restored: 'Restored by the assistant',
}

function preview(note: Note): string {
  if (note.type === 'list') {
    const { done, total } = progress(note.body)
    return total ? `${done} of ${total} done` : 'No items yet'
  }
  const text = note.body.trim()
  if (!text) return note.type === 'audio' ? 'No transcript' : 'Nothing written yet'
  return text.length > 150 ? `${text.slice(0, 150).trimEnd()}...` : text
}

export function TypeBadge({ type }: { type: Note['type'] }) {
  const Icon = TYPE_ICON[type]
  return (
    <span className="type-badge" data-type={type}>
      <Icon />
      {TYPE_LABEL[type]}
    </span>
  )
}

interface Props {
  note: Note
  index: number // position in the list, for the stagger
  section: number // the section's delay token
  change?: string // set briefly when the assistant just changed this note
  onOpen: (note: Note) => void
}

/** A card: paper on paper. Rises in, lifts on hover, sinks out when deleted. */
export default function NoteCard({ note, index, section, change, onOpen }: Props) {
  return (
    <motion.li className="card-slot" {...riseProps(index, section)}>
      <button
        type="button"
        className="note-card"
        data-highlight={change ? 'true' : undefined}
        onClick={() => onOpen(note)}
      >
        <span className="note-card-head">
          <TypeBadge type={note.type} />
          <span className="note-card-date">{formatDate(note.updated)}</span>
        </span>
        <span className="note-card-title">{note.title}</span>
        <span className="note-card-preview">{preview(note)}</span>
        {change && (
          <span className="note-card-change" role="status">
            {CHANGE_LABEL[change] ?? 'Changed by the assistant'}
          </span>
        )}
      </button>
    </motion.li>
  )
}
