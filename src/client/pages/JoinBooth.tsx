import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { normalizeRoomInput } from '../../shared/room-code'
import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { BrutalInput } from '../components/BrutalInput'
import { SiteHeader } from '../components/SiteHeader'
import { getParticipantId } from '../lib/session'

export function JoinForm() {
  const navigate = useNavigate()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const code = normalizeRoomInput(value)
    if (!code) {
      setError('THAT CODE LOOKS WRONG.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/rooms/${code}`, { headers: { 'x-participant-id': getParticipantId(code) } })
      if (res.status === 404) setError('NO BOOTH WITH THAT CODE.')
      else if (!res.ok) setError('COULD NOT CHECK THAT BOOTH. TRY AGAIN.')
      else if (((await res.json()) as { full: boolean }).full) setError('BOOTH FULL.')
      else void navigate(`/b/${code}`)
    } catch {
      setError('COULD NOT REACH THE SERVER.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <BrutalInput
        label="ENTER CODE"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={error}
        placeholder="A7K 9XM"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        inputMode="text"
      />
      <BrutalButton type="submit" tone="ink" size="xl" disabled={busy}>
        JOIN
      </BrutalButton>
    </form>
  )
}

export function JoinBooth() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-xl flex-col gap-6 p-4 pt-10">
        <BrutalCard tone="lime" heavy className="flex flex-col gap-5 p-5">
          <h1 className="text-4xl font-black uppercase leading-none">JOIN A BOOTH</h1>
          <JoinForm />
        </BrutalCard>
      </main>
    </>
  )
}
