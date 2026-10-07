import type { ButtonHTMLAttributes } from 'react'

export type Tone = 'yellow' | 'pink' | 'lime' | 'ink' | 'paper' | 'blue'

const TONE: Record<Tone, string> = {
  yellow: 'bg-yellow text-ink',
  pink: 'bg-pink text-ink',
  lime: 'bg-lime text-ink',
  ink: 'bg-ink text-paper',
  paper: 'bg-paper text-ink',
  blue: 'bg-blue text-white',
}

/** Shared by <button> and router <Link>s so both look and press the same. */
export function buttonClass(tone: Tone = 'yellow', size: 'md' | 'xl' = 'md'): string {
  return [
    'inline-flex items-center justify-center gap-2 border-[3px] border-ink font-black uppercase leading-none tracking-tight shadow-brutal',
    'transition-transform duration-75 active:translate-x-1 active:translate-y-1 active:shadow-press',
    'disabled:pointer-events-none disabled:translate-x-1 disabled:translate-y-1 disabled:opacity-60 disabled:shadow-press',
    size === 'xl' ? 'min-h-16 px-6 py-5 text-2xl sm:text-3xl' : 'min-h-12 px-4 py-3 text-base',
    TONE[tone],
  ].join(' ')
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: Tone
  size?: 'md' | 'xl'
}

export function BrutalButton({ tone, size, className = '', type = 'button', ...rest }: Props) {
  return <button type={type} {...rest} className={`${buttonClass(tone, size)} ${className}`} />
}
