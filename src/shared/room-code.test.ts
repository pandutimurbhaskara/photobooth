import { describe, expect, it } from 'vitest'
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from './constants'
import { formatRoomCode, generateRoomCode, isValidRoomCode, normalizeRoomInput } from './room-code'

describe('generateRoomCode', () => {
  it('returns ROOM_CODE_LENGTH characters, all from the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode()
      expect(code).toHaveLength(ROOM_CODE_LENGTH)
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch)
      expect(isValidRoomCode(code)).toBe(true)
    }
  })

  it('discards bytes >= 248 so every symbol is equally likely', () => {
    const fed = [255, 250, 0, 1, 2, 3, 4, 5] // 255 and 250 must be skipped; 0..5 map to A..F
    const code = generateRoomCode((buf) => {
      fed.forEach((b, i) => {
        buf[i] = b
      })
      return buf
    })
    expect(code).toBe('ABCDEF')
  })

  it('is roughly uniform across the alphabet', () => {
    const counts = new Map<string, number>()
    const n = 10_333
    for (let i = 0; i < n; i++) for (const ch of generateRoomCode()) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    const expected = (n * ROOM_CODE_LENGTH) / ROOM_CODE_ALPHABET.length
    for (const ch of ROOM_CODE_ALPHABET) {
      expect(Math.abs((counts.get(ch) ?? 0) - expected)).toBeLessThan(expected * 0.15)
    }
  })
})

describe('isValidRoomCode', () => {
  it('accepts only canonical codes', () => {
    expect(isValidRoomCode('A7K9XM')).toBe(true)
    for (const bad of ['a7k9xm', 'A7K9X', 'A7K9XMM', 'A7K9XO', 'A7K 9XM', '', 42, null, undefined]) {
      expect(isValidRoomCode(bad)).toBe(false)
    }
  })
})

// Review Focus 5: people type codes sloppily.
describe('normalizeRoomInput', () => {
  it('accepts lowercase, spaces and hyphens', () => {
    expect(normalizeRoomInput('a7k 9xm')).toBe('A7K9XM')
    expect(normalizeRoomInput('  a7k-9xm  ')).toBe('A7K9XM')
    expect(normalizeRoomInput('A7K9XM')).toBe('A7K9XM')
  })

  it('extracts a code from a pasted booth URL', () => {
    expect(normalizeRoomInput('https://two-up.example.workers.dev/b/a7k9xm?x=1')).toBe('A7K9XM')
    expect(normalizeRoomInput('http://localhost:5173/b/A7K9XM#frag')).toBe('A7K9XM')
  })

  it('refuses wrong lengths and look-alike letters', () => {
    expect(normalizeRoomInput('A7K9X')).toBeNull()
    expect(normalizeRoomInput('A7K9XMM')).toBeNull()
    expect(normalizeRoomInput('A7K9XO')).toBeNull() // letter O
    expect(normalizeRoomInput('A7K9X0')).toBeNull() // zero
    expect(normalizeRoomInput('A7K9XI')).toBeNull()
    expect(normalizeRoomInput('')).toBeNull()
  })
})

describe('formatRoomCode', () => {
  it('splits 3 + 3', () => {
    expect(formatRoomCode('A7K9XM')).toBe('A7K 9XM')
  })
})
