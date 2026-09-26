import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react'
import { SendIcon } from './icons'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'streaming' | 'done' | 'error'
  // What the backend is doing before the first token arrives.
  phase?: 'searching' | 'generating'
  // Position within a group of messages added together; drives the stagger.
  enterIndex?: number
  error?: string
}

interface Props {
  messages: Message[]
  busy: boolean
  onSend: (text: string) => void
}

// Distance from the bottom (px) within which the view keeps following new text.
const STICK_THRESHOLD = 48

const PHASE_LABEL = {
  searching: 'Searching memories',
  generating: 'Generating reply',
} as const

/** Before the first token: a phase label over a short sweeping line. */
function PendingIndicator({ phase }: { phase: 'searching' | 'generating' }) {
  return (
    <span className="pending" role="status">
      <span className="pending-label">{PHASE_LABEL[phase]}</span>
      <span className="sweep" aria-hidden="true" />
    </span>
  )
}

export default function Chat({ messages, busy, onSend }: Props) {
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  // Follow new tokens only if the user has not scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages])

  function onScroll() {
    const el = scrollRef.current!
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD
  }

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    stickToBottom.current = true
    onSend(text)
    setDraft('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <section className="chat" aria-label="Conversation">
      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="empty">
            <h1>Replies use what MemChat remembers</h1>
            <p>
              Each message is matched against your stored memories before the model replies. The
              exchange is then saved back to memory for future conversations.
            </p>
            <p>Open the memory rail on the right edge to see which memories a reply used.</p>
          </div>
        ) : (
          messages.map((m) => {
            const waiting = m.status === 'streaming' && m.content === ''
            return (
              <article
                key={m.id}
                className={`message ${m.role}`}
                style={{ '--i': m.enterIndex ?? 0 } as CSSProperties}
              >
                <div className="role">{m.role === 'user' ? 'You' : 'MemChat'}</div>
                {waiting ? (
                  <PendingIndicator phase={m.phase ?? 'searching'} />
                ) : (
                  <div className="content">
                    {m.content}
                    {m.status === 'streaming' && <span className="caret" aria-hidden="true" />}
                  </div>
                )}
                {m.status === 'error' && <p className="message-error">{m.error}</p>}
              </article>
            )
          })
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        <div className="composer-box">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Write a message"
            aria-label="Message"
            rows={2}
            autoFocus
          />
          <div className="composer-row">
            <span className="hint">
              <kbd>Enter</kbd> to send, <kbd>Shift</kbd> + <kbd>Enter</kbd> for a new line
            </span>
            <button type="submit" className="button primary" disabled={busy || !draft.trim()}>
              <SendIcon />
              {busy ? 'Replying' : 'Send'}
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}
