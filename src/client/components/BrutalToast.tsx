import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface Toast {
  id: number
  text: string
}

const ToastContext = createContext<(text: string) => void>(() => {})
export const useToast = (): ((text: string) => void) => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const push = useCallback((text: string) => {
    const id = nextId.current++
    setToasts((all) => [...all.slice(-2), { id, text }])
    setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 2600)
  }, [])

  return (
    <ToastContext value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        {toasts.map((t) => (
          <p key={t.id} className="animate-pop border-4 border-ink bg-yellow px-4 py-2 text-sm font-black uppercase text-ink shadow-brutal">
            {t.text}
          </p>
        ))}
      </div>
    </ToastContext>
  )
}
