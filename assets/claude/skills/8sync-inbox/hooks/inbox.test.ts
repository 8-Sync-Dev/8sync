import { expect, mock, test } from 'claude-code/testing'

import { parseInbox, parseOk, pollEvery } from './inbox'

const out = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const TASK = '8 Sync HQ: the owner sent you 1 message(s) from the HQ dashboard. Read and act on them now:\nNew task: x'

/** A fake `8sync ccc inbox`: a queue, one claim at a time, ack drops it, release requeues it. */
function fakeInbox(on: Parameters<Parameters<typeof test>[1]>[1]) {
  const s = { queue: [] as string[], claim: null as string | null, calls: [] as string[][], acks: 0, releases: 0 }
  on('process.run', (_$, e) => {
    s.calls.push([...e.argv])
    const flag = e.argv.find(a => a === '--ack' || a === '--release')
    if (flag === '--ack') {
      const ok = s.claim !== null
      if (ok) s.acks += 1
      s.claim = null
      return out(JSON.stringify({ ok }))
    }
    if (flag === '--release') {
      const ok = s.claim !== null
      if (s.claim !== null) {
        s.queue.unshift(s.claim)
        s.releases += 1
      }
      s.claim = null
      return out(JSON.stringify({ ok }))
    }
    if (s.claim !== null || s.queue.length === 0) return out('{"text":null}')
    s.claim = s.queue.shift() ?? null
    return out(JSON.stringify({ text: s.claim }))
  })
  return s
}

const claims = (s: { calls: string[][] }) => s.calls.filter(c => !c.includes('--ack') && !c.includes('--release'))

test('parse helpers read the JSON and drop junk; the poll slows down when quiet', async () => {
  expect(parseInbox(JSON.stringify({ text: TASK }))).toBe(TASK)
  expect(parseInbox('{"text":null}')).toBe(null)
  expect(parseInbox('{"text":"  "}')).toBe(null)
  expect(parseInbox('')).toBe(null)
  expect(parseInbox('nope')).toBe(null)
  expect(parseInbox(null)).toBe(null)
  expect(parseInbox('[1]')).toBe(null)
  expect(parseOk('{"ok":true}\n')).toBe(true)
  expect(parseOk('{"ok":false}')).toBe(false)
  expect(parseOk('junk')).toBe(false)
  expect(parseOk(null)).toBe(false)
  expect([pollEvery(0), pollEvery(11), pollEvery(12), pollEvery(23), pollEvery(24), pollEvery(999)]).toEqual([1, 1, 3, 3, 6, 6])
})

test('an idle session gets the pending HQ task as a new prompt, then acks it', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  const inbox = fakeInbox(on)
  inbox.queue.push(TASK)
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(inbox.calls[0]).toEqual(['8sync', 'ccc', 'inbox', '--session', 'sess-1', '--json'])
  expect(inbox.calls[1]).toEqual(['8sync', 'ccc', 'inbox', '--session', 'sess-1', '--ack', '--json'])
  expect(submitted).toEqual([TASK])
  expect(inbox.acks).toBe(1)
  await clock.advance(5_000)
  expect(submitted.length).toBe(1) // nothing new pending
  inbox.queue.push('second task')
  await clock.advance(5_000)
  expect(submitted).toEqual([TASK, 'second task'])
  expect(inbox.acks).toBe(2)
})

test('a running main turn is left to the Stop hook; a subagent turn is not', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  const inbox = fakeInbox(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(claims(inbox).length).toBe(1)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ turnId: 't2', agentId: 'a1', answer: 'sub', reason: 'answer' })
  await clock.advance(15_000)
  expect(claims(inbox).length).toBe(1)
  await $.turn.complete({ turnId: 't1', answer: 'main', reason: 'answer' })
  await clock.advance(5_000)
  expect(claims(inbox).length).toBe(2)
})

test('a refused prompt is appended to the prompt box (draft kept) and acked', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  const inbox = fakeInbox(on)
  inbox.queue.push(TASK)
  on('prompt.submit', () => ({ drop: 'blocked by a settings hook' }))
  const fills: { text: string; mode?: string }[] = []
  on('prompt.fill', (_$, e) => {
    fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(fills).toEqual([{ text: TASK, mode: 'append' }])
  expect(inbox.acks).toBe(1)
  expect(inbox.releases).toBe(0)
})

test('a task that neither submits nor fills is released back to the inbox, not lost', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  const inbox = fakeInbox(on)
  inbox.queue.push(TASK)
  on('prompt.submit', () => {
    throw new Error('no surface')
  })
  on('prompt.fill', () => ({ isFilled: false }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(inbox.releases).toBe(1)
  expect(inbox.acks).toBe(0)
  expect(inbox.queue).toEqual([TASK])
  expect(inbox.claim).toBe(null)
})

test('a missing 8sync is silent and a headless session never polls', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  let runs = 0
  on('process.run', () => {
    runs += 1
    return out('', 127)
  })
  let submits = 0
  on('prompt.submit', (_$, e) => {
    submits += 1
    return { text: e.text }
  })
  const r = await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  expect(r.cwd).toBe('/repo')
  await clock.advance(30_000)
  expect(runs).toBe(0)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(runs).toBe(1)
  expect(submits).toBe(0)
})

test('after /clear the new session id is polled; a failing id read keeps the last one', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let id: string | null = 'sess-1'
  on('session.id', () => {
    if (id === null) throw new Error('no session')
    return { value: id }
  })
  const inbox = fakeInbox(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  id = 'sess-2'
  await clock.advance(5_000)
  id = null
  await clock.advance(5_000)
  expect(claims(inbox).map(c => c[4])).toEqual(['sess-1', 'sess-2', 'sess-2'])
})

test('a quiet session polls less often, and a finished main turn resets the pace', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('turn.complete', () => ({ text: 'ok' }))
  const inbox = fakeInbox(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  for (let i = 0; i < 11; i += 1) await clock.advance(5_000) // 12 empty polls: one minute
  expect(claims(inbox).length).toBe(12)
  for (let i = 0; i < 6; i += 1) await clock.advance(5_000) // 30 s at 15 s
  expect(claims(inbox).length).toBe(14)
  await $.turn.complete({ turnId: 't1', answer: 'done', reason: 'answer' })
  await clock.advance(5_000)
  await clock.advance(5_000)
  expect(claims(inbox).length).toBe(16)
})

test('a failing toast keeps the filled task acked; a throwing turn still frees the poll', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  const inbox = fakeInbox(on)
  inbox.queue.push(TASK)
  on('prompt.submit', () => ({ drop: 'busy' }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('ui.toast', () => {
    throw new Error('no surface')
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => {
    throw new Error('engine failed the turn')
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect([inbox.acks, inbox.releases]).toEqual([1, 0])
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ turnId: 't1', answer: 'x', reason: 'answer' }).catch(() => undefined)
  const before = claims(inbox).length
  await clock.advance(5_000)
  expect(claims(inbox).length).toBe(before + 1)
})
