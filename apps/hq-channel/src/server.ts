#!/usr/bin/env node
// 8sync-hq: Claude Code channel (stdio MCP server) bridging the local HQ UI to one claude session.
// Pattern follows Anthropic's channels reference; code is original.
import { readFile } from 'node:fs/promises'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  HEARTBEAT_MS, HqClient, INSTRUCTIONS, MAX_REPLY, SERVER_NAME,
  log, runPoller, statePath, tokenPath, uiBase,
} from './channel.js'

// Only the shape the UI accepts (hq-<name>); anything else idles the channel.
const rawSession = process.env.EIGHTSYNC_HQ_SESSION?.trim()
const session = rawSession && /^hq-[a-z0-9][a-z0-9-]{0,31}$/.test(rawSession) ? rawSession : undefined

const mcp = new Server(
  { name: SERVER_NAME, version: '0.1.0' },
  {
    // No 'claude/channel/permission': tool approvals stay in the terminal.
    capabilities: { experimental: { 'claude/channel': {} }, tools: {} },
    instructions: INSTRUCTIONS,
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description: 'Send a message to the owner in the 8sync HQ UI. The owner cannot see your transcript, only this.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: `Message text (max ${MAX_REPLY} chars, longer is truncated)` },
          chat_id: { type: 'string', description: 'chat_id from the inbound <channel> tag (optional)' },
        },
        required: ['text'],
      },
    },
  ],
}))

let client: HqClient | undefined

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  try {
    if (req.params.name !== 'reply') throw new Error(`unknown tool: ${req.params.name}`)
    if (!client) throw new Error('channel idle: EIGHTSYNC_HQ_SESSION is not set')
    const text = (req.params.arguments as { text?: unknown } | undefined)?.text
    if (typeof text !== 'string' || !text) throw new Error('text is required')
    await client.reply(text)
    return { content: [{ type: 'text', text: 'sent' }] }
  } catch (e) {
    return { content: [{ type: 'text', text: `reply failed: ${(e as Error).message}` }], isError: true }
  }
})

await mcp.connect(new StdioServerTransport())

const ac = new AbortController()
const shutdown = (): void => ac.abort()
process.stdin.on('end', () => (shutdown(), process.exit(0)))
process.on('SIGTERM', () => (shutdown(), process.exit(0)))
process.on('SIGINT', () => (shutdown(), process.exit(0)))

if (!session) {
  log(rawSession
    ? 'EIGHTSYNC_HQ_SESSION is not an hq-* name; idling (no inbox, reply disabled)'
    : 'EIGHTSYNC_HQ_SESSION is not set; idling (no inbox, reply disabled)')
} else {
  try {
    client = new HqClient(uiBase(), session, () => readFile(tokenPath(), 'utf8'))
    const hb = setInterval(() => {
      client!.heartbeat().catch(e => log(`heartbeat failed: ${(e as Error).message}`))
    }, HEARTBEAT_MS)
    hb.unref()
    client.heartbeat().catch(() => {})
    void runPoller({
      client,
      stateFile: statePath(session),
      signal: ac.signal,
      notify: n => mcp.notification(n),
    })
  } catch (e) {
    log(`not starting: ${(e as Error).message}`)
  }
}
