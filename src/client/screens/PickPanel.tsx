import type { ReactNode } from 'react'
import { MAX_TAKES } from '../../shared/constants'
import type { Plan, PlanAction } from '../../shared/plan'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { PhotoThumb } from '../components/PhotoThumb'
import type { TakeStore } from '../lib/takes'

interface Props {
  plan: Plan
  store: TakeStore
  canEdit: boolean
  onPlan: (action: PlanAction) => void
  /** The ready card ("KEEP THIS ONE"), rendered under the takes. */
  children: ReactNode
}

export function PickPanel({ plan, store, canEdit, onPlan, children }: Props) {
  const rounds = plan.takes[plan.cell] ?? []
  const kind = plan.kinds[plan.cell] ?? 'both'
  const kept = plan.kept[plan.cell] ?? null
  return (
    <div className="flex flex-col gap-4">
      <BrutalCard heavy className="flex flex-col gap-4 p-4">
        <h2 className="text-2xl font-black uppercase leading-none">
          CELL {plan.cell + 1}: PICK THE BEST
        </h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
          {rounds.map((round, i) => {
            const chosen = kept === round
            const photos = store.get(round)
            return (
              <li key={round}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  aria-label={`Take ${i + 1}${chosen ? ', kept' : ''}`}
                  disabled={!canEdit}
                  onClick={() => onPlan({ k: 'keep', round })}
                  className={`block w-full border-[3px] border-ink p-1 shadow-brutal-sm disabled:opacity-60 ${chosen ? 'bg-pink' : 'bg-paper'}`}
                >
                  <PhotoThumb kind={kind} a={photos?.a} b={photos?.b} />
                  <span className="mt-1 block text-sm font-black uppercase">
                    TAKE {i + 1}
                    {chosen ? ' ✓' : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
        <BrutalButton tone="paper" disabled={!canEdit || rounds.length >= MAX_TAKES} onClick={() => onPlan({ k: 'more' })}>
          ONE MORE TAKE
        </BrutalButton>
      </BrutalCard>
      {children}
    </div>
  )
}
