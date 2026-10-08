import { describe, expect, it } from 'vitest'
import { applyPlanAction, defaultPlan, onBothReady, recordTake, type Plan } from '../../shared/plan'
import {
  completeRound,
  finishedOf,
  highestReferenced,
  mergePhoto,
  missingRounds,
  needsCompleteResend,
  pruneStore,
  putRound,
  referencedRounds,
  roundLostAfterCompleting,
  type Round,
  type TakeStore,
} from './takes'
import type { RoomState } from '../../shared/protocol'

const blob = (s: string) => new Blob([s])
const round = (n: number): Round => ({ round: n, a: blob(`a${n}`), b: blob(`b${n}`) })
const store = (...rounds: number[]): TakeStore => rounds.reduce<TakeStore>((s, n) => putRound(s, round(n)), new Map())
function must<T>(v: T | null): T {
  if (v === null) throw new Error('expected a value')
  return v
}
const chosen = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => must(applyPlanAction(defaultPlan(), { k: 'template', template: t }))
const shooting = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => must(onBothReady(chosen(t))).plan
const picking = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => recordTake(recordTake(shooting(t), 1), 2)
const done = (): Plan => {
  const second = must(onBothReady(picking('duo2'))).plan
  return must(onBothReady(recordTake(recordTake(second, 3), 4))).plan
}

describe('mergePhoto / completeRound', () => {
  it('starts a pending round, then fills in the other half', () => {
    const first = mergePhoto(null, 1, 'own', blob('mine'))
    expect(first).toMatchObject({ round: 1 })
    expect(first.partner).toBeUndefined()
    const both = mergePhoto(first, 1, 'partner', blob('theirs'))
    expect(both.own).toBeDefined()
    expect(both.partner).toBeDefined()
  })
  it('starts fresh when a different round arrives', () => {
    const old = mergePhoto(null, 1, 'own', blob('mine'))
    const next = mergePhoto(old, 2, 'partner', blob('theirs'))
    expect(next.round).toBe(2)
    expect(next.own).toBeUndefined()
  })
  it('is null until both photos exist', () => {
    expect(completeRound({ round: 1, own: blob('x') }, 'a')).toBeNull()
    expect(completeRound({ round: 1, partner: blob('x') }, 'b')).toBeNull()
  })
  it("always puts slot a's photo in `a`, whoever is looking", () => {
    const mine = blob('mine')
    const theirs = blob('theirs')
    expect(completeRound({ round: 4, own: mine, partner: theirs }, 'a')).toEqual({ round: 4, a: mine, b: theirs })
    expect(completeRound({ round: 4, own: mine, partner: theirs }, 'b')).toEqual({ round: 4, a: theirs, b: mine })
  })
})

describe('putRound', () => {
  it('adds a round without touching the old store, and replaces a repeat', () => {
    const before = store(1)
    const after = putRound(before, round(2))
    expect(before.size).toBe(1)
    expect([...after.keys()]).toEqual([1, 2])
    expect(putRound(after, round(2)).size).toBe(2)
  })
})

describe('referencedRounds / highestReferenced', () => {
  it('collects every take and kept round the plan points at', () => {
    expect(referencedRounds(defaultPlan())).toEqual([])
    expect(highestReferenced(defaultPlan())).toBe(-1)
    const plan = picking()
    expect(referencedRounds(plan).sort()).toEqual([1, 2, 2])
    expect(highestReferenced(plan)).toBe(2)
  })
})

describe('pruneStore', () => {
  it('drops rounds the plan no longer points at', () => {
    const plan = must(applyPlanAction(done(), { k: 'reset' })) // nothing referenced any more
    const pruned = pruneStore(store(1, 2, 3, 4), plan, 4)
    expect(pruned.size).toBe(0)
  })
  it('keeps a round newer than anything the plan has mentioned yet (finished here, not yet recorded by the server)', () => {
    const plan = picking() // references 1 and 2
    const pruned = pruneStore(store(1, 2, 3), plan, highestReferenced(plan))
    expect([...pruned.keys()].sort()).toEqual([1, 2, 3])
  })
  it('keeps what the plan still needs — the kept rounds — and drops every take that was not kept or is being redone', () => {
    const plan = done() // takes [[1,2],[3,4]], kept [2,4]
    const retaking = must(applyPlanAction(plan, { k: 'retake', cell: 1 })) // cell 1 is being redone: takes [[1,2],[]], kept [2,null]
    const pruned = pruneStore(store(1, 2, 3, 4), retaking, 4)
    expect([...pruned.keys()]).toEqual([2])
  })
  it('returns the very same store when there is nothing to drop (so React can bail out)', () => {
    const plan = picking()
    const s = store(1, 2)
    expect(pruneStore(s, plan, 2)).toBe(s)
  })
})

// Review Focus 2: a reloaded tab holds none of the photos the plan points at.
describe('missingRounds', () => {
  it('is empty when nothing needs photos yet', () => {
    expect(missingRounds(defaultPlan(), store())).toEqual([])
    expect(missingRounds(chosen(), store())).toEqual([])
  })
  it('lists the takes of the current cell while shooting or picking', () => {
    expect(missingRounds(picking(), store(1))).toEqual([2])
    expect(missingRounds(picking(), store(1, 2))).toEqual([])
  })
  it('lists the kept rounds of finished cells, but not takes that were not kept', () => {
    const plan = done() // takes [[1,2],[3,4]], kept [2,4]
    expect(missingRounds(plan, store(2))).toEqual([4])
    expect(missingRounds(plan, store(2, 4))).toEqual([])
  })
})

describe('finishedOf', () => {
  it('is null until the plan is done and every kept photo is held', () => {
    expect(finishedOf(picking(), store(1, 2))).toBeNull()
    expect(finishedOf(done(), store(2))).toBeNull()
  })
  it('lists the kept round of each cell, in cell order, with its kind', () => {
    const plan = must(applyPlanAction(done(), { k: 'reset' }))
    expect(finishedOf(plan, store(1, 2, 3, 4))).toBeNull() // reset: not done
    const finished = must(finishedOf(done(), store(1, 2, 3, 4)))
    expect(finished.template).toBe('duo2')
    expect(finished.cells.map((c) => [c.kind, c.round])).toEqual([
      ['both', 2],
      ['both', 4],
    ])
    expect(finished.cells[0]?.a).toBeInstanceOf(Blob)
  })
})

// Review I4: a photo-complete can be lost on its way to the server (the socket was reconnecting at that moment).
const room = (over: Partial<RoomState> = {}): RoomState => ({
  code: 'ABCDEF',
  you: 'a',
  phase: 'capture',
  round: 3,
  captureAt: null,
  participants: {
    a: { connected: true, ready: false, photoDone: false },
    b: { connected: true, ready: false, photoDone: true },
  },
  plan: defaultPlan(),
  ...over,
})

describe('needsCompleteResend', () => {
  it('is true when this tab finished the round the server is still waiting on but has not counted it', () => {
    expect(needsCompleteResend(room(), 3)).toBe(true)
  })
  it('is false once the server has counted it, when no round is in flight, or for a different round', () => {
    const counted = room({ participants: { a: { connected: true, ready: false, photoDone: true }, b: null } })
    expect(needsCompleteResend(counted, 3)).toBe(false)
    expect(needsCompleteResend(room({ phase: 'ready' }), 3)).toBe(false)
    expect(needsCompleteResend(room(), 2)).toBe(false) // this tab finished an older round
    expect(needsCompleteResend(room(), -1)).toBe(false) // this tab has finished nothing
  })
})

describe('roundLostAfterCompleting', () => {
  it('is true when a round this tab finished ends without becoming a take', () => {
    expect(roundLostAfterCompleting('capture', room({ phase: 'ready' }), 3)).toBe(true)
  })
  it('is false when the round was recorded as a take', () => {
    const recorded = room({ phase: 'ready', plan: { ...defaultPlan(), takes: [[3]] } })
    expect(roundLostAfterCompleting('capture', recorded, 3)).toBe(false)
  })
  it('is false when the phase did not just leave a capture (a retake or reset also clears takes) or the round is not ours', () => {
    expect(roundLostAfterCompleting('ready', room({ phase: 'ready' }), 3)).toBe(false)
    expect(roundLostAfterCompleting('capture', room({ phase: 'ready' }), 2)).toBe(false)
    expect(roundLostAfterCompleting('capture', room({ phase: 'waiting' }), 3)).toBe(false)
  })
})
