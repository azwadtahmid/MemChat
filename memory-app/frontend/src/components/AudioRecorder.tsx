import { useEffect, useState } from 'react'
import { api, ServiceError, type Note } from '../api'
import { MicIcon, StopIcon } from '../icons'
import { clock, useRecorder } from '../lib/useRecorder'

interface Props {
  onCreated: (note: Note) => void
  onCancel: () => void
}

/** Records in the browser, uploads, and the backend transcribes with Whisper. */
export default function AudioRecorder({ onCreated, onCancel }: Props) {
  const rec = useRecorder()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Start recording as soon as the recorder appears: the user already chose Audio.
  const { start } = rec
  useEffect(() => {
    void start()
  }, [start])

  async function finish() {
    const blob = await rec.stop()
    if (!blob) return setError('Nothing was recorded.')
    setUploading(true)
    setError(null)
    try {
      onCreated(await api.createAudioNote(blob))
    } catch (err) {
      setError(err instanceof ServiceError ? err.problems.map((p) => p.message).join('. ') : 'The recording could not be saved.')
      setUploading(false)
    }
  }

  const message = rec.state === 'unsupported' ? 'This browser cannot record audio.' : (rec.error ?? error)

  return (
    <div className="recorder" role="group" aria-label="Record an audio note">
      {uploading ? (
        <span className="pending" role="status">
          <span className="pending-label">Transcribing</span>
          <span className="sweep" aria-hidden="true" />
        </span>
      ) : rec.state === 'recording' ? (
        <>
          <span className="recording-dot" aria-hidden="true" />
          <span className="recorder-time" role="timer" aria-label="Recording time">
            {clock(rec.seconds)}
          </span>
          <button type="button" className="button primary" onClick={() => void finish()}>
            <StopIcon />
            Stop and save
          </button>
          <button type="button" className="button quiet" onClick={() => { rec.cancel(); onCancel() }}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button type="button" className="button" onClick={() => void rec.start()} disabled={rec.state === 'unsupported'}>
            <MicIcon />
            Record again
          </button>
          <button type="button" className="button quiet" onClick={onCancel}>
            Cancel
          </button>
        </>
      )}
      {message && <p className="form-error">{message}</p>}
    </div>
  )
}
