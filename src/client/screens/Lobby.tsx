import { formatRoomCode } from '../../shared/room-code'
import { CameraFrame } from '../components/CameraFrame'

interface Props {
  code: string
  shareUrl: string
  stream: MediaStream | null
  mirrored: boolean
}

export function Lobby({ code, shareUrl, stream, mirrored }: Props) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 p-6">
      <h1 className="text-xl font-black">YOUR BOOTH</h1>
      <p className="text-6xl font-black tracking-widest">
        <span className="sr-only">Room code {code.split('').join(' ')}</span>
        <span aria-hidden="true">{formatRoomCode(code)}</span>
      </p>
      <p className="break-all text-sm font-bold">{shareUrl}</p>
      <p className="font-black">WAITING FOR YOUR PERSON...</p>
      <CameraFrame stream={stream} label="YOU" mirrored={mirrored} testId="local-video" />
    </main>
  )
}
