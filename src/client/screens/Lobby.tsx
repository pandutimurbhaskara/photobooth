import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalBadge } from '../components/BrutalBadge'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalModal } from '../components/BrutalModal'
import { useToast } from '../components/BrutalToast'
import { CameraFrame } from '../components/CameraFrame'
import type { ConnKind } from '../components/ConnectionStatus'
import { RoomCode } from '../components/RoomCode'

interface Props {
  code: string
  shareUrl: string
  status: ConnKind
  hasPhotos: boolean
  stream: MediaStream | null
  mirrored: boolean
  canFlip: boolean
  onFlip: () => void
  /** True when someone was here and has gone: shows the brief's THEY LEFT :( copy above the wait message. */
  partnerLeft: boolean
}

export function Lobby({ code, shareUrl, status, hasPhotos, stream, mirrored, canFlip, onFlip, partnerLeft }: Props) {
  const toast = useToast()
  const [qrOpen, setQrOpen] = useState(false)
  const [qr, setQr] = useState<string | null>(null)

  useEffect(() => {
    if (!qrOpen || qr) return
    void QRCode.toDataURL(shareUrl, { margin: 1, width: 360, color: { dark: '#0a0a0a', light: '#ffffff' } }).then(setQr)
  }, [qrOpen, qr, shareUrl])

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast('LINK COPIED')
    } catch {
      toast('COPY FAILED. SELECT THE LINK.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={code} status={status} hasPhotos={hasPhotos} />
      <BrutalCard tone="lime" heavy className="flex flex-col gap-4 p-5">
        <h1 className="text-xl font-black uppercase">YOUR BOOTH</h1>
        <RoomCode code={code} />
        <p className="text-sm font-black uppercase tracking-widest">SHARE THIS CODE</p>
        <input
          readOnly
          value={shareUrl}
          aria-label="Booth link"
          onFocus={(e) => e.currentTarget.select()}
          className="w-full border-[3px] border-ink bg-white px-3 py-3 text-sm font-bold"
        />
        <div className="flex flex-wrap gap-3">
          <BrutalButton tone="yellow" onClick={() => void copy()}>
            COPY LINK
          </BrutalButton>
          <BrutalButton tone="paper" onClick={() => setQrOpen(true)}>
            QR CODE
          </BrutalButton>
        </div>
        {partnerLeft && (
          <BrutalCard tone="orange" className="p-3" role="status">
            <p className="text-2xl font-black uppercase leading-none">THEY LEFT :(</p>
            <p className="font-black uppercase">WAITING FOR THEM TO COME BACK.</p>
          </BrutalCard>
        )}
        <p className="animate-pop text-2xl font-black uppercase leading-tight">WAITING FOR YOUR PERSON...</p>
        <div className="flex gap-2">
          <BrutalBadge tone="lime">● YOU</BrutalBadge>
          <BrutalBadge tone="paper">○ THEM</BrutalBadge>
        </div>
      </BrutalCard>

      <CameraFrame stream={stream} label="YOU" mirrored={mirrored} testId="local-video" accent="pink" />
      {canFlip && (
        <BrutalButton tone="paper" onClick={onFlip}>
          FLIP CAMERA
        </BrutalButton>
      )}

      <BrutalModal open={qrOpen} onClose={() => setQrOpen(false)} title="Scan to join">
        {qr ? (
          <img src={qr} alt="QR code for this booth" className="mx-auto block w-full max-w-72 border-4 border-ink" />
        ) : (
          <p className="font-black uppercase">DRAWING...</p>
        )}
      </BrutalModal>
    </main>
  )
}
