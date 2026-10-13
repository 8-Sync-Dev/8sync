// Writes ~/.config/8sync/hq/channel-mcp.json (0600) pointing at the built dist/server.js.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mcpConfigPath, writeMcpConfig } from './channel.js'

const server = resolve(dirname(fileURLToPath(import.meta.url)), 'server.js')
const out = mcpConfigPath()
await writeMcpConfig(out, server)
console.log(out)
