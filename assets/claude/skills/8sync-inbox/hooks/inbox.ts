// Pure helpers of the 8sync-inbox mod: what `8sync ccc inbox` printed, and the poll pace. No `$`, no I/O.

/** The pending text from `{"text": string|null}`; null when there is none or the output is not that. */
export function parseInbox(stdout: string | null | undefined): string | null {
  if (typeof stdout !== 'string') return null
  const s = stdout.trim()
  if (s === '' || s[0] !== '{') return null
  try {
    const v: unknown = JSON.parse(s)
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
    const t = (v as Record<string, unknown>).text
    return typeof t === 'string' && t.trim() !== '' ? t : null
  } catch {
    return null
  }
}

/** `{"ok": true}` from `8sync ccc inbox --ack|--release --json`. */
export function parseOk(stdout: string | null | undefined): boolean {
  if (typeof stdout !== 'string') return false
  try {
    const v: unknown = JSON.parse(stdout.trim())
    return v !== null && typeof v === 'object' && (v as Record<string, unknown>).ok === true
  } catch {
    return false
  }
}

/** Poll on every n-th 5 s tick after `empty` empty polls: 5 s for a minute, then 15 s, then 30 s. */
export function pollEvery(empty: number): number {
  if (empty < 12) return 1
  if (empty < 24) return 3
  return 6
}
