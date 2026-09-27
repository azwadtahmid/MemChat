import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { api, ServiceError, streamChat, type AskOption, type ChatEvent, type Note, type Problem } from '../api'
import { CheckIcon, CloseIcon, LogoMark, MicIcon, SendIcon, StopIcon } from '../icons'
import { useRecorder } from '../lib/useRecorder'
import { UI } from '../lib/motion'
import AskUser from './AskUser'

type Source = 'typed' | 'voice'

interface Change {
  action: string
  note: Note
}

type Step = { kind: 'tool'; tool: string } | { kind: 'notice'; text: string }

type Item =
  | { id: string; kind: 'user'; text: string; source: Source }
  | {
      id: string
      kind: 'assistant'
      text: string
      streaming: boolean
      steps: Step[]
      changes: Change[]
      ask: { tool_call_id: string; question: string; options: AskOption[]; answered: string | null } | null
      error: Problem | null
    }

// What a tool is doing while it runs, and what it did once it is done.
const DOING: Record<string, string> = {
  search_notes: 'Searching your notes',
  list_notes: 'Looking through your notes',
  create_note: 'Creating a note',
  append_to_note: 'Adding to a note',
  update_note: 'Updating a note',
  delete_note: 'Moving a note to the trash',
  restore_note: 'Restoring a note',
}
const DONE: Record<string, string> = {
  search_notes: 'Searched your notes',
  list_notes: 'Looked through your notes',
  create_note: 'Created a note',
  append_to_note: 'Added to a note',
  update_note: 'Updated a note',
  delete_note: 'Moved a note to the trash',
  restore_note: 'Restored a note',
}

const CHANGED: Record<string, string> = {
  created: 'Created',
  appended: 'Added to',
  updated: 'Updated',
  deleted: 'Moved to the trash:',
  restored: 'Restored',
}

interface Props {
  open: boolean
  onClose: () => void
  lockedNoteIds: string[] // open in the editor with unsaved changes
  onNoteChanged: (action: string, note: Note) => void
  onOpenNote: (note: Note) => void
}

/** The thinking state: one quiet line naming what the model is doing right now. */
function Thinking({ label }: { label: string }) {
  return (
    <p className="thinking" role="status">
      {label}
    </p>
  )
}

export default function ChatPanel({ open, onClose, lockedNoteIds, onNoteChanged, onOpenNote }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const history = useRef<unknown[]>([])
  // The question waiting for an answer, and how the turn that asked it began.
  const pending = useRef<{ tool_call_id: string; source: Source; itemId: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const rec = useRecorder()

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items])

  const patch = (id: string, change: (item: Extract<Item, { kind: 'assistant' }>) => Partial<Item>) =>
    setItems((all) => all.map((i) => (i.id === id && i.kind === 'assistant' ? ({ ...i, ...change(i) } as Item) : i)))

  async function run(
    shown: string,
    source: Source,
    payload: { message: string } | { answer: { tool_call_id: string; text: string; value: string | null; note_id: string | null } },
  ) {
    const replyId = crypto.randomUUID()
    setItems((all) => [
      ...all,
      { id: crypto.randomUUID(), kind: 'user', text: shown, source },
      { id: replyId, kind: 'assistant', text: '', streaming: true, steps: [], changes: [], ask: null, error: null },
    ])
    setBusy(true)
    try {
      await streamChat({ history: history.current, source, locked_note_ids: lockedNoteIds, ...payload }, (e: ChatEvent) => {
        switch (e.type) {
          case 'token':
            patch(replyId, (i) => ({ text: i.text + e.content }))
            break
          case 'activity':
            patch(replyId, (i) => ({ steps: [...i.steps, { kind: 'tool', tool: e.tool }] }))
            break
          case 'notice':
            // For example, waiting out Groq's rate limit before retrying.
            patch(replyId, (i) => ({ steps: [...i.steps, { kind: 'notice', text: e.message }] }))
            break
          case 'note_changed':
            patch(replyId, (i) => ({ changes: [...i.changes, { action: e.action, note: e.note }] }))
            onNoteChanged(e.action, e.note)
            break
          case 'ask_user':
            pending.current = { tool_call_id: e.tool_call_id, source, itemId: replyId }
            patch(replyId, () => ({ ask: { tool_call_id: e.tool_call_id, question: e.question, options: e.options, answered: null } }))
            break
          case 'messages':
            // The server's new history entries, including this turn's user message or answer.
            history.current = [...history.current, ...e.messages]
            break
          case 'error':
            patch(replyId, () => ({ error: { service: 'chat', message: e.message, hint: e.hint } }))
            break
        }
      })
    } catch (err) {
      const problem = err instanceof ServiceError ? err.problems[0] : { service: 'chat', message: 'The message could not be sent.' }
      patch(replyId, () => ({ error: problem }))
      if (!(err instanceof ServiceError)) console.error(err)
    } finally {
      patch(replyId, () => ({ streaming: false }))
      setBusy(false)
    }
  }

  function sendMessage(text: string, source: Source) {
    const message = text.trim()
    if (!message || busy) return
    if (pending.current) {
      // Typing while a question is open answers it.
      answer({ text: message, value: null, note_id: null })
      return
    }
    void run(message, source, { message })
  }

  function answer(a: { text: string; value: string | null; note_id: string | null }) {
    const p = pending.current
    if (!p || busy) return
    pending.current = null
    patch(p.itemId, (i) => ({ ask: i.ask && { ...i.ask, answered: a.text } }))
    void run(a.text, p.source, { answer: { tool_call_id: p.tool_call_id, ...a } })
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    sendMessage(draft, 'typed')
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  async function toggleVoice() {
    if (rec.state !== 'recording') return void rec.start()
    const blob = await rec.stop()
    if (!blob) return
    setTranscribing(true)
    try {
      const text = await api.transcribe(blob)
      if (text) sendMessage(text, 'voice')
    } catch (err) {
      const problem = err instanceof ServiceError ? err.problems[0] : { service: 'chat', message: 'The recording could not be transcribed.' }
      setItems((all) => [
        ...all,
        { id: crypto.randomUUID(), kind: 'assistant', text: '', streaming: false, steps: [], changes: [], ask: null, error: problem },
      ])
    } finally {
      setTranscribing(false)
    }
  }

  function reset() {
    history.current = []
    pending.current = null
    setItems([])
  }

  return (
    <motion.aside
      id="chat-panel"
      className="chat-panel"
      data-open={open}
      aria-label="Assistant"
      inert={!open}
      initial={false}
      // Slides and fades; under reduced motion Motion skips the slide and keeps the fade.
      animate={open ? { x: 0, opacity: 1, visibility: 'visible' } : { x: '104%', opacity: 0, transitionEnd: { visibility: 'hidden' } }}
      transition={{ ...UI, duration: 0.28 }}
    >
      <div className="chat-head">
        <div className="chat-head-title">
          <h2>Assistant</h2>
        </div>
        <div className="chat-head-actions">
          {items.length > 0 && (
            <button type="button" className="text-button" onClick={reset} disabled={busy}>
              New conversation
            </button>
          )}
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close the assistant">
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef} aria-live="polite">
        {items.length === 0 ? (
          <div className="chat-empty">
            <LogoMark size={40} />
            <p className="chat-empty-lead">Ask about your notes, or ask me to add to them.</p>
            <p>
              I check your notes first and cite the note each answer comes from. If your notes have nothing on it, I
              say so and answer from general knowledge, marked as such.
            </p>
            <p className="muted">Deleting always needs your confirmation, and cannot be done by voice.</p>
          </div>
        ) : (
          items.map((item) =>
            item.kind === 'user' ? (
              <div key={item.id} className="msg-user">
                <p>{item.text}</p>
                {item.source === 'voice' && <span className="msg-user-meta">By voice</span>}
              </div>
            ) : (
              <article key={item.id} className="msg-assistant" aria-label="Assistant">
                <div className="msg-assistant-body">
                  {(item.steps.length > 0 || item.changes.length > 0) && (
                    <ul className="steps">
                      {item.steps.map((s, n) => {
                        const running = item.streaming && n === item.steps.length - 1 && !item.text && !item.ask
                        if (s.kind === 'notice') return <li key={n} className="step notice">{s.text}</li>
                        if (running) return null // shown by the thinking state below
                        return (
                          <li key={n} className="step">
                            <CheckIcon />
                            {DONE[s.tool] ?? s.tool}
                          </li>
                        )
                      })}
                      {item.changes.map((c, n) => (
                        <li key={`c${n}`} className="step change">
                          {CHANGED[c.action] ?? 'Changed'}{' '}
                          {c.action === 'deleted' ? (
                            <strong>{c.note.title}</strong>
                          ) : (
                            <button type="button" className="link" onClick={() => onOpenNote(c.note)}>
                              {c.note.title}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.text ? (
                    <div className="msg-text">
                      {item.text}
                      {item.streaming && <span className="caret" aria-hidden="true" />}
                    </div>
                  ) : (
                    item.streaming &&
                    !item.ask && (
                      <Thinking
                        label={(() => {
                          const last = item.steps.at(-1)
                          return last?.kind === 'tool' ? (DOING[last.tool] ?? 'Working') : 'Thinking'
                        })()}
                      />
                    )
                  )}
                  {item.ask && (
                    <AskUser
                      question={item.ask.question}
                      options={item.ask.options}
                      answered={item.ask.answered}
                      disabled={busy}
                      onAnswer={answer}
                    />
                  )}
                  {item.error && (
                    <p className="msg-error" role="alert">
                      {item.error.message}
                      {item.error.hint && <span className="hint-line">{item.error.hint}</span>}
                    </p>
                  )}
                </div>
              </article>
            ),
          )
        )}
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={pending.current ? 'Answer the question, or pick an option above' : 'Ask about your notes'}
            aria-label="Message to the assistant"
            rows={2}
          />
          <div className="composer-row">
            <span className="composer-hint" aria-live="polite">
              {transcribing ? 'Transcribing' : rec.state === 'recording' ? 'Recording. Press stop to send.' : (rec.error ?? '')}
            </span>
            <div className="composer-actions">
              {rec.state !== 'unsupported' && (
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => void toggleVoice()}
                  disabled={busy || transcribing}
                  aria-label={rec.state === 'recording' ? 'Stop and send voice message' : 'Speak a message'}
                  aria-pressed={rec.state === 'recording'}
                >
                  {rec.state === 'recording' ? <StopIcon /> : <MicIcon />}
                </button>
              )}
              <button type="submit" className="button" disabled={busy || !draft.trim()}>
                <SendIcon />
                {busy ? 'Working' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </motion.aside>
  )
}
