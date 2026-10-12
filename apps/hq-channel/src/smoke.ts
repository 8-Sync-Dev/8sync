// Smoke: run dist/server.js against a fake UI, drive it with the MCP SDK client over stdio.
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const home = await mkdtemp(join(tmpdir(), 'hqch-smoke-'))
await mkdir(join(home, '.config/8sync/hq'), { recursive: true })
await writeFile(join(home, '.config/8sync/hq/ui-token'), 'smoke-token', { mode: 0o600 })

const calls: string[] = []
let delivered = false
let heartbeats = 0
const replies: unknown[] = []
const ui = createServer(async (req, res) => {
  let body = ''
  for await (const c of req) body += c
  assert.equal(req.headers['x-hq-token'], 'smoke-token')
  const path = req.url!.split('?')[0]
  calls.push(path)
  res.setHeader('content-type', 'application/json')
  if (path === '/api/channel/inbox') {
    if (!delivered) { delivered = true; return res.end(JSON.stringify({ messages: [{ id: 5, text: 'hello from owner', ts: Date.now() }] })) }
    return setTimeout(() => res.end('{"messages":[]}'), 300)
  }
  if (path === '/api/channel/heartbeat') heartbeats++
  if (path === '/api/channel/reply') replies.push(JSON.parse(body))
  res.end('{"ok":true}')
})
await new Promise<void>(r => ui.listen(0, '127.0.0.1', r))
const port = (ui.address() as { port: number }).port

const here = dirname(fileURLToPath(import.meta.url))
const transport = new StdioClientTransport({
  command: 'node',
  args: [join(here, 'server.js')],
  env: { PATH: process.env.PATH ?? '', HOME: home, EIGHTSYNC_HQ_SESSION: 'hq-smoke', HQ_UI_PORT: String(port) },
  stderr: 'inherit',
})
const client = new Client({ name: 'smoke', version: '0' }, { capabilities: {} })
const notified = new Promise<any>(resolve => {
  client.fallbackNotificationHandler = async n => {
    if (n.method === 'notifications/claude/channel') resolve(n)
  }
})
await client.connect(transport)
const caps = client.getServerCapabilities() as any
assert.deepEqual(caps.experimental['claude/channel'], {})
assert.equal(caps.experimental['claude/channel/permission'], undefined)
const tools = await client.listTools()
assert.ok(tools.tools.some(t => t.name === 'reply'))
console.log('SMOKE ok tools:', tools.tools.map(t => t.name).join(','))

const n = await Promise.race([notified, new Promise<never>((_, j) => setTimeout(() => j(new Error('no notification')), 5000))])
assert.equal(n.params.content, 'hello from owner')
assert.deepEqual(Object.keys(n.params.meta).sort(), ['chat_id', 'message_id', 'ts', 'user'])
assert.equal(n.params.meta.chat_id, 'hq-smoke')
assert.equal(n.params.meta.message_id, '5')
console.log('SMOKE ok notification:', JSON.stringify(n.params))

const r: any = await client.callTool({ name: 'reply', arguments: { text: 'pong' } })
assert.equal(r.content[0].text, 'sent')
assert.deepEqual(replies, [{ session: 'hq-smoke', text: 'pong' }])
console.log('SMOKE ok reply hit fake UI:', JSON.stringify(replies[0]))
assert.ok(heartbeats >= 1)
console.log('SMOKE ok heartbeat x' + heartbeats)

await client.close()
ui.close()
process.exit(0)
