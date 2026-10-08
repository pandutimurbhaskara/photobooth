export type CameraError = 'blocked' | 'unavailable' | 'unsupported'

export function classifyCameraError(e: unknown): CameraError {
  const name = typeof e === 'object' && e !== null && 'name' in e ? String((e as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'blocked'
  if (name === 'UnsupportedError') return 'unsupported'
  return 'unavailable'
}

/** The preview is mirrored exactly when the captured photo is (spec D15). Rear cameras are never mirrored. */
export function isMirrored(track: Pick<MediaStreamTrack, 'getSettings'>): boolean {
  return track.getSettings().facingMode !== 'environment'
}

export async function openCamera(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    // Insecure context (plain http on a LAN address) hides mediaDevices entirely.
    throw Object.assign(new Error('camera API unavailable'), { name: 'UnsupportedError' })
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
    },
  })
}

/**
 * Calls `onEnded` when the stream's video track ends (permission revoked, camera unplugged, taken by another app).
 * Without this the preview just freezes while everything still looks connected. Returns an unsubscribe.
 */
export function watchTrackEnded(stream: Pick<MediaStream, 'getVideoTracks'>, onEnded: () => void): () => void {
  const track = stream.getVideoTracks()[0]
  if (!track) return () => {}
  if (track.readyState === 'ended') {
    onEnded()
    return () => {}
  }
  track.addEventListener('ended', onEnded, { once: true })
  return () => track.removeEventListener('ended', onEnded)
}

export async function listVideoInputs(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices()
  return all.filter((d) => d.kind === 'videoinput')
}
