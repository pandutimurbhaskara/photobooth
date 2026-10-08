import type { ReactNode } from 'react'
import type { PState } from '../../shared/protocol'
import { BrutalBadge } from '../components/BrutalBadge'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'

interface Props {
  heading: string
  /** Button text before / after you press it. Defaults are the shoot stage's. */
  idleLabel?: string
  doneLabel?: string
  me: PState | null
  partner: PState | null
  canReady: boolean
  onReady: (ready: boolean) => void
  canFlip?: boolean
  onFlip?: () => void
  children?: ReactNode
}

/** The "both of us agree" card: two badges and one big button. Used to start a take and to confirm a pick. */
export function ReadyCard({ heading, idleLabel = "I'M READY", doneLabel = 'READY ✓', me, partner, canReady, onReady, canFlip, onFlip, children }: Props) {
  const iAmReady = me?.ready ?? false
  return (
    <BrutalCard tone="yellow" heavy className="sticky bottom-2 flex flex-col gap-3 p-4">
      <h2 className="text-2xl font-black uppercase leading-none">{heading}</h2>
      <div className="flex flex-wrap gap-2">
        <BrutalBadge tone={iAmReady ? 'lime' : 'paper'}>YOU {iAmReady ? 'READY ✓' : 'NOT READY'}</BrutalBadge>
        <BrutalBadge tone={partner?.ready ? 'lime' : 'paper'}>THEM {partner?.ready ? 'READY ✓' : 'WAITING...'}</BrutalBadge>
      </div>
      <BrutalButton tone={iAmReady ? 'lime' : 'ink'} size="xl" disabled={!canReady} onClick={() => onReady(!iAmReady)}>
        {iAmReady ? doneLabel : idleLabel}
      </BrutalButton>
      {canFlip && onFlip && (
        <BrutalButton tone="paper" onClick={onFlip}>
          FLIP CAMERA
        </BrutalButton>
      )}
      {children}
    </BrutalCard>
  )
}
