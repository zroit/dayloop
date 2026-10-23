// Simulated Calendar adapter, exposed as tools.
// A real version would wrap a calendar API behind the same tool names.

import { z } from 'zod'
import { eventsFor } from '../planner.js'
import { toMin, toHHMM, overlaps } from '../time.js'

export const calendarTools = [
  {
    name: 'calendar_list_events',
    description: "List the user's calendar events for a day (1 = today in the demo, 2 = tomorrow).",
    input: { day: z.number().int().min(1).optional() },
    annotations: { readOnlyHint: true },
    run(world, { day = world.day }) {
      return eventsFor(world, day)
    },
    summary: (r) => `${r.length} events: ${r.map((e) => `${e.start} ${e.title}`).join(', ')}`,
  },
  {
    name: 'calendar_find_conflicts',
    description: 'Find pairs of calendar events on a day that overlap in time.',
    input: { day: z.number().int().min(1).optional() },
    annotations: { readOnlyHint: true },
    run(world, { day = world.day }) {
      const ev = eventsFor(world, day)
      const out = []
      for (let i = 0; i < ev.length; i++)
        for (let j = i + 1; j < ev.length; j++)
          if (overlaps(ev[i], ev[j])) out.push({ a: ev[i].title, b: ev[j].title, aStart: ev[i].start, bStart: ev[j].start })
      return out
    },
    summary: (r) => (r.length ? `${r.length} conflict: ${r.map((c) => `"${c.a}" overlaps "${c.b}"`).join('; ')}` : 'No conflicts'),
  },
  {
    name: 'calendar_move_event',
    description: 'Move a calendar event to a new start time, keeping its length. Attendees are notified, so ask the user first.',
    input: { eventId: z.string(), start: z.string().regex(/^\d{2}:\d{2}$/) },
    annotations: { openWorldHint: true },
    run(world, { eventId, start }) {
      const e = world.events.find((x) => x.id === eventId)
      if (!e) throw new Error(`No event ${eventId}`)
      const len = toMin(e.end) - toMin(e.start)
      const before = { start: e.start, end: e.end }
      e.movedFrom = e.movedFrom ?? before.start
      e.start = start
      e.end = toHHMM(toMin(start) + len)
      return { eventId, title: e.title, from: before, to: { start: e.start, end: e.end } }
    },
    summary: (r) => `Moved "${r.title}" ${r.from.start} -> ${r.to.start}`,
  },
]
