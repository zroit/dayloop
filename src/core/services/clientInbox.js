// Simulated Client Inbox adapter, exposed as tools.
// Guardrail: drafting is free, sending needs the user's explicit approval.

import { z } from 'zod'
import { visible } from '../planner.js'

export const clientInboxTools = [
  {
    name: 'client_inbox_read',
    description: 'Read client messages and see which clients are waiting for an answer.',
    input: {},
    annotations: { readOnlyHint: true },
    run(world) {
      const messages = world.inbox.filter((m) => visible(m, world.day))
      return { messages, waiting: messages.filter((m) => m.waiting) }
    },
    summary: (r) =>
      r.waiting.length ? `${r.waiting.length} client waiting: ${r.waiting.map((m) => `${m.from} "${m.text}"`).join('; ')}` : 'No client is waiting',
  },
  {
    name: 'client_inbox_draft',
    description: 'Draft a message to a client. Drafts are never sent on their own.',
    input: { to: z.string(), text: z.string(), replyTo: z.string().optional() },
    run(world, { to, text, replyTo }) {
      const draft = { id: `d${world.drafts.length + 1}`, to, text, replyTo, status: 'draft', day: world.day, time: world.clock }
      world.drafts.push(draft)
      return draft
    },
    summary: (r) => `Drafted to ${r.to}: NOT sent`,
  },
  {
    name: 'client_inbox_send',
    description: 'Send a drafted client message. Only call this after the user approved this exact draft.',
    input: { draftId: z.string(), approvedByUser: z.literal(true) },
    annotations: { destructiveHint: true, openWorldHint: true },
    run(world, { draftId }) {
      const d = world.drafts.find((x) => x.id === draftId)
      if (!d) throw new Error(`No draft ${draftId}`)
      d.status = 'sent'
      d.sentAt = world.clock
      world.outbox.push({ ...d })
      if (d.replyTo) world.inbox.filter((m) => m.id === d.replyTo).forEach((m) => { m.waiting = false })
      return { draftId, to: d.to }
    },
    summary: (r) => `Sent to ${r.to} (you approved it)`,
  },
]
