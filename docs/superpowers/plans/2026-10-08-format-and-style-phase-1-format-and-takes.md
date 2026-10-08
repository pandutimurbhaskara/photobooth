# Phase 1 — Format & takes (Tasks 1–7)

> Part of `2026-10-08-format-and-style.md`. **Read that master file first** (Global Constraints and Review Focus apply to every task here). Spec: `docs/superpowers/specs/2026-10-08-format-and-style-design.md` §3 (plan), §4 (protocol), §5 (client), §7 (server), D24–D28, D32.

**Phase goal:** two people pick a format and a kind per cell, shoot 2–3 takes per cell, keep the best take each, see the finished strip (TOGETHER cells side by side), and can retake any single cell. All server and protocol work lands here; phase 2 is client-only.

**Gate (all must pass before Phase 2):**
1. `npm run check` green and `npm run build` succeeds.
2. `npm run test:e2e` green in full: reworked `capture`, `photos`, `rounds`, `a11y` plus new `format`, `takes`, `style`.
3. The app is deployable as it stands (phase 2 is optional polish on top).

Typecheck, lint, unit and worker suites are green after **every** task. E2E is red for the old specs from Task 2 until Task 7 (see master "Process").

---

## Task 1: `shared/plan.ts` — types, template table, reducer, validators

**Files:**
- Create: `src/shared/plan.ts`, `src/shared/plan.test.ts`
- Modify: `src/shared/constants.ts`

**Interfaces:**
- Consumes: `MAX_CELLS`, `MAX_TAKES`, `MIN_TAKES` (added here).
- Produces (all exported from `src/shared/plan.ts`):
  - `TEMPLATE_IDS`, `type TemplateId = 'strip4' | 'grid4' | 'duo2' | 'polaroid'`; `TEMPLATES: Record<TemplateId, { cols: number; rows: number }>`; `cellsOf(t: TemplateId): number`
  - `CELL_KINDS`, `type CellKind = 'a' | 'b' | 'both'`; `type Stage = 'format' | 'shoot' | 'pick' | 'done'`
  - `interface Plan { v: number; stage: Stage; template: TemplateId | null; kinds: CellKind[]; cell: number; takes: number[][]; kept: Array<number | null> }`
  - `type PlanAction = { k: 'template'; template: TemplateId } | { k: 'kind'; cell: number; kind: CellKind } | { k: 'keep'; round: number } | { k: 'more' } | { k: 'retake'; cell: number } | { k: 'reset' }`
  - `defaultPlan(): Plan`
  - `applyPlanAction(plan: Plan, action: PlanAction): Plan | null` (null = refused; accepted changes bump `v`)
  - `acceptsReady(plan: Plan): boolean`
  - `onBothReady(plan: Plan): { plan: Plan; schedule: boolean } | null`
  - `recordTake(plan: Plan, round: number): Plan`
  - `parsePlanAction(raw: unknown): PlanAction | null`

- [ ] **Step 1: Add the constants**

In `src/shared/constants.ts`, directly after the line `export const CELL_ASPECT = 4 / 3` add:

```ts

// Format & takes (spec D24–D28)
export const MIN_TAKES = 2
export const MAX_TAKES = 3
export const MAX_CELLS = 4
```

- [ ] **Step 2: Write the failing tests**

`src/shared/plan.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { MAX_CELLS, MAX_TAKES, MIN_TAKES } from './constants'
import {
  acceptsReady,
  applyPlanAction,
  cellsOf,
  defaultPlan,
  onBothReady,
  parsePlanAction,
  recordTake,
  TEMPLATE_IDS,
  type Plan,
  type PlanAction,
  type TemplateId,
} from './plan'

function must<T>(value: T | null): T {
  if (value === null) throw new Error('expected a value, got null')
  return value
}
const apply = (plan: Plan, action: PlanAction): Plan => must(applyPlanAction(plan, action))
const chosen = (t: TemplateId = 'duo2'): Plan => apply(defaultPlan(), { k: 'template', template: t })
const shooting = (t: TemplateId = 'duo2'): Plan => must(onBothReady(chosen(t))).plan
const picking = (t: TemplateId = 'duo2'): Plan => recordTake(recordTake(shooting(t), 1), 2)
/** Both people agree on the pick: the server's `ready` in the pick stage. */
const advance = (plan: Plan): Plan => must(onBothReady(plan)).plan

describe('templates', () => {
  it('have the cell counts of the reference screenshots and never exceed MAX_CELLS', () => {
    expect(cellsOf('strip4')).toBe(4)
    expect(cellsOf('grid4')).toBe(4)
    expect(cellsOf('duo2')).toBe(2)
    expect(cellsOf('polaroid')).toBe(1)
    for (const id of TEMPLATE_IDS) expect(cellsOf(id)).toBeLessThanOrEqual(MAX_CELLS)
  })
  it('takes are 2 to 3 per cell', () => {
    expect([MIN_TAKES, MAX_TAKES]).toEqual([2, 3])
  })
})

describe('format stage', () => {
  it('starts with no template, so READY means nothing yet', () => {
    const plan = defaultPlan()
    expect(plan).toEqual({ v: 0, stage: 'format', template: null, kinds: [], cell: 0, takes: [], kept: [] })
    expect(acceptsReady(plan)).toBe(false)
    expect(onBothReady(plan)).toBeNull()
  })

  it('choosing a template makes every cell TOGETHER and sizes the take books', () => {
    const plan = chosen('grid4')
    expect(plan).toMatchObject({ v: 1, stage: 'format', template: 'grid4', cell: 0 })
    expect(plan.kinds).toEqual(['both', 'both', 'both', 'both'])
    expect(plan.takes).toEqual([[], [], [], []])
    expect(plan.kept).toEqual([null, null, null, null])
    expect(acceptsReady(plan)).toBe(true)
  })

  it('changing the template throws away the kinds picked for the old one', () => {
    const edited = apply(chosen('grid4'), { k: 'kind', cell: 0, kind: 'a' })
    const other = apply(edited, { k: 'template', template: 'polaroid' })
    expect(other.kinds).toEqual(['both'])
    expect(other.v).toBe(edited.v + 1)
  })

  it('sets one cell kind and bumps the version', () => {
    const plan = apply(chosen('duo2'), { k: 'kind', cell: 1, kind: 'b' })
    expect(plan.kinds).toEqual(['both', 'b'])
    expect(plan.v).toBe(2)
  })

  it('refuses a kind with no template, an out-of-range cell, or outside the format stage', () => {
    expect(applyPlanAction(defaultPlan(), { k: 'kind', cell: 0, kind: 'a' })).toBeNull()
    expect(applyPlanAction(chosen('duo2'), { k: 'kind', cell: 2, kind: 'a' })).toBeNull()
    expect(applyPlanAction(chosen('duo2'), { k: 'kind', cell: -1, kind: 'a' })).toBeNull()
    expect(applyPlanAction(shooting(), { k: 'kind', cell: 0, kind: 'a' })).toBeNull()
    expect(applyPlanAction(shooting(), { k: 'template', template: 'grid4' })).toBeNull()
  })
})

describe('both ready', () => {
  it('in the format stage locks the plan, starts cell 0 and asks for a round', () => {
    const next = must(onBothReady(chosen('strip4')))
    expect(next.schedule).toBe(true)
    expect(next.plan).toMatchObject({ stage: 'shoot', cell: 0, template: 'strip4' })
  })
  it('while shooting only asks for the next round and changes nothing', () => {
    const plan = shooting()
    const next = must(onBothReady(plan))
    expect(next.schedule).toBe(true)
    expect(next.plan).toBe(plan)
  })
  it('in the pick stage moves on without a round: to the next cell, then to done', () => {
    const first = must(onBothReady(picking('duo2')))
    expect(first.schedule).toBe(false)
    expect(first.plan).toMatchObject({ stage: 'shoot', cell: 1 })

    const second = advance(recordTake(recordTake(first.plan, 3), 4))
    expect(second).toMatchObject({ stage: 'done' })
  })
  it('is ignored once everything is done', () => {
    const done = advance(recordTake(recordTake(advance(picking('duo2')), 3), 4))
    expect(done.stage).toBe('done')
    expect(acceptsReady(done)).toBe(false)
    expect(onBothReady(done)).toBeNull()
  })
})

describe('takes', () => {
  it('the first take stays in shoot; the second opens the pick with the latest preselected', () => {
    const one = recordTake(shooting(), 1)
    expect(one).toMatchObject({ stage: 'shoot', takes: [[1], []], kept: [null, null] })
    const two = recordTake(one, 2)
    expect(two).toMatchObject({ stage: 'pick', takes: [[1, 2], []], kept: [2, null] })
  })
  it('ignores a repeated round and anything outside the shoot stage', () => {
    const one = recordTake(shooting(), 1)
    expect(recordTake(one, 1)).toBe(one)
    const picked = picking()
    expect(recordTake(picked, 9)).toBe(picked)
    expect(recordTake(chosen(), 1)).toEqual(chosen())
  })
})

describe('pick stage', () => {
  it('keep switches the kept take; the last write wins', () => {
    let plan = picking()
    plan = apply(plan, { k: 'keep', round: 1 })
    expect(plan.kept[0]).toBe(1)
    plan = apply(plan, { k: 'keep', round: 2 })
    expect(plan.kept[0]).toBe(2)
  })
  // Review Focus 4: an invalid round is refused, whoever sends it.
  it('refuses a keep for a round that is not a take of this cell, or outside the pick stage', () => {
    expect(applyPlanAction(picking(), { k: 'keep', round: 99 })).toBeNull()
    const second = advance(picking('duo2')) // now shooting cell 1 with no takes
    const pickingSecond = recordTake(recordTake(second, 3), 4)
    expect(applyPlanAction(pickingSecond, { k: 'keep', round: 1 })).toBeNull() // a take of cell 0, not cell 1
    expect(applyPlanAction(shooting(), { k: 'keep', round: 1 })).toBeNull()
  })
  it('one more take returns to shoot on the same cell, up to MAX_TAKES', () => {
    const more = apply(picking(), { k: 'more' })
    expect(more).toMatchObject({ stage: 'shoot', cell: 0 })
    const three = recordTake(more, 3)
    expect(three).toMatchObject({ stage: 'pick', takes: [[1, 2, 3], []], kept: [3, null] })
    expect(applyPlanAction(three, { k: 'more' })).toBeNull()
  })
  it('more is refused outside the pick stage', () => {
    expect(applyPlanAction(shooting(), { k: 'more' })).toBeNull()
  })
})

describe('retake', () => {
  const finished = (): Plan => advance(recordTake(recordTake(advance(picking('duo2')), 3), 4))

  it('only from done, and only for a cell that exists', () => {
    expect(applyPlanAction(picking(), { k: 'retake', cell: 0 })).toBeNull()
    expect(applyPlanAction(finished(), { k: 'retake', cell: 2 })).toBeNull()
    expect(applyPlanAction(finished(), { k: 'retake', cell: -1 })).toBeNull()
  })
  it('drops that cell only and goes back to shooting it', () => {
    const plan = apply(finished(), { k: 'retake', cell: 1 })
    expect(plan).toMatchObject({ stage: 'shoot', cell: 1, takes: [[1, 2], []], kept: [2, null] })
  })
  it('after two new takes and a pick it returns to done, not to the next cell', () => {
    let plan = apply(finished(), { k: 'retake', cell: 0 })
    plan = recordTake(recordTake(plan, 5), 6)
    expect(plan).toMatchObject({ stage: 'pick', cell: 0, kept: [6, 4] })
    expect(advance(plan).stage).toBe('done')
  })
})

describe('reset', () => {
  it('goes back to the format stage, keeping the template and kinds but none of the takes', () => {
    const edited = apply(chosen('duo2'), { k: 'kind', cell: 0, kind: 'a' })
    const mid = recordTake(recordTake(must(onBothReady(edited)).plan, 1), 2)
    const plan = apply(mid, { k: 'reset' })
    expect(plan).toMatchObject({ stage: 'format', template: 'duo2', kinds: ['a', 'both'], cell: 0, takes: [[], []], kept: [null, null] })
    expect(plan.v).toBe(mid.v + 1)
  })
  it('is allowed from every stage, even with no template yet', () => {
    expect(applyPlanAction(defaultPlan(), { k: 'reset' })).not.toBeNull()
    expect(applyPlanAction(shooting(), { k: 'reset' })).not.toBeNull()
    expect(applyPlanAction(picking(), { k: 'reset' })).not.toBeNull()
  })
})

describe('parsePlanAction', () => {
  const accepted: Array<[string, unknown]> = [
    ['template', { k: 'template', template: 'grid4' }],
    ['kind', { k: 'kind', cell: 3, kind: 'both' }],
    ['keep', { k: 'keep', round: 7 }],
    ['more', { k: 'more' }],
    ['retake', { k: 'retake', cell: 0 }],
    ['reset', { k: 'reset' }],
  ]
  it.each(accepted)('accepts %s', (_name, raw) => {
    expect(parsePlanAction(raw)).toEqual(raw)
  })

  const rejected: Array<[string, unknown]> = [
    ['null', null],
    ['array', []],
    ['no k', {}],
    ['unknown action', { k: 'explode' }],
    ['unknown template (the dropped horizontal layout)', { k: 'template', template: 'horizontal' }],
    ['missing template', { k: 'template' }],
    ['extra key', { k: 'reset', now: true }],
    ['bad kind', { k: 'kind', cell: 0, kind: 'c' }],
    ['cell too large', { k: 'retake', cell: MAX_CELLS }],
    ['negative cell', { k: 'kind', cell: -1, kind: 'a' }],
    ['fractional cell', { k: 'retake', cell: 0.5 }],
    ['round as a string', { k: 'keep', round: '1' }],
    ['round out of range', { k: 'keep', round: 1_000_001 }],
    ['own __proto__ key', JSON.parse('{"k":"reset","__proto__":1}') as unknown],
  ]
  it.each(rejected)('rejects %s', (_name, raw) => {
    expect(parsePlanAction(raw)).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/shared/plan.test.ts`
Expected: FAIL — cannot resolve `./plan` (module does not exist).

- [ ] **Step 4: Write the implementation**

`src/shared/plan.ts`:
```ts
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/shared/plan.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Typecheck, lint, whole unit suite**

Run: `npm run typecheck && npm run lint && npx vitest run --project unit`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/shared/constants.ts src/shared/plan.ts src/shared/plan.test.ts
git commit -m "feat: add the shared booth plan with templates, stages and a validating reducer"
```

---

## Task 2: Server owns the plan — protocol message and `BoothRoom` flow

**Files:**
- Modify: `src/shared/protocol.ts`, `src/shared/protocol.test.ts`, `src/worker/BoothRoom.ts`, `src/worker/BoothRoom.test.ts`, `src/worker/test-helpers.ts`, `src/client/lib/room-socket.test.ts`

**Interfaces:**
- Consumes: everything produced by Task 1.
- Produces:
  - `ClientMessage` gains `{ type: 'plan'; action: PlanAction }`; `RoomState` gains `plan: Plan` (required).
  - `TestClient.lastState(ms?: number): Promise<RoomState>` and `Peek['rec'].plan?: Plan` in `test-helpers.ts`.
  - Server behaviour (spec §3): plan actions only when `phase === 'ready'` (`reset` also when `waiting`); every accepted change clears both ready flags; `ready` means schedule/advance/ignore by stage; a take is recorded only when **both** `photo-complete` arrive; a record without a plan gets `defaultPlan()` on first read.

- [ ] **Step 1: Write the failing protocol tests**

Append to `src/shared/protocol.test.ts`:
```ts

describe('parseClientMessage — plan', () => {
  const accepted = [
    { type: 'plan', action: { k: 'template', template: 'duo2' } },
    { type: 'plan', action: { k: 'kind', cell: 1, kind: 'a' } },
    { type: 'plan', action: { k: 'keep', round: 3 } },
    { type: 'plan', action: { k: 'more' } },
    { type: 'plan', action: { k: 'retake', cell: 0 } },
    { type: 'plan', action: { k: 'reset' } },
  ]
  it.each(accepted)('accepts %j', (raw) => {
    expect(parseClientMessage(raw)).toEqual(raw)
  })

  const rejected: Array<[string, unknown]> = [
    ['no action', { type: 'plan' }],
    ['unknown action', { type: 'plan', action: { k: 'explode' } }],
    ['unknown template', { type: 'plan', action: { k: 'template', template: 'horizontal' } }],
    ['extra key beside action', { type: 'plan', action: { k: 'reset' }, extra: 1 }],
    ['extra key inside action', { type: 'plan', action: { k: 'reset', extra: 1 } }],
    ['action is a string', { type: 'plan', action: 'reset' }],
  ]
  it.each(rejected)('rejects %s', (_name, raw) => {
    expect(parseClientMessage(raw)).toBeNull()
  })
})
```

- [ ] **Step 2: Add the test helpers and the failing worker tests**

In `src/worker/test-helpers.ts`:

1. Change the first protocol import line to `import type { ClientMessage, RoomState, ServerMessage } from '../shared/protocol'` and add `import type { Plan } from '../shared/plan'`.
2. Add this method to `TestClient`, directly after `settle()`:
```ts
  /** Let in-flight messages land, then return the newest room-state and drop the queue. */
  async lastState(ms = 80): Promise<RoomState> {
    await sleep(ms)
    const states = this.messages.filter((m): m is Extract<ServerMessage, { type: 'room-state' }> => m.type === 'room-state')
    this.messages.length = 0
    const last = states[states.length - 1]
    if (!last) throw new Error('no room-state arrived')
    return last.state
  }
```
3. In the `Peek` interface, add `plan?: Plan` as the last field of `rec`.

In `src/worker/BoothRoom.test.ts`:

1. Add to the imports: `import { defaultPlan, type Plan, type PlanAction, type TemplateId } from '../shared/plan'` and change the helpers import to `import { closeAll, joinAs, newRoom, openSocket, peek, pid, type TestClient } from './test-helpers'`.
2. Append at the end of the file:

```ts

describe('plan', () => {
  const act = (action: PlanAction) => ({ type: 'plan', action }) as const

  async function choose(a: TestClient, b: TestClient, template: TemplateId = 'duo2'): Promise<Plan> {
    a.send(act({ k: 'template', template }))
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    return state.plan
  }
  /** Both press ready; resolves with the round the server scheduled. */
  async function nextRound(a: TestClient, b: TestClient): Promise<number> {
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    const scheduled = await a.take('capture-scheduled')
    await b.take('capture-scheduled')
    await Promise.all([a.settle(), b.settle()])
    return scheduled.round
  }
  async function completeRound(a: TestClient, b: TestClient, round: number): Promise<Plan> {
    a.send({ type: 'photo-complete', round })
    b.send({ type: 'photo-complete', round })
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    return state.plan
  }
  const shootTake = async (a: TestClient, b: TestClient): Promise<Plan> => completeRound(a, b, await nextRound(a, b))
  /** Both press ready in the pick stage (they agree on the kept take). */
  async function bothReady(a: TestClient, b: TestClient): Promise<Plan> {
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    return state.plan
  }

  it('the join snapshot carries a default plan', async () => {
    const code = await newRoom()
    const c = await openSocket(code)
    c.send({ type: 'join', participantId: pid(1) })
    expect((await c.take('room-state')).state.plan).toEqual(defaultPlan())
  })

  // Review Focus 1: nobody stays committed to a plan they did not see.
  it('a plan change reaches both people and clears every ready flag', async () => {
    const { a, b } = await pair()
    const plan = await choose(a, b, 'duo2')
    expect(plan).toMatchObject({ v: 1, stage: 'format', template: 'duo2', kinds: ['both', 'both'], takes: [[], []], kept: [null, null] })

    a.send({ type: 'ready' })
    expect((await a.lastState()).participants.a?.ready).toBe(true)
    await b.settle()

    b.send(act({ k: 'kind', cell: 0, kind: 'a' }))
    const [sa, sb] = await Promise.all([a.lastState(), b.lastState()])
    expect(sa.plan.kinds).toEqual(['a', 'both'])
    expect(sb.plan).toEqual(sa.plan)
    expect(sa.participants.a?.ready).toBe(false)
  })

  it('ignores ready until a template has been chosen', async () => {
    const { a, b } = await pair()
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    await a.expectNone('capture-scheduled')
    expect((await a.lastState()).participants.a?.ready).toBe(false)
  })

  it('both ready in the format stage locks the plan and schedules round 1', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'duo2')
    expect(await nextRound(a, b)).toBe(1)
    a.send({ type: 'ready' }) // refused while a round is in flight, but it re-syncs the caller
    expect((await a.lastState()).plan).toMatchObject({ stage: 'shoot', cell: 0, template: 'duo2' })
  })

  it('refuses plan actions while a round is in flight', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    await nextRound(a, b)
    a.send(act({ k: 'reset' }))
    const state = await a.lastState()
    expect(state.phase).toBe('capture')
    expect(state.plan).toMatchObject({ stage: 'shoot', template: 'duo2' })
  })

  it('records a take only once BOTH people report photo-complete', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    const round = await nextRound(a, b)
    a.send({ type: 'photo-complete', round })
    expect((await a.lastState()).plan.takes).toEqual([[], []])
    b.send({ type: 'photo-complete', round })
    const state = await a.lastState()
    expect(state.plan).toMatchObject({ stage: 'shoot', takes: [[1], []] })
  })

  // Review Focus 3: a failed exchange records nothing and leaves the cell in `shoot`.
  it('a round whose exchange times out records no take', async () => {
    const { a, b, stub } = await pair()
    await choose(a, b)
    await nextRound(a, b)
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.captureAt = Date.now() - EXCHANGE_TIMEOUT_MS - 1
    })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    const state = await a.lastState()
    expect(state.phase).toBe('ready')
    expect(state.plan).toMatchObject({ stage: 'shoot', takes: [[], []] })
  })

  it('the second take opens the pick with the latest preselected, and keep changes it for both', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    await shootTake(a, b)
    const plan = await shootTake(a, b)
    expect(plan).toMatchObject({ stage: 'pick', cell: 0, takes: [[1, 2], []], kept: [2, null] })

    a.send(act({ k: 'keep', round: 1 }))
    const [sa, sb] = await Promise.all([a.lastState(), b.lastState()])
    expect(sa.plan.kept[0]).toBe(1)
    expect(sb.plan).toEqual(sa.plan)
  })

  // Review Focus 4
  it('refuses a keep for a round that is not a take, and converges when both keep at once', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    await shootTake(a, b)
    await shootTake(a, b)

    a.send(act({ k: 'keep', round: 99 }))
    expect((await a.lastState()).plan.kept[0]).toBe(2) // unchanged
    await b.settle()

    a.send(act({ k: 'keep', round: 1 }))
    b.send(act({ k: 'keep', round: 2 }))
    const [sa, sb] = await Promise.all([a.lastState(), b.lastState()])
    expect(sb.plan).toEqual(sa.plan)
    expect([1, 2]).toContain(sa.plan.kept[0])
  })

  it('both ready in the pick stage moves to the next cell, then to done; ready in done is ignored', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'duo2')
    await shootTake(a, b)
    await shootTake(a, b)
    expect(await bothReady(a, b)).toMatchObject({ stage: 'shoot', cell: 1 })

    await shootTake(a, b)
    await shootTake(a, b)
    expect(await bothReady(a, b)).toMatchObject({ stage: 'done', takes: [[1, 2], [3, 4]], kept: [2, 4] })

    a.send({ type: 'ready' })
    expect((await a.lastState()).participants.a?.ready).toBe(false)
  })

  it('one more take adds a third and is then refused', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'polaroid')
    await shootTake(a, b)
    await shootTake(a, b)

    a.send(act({ k: 'more' }))
    expect((await a.lastState()).plan).toMatchObject({ stage: 'shoot', cell: 0 })
    await b.settle()
    const plan = await shootTake(a, b)
    expect(plan).toMatchObject({ stage: 'pick', takes: [[1, 2, 3]], kept: [3] })

    a.send(act({ k: 'more' }))
    expect((await a.lastState()).plan.stage).toBe('pick')
  })

  it('retake drops one cell and comes back to done, not to the next cell', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'duo2')
    for (let i = 0; i < 2; i++) {
      await shootTake(a, b)
      await shootTake(a, b)
      await bothReady(a, b)
    }
    a.send(act({ k: 'retake', cell: 1 }))
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    expect(state.plan).toMatchObject({ stage: 'shoot', cell: 1, takes: [[1, 2], []], kept: [2, null] })

    await shootTake(a, b)
    await shootTake(a, b)
    expect(await bothReady(a, b)).toMatchObject({ stage: 'done', takes: [[1, 2], [5, 6]], kept: [2, 6] })
  })

  it('reset keeps the template and kinds but clears the takes', async () => {
    const { a, b } = await pair()
    await choose(a, b, 'duo2')
    a.send(act({ k: 'kind', cell: 0, kind: 'a' }))
    await Promise.all([a.lastState(), b.lastState()])
    await shootTake(a, b)

    a.send(act({ k: 'reset' }))
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    expect(state.plan).toMatchObject({ stage: 'format', template: 'duo2', kinds: ['a', 'both'], takes: [[], []], kept: [null, null] })
  })

  it('a person alone can reset (their photos may be gone), but nothing else', async () => {
    const { a, b } = await pair()
    await choose(a, b)
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    await a.settle()

    a.send(act({ k: 'kind', cell: 0, kind: 'a' }))
    const refused = await a.lastState()
    expect(refused.phase).toBe('waiting')
    expect(refused.plan.v).toBe(1)

    a.send(act({ k: 'reset' }))
    expect((await a.lastState()).plan).toMatchObject({ v: 2, stage: 'format', template: 'duo2' })
  })

  it('the plan survives a partner leaving and reclaiming their slot', async () => {
    const { code, a, b } = await pair()
    await choose(a, b, 'grid4')
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    const back = await openSocket(code)
    back.send({ type: 'join', participantId: pid(2) })
    expect((await back.take('room-state')).state.plan).toMatchObject({ template: 'grid4', stage: 'format' })
  })

  it('gives a room persisted before plans existed a default plan', async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    await joinAs(code, 1)
    await runInDurableObject(stub, async (instance, state) => {
      const rec = peek(instance).rec as { plan?: unknown }
      delete rec.plan
      await state.storage.put('room', rec)
    })
    await evictDurableObject(stub)
    const c = await openSocket(code)
    c.send({ type: 'join', participantId: pid(1) })
    expect((await c.take('room-state')).state.plan).toEqual(defaultPlan())
  })

  it('closes a socket that sends a malformed plan action', async () => {
    const { a } = await pair()
    a.send({ type: 'plan', action: { k: 'template', template: 'nope' } })
    expect((await a.take('error')).code).toBe('invalid-message')
    expect(await a.waitClose()).toBe(4400)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/shared/protocol.test.ts` then `npx vitest run --project worker src/worker/BoothRoom.test.ts -t "plan"`
Expected: FAIL — `parseClientMessage` returns `null` for `plan` messages; the worker tests fail (unknown message type closes the socket, `plan` missing from `room-state`).

- [ ] **Step 4: Extend the protocol**

In `src/shared/protocol.ts`:

1. Under the existing first import line, add: `import { parsePlanAction, type Plan, type PlanAction } from './plan'`
2. In `interface RoomState`, add `plan: Plan` after `participants: Record<SlotName, PState | null>`.
3. In `type ClientMessage`, add the line `  | { type: 'plan'; action: PlanAction }` after the `photo-complete` member.
4. In `parseClientMessage`, add this case directly before `case 'ping':`:
```ts
    case 'plan': {
      const action = onlyKeys(raw, ['type', 'action']) ? parsePlanAction(raw.action) : null
      return action ? { type: 'plan', action } : null
    }
```

In `src/client/lib/room-socket.test.ts`, replace the `STATE` literal's `state` with one that includes a plan, and add the import:
```ts
import { defaultPlan } from '../../shared/plan'
```
```ts
const STATE: ServerMessage = {
  type: 'room-state',
  state: { code: 'ABCDEF', you: 'a', phase: 'waiting', round: 0, captureAt: null, participants: { a: null, b: null }, plan: defaultPlan() },
}
```

- [ ] **Step 5: Teach `BoothRoom` the plan**

In `src/worker/BoothRoom.ts`:

1. After the `import type { ClientMessage, ErrorCode, ... } from '../shared/protocol'` line add:
```ts
import { acceptsReady, applyPlanAction, defaultPlan, onBothReady, recordTake } from '../shared/plan'
import type { Plan } from '../shared/plan'
```
2. In `interface RoomRecord`, add as the last field (after `ice?`):
```ts
  /** The shared booth plan. Optional only because rooms persisted before it existed have none; `plan` getter fills it in. */
  plan?: Plan
```
3. In `create()`, change the record literal to include `plan: defaultPlan()`:
```ts
    this.rec = { code, createdAt: now, lastActivityAt: now, round: 0, captureAt: null, slots: {}, plan: defaultPlan() }
```
4. Directly after the `private get room()` getter add:
```ts
  /** Rooms persisted before plans existed get a fresh one the first time it is read. */
  private get plan(): Plan {
    const rec = this.room
    rec.plan ??= defaultPlan()
    return rec.plan
  }
```
5. Replace the whole `private handle(...)` method with:
```ts
  private handle(slot: SlotName, msg: Exclude<ClientMessage, { type: 'join' | 'ping' }>, now: number): void {
    const rec = this.room
    switch (msg.type) {
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this.sendTo(otherSlot(slot), msg) // already validated and rebuilt by parseClientMessage
        return
      case 'plan': {
        // Plan changes only happen between rounds. `reset` is also allowed to someone alone, so a person whose
        // photos are gone (a reload) can always leave a dead session.
        const phase = this.phase(now)
        const allowed = msg.action.k === 'reset' ? phase !== 'capture' : phase === 'ready'
        const next = allowed ? applyPlanAction(this.plan, msg.action) : null
        if (next) {
          rec.plan = next
          this.clearReady() // nobody stays committed to a plan they have not seen
          this.save()
        }
        this.broadcastState() // a refusal re-syncs the caller; an accepted change tells both
        return
      }
      case 'ready':
      case 'unready': {
        const me = rec.slots[slot]
        // Only while two people are present, no round is in flight and the plan has something to be ready for.
        // Re-sync the caller either way (computing the phase may also drop an expired capture).
        if (!me || this.phase(now) !== 'ready' || !acceptsReady(this.plan)) {
          this.broadcastState()
          return
        }
        me.ready = msg.type === 'ready'
        if (rec.slots.a?.ready && rec.slots.b?.ready) {
          const next = onBothReady(this.plan)
          if (next) {
            rec.plan = next.plan
            if (next.schedule) this.schedule(now)
            else this.clearReady()
          }
        }
        this.save()
        this.broadcastState()
        return
      }
      case 'photo-complete': {
        const me = rec.slots[slot]
        if (!me || rec.captureAt === null || msg.round !== rec.round) return
        me.photoDone = true
        if (rec.slots.a?.photoDone && rec.slots.b?.photoDone) {
          rec.captureAt = null
          rec.plan = recordTake(this.plan, rec.round) // a take exists only once both people hold both photos
        }
        this.save()
        this.broadcastState()
        return
      }
    }
  }

  private clearReady(): void {
    for (const name of SLOTS) {
      const s = this.rec?.slots[name]
      if (s) s.ready = false
    }
  }
```
6. In `stateFor`, change the returned object to include the plan:
```ts
    return { code: rec.code, you: slot, phase, round: rec.round, captureAt: rec.captureAt, participants: { a: p('a'), b: p('b') }, plan: this.plan }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/shared/protocol.test.ts && npx vitest run --project worker`
Expected: PASS. The pre-existing worker tests keep passing: `ready` in the `format` stage with no template would now be ignored, so **update the two existing tests that start a round by pressing ready right after `pair()`** — `schedules one capture…`, `schedules exactly one round…`, `ignores ready/unready while a round is in flight`, and the `startRound` helper in `round lifecycle` — by choosing a template first. Add this helper next to `pair()`:
```ts
/** The plan needs a template before READY means anything. */
async function choosePair(template: TemplateId = 'duo2') {
  const ctx = await pair()
  ctx.a.send({ type: 'plan', action: { k: 'template', template } })
  await Promise.all([ctx.a.settle(), ctx.b.settle()])
  return ctx
}
```
(`settle()` waits, then drops the queue, which is what these tests need.) Then replace `await pair()` with `await choosePair()` in exactly those four places (the `ready → scheduled capture` tests and `startRound`), and in `lets someone un-ready, and ignores ready while alone` pick the template for the pair after `b` joins: after the line `await solo.settle()` insert `solo.send({ type: 'plan', action: { k: 'template', template: 'duo2' } })` and `await solo.settle()`. The first assertion of that test (ready ignored while alone) stays as it is.

- [ ] **Step 7: Typecheck, lint, whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all exit 0. (E2E is expected red from here until Task 7.)

- [ ] **Step 8: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.test.ts src/worker/BoothRoom.ts src/worker/BoothRoom.test.ts src/worker/test-helpers.ts src/client/lib/room-socket.test.ts
git commit -m "feat: let the booth room own the shared plan and drive it from ready and photo-complete"
```

---

## Task 3: Client data layer — template geometry, cell rendering, take store

**Files:**
- Create: `src/client/lib/palette.ts`, `src/client/lib/palette.test.ts`, `src/client/lib/takes.ts`, `src/client/lib/takes.test.ts`
- Modify: `src/client/lib/photo.ts`, `src/client/lib/photo.test.ts`, `src/client/lib/strip.ts`, `src/client/lib/strip.test.ts`, `src/client/hooks/useStrip.ts`, `src/client/screens/Result.tsx`, `src/client/pages/Booth.tsx`
- Delete: `src/client/lib/rounds.ts`, `src/client/lib/rounds.test.ts`

**Interfaces:**
- Consumes: `TemplateId`, `TEMPLATES`, `cellsOf`, `CellKind`, `Plan` (Task 1); `RoomState.plan` (Task 2).
- Produces:
  - `palette.ts`: `PALETTE` (`paper ink yellow pink blue lime orange purple` hex strings, `as const`).
  - `photo.ts`: `layoutStrip(template: TemplateId): StripGeometry` (table-driven; `StripLayout` and `photosNeeded` are gone).
  - `strip.ts`: `interface CellContent { kind: CellKind; a?: ImageBitmap; b?: ImageBitmap; seed: string }`; `cellPlacements(kind: CellKind, w: number, h: number): Array<{ who: 'a' | 'b'; dest: Rect }>` (cell-relative, pure); `interface StripMeta { code: string; dateLabel: string; filter: FilterId }`; `renderStrip(cells: readonly CellContent[], template: TemplateId, meta: StripMeta): Promise<HTMLCanvasElement>`.
  - `takes.ts`: `interface Round { round: number; a: Blob; b: Blob }`; `interface Pending`; `mergePhoto`, `completeRound` (unchanged behaviour); `type TakeStore = ReadonlyMap<number, Round>`; `putRound(store, r): Map<number, Round>`; `referencedRounds(plan): number[]`; `highestReferenced(plan): number`; `pruneStore(store, plan, highestSeen): TakeStore` (same reference when nothing is dropped); `missingRounds(plan, store): number[]`; `interface CellBlobs { kind: CellKind; round: number; a: Blob; b: Blob }`; `interface Finished { template: TemplateId; cells: CellBlobs[] }`; `finishedOf(plan, store): Finished | null`.
  - `useStrip(cells: readonly CellBlobs[] | null, template: TemplateId | null, meta: StripMeta)`; `Result` props `{ code, status, template, cells, partnerHere }`; downloaded file name `two-up-<CODE>-<template>.<ext>`.

- [ ] **Step 1: Palette, with a drift guard against the CSS tokens**

`src/client/lib/palette.ts`:
```ts
/** The design tokens as canvas colours. Canvas cannot read Tailwind classes; `palette.test.ts` keeps these equal to `index.css`. */
export const PALETTE = {
  paper: '#fff8e7',
  ink: '#0a0a0a',
  yellow: '#ffe600',
  pink: '#ff4fa3',
  blue: '#2f5bff',
  lime: '#b6ff3b',
  orange: '#ff8a1f',
  purple: '#8b5cf6',
} as const
```

`src/client/lib/palette.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { PALETTE } from './palette'

describe('PALETTE', () => {
  it('equals the CSS colour tokens, so the strip and the page can never drift apart', () => {
    for (const [name, hex] of Object.entries(PALETTE)) expect(css).toContain(`--color-${name}: ${hex};`)
  })
})
```
Run: `npx vitest run src/client/lib/palette.test.ts` — expected PASS (the token file already holds these values).

- [ ] **Step 2: Failing geometry tests**

In `src/client/lib/photo.test.ts`: remove the line `  photosNeeded,` from the `./photo` import, add `import { cellsOf, TEMPLATE_IDS } from '../../shared/plan'` under the first import line, then replace everything from the line `describe('layoutStrip', () => {` to the end of the file with:
```ts
describe('layoutStrip', () => {
  it('duo2: two stacked cells and a footer (the old "vertical")', () => {
    const g = layoutStrip('duo2')
    expect([g.width, g.height]).toEqual([1056, 1800])
    expect(g.cells).toEqual([
      { x: 48, y: 48, w: 960, h: 720 },
      { x: 48, y: 816, w: 960, h: 720 },
    ])
    expect(g.footer).toEqual({ x: 48, y: 1584, w: 960, h: 168 })
  })
  it('strip4: four stacked cells', () => {
    const g = layoutStrip('strip4')
    expect([g.width, g.height]).toEqual([1056, 3336])
    expect(g.cells.map((c) => c.y)).toEqual([48, 816, 1584, 2352])
  })
  it('grid4: A over B, row-major (the old "grid")', () => {
    const g = layoutStrip('grid4')
    expect([g.width, g.height]).toEqual([2064, 1800])
    expect(g.cells).toHaveLength(4)
    expect(g.cells[2]).toEqual({ x: 48, y: 816, w: 960, h: 720 })
  })
  it('polaroid: one cell and a deep footer', () => {
    const g = layoutStrip('polaroid')
    expect([g.width, g.height]).toEqual([1056, 1032])
    expect(g.cells).toEqual([{ x: 48, y: 48, w: 960, h: 720 }])
  })
  it('has exactly one cell per template cell, never overlaps, and stays inside the canvas', () => {
    for (const template of TEMPLATE_IDS) {
      const g = layoutStrip(template)
      expect(g.cells).toHaveLength(cellsOf(template))
      for (const c of [...g.cells, g.footer]) {
        expect(c.x).toBeGreaterThanOrEqual(0)
        expect(c.y).toBeGreaterThanOrEqual(0)
        expect(c.x + c.w).toBeLessThanOrEqual(g.width)
        expect(c.y + c.h).toBeLessThanOrEqual(g.height)
      }
    }
  })
})
```
Run: `npx vitest run src/client/lib/photo.test.ts`
Expected: FAIL (`'duo2'` etc. are not layouts yet).

- [ ] **Step 3: Make `photo.ts` template-driven**

In `src/client/lib/photo.ts`, add under the first import line: `import { TEMPLATES, type TemplateId } from '../../shared/plan'`. Then cut everything from the line `export type StripLayout = 'vertical' | 'horizontal' | 'grid'` to the end of the file (this one-off removes it reliably):
```bash
python3 - <<'EOF'
p = 'src/client/lib/photo.ts'
s = open(p).read()
i = s.index('export type StripLayout')
open(p, 'w').write(s[:i])
EOF
```
and **append this to the end of `src/client/lib/photo.ts`** (it re-declares `Rect`, `StripGeometry`, the cell/strip constants and `layoutStrip`; everything above the cut — `captureFrame`, `coverRect`, … — stays):
```ts
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}
export interface StripGeometry {
  width: number
  height: number
  cells: Rect[]
  footer: Rect
}

export const CELL_W = 960
export const CELL_H = Math.round(CELL_W / CELL_ASPECT) // 720: a 4:3 cell, matching the live CameraFrame
export const STRIP_PAD = 48
export const STRIP_GAP = 48
export const STRIP_FOOTER_H = 168

/** Pure geometry for a strip, so layout is testable without a canvas. Cells are row-major. */
export function layoutStrip(template: TemplateId): StripGeometry {
  const { cols, rows } = TEMPLATES[template]
  const width = STRIP_PAD * 2 + cols * CELL_W + (cols - 1) * STRIP_GAP
  const gridHeight = rows * CELL_H + (rows - 1) * STRIP_GAP
  const footerY = STRIP_PAD + gridHeight + STRIP_GAP
  const cells: Rect[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: STRIP_PAD + c * (CELL_W + STRIP_GAP), y: STRIP_PAD + r * (CELL_H + STRIP_GAP), w: CELL_W, h: CELL_H })
    }
  }
  return {
    width,
    height: footerY + STRIP_FOOTER_H + STRIP_PAD,
    cells,
    footer: { x: STRIP_PAD, y: footerY, w: width - STRIP_PAD * 2, h: STRIP_FOOTER_H },
  }
}
```
Run: `npx vitest run src/client/lib/photo.test.ts` — expected PASS.

- [ ] **Step 4: Failing tests for cell placement**

In `src/client/lib/strip.test.ts`, change the import to `import { cellPlacements, formatStripDate, mulberry32, seedFromString } from './strip'` and append:
```ts

describe('cellPlacements', () => {
  it('a USER 1 or USER 2 cell is one full photo of that person', () => {
    expect(cellPlacements('a', 960, 720)).toEqual([{ who: 'a', dest: { x: 0, y: 0, w: 960, h: 720 } }])
    expect(cellPlacements('b', 960, 720)).toEqual([{ who: 'b', dest: { x: 0, y: 0, w: 960, h: 720 } }])
  })
  it('a TOGETHER cell is USER 1 on the left half and USER 2 on the right, with no gap and no overlap', () => {
    const [left, right] = cellPlacements('both', 960, 720)
    expect(left).toEqual({ who: 'a', dest: { x: 0, y: 0, w: 480, h: 720 } })
    expect(right).toEqual({ who: 'b', dest: { x: 480, y: 0, w: 480, h: 720 } })
  })
  it('splits an odd width exactly', () => {
    const [left, right] = cellPlacements('both', 961, 720)
    expect(left?.dest.w).toBe(480)
    expect(right?.dest).toMatchObject({ x: 480, w: 481 })
  })
})
```
Run: `npx vitest run src/client/lib/strip.test.ts`
Expected: FAIL — `cellPlacements` is not exported.

- [ ] **Step 5: Make `strip.ts` cell-driven**

Read `src/client/lib/strip.ts`, then replace the file with:
```ts
import type { CellKind, TemplateId } from '../../shared/plan'
import { formatRoomCode } from '../../shared/room-code'
import { applyFilter, type FilterId } from './filters'
import { PALETTE } from './palette'
import { coverRect, layoutStrip, type Rect } from './photo'

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const

export function formatStripDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** FNV-1a: a tiny, stable string → 32-bit seed. */
export function seedFromString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** mulberry32: deterministic PRNG, so both people's strips tilt identically. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** What goes into one cell. `a` / `b` are the two people's photos (final pixels, already mirrored if the preview was). */
export interface CellContent {
  kind: CellKind
  a?: ImageBitmap
  b?: ImageBitmap
  /** Seeds this cell's tilt: `${code}:${cell}:${keptRound}`, so both devices agree and a retake changes it. */
  seed: string
}

export interface StripMeta {
  code: string
  dateLabel: string
  filter: FilterId
}

const PAPER = PALETTE.paper
const INK = PALETTE.ink
const PINK = PALETTE.pink
const FRAME_BORDER = 10
const MAX_TILT_RAD = 0.014 // ≈ 0.8°
const FONT = '"Space Grotesk Variable", system-ui, sans-serif'

/**
 * Where each person's photo lands inside one cell, in the cell's own coordinates. A TOGETHER cell is split into two
 * halves (spec D32); phase 2 replaces that with a cutout when a background is chosen. Pure, so it is unit-tested.
 */
export function cellPlacements(kind: CellKind, w: number, h: number): Array<{ who: 'a' | 'b'; dest: Rect }> {
  if (kind === 'a' || kind === 'b') return [{ who: kind, dest: { x: 0, y: 0, w, h } }]
  const half = Math.floor(w / 2)
  return [
    { who: 'a', dest: { x: 0, y: 0, w: half, h } },
    { who: 'b', dest: { x: half, y: 0, w: w - half, h } },
  ]
}

function drawCell(ctx: CanvasRenderingContext2D, content: CellContent, cell: Rect, tilt: number, filter: FilterId): void {
  // Compose the cell on a scratch canvas first, so the filter only touches the photos (not paper or frame).
  const tile = document.createElement('canvas')
  tile.width = cell.w
  tile.height = cell.h
  const t = tile.getContext('2d')
  if (!t) throw new Error('2d canvas is unavailable')
  for (const { who, dest } of cellPlacements(content.kind, cell.w, cell.h)) {
    const bmp = content[who]
    if (!bmp) continue
    const { sx, sy, sw, sh } = coverRect(bmp.width, bmp.height, dest.w, dest.h)
    t.drawImage(bmp, sx, sy, sw, sh, dest.x, dest.y, dest.w, dest.h)
  }
  if (filter !== 'original') {
    const pixels = t.getImageData(0, 0, cell.w, cell.h)
    applyFilter(pixels.data, filter)
    t.putImageData(pixels, 0, 0)
  }

  ctx.save()
  ctx.translate(cell.x + cell.w / 2, cell.y + cell.h / 2)
  ctx.rotate(tilt)
  ctx.fillStyle = INK
  ctx.fillRect(-cell.w / 2 - FRAME_BORDER, -cell.h / 2 - FRAME_BORDER, cell.w + FRAME_BORDER * 2, cell.h + FRAME_BORDER * 2)
  ctx.drawImage(tile, -cell.w / 2, -cell.h / 2)
  ctx.restore()
}

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = PINK
  ctx.fill()
  ctx.lineWidth = 8
  ctx.lineJoin = 'round'
  ctx.strokeStyle = INK
  ctx.stroke()
}

/** Compose the photo strip. Fonts must be loaded first or canvas silently falls back to a system face. */
export async function renderStrip(
  cells: readonly CellContent[],
  template: TemplateId,
  meta: StripMeta,
): Promise<HTMLCanvasElement> {
  await document.fonts.load(`900 56px ${FONT}`)
  const g = layoutStrip(template)
  const canvas = document.createElement('canvas')
  canvas.width = g.width
  canvas.height = g.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d canvas is unavailable')

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, g.width, g.height)

  g.cells.forEach((rect, i) => {
    const content = cells[i]
    if (!content) return
    const tilt = (mulberry32(seedFromString(content.seed))() - 0.5) * 2 * MAX_TILT_RAD
    drawCell(ctx, content, rect, tilt, meta.filter)
  })

  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.font = `900 64px ${FONT}`
  ctx.fillText(`BOOTH ${formatRoomCode(meta.code)}`, g.footer.x, g.footer.y + g.footer.h * 0.36)
  ctx.font = `700 40px ${FONT}`
  ctx.fillText(meta.dateLabel, g.footer.x, g.footer.y + g.footer.h * 0.76)
  drawStar(ctx, g.footer.x + g.footer.w - 90, g.footer.y + g.footer.h / 2, 76)

  ctx.lineWidth = 16
  ctx.strokeStyle = INK
  ctx.strokeRect(8, 8, g.width - 16, g.height - 16)
  return canvas
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Web Share with a file where the platform supports it; 'unsupported' means: fall back to a download. */
export async function shareImage(blob: Blob, filename: string, text: string): Promise<'shared' | 'unsupported' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type })
  if (typeof navigator.share !== 'function' || !navigator.canShare?.({ files: [file] })) return 'unsupported'
  try {
    await navigator.share({ files: [file], text })
    return 'shared'
  } catch (e) {
    return e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'unsupported'
  }
}
```
Run: `npx vitest run src/client/lib/strip.test.ts` — expected PASS.

- [ ] **Step 6: Failing tests for the take store**

`src/client/lib/takes.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { applyPlanAction, defaultPlan, onBothReady, recordTake, type Plan } from '../../shared/plan'
import {
  completeRound,
  finishedOf,
  highestReferenced,
  mergePhoto,
  missingRounds,
  pruneStore,
  putRound,
  referencedRounds,
  type Round,
  type TakeStore,
} from './takes'

const blob = (s: string) => new Blob([s])
const round = (n: number): Round => ({ round: n, a: blob(`a${n}`), b: blob(`b${n}`) })
const store = (...rounds: number[]): TakeStore => rounds.reduce<TakeStore>((s, n) => putRound(s, round(n)), new Map())
function must<T>(v: T | null): T {
  if (v === null) throw new Error('expected a value')
  return v
}
const chosen = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => must(applyPlanAction(defaultPlan(), { k: 'template', template: t }))
const shooting = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => must(onBothReady(chosen(t))).plan
const picking = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => recordTake(recordTake(shooting(t), 1), 2)
const done = (): Plan => {
  const second = must(onBothReady(picking('duo2'))).plan
  return must(onBothReady(recordTake(recordTake(second, 3), 4))).plan
}

describe('mergePhoto / completeRound', () => {
  it('starts a pending round, then fills in the other half', () => {
    const first = mergePhoto(null, 1, 'own', blob('mine'))
    expect(first).toMatchObject({ round: 1 })
    expect(first.partner).toBeUndefined()
    const both = mergePhoto(first, 1, 'partner', blob('theirs'))
    expect(both.own).toBeDefined()
    expect(both.partner).toBeDefined()
  })
  it('starts fresh when a different round arrives', () => {
    const old = mergePhoto(null, 1, 'own', blob('mine'))
    const next = mergePhoto(old, 2, 'partner', blob('theirs'))
    expect(next.round).toBe(2)
    expect(next.own).toBeUndefined()
  })
  it('is null until both photos exist', () => {
    expect(completeRound({ round: 1, own: blob('x') }, 'a')).toBeNull()
    expect(completeRound({ round: 1, partner: blob('x') }, 'b')).toBeNull()
  })
  it("always puts slot a's photo in `a`, whoever is looking", () => {
    const mine = blob('mine')
    const theirs = blob('theirs')
    expect(completeRound({ round: 4, own: mine, partner: theirs }, 'a')).toEqual({ round: 4, a: mine, b: theirs })
    expect(completeRound({ round: 4, own: mine, partner: theirs }, 'b')).toEqual({ round: 4, a: theirs, b: mine })
  })
})

describe('putRound', () => {
  it('adds a round without touching the old store, and replaces a repeat', () => {
    const before = store(1)
    const after = putRound(before, round(2))
    expect(before.size).toBe(1)
    expect([...after.keys()]).toEqual([1, 2])
    expect(putRound(after, round(2)).size).toBe(2)
  })
})

describe('referencedRounds / highestReferenced', () => {
  it('collects every take and kept round the plan points at', () => {
    expect(referencedRounds(defaultPlan())).toEqual([])
    expect(highestReferenced(defaultPlan())).toBe(-1)
    const plan = picking()
    expect(referencedRounds(plan).sort()).toEqual([1, 2, 2])
    expect(highestReferenced(plan)).toBe(2)
  })
})

describe('pruneStore', () => {
  it('drops rounds the plan no longer points at', () => {
    const plan = must(applyPlanAction(done(), { k: 'reset' })) // nothing referenced any more
    const pruned = pruneStore(store(1, 2, 3, 4), plan, 4)
    expect(pruned.size).toBe(0)
  })
  it('keeps a round newer than anything the plan has mentioned yet (finished here, not yet recorded by the server)', () => {
    const plan = picking() // references 1 and 2
    const pruned = pruneStore(store(1, 2, 3), plan, highestReferenced(plan))
    expect([...pruned.keys()].sort()).toEqual([1, 2, 3])
  })
  it('keeps what the plan still needs — the kept rounds — and drops every take that was not kept or is being redone', () => {
    const plan = done() // takes [[1,2],[3,4]], kept [2,4]
    const retaking = must(applyPlanAction(plan, { k: 'retake', cell: 1 })) // cell 1 is being redone: takes [[1,2],[]], kept [2,null]
    const pruned = pruneStore(store(1, 2, 3, 4), retaking, 4)
    expect([...pruned.keys()]).toEqual([2])
  })
  it('returns the very same store when there is nothing to drop (so React can bail out)', () => {
    const plan = picking()
    const s = store(1, 2)
    expect(pruneStore(s, plan, 2)).toBe(s)
  })
})

// Review Focus 2: a reloaded tab holds none of the photos the plan points at.
describe('missingRounds', () => {
  it('is empty when nothing needs photos yet', () => {
    expect(missingRounds(defaultPlan(), store())).toEqual([])
    expect(missingRounds(chosen(), store())).toEqual([])
  })
  it('lists the takes of the current cell while shooting or picking', () => {
    expect(missingRounds(picking(), store(1))).toEqual([2])
    expect(missingRounds(picking(), store(1, 2))).toEqual([])
  })
  it('lists the kept rounds of finished cells, but not takes that were not kept', () => {
    const plan = done() // takes [[1,2],[3,4]], kept [2,4]
    expect(missingRounds(plan, store(2))).toEqual([4])
    expect(missingRounds(plan, store(2, 4))).toEqual([])
  })
})

describe('finishedOf', () => {
  it('is null until the plan is done and every kept photo is held', () => {
    expect(finishedOf(picking(), store(1, 2))).toBeNull()
    expect(finishedOf(done(), store(2))).toBeNull()
  })
  it('lists the kept round of each cell, in cell order, with its kind', () => {
    const plan = must(applyPlanAction(done(), { k: 'reset' }))
    expect(finishedOf(plan, store(1, 2, 3, 4))).toBeNull() // reset: not done
    const finished = must(finishedOf(done(), store(1, 2, 3, 4)))
    expect(finished.template).toBe('duo2')
    expect(finished.cells.map((c) => [c.kind, c.round])).toEqual([
      ['both', 2],
      ['both', 4],
    ])
    expect(finished.cells[0]?.a).toBeInstanceOf(Blob)
  })
})
```
Run: `npx vitest run src/client/lib/takes.test.ts`
Expected: FAIL — `./takes` does not exist.

- [ ] **Step 7: Write `takes.ts`, delete `rounds.ts`**

`src/client/lib/takes.ts`:
```ts
import type { SlotName } from '../../shared/protocol'
import type { CellKind, Plan, TemplateId } from '../../shared/plan'

/** One completed capture by both people. `a` is slot a's photo, `b` is slot b's, for everyone. */
export interface Round {
  round: number
  a: Blob
  b: Blob
}
export interface Pending {
  round: number
  own?: Blob
  partner?: Blob
}

export function mergePhoto(pending: Pending | null, round: number, who: 'own' | 'partner', blob: Blob): Pending {
  const base: Pending = pending && pending.round === round ? pending : { round }
  return { ...base, [who]: blob }
}

export function completeRound(pending: Pending, slot: SlotName): Round | null {
  if (!pending.own || !pending.partner) return null
  return slot === 'a'
    ? { round: pending.round, a: pending.own, b: pending.partner }
    : { round: pending.round, a: pending.partner, b: pending.own }
}

/** Every completed round this tab holds. Photos live only here, never on the server. */
export type TakeStore = ReadonlyMap<number, Round>

export const putRound = (store: TakeStore, next: Round): Map<number, Round> => new Map(store).set(next.round, next)

/** Every round the plan points at. */
export const referencedRounds = (plan: Plan): number[] => [
  ...plan.takes.flat(),
  ...plan.kept.filter((k): k is number => k !== null),
]
export const highestReferenced = (plan: Plan): number => Math.max(-1, ...referencedRounds(plan))

/**
 * Rounds this tab still needs: the kept ones, plus every take of the cell being shot or picked.
 * Takes of earlier cells that were not kept are never shown again.
 */
function neededRounds(plan: Plan): Set<number> {
  const needed = new Set(plan.kept.filter((k): k is number => k !== null))
  if (plan.stage === 'shoot' || plan.stage === 'pick') for (const r of plan.takes[plan.cell] ?? []) needed.add(r)
  return needed
}

/**
 * Drop rounds the plan no longer needs. A round newer than anything the plan has ever mentioned (`highestSeen`) is a
 * photo pair that finished here a moment before the server announced the take, so it is kept. Returns the same
 * store when nothing is dropped.
 */
export function pruneStore(store: TakeStore, plan: Plan, highestSeen: number): TakeStore {
  const needed = neededRounds(plan)
  const drop = [...store.keys()].filter((r) => !needed.has(r) && r <= highestSeen)
  if (drop.length === 0) return store
  const next = new Map(store)
  for (const r of drop) next.delete(r)
  return next
}

/** Rounds the plan needs that this tab does not hold — the tab was reloaded (spec §5). */
export const missingRounds = (plan: Plan, store: TakeStore): number[] => [...neededRounds(plan)].filter((r) => !store.has(r))

/** The kept photos of one cell, ready to compose. */
export interface CellBlobs {
  kind: CellKind
  round: number
  a: Blob
  b: Blob
}
export interface Finished {
  template: TemplateId
  cells: CellBlobs[]
}

/** The finished strip's inputs, or null until the plan is done *and* this tab holds every kept photo. */
export function finishedOf(plan: Plan, store: TakeStore): Finished | null {
  if (plan.stage !== 'done' || plan.template === null) return null
  const cells: CellBlobs[] = []
  for (const [i, kind] of plan.kinds.entries()) {
    const kept = plan.kept[i]
    const round = kept === null || kept === undefined ? undefined : store.get(kept)
    if (!round) return null
    cells.push({ kind, round: round.round, a: round.a, b: round.b })
  }
  return cells.length > 0 ? { template: plan.template, cells } : null
}
```
Then:
```bash
git rm -q src/client/lib/rounds.ts src/client/lib/rounds.test.ts
```
Run: `npx vitest run src/client/lib/takes.test.ts` — expected PASS.

- [ ] **Step 8: Compose from cells — `useStrip`, a minimal `Result`, and `Booth` wiring**

Replace `src/client/hooks/useStrip.ts`:
```ts
import { useEffect, useState } from 'react'
import type { TemplateId } from '../../shared/plan'
import { canvasToBlob } from '../lib/photo'
import { renderStrip, type CellContent, type StripMeta } from '../lib/strip'
import type { CellBlobs } from '../lib/takes'
import { useLatest } from './useLatest'

/**
 * Composes the strip whenever the kept photos, template or metadata change; exposes an object URL for display and
 * the canvas for export. `cells` is read through a ref and keyed by content, so a new array with the same photos
 * does not recompose.
 */
export function useStrip(cells: readonly CellBlobs[] | null, template: TemplateId | null, meta: StripMeta) {
  const [url, setUrl] = useState<string | null>(null)
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)
  const [error, setError] = useState(false)
  const latest = useLatest(cells)
  const key = cells ? cells.map((c) => `${c.kind}:${c.round}`).join('|') : ''

  useEffect(() => {
    const current = latest.current
    if (!current || !template) return
    let cancelled = false
    let objectUrl: string | null = null
    const opened: ImageBitmap[] = []
    void (async () => {
      try {
        const content: CellContent[] = []
        for (const [i, cell] of current.entries()) {
          const a = cell.kind !== 'b' ? await createImageBitmap(cell.a) : undefined
          const b = cell.kind !== 'a' ? await createImageBitmap(cell.b) : undefined
          for (const bmp of [a, b]) if (bmp) opened.push(bmp)
          content.push({ kind: cell.kind, a, b, seed: `${meta.code}:${i}:${cell.round}` })
        }
        const composed = await renderStrip(content, template, meta)
        const png = await canvasToBlob(composed, 'image/png')
        if (cancelled) return
        objectUrl = URL.createObjectURL(png)
        setCanvas(composed)
        setUrl(objectUrl)
        setError(false)
      } catch {
        if (!cancelled) setError(true)
      } finally {
        opened.forEach((bmp) => bmp.close())
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [key, template, meta, latest])

  return { url, canvas, error }
}
```

Replace `src/client/screens/Result.tsx` (Task 6 turns it into the full STYLE/DONE screen; this version is the compile-level minimum — strip, filter, file type, download, share):
```tsx
import { useMemo, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { TemplateId } from '../../shared/plan'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { useToast } from '../components/BrutalToast'
import type { ConnKind } from '../components/ConnectionStatus'
import { FilterPicker } from '../components/FilterPicker'
import { PhotoStrip } from '../components/PhotoStrip'
import { useStrip } from '../hooks/useStrip'
import type { FilterId } from '../lib/filters'
import { canvasToBlob } from '../lib/photo'
import { downloadBlob, formatStripDate, shareImage } from '../lib/strip'
import type { CellBlobs } from '../lib/takes'

interface Props {
  code: string
  status: ConnKind
  template: TemplateId
  cells: readonly CellBlobs[]
  partnerHere: boolean
}

export function Result({ code, status, template, cells, partnerHere }: Props) {
  const toast = useToast()
  const [filter, setFilter] = useState<FilterId>('original')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const meta = useMemo(() => ({ code, filter, dateLabel: formatStripDate(new Date()) }), [code, filter])
  const { url, canvas, error } = useStrip(cells, template, meta)
  const filename = `${APP_NAME.toLowerCase()}-${code}-${template}.${format}`

  async function encode(): Promise<Blob | null> {
    return canvas ? canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.92) : null
  }
  async function download() {
    const blob = await encode()
    if (blob) downloadBlob(blob, filename)
  }
  async function share() {
    const blob = await encode()
    if (!blob) return
    if ((await shareImage(blob, filename, 'Made in the booth.')) === 'unsupported') {
      downloadBlob(blob, filename)
      toast('PHOTO SAVED.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={code} status={status} hasPhotos />
      <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter">LOOK WHAT YOU MADE.</h1>
      {!partnerHere && (
        <BrutalCard tone="orange" className="p-3 text-lg font-black uppercase" role="status">
          THEY LEFT :( SAVE YOUR STRIP BEFORE YOU GO.
        </BrutalCard>
      )}

      <PhotoStrip url={url} error={error} />

      <BrutalCard heavy className="flex flex-col gap-5 p-4">
        <FilterPicker value={filter} onChange={setFilter} />
        <BrutalRadioGroup
          legend="File type"
          name="format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
          ]}
        />
      </BrutalCard>

      <BrutalButton tone="yellow" size="xl" className="w-full" disabled={!canvas} onClick={() => void download()}>
        DOWNLOAD PHOTO
      </BrutalButton>
      <BrutalButton tone="pink" className="w-full" disabled={!canvas} onClick={() => void share()}>
        SHARE
      </BrutalButton>
    </main>
  )
}
```

Edit `src/client/pages/Booth.tsx` (read it first; apply each replacement exactly once):

1. Replace `import { completeRound, mergePhoto, pushRound, type Pending, type Round } from '../lib/rounds'` with
```ts
import { completeRound, finishedOf, highestReferenced, mergePhoto, pruneStore, putRound, type Pending, type TakeStore } from '../lib/takes'
```
and add `import { defaultPlan } from '../../shared/plan'` after the `import { SYNC_BURST_READY } from '../../shared/constants'` line.
2. After the `const cameraProblem: Record<CameraError, ProblemKind> = {…}` block add:
```ts
/** Stable reference for "no room-state yet", so effects keyed on the plan do not fire every render. */
const NO_PLAN = defaultPlan()
```
3. Replace `const [rounds, setRounds] = useState<Round[]>([])` with
```ts
  const [store, setStore] = useState<TakeStore>(new Map())
  const highestSeen = useRef(-1) // the newest round any plan has mentioned: anything newer is a photo pair still waiting to be recorded
```
4. Directly above the comment `// A photo from either side lands here; when both halves of a round exist it is stored and reported.` insert:
```ts
  const plan = room.state?.plan ?? NO_PLAN
  // Keep only the photos the plan still needs; the store is the one place photos live.
  useEffect(() => {
    highestSeen.current = Math.max(highestSeen.current, highestReferenced(plan))
    setStore((s) => pruneStore(s, plan, highestSeen.current))
  }, [plan])

```
5. Replace `setRounds((all) => pushRound(all, done))` with `setStore((all) => putRound(all, done))`.
6. Replace the beforeunload effect's guard and deps: `if (rounds.length === 0) return` → `if (store.size === 0) return`, and `}, [rounds.length])` → `}, [store.size])`.
7. Replace `const hasPhotos = rounds.length > 0` with `const hasPhotos = store.size > 0`.
8. Replace the block starting `const latest = rounds[rounds.length - 1]` through the closing brace of `if (latest && !roundInFlight) { … }` with:
```ts
  const roundInFlight = room.status === 'open' && room.state?.phase === 'capture'
  const finished = finishedOf(plan, store)
  if (finished && !roundInFlight) {
    return (
      <Result
        code={code}
        status={status}
        template={finished.template}
        cells={finished.cells}
        partnerHere={Boolean(partner?.connected)}
      />
    )
  }
```

- [ ] **Step 9: Verify the whole client builds and the suites are green**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all exit 0 (the `style-rules` test must stay green — no forbidden words in the new files).

- [ ] **Step 10: Commit**

```bash
git add src/client/lib/palette.ts src/client/lib/palette.test.ts src/client/lib/takes.ts src/client/lib/takes.test.ts src/client/lib/photo.ts src/client/lib/photo.test.ts src/client/lib/strip.ts src/client/lib/strip.test.ts src/client/hooks/useStrip.ts src/client/screens/Result.tsx src/client/pages/Booth.tsx
git add -u src/client/lib/rounds.ts src/client/lib/rounds.test.ts
git commit -m "refactor: drive the strip from template geometry, per-cell content and a plan-pruned take store"
```

---

## Task 4: The format step — stage chips, template cards, per-cell kinds

**Files:**
- Create: `src/client/lib/labels.ts`, `src/client/lib/labels.test.ts`, `src/client/components/Steps.tsx`, `src/client/components/TemplateDiagram.tsx`, `src/client/screens/ReadyCard.tsx`, `src/client/screens/FormatPanel.tsx`, `e2e/format.spec.ts`
- Modify: `src/client/screens/Stage.tsx`, `src/client/pages/Booth.tsx`, `e2e/helpers.ts`

**Interfaces:**
- Consumes: `Plan`, `PlanAction`, `TEMPLATE_IDS`, `TEMPLATES`, `CELL_KINDS`, `Stage` (Task 1); `RoomState.plan` (Task 2).
- Produces:
  - `labels.ts`: `STEPS` (`['FORMAT','SHOOT','PICK','STYLE']`), `stepIndex(stage: Stage): number`, `TEMPLATE_LABEL: Record<TemplateId, { title: string; sub: string }>`, `kindLabel(kind: CellKind, mySlot: SlotName | null): string`.
  - Components: `Steps({ stage })`, `TemplateDiagram({ template, size? })`, `ReadyCard` (props below), `FormatPanel`.
  - `Stage` new props: `plan: Plan`, `mySlot: SlotName | null`, `canEdit: boolean`, `onPlan: (action: PlanAction) => void`. `Booth` passes them and gates READY on a chosen template.
  - e2e helpers: `chooseTemplate(page, key)`, `TemplateKey`, `CELLS`.

- [ ] **Step 1: Failing tests for the labels**

`src/client/lib/labels.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { TEMPLATE_IDS } from '../../shared/plan'
import { kindLabel, STEPS, stepIndex, TEMPLATE_LABEL } from './labels'

describe('stepIndex', () => {
  it('maps every stage to a chip; done shares the STYLE chip', () => {
    expect(STEPS).toEqual(['FORMAT', 'SHOOT', 'PICK', 'STYLE'])
    expect(['format', 'shoot', 'pick', 'done'].map((s) => stepIndex(s as never))).toEqual([0, 1, 2, 3])
  })
})

describe('kindLabel', () => {
  it('names USER 1, USER 2 and TOGETHER, and marks your own side', () => {
    expect(kindLabel('a', 'a')).toBe('USER 1 (YOU)')
    expect(kindLabel('a', 'b')).toBe('USER 1')
    expect(kindLabel('b', 'b')).toBe('USER 2 (YOU)')
    expect(kindLabel('both', 'a')).toBe('TOGETHER')
    expect(kindLabel('a', null)).toBe('USER 1')
  })
})

describe('TEMPLATE_LABEL', () => {
  it('labels every template', () => {
    for (const id of TEMPLATE_IDS) {
      expect(TEMPLATE_LABEL[id].title.length).toBeGreaterThan(0)
      expect(TEMPLATE_LABEL[id].sub.length).toBeGreaterThan(0)
    }
  })
})
```
Run: `npx vitest run src/client/lib/labels.test.ts` — expected FAIL (module missing).

- [ ] **Step 2: Write `labels.ts`**

`src/client/lib/labels.ts`:
```ts
import type { CellKind, Stage, TemplateId } from '../../shared/plan'
import type { SlotName } from '../../shared/protocol'

export const STEPS = ['FORMAT', 'SHOOT', 'PICK', 'STYLE'] as const

/** `done` is the STYLE chip: the finished strip, where background, filter and retake live. */
export function stepIndex(stage: Stage): number {
  switch (stage) {
    case 'format':
      return 0
    case 'shoot':
      return 1
    case 'pick':
      return 2
    case 'done':
      return 3
  }
}

export const TEMPLATE_LABEL: Record<TemplateId, { title: string; sub: string }> = {
  strip4: { title: '4 CUT', sub: 'THE CLASSIC STRIP' },
  grid4: { title: '2 × 2', sub: 'FOUR, ON A CARD' },
  duo2: { title: '2 CUT', sub: 'TWO BIG PHOTOS' },
  polaroid: { title: 'POLAROID', sub: 'ONE SHOT' },
}

const KIND_LABEL: Record<CellKind, string> = { a: 'USER 1', b: 'USER 2', both: 'TOGETHER' }

/** USER 1 is slot a (the booth's creator), USER 2 is slot b. Your own side is marked so nobody has to count. */
export function kindLabel(kind: CellKind, mySlot: SlotName | null): string {
  return kind !== 'both' && kind === mySlot ? `${KIND_LABEL[kind]} (YOU)` : KIND_LABEL[kind]
}
```
Run: `npx vitest run src/client/lib/labels.test.ts` — expected PASS.

- [ ] **Step 3: Components — `Steps`, `TemplateDiagram`, `ReadyCard`, `FormatPanel`**

`src/client/components/Steps.tsx`:
```tsx
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
```

`src/client/components/TemplateDiagram.tsx`:
```tsx
import { TEMPLATES, type TemplateId } from '../../shared/plan'

/** A small picture of a template: white cells in a black frame, in the proportions of the real strip. */
export function TemplateDiagram({ template, size = 80 }: { template: TemplateId; size?: number }) {
  const { cols, rows } = TEMPLATES[template]
  const width = (size * (cols * 4)) / (rows * 3) // cells are 4:3
  return (
    <div
      aria-hidden="true"
      className="grid gap-1 border-[3px] border-ink bg-ink p-1"
      style={{ width, height: size, gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <span key={i} className="bg-white" />
      ))}
    </div>
  )
}
```

`src/client/screens/ReadyCard.tsx`:
```tsx
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
```

`src/client/screens/FormatPanel.tsx`:
```tsx
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
```

- [ ] **Step 4: Make `Stage` stage-aware**

Read `src/client/screens/Stage.tsx`, then replace the file with:
```tsx
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
  mySlot: SlotName | null
  /** Plan actions are accepted right now: two people present and no round in flight. */
  canEdit: boolean
  onPlan: (action: PlanAction) => void
}

export function Stage(p: Props) {
  const takeNo = (p.plan.takes[p.plan.cell]?.length ?? 0) + 1
  const noTakesYet = p.plan.takes.every((t) => t.length === 0)

  const ready = (heading: string, extra?: ReactNode) => (
    <ReadyCard heading={heading} me={p.me} partner={p.partner} canReady={p.canReady} onReady={p.onReady} canFlip={p.canFlip} onFlip={p.onFlip}>
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
      ) : (
        panel()
      )}
    </main>
  )
}
```
(The `default` branch covers `pick` and `done` for now; Task 5 replaces the `pick` case, and `done` is rendered by `Result`.)

- [ ] **Step 5: Wire `Booth`**

Edit `src/client/pages/Booth.tsx`:
1. Change `import { defaultPlan } from '../../shared/plan'` to `import { defaultPlan, type PlanAction } from '../../shared/plan'`.
2. Directly after the `const plan = room.state?.plan ?? NO_PLAN` line add:
```ts
  const sendPlan = useCallback((action: PlanAction) => void room.send({ type: 'plan', action }), [room.send])
```
3. In the `<Stage …/>` element, replace `canReady={sync.synced && rtc.peerState === 'connected' && rtc.channelOpen}` with
```tsx
      canReady={sync.synced && rtc.peerState === 'connected' && rtc.channelOpen && (plan.stage !== 'format' || plan.template !== null)}
```
and add these props just before `captured={captured}`'s closing `/>` (after `captured={captured}`):
```tsx
      plan={plan}
      mySlot={mySlot ?? null}
      canEdit={room.status === 'open' && room.state?.phase === 'ready'}
      onPlan={sendPlan}
```

- [ ] **Step 6: e2e helper and spec for the format step**

In `e2e/helpers.ts` append:
```ts

export const CELLS = { strip4: 4, grid4: 4, duo2: 2, polaroid: 1 } as const
export type TemplateKey = keyof typeof CELLS
const TEMPLATE_NAME: Record<TemplateKey, RegExp> = { strip4: /4 cut/i, grid4: /2 × 2/, duo2: /2 cut/i, polaroid: /polaroid/i }

/** Pick a format from the cards. Either person can; the other's screen follows. */
export async function chooseTemplate(page: Page, template: TemplateKey): Promise<void> {
  await page.getByRole('radio', { name: TEMPLATE_NAME[template] }).check()
}
```

`e2e/format.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { chooseTemplate, closePlayers, connectedPair, pressReady } from './helpers'

test.afterEach(closePlayers)

test('READY waits for a format, and either person can choose it for both', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'PICK A FORMAT' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'FORMAT' })).toHaveAttribute('aria-current', 'step')
    await expect(page.getByRole('button', { name: /i'm ready/i })).toBeDisabled()
  }

  await chooseTemplate(b, 'grid4') // the joiner picks: either of them can
  await expect(a.getByRole('radio', { name: /2 × 2/ })).toBeChecked()
  await expect(a.getByRole('group', { name: /cell 4/i })).toBeVisible()
  await expect(a.getByRole('button', { name: /i'm ready/i })).toBeEnabled()
})

test('each cell can be USER 1, USER 2 or TOGETHER, and both screens agree', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await b.getByRole('group', { name: /cell 2/i }).getByRole('radio', { name: /user 1/i }).check()
  await expect(a.getByRole('group', { name: /cell 2/i }).getByRole('radio', { name: /user 1/i })).toBeChecked()
  await expect(a.getByRole('group', { name: /cell 1/i }).getByRole('radio', { name: /together/i })).toBeChecked()
  // Slot a is USER 1: it is marked as you on A's screen and not on B's.
  await expect(a.getByRole('radio', { name: 'USER 1 (YOU)' }).first()).toBeVisible()
  await expect(b.getByRole('radio', { name: 'USER 2 (YOU)' }).first()).toBeVisible()
})

// Review Focus 1: nobody stays committed to a plan they did not see.
test('changing the format clears a READY that was already pressed', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await pressReady(a)
  await expect(a.getByText('YOU READY ✓')).toBeVisible()
  await expect(b.getByText('THEM READY ✓')).toBeVisible()

  await chooseTemplate(b, 'polaroid')
  await expect(a.getByText('YOU NOT READY')).toBeVisible()
  await expect(b.getByText('THEM WAITING...')).toBeVisible()
})
```

- [ ] **Step 7: Run everything that can run now**

Run: `npm run typecheck && npm run lint && npm test` — expected exit 0.
Run: `npx playwright test e2e/format.spec.ts`
Expected: 3 passed. (If a locator matches more than one element, tighten the locator in the spec, not the UI.)

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/labels.ts src/client/lib/labels.test.ts src/client/components/Steps.tsx src/client/components/TemplateDiagram.tsx src/client/screens/ReadyCard.tsx src/client/screens/FormatPanel.tsx src/client/screens/Stage.tsx src/client/pages/Booth.tsx e2e/helpers.ts e2e/format.spec.ts
git commit -m "feat: add the format step with template cards, per-cell kinds and stage chips"
```

---

## Task 5: Shoot and pick — takes, thumbnails, keep, one more take

**Files:**
- Create: `src/client/hooks/useBlobUrl.ts`, `src/client/components/PhotoThumb.tsx`, `src/client/screens/PickPanel.tsx`, `e2e/takes.spec.ts`
- Modify: `src/client/screens/Stage.tsx`, `src/client/pages/Booth.tsx`, `e2e/helpers.ts`

**Interfaces:**
- Consumes: `Plan`, `MAX_TAKES`, `TakeStore`/`Round` (Task 3), `ReadyCard` (Task 4), `Stage` props (Task 4).
- Produces:
  - `useBlobUrl(blob: Blob | undefined): string | null`
  - `PhotoThumb({ kind, a, b, className? })` — a still of a cell: one person's photo, or both side by side exactly like the strip's split cell.
  - `PickPanel({ plan, store, canEdit, onPlan, children })`
  - `Stage` new prop `store: TakeStore`.
  - e2e helpers: `shootCell(a, b, takes?)`, `keepCell(a, b)`, `finishSession(a, b, template?)`.

- [ ] **Step 1: The e2e spec first (it fails: there is no pick panel)**

Append to `e2e/helpers.ts` (add `expect` is already imported there):
```ts

const KEEP = /keep this one/i

/** Shoot `takes` rounds of the current cell (both press ready each time), then wait for the pick panel on both screens. */
export async function shootCell(a: Page, b: Page, takes = 2): Promise<void> {
  for (let t = 0; t < takes; t++) {
    await pressReady(a)
    await pressReady(b)
  }
  for (const page of [a, b]) await expect(page.getByRole('button', { name: KEEP })).toBeVisible({ timeout: 40_000 })
}

/** Both agree on the pick (the preselected, newest take unless someone changed it). */
export async function keepCell(a: Page, b: Page): Promise<void> {
  await a.getByRole('button', { name: KEEP }).click()
  await b.getByRole('button', { name: KEEP }).click()
}

/** The whole session: pick a format, shoot and keep every cell. Ends on the finished strip on both screens. */
export async function finishSession(a: Page, b: Page, template: TemplateKey = 'duo2'): Promise<void> {
  await chooseTemplate(a, template)
  for (let cell = 0; cell < CELLS[template]; cell++) {
    await shootCell(a, b)
    await keepCell(a, b)
  }
  for (const page of [a, b]) await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
}
```

`e2e/takes.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { chooseTemplate, closePlayers, connectedPair, keepCell, pressReady, shootCell } from './helpers'

test.afterEach(closePlayers)

test('two takes, then either person changes the pick for both, and the strip is built from the kept takes', async ({ browser }) => {
  test.setTimeout(120_000)
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'polaroid')

  await pressReady(a)
  await pressReady(b)
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 1 · TAKE 2/)).toBeVisible({ timeout: 30_000 })
  await pressReady(a)
  await pressReady(b)

  for (const page of [a, b]) {
    await expect(page.getByRole('button', { name: /keep this one/i })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /take 2, kept/i })).toBeVisible() // the newest is preselected
  }
  await a.getByRole('button', { name: /^take 1$/i }).click()
  await expect(b.getByRole('button', { name: /take 1, kept/i })).toBeVisible()
  await expect(b.getByRole('button', { name: /take 2, kept/i })).toHaveCount(0)

  await keepCell(a, b)
  for (const page of [a, b]) {
    await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
    const strip = page.getByRole('img', { name: 'Photo strip' })
    await expect(strip).toBeVisible()
    expect(await strip.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1032])
  }
})

test('ONE MORE TAKE adds a third, and is then refused', async ({ browser }) => {
  test.setTimeout(120_000)
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'polaroid')
  await shootCell(a, b)

  await expect(a.getByRole('button', { name: /one more take/i })).toBeEnabled()
  await a.getByRole('button', { name: /one more take/i }).click()
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 1 · TAKE 3/)).toBeVisible()

  await pressReady(a)
  await pressReady(b)
  for (const page of [a, b]) {
    await expect(page.getByRole('button', { name: /take 3, kept/i })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /one more take/i })).toBeDisabled()
  }
})

test('CHANGE FORMAT goes away once a take exists', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await pressReady(a)
  await pressReady(b)
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 2 · TAKE 2/)).toBeVisible({ timeout: 30_000 })
  await expect(a.getByRole('button', { name: 'CHANGE FORMAT' })).toHaveCount(0) // a take exists now
})
```
Run: `npx playwright test e2e/takes.spec.ts`
Expected: FAIL (no pick panel: `keep this one` never appears).

- [ ] **Step 2: The pieces — `useBlobUrl`, `PhotoThumb`, `PickPanel`**

`src/client/hooks/useBlobUrl.ts`:
```ts
import { useEffect, useState } from 'react'

/** An object URL for a Blob, revoked when the Blob changes or the component goes away. */
export function useBlobUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  return url
}
```

`src/client/components/PhotoThumb.tsx`:
```tsx
import type { CellKind } from '../../shared/plan'
import { useBlobUrl } from '../hooks/useBlobUrl'

interface Props {
  kind: CellKind
  a?: Blob
  b?: Blob
  className?: string
}

/**
 * A still of one cell: USER 1's photo, USER 2's, or both side by side. `object-cover` on a half-width box is the
 * same centred crop the strip uses for a TOGETHER cell, so what you pick is what you get.
 */
export function PhotoThumb({ kind, a, b, className = '' }: Props) {
  const urlA = useBlobUrl(kind === 'b' ? undefined : a)
  const urlB = useBlobUrl(kind === 'a' ? undefined : b)
  return (
    <span className={`flex aspect-[4/3] w-full overflow-hidden border-[3px] border-ink bg-ink ${className}`}>
      {urlA && <img src={urlA} alt="" className={`h-full object-cover ${kind === 'both' ? 'w-1/2' : 'w-full'}`} />}
      {urlB && <img src={urlB} alt="" className={`h-full object-cover ${kind === 'both' ? 'w-1/2' : 'w-full'}`} />}
    </span>
  )
}
```

`src/client/screens/PickPanel.tsx`:
```tsx
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
```

- [ ] **Step 3: Use it in `Stage` and `Booth`**

Edit `src/client/screens/Stage.tsx`:
1. Add imports: `import type { TakeStore } from '../lib/takes'` and `import { PickPanel } from './PickPanel'`.
2. Add `store: TakeStore` to `Props` (after `plan: Plan`).
3. Extend the `ready` helper so the label can differ — replace its definition with:
```tsx
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
```
4. In `panel()`, add this case between `'shoot'` and `default`:
```tsx
      case 'pick':
        return (
          <PickPanel plan={p.plan} store={p.store} canEdit={p.canEdit} onPlan={p.onPlan}>
            {ready('SAME PICK FOR BOTH?', null, { idle: 'KEEP THIS ONE', done: 'KEPT ✓' })}
          </PickPanel>
        )
```

Edit `src/client/pages/Booth.tsx`: in `<Stage …/>` add `store={store}` right after the `plan={plan}` prop.

- [ ] **Step 4: Run the checks and the new spec**

Run: `npm run typecheck && npm run lint && npm test` — expected exit 0.
Run: `npx playwright test e2e/takes.spec.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/client/hooks/useBlobUrl.ts src/client/components/PhotoThumb.tsx src/client/screens/PickPanel.tsx src/client/screens/Stage.tsx src/client/pages/Booth.tsx e2e/helpers.ts e2e/takes.spec.ts
git commit -m "feat: shoot two or three takes per cell and keep the best one together"
```

---

## Task 6: The STYLE/DONE screen — retake a cell, partner notices, lost photos

**Files:**
- Create: `e2e/style.spec.ts`
- Modify: `src/client/screens/Result.tsx`, `src/client/screens/Stage.tsx`, `src/client/pages/Booth.tsx`

**Interfaces:**
- Consumes: `Finished`, `finishedOf`, `missingRounds` (Task 3), `Steps` (Task 4), `PhotoThumb` (Task 5), `BrutalModal`, plan actions `retake` / `reset` (Task 1).
- Produces:
  - `Result` props: `{ code, status, template, cells, partnerHere, canRetake, onRetake(cell: number), notice?: { text: string; action: string; onAction: () => void } }`.
  - `Stage` new props `lostPhotos: boolean`, `onStartOver: () => void`.
  - `Booth` keeps a snapshot of the last finished strip, so the STYLE/DONE screen never disappears when the plan changes underneath it.

- [ ] **Step 1: The e2e spec first (fails: no retake buttons)**

`e2e/style.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { closePlayers, connectedPair, enterBooth, finishSession, keepCell, shootCell } from './helpers'

test.afterEach(closePlayers)

test('retaking one cell re-shoots only that cell, and the partner is told and can still save the old strip', async ({ browser }) => {
  test.setTimeout(240_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'duo2')
  const strip = a.getByRole('img', { name: 'Photo strip' })
  await expect(strip).toBeVisible()
  const before = await strip.getAttribute('src')

  await expect(a.getByRole('heading', { name: 'NOT HAPPY WITH A CELL?' })).toBeVisible()
  await a.getByRole('button', { name: 'RETAKE 2' }).click()
  await expect(a.getByText('THIS REPLACES CELL 2.')).toBeVisible()
  await a.getByRole('button', { name: 'YES, RETAKE' }).click()

  // B is looking at the finished strip: it stays, with a notice and a way to join.
  await expect(b.getByText("THEY'RE RETAKING A CELL.")).toBeVisible()
  await expect(b.getByRole('button', { name: 'DOWNLOAD PHOTO' })).toBeEnabled()
  await b.getByRole('button', { name: 'JOIN THEM' }).click()

  for (const page of [a, b]) await expect(page.getByText(/CELL 2 OF 2 · TAKE 1/)).toBeVisible()
  await shootCell(a, b)
  await keepCell(a, b)
  for (const page of [a, b]) await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => strip.getAttribute('src')).not.toBe(before)
})

// Review Focus 2: a reload loses this tab's photos; the partner's strip must survive the start-over.
test('a reloaded tab says its photos are gone, and starting over does not take the strip away from the partner', async ({ browser }) => {
  test.setTimeout(180_000)
  const { a, b, url } = await connectedPair(browser)
  await finishSession(a, b, 'polaroid')

  b.on('dialog', (dialog) => void dialog.accept()) // the "photos live only in this tab" beforeunload prompt
  await b.goto(url)
  await enterBooth(b)
  await expect(b.getByText('YOUR PHOTOS WERE LOST WHEN THIS PAGE RELOADED')).toBeVisible()
  await b.getByRole('button', { name: 'START OVER' }).click()

  await expect(a.getByText('THEY STARTED OVER. SAVE YOUR STRIP.')).toBeVisible()
  const [download] = await Promise.all([a.waitForEvent('download'), a.getByRole('button', { name: 'DOWNLOAD PHOTO' }).click()])
  expect(download.suggestedFilename()).toMatch(/\.png$/)
  await a.getByRole('button', { name: 'NEW STRIP' }).click()
  await expect(a.getByRole('heading', { name: 'PICK A FORMAT' })).toBeVisible()
})
```
Run: `npx playwright test e2e/style.spec.ts`
Expected: FAIL (no `NOT HAPPY WITH A CELL?` heading).

- [ ] **Step 2: Replace `Result` with the full STYLE/DONE screen**

Replace `src/client/screens/Result.tsx`:
```tsx
import { useMemo, useState } from 'react'
import { APP_NAME } from '../../shared/constants'
import type { TemplateId } from '../../shared/plan'
import { BoothHeader } from '../components/BoothHeader'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalModal } from '../components/BrutalModal'
import { BrutalRadioGroup } from '../components/BrutalRadioGroup'
import { useToast } from '../components/BrutalToast'
import type { ConnKind } from '../components/ConnectionStatus'
import { FilterPicker } from '../components/FilterPicker'
import { PhotoStrip } from '../components/PhotoStrip'
import { PhotoThumb } from '../components/PhotoThumb'
import { Steps } from '../components/Steps'
import { useStrip } from '../hooks/useStrip'
import type { FilterId } from '../lib/filters'
import { canvasToBlob } from '../lib/photo'
import { downloadBlob, formatStripDate, shareImage } from '../lib/strip'
import type { CellBlobs } from '../lib/takes'

interface Props {
  code: string
  status: ConnKind
  template: TemplateId
  cells: readonly CellBlobs[]
  partnerHere: boolean
  /** Retaking needs the partner present and no round in flight. */
  canRetake: boolean
  onRetake: (cell: number) => void
  /** Shown above the strip when the partner changed the plan while you were looking at it. */
  notice?: { text: string; action: string; onAction: () => void }
}

export function Result({ code, status, template, cells, partnerHere, canRetake, onRetake, notice }: Props) {
  const toast = useToast()
  const [filter, setFilter] = useState<FilterId>('original')
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [confirming, setConfirming] = useState<number | null>(null)
  const meta = useMemo(() => ({ code, filter, dateLabel: formatStripDate(new Date()) }), [code, filter])
  const { url, canvas, error } = useStrip(cells, template, meta)
  const filename = `${APP_NAME.toLowerCase()}-${code}-${template}.${format}`

  async function encode(): Promise<Blob | null> {
    return canvas ? canvasToBlob(canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.92) : null
  }
  async function download() {
    const blob = await encode()
    if (blob) downloadBlob(blob, filename)
  }
  async function share() {
    const blob = await encode()
    if (!blob) return
    if ((await shareImage(blob, filename, 'Made in the booth.')) === 'unsupported') {
      downloadBlob(blob, filename)
      toast('PHOTO SAVED.')
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <BoothHeader code={code} status={status} hasPhotos />
      <Steps stage="done" />
      <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter">LOOK WHAT YOU MADE.</h1>
      {notice && (
        <BrutalCard tone="orange" className="flex flex-col gap-3 p-3" role="status">
          <p className="text-lg font-black uppercase">{notice.text}</p>
          <BrutalButton tone="ink" onClick={notice.onAction}>
            {notice.action}
          </BrutalButton>
        </BrutalCard>
      )}
      {!partnerHere && (
        <BrutalCard tone="orange" className="p-3 text-lg font-black uppercase" role="status">
          THEY LEFT :( SAVE YOUR STRIP BEFORE YOU GO.
        </BrutalCard>
      )}

      <PhotoStrip url={url} error={error} />

      <BrutalCard heavy className="flex flex-col gap-5 p-4">
        <FilterPicker value={filter} onChange={setFilter} />
        <BrutalRadioGroup
          legend="File type"
          name="format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpg', label: 'JPG' },
          ]}
        />
      </BrutalCard>

      <BrutalButton tone="yellow" size="xl" className="w-full" disabled={!canvas} onClick={() => void download()}>
        DOWNLOAD PHOTO
      </BrutalButton>
      <BrutalButton tone="pink" className="w-full" disabled={!canvas} onClick={() => void share()}>
        SHARE
      </BrutalButton>

      <BrutalCard tone="lime" heavy className="flex flex-col gap-3 p-4">
        <h2 className="text-xl font-black uppercase leading-none">NOT HAPPY WITH A CELL?</h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
          {cells.map((cell, i) => (
            <li key={`${i}-${cell.round}`} className="flex flex-col gap-2">
              <PhotoThumb kind={cell.kind} a={cell.a} b={cell.b} />
              <BrutalButton tone="paper" disabled={!canRetake} onClick={() => setConfirming(i)}>
                {`RETAKE ${i + 1}`}
              </BrutalButton>
            </li>
          ))}
        </ul>
      </BrutalCard>

      <BrutalModal open={confirming !== null} onClose={() => setConfirming(null)} title="Retake this cell?">
        <p className="font-black uppercase leading-snug">THIS REPLACES CELL {(confirming ?? 0) + 1}.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <BrutalButton tone="lime" onClick={() => setConfirming(null)}>
            KEEP IT
          </BrutalButton>
          <BrutalButton
            tone="pink"
            onClick={() => {
              if (confirming !== null) onRetake(confirming)
              setConfirming(null)
            }}
          >
            YES, RETAKE
          </BrutalButton>
        </div>
      </BrutalModal>
    </main>
  )
}
```

- [ ] **Step 3: A lost-photos card in `Stage`**

Edit `src/client/screens/Stage.tsx`:
1. Add `lostPhotos: boolean` and `onStartOver: () => void` to `Props` (after `onPlan`).
2. In the JSX, replace the final `) : (\n        panel()\n      )}` with:
```tsx
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
```
(The existing `p.countdown ? … : p.exchanging ? … : (…)` chain keeps its first two branches.)

- [ ] **Step 4: `Booth` keeps the finished strip on screen**

Edit `src/client/pages/Booth.tsx` (these hooks must sit above the early `if (gate === …) return` lines):
1. Change the takes import to add `missingRounds` and the `Finished` type: `import { completeRound, finishedOf, highestReferenced, mergePhoto, missingRounds, pruneStore, putRound, type Finished, type Pending, type TakeStore } from '../lib/takes'`.
2. Directly after the prune `useEffect` (the one ending `}, [plan])`) insert:
```ts
  // The finished strip is the one thing that cannot be recreated. Remember the last one, so it stays on screen
  // even if the partner starts over or retakes while you are still looking at it (spec §5).
  const live = useMemo(() => finishedOf(plan, store), [plan, store])
  const [snapshot, setSnapshot] = useState<Finished | null>(null)
  useEffect(() => {
    if (live) setSnapshot(live)
  }, [live])
```
3. Replace the block that starts `const roundInFlight = …` and ends with the closing brace of `if (finished && !roundInFlight) { … }` (added in Task 3) with:
```ts
  const roundInFlight = room.status === 'open' && room.state?.phase === 'capture'
  const shown = live ?? snapshot
  if (shown && !roundInFlight) {
    const partnerChanged = !live // the plan moved on without us: say so, keep the strip
    return (
      <Result
        code={code}
        status={status}
        template={shown.template}
        cells={shown.cells}
        partnerHere={Boolean(partner?.connected)}
        canRetake={room.status === 'open' && Boolean(partner?.connected) && room.state?.phase === 'ready'}
        onRetake={(cell) => {
          setSnapshot(null)
          sendPlan({ k: 'retake', cell })
        }}
        notice={
          partnerChanged
            ? plan.stage === 'format'
              ? { text: 'THEY STARTED OVER. SAVE YOUR STRIP.', action: 'NEW STRIP', onAction: () => setSnapshot(null) }
              : { text: "THEY'RE RETAKING A CELL.", action: 'JOIN THEM', onAction: () => setSnapshot(null) }
            : undefined
        }
      />
    )
  }
```
4. In the `<Stage …/>` element add, after `onPlan={sendPlan}`:
```tsx
      lostPhotos={plan.stage !== 'format' && missingRounds(plan, store).length > 0}
      onStartOver={() => {
        setSnapshot(null)
        sendPlan({ k: 'reset' })
      }}
```

- [ ] **Step 5: Run the checks and the spec**

Run: `npm run typecheck && npm run lint && npm test` — expected exit 0.
Run: `npx playwright test e2e/style.spec.ts`
Expected: 2 passed. (If the reload test hits a browser `beforeunload` prompt that Playwright does not accept, keep the `dialog` handler above; do not remove the app's prompt.)

- [ ] **Step 6: Commit**

```bash
git add src/client/screens/Result.tsx src/client/screens/Stage.tsx src/client/pages/Booth.tsx e2e/style.spec.ts
git commit -m "feat: retake a single cell, keep the finished strip on screen and recover from a reload"
```

---

## Task 7: Rework the old e2e specs, README, and close the phase gate

**Files:**
- Modify: `e2e/capture.spec.ts`, `e2e/photos.spec.ts`, `e2e/rounds.spec.ts`, `e2e/a11y.spec.ts`, `README.md`

**Interfaces:**
- Consumes: e2e helpers from Tasks 4–5 (`chooseTemplate`, `shootCell`, `keepCell`, `finishSession`, `CELLS`).
- Produces: a green full e2e suite; README describes the new session.

- [ ] **Step 1: See the current failures**

Run: `npm run test:e2e 2>&1 | tail -40`
Expected: FAIL in `capture`, `photos`, `rounds`, `a11y` (they press READY with no format, or expect the old single-round strip). `format`, `takes`, `style`, `connect`, `join`, `lobby`, `errors` pass.

- [ ] **Step 2: Rework `e2e/capture.spec.ts`**

Replace the file with:
```ts
import { expect, test } from '@playwright/test'
import { chooseTemplate, closePlayers, connectedPair, lastCapture, pressReady } from './helpers'

test.afterEach(closePlayers)

test('both browsers capture the same round at essentially the same moment', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await pressReady(a)
  await expect(a.getByText('YOU READY ✓')).toBeVisible()
  await pressReady(b)

  await expect(a.getByTestId('countdown')).toBeVisible()
  await expect(b.getByTestId('countdown')).toBeVisible()
  await expect(a.getByTestId('countdown')).toContainText('BOTH READY. GET READY.')

  await expect.poll(() => lastCapture(a), { timeout: 15_000 }).not.toBeNull()
  await expect.poll(() => lastCapture(b), { timeout: 15_000 }).not.toBeNull()
  const [ca, cb] = await Promise.all([lastCapture(a), lastCapture(b)])
  expect(ca?.round).toBe(1)
  expect(cb?.round).toBe(1)
  // Same machine ⇒ same wall clock ⇒ this measures real simultaneity, not just agreement on a timestamp.
  expect(Math.abs((ca?.wallAt ?? 0) - (cb?.wallAt ?? 0))).toBeLessThan(150)
})

test('a second take follows the first in the same cell', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await pressReady(a)
  await pressReady(b)
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 2 · TAKE 2/)).toBeVisible({ timeout: 30_000 })
  expect(await lastCapture(a)).toMatchObject({ round: 1 })

  await pressReady(a) // enabled once the server is back in `ready`
  await pressReady(b)
  await expect.poll(() => lastCapture(a), { timeout: 20_000 }).toMatchObject({ round: 2 })
  await expect.poll(() => lastCapture(b), { timeout: 20_000 }).toMatchObject({ round: 2 })
})

test('leaving during the countdown cancels the capture', async ({ browser }) => {
  const { a, b } = await connectedPair(browser)
  await chooseTemplate(a, 'duo2')
  await pressReady(a)
  await pressReady(b)
  await expect(a.getByTestId('countdown')).toBeVisible()

  await b.close()
  await expect(a.getByText('WAITING FOR YOUR PERSON...')).toBeVisible()
  await a.waitForTimeout(6000) // longer than the 4.5 s lead: the cancelled round must not fire
  expect(await lastCapture(a)).toBeNull()
})
```

- [ ] **Step 3: Rework `e2e/photos.spec.ts`**

Apply these edits to the existing file:
1. Change the helpers import to `import { chooseTemplate, closePlayers, connectedPair, createBooth, enterBooth, expectRemoteVideo, finishSession, lastCapture, newPlayer, pressReady } from './helpers'`.
2. Test `each person gets a photo strip…`: replace its three setup lines (`const { a, b } = …`, `await pressReady(a)`, `await pressReady(b)`) and the loop with:
```ts
  test.setTimeout(150_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'duo2')

  for (const page of [a, b]) {
    const strip = page.getByRole('img', { name: 'Photo strip' })
    await expect(strip).toBeVisible()
    expect(await strip.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([1056, 1800])
  }
```
and change the filename expectation to `expect(pngDownload.suggestedFilename()).toMatch(/^two-up-[A-HJ-KM-NP-Z2-9]{6}-duo2\.png$/)`.
3. Replace the whole test `horizontal layout changes the strip size; grid unlocks after a second round` with:
```ts
test('each format produces a strip of its own size', async ({ browser }) => {
  test.setTimeout(150_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'polaroid')
  expect(
    await a.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]),
  ).toEqual([1056, 1032])
})

test('a 2 × 2 card is 2064 × 1800', async ({ browser }) => {
  test.setTimeout(300_000)
  const { a, b } = await connectedPair(browser)
  await finishSession(a, b, 'grid4')
  expect(
    await a.getByRole('img', { name: 'Photo strip' }).evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]),
  ).toEqual([2064, 1800])
})
```
(The 4-cut size, 1056 × 3336, is asserted at unit level in `photo.test.ts`; an 8-take e2e run for it would only add minutes.)
4. In `the strip stays downloadable after the partner leaves`, `preview matches result…` (both), and `a filter re-renders the strip…`: replace each `await pressReady(a)\n  await pressReady(b)` start with the new flow:
   - strip-stays test and filter test: `test.setTimeout(150_000)` then `await finishSession(a, b, 'duo2')` (delete the old `pressReady` lines and the old `toBeVisible({ timeout: 30_000 })` wait on the strip, keep the later assertions).
   - the two `preview matches result` tests: insert `await chooseTemplate(a, 'duo2')` before the first `pressReady(a)`; the rest is unchanged (they only watch the first capture).

- [ ] **Step 4: Rework `e2e/rounds.spec.ts`**

1. Change the helpers import to `import { chooseTemplate, closePlayers, createBooth, enterBooth, expectRemoteVideo, finishSession, newPlayer, pressReady } from './helpers'`.
2. In `a capture message that arrives far too late…`: after `await expectRemoteVideo(b)` insert `await chooseTemplate(a, 'duo2')`; after the line `await expect(a.getByText("THAT ROUND DIDN'T WORK")).toBeVisible({ timeout: 60_000 })` … keep; add right after the two `toBeEnabled()` expectations:
```ts
  // Review Focus 3: the failed round recorded no take — both are still on take 1 of cell 1, and can still change format.
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 2 · TAKE 1/)).toBeVisible()
  await expect(a.getByRole('button', { name: 'CHANGE FORMAT' })).toBeVisible()
```
   and replace the final loop (`for (const page of [a, b]) { await expect(page.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })) … }`) with:
```ts
  for (const page of [a, b]) await expect(page.getByText(/CELL 1 OF 2 · TAKE 2/)).toBeVisible({ timeout: 30_000 })
```
3. In `the finished strip stays reachable when the partner connection dies…`: replace the two lines `await pressReady(a)\n  await pressReady(b)` with `await finishSession(a, b, 'polaroid')` and add `test.setTimeout(240_000)` as the first line (replace the existing `test.setTimeout(120_000)`).

- [ ] **Step 5: Rework `e2e/a11y.spec.ts`**

1. Change the helpers import to `import { BASE, chooseTemplate, closePlayers, connectedPair, createBooth, enterBooth, finishSession, newPlayer } from './helpers'` (drop `pressReady` only if it is no longer used in the file; keep it otherwise).
2. In `camera gate, lobby, stage, countdown and result have no violations`, replace
```ts
  await expectNoViolations(left, 'stage')
  await pressReady(left)
  await pressReady(right)
  await expect(left.getByRole('heading', { name: 'LOOK WHAT YOU MADE.' })).toBeVisible({ timeout: 30_000 })
  await expectNoViolations(left, 'result')
```
with
```ts
  await expectNoViolations(left, 'format step')
  await chooseTemplate(left, 'polaroid')
  await expectNoViolations(left, 'format step with cells')
  await finishSession(left, right, 'polaroid')
  await expectNoViolations(left, 'result')
```
and add `test.setTimeout(180_000)` as the first line of that test.

- [ ] **Step 6: Run the whole e2e suite and fix what is genuinely broken**

Run: `npm run test:e2e 2>&1 | tail -40`
Expected: all specs pass. If axe reports a violation on the new screens (typical: duplicate landmark/`aria` names, contrast), fix the **component**, not the spec — e.g. give the `<ol aria-label="Progress">` and the radio groups unique names, or change a tone to meet 4.5:1 — and re-run `a11y.spec.ts`.

- [ ] **Step 7: Update the README**

In `README.md`:
1. Replace the sentence in "Decisions and limits": `The grid layout needs two rounds (RETAKE once). Only the last two rounds are kept.` with
   `A session picks a format (4-cut, 2 × 2, 2-cut, Polaroid) and, per cell, USER 1, USER 2 or TOGETHER; each cell takes 2–3 takes and both people keep one; any single cell can be retaken from the finished screen. The shared choices live in the Durable Object as a small "plan" (enum ids and round numbers only); photos stay in the tabs.`
2. Replace the link line `Full design: [...2026-10-07-photobooth-design.md](...)\n(decisions D1–D23).` with
```
Full design: [`docs/superpowers/specs/2026-10-07-photobooth-design.md`](docs/superpowers/specs/2026-10-07-photobooth-design.md)
(decisions D1–D23) and [`docs/superpowers/specs/2026-10-08-format-and-style-design.md`](docs/superpowers/specs/2026-10-08-format-and-style-design.md)
(D24–D33: format, takes, retake, cutouts; supersedes D13/D14).
```
3. In "Privacy and security", change the first bullet's list to read `…room code, round counter, the two participant ids, ready flags, the shared booth plan (template, cell kinds, take round numbers) and timestamps. No names, IPs, media or photos.`
4. In the verification table, update the "Photo generation" row evidence to `strips 1056×1800 (2-cut) / 1056×1032 (Polaroid) / 2064×1800 (2 × 2) asserted in e2e; 4-cut 1056×3336 asserted at unit level; B&W filter verified by pixel sampling` and the "Two browsers simultaneously" row to `the full Playwright suite (run it: npm run test:e2e)`. Add one row after "Download": `| Format, takes, pick, retake | **verified here** | e2e: format cards and per-cell kinds sync to both screens; 2–3 takes; either person changes the kept take; retake one cell; reload loses photos → START OVER; partner's strip survives |`.
5. Update the date/count claims in the "Verification status" intro only if you re-ran everything (use today's date and the real counts from the final run).

- [ ] **Step 8: The phase gate**

Run, in order:
```bash
npm run check
npm run build
npm run test:e2e 2>&1 | tail -15
```
Expected: `check` exits 0 (typecheck, lint, all unit + worker tests), `build` succeeds, e2e reports every spec passed. Note the real counts for the README.

- [ ] **Step 9: Commit**

```bash
git add e2e/capture.spec.ts e2e/photos.spec.ts e2e/rounds.spec.ts e2e/a11y.spec.ts README.md
git commit -m "test: rework the e2e specs for the format and takes flow and document the new session"
```
