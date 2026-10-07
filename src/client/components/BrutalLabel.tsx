import type { HTMLAttributes } from 'react'

const TONE = {
  ink: 'bg-ink text-paper',
  yellow: 'bg-yellow text-ink',
  pink: 'bg-pink text-ink',
  lime: 'bg-lime text-ink',
  paper: 'bg-paper text-ink',
} as const
const TILT = { left: '-rotate-2', right: 'rotate-2', none: '' } as const

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONE
  tilt?: keyof typeof TILT
}

/** A small taped-on tag, like a label-maker strip. */
export function BrutalLabel({ tone = 'ink', tilt = 'left', className = '', ...rest }: Props) {
  return (
    <span
      {...rest}
      className={`inline-block border-[3px] border-ink px-2 py-0.5 text-xs font-black uppercase tracking-[0.15em] ${TILT[tilt]} ${TONE[tone]} ${className}`}
    />
  )
}
