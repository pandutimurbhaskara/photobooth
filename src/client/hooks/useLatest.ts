import { useEffect, useRef } from 'react'

/** Always-current ref to the latest value, for callbacks that outlive a render (socket handlers, timers). */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}
