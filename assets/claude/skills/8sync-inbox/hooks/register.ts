// 8sync-inbox: the owner's tasks from 8 Sync HQ reach this session while it is idle.
// HQ cannot type into a session it did not start, so it queues the task in this session's
// inbox. The kit's Stop hook hands the inbox over when a turn ends, but an idle session has
// no turn to end, so before this mod a task sent to a waiting session never arrived.
// Every 5 s while the main loop is idle: `8sync ccc inbox --session <id> --json` takes the
// pending messages (once, masked, the same atomic take as the Stop hook) and
// `$.prompt.submit` starts a turn with them. A refused prompt goes into the prompt box with a
// toast, so a taken task is never lost. Any other failure is silent.
import type { Engine, Register } from 'claude-code'

import { parseInbox } from './inbox'

const POLL_MS = 5_000
const RUN_TIMEOUT_MS = 1_500

// Module state (reset on every load/reload).
const st = { cwd: '', sessionId: '', isWorking: false, inflight: false }

async function take($: Engine): Promise<string | null> {
  try {
    const r = await $.process.run(['8sync', 'ccc', 'inbox', '--session', st.sessionId, '--json'], {
      cwd: st.cwd === '' ? undefined : st.cwd,
      timeoutMs: RUN_TIMEOUT_MS,
    })
    return r.exitCode === 0 ? parseInbox(r.stdout) : null
  } catch {
    return null
  }
}

async function deliver($: Engine): Promise<void> {
  if (st.inflight || st.isWorking || st.sessionId === '') return
  st.inflight = true
  let text: string | null = null
  try {
    text = await take($)
    if (text === null) return
    const r = await $.prompt.submit({ text })
    if (r.drop !== undefined) await keep($, text)
  } catch {
    if (text !== null) await keep($, text)
  } finally {
    st.inflight = false
  }
}

/** The task was taken but did not enter: leave it in the prompt box for the owner. */
async function keep($: Engine, text: string): Promise<void> {
  try {
    await $.prompt.fill({ text })
    $.ui.toast('8 Sync HQ: task của owner chưa vào được phiên, đã để trong ô prompt.')
  } catch {
    // nothing more to do without a surface
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
      void deliver($)
      $.clock.every(POLL_MS, () => {
        void deliver($)
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
    const r = await next(e)
    if (e.agentId === undefined) st.isWorking = false
    return r
  })
}
