# Phase 3 — Photos (Tasks 16–19)

> Part of `2026-10-08-photobooth.md`. **Read that master file first.** Spec: `docs/superpowers/specs/2026-10-07-photobooth-design.md` §8 (DataChannel), §9 (photos), D13–D15.

**Phase goal:** at `captureAt` each browser grabs a real frame from its own `<video>` (mirrored exactly when its preview is), compresses it, sends it to the partner over the DataChannel, and both end up with the same two photos, composed into a downloadable photo strip.

**Gate (all must pass before Phase 4):**
1. `npm run check` green.
2. `npm run test:e2e -- photos.spec.ts` green: each side holds both photos; preview flip matches capture (`mirrored` true *and* false cases); strip is the expected size; PNG and JPG download.

Phase 3 removes the Phase 2 stand-in (`photo-complete` sent right after "capturing").

---

## Task 16: `photo.ts` — capture a frame, fit, cover-crop, strip geometry

**Files:**
- Create: `src/client/lib/photo.ts`, `src/client/lib/photo.test.ts`

**Interfaces:**
- Consumes: `CELL_ASPECT`, `PHOTO_JPEG_QUALITY`, `PHOTO_MAX_EDGE`.
- Produces:
  - `class FrameNotReadyError extends Error`
  - `fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number }` (never upscales)
  - `captureFrame(video: HTMLVideoElement, opts: { mirrored: boolean }, makeCanvas?: (w: number, h: number) => CanvasLike): Promise<Blob>` — JPEG, longest edge ≤ 1280, mirrored when asked; throws `FrameNotReadyError` if the video has no decoded frame
  - `canvasToBlob(canvas: CanvasLike, type: string, quality?: number): Promise<Blob>`
  - `coverRect(srcW, srcH, dstW, dstH): { sx: number; sy: number; sw: number; sh: number }` (centered "cover" crop)
  - `type StripLayout = 'vertical' | 'horizontal' | 'grid'`; `interface Rect { x; y; w; h }`; `interface StripGeometry { width; height; cells: Rect[]; footer: Rect }`; constants `CELL_W = 960`, `CELL_H = 720`, `STRIP_PAD = 48`, `STRIP_GAP = 48`, `STRIP_FOOTER_H = 168`; `layoutStrip(layout: StripLayout): StripGeometry`; `photosNeeded(layout: StripLayout): number` (2, 2, 4)

- [ ] **Step 1: Write the failing tests**

`src/client/lib/photo.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import {
  canvasToBlob,
  captureFrame,
  coverRect,
  fitWithin,
  FrameNotReadyError,
  layoutStrip,
  photosNeeded,
  type CanvasLike,
} from './photo'

function fakeCanvas(w: number, h: number, opts: { failEncode?: boolean } = {}) {
  const calls: string[] = []
  const canvas = {
    width: w,
    height: h,
    calls,
    getContext: () => ({
      translate: (x: number, y: number) => calls.push(`translate ${x} ${y}`),
      scale: (x: number, y: number) => calls.push(`scale ${x} ${y}`),
      drawImage: (_i: unknown, dx: number, dy: number, dw: number, dh: number) => calls.push(`draw ${dx} ${dy} ${dw} ${dh}`),
    }),
    toBlob: (cb: (b: Blob | null) => void, type?: string) => cb(opts.failEncode ? null : new Blob(['jpeg'], { type })),
  }
  return canvas satisfies CanvasLike & { calls: string[] }
}

const video = (videoWidth: number, videoHeight: number, readyState = 4) =>
  ({ videoWidth, videoHeight, readyState }) as unknown as HTMLVideoElement

describe('fitWithin', () => {
  it('shrinks the long edge to the limit, keeping the aspect ratio', () => {
    expect(fitWithin(1920, 1080, 1280)).toEqual({ w: 1280, h: 720 })
    expect(fitWithin(1080, 1920, 1280)).toEqual({ w: 720, h: 1280 })
  })
  it('never upscales', () => {
    expect(fitWithin(640, 480, 1280)).toEqual({ w: 640, h: 480 })
  })
})

describe('captureFrame', () => {
  it('draws the frame scaled to fit and encodes a JPEG', async () => {
    const canvas = fakeCanvas(0, 0)
    const blob = await captureFrame(video(1920, 1080), { mirrored: false }, (w, h) => Object.assign(canvas, { width: w, height: h }))
    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(720)
    expect(canvas.calls).toEqual(['draw 0 0 1280 720'])
    expect(blob.type).toBe('image/jpeg')
  })

  it('flips horizontally before drawing when the preview is mirrored (preview = result)', async () => {
    const canvas = fakeCanvas(0, 0)
    await captureFrame(video(640, 480), { mirrored: true }, (w, h) => Object.assign(canvas, { width: w, height: h }))
    expect(canvas.calls).toEqual(['translate 640 0', 'scale -1 1', 'draw 0 0 640 480'])
  })

  // Review Focus 3: the camera is still waking up at captureAt.
  it.each([
    ['no dimensions yet', video(0, 0)],
    ['zero width', video(0, 480)],
    ['not enough data (readyState 1)', video(640, 480, 1)],
  ])('refuses to build a photo when the video has no frame: %s', async (_name, v) => {
    await expect(captureFrame(v, { mirrored: false }, (w, h) => fakeCanvas(w, h))).rejects.toBeInstanceOf(FrameNotReadyError)
  })

  it('rejects when the encoder produces nothing', async () => {
    await expect(
      captureFrame(video(640, 480), { mirrored: false }, (w, h) => fakeCanvas(w, h, { failEncode: true })),
    ).rejects.toThrow(/encode/)
  })

  it('canvasToBlob rejects on a null blob', async () => {
    await expect(canvasToBlob(fakeCanvas(1, 1, { failEncode: true }), 'image/png')).rejects.toThrow()
  })
})

describe('coverRect', () => {
  it('crops the sides of a wide source', () => {
    expect(coverRect(1280, 720, 960, 720)).toEqual({ sx: 160, sy: 0, sw: 960, sh: 720 })
  })
  it('crops the top and bottom of a tall source', () => {
    expect(coverRect(720, 1280, 960, 720)).toEqual({ sx: 0, sy: 370, sw: 720, sh: 540 })
  })
  it('keeps a matching aspect whole', () => {
    expect(coverRect(960, 720, 960, 720)).toEqual({ sx: 0, sy: 0, sw: 960, sh: 720 })
  })
})

describe('layoutStrip', () => {
  it('vertical: two stacked cells and a footer', () => {
    const g = layoutStrip('vertical')
    expect([g.width, g.height]).toEqual([1056, 1800])
    expect(g.cells).toEqual([
      { x: 48, y: 48, w: 960, h: 720 },
      { x: 48, y: 816, w: 960, h: 720 },
    ])
    expect(g.footer).toEqual({ x: 48, y: 1584, w: 960, h: 168 })
  })
  it('horizontal: two side-by-side cells', () => {
    const g = layoutStrip('horizontal')
    expect([g.width, g.height]).toEqual([2064, 1032])
    expect(g.cells.map((c) => [c.x, c.y])).toEqual([[48, 48], [1056, 48]])
  })
  it('grid: A1|B1 over A2|B2, row-major', () => {
    const g = layoutStrip('grid')
    expect([g.width, g.height]).toEqual([2064, 1800])
    expect(g.cells).toHaveLength(4)
    expect(g.cells[2]).toEqual({ x: 48, y: 816, w: 960, h: 720 })
  })
  it('never overlaps cells and keeps everything inside the canvas', () => {
    for (const layout of ['vertical', 'horizontal', 'grid'] as const) {
      const g = layoutStrip(layout)
      for (const c of [...g.cells, g.footer]) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x + c.w).toBeLessThanOrEqual(g.width)
        expect(c.y + c.h).toBeLessThanOrEqual(g.height)
      }
    }
  })
  it('photosNeeded matches the number of cells', () => {
    for (const layout of ['vertical', 'horizontal', 'grid'] as const) {
      expect(photosNeeded(layout)).toBe(layoutStrip(layout).cells.length)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/client/lib/photo.test.ts`
Expected: FAIL — cannot resolve `./photo`.

- [ ] **Step 3: Implement**

`src/client/lib/photo.ts`:
```ts
import { CELL_ASPECT, PHOTO_JPEG_QUALITY, PHOTO_MAX_EDGE } from '../../shared/constants'

// ---- capture ---------------------------------------------------------------------------------

export class FrameNotReadyError extends Error {
  constructor() {
    super('the camera has not delivered a frame yet')
    this.name = 'FrameNotReadyError'
  }
}

/** The slice of the 2D context we use, so capture is testable without a browser. */
export interface Ctx2D {
  translate(x: number, y: number): void
  scale(x: number, y: number): void
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void
}
export interface CanvasLike {
  width: number
  height: number
  getContext(id: '2d'): Ctx2D | null
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void
}

const makeDomCanvas = (w: number, h: number): CanvasLike => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  return canvas
}

export function fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h))
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

export function canvasToBlob(canvas: CanvasLike, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('could not encode image'))), type, quality)
  })
}

/**
 * Grab the current frame of a live <video>. When `mirrored` is true the pixels are flipped so the
 * photo matches the CSS-flipped preview (spec D15). Throws FrameNotReadyError rather than ever
 * producing a blank or zero-sized photo.
 */
export async function captureFrame(
  video: HTMLVideoElement,
  opts: { mirrored: boolean },
  makeCanvas: (w: number, h: number) => CanvasLike = makeDomCanvas,
): Promise<Blob> {
  const { videoWidth, videoHeight } = video
  if (!videoWidth || !videoHeight || video.readyState < 2) throw new FrameNotReadyError()
  const { w, h } = fitWithin(videoWidth, videoHeight, PHOTO_MAX_EDGE)
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas is unavailable')
  if (opts.mirrored) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(video, 0, 0, w, h)
  return canvasToBlob(canvas, 'image/jpeg', PHOTO_JPEG_QUALITY)
}

// ---- strip geometry ---------------------------------------------------------------------------

/** Centered "cover" crop of a source into a destination aspect ratio. */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number) {
  const srcAspect = srcW / srcH
  const dstAspect = dstW / dstH
  if (srcAspect > dstAspect) {
    const sw = srcH * dstAspect
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH }
  }
  const sh = srcW / dstAspect
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh }
}

export type StripLayout = 'vertical' | 'horizontal' | 'grid'
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface StripGeometry {
  width: number
  height: number
  cells: Rect[]
  footer: Rect
}

export const CELL_W = 960
export const CELL_H = Math.round(CELL_W / CELL_ASPECT) // 720: a 4:3 cell, matching the live CameraFrame
export const STRIP_PAD = 48
export const STRIP_GAP = 48
export const STRIP_FOOTER_H = 168

const GRID: Record<StripLayout, { cols: number; rows: number }> = {
  vertical: { cols: 1, rows: 2 },
  horizontal: { cols: 2, rows: 1 },
  grid: { cols: 2, rows: 2 },
}

export const photosNeeded = (layout: StripLayout): number => GRID[layout].cols * GRID[layout].rows

/** Pure geometry for a strip, so layout is testable without a canvas. Cells are row-major. */
export function layoutStrip(layout: StripLayout): StripGeometry {
  const { cols, rows } = GRID[layout]
  const width = STRIP_PAD * 2 + cols * CELL_W + (cols - 1) * STRIP_GAP
  const gridHeight = rows * CELL_H + (rows - 1) * STRIP_GAP
  const footerY = STRIP_PAD + gridHeight + STRIP_GAP
  const cells: Rect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: STRIP_PAD + c * (CELL_W + STRIP_GAP), y: STRIP_PAD + r * (CELL_H + STRIP_GAP), w: CELL_W, h: CELL_H })
    }
  }
  return {
    width,
    height: footerY + STRIP_FOOTER_H + STRIP_PAD,
    cells,
    footer: { x: STRIP_PAD, y: footerY, w: width - STRIP_PAD * 2, h: STRIP_FOOTER_H },
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/client/lib/photo.test.ts && npm run typecheck && npm run lint`
Expected: PASS. (If `HTMLCanvasElement` is not assignable to `CanvasLike` in `makeDomCanvas`, the `getContext` overload is the cause — narrow the return with `canvas as unknown as CanvasLike`; the DOM method is a superset of what `CanvasLike` needs.)

- [ ] **Step 5: Commit**

```bash
git add src/client/lib/photo.ts src/client/lib/photo.test.ts
git commit -m "feat: add frame capture, cover crop and strip geometry"
```

---

## Task 17: `photo-transfer.ts` and `rounds.ts`

**Files:**
- Create: `src/client/lib/photo-transfer.ts`, `src/client/lib/photo-transfer.test.ts`, `src/client/lib/rounds.ts`, `src/client/lib/rounds.test.ts`

**Interfaces:**
- Consumes: `CHUNK_BYTES`, `PHOTO_MAX_BYTES`; `SlotName`; `StripLayout` (type-only, from `./photo`).
- Produces (`photo-transfer.ts`):
  - `type ChannelControl = { t: 'cam'; mirrored: boolean } | { t: 'photo'; round: number; mime: 'image/jpeg'; size: number } | { t: 'end'; round: number }`
  - `parseControl(raw: string): ChannelControl | null`
  - `chunks(buf: ArrayBuffer, size?: number): Generator<ArrayBuffer>`
  - `class PhotoReceiver` — `constructor(expectedRound: () => number, onPhoto: (round: number, blob: Blob) => void, onReject?: (reason: string) => void)`; `onControl(c: ChannelControl)` (ignores `cam`); `onBinary(b: ArrayBuffer)`
  - `interface PhotoChannel { sendText(s: string): boolean; sendBinary(b: ArrayBuffer): boolean; waitForDrain(): Promise<void> }`; `sendPhoto(ch: PhotoChannel, round: number, blob: Blob): Promise<boolean>`
- Produces (`rounds.ts`): `Round { round; a: Blob; b: Blob }`, `Pending { round; own?: Blob; partner?: Blob }`, `mergePhoto(pending, round, who, blob): Pending`, `completeRound(pending, slot): Round | null`, `pushRound(rounds, r, keep = 2): Round[]`, `stripBlobs(layout, rounds): Blob[] | null`

- [ ] **Step 1: Write the failing transfer tests**

`src/client/lib/photo-transfer.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { PHOTO_MAX_BYTES } from '../../shared/constants'
import { chunks, parseControl, PhotoReceiver, sendPhoto, type PhotoChannel } from './photo-transfer'

function setup(expectedRound = 1) {
  const got: Array<{ round: number; blob: Blob }> = []
  const rejects: string[] = []
  const receiver = new PhotoReceiver(
    () => expectedRound,
    (round, blob) => got.push({ round, blob }),
    (reason) => rejects.push(reason),
  )
  const text = (s: string) => {
    const c = parseControl(s)
    if (c) receiver.onControl(c)
  }
  return { receiver, got, rejects, text }
}
const header = (round: number, size: number) => JSON.stringify({ t: 'photo', round, mime: 'image/jpeg', size })
const end = (round: number) => JSON.stringify({ t: 'end', round })
const bytes = (n: number) => new Uint8Array(n).fill(7).buffer

describe('parseControl', () => {
  it('accepts the three control messages', () => {
    expect(parseControl('{"t":"cam","mirrored":false}')).toEqual({ t: 'cam', mirrored: false })
    expect(parseControl(header(2, 10))).toEqual({ t: 'photo', round: 2, mime: 'image/jpeg', size: 10 })
    expect(parseControl(end(2))).toEqual({ t: 'end', round: 2 })
  })
  it.each([
    ['not json', '{bad'],
    ['null', 'null'],
    ['a number', '5'],
    ['unknown type', '{"t":"nope"}'],
    ['string round', '{"t":"photo","round":"1","mime":"image/jpeg","size":5}'],
    ['fractional size', '{"t":"photo","round":1,"mime":"image/jpeg","size":5.5}'],
    ['wrong mime', '{"t":"photo","round":1,"mime":"image/png","size":5}'],
    ['cam without boolean', '{"t":"cam","mirrored":"yes"}'],
    ['huge', `{"t":"cam","mirrored":true,"pad":"${'x'.repeat(600)}"}`],
  ])('rejects %s', (_name, raw) => {
    expect(parseControl(raw)).toBeNull()
  })
})

describe('chunks', () => {
  it('splits into 16 KiB pieces with a short tail', () => {
    expect([...chunks(bytes(40_000))].map((c) => c.byteLength)).toEqual([16_384, 16_384, 7_232])
  })
  it('yields nothing for an empty buffer', () => {
    expect([...chunks(new ArrayBuffer(0))]).toEqual([])
  })
})

describe('PhotoReceiver — happy path', () => {
  it('assembles a photo sent by sendPhoto, byte for byte', async () => {
    const { receiver, got, rejects, text } = setup(3)
    const channel: PhotoChannel = {
      sendText: (s) => (text(s), true),
      sendBinary: (b) => (receiver.onBinary(b), true),
      waitForDrain: async () => {},
    }
    const original = new Uint8Array(40_000).map((_, i) => i % 251)
    expect(await sendPhoto(channel, 3, new Blob([original], { type: 'image/jpeg' }))).toBe(true)
    expect(rejects).toEqual([])
    expect(got).toHaveLength(1)
    expect(got[0]?.round).toBe(3)
    expect(new Uint8Array(await got[0]!.blob.arrayBuffer())).toEqual(original)
  })

  it('recovers when a new header arrives mid-transfer', () => {
    const { receiver, got, text } = setup()
    text(header(1, 10))
    receiver.onBinary(bytes(5))
    text(header(1, 10)) // sender restarted
    receiver.onBinary(bytes(10))
    text(end(1))
    expect(got).toHaveLength(1)
    expect(got[0]?.blob.size).toBe(10)
  })
})

// Review Focus 4: a broken or hostile partner must never crash us or leave a half-built photo.
describe('PhotoReceiver — hostile input', () => {
  it('rejects a header for the wrong round, then every chunk that follows', () => {
    const { receiver, got, rejects, text } = setup(1)
    text(header(5, 10))
    receiver.onBinary(bytes(10))
    text(end(5))
    expect(rejects).toEqual(['wrong-round', 'unexpected-binary', 'unexpected-end'])
    expect(got).toHaveLength(0)
  })

  it.each([0, PHOTO_MAX_BYTES + 1])('rejects a declared size of %i', (size) => {
    const { receiver, got, rejects, text } = setup()
    text(header(1, size))
    receiver.onBinary(bytes(10))
    expect(rejects[0]).toBe('bad-size')
    expect(got).toHaveLength(0)
  })

  it('rejects a truncated photo at `end`', () => {
    const { receiver, got, rejects, text } = setup()
    text(header(1, 100))
    receiver.onBinary(bytes(50))
    text(end(1))
    expect(rejects).toEqual(['size-mismatch'])
    expect(got).toHaveLength(0)
  })

  it('rejects more bytes than declared, and drops the partial photo', () => {
    const { receiver, got, rejects, text } = setup()
    text(header(1, 10))
    receiver.onBinary(bytes(8))
    receiver.onBinary(bytes(8))
    text(end(1))
    expect(rejects).toEqual(['overflow', 'unexpected-end'])
    expect(got).toHaveLength(0)
  })

  it('rejects `end` and binary data that arrive with no header', () => {
    const { receiver, got, rejects, text } = setup()
    text(end(1))
    receiver.onBinary(bytes(4))
    expect(rejects).toEqual(['unexpected-end', 'unexpected-binary'])
    expect(got).toHaveLength(0)
  })

  it('ignores `cam` messages and non-control junk without throwing', () => {
    const { receiver, got, rejects, text } = setup()
    text('{"t":"cam","mirrored":true}')
    text('definitely not json')
    expect(() => receiver.onControl({ t: 'cam', mirrored: false })).not.toThrow()
    expect(rejects).toEqual([])
    expect(got).toHaveLength(0)
  })
})

describe('sendPhoto', () => {
  const fake = (open = true, failBinaryAfter = Infinity) => {
    const sent: string[] = []
    let binaries = 0
    const channel: PhotoChannel = {
      sendText: (s) => (open ? (sent.push(s), true) : false),
      sendBinary: () => ++binaries <= failBinaryAfter,
      waitForDrain: async () => {},
    }
    return { channel, sent }
  }
  it('returns false when the channel is closed', async () => {
    expect(await sendPhoto(fake(false).channel, 1, new Blob(['x']))).toBe(false)
  })
  it('returns false and sends no `end` when a chunk fails', async () => {
    const { channel, sent } = fake(true, 1)
    expect(await sendPhoto(channel, 1, new Blob([new Uint8Array(40_000)]))).toBe(false)
    expect(sent.some((s) => s.includes('"end"'))).toBe(false)
  })
  it('refuses to send a photo larger than the limit', async () => {
    const { channel, sent } = fake()
    expect(await sendPhoto(channel, 1, new Blob([new Uint8Array(PHOTO_MAX_BYTES + 1)]))).toBe(false)
    expect(sent).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/client/lib/photo-transfer.test.ts`
Expected: FAIL — cannot resolve `./photo-transfer`.

- [ ] **Step 3: Implement `photo-transfer.ts`**

`src/client/lib/photo-transfer.ts`:
```ts
import { CHUNK_BYTES, PHOTO_MAX_BYTES } from '../../shared/constants'

export type ChannelControl =
  | { t: 'cam'; mirrored: boolean }
  | { t: 'photo'; round: number; mime: 'image/jpeg'; size: number }
  | { t: 'end'; round: number }

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Parse a text frame from the DataChannel. The partner is untrusted: anything unexpected is null. */
export function parseControl(raw: string): ChannelControl | null {
  if (raw.length > 512) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  switch (o.t) {
    case 'cam':
      return typeof o.mirrored === 'boolean' ? { t: 'cam', mirrored: o.mirrored } : null
    case 'photo':
      return isInt(o.round) && isInt(o.size) && o.mime === 'image/jpeg'
        ? { t: 'photo', round: o.round, mime: 'image/jpeg', size: o.size }
        : null
    case 'end':
      return isInt(o.round) ? { t: 'end', round: o.round } : null
    default:
      return null
  }
}

export function* chunks(buf: ArrayBuffer, size: number = CHUNK_BYTES): Generator<ArrayBuffer> {
  for (let i = 0; i < buf.byteLength; i += size) yield buf.slice(i, Math.min(i + size, buf.byteLength))
}

/**
 * Reassembles one photo at a time from `photo` header → binary chunks → `end`. Every deviation
 * (wrong round, bad or exceeded size, missing header, truncation) drops the partial photo and
 * reports a reason; a photo is only ever emitted whole and exactly as declared.
 */
export class PhotoReceiver {
  private cur: { round: number; size: number; got: number; parts: ArrayBuffer[] } | null = null

  constructor(
    private readonly expectedRound: () => number,
    private readonly onPhoto: (round: number, blob: Blob) => void,
    private readonly onReject: (reason: string) => void = () => {},
  ) {}

  onControl(c: ChannelControl): void {
    if (c.t === 'photo') {
      if (c.round !== this.expectedRound()) {
        this.cur = null
        this.onReject('wrong-round')
        return
      }
      if (c.size <= 0 || c.size > PHOTO_MAX_BYTES) {
        this.cur = null
        this.onReject('bad-size')
        return
      }
      this.cur = { round: c.round, size: c.size, got: 0, parts: [] }
    } else if (c.t === 'end') {
      const cur = this.cur
      this.cur = null
      if (!cur || cur.round !== c.round) {
        this.onReject('unexpected-end')
        return
      }
      if (cur.got !== cur.size) {
        this.onReject('size-mismatch')
        return
      }
      this.onPhoto(cur.round, new Blob(cur.parts, { type: 'image/jpeg' }))
    }
  }

  onBinary(data: ArrayBuffer): void {
    const cur = this.cur
    if (!cur) {
      this.onReject('unexpected-binary')
      return
    }
    cur.got += data.byteLength
    if (cur.got > cur.size) {
      this.cur = null
      this.onReject('overflow')
      return
    }
    cur.parts.push(data)
  }
}

export interface PhotoChannel {
  sendText(text: string): boolean
  sendBinary(data: ArrayBuffer): boolean
  waitForDrain(): Promise<void>
}

/** Header, chunks (honouring back-pressure), end. Resolves false if the channel is closed or the photo is too big. */
export async function sendPhoto(channel: PhotoChannel, round: number, blob: Blob): Promise<boolean> {
  const buf = await blob.arrayBuffer()
  if (buf.byteLength === 0 || buf.byteLength > PHOTO_MAX_BYTES) return false
  if (!channel.sendText(JSON.stringify({ t: 'photo', round, mime: 'image/jpeg', size: buf.byteLength }))) return false
  for (const chunk of chunks(buf)) {
    if (!channel.sendBinary(chunk)) return false
    await channel.waitForDrain()
  }
  return channel.sendText(JSON.stringify({ t: 'end', round }))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/client/lib/photo-transfer.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing rounds tests**

`src/client/lib/rounds.test.ts`:
```ts
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
```

- [ ] **Step 6: Run to verify failure, implement, verify pass**

Run: `npx vitest run src/client/lib/rounds.test.ts` → FAIL (module missing).

`src/client/lib/rounds.ts`:
```ts
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
```
Run: `npx vitest run src/client/lib/rounds.test.ts && npm run typecheck && npm run lint` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/photo-transfer.ts src/client/lib/photo-transfer.test.ts src/client/lib/rounds.ts src/client/lib/rounds.test.ts
git commit -m "feat: add hardened photo transfer over the data channel and round bookkeeping"
```

---

## Task 18: Booth — capture, exchange, complete, `cam` mirroring

**Files:**
- Create: `src/client/screens/Result.tsx` (minimal; Task 19 replaces it), `e2e/photos.spec.ts`
- Modify: `src/client/pages/Booth.tsx`, `src/client/screens/Stage.tsx`

**Interfaces:**
- Consumes: Tasks 16, 17; `useWebRTC`'s `sendText/sendBinary/waitForDrain/channelOpen`; `recordCapture`.
- Produces: `Result({ latest: Round, slot: SlotName, me: PState | null, partner: PState | null, canRetake: boolean, onReady(ready: boolean): void })`; `Stage` gains `exchanging: boolean`, `captured: boolean`.

- [ ] **Step 1: Minimal Result screen**

`src/client/screens/Result.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { PState, SlotName } from '../../shared/protocol'
import type { Round } from '../lib/rounds'

interface Props {
  latest: Round
  slot: SlotName
  me: PState | null
  partner: PState | null
  canRetake: boolean
  onReady: (ready: boolean) => void
}

function useObjectUrl(blob: Blob): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

export function Result({ latest, slot, me, partner, canRetake, onReady }: Props) {
  const mine = useObjectUrl(slot === 'a' ? latest.a : latest.b)
  const theirs = useObjectUrl(slot === 'a' ? latest.b : latest.a)
  const iAmReady = me?.ready ?? false
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-3xl font-black">LOOK WHAT YOU MADE.</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <img src={mine} alt="Your photo" className="w-full border-4 border-black" />
        <img src={theirs} alt="Their photo" className="w-full border-4 border-black" />
      </div>
      <p className="font-black">
        YOU {iAmReady ? 'READY ✓' : 'NOT READY'} · THEM {partner?.ready ? 'READY ✓' : 'WAITING...'}
      </p>
      <button
        type="button"
        disabled={!canRetake}
        onClick={() => onReady(!iAmReady)}
        className="border-4 border-black px-4 py-3 font-black disabled:opacity-50"
      >
        {iAmReady ? 'READY ✓' : 'RETAKE'}
      </button>
    </main>
  )
}
```

- [ ] **Step 2: Stage shows the exchange**

In `src/client/screens/Stage.tsx` add to `Props`:
```ts
  exchanging: boolean
  captured: boolean
```
and replace the `{p.countdown ? … : …}` block with:
```tsx
      {p.countdown ? (
        <Countdown captureAt={p.countdown.captureAt} now={p.now} onDone={p.onCountdownDone} />
      ) : p.exchanging ? (
        <p className="font-black" aria-live="polite">
          {p.captured ? 'YOU CAPTURED ✓ · ' : ''}WAITING FOR THE PHOTOS...
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          <p className="font-black">
            YOU {iAmReady ? 'READY ✓' : 'NOT READY'} · THEM {p.partner?.ready ? 'READY ✓' : 'WAITING...'}
          </p>
          <button
            type="button"
            disabled={!p.canReady}
            onClick={() => p.onReady(!iAmReady)}
            className="border-4 border-black px-4 py-4 text-xl font-black disabled:opacity-50"
          >
            {iAmReady ? 'READY ✓' : "I'M READY"}
          </button>
        </section>
      )}
```

- [ ] **Step 3: Wire `Booth.tsx`**

Add imports:
```tsx
import { useEffect } from 'react'                     // merge into the existing react import
import { captureFrame, FrameNotReadyError } from '../lib/photo'
import { parseControl, PhotoReceiver, sendPhoto } from '../lib/photo-transfer'
import { completeRound, mergePhoto, pushRound, type Pending, type Round } from '../lib/rounds'
import { Result } from '../screens/Result'
```
Inside `BoothInner`, next to the other state, add:
```tsx
  const [rounds, setRounds] = useState<Round[]>([])
  const [partnerMirrored, setPartnerMirrored] = useState(true) // until the partner's `cam` message says otherwise
  const [captured, setCaptured] = useState(false)
  const [exchangeFailed, setExchangeFailed] = useState(false)
  const pending = useRef<Pending | null>(null)
  const completed = useRef(-1) // highest round already finished: later duplicates are ignored
  const currentRound = useRef(0) // the round the server most recently announced
```
Add `addPhoto` and the receiver **before** the `useWebRTC` call (it needs them in its channel handlers):
```tsx
  const addPhoto = useLatest((round: number, who: 'own' | 'partner', blob: Blob) => {
    if (round <= completed.current) return
    const merged = mergePhoto(pending.current, round, who, blob)
    pending.current = merged
    const done = slot.current ? completeRound(merged, slot.current) : null
    if (!done) return
    completed.current = round
    pending.current = null
    setRounds((all) => pushRound(all, done))
    room.send({ type: 'photo-complete', round })
  })
  const receiver = useMemo(
    () => new PhotoReceiver(() => currentRound.current, (round, blob) => addPhoto.current(round, 'partner', blob)),
    [addPhoto],
  )
```
Change the `useWebRTC` arguments:
```tsx
    onChannelText: (text) => {
      const control = parseControl(text)
      if (!control) return
      if (control.t === 'cam') setPartnerMirrored(control.mirrored)
      else receiver.onControl(control)
    },
    onChannelBinary: (data) => receiver.onBinary(data),
```
Replace the Phase 2 `onCapture` and `beginRound` with the real ones:
```tsx
  const onCapture = useLatest((round: number, at: number) => {
    const wallAt = Date.now() // the moment the shared timestamp fired on this device
    const video = localVideo.current
    const mirrored = camera.mirrored
    void (async () => {
      try {
        if (!video) throw new FrameNotReadyError()
        const blob = await captureFrame(video, { mirrored })
        recordCapture({ round, at, wallAt, mirrored })
        setCaptured(true)
        addPhoto.current(round, 'own', blob)
        const channel = { sendText: rtc.sendText, sendBinary: rtc.sendBinary, waitForDrain: rtc.waitForDrain }
        if (!(await sendPhoto(channel, round, blob))) setExchangeFailed(true)
      } catch {
        setMissed(true) // no frame yet, or the encoder failed: say so rather than sending nothing silently
      }
    })()
  })
  const beginRound = useLatest((round: number, captureAt: number) => {
    setMissed(false)
    const accepted = scheduler.schedule(round, captureAt, (r, at) => onCapture.current(r, at), () => setMissed(true))
    if (!accepted) return
    currentRound.current = round
    pending.current = null
    setCaptured(false)
    setExchangeFailed(false)
    setCountdown({ round, captureAt })
  })
```
(There is no `photo-complete` stand-in any more; `addPhoto` sends it when both photos exist.)

Tell the partner our mirroring, and detect a round that ended without both photos:
```tsx
  const { sendText, channelOpen } = rtc
  useEffect(() => {
    if (channelOpen) sendText(JSON.stringify({ t: 'cam', mirrored: camera.mirrored }))
  }, [channelOpen, sendText, camera.mirrored])

  const phase = room.state?.phase
  useEffect(() => {
    // The server gave up on the round (exchange timeout) while this side still lacked a photo.
    if (phase === 'ready' && pending.current !== null && pending.current.round === currentRound.current) {
      setExchangeFailed(true)
    }
  }, [phase])
```
Now the screen selection near the end of `BoothInner`. Replace everything from `const partner = …` to the end with:
```tsx
  const mySlot = room.state.you
  const partner = room.state.participants[otherSlot(mySlot)]
  const me = room.state.participants[mySlot]
  const latest = rounds[rounds.length - 1]
  const hasResult = latest !== undefined && room.state.phase !== 'capture'

  if (!partner?.connected && !hasResult) {
    return <Lobby code={code} shareUrl={`${location.origin}/b/${code}`} stream={camera.stream} mirrored={camera.mirrored} />
  }
  if (rtc.peerState === 'failed' || exchangeFailed) {
    return (
      <Problem
        kind="webrtc-failed"
        onRetry={() => {
          setExchangeFailed(false)
          room.reconnect()
        }}
      />
    )
  }
  if (hasResult) {
    return (
      <Result
        latest={latest}
        slot={mySlot}
        me={me}
        partner={partner}
        canRetake={Boolean(partner?.connected) && room.state.phase === 'ready' && sync.synced && rtc.channelOpen}
        onReady={(ready) => {
          if (ready) sync.burst(SYNC_BURST_READY)
          room.send({ type: ready ? 'ready' : 'unready' })
        }}
      />
    )
  }
  return (
    <Stage
      stream={camera.stream}
      mirrored={camera.mirrored}
      remoteStream={rtc.remoteStream}
      remoteMirrored={partnerMirrored}
      peerState={rtc.peerState}
      localVideoRef={localVideo}
      me={me}
      partner={partner}
      canReady={sync.synced && rtc.peerState === 'connected' && rtc.channelOpen}
      onReady={(ready) => {
        if (ready) sync.burst(SYNC_BURST_READY)
        room.send({ type: ready ? 'ready' : 'unready' })
      }}
      countdown={countdown}
      now={sync.now}
      onCountdownDone={finishCountdown}
      missed={missed}
      exchanging={room.state.phase === 'capture' && countdown === null}
      captured={captured}
    />
  )
```
(Delete the old `const me = …` and `const partner = …` lines that Phase 1/2 left above.)

- [ ] **Step 4: Write the e2e spec**

`e2e/photos.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test'
import { connectedPair, createBooth, enterBooth, expectRemoteVideo, lastCapture, newPlayer, pressReady } from './helpers'

const FLIPPED = 'matrix(-1, 0, 0, 1, 0, 0)'

async function transformOf(page: Page, testId: string): Promise<string> {
  return page.getByTestId(testId).evaluate((el) => getComputedStyle(el).transform)
}

test('each person ends up holding both photos', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)

  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
    for (const alt of ['Your photo', 'Their photo']) {
      const img = page.getByRole('img', { name: alt })
      await expect(img).toBeVisible()
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0)
    }
  }
})

test('preview matches result: a mirrored camera flips both frames and the capture', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  // Chromium's fake camera reports no facingMode, which the app treats as a front camera: mirrored.
  expect(await transformOf(a, 'local-video')).toBe(FLIPPED)
  expect(await transformOf(a, 'remote-video')).toBe(FLIPPED) // THEM mirrored too (default / cam message)
  expect(await transformOf(b, 'local-video')).toBe(FLIPPED)

  await pressReady(a)
  await pressReady(b)
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ mirrored: true })
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).toMatchObject({ mirrored: true })
})

test('preview matches result: a rear camera is not flipped, on the owner and on the partner (cam message)', async ({ browser }) => {
  const a = await newPlayer(browser)
  const b = await newPlayer(browser)
  // Make B's camera claim to be a rear camera before any app code runs.
  await b.addInitScript(() => {
    const original = MediaStreamTrack.prototype.getSettings
    MediaStreamTrack.prototype.getSettings = function (this: MediaStreamTrack) {
      return { ...original.call(this), facingMode: 'environment' }
    }
  })
  const url = await createBooth(a)
  await enterBooth(a)
  await b.goto(url)
  await enterBooth(b)
  await expectRemoteVideo(a)
  await expectRemoteVideo(b)

  expect(await transformOf(b, 'local-video')).toBe('none') // B sees themself un-flipped
  await expect.poll(() => transformOf(a, 'remote-video')).toBe('none') // A's THEM frame follows B's `cam` message
  expect(await transformOf(a, 'local-video')).toBe(FLIPPED) // A is still a front camera

  await pressReady(a)
  await pressReady(b)
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).toMatchObject({ mirrored: false })
  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).toMatchObject({ mirrored: true })
})
```

- [ ] **Step 5: Verify**

Run: `npm run check && npm run test:e2e -- photos.spec.ts capture.spec.ts connect.spec.ts`
Expected: `photos.spec.ts`, `connect.spec.ts` and the first and third tests of `capture.spec.ts` are green. The second test of `capture.spec.ts` ("a second round can follow the first") must change in this same commit, because after a round the screen is now the result screen, whose button reads `RETAKE`, not `I'M READY`. Replace that whole test with:
```ts
test('a second round can follow the first', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expect(b.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  expect(await lastCapture(a)).toMatchObject({ round: 1 })

  await a.getByRole('button', { name: 'RETAKE' }).click() // enabled once the server is back in `ready`
  await b.getByRole('button', { name: 'RETAKE' }).click()
  await expect.poll(() => lastCapture(a), { timeout: 20_000 }).toMatchObject({ round: 2 })
  await expect.poll(() => lastCapture(b), { timeout: 20_000 }).toMatchObject({ round: 2 })
})
```
Then run `npm run test:e2e -- capture.spec.ts` again.
Triage hints: photos never arrive → check the browser console for `RoomSocket`/`PhotoReceiver` rejects (temporarily log `onReject`); `wrong-round` means `currentRound` was not set before the partner's header arrived — `beginRound` must run on `capture-scheduled`; a hang on "WAITING FOR THE PHOTOS..." means one side never sent `photo-complete` (check `addPhoto` and `slot.current`).

- [ ] **Step 6: Commit**

```bash
git add src/client e2e
git commit -m "feat: capture frames, exchange photos over the data channel and mirror previews to match"
```

---

## Task 19: `renderStrip`, download, and the real Result screen

**Files:**
- Create: `src/client/lib/strip.ts`, `src/client/lib/strip.test.ts`, `src/client/hooks/useStrip.ts`
- Modify: `src/client/screens/Result.tsx` (replace), `src/client/pages/Booth.tsx` (pass new props, add unload guard), `e2e/photos.spec.ts`

**Interfaces:**
- Consumes: `layoutStrip`, `coverRect`, `canvasToBlob`, `StripLayout`, `Round`, `stripBlobs`, `formatRoomCode`, `APP_NAME`.
- Produces:
  - `seedFromString(s: string): number`, `mulberry32(seed: number): () => number`, `MONTHS`, `formatStripDate(d: Date): string` (`'07 OCT 2026'`)
  - `interface StripMeta { code: string; dateLabel: string; seed: string }`; `renderStrip(bitmaps: readonly ImageBitmap[], layout: StripLayout, meta: StripMeta): Promise<HTMLCanvasElement>`
  - `downloadBlob(blob: Blob, filename: string): void`; `shareImage(blob, filename, text): Promise<'shared' | 'unsupported' | 'cancelled'>`
  - `useStrip(blobs: Blob[] | null, layout: StripLayout, meta: StripMeta): { url: string | null; canvas: HTMLCanvasElement | null; error: boolean }`
  - `Result` props: `{ rounds: Round[]; code: string; slot: SlotName; me; partner; partnerHere: boolean; canRetake: boolean; onReady(ready: boolean): void }`

- [ ] **Step 1: Write the failing tests for the pure parts**

`src/client/lib/strip.test.ts`:
```ts
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
```
Run: `npx vitest run src/client/lib/strip.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement `strip.ts`**

`src/client/lib/strip.ts`:
```ts
import { formatRoomCode } from '../../shared/room-code'
import { coverRect, layoutStrip, type Rect, type StripLayout } from './photo'

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const

export function formatStripDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** FNV-1a: a tiny, stable string → 32-bit seed. */
export function seedFromString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32: deterministic PRNG, so both people's strips tilt identically. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface StripMeta {
  code: string
  dateLabel: string
  /** Seeds the per-frame tilt; use `${code}:${round}` so both partners match. */
  seed: string
}

const PAPER = '#fff8e7'
const INK = '#0a0a0a'
const PINK = '#ff4fa3'
const FRAME_BORDER = 10
const MAX_TILT_RAD = 0.014 // ≈ 0.8°
const FONT = '"Space Grotesk Variable", system-ui, sans-serif'

function drawCell(ctx: CanvasRenderingContext2D, bmp: ImageBitmap, cell: Rect, tilt: number): void {
  const { sx, sy, sw, sh } = coverRect(bmp.width, bmp.height, cell.w, cell.h)
  ctx.save()
  ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2)
  ctx.rotate(tilt)
  ctx.fillStyle = INK
  ctx.fillRect(-cell.w / 2 - FRAME_BORDER, -cell.h / 2 - FRAME_BORDER, cell.w + FRAME_BORDER * 2, cell.h + FRAME_BORDER * 2)
  ctx.drawImage(bmp, sx, sy, sw, sh, -cell.w / 2, -cell.h / 2, cell.w, cell.h)
  ctx.restore()
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = PINK
  ctx.fill()
  ctx.lineWidth = 8
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
  ctx.stroke()
}

/** Compose the photo strip. Fonts must be loaded first or canvas silently falls back to a system face. */
export async function renderStrip(
  bitmaps: readonly ImageBitmap[],
  layout: StripLayout,
  meta: StripMeta,
): Promise<HTMLCanvasElement> {
  await document.fonts.load(`900 56px ${FONT}`)
  const g = layoutStrip(layout)
  const canvas = document.createElement('canvas')
  canvas.width = g.width
  canvas.height = g.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas is unavailable')
  const rand = mulberry32(seedFromString(meta.seed))

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, g.width, g.height)

  g.cells.forEach((cell, i) => {
    const tilt = (rand() - 0.5) * 2 * MAX_TILT_RAD // always consume one value per cell so the sequence is stable
    const bmp = bitmaps[i]
    if (bmp) drawCell(ctx, bmp, cell, tilt)
  })

  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `900 64px ${FONT}`
  ctx.fillText(`BOOTH ${formatRoomCode(meta.code)}`, g.footer.x, g.footer.y + g.footer.h * 0.36)
  ctx.font = `700 40px ${FONT}`
  ctx.fillText(meta.dateLabel, g.footer.x, g.footer.y + g.footer.h * 0.76)
  drawStar(ctx, g.footer.x + g.footer.w - 90, g.footer.y + g.footer.h / 2, 76)

  ctx.lineWidth = 16
  ctx.strokeStyle = INK
  ctx.strokeRect(8, 8, g.width - 16, g.height - 16)
  return canvas
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Web Share with a file where the platform supports it; 'unsupported' means: fall back to a download. */
export async function shareImage(blob: Blob, filename: string, text: string): Promise<'shared' | 'unsupported' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type })
  if (typeof navigator.share !== 'function' || !navigator.canShare?.({ files: [file] })) return 'unsupported'
  try {
    await navigator.share({ files: [file], text })
    return 'shared'
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'unsupported'
  }
}
```
Run: `npx vitest run src/client/lib/strip.test.ts` → PASS.

- [ ] **Step 3: `useStrip` and the real Result screen**

`src/client/hooks/useStrip.ts`:
```ts
import { useEffect, useState } from 'react'
import { canvasToBlob, type StripLayout } from '../lib/photo'
import { renderStrip, type StripMeta } from '../lib/strip'

/** Composes the strip whenever the photos, layout or metadata change; exposes an object URL for display and the canvas for export. */
export function useStrip(blobs: Blob[] | null, layout: StripLayout, meta: StripMeta) {
  const [url, setUrl] = useState<string | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!blobs) return
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const bitmaps = await Promise.all(blobs.map((b) => createImageBitmap(b)))
        const composed = await renderStrip(bitmaps, layout, meta)
        bitmaps.forEach((b) => b.close())
        const png = await canvasToBlob(composed, 'image/png')
        if (cancelled) return
        objectUrl = URL.createObjectURL(png)
        setCanvas(composed)
        setUrl(objectUrl)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [blobs, layout, meta])

  return { url, canvas, error }
}
```

Replace `src/client/screens/Result.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { PState } from '../../shared/protocol'
import { useStrip } from '../hooks/useStrip'
import { canvasToBlob, type StripLayout } from '../lib/photo'
import { stripBlobs, type Round } from '../lib/rounds'
import { downloadBlob, formatStripDate, shareImage } from '../lib/strip'

interface Props {
  rounds: Round[]
  code: string
  me: PState | null
  partner: PState | null
  partnerHere: boolean
  canRetake: boolean
  onReady: (ready: boolean) => void
}

const LAYOUTS: Array<{ id: StripLayout; label: string }> = [
  { id: 'vertical', label: 'VERTICAL' },
  { id: 'horizontal', label: 'HORIZONTAL' },
  { id: 'grid', label: 'GRID' },
]

export function Result({ rounds, code, me, partner, partnerHere, canRetake, onReady }: Props) {
  const [layout, setLayout] = useState<StripLayout>('vertical')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [note, setNote] = useState<string | null>(null)
  const latest = rounds[rounds.length - 1]
  const blobs = useMemo(() => stripBlobs(layout, rounds), [layout, rounds])
  const meta = useMemo(
    () => ({ code, dateLabel: formatStripDate(new Date()), seed: `${code}:${latest?.round ?? 0}` }),
    [code, latest?.round],
  )
  const { url, canvas, error } = useStrip(blobs, layout, meta)
  const iAmReady = me?.ready ?? false
  const filename = `${APP_NAME.toLowerCase()}-${code}-${latest?.round ?? 0}.${format}`

  async function encode(): Promise<Blob | null> {
    if (!canvas) return null
    return canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.92)
  }
  async function download() {
    const blob = await encode()
    if (blob) downloadBlob(blob, filename)
  }
  async function share() {
    const blob = await encode()
    if (!blob) return
    const result = await shareImage(blob, filename, 'Made in the booth.')
    if (result === 'unsupported') {
      downloadBlob(blob, filename)
      setNote('PHOTO SAVED.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col gap-4 p-4">
      <h1 className="text-3xl font-black">LOOK WHAT YOU MADE.</h1>
      {!partnerHere && <p className="font-black">THEY LEFT :( SAVE YOUR STRIP BEFORE YOU GO.</p>}

      {error ? (
        <p role="alert" className="font-black">
          COULDN'T BUILD THE STRIP. TRY A DIFFERENT LAYOUT.
        </p>
      ) : url ? (
        <img src={url} alt="Photo strip" className="mx-auto max-h-[70dvh] border-4 border-black" />
      ) : (
        <p className="font-black">DEVELOPING...</p>
      )}

      <div role="radiogroup" aria-label="Layout" className="flex flex-wrap gap-2">
        {LAYOUTS.map((l) => (
          <button
            key={l.id}
            type="button"
            role="radio"
            aria-checked={layout === l.id}
            disabled={l.id === 'grid' && rounds.length < 2}
            onClick={() => setLayout(l.id)}
            className="border-4 border-black px-3 py-2 font-black disabled:opacity-50 aria-checked:bg-black aria-checked:text-white"
          >
            {l.label}
          </button>
        ))}
      </div>

      <div role="radiogroup" aria-label="File type" className="flex gap-2">
        {(['png', 'jpg'] as const).map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={format === f}
            onClick={() => setFormat(f)}
            className="border-4 border-black px-3 py-2 font-black aria-checked:bg-black aria-checked:text-white"
          >
            {f.toUpperCase()}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!canvas}
        onClick={() => void download()}
        className="border-4 border-black px-4 py-6 text-3xl font-black disabled:opacity-50"
      >
        DOWNLOAD PHOTO
      </button>
      <button type="button" disabled={!canvas} onClick={() => void share()} className="border-4 border-black px-4 py-3 font-black disabled:opacity-50">
        SHARE
      </button>
      {note && (
        <p role="status" className="font-black">
          {note}
        </p>
      )}

      {partnerHere && (
        <>
          <p className="font-black">
            YOU {iAmReady ? 'READY ✓' : 'NOT READY'} · THEM {partner?.ready ? 'READY ✓' : 'WAITING...'}
          </p>
          <button
            type="button"
            disabled={!canRetake}
            onClick={() => onReady(!iAmReady)}
            className="border-4 border-black px-4 py-3 font-black disabled:opacity-50"
          >
            {iAmReady ? 'READY ✓' : 'RETAKE'}
          </button>
        </>
      )}
    </main>
  )
}
```

- [ ] **Step 4: Update `Booth.tsx`**

Replace the `<Result … />` element with:
```tsx
      <Result
        rounds={rounds}
        code={code}
        me={me}
        partner={partner}
        partnerHere={Boolean(partner?.connected)}
        canRetake={Boolean(partner?.connected) && room.state.phase === 'ready' && sync.synced && rtc.channelOpen}
        onReady={(ready) => {
          if (ready) sync.burst(SYNC_BURST_READY)
          room.send({ type: ready ? 'ready' : 'unready' })
        }}
      />
```
and add, with the other effects (photos live only in memory, so warn before a reload or tab close loses them):
```tsx
  useEffect(() => {
    if (rounds.length === 0) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [rounds.length])
```
Remove the now-unused `slot`/`mySlot` usages that only fed the old `Result` if lint flags them (`mySlot` is still used for `me`/`partner`).

- [ ] **Step 5: Replace `e2e/photos.spec.ts`'s first test, add strip/download tests**

In `e2e/photos.spec.ts` replace the first test (`'each person ends up holding both photos'`) with:
```ts
test('each person gets a photo strip with both photos, and can download it as PNG and JPG', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)

  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
    const strip = page.getByRole('img', { name: 'Photo strip' })
    await expect(strip).toBeVisible()
    expect(await strip.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1800])
  }

  const [pngDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(pngDownload.suggestedFilename()).toMatch(/^two-up-[A-HJ-KM-NP-Z2-9]{6}-1\.png$/)

  await a.getByRole('radio', { name: 'JPG' }).click()
  const [jpgDownload] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(jpgDownload.suggestedFilename()).toMatch(/\.jpg$/)
})

test('horizontal layout changes the strip size; grid unlocks after a second round', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByRole('img', { name: 'Photo strip' })).toBeVisible({ timeout: 30_000 })
  await expect(a.getByRole('radio', { name: 'GRID' })).toBeDisabled()

  await a.getByRole('radio', { name: 'HORIZONTAL' }).click()
  await expect
    .poll(() => a.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBe(2064)

  await a.getByRole('button', { name: 'RETAKE' }).click()
  await b.getByRole('button', { name: 'RETAKE' }).click()
  await expect(a.getByRole('radio', { name: 'GRID' })).toBeEnabled({ timeout: 30_000 })
  await a.getByRole('radio', { name: 'GRID' }).click()
  await expect
    .poll(() => a.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]))
    .toEqual([2064, 1800])
})

test('the strip stays downloadable after the partner leaves', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByRole('img', { name: 'Photo strip' })).toBeVisible({ timeout: 30_000 })
  await b.close()
  await expect(a.getByText(/THEY LEFT/)).toBeVisible()
  await expect(a.getByRole('button', { name: 'DOWNLOAD PHOTO' })).toBeEnabled()
})
```
In the existing `capture.spec.ts` "second round" test, the Task 18 edits (RETAKE button) stay as they are.

- [ ] **Step 6: Phase gate**

Run: `npm run check && npm run test:e2e`
Expected: unit + worker + all e2e specs (connect, capture, photos) green. Triage: strip size wrong → compare against `layoutStrip` numbers; blank/black frames → `renderStrip` ran before fonts/bitmaps (check `await document.fonts.load`); download event never fires → the button is disabled until `canvas` exists, so `await expect(strip).toBeVisible()` first.

- [ ] **Step 7: Commit**

```bash
git add src/client e2e
git commit -m "feat: compose and download the photo strip with vertical, horizontal and grid layouts"
```

**Phase 3 gate reached.**
