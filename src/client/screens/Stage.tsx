import type { RefObject } from 'react'
import type { PState } from '../../shared/protocol'
import { CameraFrame } from '../components/CameraFrame'
import { Countdown } from '../components/Countdown'
import type { PeerState } from '../lib/webrtc'

interface Props {
  stream: MediaStream | null
  mirrored: boolean
  remoteStream: MediaStream | null
  remoteMirrored: boolean
  peerState: PeerState
  localVideoRef: RefObject<HTMLVideoElement | null>
  me: PState | null
  partner: PState | null
  canReady: boolean
  onReady: (ready: boolean) => void
  countdown: { captureAt: number } | null
  now: () => number
  onCountdownDone: () => void
  missed: boolean
}

export function Stage(p: Props) {
  const iAmReady = p.me?.ready ?? false
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4">
      <p className="font-black">{p.peerState === 'connected' ? '● CONNECTED' : '● CONNECTING'}</p>
      <div className="grid gap-4 md:grid-cols-2">
        <CameraFrame stream={p.remoteStream} label="THEM" mirrored={p.remoteMirrored} testId="remote-video" />
        <CameraFrame stream={p.stream} label="YOU" mirrored={p.mirrored} testId="local-video" videoRef={p.localVideoRef} />
      </div>

      {p.missed && (
        <p role="alert" className="font-black">
          MISSED IT. TRY AGAIN IN A MOMENT.
        </p>
      )}

      {p.countdown ? (
        <Countdown captureAt={p.countdown.captureAt} now={p.now} onDone={p.onCountdownDone} />
      ) : (
        <section className="flex flex-col gap-2">
          <p className="font-black">
            YOU {iAmReady ? 'READY ✓' : 'NOT READY'} · THEM {p.partner?.ready ? 'READY ✓' : 'WAITING...'}
          </p>
          <button
            type="button"
            disabled={!p.canReady}
            onClick={() => p.onReady(!iAmReady)}
            className="border-4 border-black px-4 py-4 text-xl font-black disabled:opacity-50"
          >
            {iAmReady ? 'READY ✓' : "I'M READY"}
          </button>
        </section>
      )}
    </main>
  )
}
