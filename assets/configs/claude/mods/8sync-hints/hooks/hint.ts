// Pure helpers of the 8sync-hints mod: parse what `8sync ccc hint --json` prints and decide
// what to ask it for. No `$`, no I/O — so `hint.test.ts` can check them directly.

export type Hint = { suggest: string | null; band: string[] }
export type Row = { text: string; label?: string; description?: string }

const MAX_BAND_LINES = 2
const MAX_ROWS = 8

/** `{suggest, band}` from `8sync ccc hint --json`; null when the output is not that. */
export function parseHint(stdout: string | null | undefined): Hint | null {
  const v = parseJson(stdout)
  if (!v) return null
  const suggest = typeof v.suggest === 'string' && v.suggest.trim() !== '' ? v.suggest.trim() : null
  const band = Array.isArray(v.band)
    ? v.band.filter((l): l is string => typeof l === 'string' && l.trim() !== '').slice(0, MAX_BAND_LINES)
    : []
  return { suggest, band }
}

/** Typeahead rows from `8sync ccc hint --complete <arg> --json`; [] when none or malformed. */
export function parseComplete(stdout: string | null | undefined): Row[] {
  const v = parseJson(stdout)
  if (!v || !Array.isArray(v.complete)) return []
  const rows: Row[] = []
  for (const r of v.complete) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    if (typeof o.text !== 'string' || o.text === '') continue
    const row: Row = { text: o.text }
    if (typeof o.label === 'string' && o.label !== '') row.label = o.label
    if (typeof o.description === 'string' && o.description !== '') row.description = o.description
    rows.push(row)
    if (rows.length >= MAX_ROWS) break
  }
  return rows
}

/**
 * What to pass to `--complete` for the prompt box as it stands, or null when the token is not
 * ours. `/…` tokens: the token itself when it looks like a skill name (not a path like
 * `/home/x`) and does not stand at the very start of the box (there the engine's own slash
 * menu already lists every skill). A line that starts with `8sync` or `ccc`: the line up to the
 * cursor (the Rust side answers with the replacement for the last word).
 */
export function completeArg(text: string, cursor: number, token: string, start = -1): string | null {
  if (token.startsWith('/')) {
    return start !== 0 && /^\/[\w:.-]*$/.test(token) ? token : null
  }
  const head = text.slice(0, cursor)
  const line = head.slice(head.lastIndexOf('\n') + 1).trimStart()
  if (/^(8sync|ccc)(\s|$)/.test(line)) return line
  return null
}

function parseJson(stdout: string | null | undefined): Record<string, unknown> | null {
  if (typeof stdout !== 'string') return null
  const s = stdout.trim()
  if (s === '' || s[0] !== '{') return null
  try {
    const v: unknown = JSON.parse(s)
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
