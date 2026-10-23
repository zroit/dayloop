// DayLoop MCP server (Streamable HTTP, stateless).
// Serves the same tools the web app uses, so any MCP client can drive DayLoop:
// an Alexa+ agent, Claude, or MCP Inspector. State is kept in a JSON file, so
// memory survives restarts the same way it survives a browser reload.
//
//   npm run mcp            -> http://localhost:8787/mcp
//   PORT=9000 npm run mcp

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { TOOLS, callTool } from '../src/core/tools.js'
import { runTurn } from '../src/core/agent.js'
import { seedWorld } from '../src/core/seed.js'

const PORT = Number(process.env.PORT ?? 8787)
const STATE_FILE = process.env.DAYLOOP_STATE ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '.dayloop-state.json')

function load() {
  try {
    const w = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    if (w.version === 2) return w
  } catch { /* first run */ }
  return seedWorld()
}
const save = (w) => fs.writeFileSync(STATE_FILE, JSON.stringify(w, null, 2))

const text = (...parts) => ({ content: parts.map((p) => ({ type: 'text', text: typeof p === 'string' ? p : JSON.stringify(p) })) })
const guard = (fn) => async (args) => {
  try { return await fn(args ?? {}) } catch (e) { return { ...text(`Error: ${e.message}`), isError: true } }
}

function turn(input) {
  const r = runTurn(load(), input)
  save(r.world)
  const log = r.steps.map((s) => (s.kind === 'tool' ? `- ${s.tool}: ${s.summary}` : `- (${s.text})`)).join('\n')
  return text(`${r.reply}\n\nSteps:\n${log}`, { reply: r.reply, steps: r.steps, cards: r.cards, pending: r.pending, world: r.world })
}

function buildServer() {
  const server = new McpServer({ name: 'dayloop', version: '2.0.0' })

  for (const t of TOOLS) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.input, annotations: t.annotations }, guard((args) => {
      const out = callTool(load(), t.name, args)
      save(out.world)
      return text(out.summary, out.result)
    }))
  }

  server.registerTool('dayloop_ask', {
    description: 'Talk to the DayLoop agent in plain words, as you would to Alexa ("build my day", "I\'m 40 minutes behind", "close my day ..."). It calls the other tools itself and returns its reply, every step, and anything waiting for approval.',
    inputSchema: { utterance: z.string() },
  }, guard(({ utterance }) => turn({ utterance })))

  server.registerTool('dayloop_action', {
    description: 'Run a DayLoop action without words: approve or decline what is waiting, build the day, or sleep (start the next day as a new session).',
    inputSchema: { action: z.enum(['approve', 'decline', 'build_day', 'sleep', 'next_day']) },
  }, guard(({ action }) => turn({ action })))

  server.registerTool('dayloop_state', {
    description: 'The whole simulated world: calendar, tasks with promises, chat, inbox, drafts, plan, memory.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, guard(() => text('DayLoop state', load())))

  server.registerTool('dayloop_reset', {
    description: 'Reset the simulation to the seed data (Day 1, 08:00).',
    inputSchema: {},
    annotations: { destructiveHint: true },
  }, guard(() => { const w = seedWorld(); save(w); return text('Reset to Day 1, 08:00', w) }))

  return server
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
}

http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') return res.writeHead(204).end()
  if (!req.url.startsWith('/mcp')) return res.writeHead(404, { 'Content-Type': 'text/plain' }).end('DayLoop MCP server: POST /mcp')
  if (req.method !== 'POST') return res.writeHead(405, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null }))

  let body = ''
  for await (const chunk of req) body += chunk
  const server = buildServer()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { transport.close(); server.close() })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined)
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e.message }, id: null }))
  }
}).listen(PORT, () => console.log(`DayLoop MCP server on http://localhost:${PORT}/mcp (${TOOLS.length + 4} tools, state: ${STATE_FILE})`))
