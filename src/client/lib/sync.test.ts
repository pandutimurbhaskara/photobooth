import { describe, expect, it } from 'vitest'
import { SYNC_WINDOW } from '../../shared/constants'
import { estimateOffset, sampleOffset, SyncClock, type PingSample } from './sync'

const sample = (t0: number, t1: number, ts: number): PingSample => ({ t0, t1, ts })

describe('sampleOffset', () => {
  it('assumes a symmetric path', () => {
    expect(sampleOffset(sample(1000, 1100, 5050))).toEqual({ rtt: 100, offset: 4000 })
  })
  it('is wrong by at most rtt/2 on an asymmetric path', () => {
    // true offset 4000; outbound 90 ms, inbound 10 ms
    const s = sampleOffset(sample(1000, 1100, 5090))
    expect(s.offset).toBe(4040)
    expect(Math.abs(s.offset - 4000)).toBeLessThanOrEqual(s.rtt / 2)
  })
  it('handles a device clock that is hours off', () => {
    expect(sampleOffset(sample(0, 100, 3_600_050)).offset).toBe(3_600_000) // server an hour ahead
    expect(sampleOffset(sample(3_600_000, 3_600_100, 50)).offset).toBe(-3_600_000) // server an hour behind
  })
})

describe('estimateOffset', () => {
  it('returns null with no samples (offline: nothing ever came back)', () => {
    expect(estimateOffset([])).toBeNull()
  })
  it('keeps the lowest-RTT sample, the least queued and so least asymmetric', () => {
    const slow = sample(0, 300, 4150 + 100) // rtt 300, offset 4100
    const fast = sample(1000, 1040, 5020) // rtt 40,  offset 4000
    expect(estimateOffset([slow, fast])).toEqual({ rtt: 40, offset: 4000 })
    expect(estimateOffset([fast, slow])).toEqual({ rtt: 40, offset: 4000 })
  })
  it('ignores a sample whose clock jumped backwards (negative RTT)', () => {
    expect(estimateOffset([sample(1000, 900, 5000)])).toBeNull()
    expect(estimateOffset([sample(1000, 900, 5000), sample(1000, 1100, 5050)])).toEqual({ rtt: 100, offset: 4000 })
  })
})

describe('SyncClock', () => {
  it('is not synced, and does not shift time, until a sample arrives', () => {
    const clock = new SyncClock(() => 1_000)
    expect(clock.synced).toBe(false)
    expect(clock.offset).toBe(0)
    expect(clock.now()).toBe(1_000)
  })
  it('shifts the local clock by the estimated offset', () => {
    const clock = new SyncClock(() => 1_000)
    clock.add(sample(0, 100, 4050))
    expect(clock.synced).toBe(true)
    expect(clock.now()).toBe(5_000)
  })
  it('forgets samples older than the window, so a stale best sample cannot pin the estimate forever', () => {
    const clock = new SyncClock(() => 0)
    clock.add(sample(0, 10, 4005)) // best ever: rtt 10, offset 4000
    for (let i = 0; i < SYNC_WINDOW; i++) clock.add(sample(0, 100, 4150)) // rtt 100, offset 4100
    expect(clock.estimate).toEqual({ rtt: 100, offset: 4100 })
  })
})
