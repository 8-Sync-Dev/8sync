// 8sync-hints: a thin drawing layer over `8sync ccc hint` (Rust, local-only, < 50 ms).
//   · session.start / turn.complete / every 20 s while idle → `8sync ccc hint --json`
//     → ghost text in the empty prompt box (Tab takes it) + the band above the prompt.
//   · prompt.autocomplete for `/skill`, `8sync …`, `ccc …` tokens → `--complete`.
// Any failure (no `8sync` on PATH, bad JSON, timeout) is silent, and `8sync` is never awaited
// on the path of a prompt or a turn: the refresh runs beside them, so the box never waits.
import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import { completeArg, parseComplete, parseHint } from './hint'

const band = atom({ plugin: '8sync-hints', key: 'band' } as const, [] as string[])
const isHidden = atom({ plugin: '8sync-hints', key: 'isHidden' } as const, false)

const POLL_MS = 20_000
const RUN_TIMEOUT_MS = 1_500
const CACHE_MS = 10_000

// Module state (reset on every load/reload; `$.state` atoms above survive).
const st = { cwd: '', sessionId: '', isWorking: false, inflight: false }
const cache = new Map<string, { at: number; rows: ReturnType<typeof parseComplete> }>()

async function hint($: Engine, args: readonly string[]): Promise<string | null> {
  try {
    const r = await $.process.run(['8sync', 'ccc', 'hint', ...args, '--json'], {
      cwd: st.cwd === '' ? undefined : st.cwd,
      // So `hint` can find this session's own urgent flag in the ccc registry.
      env: st.sessionId === '' ? undefined : { CLAUDE_CODE_SESSION_ID: st.sessionId },
      timeoutMs: RUN_TIMEOUT_MS,
    })
    return r.exitCode === 0 ? r.stdout : null
  } catch {
    return null
  }
}

async function refresh($: Engine): Promise<void> {
  if (st.inflight || st.isWorking) return
  st.inflight = true
  try {
    const h = parseHint(await hint($, []))
    if (h === null) return
    await update($, band, () => h.band)
    if (h.suggest !== null) {
      // The engine answers { isShown: false } by itself while the box holds text or a turn runs.
      await $.prompt.suggest({ text: h.suggest })
    }
  } catch {
    // silent: hints are best-effort
  } finally {
    st.inflight = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    st.cwd = e.cwd
    try {
      st.sessionId = await $.session.id()
    } catch {
      st.sessionId = ''
    }
    if (e.isInteractive) {
      void refresh($)
      $.clock.every(POLL_MS, () => {
        void refresh($)
      })
    }
    return next(e)
  })

  // Main loop only (`agentId` names a subagent's turn): no polling while the model works.
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) st.isWorking = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      st.isWorking = false
      void refresh($)
    }
    return r
  })

  on('prompt.autocomplete', async ($, e, next) => {
    const arg = completeArg(e.text, e.cursor, e.token, e.start)
    if (arg === null) return next(e)
    const below = await next(e)
    const now = await $.clock.now()
    const hit = cache.get(arg)
    let rows = hit !== undefined && now - hit.at < CACHE_MS ? hit.rows : undefined
    if (rows === undefined) {
      rows = parseComplete(await hint($, ['--complete', arg]))
      cache.set(arg, { at: now, rows })
      if (cache.size > 64) cache.clear()
    }
    return { suggestions: [...below.suggestions, ...rows] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const lines = await read($, band)
    if (e.props.hasSurvey || lines.length === 0 || (await read($, isHidden))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>{lines.join('  ·  ')} </Text>
        <Button key="hide" label="Ẩn" onPress={() => update($, isHidden, () => true)} />
      </Box>
    )
  })
}
