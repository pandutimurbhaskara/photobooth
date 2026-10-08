import type { Rect } from './photo'

/** A person cut out of their photo: opaque pixels where the model saw them, transparent elsewhere, photo-sized. */
export interface Cutout {
  canvas: HTMLCanvasElement
  /** Tight box around the person, in the photo's own pixels. */
  bounds: Rect
}

// The numbers below are a starting point to tune by eye on real photos (spec §6).
export const EDGE_LOW = 0.35
export const EDGE_HIGH = 0.65
export const PERSON_MAX_HEIGHT = 1 // of the cell height
export const PERSON_MAX_WIDTH = 0.55 // of the cell width
export const PERSON_CENTER = { a: 0.3, b: 0.7 } as const // of the cell width
export const MAX_UPSCALE = 2.5

export function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/** Model confidence (0–1 per pixel) → alpha bytes, with a soft edge between EDGE_LOW and EDGE_HIGH. */
export function maskToAlpha(mask: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = smoothstep(EDGE_LOW, EDGE_HIGH, mask[i] ?? 0) * 255
  return out
}

export const invertMask = (mask: Float32Array): Float32Array => mask.map((v) => 1 - v)

/**
 * A person is normally in the middle of the frame. If the outer border is clearly "more person" than the middle,
 * the mask has the channels the wrong way round, so flip it. A person who fills the frame leaves both means high and
 * is left alone.
 */
export function shouldInvert(mask: Float32Array, w: number, h: number): boolean {
  let border = 0
  let borderN = 0
  let middle = 0
  let middleN = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = mask[y * w + x] ?? 0
      if (x < w * 0.1 || x >= w * 0.9 || y < h * 0.1 || y >= h * 0.9) {
        border += v
        borderN++
      } else if (x >= w * 0.25 && x < w * 0.75 && y >= h * 0.25 && y < h * 0.75) {
        middle += v
        middleN++
      }
    }
  }
  if (borderN === 0 || middleN === 0) return false
  return border / borderN - middle / middleN > 0.25
}

/** Tight box around pixels at or above `threshold`, or null when there are none. */
export function alphaBounds(alpha: Uint8ClampedArray, w: number, h: number, threshold = 128): Rect | null {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((alpha[y * w + x] ?? 0) < threshold) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/**
 * Where one person's cutout goes in a TOGETHER cell (cell coordinates): standing on the bottom edge, centred at 30 %
 * (USER 1) or 70 % (USER 2) of the width, as large as the limits allow. Because each box is at most 55 % wide and
 * centred there, it can never leave the cell.
 */
export function placePerson(bounds: Rect, cell: { w: number; h: number }, who: 'a' | 'b'): { src: Rect; dest: Rect } {
  const scale = Math.min((PERSON_MAX_HEIGHT * cell.h) / bounds.h, (PERSON_MAX_WIDTH * cell.w) / bounds.w, MAX_UPSCALE)
  const w = bounds.w * scale
  const h = bounds.h * scale
  return { src: bounds, dest: { x: PERSON_CENTER[who] * cell.w - w / 2, y: cell.h - h, w, h } }
}

/** Cache key for one person's cutout in one round. */
export const cutoutKey = (round: number, who: 'a' | 'b'): string => `${round}:${who}`
