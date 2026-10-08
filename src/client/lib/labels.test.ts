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
