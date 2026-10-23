// Two interchangeable backends for the web app:
//  - local: the agent runs in the browser, state in localStorage (zero setup)
//  - mcp:   the agent runs in the DayLoop MCP server, reached over Streamable HTTP
// Open the app with ?mcp=http://localhost:8787/mcp to use the second one.

import { runTurn } from '../core/agent.js'
import { callTool } from '../core/tools.js'
import { seedWorld } from '../core/seed.js'

const KEY = 'dayloop-world-v2'

export function localBackend() {
  let world
  try { world = JSON.parse(localStorage.getItem(KEY)) } catch { world = null }
  if (!world || world.version !== 2) world = seedWorld()
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(world)) } catch { /* private mode: memory only */ } }
  save()
  return {
    label: 'Engine: in-browser',
    async state() { return world },
    async turn(input) { const r = runTurn(world, input); world = r.world; save(); return r },
    async setClock(time) { world = callTool(world, 'clock_set', { time }).world; save(); return world },
    async reset() { world = seedWorld(); save(); return world },
  }
}

export async function mcpBackend(url) {
  const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ])
  const client = new Client({ name: 'dayloop-web', version: '2.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url)))
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args })
    if (r.isError) throw new Error(r.content?.[0]?.text ?? `${name} failed`)
    return JSON.parse(r.content[r.content.length - 1].text)
  }
  return {
    label: `MCP: ${new URL(url).host}`,
    async state() { return call('dayloop_state') },
    async turn(input) { return input.action ? call('dayloop_action', { action: input.action }) : call('dayloop_ask', { utterance: input.utterance }) },
    async setClock(time) { await call('clock_set', { time }); return call('dayloop_state') },
    async reset() { return call('dayloop_reset') },
  }
}
