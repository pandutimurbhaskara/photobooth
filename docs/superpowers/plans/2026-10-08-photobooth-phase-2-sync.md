# Phase 2 — Sync (Tasks 12–15)

> Part of `2026-10-08-photobooth.md`. **Read that master file first.** Spec: `docs/superpowers/specs/2026-10-07-photobooth-design.md` §5 (state transitions), §7 (clock sync + capture).

**Phase goal:** both people press I'M READY → the server schedules one capture time → both browsers show the same derived 3-2-1 and "capture" (recorded, no photo yet) at the same instant. Leaving mid-countdown cancels the round.

**Gate (all must pass before Phase 3):**
1. `npm run check` green.
2. `npm run test:e2e -- connect.spec.ts capture.spec.ts` green, including "both capture within 150 ms" and "leaving during the countdown cancels".

**Phase 2 stand-in (removed in Task 18):** with no photos yet, a client that has "captured" immediately sends `photo-complete { round }` so the server returns to `ready` and a second round is possible.

---

## Task 12: `BoothRoom` — ready → scheduled capture, photo-complete, timeouts

**Files:**
- Modify: `src/worker/BoothRoom.ts`
- Modify: `src/worker/BoothRoom.test.ts` (append)

**Interfaces:**
- Consumes: Task 4/5 class.
- Produces (wire): `ready`/`unready` accepted only in derived phase `ready` (2 connected, no round in flight); when both slots are ready → `round += 1`, `captureAt = now + CAPTURE_LEAD_MS`, ready/photoDone flags cleared, `capture-scheduled { captureAt, round }` to both, then `room-state` (phase `capture`). `photo-complete { round }` marks that slot done only when `round` matches and a capture is in flight; both done → `captureAt = null`. A capture older than `EXCHANGE_TIMEOUT_MS` is dropped lazily whenever the phase is computed.

- [ ] **Step 1: Append the failing tests** to `src/worker/BoothRoom.test.ts`

Add `CAPTURE_LEAD_MS, EXCHANGE_TIMEOUT_MS` to the existing `../shared/constants` import, then append:
```ts
async function pair() {
  const code = await newRoom()
  const stub = env.BOOTH_ROOM.getByName(code)
  const a = await joinAs(code, 1)
  const b = await joinAs(code, 2)
  await a.take('partner-joined')
  a.clear()
  b.clear()
  return { code, stub, a, b }
}

describe('ready → scheduled capture', () => {
  it('schedules one capture, identical for both, once both are ready', async () => {
    const { a, b } = await pair()
    const before = Date.now()
    a.send({ type: 'ready' })
    const first = await a.take('room-state')
    expect(first.state.participants.a?.ready).toBe(true)
    expect(first.state.phase).toBe('ready')
    await b.expectNone('capture-scheduled')

    b.send({ type: 'ready' })
    const sa = await a.take('capture-scheduled')
    const sb = await b.take('capture-scheduled')
    expect(sa).toEqual(sb)
    expect(sa.round).toBe(1)
    expect(sa.captureAt).toBeGreaterThanOrEqual(before + CAPTURE_LEAD_MS)
    expect(sa.captureAt).toBeLessThan(before + CAPTURE_LEAD_MS + 2000)

    const state = await a.take('room-state')
    expect(state.state).toMatchObject({ phase: 'capture', round: 1, captureAt: sa.captureAt })
    expect(state.state.participants.a).toMatchObject({ ready: false, photoDone: false })
  })

  // Review Focus 1: both people press READY in the same instant.
  it('schedules exactly one round when both press ready at the same instant', async () => {
    const { a, b } = await pair()
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    expect((await a.take('capture-scheduled')).round).toBe(1)
    expect((await b.take('capture-scheduled')).round).toBe(1)
    await a.expectNone('capture-scheduled')
    await b.expectNone('capture-scheduled')
  })

  it('lets someone un-ready, and ignores ready while alone', async () => {
    const code = await newRoom()
    const solo = await joinAs(code, 1)
    solo.send({ type: 'ready' })
    expect((await solo.take('room-state')).state.participants.a?.ready).toBe(false) // ignored while waiting

    const b = await joinAs(code, 2)
    await solo.take('partner-joined')
    solo.clear()
    solo.send({ type: 'ready' })
    expect((await solo.take('room-state')).state.participants.a?.ready).toBe(true)
    solo.send({ type: 'unready' })
    expect((await solo.take('room-state')).state.participants.a?.ready).toBe(false)
    await b.expectNone('capture-scheduled')
  })

  it('ignores ready/unready while a round is in flight', async () => {
    const { a, b } = await pair()
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    await a.take('capture-scheduled')
    a.clear()
    a.send({ type: 'ready' })
    a.send({ type: 'unready' })
    await a.expectNone('capture-scheduled')
    const state = await a.take('room-state')
    expect(state.state).toMatchObject({ phase: 'capture', round: 1 })
    expect(state.state.participants.a?.ready).toBe(false)
  })
})

describe('round lifecycle', () => {
  async function startRound() {
    const ctx = await pair()
    ctx.a.send({ type: 'ready' })
    ctx.b.send({ type: 'ready' })
    await ctx.a.take('capture-scheduled')
    await ctx.b.take('capture-scheduled')
    ctx.a.clear()
    ctx.b.clear()
    return ctx
  }

  it('returns to ready when both report photo-complete, and the next round is numbered 2', async () => {
    const { a, b } = await startRound()
    a.send({ type: 'photo-complete', round: 1 })
    expect((await b.take('room-state')).state.participants.a?.photoDone).toBe(true)
    b.send({ type: 'photo-complete', round: 1 })
    await a.take('room-state') // broadcast for a's own completion (round still in flight)
    const done = await a.take('room-state') // broadcast after b completed: the round is over
    expect(done.state).toMatchObject({ phase: 'ready', captureAt: null, round: 1 })

    a.clear()
    b.clear()
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    expect((await a.take('capture-scheduled')).round).toBe(2)
  })

  it('ignores a photo-complete for the wrong round, or when nothing is in flight', async () => {
    const { a, stub } = await startRound()
    a.send({ type: 'photo-complete', round: 0 })
    a.send({ type: 'photo-complete', round: 9 })
    await a.expectNone('room-state')
    await runInDurableObject(stub, (instance) => {
      expect(peek(instance).rec.slots.a?.photoDone).toBe(false)
    })
  })

  it('cancels the round when the partner disconnects mid-capture', async () => {
    const { a, b } = await startRound()
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    const state = await a.take('room-state')
    expect(state.state).toMatchObject({ phase: 'waiting', captureAt: null })
  })

  it('drops a capture whose exchange never finished once EXCHANGE_TIMEOUT_MS has passed', async () => {
    const { a, stub } = await startRound()
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.captureAt = Date.now() - EXCHANGE_TIMEOUT_MS - 1
    })
    a.send({ type: 'ready' })
    const state = await a.take('room-state')
    expect(state.state).toMatchObject({ phase: 'ready', captureAt: null })
    expect(state.state.participants.a?.ready).toBe(true) // the ready press was accepted
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project worker`
Expected: the new tests FAIL (ready/unready/photo-complete are no-ops).

- [ ] **Step 3: Implement**

In `src/worker/BoothRoom.ts` add `CAPTURE_LEAD_MS` to the `../shared/constants` import, then replace `handle` and add `schedule`:
```ts
  private handle(slot: SlotName, msg: Exclude<ClientMessage, { type: 'join' | 'ping' }>, now: number): void {
    const rec = this.room
    switch (msg.type) {
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this.sendTo(otherSlot(slot), msg) // already validated and rebuilt by parseClientMessage
        return
      case 'ready':
      case 'unready': {
        const me = rec.slots[slot]
        // Only while two people are present and no round is in flight. Re-sync the caller either way
        // (computing the phase may also drop an expired capture).
        if (!me || this.phase(now) !== 'ready') {
          this.broadcastState()
          return
        }
        me.ready = msg.type === 'ready'
        if (rec.slots.a?.ready && rec.slots.b?.ready) this.schedule(now)
        this.save()
        this.broadcastState()
        return
      }
      case 'photo-complete': {
        const me = rec.slots[slot]
        if (!me || rec.captureAt === null || msg.round !== rec.round) return
        me.photoDone = true
        if (rec.slots.a?.photoDone && rec.slots.b?.photoDone) rec.captureAt = null
        this.save()
        this.broadcastState()
        return
      }
    }
  }

  /** The server owns the clock: one timestamp, sent to both. The 3-2-1 on screen is derived from it. */
  private schedule(now: number): void {
    const rec = this.room
    rec.round += 1
    rec.captureAt = now + CAPTURE_LEAD_MS
    for (const name of SLOTS) {
      const s = rec.slots[name]
      if (s) {
        s.ready = false
        s.photoDone = false
      }
    }
    const message: ServerMessage = { type: 'capture-scheduled', captureAt: rec.captureAt, round: rec.round }
    for (const s of this.live()) this.send(s.ws, message)
  }
```
(There is no `void now` line any more; `now` is used.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run --project worker && npm run typecheck && npm run lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/BoothRoom.ts src/worker/BoothRoom.test.ts
git commit -m "feat: schedule synchronized capture when both people are ready"
```

---

## Task 13: Client — `sync.ts` and `useSyncClock`

**Files:**
- Create: `src/client/lib/sync.ts`, `src/client/lib/sync.test.ts`, `src/client/hooks/useSyncClock.ts`

**Interfaces:**
- Consumes: `SYNC_WINDOW`, `SYNC_BURST_INITIAL`, `SYNC_SPACING_MS`; `ClientMessage`.
- Produces:
  - `interface PingSample { t0: number; t1: number; ts: number }` (client send time, client receive time, server time at reply)
  - `sampleOffset(s): { rtt: number; offset: number }` — `rtt = t1 − t0`, `offset = ts − (t0 + rtt/2)` (server minus client)
  - `estimateOffset(samples): { offset: number; rtt: number } | null` — lowest non-negative RTT wins; `null` for no usable sample
  - `class SyncClock` — `add(sample)` (sliding window of `SYNC_WINDOW`), `estimate`, `offset` (0 until synced), `synced`, `now()` = `clock() + offset`
  - `useSyncClock(send, active): { now: () => number; synced: boolean; burst(n: number): void; onPong(m: { clientTime: number; serverTime: number }): void }` — `now` is referentially stable.

- [ ] **Step 1: Write the failing tests**

`src/client/lib/sync.test.ts`:
```ts
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
```
- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/client/lib/sync.test.ts`
Expected: FAIL — cannot resolve `./sync`.

- [ ] **Step 3: Implement**

`src/client/lib/sync.ts`:
```ts
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
```

`src/client/hooks/useSyncClock.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { SYNC_BURST_INITIAL, SYNC_SPACING_MS } from '../../shared/constants'
import type { ClientMessage } from '../../shared/protocol'
import { SyncClock } from '../lib/sync'

/** Pings the server in short bursts and maintains the server-clock offset. `active` = socket is open. */
export function useSyncClock(send: (m: ClientMessage) => boolean, active: boolean) {
  const clock = useRef(new SyncClock())
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const [synced, setSynced] = useState(false)

  const burst = useCallback(
    (count: number) => {
      for (let i = 0; i < count; i++) {
        timers.current.push(setTimeout(() => void send({ type: 'ping', clientTime: Date.now() }), i * SYNC_SPACING_MS))
      }
    },
    [send],
  )

  const onPong = useCallback((m: { clientTime: number; serverTime: number }) => {
    clock.current.add({ t0: m.clientTime, t1: Date.now(), ts: m.serverTime })
    setSynced(true)
  }, [])

  useEffect(() => {
    if (!active) return
    burst(SYNC_BURST_INITIAL)
    const mine = timers.current
    return () => {
      mine.forEach(clearTimeout)
      mine.length = 0
    }
  }, [active, burst])

  const now = useCallback(() => clock.current.now(), [])
  return { now, synced, burst, onPong }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/client/lib/sync.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/sync.ts src/client/lib/sync.test.ts src/client/hooks/useSyncClock.ts
git commit -m "feat: add server clock offset estimation and sync hook"
```

---

## Task 14: Client — capture scheduler and `countdownLabel`

**Files:**
- Create: `src/client/lib/capture.ts`, `src/client/lib/capture.test.ts`

**Interfaces:**
- Consumes: `CAPTURE_SPIN_MS`, `LATE_GRACE_MS`.
- Produces:
  - `type CountdownLabel = 'get-ready' | 3 | 2 | 1 | 'snap'`; `countdownLabel(msUntilCapture: number): CountdownLabel`
  - `interface CaptureDeps { now(): number; setTimer(fn: () => void, ms: number): unknown; clearTimer(h: unknown): void; nextFrame(fn: () => void): unknown; cancelFrame(h: unknown): void }`
  - `browserCaptureDeps(now: () => number): CaptureDeps`
  - `createCaptureScheduler(deps): { schedule(round: number, captureAt: number, onCapture: (round: number, at: number) => void, onMissed: (round: number) => void): boolean; cancel(): void }` — `schedule` returns `false` (and does nothing) for a round it has already seen.

- [ ] **Step 1: Write the failing tests**

`src/client/lib/capture.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/client/lib/capture.test.ts`
Expected: FAIL — cannot resolve `./capture`.

- [ ] **Step 3: Implement**

`src/client/lib/capture.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/client/lib/capture.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/capture.ts src/client/lib/capture.test.ts
git commit -m "feat: add synchronized capture scheduler and countdown labels"
```

---

## Task 15: Booth — ready UI, countdown, dev hook, e2e sync

**Files:**
- Create: `src/client/lib/dev-hook.ts`, `src/client/components/Countdown.tsx`, `e2e/capture.spec.ts`
- Modify: `src/client/screens/Stage.tsx`, `src/client/pages/Booth.tsx`, `e2e/helpers.ts`

**Interfaces:**
- Consumes: Tasks 13, 14; `RoomState`/`PState`.
- Produces:
  - `recordCapture(c: { round: number; at: number; wallAt: number; mirrored: boolean }): void` — writes `window.__booth.lastCapture` **in dev builds only** (`import.meta.env.DEV`).
  - `Countdown({ captureAt, now, onDone })`
  - `Stage` props gain `me: PState | null`, `partner: PState | null`, `canReady: boolean`, `onReady(ready: boolean): void`, `countdown: { captureAt: number } | null`, `now: () => number`, `onCountdownDone: () => void`, `missed: boolean`.
  - e2e helpers: `connectedPair(browser)`, `pressReady(page)`, `lastCapture(page)`.

- [ ] **Step 1: Dev hook and Countdown**

`src/client/lib/dev-hook.ts`:
```ts
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
```

`src/client/components/Countdown.tsx` (plain now; Phase 4 restyles):
```tsx
import { useEffect, useState } from 'react'
import { countdownLabel, type CountdownLabel } from '../lib/capture'

interface Props {
  captureAt: number
  now: () => number
  onDone: () => void
}

const SHOW_SNAP_MS = 1200

export function Countdown({ captureAt, now, onDone }: Props) {
  const [label, setLabel] = useState<CountdownLabel>(() => countdownLabel(captureAt - now()))

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const remaining = captureAt - now()
      if (remaining < -SHOW_SNAP_MS) {
        onDone()
        return
      }
      setLabel(countdownLabel(remaining))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [captureAt, now, onDone])

  const text = label === 'get-ready' ? 'BOTH READY. GET READY.' : label === 'snap' ? 'SNAP!' : String(label)
  return (
    <div data-testid="countdown" aria-live="assertive" className="text-center">
      <p key={String(label)} className="text-8xl font-black">
        {text}
      </p>
      <p className="font-black">HOLD STILL. THIS ONE'S GOOD.</p>
    </div>
  )
}
```

- [ ] **Step 2: Stage with ready controls**

Replace `src/client/screens/Stage.tsx`:
```tsx
import type { RefObject } from 'react'
import type { PState } from '../../shared/protocol'
import { CameraFrame } from '../components/CameraFrame'
import { Countdown } from '../components/Countdown'
import type { PeerState } from '../lib/webrtc'

interface Props {
  stream: MediaStream | null
  mirrored: boolean
  remoteStream: MediaStream | null
  remoteMirrored: boolean
  peerState: PeerState
  localVideoRef: RefObject<HTMLVideoElement | null>
  me: PState | null
  partner: PState | null
  canReady: boolean
  onReady: (ready: boolean) => void
  countdown: { captureAt: number } | null
  now: () => number
  onCountdownDone: () => void
  missed: boolean
}

export function Stage(p: Props) {
  const iAmReady = p.me?.ready ?? false
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4">
      <p className="font-black">{p.peerState === 'connected' ? '● CONNECTED' : '● CONNECTING'}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <CameraFrame stream={p.remoteStream} label="THEM" mirrored={p.remoteMirrored} testId="remote-video" />
        <CameraFrame stream={p.stream} label="YOU" mirrored={p.mirrored} testId="local-video" videoRef={p.localVideoRef} />
      </div>

      {p.missed && (
        <p role="alert" className="font-black">
          MISSED IT. TRY AGAIN IN A MOMENT.
        </p>
      )}

      {p.countdown ? (
        <Countdown captureAt={p.countdown.captureAt} now={p.now} onDone={p.onCountdownDone} />
      ) : (
        <section className="flex flex-col gap-2">
          <p className="font-black">
            YOU {iAmReady ? 'READY ✓' : 'NOT READY'} · THEM {p.partner?.ready ? 'READY ✓' : 'WAITING...'}
          </p>
          <button
            type="button"
            disabled={!p.canReady}
            onClick={() => p.onReady(!iAmReady)}
            className="border-4 border-black px-4 py-4 text-xl font-black disabled:opacity-50"
          >
            {iAmReady ? 'READY ✓' : "I'M READY"}
          </button>
        </section>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Wire `Booth.tsx`**

Edit `src/client/pages/Booth.tsx`. Add imports:
```tsx
import { useCallback, useMemo, useRef, useState } from 'react'
import { SYNC_BURST_READY } from '../../shared/constants'
import { useSyncClock } from '../hooks/useSyncClock'
import { browserCaptureDeps, createCaptureScheduler } from '../lib/capture'
import { recordCapture } from '../lib/dev-hook'
```
(replace the existing `react` import line; keep the others.) Inside `BoothInner`, after `const slot = useRef…` add:
```tsx
  const [countdown, setCountdown] = useState<{ round: number; captureAt: number } | null>(null)
  const [missed, setMissed] = useState(false)
```
Replace the `onMessage` block with:
```tsx
  const onMessage = useLatest((m: ServerMessage, isSnapshot: boolean) => {
    switch (m.type) {
      case 'room-state':
        slot.current = m.state.you
        if (isSnapshot && m.state.you === 'a' && m.state.participants.b?.connected) rtc.buildAndOffer()
        // A reload or reconnect mid-round: the room-state carries the round, and the scheduler dedupes repeats.
        if (m.state.phase === 'capture' && m.state.captureAt !== null) beginRound.current(m.state.round, m.state.captureAt)
        return
      case 'partner-joined':
        if (slot.current === 'a') rtc.buildAndOffer()
        else rtc.closePeer()
        return
      case 'partner-left':
        scheduler.cancel()
        setCountdown(null)
        rtc.closePeer()
        return
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        rtc.onSignal(m)
        return
      case 'pong':
        sync.onPong(m)
        return
      case 'capture-scheduled':
        beginRound.current(m.round, m.captureAt)
        return
      default:
        return
    }
  })
```
After the `useWebRTC` call add:
```tsx
  const sync = useSyncClock(room.send, room.status === 'open')
  const scheduler = useMemo(() => createCaptureScheduler(browserCaptureDeps(sync.now)), [sync.now])

  // Phase 2: "capture" just records the moment; Task 18 replaces the body with a real frame grab.
  const onCapture = useLatest((round: number, at: number) => {
    recordCapture({ round, at, wallAt: Date.now(), mirrored: camera.mirrored })
    room.send({ type: 'photo-complete', round }) // Phase 2 stand-in: no photo to exchange yet
  })
  const beginRound = useLatest((round: number, captureAt: number) => {
    setMissed(false)
    const accepted = scheduler.schedule(round, captureAt, (r, at) => onCapture.current(r, at), () => setMissed(true))
    if (accepted) setCountdown({ round, captureAt })
  })
  const finishCountdown = useCallback(() => setCountdown(null), [])
```
Then replace the final `return ( <Stage … /> )` with:
```tsx
  const me = room.state.participants[room.state.you]
  return (
    <Stage
      stream={camera.stream}
      mirrored={camera.mirrored}
      remoteStream={rtc.remoteStream}
      remoteMirrored
      peerState={rtc.peerState}
      localVideoRef={localVideo}
      me={me}
      partner={partner}
      canReady={sync.synced && rtc.peerState === 'connected' && rtc.channelOpen}
      onReady={(ready) => {
        if (ready) sync.burst(SYNC_BURST_READY) // refresh the offset right before a round
        room.send({ type: ready ? 'ready' : 'unready' })
      }}
      countdown={countdown}
      now={sync.now}
      onCountdownDone={finishCountdown}
      missed={missed}
    />
  )
```
Note `sync`, `scheduler`, `beginRound` are referenced inside the `onMessage` closure before they are declared; that is legal for the same reason `rtc` already is (the closure runs later).

- [ ] **Step 4: e2e helpers and spec**

Append to `e2e/helpers.ts`:
```ts
export async function connectedPair(browser: Browser): Promise<{ a: Page; b: Page; url: string }> {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  const url = await createBooth(a)
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)
  return { a, b, url }
}

export async function pressReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: /i'm ready/i }).click() // waits for the button to be enabled
}

export interface Captured {
  round: number
  at: number
  wallAt: number
  mirrored: boolean
}

export function lastCapture(page: Page): Promise<Captured | null> {
  return page.evaluate(
    () => (window as unknown as { __booth?: { lastCapture?: Captured } }).__booth?.lastCapture ?? null,
  )
}
```

`e2e/capture.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { connectedPair, lastCapture, pressReady } from './helpers'

test('both browsers capture the same round at essentially the same moment', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await expect(a.getByText('YOU READY ✓')).toBeVisible()
  await pressReady(b)

  await expect(a.getByTestId('countdown')).toBeVisible()
  await expect(b.getByTestId('countdown')).toBeVisible()
  await expect(a.getByTestId('countdown')).toContainText('BOTH READY. GET READY.')

  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).not.toBeNull()
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).not.toBeNull()
  const [ca, cb] = await Promise.all([lastCapture(a), lastCapture(b)])
  expect(ca?.round).toBe(1)
  expect(cb?.round).toBe(1)
  // Same machine ⇒ same wall clock ⇒ this measures real simultaneity, not just agreement on a timestamp.
  expect(Math.abs((ca?.wallAt ?? 0) - (cb?.wallAt ?? 0))).toBeLessThan(150)
})

test('a second round can follow the first', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ round: 1 })
  await expect(a.getByTestId('countdown')).toBeHidden({ timeout: 10_000 })

  await pressReady(a) // the server returned to `ready` once both reported photo-complete
  await pressReady(b)
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ round: 2 })
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).toMatchObject({ round: 2 })
})

test('leaving during the countdown cancels the capture', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByTestId('countdown')).toBeVisible()

  await b.close()
  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  await a.waitForTimeout(6000) // longer than the 4.5 s lead: the cancelled round must not fire
  expect(await lastCapture(a)).toBeNull()
})
```

- [ ] **Step 5: Phase gate**

Run: `npm run check && npm run test:e2e -- connect.spec.ts capture.spec.ts`
Expected: everything green. If "capture Δ < 150 ms" is flaky on a slow machine, do **not** loosen it blindly: print both `wallAt` values and the `at` (synchronized) values; if `at` values are close but `wallAt` differs, the culprit is browser scheduling under load (retry with `--workers=1` and nothing else running); if `at` differs, the clock-offset estimate is wrong — investigate `SyncClock`/`useSyncClock` first.

- [ ] **Step 6: Commit**

```bash
git add src/client e2e
git commit -m "feat: add ready flow, derived countdown and synchronized capture timing"
```

**Phase 2 gate reached.**
