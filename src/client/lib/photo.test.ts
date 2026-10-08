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

  // Final review I3: a backgrounded tab or a revoked permission leaves a frozen/black frame that still has dimensions.
  describe('a camera track that is no longer delivering live frames', () => {
    const withTrack = (track: { readyState: string; muted: boolean } | null) =>
      ({
        videoWidth: 640,
        videoHeight: 480,
        readyState: 4,
        srcObject: track ? { getVideoTracks: () => [track] } : { getVideoTracks: () => [] },
      }) as unknown as HTMLVideoElement

    it.each([
      ['ended', { readyState: 'ended', muted: false }],
      ['muted (backgrounded / taken by another app)', { readyState: 'live', muted: true }],
    ])('refuses to capture from a %s track', async (_name, track) => {
      await expect(captureFrame(withTrack(track), { mirrored: false }, (w, h) => fakeCanvas(w, h))).rejects.toBeInstanceOf(
        FrameNotReadyError,
      )
    })

    it('captures from a live, unmuted track (and when the video has no stream object to inspect)', async () => {
      const live = await captureFrame(withTrack({ readyState: 'live', muted: false }), { mirrored: false }, (w, h) => fakeCanvas(w, h))
      expect(live.type).toBe('image/jpeg')
      const none = await captureFrame(withTrack(null), { mirrored: false }, (w, h) => fakeCanvas(w, h))
      expect(none.type).toBe('image/jpeg')
    })
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
