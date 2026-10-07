import { useEffect, useState } from 'react'
import { countdownLabel, type CountdownLabel } from '../lib/capture'

interface Props {
  captureAt: number
  now: () => number
  onDone: () => void
}

const SHOW_SNAP_MS = 1200

/** Overlay for a `relative` parent. The numerals are derived from the shared timestamp; the capture does not wait for them. */
export function Countdown({ captureAt, now, onDone }: Props) {
  const [label, setLabel] = useState<CountdownLabel>(() => countdownLabel(captureAt - now()))

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const remaining = captureAt - now()
      if (remaining < -SHOW_SNAP_MS) {
        onDone()
        return
      }
      setLabel(countdownLabel(remaining))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [captureAt, now, onDone])

  return (
    <div data-testid="countdown" role="status" aria-live="assertive" className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
      {label === 'get-ready' ? (
        <p key="get-ready" className="animate-pop border-4 border-ink bg-lime px-5 py-3 text-center text-2xl font-black uppercase shadow-brutal sm:text-4xl">
          BOTH READY. GET READY.
        </p>
      ) : (
        <p
          key={String(label)}
          className={`animate-pop select-none font-black leading-none text-yellow [-webkit-text-stroke:8px_#0a0a0a] [paint-order:stroke_fill] ${
            label === 'snap' ? 'text-[clamp(5rem,24vw,13rem)]' : 'text-[clamp(7rem,38vw,20rem)]'
          }`}
        >
          {label === 'snap' ? 'SNAP!' : label}
        </p>
      )}
    </div>
  )
}
