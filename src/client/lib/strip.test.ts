import { describe, expect, it } from 'vitest'
import { formatStripDate, mulberry32, seedFromString } from './strip'

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
