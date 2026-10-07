import { formatRoomCode } from '../../shared/room-code'

export function RoomCode({ code }: { code: string }) {
  return (
    <p className="border-4 border-ink bg-white px-4 py-3 text-center font-black leading-none tracking-[0.12em] shadow-brutal text-[clamp(3.25rem,17vw,7.5rem)]">
      <span className="sr-only">Room code {code.split('').join(' ')}</span>
      <span aria-hidden="true">{formatRoomCode(code)}</span>
    </p>
  )
}
