import { describe, expect, it } from 'vitest'
import { applyFilter, FILTERS, type FilterId } from './filters'

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a])
const run = (id: FilterId, r: number, g: number, b: number, a = 255) => {
  const data = px(r, g, b, a)
  applyFilter(data, id)
  return [...data]
}

describe('applyFilter', () => {
  it('original changes nothing', () => {
    expect(run('original', 12, 200, 99)).toEqual([12, 200, 99, 255])
  })

  it.each(FILTERS.map((f) => f.id))('%s never touches alpha', (id) => {
    expect(run(id, 120, 80, 40, 77)[3]).toBe(77)
  })

  it('bw makes every channel equal (luma), keeping black and white', () => {
    expect(run('bw', 200, 100, 50)).toEqual([124, 124, 124, 255])
    expect(run('bw', 255, 255, 255).slice(0, 3)).toEqual([255, 255, 255])
    expect(run('bw', 0, 0, 0).slice(0, 3)).toEqual([0, 0, 0])
  })

  it('contrast pivots on mid-grey and clamps', () => {
    expect(run('contrast', 128, 128, 128).slice(0, 3)).toEqual([128, 128, 128])
    expect(run('contrast', 200, 200, 200)[0]).toBe(225)
    expect(run('contrast', 250, 250, 250)[0]).toBe(255)
    expect(run('contrast', 5, 5, 5)[0]).toBe(0)
  })

  it('warm pushes red up and blue down; cool does the opposite', () => {
    expect(run('warm', 128, 128, 128).slice(0, 3)).toEqual([146, 131, 115])
    expect(run('cool', 128, 128, 128).slice(0, 3)).toEqual([118, 128, 149])
  })

  it('vintage lifts blacks, warms whites (blue drops) and never exceeds 255', () => {
    expect(run('vintage', 0, 0, 0).slice(0, 3)).toEqual([20, 20, 20])
    expect(run('vintage', 255, 255, 255).slice(0, 3)).toEqual([255, 255, 239])
  })

  it('handles many pixels, touching only RGB', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 1, 40, 50, 60, 2])
    applyFilter(data, 'bw')
    expect(data[3]).toBe(1)
    expect(data[7]).toBe(2)
    expect(data[0]).toBe(data[1])
    expect(data[4]).toBe(data[6])
  })
})
