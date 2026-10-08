import { describe, expect, it } from 'vitest'
import { countdownLabel, createCaptureScheduler, type CaptureDeps } from './capture'

class FakeClock {
  t = 0
  private timers: Array<{ at: number; fn: () => void; id: number }> = []
  private frames: Array<{ fn: () => void; id: number }> = []
  private next = 1
  deps: CaptureDeps = {
    now: () => this.t,
    setTimer: (fn, ms) => {
      const id = this.next++
      this.timers.push({ at: this.t + ms, fn, id })
      return id
    },
    clearTimer: (h) => {
      this.timers = this.timers.filter((x) => x.id !== h)
    },
    nextFrame: (fn) => {
      const id = this.next++
      this.frames.push({ fn, id })
      return id
    },
    cancelFrame: (h) => {
      this.frames = this.frames.filter((x) => x.id !== h)
    },
  }
  /** Step in 16 ms "frames": fire due timers, then run the animation callbacks queued so far. */
  advance(ms: number, step = 16): void {
    const end = this.t + ms
    while (this.t < end) {
      this.t = Math.min(this.t + step, end)
      const due = this.timers.filter((x) => x.at <= this.t)
      this.timers = this.timers.filter((x) => x.at > this.t)
      due.forEach((x) => x.fn())
      const frames = this.frames
      this.frames = []
      frames.forEach((x) => x.fn())
    }
  }
}

describe('countdownLabel', () => {
  it.each([
    [4500, 'get-ready'],
    [3001, 'get-ready'],
    [3000, 3],
    [2500, 3],
    [2000, 2],
    [1000, 1],
    [1, 1],
    [0, 'snap'],
    [-50, 'snap'],
  ])('%i ms before capture → %s', (ms, expected) => {
    expect(countdownLabel(ms)).toBe(expected)
  })
})

describe('createCaptureScheduler', () => {
  it('captures once, at or just after captureAt, and never early', () => {
    const clock = new FakeClock()
    const captured: number[] = []
    const scheduler = createCaptureScheduler(clock.deps)
    expect(scheduler.schedule(1, 4500, (_r, at) => captured.push(at), () => {})).toBe(true)
    clock.advance(4499)
    expect(captured).toEqual([])
    clock.advance(100)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toBeGreaterThanOrEqual(4500)
    expect(captured[0]).toBeLessThan(4500 + 40)
    clock.advance(10_000)
    expect(captured).toHaveLength(1)
  })

  // Review Focus 2: duplicates and late deliveries.
  it('ignores a repeat of a round it has already seen (reconnect replay)', () => {
    const clock = new FakeClock()
    let count = 0
    const scheduler = createCaptureScheduler(clock.deps)
    expect(scheduler.schedule(1, 4500, () => count++, () => {})).toBe(true)
    expect(scheduler.schedule(1, 4500, () => count++, () => {})).toBe(false)
    expect(scheduler.schedule(0, 4500, () => count++, () => {})).toBe(false) // older round
    clock.advance(6000)
    expect(count).toBe(1)
  })

  it('still captures when the message arrives a little late (within the grace period)', () => {
    const clock = new FakeClock()
    clock.t = 10_000
    const captured: number[] = []
    createCaptureScheduler(clock.deps).schedule(1, 9_000, (_r, at) => captured.push(at), () => {}) // 1000 ms late
    clock.advance(40)
    expect(captured).toHaveLength(1)
  })

  it('reports MISSED instead of capturing when the message is too late', () => {
    const clock = new FakeClock()
    clock.t = 10_000
    const missed: number[] = []
    let captured = 0
    const scheduler = createCaptureScheduler(clock.deps)
    scheduler.schedule(7, 8_400, () => captured++, (r) => missed.push(r)) // 1600 ms late
    clock.advance(1000)
    expect(missed).toEqual([7])
    expect(captured).toBe(0)
    expect(scheduler.schedule(7, 8_400, () => captured++, () => {})).toBe(false)
  })

  // Final review I2: a backgrounded tab throttles timers and rAF, so the timer can fire long after captureAt.
  it('reports MISSED instead of capturing when the timer itself fires far too late (tab was throttled or suspended)', () => {
    const clock = new FakeClock()
    const captured: number[] = []
    const missed: number[] = []
    const scheduler = createCaptureScheduler(clock.deps)
    scheduler.schedule(1, 4500, (_r, at) => captured.push(at), (r) => missed.push(r))
    clock.advance(20_000, 20_000) // one giant step: nothing ran until 15.5 s after the shared moment
    expect(captured).toEqual([])
    expect(missed).toEqual([1])
  })

  it('still captures when the timer is only a little late (within the grace period)', () => {
    const clock = new FakeClock()
    const captured: number[] = []
    const missed: number[] = []
    createCaptureScheduler(clock.deps).schedule(1, 4500, (_r, at) => captured.push(at), (r) => missed.push(r))
    clock.advance(5500, 5500) // runs 1000 ms after captureAt
    expect(captured).toHaveLength(1)
    expect(missed).toEqual([])
  })

  it('cancel() stops a pending capture, and later rounds still work', () => {
    const clock = new FakeClock()
    const rounds: number[] = []
    const scheduler = createCaptureScheduler(clock.deps)
    scheduler.schedule(1, 4500, (r) => rounds.push(r), () => {})
    clock.advance(2000)
    scheduler.cancel()
    clock.advance(10_000)
    expect(rounds).toEqual([])
    const start = clock.t
    scheduler.schedule(2, start + 4500, (r) => rounds.push(r), () => {})
    clock.advance(5000)
    expect(rounds).toEqual([2])
  })
})
