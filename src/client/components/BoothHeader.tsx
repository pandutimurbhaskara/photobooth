import { useState } from 'react'
import { useNavigate } from 'react-router'
import { formatRoomCode } from '../../shared/room-code'
import { BrutalButton } from './BrutalButton'
import { BrutalModal } from './BrutalModal'
import { ConnectionStatus, type ConnKind } from './ConnectionStatus'

interface Props {
  code: string
  status: ConnKind
  /** Photos live only in this tab; leaving without saving loses them, so EXIT asks first. */
  hasPhotos: boolean
}

export function BoothHeader({ code, status, hasPhotos }: Props) {
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2 border-4 border-ink bg-paper px-3 py-2 shadow-brutal">
        <p className="text-lg font-black uppercase tracking-tight">BOOTH {formatRoomCode(code)}</p>
        <ConnectionStatus kind={status} />
        <BrutalButton tone="paper" onClick={() => (hasPhotos ? setConfirming(true) : void navigate('/'))}>
          EXIT
        </BrutalButton>
      </header>
      <BrutalModal open={confirming} onClose={() => setConfirming(false)} title="Leave the booth?">
        <p className="font-black uppercase leading-snug">YOUR PHOTOS LIVE ONLY IN THIS TAB. DOWNLOAD THE STRIP FIRST.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <BrutalButton tone="lime" onClick={() => setConfirming(false)}>
            STAY
          </BrutalButton>
          <BrutalButton tone="pink" onClick={() => void navigate('/')}>
            LEAVE ANYWAY
          </BrutalButton>
        </div>
      </BrutalModal>
    </>
  )
}
