import { useCallback, useEffect, useRef, useState } from 'react'
import { classifyCameraError, isMirrored, listVideoInputs, openCamera, watchTrackEnded, type CameraError } from '../lib/camera'

export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<CameraError | null>(null)
  const [canFlip, setCanFlip] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCurrent = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  const adopt = useCallback((next: MediaStream) => {
    streamRef.current = next
    setStream(next)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      stopCurrent()
      adopt(await openCamera())
      setCanFlip((await listVideoInputs()).length > 1) // device labels/ids are only exposed after permission
    } catch (e) {
      setError(classifyCameraError(e))
    }
  }, [adopt, stopCurrent])

  /** Cycle to the next camera. The old tracks are stopped first: many phones allow only one open camera. */
  const flip = useCallback(async () => {
    const inputs = await listVideoInputs()
    if (inputs.length < 2) return
    const current = streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId
    const next = inputs[(inputs.findIndex((d) => d.deviceId === current) + 1) % inputs.length]
    if (!next) return
    stopCurrent()
    try {
      adopt(await openCamera(next.deviceId))
    } catch {
      await start()
    }
  }, [adopt, start, stopCurrent])

  useEffect(() => stopCurrent, [stopCurrent])

  // A camera that disappears mid-booth surfaces the same "no camera" screen (with TRY AGAIN) instead of a frozen preview.
  useEffect(() => (stream ? watchTrackEnded(stream, () => setError('unavailable')) : undefined), [stream])

  const track = stream?.getVideoTracks()[0]
  return { stream, error, mirrored: track ? isMirrored(track) : true, canFlip, start, flip }
}
