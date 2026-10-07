export function CameraGate({ onStart }: { onStart: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <h1 className="text-4xl font-black">READY WHEN YOU ARE.</h1>
      <button type="button" onClick={onStart} className="border-4 border-black px-4 py-4 text-xl font-black">
        TURN ON CAMERA
      </button>
      <p className="text-sm font-bold">
        YOUR CAMERA STAYS IN YOUR BROWSER AND CONNECTS DIRECTLY TO YOUR PARTNER WHEN POSSIBLE. PHOTOS ARE PROCESSED
        LOCALLY UNLESS YOU CHOOSE TO SAVE OR SHARE THEM.
      </p>
    </main>
  )
}
