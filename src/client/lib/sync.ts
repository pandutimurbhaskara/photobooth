import { SYNC_WINDOW } from '../../shared/constants'

/** One ping round trip: when we sent (t0), when the pong arrived (t1), and the server's clock in its reply (ts). */
export interface PingSample {
  t0: number
  t1: number
  ts: number
}

/** NTP-style: assume the reply was generated halfway through the round trip. Error is bounded by rtt/2. */
export function sampleOffset(s: PingSample): { rtt: number; offset: number } {
  const rtt = s.t1 - s.t0
  return { rtt, offset: s.ts - (s.t0 + rtt / 2) } // server time minus client time
}

/** The lowest-RTT sample saw the least queuing, so it is the least asymmetric and the most trustworthy. */
export function estimateOffset(samples: readonly PingSample[]): { offset: number; rtt: number } | null {
  let best: { offset: number; rtt: number } | null = null
  for (const s of samples) {
    const x = sampleOffset(s)
    if (x.rtt < 0) continue // the local clock jumped backwards during the round trip
    if (best === null || x.rtt < best.rtt) best = x
  }
  return best
}

export class SyncClock {
  private samples: PingSample[] = []

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly windowSize: number = SYNC_WINDOW,
  ) {}

  add(sample: PingSample): void {
    this.samples.push(sample)
    if (this.samples.length > this.windowSize) this.samples.shift()
  }

  get estimate(): { offset: number; rtt: number } | null {
    return estimateOffset(this.samples)
  }
  get offset(): number {
    return this.estimate?.offset ?? 0
  }
  get synced(): boolean {
    return this.estimate !== null
  }
  /** The server's clock, as best we can tell. Use this for everything scheduled; never raw Date.now(). */
  now(): number {
    return this.clock() + this.offset
  }
}
