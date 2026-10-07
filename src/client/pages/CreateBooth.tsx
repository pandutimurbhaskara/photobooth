import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

export function CreateBooth() {
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  const started = useRef(false)

  const create = useCallback(async () => {
    setFailed(false)
    try {
      const res = await fetch('/api/rooms', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      const { code } = (await res.json()) as { code: string }
      void navigate(`/b/${code}`, { replace: true })
    } catch {
      setFailed(true)
    }
  }, [navigate])

  useEffect(() => {
    if (started.current) return // StrictMode runs effects twice in dev; make one room, not two
    started.current = true
    void create()
  }, [create])

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      {failed ? (
        <>
          <h1 className="text-3xl font-black">COULDN'T BUILD YOUR BOOTH.</h1>
          <button type="button" onClick={() => void create()} className="border-4 border-black px-4 py-3 font-black">
            TRY AGAIN
          </button>
        </>
      ) : (
        <h1 className="text-3xl font-black">BUILDING YOUR BOOTH…</h1>
      )}
    </main>
  )
}
