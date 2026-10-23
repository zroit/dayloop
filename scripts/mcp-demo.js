// A tiny MCP client that drives DayLoop over Streamable HTTP, the way an
// Alexa+ agent or any other MCP host would. Start the server first: npm run mcp
//   npm run mcp:demo

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const url = new URL(process.env.DAYLOOP_MCP ?? 'http://localhost:8787/mcp')
const client = new Client({ name: 'dayloop-demo-client', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(url))

const { tools } = await client.listTools()
console.log(`Connected to ${url}. ${tools.length} tools:\n  ${tools.map((t) => t.name).join(', ')}\n`)

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  return r.content[0].text
}
const ask = async (utterance) => console.log(`USER: ${utterance}\n${await call('dayloop_ask', { utterance })}\n`)

await call('dayloop_reset')
await ask('Alexa, build my day.')
await ask('Approve')
await call('clock_set', { time: '14:00' })
await ask("The design review ran long. I'm 40 minutes behind.")
await ask('Approve')
await call('clock_set', { time: '18:00' })
await ask("Close my day. Everything's done except the monthly report. And no calls before 10 tomorrow.")
console.log(`SLEEP: ${await call('dayloop_action', { action: 'sleep' })}\n`)
console.log(`DAY 2 (new session, memory only):\n${await call('dayloop_action', { action: 'build_day' })}\n`)
await client.close()
