import { useId, type InputHTMLAttributes } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string | null
}

/** Styled like a label-maker panel: a taped label above a chunky, tracked-out field. */
export function BrutalInput({ label, error, id, className = '', ...rest }: Props) {
  const auto = useId()
  const inputId = id ?? auto
  const errorId = `${inputId}-error`
  return (
    <div className="flex flex-col items-start gap-2">
      <label htmlFor={inputId} className="-rotate-1 border-[3px] border-ink bg-ink px-2 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-paper">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
        className={`block w-full border-4 border-ink bg-white px-4 py-4 text-center text-3xl font-black uppercase tracking-[0.3em] text-ink shadow-brutal placeholder:text-ink/40 sm:text-4xl ${className}`}
      />
      {error && (
        <p id={errorId} role="alert" className="border-[3px] border-ink bg-orange px-2 py-1 text-sm font-black uppercase">
          {error}
        </p>
      )}
    </div>
  )
}
