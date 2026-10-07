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
