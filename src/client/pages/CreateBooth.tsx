import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { SiteHeader } from '../components/SiteHeader'

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
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 pt-10">
        <BrutalCard tone={failed ? 'orange' : 'yellow'} heavy className="flex flex-col gap-4 p-6" role={failed ? 'alert' : 'status'}>
          {failed ? (
            <>
              <h1 className="text-4xl font-black uppercase leading-none">COULDN'T BUILD YOUR BOOTH.</h1>
              <BrutalButton tone="ink" onClick={() => void create()}>
                TRY AGAIN
              </BrutalButton>
            </>
          ) : (
            <h1 className="flex items-center gap-3 text-4xl font-black uppercase leading-none">
              <span aria-hidden="true" className="inline-block animate-wiggle text-5xl">
                ★
              </span>
              BUILDING YOUR BOOTH…
            </h1>
          )}
        </BrutalCard>
      </main>
    </>
  )
}
