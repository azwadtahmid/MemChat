import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'recording' | 'unsupported'

/** Browser audio recording with MediaRecorder. stop() resolves with the recording. */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>(
    typeof MediaRecorder === 'undefined' || !navigator.mediaDevices ? 'unsupported' : 'idle',
  )
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<number | null>(null)

  const release = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current)
    timer.current = null
    recorder.current?.stream.getTracks().forEach((t) => t.stop())
    recorder.current = null
  }, [])

  // Stop the microphone if the component goes away mid-recording.
  useEffect(() => release, [release])

  const start = useCallback(async () => {
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      setError(
        name === 'NotAllowedError'
          ? 'Microphone access is blocked. Allow it in the browser address bar, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : 'The microphone could not be started.',
      )
      return
    }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    )
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    chunks.current = []
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    rec.start()
    recorder.current = rec
    setSeconds(0)
    timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    setState('recording')
  }, [])

  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const rec = recorder.current
        if (!rec) return resolve(null)
        rec.onstop = () => {
          const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
          release()
          setState('idle')
          resolve(blob.size ? blob : null)
        }
        rec.stop()
      }),
    [release],
  )

  const cancel = useCallback(() => {
    if (recorder.current) recorder.current.onstop = null
    recorder.current?.stop()
    release()
    setState('idle')
  }, [release])

  return { state, seconds, error, start, stop, cancel }
}

export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
