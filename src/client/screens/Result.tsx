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
