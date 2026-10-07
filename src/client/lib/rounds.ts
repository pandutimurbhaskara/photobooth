import type { SlotName } from '../../shared/protocol'
import type { StripLayout } from './photo'

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

export function pushRound(rounds: readonly Round[], next: Round, keep = 2): Round[] {
  return [...rounds.filter((r) => r.round !== next.round), next].slice(-keep)
}

/** The photos a layout needs, in cell order — or null if there are not enough completed rounds yet. */
export function stripBlobs(layout: StripLayout, rounds: readonly Round[]): Blob[] | null {
  const last = rounds[rounds.length - 1]
  if (!last) return null
  if (layout !== 'grid') return [last.a, last.b]
  const prev = rounds[rounds.length - 2]
  return prev ? [prev.a, prev.b, last.a, last.b] : null
}
