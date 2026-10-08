import type { RefObject } from 'react'
import type { PState } from '../../shared/protocol'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalBadge } from '../components/BrutalBadge'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { CameraFrame } from '../components/CameraFrame'
import type { ConnKind } from '../components/ConnectionStatus'
import { Countdown } from '../components/Countdown'

interface Props {
  code: string
  status: ConnKind
  hasPhotos: boolean
  stream: MediaStream | null
  mirrored: boolean
  remoteStream: MediaStream | null
  remoteMirrored: boolean
  localVideoRef: RefObject<HTMLVideoElement | null>
  me: PState | null
  partner: PState | null
  canReady: boolean
  onReady: (ready: boolean) => void
  countdown: { captureAt: number } | null
  now: () => number
  onCountdownDone: () => void
  missed: boolean
  roundFailed: boolean
  exchanging: boolean
  captured: boolean
  canFlip: boolean
  onFlip: () => void
}

export function Stage(p: Props) {
  const iAmReady = p.me?.ready ?? false
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={p.code} status={p.status} hasPhotos={p.hasPhotos} />

      <div className="relative">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="md:order-2">
            <CameraFrame stream={p.remoteStream} label="THEM" mirrored={p.remoteMirrored} testId="remote-video" accent="blue" />
          </div>
          <div className="md:order-1">
            <CameraFrame stream={p.stream} label="YOU" mirrored={p.mirrored} testId="local-video" videoRef={p.localVideoRef} accent="pink" />
          </div>
        </div>
        {p.countdown && <Countdown captureAt={p.countdown.captureAt} now={p.now} onDone={p.onCountdownDone} />}
      </div>

      {p.missed && (
        <BrutalCard tone="orange" role="alert" className="p-3 text-lg font-black uppercase">
          MISSED IT. TRY AGAIN IN A MOMENT.
        </BrutalCard>
      )}

      {p.roundFailed && !p.exchanging && (
        <BrutalCard tone="orange" role="status" className="p-3 text-lg font-black uppercase">
          THAT ROUND DIDN'T WORK. GO AGAIN.
        </BrutalCard>
      )}

      {p.countdown ? (
        <BrutalCard tone="yellow" heavy className="p-4 text-center text-2xl font-black uppercase">
          HOLD STILL. THIS ONE'S GOOD.
        </BrutalCard>
      ) : p.exchanging ? (
        <BrutalCard tone="paper" heavy className="p-4 text-center text-xl font-black uppercase" role="status">
          {p.captured ? 'YOU CAPTURED ✓ · ' : ''}WAITING FOR THE PHOTOS...
        </BrutalCard>
      ) : (
        <BrutalCard tone="yellow" heavy className="sticky bottom-2 flex flex-col gap-3 p-4">
          <h2 className="text-2xl font-black uppercase leading-none">BOTH READY?</h2>
          <div className="flex flex-wrap gap-2">
            <BrutalBadge tone={iAmReady ? 'lime' : 'paper'}>YOU {iAmReady ? 'READY ✓' : 'NOT READY'}</BrutalBadge>
            <BrutalBadge tone={p.partner?.ready ? 'lime' : 'paper'}>THEM {p.partner?.ready ? 'READY ✓' : 'WAITING...'}</BrutalBadge>
          </div>
          <BrutalButton tone={iAmReady ? 'lime' : 'ink'} size="xl" disabled={!p.canReady} onClick={() => p.onReady(!iAmReady)}>
            {iAmReady ? 'READY ✓' : "I'M READY"}
          </BrutalButton>
          {p.canFlip && (
            <BrutalButton tone="paper" onClick={p.onFlip}>
              FLIP CAMERA
            </BrutalButton>
          )}
        </BrutalCard>
      )}
    </main>
  )
}
