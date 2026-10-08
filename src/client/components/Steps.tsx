import type { Stage } from '../../shared/plan'
import { STEPS, stepIndex } from '../lib/labels'

/** Where you are in the session: FORMAT → SHOOT → PICK → STYLE. Flat chips; the current one is solid ink. */
export function Steps({ stage }: { stage: Stage }) {
  const current = stepIndex(stage)
  return (
    <ol aria-label="Progress" className="m-0 flex list-none gap-2 p-0">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === current ? 'step' : undefined}
          className={`flex-1 border-[3px] border-ink px-2 py-1 text-center text-xs font-black uppercase ${
            i === current ? 'bg-ink text-white' : i < current ? 'bg-lime text-ink' : 'bg-paper text-ink'
          }`}
        >
          {i < current ? '✓ ' : ''}
          {label}
        </li>
      ))}
    </ol>
  )
}
