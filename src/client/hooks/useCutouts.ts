import { useEffect, useState } from 'react'
import { cutoutKey, type Cutout } from '../lib/cutout'
import { memoByBlob } from '../lib/memo-by-blob'
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

// One cutout per photo, kept for as long as the photo is (a WeakMap: a pruned photo takes its cutout with it). Keyed by the
// photo itself, not by round number — rounds restart at 1 in every booth and would mix up two people's cutouts.
const cutOutOnce = memoByBlob((photo: Blob) => withTimeout(cutOut(photo), SEGMENT_TIMEOUT_MS, 'cutting a person out'))

/**
 * Cut both people out of every TOGETHER cell, one at a time. Any failure → `failed`, and the strip stays side by side.
 * Bump `attempt` to try again after a failure. Like `useStrip` it reads `cells` through a ref and keys by content, so a re-created array with the same photos does
 * not redo the work.
 */
export function useCutouts(cells: readonly CellBlobs[] | null, enabled: boolean, attempt = 0): State {
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
          for (const who of ['a', 'b'] as const) byKey.set(cutoutKey(cell.round, who), await cutOutOnce(cell[who]))
        }
        if (!cancelled) setState({ status: 'ready', byKey })
      } catch {
        if (!cancelled) setState(FAILED)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [key, enabled, attempt, latest])

  return state
}
