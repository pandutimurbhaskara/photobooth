import { describe, expect, it } from 'vitest'
import { classifyCameraError, isMirrored, watchTrackEnded } from './camera'

class FakeTrack extends EventTarget {
  constructor(public readyState: string = 'live') {
    super()
  }
}
const streamOf = (track: FakeTrack | null) => ({ getVideoTracks: () => (track ? [track] : []) }) as unknown as MediaStream

// Final review I3: a lost camera (revoked permission, unplugged, taken by another app) must surface, not freeze silently.
describe('watchTrackEnded', () => {
  it('calls back once when the video track ends, and stops after unsubscribe', () => {
    const track = new FakeTrack()
    let calls = 0
    const stop = watchTrackEnded(streamOf(track), () => calls++)
    track.dispatchEvent(new Event('ended'))
    track.dispatchEvent(new Event('ended'))
    expect(calls).toBe(1)
    const track2 = new FakeTrack()
    const stop2 = watchTrackEnded(streamOf(track2), () => calls++)
    stop2()
    track2.dispatchEvent(new Event('ended'))
    expect(calls).toBe(1)
    stop()
  })
  it('reports immediately for a track that already ended, and is a no-op without a track', () => {
    let calls = 0
    watchTrackEnded(streamOf(new FakeTrack('ended')), () => calls++)
    expect(calls).toBe(1)
    expect(() => watchTrackEnded(streamOf(null), () => calls++)()).not.toThrow()
    expect(calls).toBe(1)
  })
})

describe('classifyCameraError', () => {
  it.each([
    ['NotAllowedError', 'blocked'],
    ['SecurityError', 'blocked'],
    ['PermissionDeniedError', 'blocked'],
    ['NotFoundError', 'unavailable'],
    ['NotReadableError', 'unavailable'],
    ['OverconstrainedError', 'unavailable'],
    ['AbortError', 'unavailable'],
    ['UnsupportedError', 'unsupported'],
    ['SomethingElse', 'unavailable'],
  ])('%s → %s', (name, expected) => {
    expect(classifyCameraError({ name })).toBe(expected)
  })
  it('treats non-errors as unavailable', () => {
    expect(classifyCameraError(undefined)).toBe('unavailable')
    expect(classifyCameraError('boom')).toBe('unavailable')
  })
})

describe('isMirrored', () => {
  const track = (facingMode?: string) => ({ getSettings: () => ({ facingMode }) }) as Pick<MediaStreamTrack, 'getSettings'>
  it('mirrors front cameras and webcams that report no facing mode', () => {
    expect(isMirrored(track('user'))).toBe(true)
    expect(isMirrored(track(undefined))).toBe(true)
  })
  it('does not mirror the rear camera', () => {
    expect(isMirrored(track('environment'))).toBe(false)
  })
})
