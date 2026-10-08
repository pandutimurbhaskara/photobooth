import { describe, expect, it } from 'vitest'
import { cellPlacements, formatStripDate, mulberry32, seedFromString } from './strip'

describe('formatStripDate', () => {
  it('formats DD MON YYYY in upper case with a zero-padded day', () => {
    expect(formatStripDate(new Date(2026, 9, 7))).toBe('07 OCT 2026')
    expect(formatStripDate(new Date(2027, 0, 31))).toBe('31 JAN 2027')
  })
})

describe('seeded jitter', () => {
  it('produces the same sequence for the same seed, so both partners get identical strips', () => {
    const a = mulberry32(seedFromString('ABCDEF:2'))
    const b = mulberry32(seedFromString('ABCDEF:2'))
    for (let i = 0; i < 8; i++) expect(a()).toBe(b())
  })
  it('differs between rounds and codes, and stays in [0, 1)', () => {
    expect(seedFromString('ABCDEF:1')).not.toBe(seedFromString('ABCDEF:2'))
    expect(seedFromString('ABCDEF:1')).not.toBe(seedFromString('GHJKMN:1'))
    const rand = mulberry32(seedFromString('x'))
    for (let i = 0; i < 1000; i++) {
      const v = rand()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('cellPlacements', () => {
  it('a USER 1 or USER 2 cell is one full photo of that person', () => {
    expect(cellPlacements('a', 960, 720)).toEqual([{ who: 'a', dest: { x: 0, y: 0, w: 960, h: 720 } }])
    expect(cellPlacements('b', 960, 720)).toEqual([{ who: 'b', dest: { x: 0, y: 0, w: 960, h: 720 } }])
  })
  it('a TOGETHER cell is USER 1 on the left half and USER 2 on the right, with no gap and no overlap', () => {
    const [left, right] = cellPlacements('both', 960, 720)
    expect(left).toEqual({ who: 'a', dest: { x: 0, y: 0, w: 480, h: 720 } })
    expect(right).toEqual({ who: 'b', dest: { x: 480, y: 0, w: 480, h: 720 } })
  })
  it('splits an odd width exactly', () => {
    const [left, right] = cellPlacements('both', 961, 720)
    expect(left?.dest.w).toBe(480)
    expect(right?.dest).toMatchObject({ x: 480, w: 481 })
  })
})
