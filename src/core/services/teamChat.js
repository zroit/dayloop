// Simulated Team Chat adapter, exposed as tools.

import { z } from 'zod'
import { visible } from '../planner.js'

export const teamChatTools = [
  {
    name: 'team_chat_read',
    description: 'Read recent team chat messages and spot teammates who say they are blocked.',
    input: {},
    annotations: { readOnlyHint: true },
    run(world) {
      const messages = world.teamChat.filter((m) => visible(m, world.day))
      return { messages, blocked: messages.filter((m) => m.blocked).map((m) => ({ from: m.from, text: m.text })) }
    },
    summary: (r) =>
      r.blocked.length ? `${r.blocked.length} teammate blocked: ${r.blocked.map((b) => b.from).join(', ')}` : 'Nobody is blocked',
  },
  {
    name: 'team_chat_post',
    description: 'Post a message to a teammate in team chat. It leaves DayLoop, so ask the user first.',
    input: { to: z.string(), text: z.string() },
    annotations: { openWorldHint: true },
    run(world, { to, text }) {
      const msg = { id: `m${world.teamChat.length + 1}`, from: 'You (via DayLoop)', to, text, time: world.clock, visibleFrom: world.day }
      world.teamChat.push(msg)
      world.teamChat.filter((m) => m.from === to && m.blocked).forEach((m) => { m.blocked = false })
      return { to, text }
    },
    summary: (r) => `Posted to ${r.to} in team chat`,
  },
]
