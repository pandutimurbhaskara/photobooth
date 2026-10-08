import { MAX_CELLS, MAX_TAKES, MIN_TAKES } from './constants'

// The shared "booth plan" (spec §3). Pure and import-free of anything browser- or worker-specific, so the Durable
// Object and the client apply the same rules and the rules are unit-testable without either.

export const TEMPLATE_IDS = ['strip4', 'grid4', 'duo2', 'polaroid'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** Grid shape of every template. Strip geometry (client) and cell counts (server) both read this one table. */
export const TEMPLATES: Record<TemplateId, { cols: number; rows: number }> = {
  strip4: { cols: 1, rows: 4 },
  grid4: { cols: 2, rows: 2 },
  duo2: { cols: 1, rows: 2 },
  polaroid: { cols: 1, rows: 1 },
}
export const cellsOf = (template: TemplateId): number => TEMPLATES[template].cols * TEMPLATES[template].rows

/** USER 1 (slot a), USER 2 (slot b), or both people cut out together. */
export const CELL_KINDS = ['a', 'b', 'both'] as const
export type CellKind = (typeof CELL_KINDS)[number]
export type Stage = 'format' | 'shoot' | 'pick' | 'done'

export interface Plan {
  /** Bumped on every accepted change. */
  v: number
  stage: Stage
  template: TemplateId | null
  /** One per cell; empty while there is no template. */
  kinds: CellKind[]
  /** The cell being shot or picked. */
  cell: number
  /** Per cell: the rounds whose photos *both* people hold. */
  takes: number[][]
  /** Per cell: the chosen round. */
  kept: Array<number | null>
}

export type PlanAction =
  | { k: 'template'; template: TemplateId }
  | { k: 'kind'; cell: number; kind: CellKind }
  | { k: 'keep'; round: number }
  | { k: 'more' }
  | { k: 'retake'; cell: number }
  | { k: 'reset' }

export const defaultPlan = (): Plan => ({ v: 0, stage: 'format', template: null, kinds: [], cell: 0, takes: [], kept: [] })

const bump = (plan: Plan, change: Partial<Plan>): Plan => ({ ...plan, ...change, v: plan.v + 1 })
const blank = (cells: number) => ({
  takes: Array.from({ length: cells }, (): number[] => []),
  kept: Array.from({ length: cells }, (): number | null => null),
})
const inRange = (plan: Plan, cell: number): boolean => Number.isInteger(cell) && cell >= 0 && cell < plan.kinds.length

/** Apply one person's action. `null` means refused (wrong stage, bad index, a round that is not a take). */
export function applyPlanAction(plan: Plan, action: PlanAction): Plan | null {
  switch (action.k) {
    case 'template': {
      if (plan.stage !== 'format') return null
      const cells = cellsOf(action.template)
      const kinds = Array.from({ length: cells }, (): CellKind => 'both')
      return bump(plan, { template: action.template, kinds, cell: 0, ...blank(cells) })
    }
    case 'kind': {
      if (plan.stage !== 'format' || plan.template === null || !inRange(plan, action.cell)) return null
      const kinds = plan.kinds.slice()
      kinds[action.cell] = action.kind
      return bump(plan, { kinds })
    }
    case 'keep': {
      if (plan.stage !== 'pick' || !(plan.takes[plan.cell] ?? []).includes(action.round)) return null
      const kept = plan.kept.slice()
      kept[plan.cell] = action.round
      return bump(plan, { kept })
    }
    case 'more': {
      if (plan.stage !== 'pick' || (plan.takes[plan.cell] ?? []).length >= MAX_TAKES) return null
      return bump(plan, { stage: 'shoot' })
    }
    case 'retake': {
      if (plan.stage !== 'done' || !inRange(plan, action.cell)) return null
      const takes = plan.takes.map((t) => t.slice())
      takes[action.cell] = []
      const kept = plan.kept.slice()
      kept[action.cell] = null
      return bump(plan, { stage: 'shoot', cell: action.cell, takes, kept })
    }
    case 'reset':
      return bump(plan, { stage: 'format', cell: 0, ...blank(plan.kinds.length) })
  }
}

/** Can READY be pressed at all? Not before a template exists, and not once everything is done. */
export function acceptsReady(plan: Plan): boolean {
  return plan.stage === 'shoot' || plan.stage === 'pick' || (plan.stage === 'format' && plan.template !== null)
}

/** What both people being ready means in this stage. `schedule` = start a capture round. */
export function onBothReady(plan: Plan): { plan: Plan; schedule: boolean } | null {
  switch (plan.stage) {
    case 'format':
      return plan.template === null ? null : { plan: bump(plan, { stage: 'shoot', cell: 0 }), schedule: true }
    case 'shoot':
      return { plan, schedule: true }
    case 'pick':
      return { plan: advance(plan), schedule: false }
    case 'done':
      return null
  }
}

/** The next cell without a kept take, or done when every cell has one (this is also how a retake finds its way back). */
function advance(plan: Plan): Plan {
  const next = plan.kept.findIndex((k) => k === null)
  return next === -1 ? bump(plan, { stage: 'done' }) : bump(plan, { stage: 'shoot', cell: next })
}

/** A round finished with both people holding both photos. From the second take on, the pick opens with the newest preselected. */
export function recordTake(plan: Plan, round: number): Plan {
  if (plan.stage !== 'shoot') return plan
  const mine = plan.takes[plan.cell]
  if (!mine || mine.includes(round)) return plan
  const takes = plan.takes.map((t) => t.slice())
  takes[plan.cell] = [...mine, round]
  if (mine.length + 1 < MIN_TAKES) return bump(plan, { takes })
  const kept = plan.kept.slice()
  kept[plan.cell] = round
  return bump(plan, { stage: 'pick', takes, kept })
}

// ---- validation (untrusted input from a WebSocket) -----------------------------------------------

type Rec = Record<string, unknown>
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x)
const onlyKeys = (o: Rec, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k))
const isCell = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < MAX_CELLS
const isRound = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000
const isTemplate = (v: unknown): v is TemplateId => typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v)
const isKind = (v: unknown): v is CellKind => typeof v === 'string' && (CELL_KINDS as readonly string[]).includes(v)

export function parsePlanAction(raw: unknown): PlanAction | null {
  if (!isRec(raw) || typeof raw.k !== 'string') return null
  switch (raw.k) {
    case 'template':
      return onlyKeys(raw, ['k', 'template']) && isTemplate(raw.template) ? { k: 'template', template: raw.template } : null
    case 'kind':
      return onlyKeys(raw, ['k', 'cell', 'kind']) && isCell(raw.cell) && isKind(raw.kind)
        ? { k: 'kind', cell: raw.cell, kind: raw.kind }
        : null
    case 'keep':
      return onlyKeys(raw, ['k', 'round']) && isRound(raw.round) ? { k: 'keep', round: raw.round } : null
    case 'more':
      return onlyKeys(raw, ['k']) ? { k: 'more' } : null
    case 'retake':
      return onlyKeys(raw, ['k', 'cell']) && isCell(raw.cell) ? { k: 'retake', cell: raw.cell } : null
    case 'reset':
      return onlyKeys(raw, ['k']) ? { k: 'reset' } : null
    default:
      return null
  }
}
