export interface RecordedCapture {
  round: number
  /** Synchronized (server) time at capture. */
  at: number
  /** Local wall-clock at capture — comparable across two browsers on one machine. */
  wallAt: number
  mirrored: boolean
}

declare global {
  interface Window {
    __booth?: { lastCapture?: RecordedCapture }
  }
}

/** Test visibility only. Compiled out of production builds. */
export function recordCapture(capture: RecordedCapture): void {
  if (import.meta.env.DEV) window.__booth = { ...window.__booth, lastCapture: capture }
}
