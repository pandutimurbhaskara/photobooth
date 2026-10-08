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
