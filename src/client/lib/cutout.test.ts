import { describe, expect, it } from 'vitest'
import {
  alphaBounds,
  cutoutKey,
  EDGE_HIGH,
  EDGE_LOW,
  invertMask,
  maskToAlpha,
  MAX_UPSCALE,
  placePerson,
  shouldInvert,
  smoothstep,
} from './cutout'

const make = (w: number, h: number, f: (x: number, y: number) => number): Float32Array => {
  const m = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = f(x, y)
  return m
}
const centredBlob = (x: number, y: number) => (x >= 3 && x < 7 && y >= 3 && y < 7 ? 1 : 0)

describe('smoothstep', () => {
  it('is 0 below, 1 above and 0.5 in the middle', () => {
    expect(smoothstep(0.35, 0.65, 0)).toBe(0)
    expect(smoothstep(0.35, 0.65, 1)).toBe(1)
    expect(smoothstep(0.35, 0.65, 0.5)).toBeCloseTo(0.5, 5)
  })
})

describe('maskToAlpha', () => {
  it('makes a soft but not a smeared edge: certain background 0, certain person 255, uncertain in between', () => {
    const alpha = maskToAlpha(new Float32Array([0, EDGE_LOW - 0.01, 0.5, EDGE_HIGH + 0.01, 1]))
    expect(alpha[0]).toBe(0)
    expect(alpha[1]).toBe(0)
    expect(Math.abs((alpha[2] ?? 0) - 127.5)).toBeLessThanOrEqual(1)
    expect(alpha[3]).toBe(255)
    expect(alpha[4]).toBe(255)
  })
})

// The person/background channel order is an assumption about the model; this guard makes a wrong guess harmless.
describe('shouldInvert', () => {
  it('is false for a person in the middle of the picture', () => {
    expect(shouldInvert(make(10, 10, centredBlob), 10, 10)).toBe(false)
  })
  it('is true when the mask is the wrong way round (background marked as person)', () => {
    expect(shouldInvert(make(10, 10, (x, y) => 1 - centredBlob(x, y)), 10, 10)).toBe(true)
  })
  it('is false when the person fills the whole frame, and when nothing is found', () => {
    expect(shouldInvert(make(10, 10, () => 1), 10, 10)).toBe(false)
    expect(shouldInvert(make(10, 10, () => 0), 10, 10)).toBe(false)
  })
  it('invertMask flips every value', () => {
    expect(Array.from(invertMask(new Float32Array([0, 0.25, 1])))).toEqual([1, 0.75, 0])
  })
})

describe('alphaBounds', () => {
  const alpha = (w: number, h: number, f: (x: number, y: number) => number) => {
    const out = new Uint8ClampedArray(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = f(x, y)
    return out
  }
  it('is the tight box around the opaque pixels', () => {
    const a = alpha(8, 6, (x, y) => (x >= 2 && x <= 4 && y >= 1 && y <= 3 ? 255 : 0))
    expect(alphaBounds(a, 8, 6)).toEqual({ x: 2, y: 1, w: 3, h: 3 })
  })
  it('ignores faint pixels below the threshold', () => {
    const a = alpha(8, 6, (x, y) => (x === 0 && y === 0 ? 40 : x === 5 && y === 4 ? 255 : 0))
    expect(alphaBounds(a, 8, 6)).toEqual({ x: 5, y: 4, w: 1, h: 1 })
  })
  it('is null when there is nobody in the picture', () => {
    expect(alphaBounds(new Uint8ClampedArray(48), 8, 6)).toBeNull()
  })
})

describe('placePerson', () => {
  const cell = { w: 960, h: 720 }
  it('stands on the bottom edge, USER 1 left of USER 2', () => {
    const a = placePerson({ x: 100, y: 50, w: 400, h: 600 }, cell, 'a')
    const b = placePerson({ x: 100, y: 50, w: 400, h: 600 }, cell, 'b')
    expect(a.dest.y + a.dest.h).toBeCloseTo(cell.h, 5)
    expect(a.dest.x + a.dest.w / 2).toBeLessThan(b.dest.x + b.dest.w / 2)
    expect(a.src).toEqual({ x: 100, y: 50, w: 400, h: 600 })
  })
  it('is limited by width when the person is wide: at most 55 % of the cell', () => {
    const { dest } = placePerson({ x: 0, y: 0, w: 800, h: 400 }, cell, 'a')
    expect(dest.w).toBeCloseTo(0.55 * 960, 5)
  })
  it('is limited by height when the person is tall: at most the whole cell', () => {
    const { dest } = placePerson({ x: 0, y: 0, w: 200, h: 900 }, cell, 'a')
    expect(dest.h).toBeCloseTo(720, 5)
    expect(dest.y).toBeCloseTo(0, 5)
  })
  it('never enlarges a small figure by more than MAX_UPSCALE', () => {
    const { dest } = placePerson({ x: 0, y: 0, w: 50, h: 50 }, cell, 'b')
    expect(dest.w).toBeCloseTo(50 * MAX_UPSCALE, 5)
  })
  it('never leaves the cell, whatever the figure looks like', () => {
    for (const bounds of [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1280, h: 300 }, { x: 0, y: 0, w: 300, h: 1280 }, { x: 0, y: 0, w: 640, h: 480 }]) {
      for (const who of ['a', 'b'] as const) {
        const { dest } = placePerson(bounds, cell, who)
        expect(dest.x).toBeGreaterThanOrEqual(0)
        expect(dest.y).toBeGreaterThanOrEqual(0)
        expect(dest.x + dest.w).toBeLessThanOrEqual(cell.w + 1e-9)
        expect(dest.y + dest.h).toBeLessThanOrEqual(cell.h + 1e-9)
      }
    }
  })
})

describe('cutoutKey', () => {
  it('is the round and the person', () => {
    expect(cutoutKey(7, 'a')).toBe('7:a')
    expect(cutoutKey(7, 'b')).not.toBe(cutoutKey(7, 'a'))
  })
})
