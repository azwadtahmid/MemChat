import { useState, type FormEvent } from 'react'
import type { AskOption } from '../api'
import { ChevronIcon } from '../icons'

interface Props {
  question: string
  options: AskOption[]
  answered: string | null // the label or text the user answered with
  disabled: boolean
  onAnswer: (answer: { text: string; value: string | null; note_id: string | null }) => void
}

/** The assistant's question, as buttons in the message flow plus a free-text answer. */
export default function AskUser({ question, options, answered, disabled, onAnswer }: Props) {
  const [text, setText] = useState('')
  const locked = disabled || answered !== null

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim() || locked) return
    onAnswer({ text: text.trim(), value: null, note_id: null })
    setText('')
  }

  return (
    <div className="ask" role="group" aria-label="The assistant is asking">
      <p className="ask-question">{question}</p>
      <div className="ask-options">
        {options.map((o) => (
          <button
            key={`${o.value}-${o.note_id ?? o.label}`}
            type="button"
            className="ask-option"
            data-kind={o.value === 'confirm_delete' ? 'destructive' : o.value === 'cancel' ? 'cancel' : undefined}
            aria-pressed={answered === o.label}
            disabled={locked}
            onClick={() => onAnswer({ text: o.label, value: o.value, note_id: o.note_id })}
          >
            <span>{o.label}</span>
            <ChevronIcon />
          </button>
        ))}
      </div>
      {answered === null ? (
        <form className="add-item" onSubmit={submit}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Or type a different answer"
            aria-label="Type a different answer"
            disabled={locked}
          />
          <button type="submit" className="button" disabled={locked || !text.trim()}>
            Answer
          </button>
        </form>
      ) : (
        <p className="muted">You answered: {answered}</p>
      )}
    </div>
  )
}
