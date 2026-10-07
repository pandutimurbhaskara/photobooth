import { useEffect, useState } from 'react'

export type Gate = 'checking' | 'ok' | 'not-found' | 'full' | 'error'

/** Pre-flight: does this booth exist, and is there room for *me* (a member reloading is never "full")? */
export function useRoomGate(code: string, participantId: string): Gate {
  const [gate, setGate] = useState<Gate>('checking')
  useEffect(() => {
    const abort = new AbortController()
    fetch(`/api/rooms/${code}`, { headers: { 'x-participant-id': participantId }, signal: abort.signal })
      .then(async (res) => {
        if (res.status === 404) return setGate('not-found')
        if (!res.ok) return setGate('error')
        const body = (await res.json()) as { full: boolean }
        setGate(body.full ? 'full' : 'ok')
      })
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setGate('error')
      })
    return () => abort.abort()
  }, [code, participantId])
  return gate
}
