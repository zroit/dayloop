// Long-term memory and the day/session clock, exposed as tools.
// Memory is what survives from one session (day) to the next.

import { z } from 'zod'

export const memoryTools = [
  {
    name: 'memory_get',
    description: 'Read what DayLoop remembers from earlier sessions: preferences, carried-over tasks, notes.',
    input: {},
    annotations: { readOnlyHint: true },
    run(world) {
      return world.memory
    },
    summary: (r) => {
      const prefs = Object.entries(r.preferences)
      if (!prefs.length && !r.carryOver.length) return `Session ${r.sessions}: nothing remembered yet`
      const parts = prefs.map(([k, v]) => (k === 'noCallsBefore' ? `no calls before ${v}` : `${k}=${v}`))
      if (r.carryOver.length) parts.push(`${r.carryOver.length} task(s) carried over`)
      return `Recalled from day ${r.sessions - 1}: ${parts.join(', ')}`
    },
  },
  {
    name: 'memory_save',
    description: 'Save a learned preference, the tasks carried into tomorrow, or a note for the next session.',
    input: {
      preferences: z.object({ noCallsBefore: z.string().regex(/^\d{2}:\d{2}$/).optional() }).optional(),
      carryOver: z.array(z.string()).optional(),
      note: z.string().optional(),
    },
    run(world, { preferences, carryOver, note }) {
      if (preferences) Object.assign(world.memory.preferences, preferences)
      if (carryOver) world.memory.carryOver = carryOver
      if (note) world.memory.notes.push({ day: world.day, text: note })
      return world.memory
    },
    summary: (r, args) => {
      const parts = []
      if (args.preferences?.noCallsBefore) parts.push(`preference "no calls before ${args.preferences.noCallsBefore}"`)
      if (args.carryOver) parts.push(`${args.carryOver.length} carried task(s)`)
      if (args.note) parts.push('a note for tomorrow')
      return `Saved to memory: ${parts.join(', ')}`
    },
  },
  {
    name: 'clock_set',
    description: 'Set the simulated time of day (the demo jumps between morning, midday and evening).',
    input: { time: z.string().regex(/^\d{2}:\d{2}$/) },
    run(world, { time }) {
      world.clock = time
      return { day: world.day, clock: time }
    },
    summary: (r) => `Clock -> day ${r.day}, ${r.clock}`,
  },
  {
    name: 'day_start',
    description: 'Start the next day as a new session. Conversation is gone; only memory and the task board remain.',
    input: {},
    run(world) {
      world.day += 1
      world.clock = '08:00'
      world.session += 1
      world.memory.sessions += 1
      world.pending = null
      world.greetOnOpen = true
      const arrived = {
        events: world.events.filter((e) => e.visibleFrom === world.day).length,
        messages: world.inbox.filter((m) => m.visibleFrom === world.day).length,
      }
      return { day: world.day, session: world.session, arrived }
    },
    summary: (r) => `New session ${r.session}: day ${r.day} at 08:00. Overnight: ${r.arrived.events} calendar invites, ${r.arrived.messages} client message(s)`,
  },
]
