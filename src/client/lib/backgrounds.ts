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
