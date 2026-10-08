import { useMemo, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { TemplateId } from '../../shared/plan'
import { BackgroundPicker } from '../components/BackgroundPicker'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalModal } from '../components/BrutalModal'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { useToast } from '../components/BrutalToast'
import type { ConnKind } from '../components/ConnectionStatus'
import { FilterPicker } from '../components/FilterPicker'
import { PhotoStrip } from '../components/PhotoStrip'
import { PhotoThumb } from '../components/PhotoThumb'
import { Steps } from '../components/Steps'
import { useCutouts } from '../hooks/useCutouts'
import { useStrip } from '../hooks/useStrip'
import type { BackgroundId } from '../lib/backgrounds'
import type { FilterId } from '../lib/filters'
import { canvasToBlob } from '../lib/photo'
import { downloadBlob, formatStripDate, shareImage } from '../lib/strip'
import type { CellBlobs } from '../lib/takes'

interface Props {
  code: string
  status: ConnKind
  template: TemplateId
  cells: readonly CellBlobs[]
  partnerHere: boolean
  /** Retaking needs the partner present and no round in flight. */
  canRetake: boolean
  onRetake: (cell: number) => void
  /** Shown above the strip when the partner changed the plan while you were looking at it. */
  notice?: { text: string; action: string; onAction: () => void }
}

export function Result({ code, status, template, cells, partnerHere, canRetake, onRetake, notice }: Props) {
  const toast = useToast()
  const [filter, setFilter] = useState<FilterId>('original')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [confirming, setConfirming] = useState<number | null>(null)
  const [background, setBackground] = useState<BackgroundId>('none')
  const [attempt, setAttempt] = useState(0) // bumped to retry the cutouts after a failure
  const meta = useMemo(() => ({ code, filter, dateLabel: formatStripDate(new Date()) }), [code, filter])
  const hasTogether = cells.some((c) => c.kind === 'both')
  const wantsCutout = background !== 'none' && hasTogether
  const cut = useCutouts(cells, wantsCutout, attempt)
  const scene = wantsCutout && cut.status === 'ready' ? background : null // `wantsCutout` already rules out 'none'
  const { url, canvas, error } = useStrip(cells, template, meta, scene, cut.byKey)
  const filename = `${APP_NAME.toLowerCase()}-${code}-${template}.${format}`

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
      <Steps stage="done" />
      <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter">LOOK WHAT YOU MADE.</h1>
      {notice && (
        <BrutalCard tone="orange" className="flex flex-col gap-3 p-3" role="status">
          <p className="text-lg font-black uppercase">{notice.text}</p>
          <BrutalButton tone="ink" onClick={notice.onAction}>
            {notice.action}
          </BrutalButton>
        </BrutalCard>
      )}
      {!partnerHere && (
        <BrutalCard tone="orange" className="p-3 text-lg font-black uppercase" role="status">
          THEY LEFT :( SAVE YOUR STRIP BEFORE YOU GO.
        </BrutalCard>
      )}

      <PhotoStrip url={url} error={error} />

      <BrutalCard heavy className="flex flex-col gap-5 p-4">
        {hasTogether && (
          <div className="flex flex-col gap-2">
            <BackgroundPicker
              value={background}
              onChange={(id) => {
                setBackground(id)
                if (cut.status === 'failed') setAttempt((n) => n + 1) // choosing again after a failure is a retry
              }}
            />
            {cut.status === 'loading' && (
              <p role="status" className="text-sm font-black uppercase">
                CUTTING YOU OUT…
              </p>
            )}
            {cut.status === 'failed' && (
              <p role="status" className="border-[3px] border-ink bg-orange p-2 text-sm font-black uppercase">
                COULDN'T CUT YOU OUT. SHOWING SIDE BY SIDE.
              </p>
            )}
            <p className="text-xs font-black uppercase">CUTOUTS ARE MADE ON YOUR DEVICE.</p>
          </div>
        )}
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

      <BrutalCard tone="lime" heavy className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-black uppercase leading-none">NOT HAPPY WITH A CELL?</h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
          {cells.map((cell, i) => (
            <li key={`${i}-${cell.round}`} className="flex flex-col gap-2">
              <PhotoThumb kind={cell.kind} a={cell.a} b={cell.b} />
              <BrutalButton tone="paper" disabled={!canRetake} onClick={() => setConfirming(i)}>
                {`RETAKE ${i + 1}`}
              </BrutalButton>
            </li>
          ))}
        </ul>
      </BrutalCard>

      <BrutalModal open={confirming !== null} onClose={() => setConfirming(null)} title="Retake this cell?">
        <p className="font-black uppercase leading-snug">THIS REPLACES CELL {(confirming ?? 0) + 1}.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <BrutalButton tone="lime" onClick={() => setConfirming(null)}>
            KEEP IT
          </BrutalButton>
          <BrutalButton
            tone="pink"
            onClick={() => {
              if (confirming !== null) onRetake(confirming)
              setConfirming(null)
            }}
          >
            YES, RETAKE
          </BrutalButton>
        </div>
      </BrutalModal>
    </main>
  )
}
