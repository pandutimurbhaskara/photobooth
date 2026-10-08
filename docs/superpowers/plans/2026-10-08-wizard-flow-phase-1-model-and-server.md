# Phase 1 — Model & server (Tasks 1–3)

> Part of `2026-10-08-wizard-flow.md`. **Read that master file first** (Global Constraints and Review Focus apply to every task here). Spec: `docs/superpowers/specs/2026-10-08-wizard-flow-design.md` §4 (plan), §5 (server and protocol), D36–D41.

**Phase goal:** the shared plan, the protocol and the Durable Object speak the new wizard model: steps, shots, frame slots, a per-person camera flag and a server-driven shot sequence. The client data layer (`takes.ts`, `labels.ts`) follows. No UI changes yet.

**Gate (all must pass before Phase 2):**
1. `npm test` green (unit + worker projects).
2. `npm run lint` green.
3. `npx tsc -p tsconfig.worker.json --noEmit` green.

`npm run typecheck` is **expected to fail in `src/client`** (the old screens still use the old plan shape) until Task 10 replaces them. That is by design; do not "fix" it here.

---

## Task 1: `shared/plan.ts` — steps, shots, slots, sequence functions

**Files:**
- Modify: `src/shared/constants.ts`, `src/shared/plan.ts` (rewrite), `src/shared/plan.test.ts` (rewrite)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (all exported from `src/shared/plan.ts` unless noted):
  - constants (`constants.ts`): `MAX_CELLS = 4`, `SEQUENCE_EXTRA_SHOTS = 2`, `SEQUENCE_SPARE_SHOTS = 3`, `MAX_SHOTS = 12`, `MAX_MISSES = 3`, `BURST_LEAD_MS = 3000`, and `EXCHANGE_TIMEOUT_MS = 12_000`; `MIN_TAKES` / `MAX_TAKES` removed.
  - `TEMPLATE_IDS`, `type TemplateId`, `TEMPLATES`, `cellsOf`, `CELL_KINDS`, `type CellKind` (unchanged)
  - `STEPS: readonly ['frame','shoot','pick','style','done']`, `type Step`
  - `interface Slot { shot: number | null; kind: CellKind }`
  - `interface Plan { v: number; step: Step; template: TemplateId | null; slots: Slot[]; shots: number[]; target: number; running: boolean; misses: number }`
  - `type PlanAction = { k: 'template'; template: TemplateId } | { k: 'go'; to: Step } | { k: 'fill'; slot: number; shot: number } | { k: 'kind'; slot: number; kind: CellKind } | { k: 'reset' }`
  - `defaultPlan(): Plan`, `isPlan(value: unknown): value is Plan`
  - `applyPlanAction(plan: Plan, action: PlanAction): Plan | null` (null = refused; accepted changes bump `v`)
  - `acceptsReady(plan: Plan): boolean`, `targetFor(plan: Plan): number`, `canShootMore(plan: Plan): boolean`
  - `startSequence(plan: Plan): Plan | null`, `recordShot(plan: Plan, round: number): Plan`, `missShot(plan: Plan): Plan`, `abortSequence(plan: Plan): Plan`
  - `parsePlanAction(raw: unknown): PlanAction | null`

- [ ] **Step 1: Update the constants**

In `src/shared/constants.ts`, replace the block
```ts
// Format & takes (spec D24–D28)
export const MIN_TAKES = 2
export const MAX_TAKES = 3
export const MAX_CELLS = 4
```
with
```ts
// Frames and the automatic shot sequence (spec D24, D38)
export const MAX_CELLS = 4
export const SEQUENCE_EXTRA_SHOTS = 2 // a sequence aims for frames + 2 shots, so Pick has spares to choose from
export const SEQUENCE_SPARE_SHOTS = 3 // "Shoot more" adds this many
export const MAX_SHOTS = 12 // per session
export const MAX_MISSES = 3 // skipped shots that end a sequence
export const BURST_LEAD_MS = 3000 // countdown before every shot after the first
```
and change `export const EXCHANGE_TIMEOUT_MS = 30_000` to
```ts
export const EXCHANGE_TIMEOUT_MS = 12_000 // a shot whose photos have not been exchanged by then is skipped
```

- [ ] **Step 2: Write the failing tests**

Replace the whole of `src/shared/plan.test.ts` with:
```ts
import { describe, expect, it } from 'vitest'
import { MAX_CELLS, MAX_MISSES, MAX_SHOTS } from './constants'
import {
  abortSequence,
  acceptsReady,
  applyPlanAction,
  canShootMore,
  cellsOf,
  defaultPlan,
  isPlan,
  missShot,
  parsePlanAction,
  recordShot,
  startSequence,
  STEPS,
  targetFor,
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
const atShoot = (t: TemplateId = 'duo2'): Plan => apply(chosen(t), { k: 'go', to: 'shoot' })
const running = (t: TemplateId = 'duo2'): Plan => must(startSequence(atShoot(t)))
const shoot = (plan: Plan, ...rounds: number[]): Plan => rounds.reduce((p, r) => recordShot(p, r), plan)
/** A plan at the pick step: the sequence ran to its target with rounds 1..target. */
const atPick = (t: TemplateId = 'duo2'): Plan => {
  const plan = running(t)
  return shoot(plan, ...Array.from({ length: plan.target }, (_, i) => i + 1))
}

describe('templates and steps', () => {
  it('have the cell counts of the reference and never exceed MAX_CELLS', () => {
    expect(cellsOf('strip4')).toBe(4)
    expect(cellsOf('grid4')).toBe(4)
    expect(cellsOf('duo2')).toBe(2)
    expect(cellsOf('polaroid')).toBe(1)
    for (const id of TEMPLATE_IDS) expect(cellsOf(id)).toBeLessThanOrEqual(MAX_CELLS)
  })
  it('run frame, shoot, pick, style, done', () => {
    expect([...STEPS]).toEqual(['frame', 'shoot', 'pick', 'style', 'done'])
  })
})

describe('frame step', () => {
  it('starts with no template and nothing shot', () => {
    expect(defaultPlan()).toEqual({ v: 0, step: 'frame', template: null, slots: [], shots: [], target: 0, running: false, misses: 0 })
  })
  it('choosing a template makes every frame "both" and empty', () => {
    const plan = chosen('grid4')
    expect(plan).toMatchObject({ v: 1, step: 'frame', template: 'grid4' })
    expect(plan.slots).toEqual(Array.from({ length: 4 }, () => ({ shot: null, kind: 'both' })))
  })
  it('changing the template rebuilds the frames', () => {
    expect(apply(chosen('grid4'), { k: 'template', template: 'polaroid' }).slots).toHaveLength(1)
  })
  it('a template chosen after shooting is pre-filled with the shots already taken', () => {
    const back = apply(atPick('duo2'), { k: 'go', to: 'frame' })
    const regrid = apply(back, { k: 'template', template: 'grid4' })
    expect(regrid.slots.map((s) => s.shot)).toEqual([1, 2, 3, 4])
    expect(regrid.slots.every((s) => s.kind === 'both')).toBe(true)
  })
  it('refuses a template outside the frame step', () => {
    expect(applyPlanAction(atShoot(), { k: 'template', template: 'grid4' })).toBeNull()
  })
})

describe('go (Next, Back and the stepper)', () => {
  it('needs a template to leave the frame step, and moves one step at a time', () => {
    expect(applyPlanAction(defaultPlan(), { k: 'go', to: 'shoot' })).toBeNull()
    expect(applyPlanAction(chosen(), { k: 'go', to: 'pick' })).toBeNull() // cannot skip a step
    expect(atShoot().step).toBe('shoot')
  })
  it('needs at least as many shots as frames to leave the shoot step', () => {
    expect(applyPlanAction(atShoot('polaroid'), { k: 'go', to: 'pick' })).toBeNull()
    const withShot: Plan = { ...atShoot('polaroid'), shots: [1] }
    expect(apply(withShot, { k: 'go', to: 'pick' }).step).toBe('pick')
  })
  it('needs every frame filled to leave the pick step', () => {
    const empty: Plan = { ...atPick('duo2'), slots: [{ shot: 1, kind: 'both' }, { shot: null, kind: 'both' }] }
    expect(applyPlanAction(empty, { k: 'go', to: 'style' })).toBeNull()
    expect(apply(atPick('duo2'), { k: 'go', to: 'style' }).step).toBe('style')
  })
  it('lets style move to done, and nothing move forward from done', () => {
    const style = apply(atPick(), { k: 'go', to: 'style' })
    const done = apply(style, { k: 'go', to: 'done' })
    expect(done.step).toBe('done')
    expect(applyPlanAction(done, { k: 'go', to: 'frame' })).not.toBeNull() // backwards is always fine
  })
  it('lets you go back any number of steps, but not stay put', () => {
    const style = apply(atPick(), { k: 'go', to: 'style' })
    expect(apply(style, { k: 'go', to: 'frame' }).step).toBe('frame')
    expect(applyPlanAction(style, { k: 'go', to: 'style' })).toBeNull()
  })
  // Review Focus 4: two people tapping Next at once — the second tap is a no-op, not an invalid move.
  it('refuses the same Next twice, so two simultaneous taps leave one valid step', () => {
    const first = apply(chosen(), { k: 'go', to: 'shoot' })
    expect(applyPlanAction(first, { k: 'go', to: 'shoot' })).toBeNull()
  })
  it('moves nothing while a sequence is running', () => {
    expect(applyPlanAction(running(), { k: 'go', to: 'frame' })).toBeNull()
  })
})

describe('the shot sequence', () => {
  it('accepts READY only at the shoot step, idle, with frames', () => {
    expect(acceptsReady(defaultPlan())).toBe(false)
    expect(acceptsReady(chosen())).toBe(false)
    expect(acceptsReady(atShoot())).toBe(true)
    expect(acceptsReady(running())).toBe(false)
    expect(acceptsReady(atPick())).toBe(false)
  })

  it('aims for frames + 2 shots, then 3 more each time, never above MAX_SHOTS', () => {
    expect(targetFor(atShoot('polaroid'))).toBe(3)
    expect(targetFor(atShoot('duo2'))).toBe(4)
    expect(targetFor(atShoot('strip4'))).toBe(6)
    expect(targetFor(atShoot('grid4'))).toBe(6)
    expect(targetFor({ ...atShoot('duo2'), shots: [1, 2, 3, 4] })).toBe(7) // enough already: "Shoot more"
    expect(targetFor({ ...atShoot('duo2'), shots: [1, 2] })).toBe(4) // an interrupted sequence resumes to the same target
    expect(targetFor({ ...atShoot('duo2'), shots: Array.from({ length: 10 }, (_, i) => i + 1) })).toBe(MAX_SHOTS)
  })

  it('starts a sequence: running, with its target, and no misses', () => {
    const plan = running('polaroid')
    expect(plan).toMatchObject({ running: true, target: 3, misses: 0, step: 'shoot' })
    expect(plan.v).toBe(atShoot('polaroid').v + 1)
  })
  it('does not start twice, outside the shoot step, or past the shot cap', () => {
    expect(startSequence(running())).toBeNull()
    expect(startSequence(chosen())).toBeNull()
    expect(startSequence({ ...atShoot(), shots: Array.from({ length: MAX_SHOTS }, (_, i) => i + 1) })).toBeNull()
    expect(canShootMore({ ...atShoot(), shots: Array.from({ length: MAX_SHOTS }, (_, i) => i + 1) })).toBe(false)
    expect(canShootMore(atShoot())).toBe(true)
  })

  it('records each shot, filling the first empty frame', () => {
    const one = shoot(running('duo2'), 1)
    expect(one.shots).toEqual([1])
    expect(one.slots.map((s) => s.shot)).toEqual([1, null])
    const two = shoot(one, 2)
    expect(two.slots.map((s) => s.shot)).toEqual([1, 2])
    const three = shoot(two, 3)
    expect(three.shots).toEqual([1, 2, 3])
    expect(three.slots.map((s) => s.shot)).toEqual([1, 2]) // spares stay spares
    expect(three.running).toBe(true)
  })
  it('ends at the target and moves to pick by itself', () => {
    const plan = atPick('duo2')
    expect(plan).toMatchObject({ running: false, step: 'pick', shots: [1, 2, 3, 4] })
    expect(plan.slots.map((s) => s.shot)).toEqual([1, 2])
    expect(atPick('polaroid').shots).toEqual([1, 2, 3])
  })
  it('ignores a duplicate round, and any shot when no sequence is running', () => {
    const one = shoot(running(), 1)
    expect(recordShot(one, 1)).toBe(one)
    const idle = atShoot()
    expect(recordShot(idle, 1)).toBe(idle)
  })

  // Review Focus 3: a slow or failed shot is skipped; three skips end the sequence without a half-recorded state.
  it('counts a missed shot and carries on', () => {
    const plan = missShot(running())
    expect(plan).toMatchObject({ running: true, misses: 1 })
  })
  it('ends after MAX_MISSES misses; with too few shots it stays on the shoot step', () => {
    let plan = shoot(running('duo2'), 1)
    for (let i = 0; i < MAX_MISSES; i++) plan = missShot(plan)
    expect(plan).toMatchObject({ running: false, step: 'shoot', misses: MAX_MISSES })
    expect(plan.shots).toEqual([1])
  })
  it('ends on pick after the misses when there are still enough shots', () => {
    let plan = shoot(running('duo2'), 1, 2)
    for (let i = 0; i < MAX_MISSES; i++) plan = missShot(plan)
    expect(plan).toMatchObject({ running: false, step: 'pick' })
  })
  it('ignores a miss when no sequence is running', () => {
    const idle = atShoot()
    expect(missShot(idle)).toBe(idle)
  })

  // Review Focus 2: someone leaves mid-sequence: stop (never leave `running` stuck), keep the shots.
  it('aborts a running sequence and keeps what was shot', () => {
    const plan = abortSequence(shoot(running('duo2'), 1))
    expect(plan).toMatchObject({ running: false, step: 'shoot', shots: [1] })
    expect(acceptsReady(plan)).toBe(true)
  })
  it('leaves an idle plan untouched when aborting', () => {
    const idle = atShoot()
    expect(abortSequence(idle)).toBe(idle)
  })

  it('"Shoot more" from the pick step aims 3 beyond the shots already taken', () => {
    const back = apply(atPick('duo2'), { k: 'go', to: 'shoot' })
    expect(must(startSequence(back)).target).toBe(7)
  })
})

describe('pick step', () => {
  it('fills a frame with a shot', () => {
    const plan = apply(atPick('duo2'), { k: 'fill', slot: 0, shot: 3 })
    expect(plan.slots.map((s) => s.shot)).toEqual([3, 2])
  })
  // Review Focus 5: a shot already used in another frame swaps with it.
  it('swaps when the shot is already used in another frame', () => {
    const plan = apply(atPick('duo2'), { k: 'fill', slot: 0, shot: 2 })
    expect(plan.slots.map((s) => s.shot)).toEqual([2, 1])
  })
  it('refuses a shot that was never taken, a frame that does not exist, and any fill outside the pick step', () => {
    expect(applyPlanAction(atPick('duo2'), { k: 'fill', slot: 0, shot: 99 })).toBeNull()
    expect(applyPlanAction(atPick('duo2'), { k: 'fill', slot: 2, shot: 1 })).toBeNull()
    expect(applyPlanAction(atPick('duo2'), { k: 'fill', slot: -1, shot: 1 })).toBeNull()
    expect(applyPlanAction(atShoot(), { k: 'fill', slot: 0, shot: 1 })).toBeNull()
  })
  it('sets who is in a frame, only at the pick step', () => {
    const plan = apply(atPick('duo2'), { k: 'kind', slot: 1, kind: 'a' })
    expect(plan.slots.map((s) => s.kind)).toEqual(['both', 'a'])
    expect(applyPlanAction(atPick('duo2'), { k: 'kind', slot: 2, kind: 'a' })).toBeNull()
    expect(applyPlanAction(atShoot(), { k: 'kind', slot: 0, kind: 'a' })).toBeNull()
  })
  it('the version bumps on every accepted change', () => {
    const pick = atPick()
    expect(apply(pick, { k: 'kind', slot: 0, kind: 'b' }).v).toBe(pick.v + 1)
  })
})

describe('reset', () => {
  it('goes back to the frame step keeping the template, with no shots and "both" frames', () => {
    const edited = apply(atPick('duo2'), { k: 'kind', slot: 0, kind: 'a' })
    const plan = apply(edited, { k: 'reset' })
    expect(plan).toMatchObject({ step: 'frame', template: 'duo2', shots: [], target: 0, running: false, misses: 0 })
    expect(plan.slots).toEqual([{ shot: null, kind: 'both' }, { shot: null, kind: 'both' }])
  })
  it('is allowed from every step, even mid-sequence or with no template', () => {
    expect(applyPlanAction(defaultPlan(), { k: 'reset' })).not.toBeNull()
    expect(apply(running(), { k: 'reset' }).running).toBe(false)
  })
})

describe('isPlan', () => {
  it('accepts the current shape', () => {
    expect(isPlan(defaultPlan())).toBe(true)
    expect(isPlan(atPick())).toBe(true)
  })
  it('rejects the shape rooms had before the wizard, and junk', () => {
    expect(isPlan({ v: 1, stage: 'format', template: null, kinds: [], cell: 0, takes: [], kept: [] })).toBe(false)
    expect(isPlan(null)).toBe(false)
    expect(isPlan('plan')).toBe(false)
    expect(isPlan({ ...defaultPlan(), step: 'format' })).toBe(false)
  })
})

describe('parsePlanAction', () => {
  const accepted: Array<[string, unknown]> = [
    ['template', { k: 'template', template: 'grid4' }],
    ['go', { k: 'go', to: 'pick' }],
    ['fill', { k: 'fill', slot: 1, shot: 7 }],
    ['kind', { k: 'kind', slot: 3, kind: 'a' }],
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
    ['the old keep action', { k: 'keep', round: 1 }],
    ['unknown template', { k: 'template', template: 'horizontal' }],
    ['go to a step that does not exist (the old name)', { k: 'go', to: 'format' }],
    ['go without a target', { k: 'go' }],
    ['extra key', { k: 'reset', now: true }],
    ['slot too large', { k: 'fill', slot: MAX_CELLS, shot: 1 }],
    ['negative slot', { k: 'kind', slot: -1, kind: 'a' }],
    ['fractional slot', { k: 'fill', slot: 0.5, shot: 1 }],
    ['shot as a string', { k: 'fill', slot: 0, shot: '1' }],
    ['shot out of range', { k: 'fill', slot: 0, shot: 1_000_001 }],
    ['bad kind', { k: 'kind', slot: 0, kind: 'c' }],
    ['own __proto__ key', JSON.parse('{"k":"reset","__proto__":1}') as unknown],
  ]
  it.each(rejected)('rejects %s', (_name, raw) => {
    expect(parsePlanAction(raw)).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/shared/plan.test.ts`
Expected: FAIL — the new exports (`STEPS`, `startSequence`, …) do not exist yet.

- [ ] **Step 4: Rewrite `plan.ts`**

Replace the whole of `src/shared/plan.ts` with:
```ts
import { MAX_CELLS, MAX_MISSES, MAX_SHOTS, SEQUENCE_EXTRA_SHOTS, SEQUENCE_SPARE_SHOTS } from './constants'

// The shared "booth plan" (spec §4). Pure and import-free of anything browser- or worker-specific, so the Durable
// Object and the client apply the same rules and the rules are unit-testable without either.

export const TEMPLATE_IDS = ['strip4', 'grid4', 'duo2', 'polaroid'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/** Grid shape of every template. Strip geometry (client) and frame counts (server) both read this one table. */
export const TEMPLATES: Record<TemplateId, { cols: number; rows: number }> = {
  strip4: { cols: 1, rows: 4 },
  grid4: { cols: 2, rows: 2 },
  duo2: { cols: 1, rows: 2 },
  polaroid: { cols: 1, rows: 1 },
}
export const cellsOf = (template: TemplateId): number => TEMPLATES[template].cols * TEMPLATES[template].rows

/** USER 1 (slot a), USER 2 (slot b), or both people. */
export const CELL_KINDS = ['a', 'b', 'both'] as const
export type CellKind = (typeof CELL_KINDS)[number]

/** The wizard's steps, in order. */
export const STEPS = ['frame', 'shoot', 'pick', 'style', 'done'] as const
export type Step = (typeof STEPS)[number]

/** One frame of the strip: which shot fills it (a round number) and who shows in it. */
export interface Slot {
  shot: number | null
  kind: CellKind
}

export interface Plan {
  /** Bumped on every accepted change. */
  v: number
  step: Step
  template: TemplateId | null
  /** One per frame; empty while there is no template. */
  slots: Slot[]
  /** Rounds whose photos *both* people hold, in the order they were taken. */
  shots: number[]
  /** How many shots the current (or last) sequence aims for. */
  target: number
  /** A sequence is in progress: the server keeps scheduling shots. */
  running: boolean
  /** Shots skipped in the running sequence. */
  misses: number
}

export type PlanAction =
  | { k: 'template'; template: TemplateId }
  | { k: 'go'; to: Step }
  | { k: 'fill'; slot: number; shot: number }
  | { k: 'kind'; slot: number; kind: CellKind }
  | { k: 'reset' }

export const defaultPlan = (): Plan => ({ v: 0, step: 'frame', template: null, slots: [], shots: [], target: 0, running: false, misses: 0 })

/** True for the current plan shape. Rooms persisted before the wizard have another one and get a fresh plan. */
export function isPlan(value: unknown): value is Plan {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.v === 'number' &&
    typeof p.step === 'string' &&
    (STEPS as readonly string[]).includes(p.step) &&
    Array.isArray(p.slots) &&
    Array.isArray(p.shots) &&
    typeof p.running === 'boolean'
  )
}

const bump = (plan: Plan, change: Partial<Plan>): Plan => ({ ...plan, ...change, v: plan.v + 1 })
const slotsFor = (cells: number, shots: readonly number[]): Slot[] =>
  Array.from({ length: cells }, (_, i): Slot => ({ shot: shots[i] ?? null, kind: 'both' }))
const inRange = (plan: Plan, slot: number): boolean => Number.isInteger(slot) && slot >= 0 && slot < plan.slots.length
const order = (step: Step): number => STEPS.indexOf(step)

/** Next is one step forward with its guard; Back is any number of steps back; nothing moves while shooting. */
function canGo(plan: Plan, to: Step): boolean {
  if (plan.running || to === plan.step) return false
  const from = order(plan.step)
  const target = order(to)
  if (target < from) return true
  if (target !== from + 1) return false
  switch (plan.step) {
    case 'frame':
      return plan.template !== null
    case 'shoot':
      return plan.slots.length > 0 && plan.shots.length >= plan.slots.length
    case 'pick':
      return plan.slots.every((s) => s.shot !== null)
    case 'style':
      return true
    case 'done':
      return false
  }
}

/** Apply one person's action. `null` means refused (wrong step, bad index, a shot that was never taken). */
export function applyPlanAction(plan: Plan, action: PlanAction): Plan | null {
  switch (action.k) {
    case 'template':
      if (plan.step !== 'frame') return null
      return bump(plan, { template: action.template, slots: slotsFor(cellsOf(action.template), plan.shots) })
    case 'go':
      return canGo(plan, action.to) ? bump(plan, { step: action.to }) : null
    case 'fill': {
      if (plan.step !== 'pick' || plan.running || !inRange(plan, action.slot) || !plan.shots.includes(action.shot)) return null
      const slots = plan.slots.map((s) => ({ ...s }))
      const mine = slots[action.slot]
      if (!mine) return null
      const other = slots.find((s, i) => i !== action.slot && s.shot === action.shot)
      if (other) other.shot = mine.shot // swap: the other frame gets whatever this one had (possibly nothing)
      mine.shot = action.shot
      return bump(plan, { slots })
    }
    case 'kind': {
      if (plan.step !== 'pick' || plan.running || !inRange(plan, action.slot)) return null
      const slots = plan.slots.map((s) => ({ ...s }))
      const mine = slots[action.slot]
      if (!mine) return null
      mine.kind = action.kind
      return bump(plan, { slots })
    }
    case 'reset':
      return bump(plan, { step: 'frame', slots: slotsFor(plan.slots.length, []), shots: [], target: 0, running: false, misses: 0 })
  }
}

// ---- the shot sequence (spec D38) ----------------------------------------------------------------

/** Can READY be pressed at all? Only at the shoot step, with frames, while no sequence is running. */
export const acceptsReady = (plan: Plan): boolean => plan.step === 'shoot' && !plan.running && plan.slots.length > 0

/** How many shots a sequence started now aims for: frames + 2 the first time, then 3 more each time. */
export function targetFor(plan: Plan): number {
  const base = plan.slots.length + SEQUENCE_EXTRA_SHOTS
  return Math.min(MAX_SHOTS, plan.shots.length < base ? base : plan.shots.length + SEQUENCE_SPARE_SHOTS)
}

export const canShootMore = (plan: Plan): boolean => plan.shots.length < MAX_SHOTS

/** Both people are ready at the shoot step: begin. `null` when a sequence cannot start now. */
export function startSequence(plan: Plan): Plan | null {
  if (!acceptsReady(plan) || !canShootMore(plan)) return null
  return bump(plan, { running: true, target: targetFor(plan), misses: 0 })
}

/** The sequence is over: on to Pick if there are enough shots for the frames, otherwise back to waiting at Shoot. */
function endSequence(plan: Plan): Plan {
  return bump(plan, { running: false, step: plan.shots.length >= plan.slots.length ? 'pick' : 'shoot' })
}

/** A shot finished — both people hold both photos. It fills the first empty frame; the sequence ends at its target. */
export function recordShot(plan: Plan, round: number): Plan {
  if (!plan.running || plan.shots.includes(round)) return plan
  const shots = [...plan.shots, round]
  const slots = plan.slots.map((s) => ({ ...s }))
  const empty = slots.find((s) => s.shot === null)
  if (empty) empty.shot = round
  return shots.length >= plan.target ? endSequence({ ...plan, shots, slots }) : bump(plan, { shots, slots })
}

/** A shot never completed (the exchange timed out). Skip it; stop after MAX_MISSES. */
export function missShot(plan: Plan): Plan {
  if (!plan.running) return plan
  const misses = plan.misses + 1
  return misses >= MAX_MISSES ? endSequence({ ...plan, misses }) : bump(plan, { misses })
}

/** Someone left mid-sequence: stop, keep every shot already recorded. */
export function abortSequence(plan: Plan): Plan {
  return plan.running ? bump(plan, { running: false }) : plan
}

// ---- validation (untrusted input from a WebSocket) -----------------------------------------------

type Rec = Record<string, unknown>
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x)
const onlyKeys = (o: Rec, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k))
const isSlot = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < MAX_CELLS
const isRound = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000
const isTemplate = (v: unknown): v is TemplateId => typeof v === 'string' && (TEMPLATE_IDS as readonly string[]).includes(v)
const isKind = (v: unknown): v is CellKind => typeof v === 'string' && (CELL_KINDS as readonly string[]).includes(v)
const isStep = (v: unknown): v is Step => typeof v === 'string' && (STEPS as readonly string[]).includes(v)

export function parsePlanAction(raw: unknown): PlanAction | null {
  if (!isRec(raw) || typeof raw.k !== 'string') return null
  switch (raw.k) {
    case 'template':
      return onlyKeys(raw, ['k', 'template']) && isTemplate(raw.template) ? { k: 'template', template: raw.template } : null
    case 'go':
      return onlyKeys(raw, ['k', 'to']) && isStep(raw.to) ? { k: 'go', to: raw.to } : null
    case 'fill':
      return onlyKeys(raw, ['k', 'slot', 'shot']) && isSlot(raw.slot) && isRound(raw.shot) ? { k: 'fill', slot: raw.slot, shot: raw.shot } : null
    case 'kind':
      return onlyKeys(raw, ['k', 'slot', 'kind']) && isSlot(raw.slot) && isKind(raw.kind) ? { k: 'kind', slot: raw.slot, kind: raw.kind } : null
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

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: exit 0. (`npm run typecheck` and the rest of the suite are expected to fail until Task 2 and Task 10 — other files still import the old plan API.)

- [ ] **Step 7: Commit**

```bash
git add src/shared/constants.ts src/shared/plan.ts src/shared/plan.test.ts
git commit -m "feat: rework the shared plan around wizard steps, shots, frame slots and a shot sequence"
```

---

## Task 2: Protocol and `BoothRoom` — camera flag, plan actions, the shot sequence

**Files:**
- Modify: `src/shared/protocol.ts`, `src/shared/protocol.test.ts`, `src/worker/BoothRoom.ts`, `src/worker/BoothRoom.test.ts`, `src/worker/test-helpers.ts`

**Interfaces:**
- Consumes: everything produced by Task 1.
- Produces:
  - `PState` gains `camera: boolean`; `ClientMessage` gains `{ type: 'camera'; on: boolean }`; `RoomState.plan` is the new `Plan` (type unchanged in name).
  - Server behaviour (spec §5): the `camera` flag is per person, cleared when their last socket goes away; READY is accepted only at the shoot step, idle, with both cameras on; both ready → `startSequence` + a first round with `CAPTURE_LEAD_MS`; each time both `photo-complete` arrive the shot is recorded and, while the sequence runs, the next round is scheduled immediately with `BURST_LEAD_MS`; an exchange that times out (`EXCHANGE_TIMEOUT_MS`) is a miss and the sequence continues or ends; a person leaving aborts the sequence; plan actions only in `phase === 'ready'` (`reset` also when waiting); a persisted room with an old-shape plan gets `defaultPlan()`.

- [ ] **Step 1: Failing protocol tests**

In `src/shared/protocol.test.ts`, replace the whole `describe('parseClientMessage — plan', …)` block (at the end of the file) with:
```ts
describe('parseClientMessage — plan and camera', () => {
  const accepted = [
    { type: 'plan', action: { k: 'template', template: 'duo2' } },
    { type: 'plan', action: { k: 'go', to: 'pick' } },
    { type: 'plan', action: { k: 'fill', slot: 1, shot: 3 } },
    { type: 'plan', action: { k: 'kind', slot: 0, kind: 'a' } },
    { type: 'plan', action: { k: 'reset' } },
    { type: 'camera', on: true },
    { type: 'camera', on: false },
  ]
  it.each(accepted)('accepts %j', (raw) => {
    expect(parseClientMessage(raw)).toEqual(raw)
  })

  const rejected: Array<[string, unknown]> = [
    ['no action', { type: 'plan' }],
    ['unknown action', { type: 'plan', action: { k: 'explode' } }],
    ['the old keep action', { type: 'plan', action: { k: 'keep', round: 1 } }],
    ['unknown template', { type: 'plan', action: { k: 'template', template: 'horizontal' } }],
    ['go to the old step name', { type: 'plan', action: { k: 'go', to: 'format' } }],
    ['extra key beside action', { type: 'plan', action: { k: 'reset' }, extra: 1 }],
    ['extra key inside action', { type: 'plan', action: { k: 'reset', extra: 1 } }],
    ['action is a string', { type: 'plan', action: 'reset' }],
    ['camera without a flag', { type: 'camera' }],
    ['camera flag is a string', { type: 'camera', on: 'yes' }],
    ['camera with an extra key', { type: 'camera', on: true, extra: 1 }],
  ]
  it.each(rejected)('rejects %s', (_name, raw) => {
    expect(parseClientMessage(raw)).toBeNull()
  })
})
```
Run: `npx vitest run src/shared/protocol.test.ts` — expected FAIL on the `camera` cases (and `fill`/`go`/`kind` shapes are already parsed by Task 1's `parsePlanAction`).

- [ ] **Step 2: Extend the protocol**

In `src/shared/protocol.ts`:
1. In `interface PState`, add after `photoDone: boolean`:
```ts
  /** This person's camera is on (the call is only built once both are). */
  camera: boolean
```
2. In `type ClientMessage`, add after the `plan` member: `  | { type: 'camera'; on: boolean }`
3. In `parseClientMessage`, add this case directly before `case 'ping':`:
```ts
    case 'camera':
      return onlyKeys(raw, ['type', 'on']) && typeof raw.on === 'boolean' ? { type: 'camera', on: raw.on } : null
```
Run: `npx vitest run src/shared/protocol.test.ts` — expected PASS.

- [ ] **Step 3: Update the worker test helpers**

In `src/worker/test-helpers.ts`, in the `Peek` interface change the `slots` field to
```ts
    slots: Record<string, { participantId: string; ready: boolean; photoDone: boolean; camera?: boolean; lastSeenAt: number } | undefined>
```
(the `plan?: Plan` field stays).

- [ ] **Step 4: Rewrite the worker tests**

In `src/worker/BoothRoom.test.ts`:

1. Change the `../shared/constants` import to also bring `BURST_LEAD_MS` and `MAX_MISSES`:
`import { BURST_LEAD_MS, CAPTURE_LEAD_MS, EXCHANGE_TIMEOUT_MS, MAX_MISSES, MAX_WS_FRAME_BYTES, ROOM_IDLE_MS, SLOT_GRACE_MS } from '../shared/constants'`
2. Replace the helper `choosePair` (defined just after `pair()`) with this one, which returns a pair already **at the Shoot step with a template chosen and both cameras on**:
```ts
const act = (action: PlanAction) => ({ type: 'plan', action }) as const

/** Both cameras on and settled. */
async function camerasOn(a: TestClient, b: TestClient): Promise<void> {
  a.send({ type: 'camera', on: true })
  b.send({ type: 'camera', on: true })
  await Promise.all([a.lastState(), b.lastState()])
}
/** A pair at the Shoot step, template chosen, both cameras on: the starting point of every sequence test. */
async function choosePair(template: TemplateId = 'duo2') {
  const ctx = await pair()
  ctx.a.send(act({ k: 'template', template }))
  await Promise.all([ctx.a.lastState(), ctx.b.lastState()])
  ctx.a.send(act({ k: 'go', to: 'shoot' }))
  await Promise.all([ctx.a.lastState(), ctx.b.lastState()])
  await camerasOn(ctx.a, ctx.b)
  return ctx
}
```
3. In the `ready → scheduled capture` describe, replace the test `lets someone un-ready, and ignores ready while alone` with:
```ts
  it('lets someone un-ready, and ignores ready while alone', async () => {
    const code = await newRoom()
    const solo = await joinAs(code, 1)
    solo.send({ type: 'ready' })
    expect((await solo.take('room-state')).state.participants.a?.ready).toBe(false) // ignored while waiting

    const b = await joinAs(code, 2)
    await solo.take('partner-joined')
    await solo.settle()
    solo.send(act({ k: 'template', template: 'duo2' }))
    await Promise.all([solo.lastState(), b.lastState()])
    solo.send(act({ k: 'go', to: 'shoot' }))
    await Promise.all([solo.lastState(), b.lastState()])
    await camerasOn(solo, b)
    solo.send({ type: 'ready' })
    expect((await solo.lastState()).participants.a?.ready).toBe(true)
    solo.send({ type: 'unready' })
    expect((await solo.lastState()).participants.a?.ready).toBe(false)
    await b.expectNone('capture-scheduled')
  })
```
(`act` must be declared at module level, as in step 2, so move its declaration out of the old `describe('plan')` block.)
4. In `describe('round lifecycle')`, replace the first test (`returns to ready when both report photo-complete, and the next round is numbered 2`) with:
```ts
  it('records the shot and schedules the next one by itself, numbered 2', async () => {
    const { a, b } = await startRound()
    a.send({ type: 'photo-complete', round: 1 })
    expect((await b.take('room-state')).state.participants.a?.photoDone).toBe(true)
    b.send({ type: 'photo-complete', round: 1 })
    const next = await a.take('capture-scheduled')
    expect(next.round).toBe(2)
    expect(next.captureAt - Date.now()).toBeLessThanOrEqual(BURST_LEAD_MS)
    const state = await a.lastState()
    expect(state.plan).toMatchObject({ running: true, shots: [1] })
    expect(state.plan.slots[0]?.shot).toBe(1)
  })
```
5. In `describe('round lifecycle')` delete the two tests written for the old "a timed-out round goes back to ready" behaviour — `pushes everyone back to ready when the exchange times out, without anyone sending anything` and `drops a capture whose exchange never finished once EXCHANGE_TIMEOUT_MS has passed`. A timed-out shot now means "skip it and carry on"; the alarm path is covered by `skips a shot that never completes and carries on with the next` below, and this test covers the lazy path (add it at the end of the same `describe`):
```ts
  // Nothing wakes the room when it is idle; the next message must still notice the shot ran out of time.
  it('skips an expired shot lazily when anyone sends a message before the alarm fires', async () => {
    const { a, stub } = await startRound()
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.captureAt = Date.now() - EXCHANGE_TIMEOUT_MS - 1
    })
    a.send({ type: 'ready' }) // any message runs the lazy check
    expect((await a.take('capture-scheduled')).round).toBe(2)
  })
```
6. Replace the whole `describe('plan', …)` block at the end of the file with:
```ts
describe('camera flag', () => {
  it('is shared with the partner, never reveals more than a boolean, and clears when the person leaves', async () => {
    const { a, b } = await pair()
    a.send({ type: 'camera', on: true })
    const [sa, sb] = await Promise.all([a.lastState(), b.lastState()])
    expect(sa.participants.a?.camera).toBe(true)
    expect(sb.participants.a?.camera).toBe(true)
    expect(sb.participants.b?.camera).toBe(false)

    a.ws.close(1000, 'bye')
    await b.take('partner-left')
    expect((await b.lastState()).participants.a?.camera).toBe(false)
  })

  it('turning the camera off clears that person’s ready flag', async () => {
    const { a, b } = await choosePair()
    a.send({ type: 'ready' })
    expect((await a.lastState()).participants.a?.ready).toBe(true)
    await b.settle()
    a.send({ type: 'camera', on: false })
    expect((await a.lastState()).participants.a?.ready).toBe(false)
  })

  it('closes a socket that sends a malformed camera or plan frame', async () => {
    const { a } = await pair()
    a.send({ type: 'camera', on: 'yes' })
    expect((await a.take('error')).code).toBe('invalid-message')
    expect(await a.waitClose()).toBe(4400)
  })
})

describe('plan', () => {
  it('the join snapshot carries a default plan', async () => {
    const code = await newRoom()
    const c = await openSocket(code)
    c.send({ type: 'join', participantId: pid(1) })
    expect((await c.take('room-state')).state.plan).toEqual(defaultPlan())
  })

  it('gives a room persisted with the old plan shape a default plan', async () => {
    const code = await newRoom()
    const stub = env.BOOTH_ROOM.getByName(code)
    await joinAs(code, 1)
    await runInDurableObject(stub, async (instance, state) => {
      const rec = peek(instance).rec as { plan?: unknown }
      rec.plan = { v: 3, stage: 'format', template: 'duo2', kinds: ['both', 'both'], cell: 0, takes: [[], []], kept: [null, null] }
      await state.storage.put('room', rec)
    })
    await evictDurableObject(stub)
    const c = await openSocket(code)
    c.send({ type: 'join', participantId: pid(1) })
    expect((await c.take('room-state')).state.plan).toEqual(defaultPlan())
  })

  // Review Focus 4: two screens tap Next together; the server keeps one valid step and tells both.
  it('moves both screens on a Next, refuses an invalid or repeated one, and converges', async () => {
    const { a, b } = await pair()
    a.send(act({ k: 'template', template: 'polaroid' }))
    await Promise.all([a.lastState(), b.lastState()])

    a.send(act({ k: 'go', to: 'pick' })) // skips a step: refused
    expect((await a.lastState()).plan.step).toBe('frame')
    await b.settle()

    a.send(act({ k: 'go', to: 'shoot' }))
    b.send(act({ k: 'go', to: 'shoot' })) // the same Next from the other person: a no-op
    const [sa, sb] = await Promise.all([a.lastState(), b.lastState()])
    expect(sa.plan.step).toBe('shoot')
    expect(sb.plan).toEqual(sa.plan)
  })

  it('refuses a template change after the frame step', async () => {
    const { a } = await choosePair('duo2')
    a.send(act({ k: 'template', template: 'grid4' }))
    expect((await a.lastState()).plan).toMatchObject({ template: 'duo2', step: 'shoot' })
  })

  // Review Focus 1 analogue: nobody stays "ready" for a plan they have not seen.
  it('a plan change clears every ready flag', async () => {
    const { a, b } = await choosePair()
    a.send({ type: 'ready' })
    expect((await a.lastState()).participants.a?.ready).toBe(true)
    await b.settle()
    b.send(act({ k: 'go', to: 'frame' }))
    const [sa] = await Promise.all([a.lastState(), b.lastState()])
    expect(sa.plan.step).toBe('frame')
    expect(sa.participants.a?.ready).toBe(false)
  })

  it('refuses plan actions from a person alone, except reset', async () => {
    const { a, b } = await pair()
    a.send(act({ k: 'template', template: 'duo2' }))
    await Promise.all([a.lastState(), b.lastState()])
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    await a.settle()

    a.send(act({ k: 'go', to: 'shoot' }))
    const refused = await a.lastState()
    expect(refused.phase).toBe('waiting')
    expect(refused.plan.step).toBe('frame')

    a.send(act({ k: 'reset' }))
    expect((await a.lastState()).plan).toMatchObject({ step: 'frame', template: 'duo2' })
  })

  it('the plan survives a partner leaving and reclaiming their slot', async () => {
    const { code, a, b } = await choosePair('grid4')
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    const back = await openSocket(code)
    back.send({ type: 'join', participantId: pid(2) })
    expect((await back.take('room-state')).state.plan).toMatchObject({ template: 'grid4', step: 'shoot' })
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

describe('shot sequence', () => {
  /** Both press ready: the sequence begins with the first round scheduled. */
  async function start(a: TestClient, b: TestClient): Promise<void> {
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
  }
  /** Answer `count` scheduled shots like two healthy clients (both report photo-complete), then return the settled plan. */
  async function answer(a: TestClient, b: TestClient, count: number): Promise<Plan> {
    for (let i = 0; i < count; i++) {
      const { round } = await a.take('capture-scheduled')
      await b.take('capture-scheduled')
      a.send({ type: 'photo-complete', round })
      b.send({ type: 'photo-complete', round })
    }
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    return state.plan
  }
  /** Make the in-flight round look old enough to time out, then fire the room alarm. */
  async function expire(stub: DurableObjectStub<import('./BoothRoom').BoothRoom>): Promise<void> {
    await runInDurableObject(stub, (instance) => {
      peek(instance).rec.captureAt = Date.now() - EXCHANGE_TIMEOUT_MS - 1
    })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
  }

  it('READY is ignored until both cameras are on', async () => {
    const { a, b } = await pair()
    a.send(act({ k: 'template', template: 'polaroid' }))
    await Promise.all([a.lastState(), b.lastState()])
    a.send(act({ k: 'go', to: 'shoot' }))
    await Promise.all([a.lastState(), b.lastState()])
    a.send({ type: 'camera', on: true })
    await Promise.all([a.lastState(), b.lastState()]) // only a's camera is on
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    await a.expectNone('capture-scheduled')
    expect((await a.lastState()).participants.a?.ready).toBe(false)
  })

  it('READY is ignored at the frame step even with both cameras on', async () => {
    const { a, b } = await pair()
    a.send(act({ k: 'template', template: 'polaroid' }))
    await Promise.all([a.lastState(), b.lastState()])
    await camerasOn(a, b)
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    await a.expectNone('capture-scheduled')
  })

  it('one READY each starts a sequence that runs by itself and ends on the pick step with the frames filled', async () => {
    const { a, b } = await choosePair('duo2') // target 4
    await start(a, b)
    const first = await a.take('capture-scheduled')
    expect(first.round).toBe(1)
    expect(first.captureAt - Date.now()).toBeGreaterThan(CAPTURE_LEAD_MS - 1500) // the first shot has the long lead
    a.send({ type: 'photo-complete', round: 1 })
    b.send({ type: 'photo-complete', round: 1 })
    await b.take('capture-scheduled')
    const second = await a.take('capture-scheduled')
    expect(second.round).toBe(2)
    expect(second.captureAt - Date.now()).toBeLessThanOrEqual(BURST_LEAD_MS) // later shots have the short lead
    a.send({ type: 'photo-complete', round: 2 })
    b.send({ type: 'photo-complete', round: 2 })

    const plan = await answer(a, b, 2) // rounds 3 and 4
    expect(plan).toMatchObject({ step: 'pick', running: false, shots: [1, 2, 3, 4], target: 4 })
    expect(plan.slots.map((s) => s.shot)).toEqual([1, 2])
  })

  it('refuses READY, Next and Back while the sequence is running', async () => {
    const { a, b } = await choosePair('polaroid')
    await start(a, b)
    await a.take('capture-scheduled')
    await Promise.all([a.settle(), b.settle()])
    a.send({ type: 'ready' })
    expect((await a.lastState()).participants.a?.ready).toBe(false)
    await b.settle()
    b.send(act({ k: 'go', to: 'frame' }))
    expect((await b.lastState()).plan).toMatchObject({ step: 'shoot', running: true })
  })

  // Review Focus 3
  it('skips a shot that never completes and carries on with the next', async () => {
    const { a, b, stub } = await choosePair('polaroid') // target 3
    await start(a, b)
    expect((await a.take('capture-scheduled')).round).toBe(1)
    await b.take('capture-scheduled')
    await expire(stub) // nobody answered round 1
    const next = await a.take('capture-scheduled')
    expect(next.round).toBe(2)
    const state = await a.lastState()
    expect(state.plan).toMatchObject({ running: true, misses: 1, shots: [] })
  })

  it('ends the sequence after MAX_MISSES skipped shots, staying on the shoot step with what it has', async () => {
    const { a, b, stub } = await choosePair('polaroid')
    await start(a, b)
    await a.take('capture-scheduled')
    for (let i = 0; i < MAX_MISSES - 1; i++) {
      await expire(stub)
      await a.take('capture-scheduled')
    }
    await expire(stub) // the last miss ends it
    const plan = (await a.lastState()).plan
    expect(plan).toMatchObject({ running: false, step: 'shoot', misses: MAX_MISSES, shots: [] })
    await Promise.all([a.settle(), b.settle()])

    // …and the people can try again.
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    expect((await a.take('capture-scheduled')).round).toBeGreaterThan(MAX_MISSES)
  })

  // Review Focus 2
  it('stops the sequence when someone leaves, keeps the shots, and resumes towards the same target', async () => {
    const { code, a, b } = await choosePair('polaroid') // target 3
    await start(a, b)
    await answer(a, b, 1) // shot 1 recorded, shot 2 scheduled
    b.ws.close(1000, 'bye')
    await a.take('partner-left')
    const state = await a.lastState()
    expect(state.plan).toMatchObject({ running: false, step: 'shoot', shots: [1] })
    expect(state.phase).toBe('waiting')

    const back = await openSocket(code)
    back.send({ type: 'join', participantId: pid(2) })
    await back.take('room-state')
    await a.take('partner-joined')
    back.send({ type: 'camera', on: true })
    await Promise.all([a.lastState(), back.lastState()])
    a.send({ type: 'ready' })
    back.send({ type: 'ready' })
    const plan = await answer(a, back, 2)
    expect(plan).toMatchObject({ step: 'pick', shots: [1, 3, 4], target: 3 }) // 3 shots in all: aimed for the same target
  })

  it('lets Pick edits and Shoot more work after a sequence', async () => {
    const { a, b } = await choosePair('duo2')
    await start(a, b)
    const picked = await answer(a, b, 4)
    expect(picked.step).toBe('pick')

    a.send(act({ k: 'fill', slot: 0, shot: 2 })) // shot 2 is in frame 2: they swap
    expect((await a.lastState()).plan.slots.map((s) => s.shot)).toEqual([2, 1])
    await b.settle()
    a.send(act({ k: 'kind', slot: 1, kind: 'a' }))
    expect((await a.lastState()).plan.slots.map((s) => s.kind)).toEqual(['both', 'a'])
    await b.settle()

    a.send(act({ k: 'go', to: 'shoot' })) // "Shoot more"
    await Promise.all([a.lastState(), b.lastState()])
    a.send({ type: 'ready' })
    b.send({ type: 'ready' })
    const more = await answer(a, b, 3)
    expect(more).toMatchObject({ step: 'pick', shots: [1, 2, 3, 4, 5, 6, 7], target: 7 })
    expect(more.slots.map((s) => s.shot)).toEqual([2, 1]) // the edited frames are untouched by the new shots
  })

  it('reset returns everyone to the frame step with the template kept', async () => {
    const { a, b } = await choosePair('duo2')
    await start(a, b)
    await answer(a, b, 4)
    a.send(act({ k: 'reset' }))
    const [state] = await Promise.all([a.lastState(), b.lastState()])
    expect(state.plan).toMatchObject({ step: 'frame', template: 'duo2', shots: [], running: false })
    expect(state.plan.slots).toEqual([{ shot: null, kind: 'both' }, { shot: null, kind: 'both' }])
  })
})
```
Run: `npx vitest run --project worker src/worker/BoothRoom.test.ts`
Expected: FAIL — `BoothRoom` still speaks the old plan.

- [ ] **Step 5: Implement it in `BoothRoom.ts`**

Read `src/worker/BoothRoom.ts` first. Make these changes:

1. **Imports.** Replace the `../shared/constants` import list so it includes `BURST_LEAD_MS`, and replace the plan imports:
```ts
import { acceptsReady, abortSequence, applyPlanAction, defaultPlan, isPlan, missShot, recordShot, startSequence } from '../shared/plan'
import type { Plan } from '../shared/plan'
```
(`BURST_LEAD_MS` is added to the existing alphabetical constants list; `CAPTURE_LEAD_MS`, `EXCHANGE_TIMEOUT_MS` stay.)

2. **Persisted slot.** In `interface Slot` add `camera?: boolean` (optional: records persisted before it existed lack it) after `photoDone`. In `handleJoin`, where a new slot is created, create it as `{ participantId, ready: false, photoDone: false, camera: false, lastSeenAt: now }`.

3. **The plan getter** — replace the existing `private get plan()` with:
```ts
  /** Rooms persisted with an older plan shape (or none) get a fresh plan the first time it is read. */
  private get plan(): Plan {
    const rec = this.room
    if (!isPlan(rec.plan)) rec.plan = defaultPlan()
    return rec.plan
  }
```

4. **Helpers** — add next to `clearReady()`:
```ts
  private bothCameras(): boolean {
    const slots = this.rec?.slots
    return Boolean(slots?.a?.camera && slots?.b?.camera)
  }

  /** A round whose photo exchange never finished is a skipped shot: count it, then carry on with the sequence or end it. */
  private expireRound(now: number): boolean {
    const rec = this.room
    if (rec.captureAt === null || now < rec.captureAt + EXCHANGE_TIMEOUT_MS) return false
    rec.captureAt = null
    rec.plan = missShot(this.plan)
    if (rec.plan.running) this.schedule(now, BURST_LEAD_MS)
    this.save()
    return true
  }
```

5. **`alarm()`** — replace the block
```ts
    if (rec.captureAt !== null && now >= rec.captureAt + EXCHANGE_TIMEOUT_MS) {
      // A round whose photo exchange never finished: nobody is going to send anything, so tell them it is over.
      rec.captureAt = null
      this.save()
      this.broadcastState()
    }
```
with
```ts
    if (this.expireRound(now)) this.broadcastState()
```

6. **`phase()`** — replace its inline lazy-expiry block
```ts
    if (rec.captureAt !== null && now >= rec.captureAt + EXCHANGE_TIMEOUT_MS) {
      rec.captureAt = null
      this.save()
    }
```
with `this.expireRound(now)` (keep the rest of the method; remove the now-unused `const rec = this.room` only if nothing else in the method uses it).

7. **`onGone`** — after `me.ready = false` add `me.camera = false`, and after `rec.captureAt = null` add `rec.plan = abortSequence(this.plan)`.

8. **`schedule()`** — change the signature to `private schedule(now: number, lead: number): void` and the line `rec.captureAt = now + CAPTURE_LEAD_MS` to `rec.captureAt = now + lead`.

9. **`handle()`** — replace the whole method with:
```ts
  private handle(slot: SlotName, msg: Exclude<ClientMessage, { type: 'join' | 'ping' }>, now: number): void {
    const rec = this.room
    switch (msg.type) {
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        this.sendTo(otherSlot(slot), msg) // already validated and rebuilt by parseClientMessage
        return
      case 'camera': {
        const me = rec.slots[slot]
        if (!me) return
        me.camera = msg.on
        if (!msg.on) me.ready = false
        this.save()
        this.broadcastState()
        return
      }
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
        // Only at the shoot step, idle, with both people present and both cameras on. Re-sync the caller either way
        // (computing the phase may also drop an expired capture).
        if (!me || this.phase(now) !== 'ready' || !acceptsReady(this.plan) || !this.bothCameras()) {
          this.broadcastState()
          return
        }
        me.ready = msg.type === 'ready'
        if (rec.slots.a?.ready && rec.slots.b?.ready) {
          const next = startSequence(this.plan)
          if (next) {
            rec.plan = next
            this.schedule(now, CAPTURE_LEAD_MS) // the first shot; the rest follow by themselves
          } else {
            this.clearReady()
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
          rec.plan = recordShot(this.plan, rec.round) // a shot exists only once both people hold both photos
          if (rec.plan.running) this.schedule(now, BURST_LEAD_MS) // the next shot follows by itself
        }
        this.save()
        this.broadcastState()
        return
      }
    }
  }
```

10. **`stateFor`** — in the `p` helper include the camera flag: `s ? { connected: connected.has(name), ready: s.ready, photoDone: s.photoDone, camera: Boolean(s.camera) } : null`.

- [ ] **Step 6: Run the worker suite**

Run: `npx vitest run --project worker`
Expected: PASS for the whole worker project (the pre-existing tests that start a round now do so through `choosePair`; the lifecycle tests that expected a manual second READY were replaced in Step 4). If a pre-existing test fails because it presses READY right after `pair()`, make it use `choosePair()` (or `startRound()`), do **not** loosen the server.

- [ ] **Step 7: Static checks**

Run: `npm run lint && npx tsc -p tsconfig.worker.json --noEmit && npx vitest run src/shared`
Expected: all exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/shared/protocol.ts src/shared/protocol.test.ts src/worker/BoothRoom.ts src/worker/BoothRoom.test.ts src/worker/test-helpers.ts
git commit -m "feat: let the booth room run the shot sequence and track each person's camera"
```

---

## Task 3: Client data layer — `takes.ts` and `labels.ts`

**Files:**
- Modify: `src/client/lib/takes.ts`, `src/client/lib/takes.test.ts`, `src/client/lib/labels.ts`, `src/client/lib/labels.test.ts`

**Interfaces:**
- Consumes: `Plan`, `Step`, `STEPS`, `TemplateId`, `CellKind` (Task 1); `RoomState`, `SlotName` (protocol).
- Produces:
  - `takes.ts`: unchanged `Round`, `Pending`, `mergePhoto`, `completeRound`, `TakeStore`, `putRound`, `CellBlobs`, `Finished`, `needsCompleteResend`; **new/changed** `highestReferenced(plan): number` (highest of `plan.shots`, `-1` if none), `pruneStore(store, plan, highestSeen): TakeStore` (drops rounds not in `plan.shots` that are ≤ `highestSeen`; same reference when nothing drops), `missingShots(plan, store): number[]` (shots this tab does not hold; `[]` at the frame step), `finishedOf(plan, store): Finished | null` (needs step `style` or `done`, a template, and every slot's shot held). Removed: `referencedRounds`, `missingRounds`, `roundLostAfterCompleting`.
  - `labels.ts`: `STEP_LABEL: Record<Step, string>`, `stepIndex(step: Step): number`, `TEMPLATE_LABEL: Record<TemplateId, { title: string; sub: string }>` (sentence case), `whoLabel(kind: CellKind, mySlot: SlotName | null): string` (`Both` / `Just you` / `Just them`; `User 1` / `User 2` when `mySlot` is null). Removed: `STEPS` (use `STEPS` from `shared/plan`), `kindLabel`.

- [ ] **Step 1: Failing tests for `takes.ts`**

Replace the whole of `src/client/lib/takes.test.ts` with:
```ts
import { describe, expect, it } from 'vitest'
import { applyPlanAction, defaultPlan, recordShot, startSequence, type Plan } from '../../shared/plan'
import type { RoomState } from '../../shared/protocol'
import {
  completeRound,
  finishedOf,
  highestReferenced,
  mergePhoto,
  missingShots,
  needsCompleteResend,
  pruneStore,
  putRound,
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
const atShoot = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => {
  const framed = must(applyPlanAction(defaultPlan(), { k: 'template', template: t }))
  return must(applyPlanAction(framed, { k: 'go', to: 'shoot' }))
}
/** The sequence ran to its target (rounds 1..target) and the plan is on the pick step. */
const atPick = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => {
  const plan = must(startSequence(atShoot(t)))
  return Array.from({ length: plan.target }, (_, i) => i + 1).reduce((p, r) => recordShot(p, r), plan)
}
const atStyle = (t: 'duo2' | 'polaroid' = 'duo2'): Plan => must(applyPlanAction(atPick(t), { k: 'go', to: 'style' }))

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

describe('highestReferenced', () => {
  it('is the newest shot the plan mentions, or -1', () => {
    expect(highestReferenced(defaultPlan())).toBe(-1)
    expect(highestReferenced(atPick('duo2'))).toBe(4)
  })
})

describe('pruneStore', () => {
  it('drops rounds the plan no longer mentions (after a reset)', () => {
    const reset = must(applyPlanAction(atPick(), { k: 'reset' }))
    expect(pruneStore(store(1, 2, 3, 4), reset, 4).size).toBe(0)
  })
  it('keeps every shot the plan lists, spares included — Pick may still swap them in', () => {
    const pruned = pruneStore(store(1, 2, 3, 4), atPick('duo2'), 4)
    expect([...pruned.keys()].sort()).toEqual([1, 2, 3, 4])
  })
  it('keeps a round newer than anything the plan has mentioned yet (finished here, not yet recorded by the server)', () => {
    const pruned = pruneStore(store(1, 2, 3, 4, 5), atPick('duo2'), highestReferenced(atPick('duo2')))
    expect([...pruned.keys()].sort()).toEqual([1, 2, 3, 4, 5])
  })
  it('returns the very same store when there is nothing to drop (so React can bail out)', () => {
    const s = store(1, 2, 3, 4)
    expect(pruneStore(s, atPick('duo2'), 4)).toBe(s)
  })
})

// Review Focus 6: a reloaded tab holds none of the photos the plan points at.
describe('missingShots', () => {
  it('is empty at the frame step, and when this tab holds every shot', () => {
    expect(missingShots(defaultPlan(), store())).toEqual([])
    expect(missingShots(atPick('duo2'), store(1, 2, 3, 4))).toEqual([])
  })
  it('lists the shots this tab does not hold', () => {
    expect(missingShots(atPick('duo2'), store(1, 4))).toEqual([2, 3])
    expect(missingShots(atPick('duo2'), store())).toEqual([1, 2, 3, 4])
  })
})

describe('finishedOf', () => {
  it('is null before the style step, and until this tab holds every shot the frames use', () => {
    expect(finishedOf(atPick('duo2'), store(1, 2, 3, 4))).toBeNull() // still picking
    expect(finishedOf(atStyle('duo2'), store(2))).toBeNull() // shot 1 is missing
  })
  it('lists each frame in order with its kind and the shot it uses', () => {
    const plan = must(applyPlanAction(atPick('duo2'), { k: 'kind', slot: 1, kind: 'a' }))
    const style = must(applyPlanAction(plan, { k: 'go', to: 'style' }))
    const finished = must(finishedOf(style, store(1, 2, 3, 4)))
    expect(finished.template).toBe('duo2')
    expect(finished.cells.map((c) => [c.kind, c.round])).toEqual([
      ['both', 1],
      ['a', 2],
    ])
    expect(finished.cells[0]?.a).toBeInstanceOf(Blob)
  })
  it('also works on the done step', () => {
    const done = must(applyPlanAction(atStyle('polaroid'), { k: 'go', to: 'done' }))
    expect(finishedOf(done, store(1, 2, 3))?.cells).toHaveLength(1)
  })
})

// Review: a photo-complete can be lost on its way to the server (the socket was reconnecting at that moment).
const room = (over: Partial<RoomState> = {}): RoomState => ({
  code: 'ABCDEF',
  you: 'a',
  phase: 'capture',
  round: 3,
  captureAt: null,
  participants: {
    a: { connected: true, ready: false, photoDone: false, camera: true },
    b: { connected: true, ready: false, photoDone: true, camera: true },
  },
  plan: defaultPlan(),
  ...over,
})

describe('needsCompleteResend', () => {
  it('is true when this tab finished the round the server is still waiting on but has not counted it', () => {
    expect(needsCompleteResend(room(), 3)).toBe(true)
  })
  it('is false once the server has counted it, when no round is in flight, or for a different round', () => {
    const counted = room({ participants: { a: { connected: true, ready: false, photoDone: true, camera: true }, b: null } })
    expect(needsCompleteResend(counted, 3)).toBe(false)
    expect(needsCompleteResend(room({ phase: 'ready' }), 3)).toBe(false)
    expect(needsCompleteResend(room(), 2)).toBe(false) // this tab finished an older round
    expect(needsCompleteResend(room(), -1)).toBe(false) // this tab has finished nothing
  })
})
```

- [ ] **Step 2: Failing tests for `labels.ts`**

Replace the whole of `src/client/lib/labels.test.ts` with:
```ts
import { describe, expect, it } from 'vitest'
import { STEPS, TEMPLATE_IDS } from '../../shared/plan'
import { STEP_LABEL, stepIndex, TEMPLATE_LABEL, whoLabel } from './labels'

describe('steps', () => {
  it('label every step in sentence case, in order', () => {
    expect(STEPS.map((s) => STEP_LABEL[s])).toEqual(['Frame', 'Shoot', 'Pick', 'Style', 'Done'])
    expect(STEPS.map(stepIndex)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('whoLabel', () => {
  it('reads relative to the person looking: "Just you" on your own side, "Just them" on the other', () => {
    expect(whoLabel('both', 'a')).toBe('Both')
    expect(whoLabel('a', 'a')).toBe('Just you')
    expect(whoLabel('a', 'b')).toBe('Just them')
    expect(whoLabel('b', 'b')).toBe('Just you')
    expect(whoLabel('b', 'a')).toBe('Just them')
  })
  it('falls back to user numbers when it does not know who is looking', () => {
    expect(whoLabel('a', null)).toBe('User 1')
    expect(whoLabel('b', null)).toBe('User 2')
  })
})

describe('TEMPLATE_LABEL', () => {
  it('labels every template in sentence case', () => {
    for (const id of TEMPLATE_IDS) {
      expect(TEMPLATE_LABEL[id].title.length).toBeGreaterThan(0)
      expect(TEMPLATE_LABEL[id].sub).not.toBe(TEMPLATE_LABEL[id].sub.toUpperCase())
    }
    expect(TEMPLATE_LABEL.grid4.title).toBe('2 × 2')
  })
})
```
Run: `npx vitest run src/client/lib/takes.test.ts src/client/lib/labels.test.ts`
Expected: FAIL (the new exports do not exist yet).

- [ ] **Step 3: Rewrite `takes.ts`**

Replace the whole of `src/client/lib/takes.ts` with:
```ts
import type { CellKind, Plan, TemplateId } from '../../shared/plan'
import type { RoomState, SlotName } from '../../shared/protocol'

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

/** The newest shot the plan mentions, or -1. */
export const highestReferenced = (plan: Plan): number => Math.max(-1, ...plan.shots)

/**
 * Drop rounds the plan no longer lists. Every shot stays (spares too: Pick may still swap one in) until a reset.
 * A round newer than anything the plan has ever mentioned (`highestSeen`) is a photo pair that finished here a moment
 * before the server announced the shot, so it is kept. Returns the same store when nothing is dropped.
 */
export function pruneStore(store: TakeStore, plan: Plan, highestSeen: number): TakeStore {
  const keep = new Set(plan.shots)
  const drop = [...store.keys()].filter((r) => !keep.has(r) && r <= highestSeen)
  if (drop.length === 0) return store
  const next = new Map(store)
  for (const r of drop) next.delete(r)
  return next
}

/** Shots the plan lists that this tab does not hold — the tab was reloaded (spec §6). Nothing is needed at the frame step. */
export const missingShots = (plan: Plan, store: TakeStore): number[] =>
  plan.step === 'frame' ? [] : plan.shots.filter((r) => !store.has(r))

/** The kept photos of one frame, ready to compose. */
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

/** The finished strip's inputs, or null until the plan is on style or done *and* this tab holds every shot the frames use. */
export function finishedOf(plan: Plan, store: TakeStore): Finished | null {
  if ((plan.step !== 'style' && plan.step !== 'done') || plan.template === null) return null
  const cells: CellBlobs[] = []
  for (const slot of plan.slots) {
    const round = slot.shot === null ? undefined : store.get(slot.shot)
    if (!round) return null
    cells.push({ kind: slot.kind, round: round.round, a: round.a, b: round.b })
  }
  return cells.length > 0 ? { template: plan.template, cells } : null
}

/**
 * Did this tab finish the round the server is still waiting on, without the server having counted it? Then its
 * `photo-complete` was lost on the way (the socket was reconnecting) and must be sent again — the server is idempotent.
 */
export function needsCompleteResend(state: RoomState, completedRound: number): boolean {
  return state.phase === 'capture' && state.round === completedRound && state.participants[state.you]?.photoDone === false
}
```

- [ ] **Step 4: Rewrite `labels.ts`**

Replace the whole of `src/client/lib/labels.ts` with:
```ts
import type { CellKind, Step, TemplateId } from '../../shared/plan'
import { STEPS } from '../../shared/plan'
import type { SlotName } from '../../shared/protocol'

export const STEP_LABEL: Record<Step, string> = { frame: 'Frame', shoot: 'Shoot', pick: 'Pick', style: 'Style', done: 'Done' }

export const stepIndex = (step: Step): number => STEPS.indexOf(step)

export const TEMPLATE_LABEL: Record<TemplateId, { title: string; sub: string }> = {
  strip4: { title: '4 cut', sub: 'The classic strip' },
  grid4: { title: '2 × 2', sub: 'Four, on a card' },
  duo2: { title: '2 cut', sub: 'Two big photos' },
  polaroid: { title: 'Polaroid', sub: 'One shot' },
}

/**
 * Who is in a frame, as the person looking reads it. The plan stores USER 1 / USER 2 (slot a / slot b), but "Just you"
 * and "Just them" swap between the two screens.
 */
export function whoLabel(kind: CellKind, mySlot: SlotName | null): string {
  if (kind === 'both') return 'Both'
  if (mySlot === null) return kind === 'a' ? 'User 1' : 'User 2'
  return kind === mySlot ? 'Just you' : 'Just them'
}
```
(`takes.ts` no longer imports `Phase`; `roundLostAfterCompleting` is gone — `Booth.tsx` stops using it in Task 10.)

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/client/lib/takes.test.ts src/client/lib/labels.test.ts && npx vitest run src/shared`
Expected: PASS.

- [ ] **Step 6: Phase 1 gate**

Run: `npm test && npm run lint && npx tsc -p tsconfig.worker.json --noEmit`
Expected: all exit 0 (unit + worker suites green; **only** `npm run typecheck` is red, in `src/client`, as announced).
If a unit test in an untouched client file fails because it imports a removed export (`kindLabel`, `STEPS` from `labels`, `referencedRounds`, `missingRounds`, `roundLostAfterCompleting`), fix that import in the test only if the file is a pure `lib/` test; otherwise leave it for Task 10 and tell the reviewer.

- [ ] **Step 7: Commit**

```bash
git add src/client/lib/takes.ts src/client/lib/takes.test.ts src/client/lib/labels.ts src/client/lib/labels.test.ts
git commit -m "refactor: rebuild the client take store and labels around shots and frame slots"
```
