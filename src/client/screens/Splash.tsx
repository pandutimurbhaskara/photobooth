export function Splash({ text }: { text: string }) {
  return (
    <main className="grid min-h-dvh place-items-center p-6" role="status">
      <p className="flex items-center gap-3 border-4 border-ink bg-yellow px-5 py-4 text-2xl font-black uppercase shadow-brutal">
        <span aria-hidden="true" className="inline-block animate-wiggle">
          ★
        </span>
        {text}
      </p>
    </main>
  )
}
