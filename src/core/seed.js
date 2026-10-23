// Simulated data for one freelancer's two days. Everything here is invented.
// Items with `visibleFrom: 2` arrive "overnight" and only exist from Day 2 on.

export const WORKDAY = { start: '09:00', end: '18:00' }

export function seedWorld() {
  return {
    version: 2,
    day: 1,
    clock: '08:00',
    session: 1,
    events: [
      { id: 'e1', day: 1, title: 'Team standup', start: '09:00', end: '09:30', kind: 'internal', with: 'Team' },
      { id: 'e2', day: 1, title: 'Design review with Sara', start: '11:00', end: '12:00', kind: 'internal', with: 'Sara' },
      { id: 'e3', day: 1, title: 'Acme client call', start: '11:30', end: '12:30', kind: 'client', with: 'Priya (Acme)' },
      { id: 'e4', day: 1, title: 'Lunch', start: '12:30', end: '13:00', kind: 'personal' },
      { id: 'e5', day: 1, title: 'Northwind check-in', start: '16:00', end: '16:30', kind: 'client', with: 'Tom (Northwind)' },
      { id: 'e6', day: 2, title: 'Acme follow-up call', start: '09:30', end: '10:00', kind: 'client', with: 'Priya (Acme)', visibleFrom: 2, bookedBy: 'Priya' },
      { id: 'e7', day: 2, title: 'Team standup', start: '10:30', end: '11:00', kind: 'internal', with: 'Team', visibleFrom: 2 },
    ],
    tasks: [
      {
        id: 't1', short: 'Acme proposal', title: 'Finish the Acme proposal', client: 'Acme', priority: 'high', estimateMin: 120, dueDay: 0,
        status: 'open', keywords: ['proposal', 'acme'],
        promise: { to: 'Priya (Acme)', contact: 'Priya', what: 'the proposal', byDay: 1, byTime: '17:00', status: 'open', history: [] },
      },
      {
        id: 't2', short: 'design assets', title: 'Review the design assets', client: 'Internal', priority: 'medium', estimateMin: 45, dueDay: 0,
        status: 'open', keywords: ['design', 'assets'],
      },
      {
        id: 't3', short: 'monthly report', title: 'Draft the monthly report', client: 'Internal', priority: 'high', estimateMin: 60, dueDay: 1,
        status: 'open', keywords: ['report', 'monthly'],
      },
      {
        id: 't4', short: 'Northwind bug fix', title: 'Fix the Northwind landing page bug', client: 'Northwind', priority: 'medium', estimateMin: 30, dueDay: 1,
        status: 'open', keywords: ['bug', 'landing', 'fix'],
        promise: { to: 'Tom (Northwind)', contact: 'Tom', what: 'the landing page fix', byDay: 1, byTime: '16:00', status: 'open', history: [] },
      },
      {
        id: 't5', short: 'Northwind invoice', title: 'Send the Northwind invoice', client: 'Northwind', priority: 'low', estimateMin: 45, dueDay: 1,
        status: 'open', keywords: ['invoice'],
        promise: { to: 'Tom (Northwind)', contact: 'Tom', what: 'the invoice', byDay: 1, byTime: '18:00', status: 'open', history: [] },
      },
    ],
    teamChat: [
      { id: 'm1', from: 'Sara', text: "I'm blocked on the dashboard. Still waiting for the API keys.", time: '08:12', blocked: true, visibleFrom: 1 },
      { id: 'm2', from: 'Rafi', text: 'Standup notes are shared. Starting on the search page.', time: '08:20', visibleFrom: 1 },
    ],
    inbox: [
      { id: 'c1', from: 'Priya (Acme)', text: 'Hi! Any update on the proposal? We hoped to see it today.', time: '07:45', waiting: true, visibleFrom: 1 },
      { id: 'c2', from: 'Priya (Acme)', text: "Booked a quick follow-up for 9:30 tomorrow, hope that works!", time: '21:10', waiting: true, visibleFrom: 2, relatesTo: 'e6' },
    ],
    drafts: [],
    outbox: [],
    plan: null,
    pending: null,
    memory: { preferences: {}, carryOver: [], notes: [], sessions: 1 },
  }
}
