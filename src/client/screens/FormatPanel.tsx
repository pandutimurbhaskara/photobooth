import type { ReactNode } from 'react'
import { CELL_KINDS, TEMPLATE_IDS, type Plan, type PlanAction } from '../../shared/plan'
import type { SlotName } from '../../shared/protocol'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { TemplateDiagram } from '../components/TemplateDiagram'
import { kindLabel, TEMPLATE_LABEL } from '../lib/labels'

interface Props {
  plan: Plan
  mySlot: SlotName | null
  /** Plan actions are accepted (two people present, no round in flight). */
  canEdit: boolean
  onPlan: (action: PlanAction) => void
  /** The ready card, rendered under the pickers. */
  children: ReactNode
}

export function FormatPanel({ plan, mySlot, canEdit, onPlan, children }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <BrutalCard heavy className="flex flex-col gap-4 p-4">
        <h2 className="text-2xl font-black uppercase leading-none">PICK A FORMAT</h2>
        <p className="text-sm font-black uppercase">EITHER OF YOU CAN CHOOSE.</p>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-xs font-black uppercase tracking-[0.2em]">Format</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {TEMPLATE_IDS.map((id) => (
              <label key={id} className="relative">
                <input
                  type="radio"
                  name="template"
                  value={id}
                  checked={plan.template === id}
                  disabled={!canEdit}
                  onChange={() => onPlan({ k: 'template', template: id })}
                  className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
                <span className="flex h-full flex-col items-center gap-2 border-[3px] border-ink bg-paper p-3 text-center shadow-brutal-sm peer-checked:bg-yellow peer-disabled:opacity-60 peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-[3px] peer-focus-visible:outline-ink">
                  <TemplateDiagram template={id} />
                  <span className="text-lg font-black uppercase leading-none">{TEMPLATE_LABEL[id].title}</span>
                  <span className="text-xs font-black uppercase">{TEMPLATE_LABEL[id].sub}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {plan.template &&
          plan.kinds.map((kind, i) => (
            <BrutalRadioGroup
              key={`${plan.template}-${i}`}
              legend={`Cell ${i + 1}`}
              name={`cell-${i}`}
              value={kind}
              onChange={(next) => onPlan({ k: 'kind', cell: i, kind: next })}
              options={CELL_KINDS.map((k) => ({ value: k, label: kindLabel(k, mySlot), disabled: !canEdit }))}
            />
          ))}
      </BrutalCard>
      {children}
    </div>
  )
}
