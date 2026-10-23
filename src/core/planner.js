// The planner: turns calendar + tasks + learned preferences into a day.
// Pure functions over the world state, no I/O, so the same code runs in the
// browser and in the MCP server.

import { WORKDAY } from './seed.js'
import { toMin, toHHMM, overlaps } from './time.js'

const PRIORITY = { high: 30, medium: 15, low: 0 }
const EVENT_RANK = { client: 2, internal: 1, personal: 0 }

export const visible = (item, day) => (item.visibleFrom ?? 1) <= day
export const isMeeting = (e) => e.kind === 'client' || e.kind === 'internal'

export function eventsFor(world, day) {
  return world.events
    .filter((e) => e.day === day && visible(e, world.day))
    .sort((a, b) => toMin(a.start) - toMin(b.start))
}

export function score(task, day) {
  let s = PRIORITY[task.priority] ?? 0
  if (task.dueDay < day) s += 100
  if (task.client !== 'Internal') s += 10
  if (task.promise?.status === 'open') s += 5
  return s
}

const promiseDue = (t) => (t.promise ? t.promise.byDay * 1440 + toMin(t.promise.byTime) : Infinity)

export function rankTasks(tasks, day) {
  return [...tasks].sort(
    (a, b) => score(b, day) - score(a, day) || promiseDue(a) - promiseDue(b) || a.id.localeCompare(b.id),
  )
}

function freeGaps(busy, fromMin, endMin) {
  const sorted = busy.filter((b) => b.e > fromMin && b.s < endMin).sort((a, b) => a.s - b.s)
  const gaps = []
  let cur = fromMin
  for (const b of sorted) {
    if (b.s > cur) gaps.push({ s: cur, e: b.s })
    cur = Math.max(cur, b.e)
  }
  if (cur < endMin) gaps.push({ s: cur, e: endMin })
  return gaps
}

function findSlot(busy, len, notBefore, endMin) {
  for (const g of freeGaps(busy, notBefore, endMin)) if (g.e - g.s >= len) return g.s
  return null
}

const span = (x) => ({ s: toMin(x.start), e: toMin(x.end) })

// Build (or rebuild) the plan for `day`.
// `from` is "now"; `delayMin` pushes the restart of flexible work (midday replan).
export function buildPlan(world, { day = world.day, from = world.clock, delayMin = 0 } = {}) {
  const prefs = world.memory?.preferences ?? {}
  const nowMin = toMin(from)
  const startMin = Math.max(toMin(WORKDAY.start), nowMin + delayMin)
  const endMin = toMin(WORKDAY.end)
  const events = eventsFor(world, day)
  const upcoming = (e) => toMin(e.start) >= nowMin

  // 1. Meetings that break a learned preference ("no calls before 10").
  const toMove = new Map()
  if (prefs.noCallsBefore) {
    for (const e of events) {
      if (isMeeting(e) && upcoming(e) && toMin(e.start) < toMin(prefs.noCallsBefore)) {
        toMove.set(e.id, { reason: 'preference', notBefore: toMin(prefs.noCallsBefore) })
      }
    }
  }
  // 2. Calendar conflicts: the lower-ranked event moves after the other one ends.
  const conflicts = []
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i], b = events[j]
      if (!upcoming(a) || !upcoming(b) || toMove.has(a.id) || toMove.has(b.id) || !overlaps(a, b)) continue
      const [loser, winner] = (EVENT_RANK[a.kind] ?? 0) < (EVENT_RANK[b.kind] ?? 0) ? [a, b] : [b, a]
      conflicts.push({ a: a.id, b: b.id })
      toMove.set(loser.id, { reason: 'conflict', notBefore: toMin(winner.end), clashesWith: winner.title })
    }
  }

  const busy = events.filter((e) => !toMove.has(e.id)).map(span)
  const moves = []
  for (const e of events.filter((x) => toMove.has(x.id))) {
    const m = toMove.get(e.id)
    const len = toMin(e.end) - toMin(e.start)
    let notBefore = m.notBefore
    if (isMeeting(e) && prefs.noCallsBefore) notBefore = Math.max(notBefore, toMin(prefs.noCallsBefore))
    const slot = findSlot(busy, len, notBefore, endMin)
    if (slot == null) continue
    busy.push({ s: slot, e: slot + len })
    moves.push({
      eventId: e.id, title: e.title, kind: e.kind, with: e.with, reason: m.reason, clashesWith: m.clashesWith,
      from: { start: e.start, end: e.end }, to: { start: toHHMM(slot), end: toHHMM(slot + len) },
    })
  }

  // 3. Tasks. Blocks that already started stay; the rest is packed again by rank.
  const prev = world.plan?.day === day ? world.plan.blocks : []
  const past = prev.filter((b) => toMin(b.start) < nowMin)
  const pastIds = new Set(past.map((b) => b.taskId))
  past.forEach((b) => busy.push(span(b)))
  const open = world.tasks.filter((t) => t.status === 'open' && t.dueDay <= day)
  const blocks = past.map((b) => ({ ...b, past: true }))
  const overflow = []
  for (const t of rankTasks(open.filter((t) => !pastIds.has(t.id)), day)) {
    const slot = findSlot(busy, t.estimateMin, startMin, endMin)
    if (slot == null) { overflow.push(t.id); continue }
    busy.push({ s: slot, e: slot + t.estimateMin })
    blocks.push({ taskId: t.id, title: t.title, start: toHHMM(slot), end: toHHMM(slot + t.estimateMin) })
  }
  blocks.sort((a, b) => toMin(a.start) - toMin(b.start))

  return {
    day, from, delayMin, restartAt: toHHMM(startMin), status: 'proposed',
    top3: rankTasks(open, day).slice(0, 3).map((t) => t.id),
    moves, conflicts, blocks, overflow,
    previousBlocks: prev.map((b) => ({ taskId: b.taskId, start: b.start, end: b.end })),
  }
}

// Where each promise stands against a plan.
export function promiseStatus(task, plan, day) {
  const p = task.promise
  if (!p) return null
  const base = { taskId: task.id, to: p.to, contact: p.contact, what: p.what, byDay: p.byDay, byTime: p.byTime, renegotiated: p.history.length > 0 }
  if (task.status === 'done') return { ...base, state: 'kept', note: `${p.what} delivered` }
  if (p.byDay > day) return { ...base, state: 'scheduled', note: `due day ${p.byDay} by ${p.byTime}` }
  if (p.byDay < day) return { ...base, state: 'broken', note: `was due day ${p.byDay}` }
  if (plan?.day === day && plan.status === 'closed') return { ...base, state: 'broken', note: `the day closed without ${p.what}` }
  if (plan?.day !== day) return { ...base, state: 'open', note: 'not planned yet today' }
  const b = plan.blocks.find((x) => x.taskId === task.id)
  if (!b) return { ...base, state: 'at_risk', note: `no time left today for ${p.what}` }
  if (toMin(b.end) > toMin(p.byTime)) return { ...base, state: 'at_risk', note: `finishes ${b.end}, promised by ${p.byTime}`, eta: b.end }
  return { ...base, state: 'on_track', note: `ready by ${b.end}, promised by ${p.byTime}`, eta: b.end }
}

export function promiseLedger(world) {
  return world.tasks.map((t) => promiseStatus(t, world.plan, world.day)).filter(Boolean)
}
