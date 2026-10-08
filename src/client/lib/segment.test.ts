import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTimeout } from './segment'

afterEach(() => vi.useRealTimers())

describe('withTimeout', () => {
  it('passes a result through', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7)
  })
  it('passes a rejection through', async () => {
    await expect(withTimeout(Promise.reject(new Error('nope')), 1000)).rejects.toThrow('nope')
  })
  it('rejects when the work takes too long, naming what was slow', async () => {
    vi.useFakeTimers()
    const never = new Promise<number>(() => {})
    const result = expect(withTimeout(never, 15_000, 'loading the cutout model')).rejects.toThrow(
      'loading the cutout model timed out after 15000 ms',
    )
    await vi.advanceTimersByTimeAsync(15_000)
    await result
  })
})
