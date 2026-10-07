import { describe, expect, it } from 'vitest'
import { classifyCameraError, isMirrored } from './camera'

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
