// Pure helper of the 8sync-inbox mod: what `8sync ccc inbox --json` printed. No `$`, no I/O.

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
