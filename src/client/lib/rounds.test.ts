import { describe, expect, it } from 'vitest'
import { completeRound, mergePhoto, pushRound, stripBlobs, type Round } from './rounds'

const blob = (s: string) => new Blob([s])
const round = (n: number): Round => ({ round: n, a: blob(`a${n}`), b: blob(`b${n}`) })

describe('mergePhoto', () => {
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
})

describe('completeRound', () => {
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

describe('pushRound', () => {
  it('keeps only the last two rounds', () => {
    let rounds: Round[] = []
    for (const n of [1, 2, 3]) rounds = pushRound(rounds, round(n))
    expect(rounds.map((r) => r.round)).toEqual([2, 3])
  })
  it('replaces a round with the same number instead of duplicating it', () => {
    const rounds = pushRound(pushRound([], round(1)), round(1))
    expect(rounds).toHaveLength(1)
  })
})

describe('stripBlobs', () => {
  it('returns null with no rounds', () => {
    expect(stripBlobs('vertical', [])).toBeNull()
  })
  it('vertical and horizontal use the latest round: [a, b]', () => {
    const r = [round(1), round(2)]
    expect(stripBlobs('vertical', r)).toEqual([r[1]?.a, r[1]?.b])
    expect(stripBlobs('horizontal', r)).toEqual([r[1]?.a, r[1]?.b])
  })
  it('grid needs two rounds and orders A1, B1, A2, B2', () => {
    expect(stripBlobs('grid', [round(1)])).toBeNull()
    const r = [round(1), round(2)]
    expect(stripBlobs('grid', r)).toEqual([r[0]?.a, r[0]?.b, r[1]?.a, r[1]?.b])
  })
  it('a cancelled round leaves no gap: "previous" means the previous completed round', () => {
    const r = [round(1), round(3)] // round 2 was cancelled and never completed
    expect(stripBlobs('grid', r)).toEqual([r[0]?.a, r[0]?.b, r[1]?.a, r[1]?.b])
  })
})
