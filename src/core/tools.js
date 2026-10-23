// One tool registry for every way into DayLoop: the in-browser agent, and the
// MCP server that any MCP client (an Alexa+ agent, Claude, MCP Inspector) can call.

import { z } from 'zod'
import { calendarTools } from './services/calendar.js'
import { taskTools } from './services/tasks.js'
import { teamChatTools } from './services/teamChat.js'
import { clientInboxTools } from './services/clientInbox.js'
import { memoryTools } from './services/memory.js'
import { buildPlan, promiseLedger } from './planner.js'

const plannerTools = [
  {
    name: 'planner_build_day',
    description:
      'Build or rebuild the plan for a day: resolve calendar conflicts, respect learned preferences, pack tasks by priority, and report what no longer fits. Pass delayMin when the user is running late.',
    input: {
      day: z.number().int().min(1).optional(),
      from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      delayMin: z.number().int().min(0).max(480).optional(),
    },
    run(world, args) {
      const plan = buildPlan(world, args)
      world.plan = plan
      return plan
    },
    summary: (p) => {
      const parts = [`${p.blocks.filter((b) => !b.past).length} tasks placed from ${p.restartAt}`]
      if (p.moves.length) parts.push(`${p.moves.length} meeting move proposed (${p.moves.map((m) => `${m.title} ${m.from.start} -> ${m.to.start}`).join(', ')})`)
      parts.push(p.overflow.length ? `${p.overflow.length} task no longer fits today` : 'everything fits')
      return `Plan: ${parts.join(', ')}`
    },
  },
  {
    name: 'planner_apply_plan',
    description: 'Mark the proposed plan as applied (after the user approved it).',
    input: {},
    run(world) {
      if (world.plan) world.plan.status = 'applied'
      return { status: world.plan?.status ?? 'none' }
    },
    summary: () => 'Plan applied to the day',
  },
  {
    name: 'promises_check',
    description: 'Check every promise made to a client against the current plan: kept, on track, at risk, or broken.',
    input: {},
    annotations: { readOnlyHint: true },
    run(world) {
      return promiseLedger(world)
    },
    summary: (r) => {
      const count = (s) => r.filter((p) => p.state === s).length
      const risk = r.filter((p) => p.state === 'at_risk')
      const parts = [`${r.length} promises`]
      if (count('kept')) parts.push(`${count('kept')} kept`)
      if (count('on_track')) parts.push(`${count('on_track')} on track`)
      if (count('scheduled')) parts.push(`${count('scheduled')} due later`)
      if (risk.length) parts.push(`${risk.length} AT RISK (${risk.map((p) => `${p.what} -> ${p.contact}`).join(', ')})`)
      return parts.join(', ')
    },
  },
  {
    name: 'promises_renegotiate',
    description: 'Record a new deadline for a promise, after the client was told.',
    input: { taskId: z.string(), byDay: z.number().int().min(1), byTime: z.string().regex(/^\d{2}:\d{2}$/), note: z.string().optional() },
    run(world, { taskId, byDay, byTime, note }) {
      const t = world.tasks.find((x) => x.id === taskId)
      if (!t?.promise) throw new Error(`No promise on task ${taskId}`)
      t.promise.history.push({ day: world.day, from: { byDay: t.promise.byDay, byTime: t.promise.byTime }, note })
      t.promise.byDay = byDay
      t.promise.byTime = byTime
      return { taskId, to: t.promise.contact, what: t.promise.what, byDay, byTime }
    },
    summary: (r) => `Promise renegotiated: ${r.what} -> ${r.to} by day ${r.byDay} ${r.byTime}`,
  },
]

export const TOOLS = [...calendarTools, ...taskTools, ...teamChatTools, ...clientInboxTools, ...memoryTools, ...plannerTools]
const BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]))

// Run one tool against a copy of the world. Returns the new world and the result.
export function callTool(world, name, args = {}) {
  const tool = BY_NAME[name]
  if (!tool) throw new Error(`Unknown tool: ${name}`)
  const parsed = z.object(tool.input).parse(args)
  const next = structuredClone(world)
  const result = tool.run(next, parsed)
  return { world: next, result, summary: tool.summary ? tool.summary(result, parsed, next) : '' }
}
