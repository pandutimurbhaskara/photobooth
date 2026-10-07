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
