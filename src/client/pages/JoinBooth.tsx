import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { normalizeRoomInput } from '../../shared/room-code'
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
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <label htmlFor="join-code" className="font-black">
        ENTER CODE
      </label>
      <input
        id="join-code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        className="border-4 border-black px-3 py-3 text-2xl font-black uppercase tracking-widest"
      />
      {error && (
        <p role="alert" className="font-black">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="border-4 border-black px-4 py-3 font-black">
        JOIN
      </button>
    </form>
  )
}

export function JoinBooth() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-black">JOIN A BOOTH</h1>
      <JoinForm />
    </main>
  )
}
