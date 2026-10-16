import { expect, mock, test } from 'claude-code/testing'

import { parseInbox } from './inbox'

const out = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})
const TASK = '8 Sync HQ: the owner sent you 1 message(s) from the HQ dashboard. Read and act on them now:\nNew task: x'

test('parseInbox reads the text and drops junk', async () => {
  expect(parseInbox(JSON.stringify({ text: TASK }))).toBe(TASK)
  expect(parseInbox('{"text":null}')).toBe(null)
  expect(parseInbox('{"text":"  "}')).toBe(null)
  expect(parseInbox('')).toBe(null)
  expect(parseInbox('nope')).toBe(null)
  expect(parseInbox(null)).toBe(null)
  expect(parseInbox('[1]')).toBe(null)
})

test('an idle session gets the pending HQ task as a new prompt', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  let argv: readonly string[] = []
  let pending: string | null = TASK
  on('process.run', (_$, e) => {
    argv = e.argv
    const r = out(JSON.stringify({ text: pending }))
    pending = null // taken once
    return r
  })
  const submitted: string[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(argv).toEqual(['8sync', 'ccc', 'inbox', '--session', 'sess-1', '--json'])
  expect(submitted).toEqual([TASK])
  await clock.advance(5_000)
  expect(submitted.length).toBe(1) // nothing new pending
  pending = 'second task'
  await clock.advance(5_000)
  expect(submitted).toEqual([TASK, 'second task'])
})

test('a running main turn is left to the Stop hook; a subagent turn is not', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  let runs = 0
  on('process.run', () => {
    runs += 1
    return out('{"text":null}')
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(runs).toBe(1)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ turnId: 't2', agentId: 'a1', answer: 'sub', reason: 'answer' })
  await clock.advance(15_000)
  expect(runs).toBe(1)
  await $.turn.complete({ turnId: 't1', answer: 'main', reason: 'answer' })
  await clock.advance(5_000)
  expect(runs).toBe(2)
})

test('a refused prompt is kept in the prompt box, not lost', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('process.run', () => out(JSON.stringify({ text: TASK })))
  on('prompt.submit', () => ({ drop: 'blocked by a settings hook' }))
  let filled = ''
  on('prompt.fill', (_$, e) => {
    filled = e.text
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(filled).toBe(TASK)
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
