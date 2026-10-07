import { CAPTURE_SPIN_MS, LATE_GRACE_MS } from '../../shared/constants'

export type CountdownLabel = 'get-ready' | 3 | 2 | 1 | 'snap'

/**
 * What the screen shows, derived from the time remaining. Purely cosmetic: the capture itself is
 * triggered by the scheduler below against the same timestamp, never by this animation.
 */
export function countdownLabel(msUntilCapture: number): CountdownLabel {
  const n = Math.ceil(msUntilCapture / 1000)
  if (n > 3) return 'get-ready'
  if (n >= 1) return n as 1 | 2 | 3
  return 'snap'
}

export interface CaptureDeps {
  /** The synchronized (server) clock. */
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  nextFrame(fn: () => void): unknown
  cancelFrame(handle: unknown): void
}

export function browserCaptureDeps(now: () => number): CaptureDeps {
  return {
    now,
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
    nextFrame: (fn) => window.requestAnimationFrame(fn),
    cancelFrame: (h) => window.cancelAnimationFrame(h as number),
  }
}

/**
 * Fires `onCapture` once, as close to `captureAt` (server clock) as the browser allows:
 * sleep with setTimeout until just before, then spin on animation frames until the synchronized
 * clock reaches it. A round it has already seen is ignored; a round delivered more than
 * LATE_GRACE_MS after its time is reported as missed rather than captured late.
 */
export function createCaptureScheduler(deps: CaptureDeps) {
  let lastRound = -1
  let timer: unknown = null
  let frame: unknown = null

  const cancel = (): void => {
    if (timer !== null) deps.clearTimer(timer)
    if (frame !== null) deps.cancelFrame(frame)
    timer = null
    frame = null
  }

  return {
    schedule(
      round: number,
      captureAt: number,
      onCapture: (round: number, at: number) => void,
      onMissed: (round: number) => void,
    ): boolean {
      if (round <= lastRound) return false
      lastRound = round
      cancel()
      const remaining = captureAt - deps.now()
      if (remaining < -LATE_GRACE_MS) {
        onMissed(round)
        return true
      }
      const fire = (): void => {
        frame = null
        const at = deps.now()
        if (at >= captureAt) onCapture(round, at)
        else frame = deps.nextFrame(fire)
      }
      timer = deps.setTimer(() => {
        timer = null
        fire()
      }, Math.max(0, remaining - CAPTURE_SPIN_MS))
      return true
    },
    cancel,
  }
}
