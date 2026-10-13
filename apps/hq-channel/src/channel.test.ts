import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  HqClient, MAX_REPLY, assertLoopback, buildNotification, loadAfter, parseInbox,
  mcpConfigPath, runPoller, saveAfter, statePath, uiBase, writeMcpConfig,
} from './channel.js'

const servers: Server[] = []
after(() => servers.forEach(s => s.close()))

interface Seen { url: string; token?: string; body?: string }
async function fakeUi(handler: (req: IncomingMessage, seen: Seen[]) => unknown) {
  const seen: Seen[] = []
  const srv = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    seen.push({ url: req.url!, token: req.headers['x-hq-token'] as string, body })
    const out = handler(req, seen)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(out))
  })
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
  servers.push(srv)
  const port = (srv.address() as { port: number }).port
  return { base: `http://127.0.0.1:${port}`, seen }
}

test('notification shape and identifier meta keys', () => {
  const n = buildNotification({ id: 7, text: 'hi', ts: '2026-10-12T00:00:00.000Z' }, 'hq-a')
  assert.equal(n.method, 'notifications/claude/channel')
  assert.equal(n.params.content, 'hi')
  assert.deepEqual(n.params.meta, { chat_id: 'hq-a', message_id: '7', user: 'owner', ts: '2026-10-12T00:00:00.000Z' })
  for (const k of Object.keys(n.params.meta)) assert.match(k, /^[A-Za-z0-9_]+$/)
})

test('parseInbox tolerates junk and sorts', () => {
  const r = parseInbox({ messages: [{ id: 2, text: 'b' }, { id: 'x', text: 'c' }, { id: 1, text: 'a', ts: 1791800000000 }] })
  assert.deepEqual(r.map(m => m.id), [1, 2])
  assert.equal(r[0].ts, new Date(1791800000000).toISOString())
})

test('host refusal', () => {
  assert.throws(() => assertLoopback('http://example.com:8740'), /non-loopback/)
  assert.throws(() => assertLoopback('http://10.0.0.5:8740'), /non-loopback/)
  assert.throws(() => assertLoopback('https://127.0.0.1:8740'), /non-http/)
  assert.throws(() => new HqClient('http://evil.test', 's', async () => 't'), /non-loopback/)
  assert.equal(assertLoopback('http://127.0.0.1:8740').hostname, '127.0.0.1')
  assert.equal(uiBase({}), 'http://127.0.0.1:8740')
  assert.equal(uiBase({ HQ_UI_PORT: '9000' }), 'http://127.0.0.1:9000')
  assert.throws(() => uiBase({ HQ_UI_PORT: 'x@evil.com' }), /invalid/)
})

test('after-id persistence: 0600 file, reload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hqch-'))
  const f = join(dir, 'sub', 'channel-x.json')
  assert.equal(await loadAfter(f), 0)
  await saveAfter(f, 42)
  assert.equal(await loadAfter(f), 42)
  assert.equal((await stat(f)).mode & 0o777, 0o600)
  assert.match(statePath('hq/../x', dir), /channel-hq____x\.json$/)
})

test('poller delivers messages, sends token, persists after, no replay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hqch-'))
  const file = join(dir, 'st.json')
  const ui = await fakeUi((req, seen) => {
    const after = Number(new URL(req.url!, 'http://x').searchParams.get('after'))
    return { messages: [{ id: 1, text: 'one' }, { id: 2, text: 'two' }].filter(m => m.id > after) }
  })
  const got: string[] = []
  const run = async () => {
    const ac = new AbortController()
    const client = new HqClient(ui.base, 'hq-s', async () => 'sekrit\n')
    await runPoller({
      client, stateFile: file, signal: ac.signal,
      notify: async n => { got.push(n.params.meta.message_id); if (got.length % 2 === 0 || n.params.meta.message_id === '2') ac.abort() },
    })
  }
  await run()
  assert.deepEqual(got, ['1', '2'])
  assert.equal(ui.seen[0].token, 'sekrit')
  assert.match(ui.seen[0].url, /session=hq-s&after=0/)
  assert.equal(await loadAfter(file), 2)
  // restart: must ask after=2 and not replay
  const ac2 = new AbortController()
  const client = new HqClient(ui.base, 'hq-s', async () => 't')
  const n0 = ui.seen.length
  setTimeout(() => ac2.abort(), 50)
  await runPoller({ client, stateFile: file, signal: ac2.signal, notify: async () => assert.fail('replayed') })
  assert.match(ui.seen[n0].url, /after=2/)
})

test('poller resets a persisted last_id that is ahead of the inbox max (DB recreated)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hqch-'))
  const file = join(dir, 'st.json')
  await saveAfter(file, 50)
  const ui = await fakeUi(req => {
    const after = Number(new URL(req.url!, 'http://x').searchParams.get('after'))
    return { messages: [{ id: 1, text: 'fresh' }].filter(m => m.id > after), max: 1 }
  })
  const got: string[] = []
  const ac = new AbortController()
  const client = new HqClient(ui.base, 'hq-s', async () => 't')
  await runPoller({
    client, stateFile: file, signal: ac.signal,
    notify: async n => { got.push(n.params.meta.message_id); ac.abort() },
  })
  assert.deepEqual(got, ['1'])
  assert.match(ui.seen[0].url, /after=50/)
  assert.match(ui.seen[1].url, /after=0/)
  assert.equal(await loadAfter(file), 1)
})

test('poller backs off 1s doubling up to cap on errors', async () => {
  const ui = await fakeUi(() => ({}))
  const ac = new AbortController()
  const waits: number[] = []
  const client = new HqClient(ui.base, 's', async () => '')  // empty token => throws every time
  await runPoller({
    client, stateFile: join(await mkdtemp(join(tmpdir(), 'hqch-')), 's.json'), signal: ac.signal,
    notify: async () => {}, minBackoffMs: 1000, maxBackoffMs: 4000,
    sleep: async ms => { waits.push(ms); if (waits.length === 5) ac.abort() },
  })
  assert.deepEqual(waits, [1000, 2000, 4000, 4000, 4000])
})

test('reply POST body and cap; heartbeat POST', async () => {
  const ui = await fakeUi(() => ({ ok: true }))
  const c = new HqClient(ui.base, 'hq-s', async () => 'tok')
  await c.reply('x'.repeat(MAX_REPLY + 500))
  await c.heartbeat()
  assert.equal(ui.seen[0].url, '/api/channel/reply')
  const b = JSON.parse(ui.seen[0].body!)
  assert.equal(b.session, 'hq-s')
  assert.equal(b.text.length, MAX_REPLY)
  assert.equal(ui.seen[0].token, 'tok')
  assert.equal(ui.seen[1].url, '/api/channel/heartbeat')
  assert.deepEqual(JSON.parse(ui.seen[1].body!), { session: 'hq-s' })
})

test('mcp-config: 0600 file pointing at the built server', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hqch-'))
  const f = mcpConfigPath(home)
  assert.equal(f, join(home, '.config', '8sync', 'hq', 'channel-mcp.json'))
  await writeMcpConfig(f, '/abs/dist/server.js', '/usr/bin/node')
  assert.equal((await stat(f)).mode & 0o777, 0o600)
  assert.equal((await stat(join(home, '.config', '8sync', 'hq'))).mode & 0o777, 0o700)
  const cfg = JSON.parse(await readFile(f, 'utf8'))
  assert.deepEqual(cfg.mcpServers['8sync-hq'], {
    command: '/usr/bin/node', args: ['/abs/dist/server.js'], env: { MCP_PROTOCOL_NEGOTIATION: 'legacy' },
  })
})
