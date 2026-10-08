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
