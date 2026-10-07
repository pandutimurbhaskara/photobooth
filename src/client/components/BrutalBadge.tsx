import type { HTMLAttributes } from 'react'

export type BadgeTone = 'lime' | 'yellow' | 'blue' | 'orange' | 'pink' | 'ink' | 'paper'

const TONE: Record<BadgeTone, string> = {
  lime: 'bg-lime text-ink',
  yellow: 'bg-yellow text-ink',
  blue: 'bg-blue text-white',
  orange: 'bg-orange text-ink',
  pink: 'bg-pink text-ink',
  ink: 'bg-ink text-paper',
  paper: 'bg-paper text-ink',
}

export function BrutalBadge({ tone = 'paper', className = '', ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-2 border-[3px] border-ink px-2 py-1 text-xs font-black uppercase tracking-wider ${TONE[tone]} ${className}`}
    />
  )
}
