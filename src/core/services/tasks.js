// Simulated Task Board adapter, exposed as tools.

import { z } from 'zod'

const findTask = (world, id) => {
  const t = world.tasks.find((x) => x.id === id)
  if (!t) throw new Error(`No task ${id}`)
  return t
}

export const taskTools = [
  {
    name: 'tasks_list',
    description: 'List open tasks due on or before a day, with priority, estimate, client and any promise made about them.',
    input: { day: z.number().int().min(1).optional() },
    annotations: { readOnlyHint: true },
    run(world, { day = world.day }) {
      return world.tasks.filter((t) => t.status === 'open' && t.dueDay <= day)
    },
    summary: (r, { day }, w) => {
      const d = day ?? w.day
      const overdue = r.filter((t) => t.dueDay < d).length
      const promised = r.filter((t) => t.promise).length
      return `${r.length} open tasks, ${overdue} overdue, ${promised} carry a promise to a client`
    },
  },
  {
    name: 'tasks_complete',
    description: 'Mark a task done. A promise attached to it counts as kept.',
    input: { taskId: z.string() },
    run(world, { taskId }) {
      const t = findTask(world, taskId)
      t.status = 'done'
      t.doneDay = world.day
      if (t.promise && t.promise.status === 'open') t.promise.status = 'kept'
      return { taskId, title: t.title }
    },
    summary: (r) => `Done: "${r.title}"`,
  },
  {
    name: 'tasks_move',
    description: 'Move a task to another day.',
    input: { taskId: z.string(), toDay: z.number().int().min(1), reason: z.string().optional() },
    run(world, { taskId, toDay, reason }) {
      const t = findTask(world, taskId)
      t.movedFrom = t.dueDay
      t.dueDay = toDay
      if (reason) t.moveReason = reason
      return { taskId, title: t.title, toDay }
    },
    summary: (r) => `Moved "${r.title}" to day ${r.toDay}`,
  },
]
