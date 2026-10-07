import type { HTMLAttributes } from 'react'

export type CardTone = 'paper' | 'white' | 'yellow' | 'pink' | 'lime' | 'blue' | 'orange' | 'purple'

const TONE: Record<CardTone, string> = {
  paper: 'bg-paper text-ink',
  white: 'bg-white text-ink',
  yellow: 'bg-yellow text-ink',
  pink: 'bg-pink text-ink',
  lime: 'bg-lime text-ink',
  blue: 'bg-blue text-white',
  orange: 'bg-orange text-ink',
  purple: 'bg-purple text-ink',
}

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: CardTone
  /** Key cards get the 4 px border; everything else 3 px. */
  heavy?: boolean
}

export function BrutalCard({ tone = 'paper', heavy = false, className = '', ...rest }: Props) {
  return <div {...rest} className={`${heavy ? 'border-4' : 'border-[3px]'} border-ink shadow-brutal ${TONE[tone]} ${className}`} />
}
