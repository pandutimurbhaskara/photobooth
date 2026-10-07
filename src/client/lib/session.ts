const memory = new Map<string, string>()

/** Membership secret for one tab in one booth: survives reloads, never leaves this browser except to the server. */
export function getParticipantId(code: string): string {
  const key = `booth:pid:${code}`
  try {
    const stored = sessionStorage.getItem(key)
    if (stored) return stored
    const fresh = crypto.randomUUID()
    sessionStorage.setItem(key, fresh)
    return fresh
  } catch {
    // Storage blocked (private mode, embedded browser): keep it for this page's lifetime only.
    const existing = memory.get(key)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    memory.set(key, fresh)
    return fresh
  }
}
