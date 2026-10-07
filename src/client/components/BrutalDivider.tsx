const DEFAULT = ['CAPTURE', 'SYNC', 'LIVE', 'REC']

/** A decorative ticker strip. Purely visual, hidden from assistive tech. */
export function BrutalDivider({ words = DEFAULT }: { words?: string[] }) {
  const line = Array.from({ length: 6 }, () => words.join(' ★ ')).join(' ★ ')
  return (
    <div aria-hidden="true" className="overflow-hidden whitespace-nowrap border-y-4 border-ink bg-ink py-2 text-sm font-black uppercase tracking-[0.3em] text-paper">
      {line}
    </div>
  )
}
