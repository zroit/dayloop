import { test } from 'node:test'
import assert from 'node:assert/strict'
import { seedWorld } from '../src/core/seed.js'
import { runTurn } from '../src/core/agent.js'
import { callTool } from '../src/core/tools.js'
import { buildPlan, promiseLedger } from '../src/core/planner.js'
import { parseDuration, parseNoCallsBefore, parseIntent } from '../src/core/intent.js'

const turn = (w, input) => runTurn(w, typeof input === 'string' ? { utterance: input } : input)
const at = (w, time) => callTool(w, 'clock_set', { time }).world

function morningApproved() {
  let w = turn(seedWorld(), 'Alexa, build my day.').world
  return turn(w, 'Approve').world
}

test('parses durations and the no-calls preference', () => {
  assert.equal(parseDuration("I'm 40 minutes behind"), 40)
  assert.equal(parseDuration('running late by half an hour'), 30)
  assert.equal(parseDuration('about 1.5 hours behind'), 90)
  assert.equal(parseDuration('twenty minutes behind'), 20)
  assert.equal(parseNoCallsBefore('and no calls before 10 tomorrow'), '10:00')
  assert.equal(parseNoCallsBefore('no meetings until 11:30am'), '11:30')
})

test('morning build moves the internal meeting out of the client call', () => {
  const r = turn(seedWorld(), 'Alexa, build my day.')
  const plan = r.world.plan
  assert.equal(plan.moves.length, 1)
  assert.equal(plan.moves[0].title, 'Design review with Sara')
  assert.deepEqual(plan.moves[0].to, { start: '13:00', end: '14:00' })
  assert.equal(plan.overflow.length, 0)
  assert.deepEqual(plan.top3, ['t1', 't2', 't4'])
  assert.ok(promiseLedger(r.world).every((p) => p.state === 'on_track'))
  // Nothing leaves before approval.
  assert.equal(r.world.outbox.length, 0)
  assert.equal(r.pending.messages.length, 2)
})

test('approval is what sends; the inbox tool refuses without it', () => {
  const w = morningApproved()
  assert.equal(w.outbox.length, 1)
  assert.equal(w.events.find((e) => e.id === 'e2').start, '13:00')
  assert.throws(() => callTool(w, 'client_inbox_send', { draftId: 'd1' }))
})

test('the replan depends on how late the user is', () => {
  const w = at(morningApproved(), '14:00')
  assert.deepEqual(buildPlan(w, { delayMin: 0 }).overflow, [])
  assert.deepEqual(buildPlan(w, { delayMin: 40 }).overflow, ['t5'])
  // 90 min late: the hour-long report no longer fits, the 45 min invoice still does.
  assert.deepEqual(buildPlan(w, { delayMin: 90 }).overflow, ['t3'])
})

test('a broken promise gets a heads-up draft, sent only on approval', () => {
  let w = at(morningApproved(), '14:00')
  const r = turn(w, "The design review ran long. I'm 40 minutes behind.")
  const risk = promiseLedger(r.world).filter((p) => p.state === 'at_risk')
  assert.deepEqual(risk.map((p) => p.taskId), ['t5'])
  assert.match(r.pending.messages[0].text, /invoice will reach you tomorrow/)
  assert.match(r.pending.messages[0].text, /landing page fix is still on track for 16:00/)
  w = turn(r.world, 'Approve').world
  const t5 = w.tasks.find((t) => t.id === 't5')
  assert.equal(t5.dueDay, 2)
  assert.equal(t5.promise.byTime, '12:00')
  assert.equal(t5.promise.history.length, 1)
})

test('day 2 is built from memory alone and honours the learned preference', () => {
  let w = at(morningApproved(), '14:00')
  w = turn(turn(w, "I'm 40 minutes behind.").world, 'Approve').world
  w = at(w, '18:00')
  w = turn(w, "Close my day. Everything's done except the monthly report. And no calls before 10 tomorrow.").world
  assert.equal(w.memory.preferences.noCallsBefore, '10:00')
  assert.deepEqual(w.memory.carryOver, ['t3', 't5'])
  w = turn(w, { action: 'sleep' }).world
  assert.equal(w.day, 2)
  // Before Day 2 is planned, a promise due today is not yet at risk.
  assert.equal(promiseLedger(w).find((p) => p.taskId === 't5').state, 'open')
  const r = turn(w, { action: 'build_day' })
  const move = r.world.plan.moves[0]
  assert.equal(move.title, 'Acme follow-up call')
  assert.equal(move.reason, 'preference')
  assert.equal(move.to.start, '10:00')
  assert.equal(r.world.plan.blocks[0].taskId, 't3')
  assert.equal(r.world.plan.blocks[0].start, '09:00')
  assert.match(r.reply, /no calls before 10/)
})

test('a different preference gives a different Day 2', () => {
  let w = morningApproved()
  w = turn(at(w, '18:00'), 'Close my day. The proposal is done, the report is not. No calls before 11.').world
  w = turn(w, { action: 'sleep' }).world
  const plan = turn(w, { action: 'build_day' }).world.plan
  // Both the 09:30 call and the 10:30 standup break "no calls before 11".
  assert.ok(plan.moves.every((m) => m.to.start >= '11:00'))
  assert.equal(plan.moves.length, 2)
})

test('intents', () => {
  const w = seedWorld()
  assert.equal(parseIntent('Alexa, build my day', w).type, 'build_day')
  assert.equal(parseIntent('approve', w).type, 'approve')
  assert.equal(parseIntent("I'm running late by 25 minutes", w).delayMin, 25)
  const c = parseIntent('Close my day. The proposal is done, the report isn\'t.', w)
  assert.deepEqual([c.type, c.done, c.notDone], ['close_day', ['t1'], ['t3']])
})
