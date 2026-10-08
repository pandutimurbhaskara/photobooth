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
