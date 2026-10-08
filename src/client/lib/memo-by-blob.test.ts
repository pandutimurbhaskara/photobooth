import { describe, expect, it, vi } from 'vitest'
import { memoByBlob } from './memo-by-blob'

describe('memoByBlob', () => {
  it('runs the work once per photo and hands every caller the same result', async () => {
    const work = vi.fn((b: Blob) => Promise.resolve(b.size))
    const memo = memoByBlob(work)
    const photo = new Blob(['abc'])
    const [x, y] = await Promise.all([memo(photo), memo(photo)])
    expect([x, y]).toEqual([3, 3])
    expect(work).toHaveBeenCalledTimes(1)
  })

  // Review I2: round numbers restart at 1 in every booth, so a cache keyed by round would hand the next booth the
  // previous booth's cutout (another person's face in the new strip).
  it('never mixes up two different photos, even byte-for-byte identical ones', async () => {
    const work = vi.fn((b: Blob) => Promise.resolve({ of: b }))
    const memo = memoByBlob(work)
    const first = new Blob(['same bytes'])
    const second = new Blob(['same bytes'])
    const [a, b] = await Promise.all([memo(first), memo(second)])
    expect(a.of).toBe(first)
    expect(b.of).toBe(second)
    expect(work).toHaveBeenCalledTimes(2)
  })

  it('does not remember a failure, so the next call tries again', async () => {
    let calls = 0
    const memo = memoByBlob((): Promise<string> => {
      calls += 1
      return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok')
    })
    const photo = new Blob(['x'])
    await expect(memo(photo)).rejects.toThrow('boom')
    await expect(memo(photo)).resolves.toBe('ok')
  })
})
