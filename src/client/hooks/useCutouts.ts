import { useEffect, useState } from 'react'
import { cutoutKey, type Cutout } from '../lib/cutout'
import { cutOut, withTimeout } from '../lib/segment'
import type { CellBlobs } from '../lib/takes'
import { SEGMENT_TIMEOUT_MS } from '../lib/vendor'
import { useLatest } from './useLatest'

export type CutoutStatus = 'idle' | 'loading' | 'ready' | 'failed'
interface State {
  status: CutoutStatus
  byKey: ReadonlyMap<string, Cutout>
}
// One shared empty map: `useStrip` recomposes when this reference changes, and idle → loading → failed must not.
const EMPTY: ReadonlyMap<string, Cutout> = new Map()
const IDLE: State = { status: 'idle', byKey: EMPTY }
const FAILED: State = { status: 'failed', byKey: EMPTY }

// One cutout per round and person, kept for the life of the tab (a photo never changes once taken).
// ponytail: never evicted; a long session with many retakes holds a few MB per retaken TOGETHER cell. Evict by round if it matters.
const cache = new Map<string, Promise<Cutout>>()
function cutoutFor(round: number, who: 'a' | 'b', photo: Blob): Promise<Cutout> {
  const key = cutoutKey(round, who)
  let hit = cache.get(key)
  if (!hit) {
    hit = withTimeout(cutOut(photo), SEGMENT_TIMEOUT_MS, 'cutting a person out')
    cache.set(key, hit)
    hit.catch(() => cache.delete(key)) // a failure is not remembered: choosing a background again retries
  }
  return hit
}

/**
 * Cut both people out of every TOGETHER cell, one at a time. Any failure → `failed`, and the strip stays side by side.
 * Like `useStrip` it reads `cells` through a ref and keys by content, so a re-created array with the same photos does
 * not redo the work.
 */
export function useCutouts(cells: readonly CellBlobs[] | null, enabled: boolean): State {
  const [state, setState] = useState<State>(IDLE)
  const latest = useLatest(cells)
  const key = cells ? cells.map((c) => `${c.kind}:${c.round}`).join('|') : ''

  useEffect(() => {
    const current = latest.current
    if (!current || !enabled || !current.some((c) => c.kind === 'both')) {
      setState(IDLE)
      return
    }
    let cancelled = false
    setState((s) => ({ status: 'loading', byKey: s.byKey }))
    void (async () => {
      try {
        const byKey = new Map<string, Cutout>()
        for (const cell of current) {
          if (cell.kind !== 'both') continue
          for (const who of ['a', 'b'] as const) byKey.set(cutoutKey(cell.round, who), await cutoutFor(cell.round, who, cell[who]))
        }
        if (!cancelled) setState({ status: 'ready', byKey })
      } catch {
        if (!cancelled) setState(FAILED)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [key, enabled, latest])

  return state
}
