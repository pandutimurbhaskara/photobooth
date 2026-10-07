import { useEffect, useId, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/** Native <dialog>: the platform provides the focus trap, Esc to close, inert background and focus return. */
export function BrutalModal({ open, onClose, title, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // a click on the backdrop
      }}
      className="m-auto w-[min(92vw,26rem)] border-4 border-ink bg-paper p-0 text-ink shadow-brutal backdrop:bg-ink/80"
    >
      <div className="flex items-center justify-between gap-3 border-b-4 border-ink bg-yellow px-4 py-2">
        <h2 id={titleId} className="text-lg font-black uppercase">
          {title}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="min-h-10 min-w-10 border-[3px] border-ink bg-paper font-black">
          ✕
        </button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  )
}
