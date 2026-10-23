// The DayLoop agent. One turn = parse what the user said, call tools across the
// services, decide, and queue anything that leaves DayLoop for the user's approval.
// Every tool call is recorded as a step, so the orchestration is visible.

import { callTool } from './tools.js'
import { parseIntent } from './intent.js'
import { eventsFor } from './planner.js'
import { say, sayAt, addMin } from './time.js'

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)
const firstName = (who) => (who ?? '').split(' ')[0]
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function context(world) {
  const ctx = { world, steps: [] }
  ctx.call = (tool, args = {}) => {
    const out = callTool(ctx.world, tool, args)
    ctx.world = out.world
    ctx.steps.push({ kind: 'tool', tool, args, summary: out.summary })
    return out.result
  }
  ctx.think = (text) => ctx.steps.push({ kind: 'think', text })
  ctx.task = (id) => ctx.world.tasks.find((t) => t.id === id)
  return ctx
}

export function runTurn(world, input) {
  const ctx = context(world)
  const intent = input.action ? { type: input.action } : parseIntent(input.utterance ?? '', world)
  const handlers = { build_day: buildDay, replan, close_day: closeDay, next_day: nextDay, sleep, approve, decline }
  const out = (handlers[intent.type] ?? unknown)(ctx, intent)
  return { world: ctx.world, steps: ctx.steps, intent, reply: out.reply, cards: out.cards ?? [], pending: ctx.world.pending }
}

// Rows for the timeline card: meetings (with proposed moves) and task blocks.
function timeline(ctx, plan) {
  const prevStart = Object.fromEntries(plan.previousBlocks.map((b) => [b.taskId, b.start]))
  const events = eventsFor(ctx.world, plan.day).map((e) => {
    const mv = plan.moves.find((m) => m.eventId === e.id)
    return {
      kind: 'event', type: e.kind, title: e.title, start: mv ? mv.to.start : e.start, end: mv ? mv.to.end : e.end,
      movedFrom: mv ? mv.from.start : null, reason: mv?.reason ?? null,
    }
  })
  const blocks = plan.blocks.map((b) => {
    const t = ctx.task(b.taskId)
    return {
      kind: 'task', title: t.title, start: b.start, end: b.end, past: !!b.past, top: plan.top3.includes(b.taskId),
      promiseTo: t.promise?.contact ?? null, shiftedFrom: prevStart[b.taskId] && prevStart[b.taskId] !== b.start ? prevStart[b.taskId] : null,
    }
  })
  const overflow = plan.overflow.map((id) => ({ title: ctx.task(id).title, promiseTo: ctx.task(id).promise?.contact ?? null }))
  return { rows: [...events, ...blocks].sort((a, b) => a.start.localeCompare(b.start)), overflow }
}

function queue(ctx, kind, label, actions, messages) {
  ctx.world.pending = { id: `p${Date.now() % 100000}`, kind, label, actions, messages }
}

function draftClient(ctx, to, text, replyTo) {
  const d = ctx.call('client_inbox_draft', { to, text, ...(replyTo ? { replyTo } : {}) })
  return { message: { channel: 'client', to, text, draftId: d.id }, action: { tool: 'client_inbox_send', args: { draftId: d.id, approvedByUser: true } } }
}

function buildDay(ctx) {
  const day = ctx.world.day
  const memory = ctx.call('memory_get')
  const events = ctx.call('calendar_list_events', { day })
  ctx.call('calendar_find_conflicts', { day })
  const open = ctx.call('tasks_list', { day })
  const chat = ctx.call('team_chat_read')
  const inbox = ctx.call('client_inbox_read')
  const plan = ctx.call('planner_build_day', { day, from: ctx.world.clock })
  const ledger = ctx.call('promises_check')
  const pref = memory.preferences.noCallsBefore

  const actions = [{ tool: 'planner_apply_plan', args: {} }]
  const messages = []
  const blocked = chat.blocked.map((b) => b.from)
  const told = new Set()
  for (const m of plan.moves) {
    actions.push({ tool: 'calendar_move_event', args: { eventId: m.eventId, start: m.to.start } })
    if (m.kind === 'client') {
      const why = m.reason === 'preference' ? `I keep my mornings call-free until ${say(pref)}` : `I have a clash at ${m.from.start}`
      const replyTo = inbox.waiting.find((x) => x.relatesTo === m.eventId)?.id
      const d = draftClient(ctx, m.with, `Hi ${firstName(m.with)}, thanks for booking! ${why}, so could we do ${m.to.start} instead? I've moved the invite to ${m.to.start}-${m.to.end}.`, replyTo)
      messages.push(d.message)
      actions.push(d.action)
    } else if (m.kind === 'internal' && m.with && m.with !== 'Team') {
      const unblock = blocked.includes(m.with) ? " And I'll share the API keys right after standup, so you're unblocked." : ''
      const text = `Hi ${m.with}, I'm moving our design review to ${m.to.start}, it clashed with the ${m.clashesWith}.${unblock}`
      messages.push({ channel: 'team', to: m.with, text })
      actions.push({ tool: 'team_chat_post', args: { to: m.with, text } })
      told.add(m.with)
    }
  }
  for (const name of blocked.filter((n) => !told.has(n))) {
    const text = `Hi ${name}, saw you're blocked. I'll share the API keys right after standup.`
    messages.push({ channel: 'team', to: name, text })
    actions.push({ tool: 'team_chat_post', args: { to: name, text } })
  }
  // A client asking about work we promised gets an answer with a real deadline.
  for (const msg of inbox.waiting.filter((x) => !x.relatesTo)) {
    const p = ledger.find((l) => l.to === msg.from && l.state === 'on_track' && msg.text.toLowerCase().includes(l.what.replace(/^the /, '')))
    if (!p) continue
    const first = plan.blocks.find((b) => !b.past)?.taskId === p.taskId
    const d = draftClient(ctx, msg.from, `Hi ${p.contact}, yes! ${cap(p.what)} is ${first ? 'my first task this morning' : "in today's plan"}, and you'll have it today by ${p.byTime} at the latest.`, msg.id)
    messages.push(d.message)
    actions.push(d.action)
  }
  queue(ctx, 'plan', `Apply the plan${messages.length ? ` and send ${plural(messages.length, 'message')}` : ''}`, actions, messages)
  ctx.world.greetOnOpen = false

  const tl = timeline(ctx, plan)
  const top3 = plan.top3.map((id) => ctx.task(id).short)
  const risk = ledger.filter((p) => p.state === 'at_risk')
  const say1 = []
  const cards = []
  if (day > 1 && (pref || memory.carryOver.length)) {
    const prefMove = plan.moves.find((m) => m.reason === 'preference')
    const firstBlock = plan.blocks.find((b) => !b.past)
    const firstTask = firstBlock && ctx.task(firstBlock.taskId)
    const reneg = ledger.find((p) => p.renegotiated && p.state === 'on_track')
    say1.push('Good morning.')
    if (prefMove) say1.push(`Yesterday you asked for no calls before ${say(pref)}, but ${firstName(prefMove.with)} booked ${say(prefMove.from.start)} overnight, so I'd move it to ${sayAt(prefMove.to.start)}.`)
    if (firstTask) say1.push(`Your unfinished ${firstTask.short} is first, ${say(firstBlock.start)} to ${say(firstBlock.end)}.`)
    if (reneg) say1.push(`And ${reneg.contact}'s ${reneg.what.replace(/^the /, '')} goes out by ${say(reneg.eta)}, before the ${sayAt(reneg.byTime)} I promised.`)
    say1.push('Say approve to send the new time.')
    cards.push({
      type: 'memory', day, title: 'I remembered yesterday',
      recalled: [
        ...(pref ? [{ label: `No calls before ${pref}`, detail: 'you said it yesterday evening' }] : []),
        ...memory.carryOver.map((id) => ({ label: ctx.task(id).title, detail: ctx.task(id).promise ? `promised to ${ctx.task(id).promise.contact} by ${ctx.task(id).promise.byTime}` : 'unfinished yesterday' })),
      ],
      actedOn: plan.moves.map((m) => `${m.title}: ${m.from.start} -> ${m.to.start} (${m.reason === 'preference' ? 'your preference' : 'conflict'})`),
    })
  } else {
    const overdue = open.filter((t) => t.dueDay < day).length
    say1.push(`Good morning. You have ${plural(events.length, 'event')} and ${plural(open.length, 'open task')}, ${overdue} overdue.`)
    for (const m of plan.moves.filter((x) => x.reason === 'conflict')) say1.push(`Your ${sayAt(m.from.start)} ${m.title.replace(/ with .*/, '').toLowerCase()} clashes with the ${m.clashesWith}, so I'd move it to ${sayAt(m.to.start)}.`)
    say1.push(`Top 3: ${list(top3)}.`)
    say1.push(risk.length ? `${plural(risk.length, 'promise')} at risk.` : `All ${ledger.length} client promises are on track.`)
    if (messages.length) say1.push(`I've drafted ${plural(messages.length, 'message')}. Nothing is sent until you approve.`)
  }
  cards.push({ type: 'plan', day, title: day > 1 ? `Day ${day}, built from memory` : 'Your day, built around 3 priorities', top3, ...tl, moves: plan.moves.length })
  return { reply: say1.join(' '), cards }
}

function replan(ctx, { delayMin }) {
  const day = ctx.world.day
  const from = ctx.world.clock
  ctx.think(`Heard: ${delayMin} min behind at ${from}. Flexible work restarts at ${addMin(from, delayMin)}`)
  ctx.call('calendar_list_events', { day })
  ctx.call('tasks_list', { day })
  const plan = ctx.call('planner_build_day', { day, from, delayMin })
  const ledger = ctx.call('promises_check')

  const actions = [{ tool: 'planner_apply_plan', args: {} }]
  const messages = []
  for (const id of plan.overflow) actions.push({ tool: 'tasks_move', args: { taskId: id, toDay: day + 1, reason: `no time left after a ${delayMin} min delay` } })
  const atRisk = ledger.filter((p) => p.state === 'at_risk')
  for (const contact of [...new Set(atRisk.map((p) => p.contact))]) {
    const group = atRisk.filter((p) => p.contact === contact)
    const lines = group.map((p) => {
      const moved = plan.overflow.includes(p.taskId)
      const byDay = moved ? day + 1 : day
      const byTime = moved ? '12:00' : p.eta
      actions.push({ tool: 'promises_renegotiate', args: { taskId: p.taskId, byDay, byTime, note: `heads-up sent after a ${delayMin} min delay` } })
      return moved ? `${p.what} will reach you tomorrow before 12:00 instead of today` : `${p.what} will be ready by ${p.eta} instead of ${p.byTime}`
    })
    const safe = ledger.filter((l) => l.contact === contact && l.state === 'on_track')
    const safeLine = safe.length ? ` ${cap(list(safe.map((s) => s.what)))} ${safe.length > 1 ? 'are' : 'is'} still on track for ${safe[0].byTime}.` : ''
    const d = draftClient(ctx, group[0].to, `Hi ${contact}, a quick heads-up: my afternoon slipped by ${delayMin} minutes, so ${list(lines)}.${safeLine} Sorry for the change!`)
    messages.push(d.message)
    actions.push(d.action)
  }
  queue(ctx, 'replan', `Move ${plural(plan.overflow.length, 'task')} and send ${plural(messages.length, 'heads-up')}`, actions, messages)

  const onTrack = ledger.filter((p) => p.state === 'on_track' && !plan.blocks.find((b) => b.taskId === p.taskId)?.past)
  const parts = [`You're ${delayMin} minutes behind, so I replanned from ${say(plan.restartAt)}.`]
  for (const p of onTrack) parts.push(`${p.contact}'s ${p.what.replace(/^the /, '')} still lands at ${say(p.eta)}, before the ${sayAt(p.byTime)} promise.`)
  if (plan.overflow.length) {
    const shorts = plan.overflow.map((id) => ctx.task(id).short)
    parts.push(`The ${list(shorts)} no longer ${plan.overflow.length > 1 ? 'fit' : 'fits'} today${atRisk.length ? `, so that promise to ${list([...new Set(atRisk.map((p) => p.contact))])} would break` : ''}.`)
  }
  if (messages.length) parts.push(`I've drafted a heads-up before anyone has to chase you. Say approve to send it.`)
  else if (!plan.overflow.length) parts.push('Everything still fits, no promise is at risk.')
  return { reply: parts.join(' '), cards: [{ type: 'replan', day, title: `Replanned: ${delayMin} minutes behind`, delayMin, restartAt: plan.restartAt, ...timeline(ctx, plan) }] }
}

function closeDay(ctx, { done = [], notDone = [], noCallsBefore }) {
  const day = ctx.world.day
  const name = (id) => ctx.task(id).short
  ctx.think(`Heard: done = ${list(done.map(name)) || 'nothing'}; not done = ${list(notDone.map(name)) || 'nothing'}${noCallsBefore ? `; preference: no calls before ${noCallsBefore}` : ''}`)
  for (const id of done) ctx.call('tasks_complete', { taskId: id })
  for (const t of ctx.world.tasks.filter((x) => x.status === 'open' && x.dueDay <= day)) {
    ctx.call('tasks_move', { taskId: t.id, toDay: day + 1, reason: 'carried over at day close' })
    ctx.world.tasks.find((x) => x.id === t.id).carriedFrom = day
  }
  if (noCallsBefore) ctx.call('memory_save', { preferences: { noCallsBefore } })
  if (ctx.world.plan) ctx.world.plan.status = 'closed'
  const ledger = ctx.call('promises_check')
  const carry = ctx.world.tasks.filter((t) => t.status === 'open' && t.dueDay === day + 1)
  const carryIds = [...carry.filter((t) => t.carriedFrom === day), ...carry.filter((t) => t.carriedFrom !== day)].map((t) => t.id)
  const kept = ledger.filter((p) => p.state === 'kept')
  const reneg = ledger.filter((p) => p.renegotiated && p.state !== 'kept')
  const broken = ledger.filter((p) => p.state === 'broken' || p.state === 'at_risk')
  ctx.call('memory_save', { carryOver: carryIds, note: `Day ${day}: ${kept.length} promises kept, ${reneg.length} renegotiated, ${broken.length} broken` })
  ctx.world.pending = null

  const first = carryIds[0] && ctx.task(carryIds[0])
  const parts = [`Day closed. ${plural(kept.length, 'promise')} kept, ${reneg.length} renegotiated with a heads-up, ${broken.length ? `${broken.length} broken` : 'none broken silently'}.`]
  if (first) parts.push(`The ${first.short} carries over as tomorrow's first task${noCallsBefore ? `, and I'll keep your morning call-free until ${say(noCallsBefore)}` : ''}.`)
  else if (noCallsBefore) parts.push(`I'll keep your morning call-free until ${say(noCallsBefore)}.`)
  parts.push('Sleep well, I will remember.')
  return {
    reply: parts.join(' '),
    cards: [{
      type: 'close', day, title: 'Day closed, tomorrow already started',
      kept: kept.map((p) => `${p.what} -> ${p.contact}`), renegotiated: reneg.map((p) => `${p.what} -> ${p.contact}, now by ${p.byTime} tomorrow`),
      broken: broken.map((p) => `${p.what} -> ${p.contact}`), carried: carryIds.map((id) => ctx.task(id).title), preference: noCallsBefore ?? null,
    }],
  }
}

function sleep(ctx) {
  ctx.call('day_start')
  return { reply: '', cards: [] }
}

function nextDay(ctx) {
  ctx.call('day_start')
  return buildDay(ctx)
}

function approve(ctx) {
  const p = ctx.world.pending
  if (!p) return { reply: "There's nothing waiting for your approval." }
  ctx.think(`You approved: ${p.label}`)
  for (const a of p.actions) ctx.call(a.tool, a.args)
  ctx.world.pending = null
  const sent = p.messages.length
  const reply = {
    plan: `Done. The plan is applied${sent ? ` and ${plural(sent, 'message')} sent` : ''}.`,
    replan: `Sent. ${p.label.replace(/^Move/, 'Moved').replace('and send', 'and sent')}. Your promise ledger is up to date.`,
  }[p.kind] ?? 'Done.'
  return {
    reply: ctx.world.day > 1 && p.kind === 'plan' ? `${reply} That's the loop: yesterday's words, today's plan.` : reply,
    cards: [{ type: 'done', title: 'Approved and done', lines: ctx.steps.filter((s) => s.kind === 'tool').map((s) => s.summary) }],
  }
}

function decline(ctx) {
  const had = !!ctx.world.pending
  ctx.world.pending = null
  return { reply: had ? 'Okay, nothing was sent. The drafts stay with you.' : "There's nothing to cancel." }
}

function unknown() {
  return { reply: 'I can build your day, replan when you fall behind, or close your day and remember tomorrow. Try "Alexa, build my day."' }
}
