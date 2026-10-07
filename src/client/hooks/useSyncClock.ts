import { useCallback, useEffect, useRef, useState } from 'react'
import { SYNC_BURST_INITIAL, SYNC_SPACING_MS } from '../../shared/constants'
import type { ClientMessage } from '../../shared/protocol'
import { SyncClock } from '../lib/sync'

/** Pings the server in short bursts and maintains the server-clock offset. `active` = socket is open. */
export function useSyncClock(send: (m: ClientMessage) => boolean, active: boolean) {
  const clock = useRef(new SyncClock())
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const [synced, setSynced] = useState(false)

  const burst = useCallback(
    (count: number) => {
      for (let i = 0; i < count; i++) {
        timers.current.push(setTimeout(() => void send({ type: 'ping', clientTime: Date.now() }), i * SYNC_SPACING_MS))
      }
    },
    [send],
  )

  const onPong = useCallback((m: { clientTime: number; serverTime: number }) => {
    clock.current.add({ t0: m.clientTime, t1: Date.now(), ts: m.serverTime })
    setSynced(true)
  }, [])

  useEffect(() => {
    if (!active) return
    burst(SYNC_BURST_INITIAL)
    const mine = timers.current
    return () => {
      mine.forEach(clearTimeout)
      mine.length = 0
    }
  }, [active, burst])

  const now = useCallback(() => clock.current.now(), [])
  return { now, synced, burst, onPong }
}
