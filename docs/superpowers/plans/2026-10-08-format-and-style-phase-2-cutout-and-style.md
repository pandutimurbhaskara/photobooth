# Phase 2 — Cutout & style (Tasks 8–13)

> Part of `2026-10-08-format-and-style.md`. **Read that master file first** (Global Constraints and Review Focus apply to every task here). Spec: `docs/superpowers/specs/2026-10-08-format-and-style-design.md` §6 (cutout and backgrounds), §8 (security), D29–D32.

**Phase goal:** a TOGETHER cell can show both people cut out of their own photos on one chosen background. Everything is client-side; the model and WASM are self-hosted; any failure falls back to the side-by-side cell and never blocks download.

**Gate (all must pass to finish):**
1. `npm run check` green, `npm run build` succeeds, and `dist` contains the vendored WASM.
2. `npm run test:e2e` green in full, including `segment` and `background`.
3. README device checklist has the new rows; the two facts the spec left open (model licence, per-asset size limit) are verified and recorded.

Phase 1 must be finished first (it ships the split-cell TOGETHER rendering this phase builds on and falls back to). Typecheck, lint, unit and worker suites stay green after every task.

---

## Task 8: Procedural backgrounds

**Files:**
- Create: `src/client/lib/backgrounds.ts`, `src/client/lib/backgrounds.test.ts`

**Interfaces:**
- Consumes: `PALETTE` (phase 1, Task 3), `Rect` (`photo.ts`), `mulberry32`/`seedFromString` (`strip.ts`, tests only).
- Produces (from `backgrounds.ts`):
  - `type Draw2D = Pick<CanvasRenderingContext2D, 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'stroke' | 'arc' | 'save' | 'restore' | 'rect' | 'clip'>`
  - `SCENES: Scene[]`, `type Scene` (15 ids), `type BackgroundId = 'none' | Scene`
  - `BACKGROUNDS: ReadonlyArray<{ id: BackgroundId; label: string }>` (first entry is `none`, label `SIDE BY SIDE`)
  - `drawBackground(ctx: Draw2D, scene: Scene, rect: Rect, rand: () => number): void` — flat shapes only, palette colours only, clipped to `rect`, deterministic for a given `rand`.

- [ ] **Step 1: Write the failing tests**

`src/client/lib/backgrounds.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { BACKGROUNDS, drawBackground, SCENES, type Draw2D } from './backgrounds'
import { PALETTE } from './palette'
import { mulberry32, seedFromString } from './strip'

const RECT = { x: 0, y: 0, w: 960, h: 720 }

/** Records every drawing call and every colour used, without a canvas. */
function fakeCtx() {
  const log: string[] = []
  const colors = new Set<string>()
  const call =
    (name: string) =>
    (...args: unknown[]) => {
      log.push(`${name} ${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(' ')}`)
    }
  const ctx = {
    save: call('save'),
    restore: call('restore'),
    rect: call('rect'),
    clip: call('clip'),
    beginPath: call('beginPath'),
    closePath: call('closePath'),
    moveTo: call('moveTo'),
    lineTo: call('lineTo'),
    arc: call('arc'),
    fill: call('fill'),
    stroke: call('stroke'),
    fillRect: call('fillRect'),
    set fillStyle(v: string) {
      colors.add(v)
      log.push(`fillStyle ${v}`)
    },
    set strokeStyle(v: string) {
      colors.add(v)
      log.push(`strokeStyle ${v}`)
    },
    set lineWidth(v: number) {
      log.push(`lineWidth ${v}`)
    },
  }
  return { ctx: ctx as unknown as Draw2D, log, colors }
}
const paint = (scene: (typeof SCENES)[number], seed = 'x') => {
  const f = fakeCtx()
  drawBackground(f.ctx, scene, RECT, mulberry32(seedFromString(seed)))
  return f
}

describe('BACKGROUNDS', () => {
  it('starts with "none" (side by side), has unique ids, and every other id is a drawable scene', () => {
    expect(BACKGROUNDS[0]).toEqual({ id: 'none', label: 'SIDE BY SIDE' })
    const ids = BACKGROUNDS.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.slice(1)).toEqual([...SCENES])
  })
  it('offers a dozen-or-so original scenes (spec D31: about 12–16)', () => {
    expect(SCENES.length).toBeGreaterThanOrEqual(12)
    expect(SCENES.length).toBeLessThanOrEqual(16)
  })
})

describe('drawBackground', () => {
  it.each(SCENES)('%s paints with palette colours only', (scene) => {
    const { log, colors } = paint(scene)
    expect(log.some((l) => l.startsWith('fillRect') || l.startsWith('fill '))).toBe(true)
    const allowed = new Set<string>(Object.values(PALETTE))
    for (const color of colors) expect(allowed.has(color)).toBe(true)
  })

  it.each(SCENES)('%s is clipped to its rectangle', (scene) => {
    const { log } = paint(scene)
    expect(log.slice(0, 4)).toEqual(['save ', 'beginPath ', 'rect 0.00 0.00 960.00 720.00', 'clip '])
    expect(log[log.length - 1]).toBe('restore ')
  })

  it('is deterministic for a seed, and confetti really depends on it', () => {
    expect(paint('confetti', 'one').log).toEqual(paint('confetti', 'one').log)
    expect(paint('confetti', 'one').log).not.toEqual(paint('confetti', 'two').log)
    expect(paint('stripes', 'one').log).toEqual(paint('stripes', 'two').log) // patterns without randomness ignore the seed
  })
})
```
Run: `npx vitest run src/client/lib/backgrounds.test.ts`
Expected: FAIL — `./backgrounds` does not exist.

- [ ] **Step 2: Write `backgrounds.ts`**

`src/client/lib/backgrounds.ts` (flat shapes only; never write the words the style test forbids, and do not name the canvas fill-style union type):
```ts
import { PALETTE } from './palette'
import type { Rect } from './photo'

/** The slice of the 2D context the scenes use, so they are testable without a canvas. */
export type Draw2D = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'fillRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill' | 'stroke' | 'arc' | 'save' | 'restore' | 'rect' | 'clip'
>
type Painter = (ctx: Draw2D, r: Rect, rand: () => number) => void

/** Pattern pitch in strip pixels: a 960 px cell shows about fifteen repeats. */
const PITCH = 64

function fill(ctx: Draw2D, color: string, r: Rect): void {
  ctx.fillStyle = color
  ctx.fillRect(r.x, r.y, r.w, r.h)
}

const solid =
  (color: string): Painter =>
  (ctx, r) =>
    fill(ctx, color, r)

const stripes =
  (base: string, bar: string): Painter =>
  (ctx, r) => {
    fill(ctx, base, r)
    ctx.fillStyle = bar
    for (let y = r.y + PITCH; y < r.y + r.h; y += PITCH * 2) ctx.fillRect(r.x, y, r.w, PITCH)
  }

const checker =
  (a: string, b: string): Painter =>
  (ctx, r) => {
    fill(ctx, a, r)
    ctx.fillStyle = b
    for (let row = 0; row * PITCH < r.h; row++) {
      for (let col = 0; col * PITCH < r.w; col++) {
        if ((row + col) % 2 === 1) ctx.fillRect(r.x + col * PITCH, r.y + row * PITCH, PITCH, PITCH)
      }
    }
  }

const dots =
  (base: string, dot: string): Painter =>
  (ctx, r) => {
    fill(ctx, base, r)
    ctx.fillStyle = dot
    for (let y = r.y + PITCH / 2; y < r.y + r.h + PITCH; y += PITCH) {
      for (let x = r.x + PITCH / 2; x < r.x + r.w + PITCH; x += PITCH) {
        ctx.beginPath()
        ctx.arc(x, y, PITCH / 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

const graph =
  (base: string, line: string): Painter =>
  (ctx, r) => {
    fill(ctx, base, r)
    ctx.strokeStyle = line
    ctx.lineWidth = 3
    ctx.beginPath()
    for (let x = r.x; x <= r.x + r.w; x += PITCH) {
      ctx.moveTo(x, r.y)
      ctx.lineTo(x, r.y + r.h)
    }
    for (let y = r.y; y <= r.y + r.h; y += PITCH) {
      ctx.moveTo(r.x, y)
      ctx.lineTo(r.x + r.w, y)
    }
    ctx.stroke()
  }

const zigzag =
  (base: string, line: string): Painter =>
  (ctx, r) => {
    fill(ctx, base, r)
    ctx.strokeStyle = line
    ctx.lineWidth = 10
    for (let y = r.y + PITCH; y < r.y + r.h + PITCH; y += PITCH * 1.5) {
      ctx.beginPath()
      ctx.moveTo(r.x, y)
      let up = true
      for (let x = r.x; x <= r.x + r.w + PITCH; x += PITCH / 2) {
        ctx.lineTo(x, y + (up ? -PITCH / 4 : PITCH / 4))
        up = !up
      }
      ctx.stroke()
    }
  }

const sunburst =
  (base: string, ray: string): Painter =>
  (ctx, r) => {
    fill(ctx, base, r)
    ctx.fillStyle = ray
    const cx = r.x + r.w / 2
    const cy = r.y + r.h
    const reach = Math.hypot(r.w, r.h)
    const wedges = 16
    for (let i = 0; i < wedges; i += 2) {
      const from = Math.PI + (i / wedges) * Math.PI
      const to = Math.PI + ((i + 1) / wedges) * Math.PI
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(from) * reach, cy + Math.sin(from) * reach)
      ctx.lineTo(cx + Math.cos(to) * reach, cy + Math.sin(to) * reach)
      ctx.closePath()
      ctx.fill()
    }
  }

const bricks =
  (base: string, mortar: string): Painter =>
  (ctx, r) => {
    fill(ctx, base, r)
    ctx.fillStyle = mortar
    const width = PITCH * 2
    const height = PITCH / 2
    const gap = 6
    for (let row = 0, y = r.y; y < r.y + r.h; row++, y += height) {
      ctx.fillRect(r.x, y, r.w, gap)
      const offset = row % 2 === 0 ? 0 : width / 2
      for (let x = r.x - offset; x < r.x + r.w; x += width) ctx.fillRect(x, y, gap, height)
    }
  }

const confetti =
  (base: string, colors: readonly string[]): Painter =>
  (ctx, r, rand) => {
    fill(ctx, base, r)
    const count = Math.round(((r.w * r.h) / (PITCH * PITCH)) * 1.5)
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = colors[Math.floor(rand() * colors.length)] ?? base
      const size = 14 + rand() * 22
      ctx.fillRect(r.x + rand() * r.w, r.y + rand() * r.h, size, size)
    }
  }

const waves =
  (base: string, wave: string): Painter =>
  (ctx, r) => {
    fill(ctx, base, r)
    ctx.fillStyle = wave
    for (let y = r.y + PITCH; y < r.y + r.h + PITCH; y += PITCH * 1.5) {
      ctx.beginPath()
      ctx.moveTo(r.x, y + PITCH)
      ctx.lineTo(r.x, y)
      for (let x = r.x; x <= r.x + r.w; x += PITCH / 2) ctx.lineTo(x, y + (Math.sin(((x - r.x) / PITCH) * Math.PI) * PITCH) / 4)
      ctx.lineTo(r.x + r.w, y + PITCH)
      ctx.closePath()
      ctx.fill()
    }
  }

const PAINTERS = {
  yellow: solid(PALETTE.yellow),
  pink: solid(PALETTE.pink),
  lime: solid(PALETTE.lime),
  blue: solid(PALETTE.blue),
  orange: solid(PALETTE.orange),
  ink: solid(PALETTE.ink),
  stripes: stripes(PALETTE.pink, PALETTE.paper),
  checker: checker(PALETTE.blue, PALETTE.paper),
  dots: dots(PALETTE.yellow, PALETTE.pink),
  graph: graph(PALETTE.paper, PALETTE.ink),
  zigzag: zigzag(PALETTE.lime, PALETTE.ink),
  sunburst: sunburst(PALETTE.yellow, PALETTE.orange),
  bricks: bricks(PALETTE.orange, PALETTE.paper),
  confetti: confetti(PALETTE.paper, [PALETTE.pink, PALETTE.yellow, PALETTE.blue, PALETTE.lime, PALETTE.orange]),
  waves: waves(PALETTE.paper, PALETTE.blue),
} satisfies Record<string, Painter>

export type Scene = keyof typeof PAINTERS
export type BackgroundId = 'none' | Scene
export const SCENES = Object.keys(PAINTERS) as Scene[]

const LABEL: Record<Scene, string> = {
  yellow: 'YELLOW',
  pink: 'PINK',
  lime: 'LIME',
  blue: 'BLUE',
  orange: 'ORANGE',
  ink: 'INK',
  stripes: 'STRIPES',
  checker: 'CHECKER',
  dots: 'DOTS',
  graph: 'GRAPH PAPER',
  zigzag: 'ZIGZAG',
  sunburst: 'SUNBURST',
  bricks: 'BRICKS',
  confetti: 'CONFETTI',
  waves: 'WAVES',
}

/** `none` is "side by side, no cutout": the default, and the fallback when the cutout tool cannot run. */
export const BACKGROUNDS: ReadonlyArray<{ id: BackgroundId; label: string }> = [
  { id: 'none', label: 'SIDE BY SIDE' },
  ...SCENES.map((id) => ({ id, label: LABEL[id] })),
]

/** Paint a scene into `rect`, clipped to it. The thumbnail in the picker and the strip use this same function. */
export function drawBackground(ctx: Draw2D, scene: Scene, rect: Rect, rand: () => number): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.w, rect.h)
  ctx.clip()
  PAINTERS[scene](ctx, rect, rand)
  ctx.restore()
}
```

- [ ] **Step 3: Run the tests, then everything static**

Run: `npx vitest run src/client/lib/backgrounds.test.ts`
Expected: PASS.
Run: `npm run typecheck && npm run lint && npm test`
Expected: exit 0 (the style-rules test must stay green).

- [ ] **Step 4: Commit**

```bash
git add src/client/lib/backgrounds.ts src/client/lib/backgrounds.test.ts
git commit -m "feat: add procedural flat backgrounds drawn from the palette"
```

---

## Task 9: Cutout maths — mask to alpha, inversion guard, bounds, placement

**Files:**
- Create: `src/client/lib/cutout.ts`, `src/client/lib/cutout.test.ts`

**Interfaces:**
- Consumes: `Rect` (`photo.ts`).
- Produces (from `cutout.ts`, all pure except the `Cutout` type):
  - `interface Cutout { canvas: HTMLCanvasElement; bounds: Rect }` — the person on a transparent canvas the size of the photo, and the bounding box of the person in photo pixels.
  - `EDGE_LOW = 0.35`, `EDGE_HIGH = 0.65`, `PERSON_MAX_HEIGHT = 1`, `PERSON_MAX_WIDTH = 0.55`, `PERSON_CENTER = { a: 0.3, b: 0.7 }`, `MAX_UPSCALE = 2.5`
  - `smoothstep(lo, hi, x): number`; `maskToAlpha(mask: Float32Array): Uint8ClampedArray`; `invertMask(mask: Float32Array): Float32Array`
  - `shouldInvert(mask: Float32Array, w: number, h: number): boolean` — true when the border of the picture is "more person" than its middle by more than 0.25 (the model's person/background channels are the wrong way round).
  - `alphaBounds(alpha: Uint8ClampedArray, w: number, h: number, threshold?: number): Rect | null`
  - `placePerson(bounds: Rect, cell: { w: number; h: number }, who: 'a' | 'b'): { src: Rect; dest: Rect }`
  - `cutoutKey(round: number, who: 'a' | 'b'): string` (`"<round>:<who>"`)

- [ ] **Step 1: Write the failing tests**

`src/client/lib/cutout.test.ts`:
```ts
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
```
Run: `npx vitest run src/client/lib/cutout.test.ts`
Expected: FAIL — `./cutout` does not exist.

- [ ] **Step 2: Write `cutout.ts`**

`src/client/lib/cutout.ts`:
```ts
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
```
Run: `npx vitest run src/client/lib/cutout.test.ts`
Expected: PASS.

- [ ] **Step 3: Static checks and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: exit 0.
```bash
git add src/client/lib/cutout.ts src/client/lib/cutout.test.ts
git commit -m "feat: add the cutout maths for mask edges, inversion guard, bounds and placement"
```

---

## Task 10: Vendor the model and runtime, loosen the CSP by exactly one word

**Files:**
- Create: `scripts/vendor-mediapipe.mjs`, `public/vendor/models/selfie_segmenter.tflite`, `src/client/lib/vendor.ts`, `src/client/lib/vendor.test.ts`, `src/client/csp.test.ts`
- Modify: `package.json`, `package-lock.json`, `.gitignore`, `public/_headers`, `docs/superpowers/specs/2026-10-08-format-and-style-design.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (`src/client/lib/vendor.ts`): `MEDIAPIPE_VERSION = '1.1.0'`, `MEDIAPIPE_BASE = '/vendor/mediapipe-1.1.0'`, `SEGMENTER_MODEL_URL = '/vendor/models/selfie_segmenter.tflite'`, `SEGMENT_TIMEOUT_MS = 15_000`. Files served from the app origin: `/vendor/mediapipe-1.1.0/vision_wasm_internal.{js,wasm}`, `…/vision_wasm_nosimd_internal.{js,wasm}` and `/vendor/models/selfie_segmenter.tflite`.

- [ ] **Step 1: Verify the two facts the spec left open — and stop if either fails**

1. **Model licence.** Open the Image Segmenter docs (`https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter`, "Selfie segmentation" model) and its model card. Confirm the terms permit redistributing the file in a deployed web app (MediaPipe models are published under Apache-2.0 unless a card says otherwise). Record the page URL and the exact licence wording.
2. **Per-asset size limit.** Open `https://developers.cloudflare.com/workers/static-assets/platform/limits/`. Confirm the maximum size of a single static asset is larger than 13 MB (believed 25 MiB).

**If the licence is anything other than permissive-for-redistribution, is unclear, or the size limit is below 13 MB: STOP. Do not commit the model. Report what you found and ask the owner** — a licence decision is not yours to guess, and a too-small limit changes the design (the two WASM files are ~13 MB each).

Then update `docs/superpowers/specs/2026-10-08-format-and-style-design.md` §10: replace the sentence `Two facts to verify when phase 2 starts: the selfie model's licence terms, and that a 13 MB asset is within Cloudflare's per-asset limit (believed 25 MiB; unverified).` with `Verified on <today's date>: <licence wording and URL>; <the per-asset limit, with the docs URL>.` and commit it:
```bash
git add docs/superpowers/specs/2026-10-08-format-and-style-design.md
git commit -m "docs: record the verified model licence and static asset size limit"
```

- [ ] **Step 2: Download the model and check its size**

```bash
mkdir -p public/vendor/models
curl -fL -o public/vendor/models/selfie_segmenter.tflite \
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
wc -c < public/vendor/models/selfie_segmenter.tflite
```
Expected: `249537`. If the number differs, the file changed upstream: re-check the licence/model card for the new file, then update `MODEL_BYTES` (Step 4) and the "249,537 bytes" in the master Global Constraints and the spec D30 in the same commit.

- [ ] **Step 3: Install the runtime, exactly pinned**

```bash
npm install --save-exact @mediapipe/tasks-vision@1.1.0
```
Expected: `package.json` shows `"@mediapipe/tasks-vision": "1.1.0"` (no `^`). Then confirm the files the copy script needs exist:
```bash
ls -la node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.* node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_nosimd_internal.*
```
Expected: four files (`.js` and `.wasm` for both).

- [ ] **Step 4: The vendor script, run on install**

`scripts/vendor-mediapipe.mjs`:
```js
// Copies the MediaPipe WASM runtime out of node_modules into public/vendor/ (git-ignored: ~26 MB), and checks the
// committed model. Runs on `npm install` (postinstall) so CI and Workers Builds get it too. It fails loudly: a build
// without these files would ship a cutout feature that can never load.
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'node_modules/@mediapipe/tasks-vision/package.json'), 'utf8'))
const FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']
const MODEL = join(root, 'public/vendor/models/selfie_segmenter.tflite')
const MODEL_BYTES = 249_537

const from = join(root, 'node_modules/@mediapipe/tasks-vision/wasm')
const to = join(root, `public/vendor/mediapipe-${pkg.version}`)
mkdirSync(to, { recursive: true })
for (const name of FILES) {
  const src = join(from, name)
  if (!existsSync(src)) throw new Error(`vendor: ${name} is missing from @mediapipe/tasks-vision ${pkg.version}`)
  const dst = join(to, name)
  if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst)
}
if (!existsSync(MODEL) || statSync(MODEL).size !== MODEL_BYTES) {
  throw new Error(`vendor: public/vendor/models/selfie_segmenter.tflite must exist and be ${MODEL_BYTES} bytes`)
}
console.log(`vendor: MediaPipe ${pkg.version} runtime is in public/vendor/mediapipe-${pkg.version}`)
```
In `package.json` `scripts`, add (keeping the existing ones):
```json
    "vendor": "node scripts/vendor-mediapipe.mjs",
    "postinstall": "node scripts/vendor-mediapipe.mjs",
```
Append to `.gitignore`:
```
public/vendor/mediapipe-*/
```
Run: `npm run vendor`
Expected: prints `vendor: MediaPipe 1.1.0 runtime is in public/vendor/mediapipe-1.1.0`; `git status --short` shows `public/vendor/models/selfie_segmenter.tflite` as new but **not** the `mediapipe-1.1.0` directory.

- [ ] **Step 5: Failing guard tests**

`src/client/lib/vendor.ts` first (the tests import it):
```ts
// Where the self-hosted MediaPipe assets are served from. The version is part of the path (so the files can be cached
// forever) and must equal the pinned dependency; scripts/vendor-mediapipe.mjs copies the runtime to the same place.
export const MEDIAPIPE_VERSION = '1.1.0'
export const MEDIAPIPE_BASE = `/vendor/mediapipe-${MEDIAPIPE_VERSION}`
export const SEGMENTER_MODEL_URL = '/vendor/models/selfie_segmenter.tflite'
/** Loading the model, or cutting one person out, may take at most this long before we fall back to side by side. */
export const SEGMENT_TIMEOUT_MS = 15_000
```
`src/client/lib/vendor.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import rootPackage from '../../../package.json?raw'
import installed from '../../../node_modules/@mediapipe/tasks-vision/package.json?raw'
import { MEDIAPIPE_BASE, MEDIAPIPE_VERSION } from './vendor'

describe('vendored MediaPipe', () => {
  it('is pinned exactly, so the version in the asset path cannot drift from the dependency', () => {
    const dependencies = (JSON.parse(rootPackage) as { dependencies: Record<string, string> }).dependencies
    expect(dependencies['@mediapipe/tasks-vision']).toBe(MEDIAPIPE_VERSION)
    expect((JSON.parse(installed) as { version: string }).version).toBe(MEDIAPIPE_VERSION)
    expect(MEDIAPIPE_BASE).toBe(`/vendor/mediapipe-${MEDIAPIPE_VERSION}`)
  })
})
```
`src/client/csp.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import headers from '../../public/_headers?raw'

function directive(name: string): string[] {
  const line = headers.split('\n').find((l) => l.trim().startsWith('Content-Security-Policy:')) ?? ''
  const policy = line.replace(/^\s*Content-Security-Policy:/, '')
  const part = policy
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name} `))
  return part ? part.split(/\s+/).slice(1) : []
}

describe('Content-Security-Policy', () => {
  it('allows compiling WebAssembly (the cutout model) but never eval(), and still no inline scripts', () => {
    const script = directive('script-src')
    expect(script).toContain("'self'")
    expect(script).toContain("'wasm-unsafe-eval'")
    expect(script).not.toContain("'unsafe-eval'")
    expect(script).not.toContain("'unsafe-inline'")
  })
  it('keeps everything else on this origin: the model and runtime are self-hosted', () => {
    expect(directive('default-src')).toEqual(["'self'"])
    expect(directive('connect-src')).not.toContain('https:')
    expect(directive('connect-src')).not.toContain('*')
  })
  it('caches the versioned vendor files for a year, immutable', () => {
    expect(headers).toMatch(/\/vendor\/\*\s*\n\s+Cache-Control: public, max-age=31536000, immutable/)
  })
})
```
Run: `npx vitest run src/client/lib/vendor.test.ts src/client/csp.test.ts`
Expected: `vendor.test` PASS; `csp.test` FAIL (no `'wasm-unsafe-eval'`, no `/vendor/*` rule yet).

- [ ] **Step 6: Change `public/_headers`**

In `public/_headers`, change `script-src 'self'` to `script-src 'self' 'wasm-unsafe-eval'` (leave every other directive exactly as it is) and append at the end of the file:
```

/vendor/*
  Cache-Control: public, max-age=31536000, immutable
```
Run: `npx vitest run src/client/csp.test.ts` — expected PASS.

- [ ] **Step 7: Prove the build ships the files**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: all exit 0. Then:
```bash
find dist -name 'vision_wasm_internal.wasm' -o -name 'selfie_segmenter.tflite'
git ls-files public/vendor
```
Expected: both files appear under `dist`; `git ls-files` lists only `public/vendor/models/selfie_segmenter.tflite`.

- [ ] **Step 8: Commit**

```bash
git add scripts/vendor-mediapipe.mjs public/vendor/models/selfie_segmenter.tflite public/_headers src/client/lib/vendor.ts src/client/lib/vendor.test.ts src/client/csp.test.ts package.json package-lock.json .gitignore
git commit -m "feat: self-host the selfie segmenter and allow wasm compilation in the csp"
```

---

## Task 11: Load the segmenter and cut a person out

**Files:**
- Create: `src/client/lib/segment.ts`, `src/client/lib/segment.test.ts`, `e2e/segment.spec.ts`
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `Cutout`, `alphaBounds`, `invertMask`, `maskToAlpha`, `shouldInvert` (Task 9); `MEDIAPIPE_BASE`, `SEGMENTER_MODEL_URL`, `SEGMENT_TIMEOUT_MS` (Task 10).
- Produces (`segment.ts`): `withTimeout<T>(promise: Promise<T>, ms: number, what?: string): Promise<T>`; `loadSegmenter(): Promise<ImageSegmenter>` (one per tab, lazy, a failed load is forgotten so the next call retries); `cutOut(photo: Blob): Promise<Cutout>` (throws `no person found in this photo` when the mask is empty).

- [ ] **Step 1: Confirm the library's API names before writing code against them**

```bash
grep -n "confidenceMasks\|getAsFloat32Array\|outputConfidenceMasks\|static forVisionTasks\|static createFromOptions" node_modules/@mediapipe/tasks-vision/vision.d.ts | head -20
```
Expected: `ImageSegmenterResult.confidenceMasks`, `MPMask.getAsFloat32Array()`, `outputConfidenceMasks`, `FilesetResolver.forVisionTasks`, `ImageSegmenter.createFromOptions`. If a name differs, use the real one in Step 3 and say so in the commit body.

- [ ] **Step 2: Failing unit tests for the timeout wrapper**

`src/client/lib/segment.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from './segment'

afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('passes a result through', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })
  it('passes a rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 1000)).rejects.toThrow('nope')
  })
  it('rejects when the work takes too long, naming what was slow', async () => {
    vi.useFakeTimers()
    const never = new Promise<number>(() => {})
    const result = expect(withTimeout(never, 15_000, 'loading the cutout model')).rejects.toThrow(
      'loading the cutout model timed out after 15000 ms',
    )
    await vi.advanceTimersByTimeAsync(15_000)
    await result
  })
})
```
Run: `npx vitest run src/client/lib/segment.test.ts`
Expected: FAIL — `./segment` does not exist.

- [ ] **Step 3: Write `segment.ts`**

`src/client/lib/segment.ts`:
```ts
import type { ImageSegmenter } from '@mediapipe/tasks-vision'
import { alphaBounds, invertMask, maskToAlpha, shouldInvert, type Cutout } from './cutout'
import { MEDIAPIPE_BASE, SEGMENT_TIMEOUT_MS, SEGMENTER_MODEL_URL } from './vendor'

export function withTimeout<T>(promise: Promise<T>, ms: number, what = 'operation'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

let loading: Promise<ImageSegmenter> | null = null

/** One segmenter per tab, built the first time anyone asks. The WASM and the model come from this origin, never a CDN. */
export function loadSegmenter(): Promise<ImageSegmenter> {
  if (!loading) {
    const attempt = withTimeout(
      import('@mediapipe/tasks-vision').then(async ({ FilesetResolver, ImageSegmenter: Segmenter }) => {
        const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_BASE)
        return Segmenter.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: SEGMENTER_MODEL_URL, delegate: 'CPU' },
          runningMode: 'IMAGE',
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        })
      }),
      SEGMENT_TIMEOUT_MS,
      'loading the cutout model',
    )
    loading = attempt
    attempt.catch(() => {
      if (loading === attempt) loading = null // a failed load is forgotten, so the next attempt starts clean
    })
  }
  return loading
}

function canvasOf(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

/**
 * Cut the person out of one photo. Runs on the main thread (a handful of calls per strip).
 * // ponytail: main thread; move it to a Worker if it janks on real phones.
 */
export async function cutOut(photo: Blob): Promise<Cutout> {
  const bitmap = await createImageBitmap(photo)
  try {
    const segmenter = await loadSegmenter()
    const result = segmenter.segment(bitmap)
    try {
      const masks = result.confidenceMasks ?? []
      const mask = masks[masks.length - 1] // [background, person] — or just [person] for a single-output model
      if (!mask) throw new Error('the segmenter returned no mask')
      const raw = mask.getAsFloat32Array()
      const alpha = maskToAlpha(shouldInvert(raw, mask.width, mask.height) ? invertMask(raw) : raw)
      const found = alphaBounds(alpha, mask.width, mask.height)
      if (!found) throw new Error('no person found in this photo')

      // The mask is small (about 256 px): paint it as alpha on a mask-sized canvas, then let the browser scale it
      // up smoothly while it is applied to the full-size photo.
      const maskCanvas = canvasOf(mask.width, mask.height)
      const maskCtx = maskCanvas.getContext('2d')
      const out = canvasOf(bitmap.width, bitmap.height)
      const ctx = out.getContext('2d')
      if (!maskCtx || !ctx) throw new Error('2d canvas is unavailable')
      const image = maskCtx.createImageData(mask.width, mask.height)
      for (let i = 0; i < alpha.length; i++) {
        image.data[i * 4] = 255
        image.data[i * 4 + 1] = 255
        image.data[i * 4 + 2] = 255
        image.data[i * 4 + 3] = alpha[i] ?? 0
      }
      maskCtx.putImageData(image, 0, 0)
      ctx.drawImage(bitmap, 0, 0)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(maskCanvas, 0, 0, out.width, out.height)

      const sx = bitmap.width / mask.width
      const sy = bitmap.height / mask.height
      return { canvas: out, bounds: { x: found.x * sx, y: found.y * sy, w: found.w * sx, h: found.h * sy } }
    } finally {
      result.close()
    }
  } finally {
    bitmap.close()
  }
}
```
Run: `npx vitest run src/client/lib/segment.test.ts` — expected PASS.

- [ ] **Step 4: Pre-bundle the library so the dev server never reloads mid-run**

In `vite.config.ts`, add this property to the config object (after `server`):
```ts
  // The segmenter is imported lazily; pre-bundling it up front stops Vite re-optimising (and reloading the page) the first time it loads.
  optimizeDeps: { include: ['@mediapipe/tasks-vision'] },
```

- [ ] **Step 5: An e2e smoke test that runs the real WASM and model**

`e2e/segment.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { closePlayers, newPlayer } from './helpers'

test.afterEach(closePlayers)

type CutOut = (photo: Blob) => Promise<{ canvas: { width: number; height: number }; bounds: { x: number; y: number; w: number; h: number } }>

test('the self-hosted segmenter loads and returns a well-formed cutout', async ({ browser }) => {
  test.setTimeout(120_000)
  const page = await newPlayer(browser)
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const url = '/src/client/lib/segment.ts' // served by the Vite dev server
    const { cutOut } = (await import(/* @vite-ignore */ url)) as { cutOut: CutOut }
    // A synthetic "photo": a skin-toned oval on a grey wall. The model may or may not call a drawing a person — the
    // point is that the whole pipeline (WASM, model, mask, canvas) runs and answers sensibly.
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 480
    const g = canvas.getContext('2d')!
    g.fillStyle = '#9aa0a6'
    g.fillRect(0, 0, 640, 480)
    g.fillStyle = '#e0ac8c'
    g.beginPath()
    g.ellipse(320, 200, 90, 120, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#2f5bff'
    g.fillRect(180, 300, 280, 180)
    const photo = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.9))
    try {
      const cut = await cutOut(photo)
      return { ok: true as const, width: cut.canvas.width, height: cut.canvas.height, bounds: cut.bounds }
    } catch (error) {
      return { ok: false as const, error: String(error) }
    }
  })

  if (result.ok) {
    expect([result.width, result.height]).toEqual([640, 480])
    expect(result.bounds.w).toBeGreaterThan(0)
    expect(result.bounds.x + result.bounds.w).toBeLessThanOrEqual(641)
  } else {
    // "nobody in the picture" is a legitimate answer for a drawing. A load, WASM or model failure is not.
    expect(result.error).toContain('no person found')
  }
})
```
Run: `npx playwright test e2e/segment.spec.ts`
Expected: 1 passed. **If it fails with anything other than `no person found`** (404 on a vendor file, WASM compile error, a different API shape), fix it here before going on — everything later depends on this working.

- [ ] **Step 6: Static checks and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: exit 0.
```bash
git add src/client/lib/segment.ts src/client/lib/segment.test.ts e2e/segment.spec.ts vite.config.ts
git commit -m "feat: load the self-hosted selfie segmenter and cut a person out of a photo"
```

---

## Task 12: Cutouts on the strip — picker, hook, rendering, fallback

**Files:**
- Create: `src/client/hooks/useCutouts.ts`, `src/client/components/BackgroundPicker.tsx`, `e2e/background.spec.ts`
- Modify: `src/client/lib/strip.ts`, `src/client/hooks/useStrip.ts`, `src/client/screens/Result.tsx`

**Interfaces:**
- Consumes: `Scene`, `BackgroundId`, `BACKGROUNDS`, `drawBackground` (Task 8); `Cutout`, `placePerson`, `cutoutKey` (Task 9); `cutOut`, `withTimeout` (Task 11); `SEGMENT_TIMEOUT_MS` (Task 10); `CellBlobs` (phase 1).
- Produces:
  - `CellContent` gains `scene?: Scene` and `cutouts?: { a?: Cutout; b?: Cutout }`; `drawCell` uses them for a `both` cell when both cutouts and a scene are present, otherwise draws the split cell.
  - `useCutouts(cells: readonly CellBlobs[] | null, enabled: boolean): { status: 'idle' | 'loading' | 'ready' | 'failed'; byKey: ReadonlyMap<string, Cutout> }`
  - `useStrip(cells, template, meta, scene: Scene | null, cutouts: ReadonlyMap<string, Cutout>)`
  - `BackgroundPicker({ value, onChange })`.

- [ ] **Step 1: The e2e spec first (it fails: there is no picker)**

`e2e/background.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test'
import { closePlayers, connectedPair, finishSession, keepCell, shootCell } from './helpers'

test.afterEach(closePlayers)

const strip = (page: Page) => page.getByRole('img', { name: 'Photo strip' })

/** One pixel of the finished strip as [r, g, b]. */
const pixel = (page: Page, x: number, y: number) =>
  strip(page).evaluate(
    async (img: HTMLImageElement, at: [number, number]) => {
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return Array.from(ctx.getImageData(at[0], at[1], 1, 1).data.slice(0, 3))
    },
    [x, y] as [number, number],
  )

test('choosing a background puts both people on it, and the strip downloads', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'polaroid') // one TOGETHER cell
  const before = await strip(a).getAttribute('src')

  await a.getByRole('radio', { name: 'YELLOW' }).check()
  await expect.poll(() => strip(a).getAttribute('src'), { timeout: 90_000 }).not.toBe(before)

  // The cell starts at x = 48. A person's box is at most 55 % of the cell wide and centred at 30 % / 70 %, so it can
  // never start before 24 px into the cell: 12 px in, at mid-height, only the background shows — yellow #ffe600.
  const [r, g, bl] = await pixel(a, 60, 408)
  expect([r, g, bl]).toEqual([255, 230, 0])
  expect(await strip(a).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1032])

  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)

  // Style is per person: B is unaffected.
  await expect(b.getByRole('radio', { name: 'SIDE BY SIDE' })).toBeChecked()
  await expect(a.getByText('CUTOUTS ARE MADE ON YOUR DEVICE.')).toBeVisible()
})

// Review Focus 5: the cutout tool cannot load.
test("if the cutout tool can't load, the cell falls back to side by side and download still works", async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'polaroid')
  const before = await strip(a).getAttribute('src')

  await a.route('**/vendor/**', (route) => route.abort()) // the model and the WASM are unreachable
  await a.getByRole('radio', { name: 'YELLOW' }).check()

  await expect(a.getByText("COULDN'T CUT YOU OUT. SHOWING SIDE BY SIDE.")).toBeVisible({ timeout: 60_000 })
  expect(await strip(a).getAttribute('src')).toBe(before) // the strip is still the side-by-side one
  await expect(a.getByRole('button', { name: 'DOWNLOAD PHOTO' })).toBeEnabled()
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
})

test('a strip with no TOGETHER cell does not offer a background', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await connectedPair(browser)
  await a.getByRole('radio', { name: /polaroid/i }).check()
  await a.getByRole('group', { name: /cell 1/i }).getByRole('radio', { name: /user 1/i }).check()
  await expect(b.getByRole('group', { name: /cell 1/i }).getByRole('radio', { name: /user 1/i })).toBeChecked()
  // Shoot the one cell as USER 1 only, keep it, and look at the finished screen.
  await shootCell(a, b)
  await keepCell(a, b)
  await expect(a.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expect(a.getByRole('radio', { name: 'YELLOW' })).toHaveCount(0)
})
```
Run: `npx playwright test e2e/background.spec.ts`
Expected: FAIL (no `YELLOW` radio exists).

- [ ] **Step 2: Draw cutouts in the strip**

In `src/client/lib/strip.ts`:
1. Add imports under the existing ones:
```ts
import { drawBackground, type Scene } from './backgrounds'
import { placePerson, type Cutout } from './cutout'
```
2. Add two fields to `interface CellContent` (after `seed`):
```ts
  /** TOGETHER cells only: a background scene plus both people's cutouts replaces the side-by-side halves. */
  scene?: Scene
  cutouts?: { a?: Cutout; b?: Cutout }
```
3. In `drawCell`, replace the loop
```ts
  for (const { who, dest } of cellPlacements(content.kind, cell.w, cell.h)) {
    const bmp = content[who]
    if (!bmp) continue
    const { sx, sy, sw, sh } = coverRect(bmp.width, bmp.height, dest.w, dest.h)
    t.drawImage(bmp, sx, sy, sw, sh, dest.x, dest.y, dest.w, dest.h)
  }
```
with:
```ts
  const cutA = content.cutouts?.a
  const cutB = content.cutouts?.b
  if (content.kind === 'both' && content.scene && cutA && cutB) {
    // Both people cut out of their own photos, standing on one background (spec D31).
    drawBackground(t, content.scene, { x: 0, y: 0, w: cell.w, h: cell.h }, mulberry32(seedFromString(`${content.seed}:scene`)))
    for (const [who, cut] of [['a', cutA], ['b', cutB]] as const) {
      const { src, dest } = placePerson(cut.bounds, { w: cell.w, h: cell.h }, who)
      t.drawImage(cut.canvas, src.x, src.y, src.w, src.h, dest.x, dest.y, dest.w, dest.h)
    }
  } else {
    for (const { who, dest } of cellPlacements(content.kind, cell.w, cell.h)) {
      const bmp = content[who]
      if (!bmp) continue
      const { sx, sy, sw, sh } = coverRect(bmp.width, bmp.height, dest.w, dest.h)
      t.drawImage(bmp, sx, sy, sw, sh, dest.x, dest.y, dest.w, dest.h)
    }
  }
```

- [ ] **Step 3: `useStrip` takes a scene and the cutouts**

Replace `src/client/hooks/useStrip.ts`:
```ts
import { useEffect, useState } from 'react'
import type { TemplateId } from '../../shared/plan'
import type { Scene } from '../lib/backgrounds'
import { cutoutKey, type Cutout } from '../lib/cutout'
import { canvasToBlob } from '../lib/photo'
import { renderStrip, type CellContent, type StripMeta } from '../lib/strip'
import type { CellBlobs } from '../lib/takes'
import { useLatest } from './useLatest'

/**
 * Composes the strip whenever the kept photos, template, metadata, background or cutouts change; exposes an object URL
 * for display and the canvas for export. `cells` is read through a ref and keyed by content, so a new array with the
 * same photos does not recompose. `scene` is null for "side by side" (also while cutouts are still loading or failed).
 */
export function useStrip(
  cells: readonly CellBlobs[] | null,
  template: TemplateId | null,
  meta: StripMeta,
  scene: Scene | null,
  cutouts: ReadonlyMap<string, Cutout>,
) {
  const [url, setUrl] = useState<string | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState(false)
  const latest = useLatest(cells)
  const key = cells ? cells.map((c) => `${c.kind}:${c.round}`).join('|') : ''

  useEffect(() => {
    const current = latest.current
    if (!current || !template) return
    let cancelled = false
    let objectUrl: string | null = null
    const opened: ImageBitmap[] = []
    void (async () => {
      try {
        const content: CellContent[] = []
        for (const [i, cell] of current.entries()) {
          const a = cell.kind !== 'b' ? await createImageBitmap(cell.a) : undefined
          const b = cell.kind !== 'a' ? await createImageBitmap(cell.b) : undefined
          for (const bmp of [a, b]) if (bmp) opened.push(bmp)
          content.push({
            kind: cell.kind,
            a,
            b,
            seed: `${meta.code}:${i}:${cell.round}`,
            scene: cell.kind === 'both' && scene ? scene : undefined,
            cutouts: { a: cutouts.get(cutoutKey(cell.round, 'a')), b: cutouts.get(cutoutKey(cell.round, 'b')) },
          })
        }
        const composed = await renderStrip(content, template, meta)
        const png = await canvasToBlob(composed, 'image/png')
        if (cancelled) return
        objectUrl = URL.createObjectURL(png)
        setCanvas(composed)
        setUrl(objectUrl)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        opened.forEach((bmp) => bmp.close())
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key, template, meta, scene, cutouts, latest])

  return { url, canvas, error }
}
```

- [ ] **Step 4: `useCutouts` — compute, cache, time out, fall back**

`src/client/hooks/useCutouts.ts` (like `useStrip`, it reads `cells` through a ref and keys by content, so a re-created array with the same photos does not redo the work):
```ts
import { useEffect, useState } from 'react'
import { cutoutKey, type Cutout } from '../lib/cutout'
import { cutOut, withTimeout } from '../lib/segment'
import type { CellBlobs } from '../lib/takes'
import { SEGMENT_TIMEOUT_MS } from '../lib/vendor'
import { useLatest } from './useLatest'

export type CutoutStatus = 'idle' | 'loading' | 'ready' | 'failed'
interface State {
  status: CutoutStatus
  byKey: ReadonlyMap<string, Cutout>
}
const IDLE: State = { status: 'idle', byKey: new Map() }
const FAILED: State = { status: 'failed', byKey: new Map() }

// One cutout per round and person, kept for the life of the tab (a photo never changes once taken).
// ponytail: never evicted; a long session with many retakes holds a few MB per retaken TOGETHER cell. Evict by round if it matters.
const cache = new Map<string, Promise<Cutout>>()
function cutoutFor(round: number, who: 'a' | 'b', photo: Blob): Promise<Cutout> {
  const key = cutoutKey(round, who)
  let hit = cache.get(key)
  if (!hit) {
    hit = withTimeout(cutOut(photo), SEGMENT_TIMEOUT_MS, 'cutting a person out')
    cache.set(key, hit)
    hit.catch(() => cache.delete(key)) // a failure is not remembered: choosing a background again retries
  }
  return hit
}

/** Cut both people out of every TOGETHER cell, one at a time. Any failure → `failed`, and the strip stays side by side. */
export function useCutouts(cells: readonly CellBlobs[] | null, enabled: boolean): State {
  const [state, setState] = useState<State>(IDLE)
  const latest = useLatest(cells)
  const key = cells ? cells.map((c) => `${c.kind}:${c.round}`).join('|') : ''

  useEffect(() => {
    const current = latest.current
    if (!current || !enabled || !current.some((c) => c.kind === 'both')) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState((s) => ({ status: 'loading', byKey: s.byKey }))
    void (async () => {
      try {
        const byKey = new Map<string, Cutout>()
        for (const cell of current) {
          if (cell.kind !== 'both') continue
          for (const who of ['a', 'b'] as const) byKey.set(cutoutKey(cell.round, who), await cutoutFor(cell.round, who, cell[who]))
        }
        if (!cancelled) setState({ status: 'ready', byKey })
      } catch {
        if (!cancelled) setState(FAILED)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [key, enabled, latest])

  return state
}
```

- [ ] **Step 5: `BackgroundPicker`**

`src/client/components/BackgroundPicker.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { BACKGROUNDS, drawBackground, type BackgroundId, type Scene } from '../lib/backgrounds'
import { mulberry32, seedFromString } from '../lib/strip'

const CELL = { x: 0, y: 0, w: 960, h: 720 }
const SCALE = 0.2 // a 960 × 720 cell drawn at 192 × 144

/** The scene exactly as the strip will draw it, just smaller (preview = result). */
function Swatch({ scene }: { scene: Scene }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ctx.save()
    ctx.scale(SCALE, SCALE)
    drawBackground(ctx, scene, CELL, mulberry32(seedFromString(`${scene}`)))
    ctx.restore()
  }, [scene])
  return <canvas ref={ref} width={CELL.w * SCALE} height={CELL.h * SCALE} aria-hidden="true" className="block h-12 w-16" />
}

export function BackgroundPicker({ value, onChange }: { value: BackgroundId; onChange: (id: BackgroundId) => void }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 text-xs font-black uppercase tracking-[0.2em]">Background</legend>
      <div className="flex flex-wrap gap-2">
        {BACKGROUNDS.map((b) => (
          <label key={b.id} className="relative">
            <input
              type="radio"
              name="background"
              value={b.id}
              checked={value === b.id}
              aria-label={b.label}
              onChange={() => onChange(b.id)}
              className="peer absolute inset-0 m-0 cursor-pointer opacity-0"
            />
            <span className="block border-[3px] border-ink bg-paper p-1 shadow-brutal-sm peer-checked:bg-ink peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-ink">
              {b.id === 'none' ? (
                <span className="grid h-12 w-16 place-items-center text-center text-[10px] font-black uppercase leading-tight text-ink">SIDE BY SIDE</span>
              ) : (
                <Swatch scene={b.id} />
              )}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
```
(`peer-checked:bg-ink` turns the padding around the selected swatch solid ink, so selection is not carried by colour alone: the frame changes weight too.)

- [ ] **Step 6: Wire it into `Result`**

In `src/client/screens/Result.tsx`:
1. Add imports:
```tsx
import { BackgroundPicker } from '../components/BackgroundPicker'
import { useCutouts } from '../hooks/useCutouts'
import type { BackgroundId } from '../lib/backgrounds'
```
2. Add state next to the others: `const [background, setBackground] = useState<BackgroundId>('none')`
3. Replace the line `const { url, canvas, error } = useStrip(cells, template, meta)` with:
```tsx
  const hasTogether = cells.some((c) => c.kind === 'both')
  const wantsCutout = background !== 'none' && hasTogether
  const cut = useCutouts(cells, wantsCutout)
  const scene = wantsCutout && cut.status === 'ready' && background !== 'none' ? background : null
  const { url, canvas, error } = useStrip(cells, template, meta, scene, cut.byKey)
```
4. In the style card, directly above `<FilterPicker value={filter} onChange={setFilter} />` insert:
```tsx
        {hasTogether && (
          <div className="flex flex-col gap-2">
            <BackgroundPicker value={background} onChange={setBackground} />
            {cut.status === 'loading' && (
              <p role="status" className="text-sm font-black uppercase">
                CUTTING YOU OUT…
              </p>
            )}
            {cut.status === 'failed' && (
              <p role="status" className="border-[3px] border-ink bg-orange p-2 text-sm font-black uppercase">
                COULDN'T CUT YOU OUT. SHOWING SIDE BY SIDE.
              </p>
            )}
            <p className="text-xs font-black uppercase">CUTOUTS ARE MADE ON YOUR DEVICE.</p>
          </div>
        )}
```
- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm run lint && npm test`
Expected: exit 0 (including `style-rules`).
Run: `npx playwright test e2e/background.spec.ts`
Expected: 3 passed. If the pixel assertion fails with a *non-yellow* colour, a cutout is covering the corner: check `placePerson` limits against the screenshot before touching the test. If the failure-fallback test never shows the notice, check that `useCutouts` maps a rejected `cutOut` to `FAILED` and that `loadSegmenter` resets after a failure.

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/strip.ts src/client/hooks/useStrip.ts src/client/hooks/useCutouts.ts src/client/components/BackgroundPicker.tsx src/client/screens/Result.tsx e2e/background.spec.ts
git commit -m "feat: put both people on a chosen background with a side-by-side fallback"
```

---

## Task 13: Phase 2 gate — README, device checklist, full verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation of the feature, the new device-only checks, and the real verification numbers.

- [ ] **Step 1: README — how it works and what to check on devices**

In `README.md`:
1. Add a section before "How synchronization works":
```markdown
## Format, takes and cutouts

A session is: **FORMAT** (4-cut, 2 × 2, 2-cut or Polaroid; for each cell USER 1, USER 2 or TOGETHER — either person can choose) → **SHOOT** (2–3 synchronized takes per cell) → **PICK** (both keep one take) → **STYLE** (the finished strip: background, filter, file type, download, share, and retake of any single cell).

A TOGETHER cell can put both people on one background. Each person is cut out of their own photo **in the browser** by the MediaPipe selfie segmenter. The runtime (~26 MB of WASM, two variants) and the model (250 KB) are self-hosted under `/vendor/` — `npm install` copies the runtime out of `node_modules` (`scripts/vendor-mediapipe.mjs`), the model is committed — and load only when someone first picks a background. The default, "side by side", never downloads them. The CSP gains exactly `'wasm-unsafe-eval'`. If the tool cannot load or run, the cell stays side by side with a notice and download keeps working.

Background, filter and file type are per person: your two downloads can differ. The first deploy uploads the vendored files as static assets; if you deploy through Workers Builds, leave `postinstall` scripts enabled.
```
2. Append rows to the manual checklist table:
```markdown
| 13 | Take a real selfie pair (indoor light, hair, glasses) on iPhone Safari and Android Chrome, choose a background | the **person** is kept and the background replaced on both phones' strips (not the other way round); the edge is acceptable |
| 14 | Pick a first background on mobile data | "CUTTING YOU OUT…" appears and finishes in roughly 10 s on 4G; if it fails, the notice shows and a retry works |
| 15 | 4-cut with four TOGETHER cells on a mid-range phone | the page stays usable; note the total time and whether the tab freezes (cutouts run on the main thread) |
| 16 | After `wrangler deploy`: choose a background, check the console and `curl -sI https://<worker>/vendor/models/selfie_segmenter.tflite` | no CSP violation; `cache-control: public, max-age=31536000, immutable`; the WASM compiles under the deployed CSP |
| 17 | The two people pick different backgrounds | each person's strip matches their own screen |
```
3. In the "Verification status" table add:
```markdown
| Cutout pipeline | **verified here (plumbing only)** | e2e: the self-hosted WASM + model load and return a well-formed cutout; a chosen background changes the strip and the cell corner is exactly the background colour; blocking `/vendor/*` falls back to side by side with a notice and download still works. **Quality on real people is not verified here** — rows 13–15 |
| CSP with WASM | **verified here (unit)** | `public/_headers` allows `'wasm-unsafe-eval'` and never `'unsafe-eval'`; the dev server does not serve `_headers`, so deployed behaviour is row 16 |
```

- [ ] **Step 2: The full gate**

Run, in order:
```bash
npm run check
npm run build
find dist -name 'vision_wasm_internal.wasm' -o -name 'selfie_segmenter.tflite'
git ls-files public/vendor
npm run test:e2e 2>&1 | tail -15
```
Expected: `check` exit 0; `build` succeeds; both vendored files appear in `dist`; `git ls-files` lists only the `.tflite`; every e2e spec passes (note the real counts for the README's verification table and update the intro line's date and counts only if you re-ran everything).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document formats, takes and cutouts, and the device-only checks for them"
```
