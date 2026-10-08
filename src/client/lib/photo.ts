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
  // A backgrounded tab, a revoked permission or another app taking the camera leaves a frozen or black frame that
  // still has dimensions, so also require the track itself to be live and unmuted.
  const stream = video.srcObject as { getVideoTracks?: () => Array<{ readyState: string; muted: boolean }> } | null
  const track = stream?.getVideoTracks?.()[0]
  if (track && (track.readyState !== 'live' || track.muted)) throw new FrameNotReadyError()
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
