import { expect, mock, test } from 'claude-code/testing'

import { completeArg, parseComplete, parseHint } from './hint'

const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('parseHint reads suggest + band and drops junk', async () => {
  expect(parseHint('{"suggest":" tiếp tục loop x (iter 1/2) ","band":["loop x 1/2","⎇ main","three"]}')).toEqual({
    suggest: 'tiếp tục loop x (iter 1/2)',
    band: ['loop x 1/2', '⎇ main'],
  })
  expect(parseHint('{"suggest":null,"band":[]}')).toEqual({ suggest: null, band: [] })
  expect(parseHint('')).toBe(null)
  expect(parseHint('not json')).toBe(null)
  expect(parseHint(null)).toBe(null)
  expect(parseHint('[1]')).toBe(null)
})

test('parseComplete keeps well-formed rows only, at most 8', async () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ text: `/s${i}`, label: `s${i}`, description: `d${i}` }))
  const out = parseComplete(JSON.stringify({ complete: [...rows, { text: '' }, { label: 'no text' }, 7] }))
  expect(out.length).toBe(8)
  expect(out[0]).toEqual({ text: '/s0', label: 's0', description: 'd0' })
  expect(parseComplete('{"complete":"x"}')).toEqual([])
  expect(parseComplete(undefined)).toEqual([])
})

test('completeArg: slash token (not a path, not at the box start), 8sync/ccc lines, nothing else', async () => {
  expect(completeArg('/sh', 3, '/sh')).toBe('/sh')
  expect(completeArg('fix it then /sh', 15, '/sh', 12)).toBe('/sh')
  expect(completeArg('/sh', 3, '/sh', 0)).toBe(null)
  expect(completeArg('see /home/me/x', 14, '/home/me/x', 4)).toBe(null)
  expect(completeArg('x /a:b.c-d', 10, '/a:b.c-d', 2)).toBe('/a:b.c-d')
  expect(completeArg('8sync ccc lo', 12, 'lo')).toBe('8sync ccc lo')
  expect(completeArg('run\n  ccc lo', 12, 'lo')).toBe('ccc lo')
  expect(completeArg('8sync', 5, '8sync')).toBe('8sync')
  expect(completeArg('please run 8sync ccc lo', 23, 'lo')).toBe(null)
  expect(completeArg('hello', 5, 'hello')).toBe(null)
})

test('session.start asks 8sync ccc hint beside the start and proposes its suggestion', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let argv: readonly string[] = []
  let cwd: string | undefined
  let env: Record<string, string> | undefined
  on('session.id', () => ({ value: 'sess-1' }))
  on('process.run', (_$, e) => {
    argv = e.argv
    cwd = e.init?.cwd
    env = e.init?.env
    return ok('{"suggest":"tiếp tục loop x (iter 1/2)","band":["loop x 1/2"]}')
  })
  let suggested = ''
  on('prompt.suggest', (_$, e) => {
    suggested = e.text
    return { isShown: true }
  })
  const r = await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(r.cwd).toBe('/repo')
  await clock.settle() // the refresh is never awaited on the start path
  expect(argv).toEqual(['8sync', 'ccc', 'hint', '--json'])
  expect(cwd).toBe('/repo')
  expect(env?.CLAUDE_CODE_SESSION_ID).toBe('sess-1')
  expect(suggested).toBe('tiếp tục loop x (iter 1/2)')
  suggested = ''
  await clock.advance(20_000) // idle poll
  expect(suggested).toBe('tiếp tục loop x (iter 1/2)')
})

test('a subagent turn does not pause or trigger the refresh; the main turn does', async ($, on) => {
  const clock = mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let runs = 0
  on('process.run', () => {
    runs += 1
    return ok('{"suggest":null,"band":["⎇ main"]}')
  })
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(runs).toBe(1)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(20_000) // the poll is skipped while the main turn runs
  await $.turn.complete({ turnId: 't2', agentId: 'a1', answer: 'sub', reason: 'answer' })
  await clock.settle()
  expect(runs).toBe(1)
  const r = await $.turn.complete({ turnId: 't1', answer: 'main', reason: 'answer' })
  expect(r.text).toBe('done')
  await clock.settle()
  expect(runs).toBe(2)
})

test('a failing 8sync is silent: no suggestion, session still starts', async ($, on) => {
  mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 127, stdout: '', stderr: 'not found', isStdoutTruncated: false, isStderrTruncated: false } }))
  let suggested = 0
  on('prompt.suggest', () => {
    suggested += 1
    return { isShown: true }
  })
  const r = await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(r.cwd).toBe('/repo')
  expect(suggested).toBe(0)
})

test('headless session does not poll', async ($, on) => {
  mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  let runs = 0
  on('process.run', () => {
    runs += 1
    return ok('{"suggest":null,"band":[]}')
  })
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false })
  expect(runs).toBe(0)
})

test('AbovePrompt draws the band and Ẩn hides it', async ($, on) => {
  mock.clock(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('process.run', () => ok('{"suggest":null,"band":["loop x 1/2","⎇ feat ↑2 ✎"]}'))
  // The engine's own band when the plugin yields (hidden): an empty line.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine-band' })
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const mounts = []
  for (const surface of ['terminal', 'desktop'] as const) {
    const m = await $.ui.mount({
      plugin: '8sync-hints',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { offset: 0, bodyRows: 8 }, view: {} },
    })
    expect(JSON.stringify(await m.drawn())).toContain('loop x 1/2')
    mounts.push(m)
  }
  // Ẩn is session state: pressed on one surface, the band is gone on every surface.
  await mounts[0].press({ key: 'hide' })
  for (const m of mounts) {
    expect(JSON.stringify(await m.drawn())).not.toContain('loop x 1/2')
  }
})
