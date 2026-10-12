// Writes ~/.config/8sync/hq/channel-mcp.json (0600) pointing at dist/server.js.
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const server = resolve(dirname(fileURLToPath(import.meta.url)), 'server.js')
const out = join(homedir(), '.config', '8sync', 'hq', 'channel-mcp.json')
const cfg = {
  mcpServers: {
    '8sync-hq': { command: 'node', args: [server], env: { MCP_PROTOCOL_NEGOTIATION: 'legacy' } },
  },
}
await mkdir(dirname(out), { recursive: true, mode: 0o700 })
await writeFile(out, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
await chmod(out, 0o600)
console.log(out)
