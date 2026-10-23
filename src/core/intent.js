// Turns what the user says into an intent the agent can act on.
// Rule-based on purpose: deterministic for a demo, and readable for reviewers.

const WORD_NUM = {
  five: 5, ten: 10, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, 'thirty five': 35, forty: 40,
  'forty five': 45, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

export function parseDuration(text) {
  const t = text.toLowerCase().replace(/-/g, ' ')
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/)
  if (m) return Math.round(parseFloat(m[1]) * 60)
  m = t.match(/(\d+)\s*(?:m|min|mins|minute|minutes)\b/)
  if (m) return parseInt(m[1], 10)
  if (/half an hour/.test(t)) return 30
  if (/quarter of an hour/.test(t)) return 15
  if (/an hour/.test(t)) return 60
  const words = Object.keys(WORD_NUM).sort((a, b) => b.length - a.length)
  for (const w of words) if (new RegExp(`\\b${w}\\s*(?:minutes|mins|min)\\b`).test(t)) return WORD_NUM[w]
  return null
}

// "no calls before 10", "nothing before 10:30am", "no meetings until 11"
export function parseNoCallsBefore(text) {
  const m = text.toLowerCase().match(/no (?:calls?|meetings?)[^.]*?(?:before|until|till)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  if (m[3] === 'pm' && h < 12) h += 12
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`
}

const mentions = (clause, task) => task.keywords.some((k) => new RegExp(`\\b${k}`).test(clause))

// "The proposal is done, the report isn't." / "Everything's done except the report."
export function parseClose(text, tasks) {
  const open = tasks.filter((t) => t.status === 'open')
  const done = new Set()
  const notDone = new Set()
  const clauses = text.toLowerCase().split(/[.;,!?]|\bbut\b|\band\b/).map((s) => s.trim()).filter(Boolean)
  for (const c of clauses) {
    const hit = open.filter((t) => mentions(c, t))
    if (/\b(everything|all)\b.*\bdone\b.*\bexcept\b/.test(c) || /\bexcept\b/.test(c)) {
      open.forEach((t) => (hit.includes(t) ? notDone.add(t.id) : done.add(t.id)))
    } else if (/(isn't|is not|not done|didn't|did not|unfinished|still open|not finished)/.test(c)) {
      hit.forEach((t) => notDone.add(t.id))
    } else if (/\b(done|finished|sent|shipped|fixed|delivered|complete)\b/.test(c)) {
      hit.forEach((t) => done.add(t.id))
    }
  }
  notDone.forEach((id) => done.delete(id))
  return { done: [...done], notDone: [...notDone], noCallsBefore: parseNoCallsBefore(text) }
}

export function parseIntent(text, world) {
  const t = text.toLowerCase().trim()
  if (!t) return { type: 'unknown' }
  if (/^(yes|yep|ok|okay)?[, ]*(approve|approved|send it|go ahead|do it|confirm)/.test(t) || /\bapprove\b/.test(t)) return { type: 'approve' }
  if (/\b(not now|cancel|don't send|do not send|reject|decline)\b/.test(t)) return { type: 'decline' }
  if (/\b(close|wrap up|end|finish)\b.*\b(day)\b/.test(t) || /done for (the )?day/.test(t)) {
    return { type: 'close_day', ...parseClose(text, world.tasks.filter((x) => x.dueDay <= world.day)) }
  }
  if (/\b(behind|ran long|ran over|running late|slipped|late by)\b/.test(t)) {
    return { type: 'replan', delayMin: parseDuration(t) ?? 30 }
  }
  if (/\b(next day|day 2|new day|tomorrow morning)\b/.test(t)) return { type: 'next_day' }
  if (/\b(build|plan|start|run)\b.*\bday\b/.test(t) || /good morning|what's my day|what is my day/.test(t)) return { type: 'build_day' }
  return { type: 'unknown' }
}
