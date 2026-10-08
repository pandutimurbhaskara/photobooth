import type { ReactNode, RefObject } from 'react'
import type { Plan, PlanAction } from '../../shared/plan'
import type { PState, SlotName } from '../../shared/protocol'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { CameraFrame } from '../components/CameraFrame'
import type { ConnKind } from '../components/ConnectionStatus'
import { Countdown } from '../components/Countdown'
import { Steps } from '../components/Steps'
import { FormatPanel } from './FormatPanel'
import type { TakeStore } from '../lib/takes'
import { PickPanel } from './PickPanel'
import { ReadyCard } from './ReadyCard'

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
  plan: Plan
  store: TakeStore
  mySlot: SlotName | null
  /** Plan actions are accepted right now: two people present and no round in flight. */
  canEdit: boolean
  onPlan: (action: PlanAction) => void
  /** The plan points at photos this tab does not hold (it was reloaded). */
  lostPhotos: boolean
  onStartOver: () => void
}

export function Stage(p: Props) {
  const takeNo = (p.plan.takes[p.plan.cell]?.length ?? 0) + 1
  const noTakesYet = p.plan.takes.every((t) => t.length === 0)

  const ready = (heading: string, extra?: ReactNode, labels?: { idle: string; done: string }) => (
    <ReadyCard
      heading={heading}
      idleLabel={labels?.idle}
      doneLabel={labels?.done}
      me={p.me}
      partner={p.partner}
      canReady={p.canReady}
      onReady={p.onReady}
      canFlip={p.canFlip}
      onFlip={p.onFlip}
    >
      {extra}
    </ReadyCard>
  )

  function panel(): ReactNode {
    switch (p.plan.stage) {
      case 'format':
        return (
          <FormatPanel plan={p.plan} mySlot={p.mySlot} canEdit={p.canEdit} onPlan={p.onPlan}>
            {ready('BOTH READY?')}
          </FormatPanel>
        )
      case 'shoot':
        return ready(
          `CELL ${p.plan.cell + 1} OF ${p.plan.kinds.length} · TAKE ${takeNo}`,
          noTakesYet ? (
            <BrutalButton tone="paper" disabled={!p.canEdit} onClick={() => p.onPlan({ k: 'reset' })}>
              CHANGE FORMAT
            </BrutalButton>
          ) : null,
        )
      case 'pick':
        return (
          <PickPanel plan={p.plan} store={p.store} canEdit={p.canEdit} onPlan={p.onPlan}>
            {ready('SAME PICK FOR BOTH?', null, { idle: 'KEEP THIS ONE', done: 'KEPT ✓' })}
          </PickPanel>
        )
      default:
        return ready('BOTH READY?')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={p.code} status={p.status} hasPhotos={p.hasPhotos} />
      <Steps stage={p.plan.stage} />

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
      ) : p.lostPhotos ? (
        <BrutalCard tone="orange" heavy className="flex flex-col gap-3 p-4" role="alert">
          <p className="text-xl font-black uppercase leading-snug">YOUR PHOTOS WERE LOST WHEN THIS PAGE RELOADED</p>
          <p className="text-sm font-black uppercase">THEY LIVE ONLY IN THE TAB THEY WERE TAKEN IN. START OVER TO MAKE A NEW STRIP.</p>
          <BrutalButton tone="ink" onClick={p.onStartOver}>
            START OVER
          </BrutalButton>
        </BrutalCard>
      ) : (
        panel()
      )}
    </main>
  )
}
