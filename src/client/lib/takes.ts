import type { Phase, RoomState, SlotName } from '../../shared/protocol'
import type { CellKind, Plan, TemplateId } from '../../shared/plan'

/** One completed capture by both people. `a` is slot a's photo, `b` is slot b's, for everyone. */
export interface Round {
  round: number
  a: Blob
  b: Blob
}
export interface Pending {
  round: number
  own?: Blob
  partner?: Blob
}

export function mergePhoto(pending: Pending | null, round: number, who: 'own' | 'partner', blob: Blob): Pending {
  const base: Pending = pending && pending.round === round ? pending : { round }
  return { ...base, [who]: blob }
}

export function completeRound(pending: Pending, slot: SlotName): Round | null {
  if (!pending.own || !pending.partner) return null
  return slot === 'a'
    ? { round: pending.round, a: pending.own, b: pending.partner }
    : { round: pending.round, a: pending.partner, b: pending.own }
}

/** Every completed round this tab holds. Photos live only here, never on the server. */
export type TakeStore = ReadonlyMap<number, Round>

export const putRound = (store: TakeStore, next: Round): Map<number, Round> => new Map(store).set(next.round, next)

/** Every round the plan points at. */
export const referencedRounds = (plan: Plan): number[] => [
  ...plan.takes.flat(),
  ...plan.kept.filter((k): k is number => k !== null),
]
export const highestReferenced = (plan: Plan): number => Math.max(-1, ...referencedRounds(plan))

/**
 * Rounds this tab still needs: the kept ones, plus every take of the cell being shot or picked.
 * Takes of earlier cells that were not kept are never shown again.
 */
function neededRounds(plan: Plan): Set<number> {
  const needed = new Set(plan.kept.filter((k): k is number => k !== null))
  if (plan.stage === 'shoot' || plan.stage === 'pick') for (const r of plan.takes[plan.cell] ?? []) needed.add(r)
  return needed
}

/**
 * Drop rounds the plan no longer needs. A round newer than anything the plan has ever mentioned (`highestSeen`) is a
 * photo pair that finished here a moment before the server announced the take, so it is kept. Returns the same
 * store when nothing is dropped.
 */
export function pruneStore(store: TakeStore, plan: Plan, highestSeen: number): TakeStore {
  const needed = neededRounds(plan)
  const drop = [...store.keys()].filter((r) => !needed.has(r) && r <= highestSeen)
  if (drop.length === 0) return store
  const next = new Map(store)
  for (const r of drop) next.delete(r)
  return next
}

/** Rounds the plan needs that this tab does not hold — the tab was reloaded (spec §5). */
export const missingRounds = (plan: Plan, store: TakeStore): number[] => [...neededRounds(plan)].filter((r) => !store.has(r))

/** The kept photos of one cell, ready to compose. */
export interface CellBlobs {
  kind: CellKind
  round: number
  a: Blob
  b: Blob
}
export interface Finished {
  template: TemplateId
  cells: CellBlobs[]
}

/** The finished strip's inputs, or null until the plan is done *and* this tab holds every kept photo. */
export function finishedOf(plan: Plan, store: TakeStore): Finished | null {
  if (plan.stage !== 'done' || plan.template === null) return null
  const cells: CellBlobs[] = []
  for (const [i, kind] of plan.kinds.entries()) {
    const kept = plan.kept[i]
    const round = kept === null || kept === undefined ? undefined : store.get(kept)
    if (!round) return null
    cells.push({ kind, round: round.round, a: round.a, b: round.b })
  }
  return cells.length > 0 ? { template: plan.template, cells } : null
}

/**
 * Did this tab finish the round the server is still waiting on, without the server having counted it? Then its
 * `photo-complete` was lost on the way (the socket was reconnecting) and must be sent again — the server is idempotent.
 */
export function needsCompleteResend(state: RoomState, completedRound: number): boolean {
  return state.phase === 'capture' && state.round === completedRound && state.participants[state.you]?.photoDone === false
}

/**
 * A round this tab had finished ended without becoming a take (the server gave up on it). Only meaningful on the
 * transition out of a capture: a retake or reset also clears takes, but does not leave a capture.
 */
export function roundLostAfterCompleting(previous: Phase, state: RoomState, completedRound: number): boolean {
  return previous === 'capture' && state.phase === 'ready' && state.round === completedRound && !state.plan.takes.some((t) => t.includes(state.round))
}
