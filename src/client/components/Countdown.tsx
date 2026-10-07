import { useEffect, useState } from 'react'
import { countdownLabel, type CountdownLabel } from '../lib/capture'

interface Props {
  captureAt: number
  now: () => number
  onDone: () => void
}

const SHOW_SNAP_MS = 1200

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

  const text = label === 'get-ready' ? 'BOTH READY. GET READY.' : label === 'snap' ? 'SNAP!' : String(label)
  return (
    <div data-testid="countdown" aria-live="assertive" className="text-center">
      <p key={String(label)} className="text-8xl font-black">
        {text}
      </p>
      <p className="font-black">HOLD STILL. THIS ONE'S GOOD.</p>
    </div>
  )
}
