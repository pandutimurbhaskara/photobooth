import { describe, expect, it } from 'vitest'
import { CLOSE, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants'

describe('constants', () => {
  it('has a 31-symbol alphabet with no look-alikes and no duplicates', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(31)
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(31)
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[ILO01]/)
    expect(ROOM_CODE_LENGTH).toBe(6)
  })

  it('keeps close codes in the application range', () => {
    for (const code of Object.values(CLOSE)) expect(code).toBeGreaterThanOrEqual(4000)
  })
})
