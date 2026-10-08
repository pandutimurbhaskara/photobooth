import { useMemo, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { TemplateId } from '../../shared/plan'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { useToast } from '../components/BrutalToast'
import type { ConnKind } from '../components/ConnectionStatus'
import { FilterPicker } from '../components/FilterPicker'
import { PhotoStrip } from '../components/PhotoStrip'
import { useStrip } from '../hooks/useStrip'
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
}

export function Result({ code, status, template, cells, partnerHere }: Props) {
  const toast = useToast()
  const [filter, setFilter] = useState<FilterId>('original')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const meta = useMemo(() => ({ code, filter, dateLabel: formatStripDate(new Date()) }), [code, filter])
  const { url, canvas, error } = useStrip(cells, template, meta)
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
      <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter">LOOK WHAT YOU MADE.</h1>
      {!partnerHere && (
        <BrutalCard tone="orange" className="p-3 text-lg font-black uppercase" role="status">
          THEY LEFT :( SAVE YOUR STRIP BEFORE YOU GO.
        </BrutalCard>
      )}

      <PhotoStrip url={url} error={error} />

      <BrutalCard heavy className="flex flex-col gap-5 p-4">
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
    </main>
  )
}
