// 8sync-inbox: the owner's tasks from 8 Sync HQ reach this session while it is idle.
// HQ cannot type into a session it did not start, so it queues the task in this session's
// inbox. The kit's Stop hook hands the inbox over when a turn ends, but an idle session has
// no turn to end, so before this mod a task sent to a waiting session never arrived.
//
// While the main loop is idle, every poll runs `8sync ccc inbox --session <id> --json`, which
// CLAIMS the pending messages (masked; not deleted). `$.prompt.submit` starts a turn with
// them. If the prompt is refused, it is appended to the prompt box (the owner's draft stays).
// Then `--ack` drops the claim when the task entered the session, `--release` hands it back to
// the inbox otherwise, and a claim nobody acks or releases (killed process) is served again
// after two minutes. So a task is never lost, and it is delivered once.
//
// Polling: every 5 s for the first minute of quiet, then every 15 s, then every 30 s; a main
// turn ending or a delivery starts it over. A running turn is left to the Stop hook.
//
// Trust boundary: the text comes from the owner's local HQ (its API requires the HQ token) and
// is framed as the owner's message, like the Stop hook's.
import type { Engine, Register } from 'claude-code'

import { parseInbox, parseOk, pollEvery } from './inbox'

const POLL_MS = 5_000
const RUN_TIMEOUT_MS = 5_000
const TOAST = '8 Sync HQ: task của owner chưa tự gửi được, đã thêm vào ô prompt (Enter để gửi).'

// Module state (reset on every load/reload).
const st = { cwd: '', sessionId: '', isWorking: false, inflight: false, empty: 0, tick: 0 }

async function run($: Engine, args: string[]): Promise<string | null> {
  const r = await $.process.run(['8sync', 'ccc', 'inbox', '--session', st.sessionId, ...args, '--json'], {
    cwd: st.cwd === '' ? undefined : st.cwd,
    timeoutMs: RUN_TIMEOUT_MS,
  })
  return r.exitCode === 0 ? r.stdout : null
}

/** Ack (entered) or release (did not); one retry, as an unacked claim is served again later. */
async function settle($: Engine, entered: boolean): Promise<void> {
  const flag = entered ? '--ack' : '--release'
  for (let i = 0; i < 2; i += 1) {
    try {
      if (parseOk(await run($, [flag]))) return
    } catch {
      // retry once
    }
  }
}

/** Did the claimed text enter the session: submitted, or appended to the prompt box. */
async function enter($: Engine, text: string): Promise<boolean> {
  try {
    const r = await $.prompt.submit({ text })
    if (r.drop === undefined) return true
  } catch {
    // fall through to the prompt box
  }
  try {
    const f = await $.prompt.fill({ text, mode: 'append' })
    if (!f.isFilled) return false
  } catch {
    return false
  }
  try {
    $.ui.toast(TOAST) // the task is in the box already: a failed toast must not release it
  } catch {
    // no toast on this surface
  }
  return true
}

async function deliver($: Engine): Promise<void> {
  if (st.inflight || st.isWorking) return
  st.inflight = true
  try {
    // Read on every poll: after `/clear` the process goes on under a new session id and no
    // `session.start` fires, while HQ addresses the new id. A failed read keeps the last one.
    try {
      const id = await $.session.id()
      if (typeof id === 'string' && id !== '') st.sessionId = id
    } catch {
      // keep the last good id
    }
    if (st.sessionId === '') return
    let text: string | null = null
    try {
      text = parseInbox(await run($, []))
    } catch {
      text = null
    }
    if (text === null) {
      st.empty += 1
      return
    }
    st.empty = 0
    await settle($, await enter($, text))
  } finally {
    st.inflight = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    st.cwd = e.cwd
    if (e.isInteractive) {
      void deliver($)
      $.clock.every(POLL_MS, () => {
        st.tick += 1
        if (st.tick % pollEvery(st.empty) === 0) void deliver($)
      })
    }
    return next(e)
  })

  // Main loop only (`agentId` names a subagent's turn): a running turn gets the inbox from the
  // Stop hook, so the poll waits.
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) st.isWorking = true
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    try {
      return await next(e)
    } finally {
      if (e.agentId === undefined) {
        st.isWorking = false
        st.empty = 0
      }
    }
  })
}
