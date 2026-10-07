import { useMemo, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { PState } from '../../shared/protocol'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalBadge } from '../components/BrutalBadge'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { useToast } from '../components/BrutalToast'
import type { ConnKind } from '../components/ConnectionStatus'
import { FilterPicker } from '../components/FilterPicker'
import { PhotoStrip } from '../components/PhotoStrip'
import { useStrip } from '../hooks/useStrip'
import type { FilterId } from '../lib/filters'
import { canvasToBlob, type StripLayout } from '../lib/photo'
import { stripBlobs, type Round } from '../lib/rounds'
import { downloadBlob, formatStripDate, shareImage } from '../lib/strip'

interface Props {
  code: string
  status: ConnKind
  rounds: Round[]
  me: PState | null
  partner: PState | null
  partnerHere: boolean
  canRetake: boolean
  onReady: (ready: boolean) => void
}

export function Result({ code, status, rounds, me, partner, partnerHere, canRetake, onReady }: Props) {
  const toast = useToast()
  const [layout, setLayout] = useState<StripLayout>('vertical')
  const [filter, setFilter] = useState<FilterId>('original')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const latest = rounds[rounds.length - 1]
  const blobs = useMemo(() => stripBlobs(layout, rounds), [layout, rounds])
  const meta = useMemo(
    () => ({ code, filter, dateLabel: formatStripDate(new Date()), seed: `${code}:${latest?.round ?? 0}` }),
    [code, filter, latest?.round],
  )
  const { url, canvas, error } = useStrip(blobs, layout, meta)
  const iAmReady = me?.ready ?? false
  const filename = `${APP_NAME.toLowerCase()}-${code}-${latest?.round ?? 0}.${format}`

  async function encode(): Promise<Blob | null> {
    return canvas ? canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.92) : null
  }
  async function download() {
    const blob = await encode()
    if (blob) downloadBlob(blob, filename)
  }
  async function share() {
    const blob = await encode()
    if (!blob) return
    if ((await shareImage(blob, filename, 'Made in the booth.')) === 'unsupported') {
      downloadBlob(blob, filename)
      toast('PHOTO SAVED.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={code} status={status} hasPhotos />
      <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter">LOOK WHAT YOU MADE.</h1>
      {!partnerHere && (
        <BrutalCard tone="orange" className="p-3 text-lg font-black uppercase" role="status">
          THEY LEFT :( SAVE YOUR STRIP BEFORE YOU GO.
        </BrutalCard>
      )}

      <PhotoStrip url={url} error={error} />

      <BrutalCard heavy className="flex flex-col gap-5 p-4">
        <BrutalRadioGroup
          legend="Layout"
          name="layout"
          value={layout}
          onChange={setLayout}
          options={[
            { value: 'vertical', label: 'VERTICAL' },
            { value: 'horizontal', label: 'HORIZONTAL' },
            { value: 'grid', label: 'GRID', disabled: rounds.length < 2 },
          ]}
        />
        <FilterPicker value={filter} onChange={setFilter} />
        <BrutalRadioGroup
          legend="File type"
          name="format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
          ]}
        />
      </BrutalCard>

      <BrutalButton tone="yellow" size="xl" className="w-full" disabled={!canvas} onClick={() => void download()}>
        DOWNLOAD PHOTO
      </BrutalButton>
      <BrutalButton tone="pink" className="w-full" disabled={!canvas} onClick={() => void share()}>
        SHARE
      </BrutalButton>

      {partnerHere && (
        <BrutalCard tone="lime" heavy className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap gap-2">
            <BrutalBadge tone={iAmReady ? 'ink' : 'paper'}>YOU {iAmReady ? 'READY ✓' : 'NOT READY'}</BrutalBadge>
            <BrutalBadge tone={partner?.ready ? 'ink' : 'paper'}>THEM {partner?.ready ? 'READY ✓' : 'WAITING...'}</BrutalBadge>
          </div>
          <BrutalButton tone="ink" disabled={!canRetake} onClick={() => onReady(!iAmReady)}>
            {iAmReady ? 'READY ✓' : 'RETAKE'}
          </BrutalButton>
        </BrutalCard>
      )}
    </main>
  )
}
