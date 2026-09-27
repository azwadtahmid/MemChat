import { useEffect, useRef } from 'react'
import { CloseIcon } from '../icons'

interface Props {
  open: boolean
  onClose: () => void
  retentionDays: number
}

/** The one line a new user sees above their empty notes. */
export function PrivacyLine({ onMore }: { onMore: () => void }) {
  return (
    <p className="privacy-line">
      Your notes are stored unencrypted on MemChat's server, and belong to this browser only.{' '}
      <button type="button" className="link" onClick={onMore}>
        How your notes are kept
      </button>
    </p>
  )
}

/**
 * The fuller explanation, in a native dialog: it traps focus, closes on
 * Escape, and returns focus to whatever opened it.
 */
export default function Privacy({ open, onClose, retentionDays }: Props) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="privacy"
      aria-labelledby="privacy-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="privacy-head">
        <h2 id="privacy-title">How your notes are kept</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
      </div>
      <dl className="privacy-list">
        <dt>On a server, not in your browser</dt>
        <dd>Your notes are stored on a server run by the person who made MemChat.</dd>
        <dt>Not encrypted</dt>
        <dd>
          Notes are stored as plain text. Anyone with access to that server, including its owner, can read them. Keep
          passwords and anything you would not want read out of your notes.
        </dd>
        <dt>Tied to this browser</dt>
        <dd>
          There is no account. You are recognised by an ID kept in this browser's storage. Clear this site's data, or
          open MemChat in another browser or device, and you start with an empty set of notes. The old ones cannot be
          recovered.
        </dd>
        <dt>Deleted means gone after {retentionDays} days</dt>
        <dd>
          Deleted notes wait in the trash for {retentionDays} days so they can be restored, then are removed
          permanently.
        </dd>
        <dt>The assistant</dt>
        <dd>
          When you use the assistant or speak a message, the relevant notes and your words are sent to Groq, which runs
          the language and speech models, to produce the answer.
        </dd>
      </dl>
    </dialog>
  )
}
