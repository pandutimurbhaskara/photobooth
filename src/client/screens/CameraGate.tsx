import { BrutalButton } from '../components/BrutalButton'
import { BrutalCard } from '../components/BrutalCard'
import { PrivacyNote } from '../components/PrivacyNote'

export function CameraGate({ onStart }: { onStart: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-5 p-4">
      <BrutalCard tone="yellow" heavy className="flex flex-col gap-5 p-6">
        <p aria-hidden="true" className="text-sm font-black tracking-[0.3em]">
          01 / CAMERA
        </p>
        <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter">READY WHEN YOU ARE.</h1>
        <BrutalButton tone="ink" size="xl" onClick={onStart}>
          TURN ON CAMERA
        </BrutalButton>
      </BrutalCard>
      <PrivacyNote />
    </main>
  )
}
