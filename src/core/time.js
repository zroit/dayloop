// Small time helpers. All schedule times are "HH:MM" strings on a 24h clock.

export const toMin = (t) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export const toHHMM = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const addMin = (t, n) => toHHMM(toMin(t) + n)

// How a voice assistant says a time: "14:40" -> "2:40", "10:00" -> "10".
export const say = (t) => {
  const [h, m] = t.split(':').map(Number)
  const h12 = ((h + 11) % 12) + 1
  return m === 0 ? `${h12}` : `${h12}:${String(m).padStart(2, '0')}`
}

export const overlaps = (a, b) => toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)

// A single point in time, spoken: "16:00" -> "4 o'clock", "12:00" -> "noon".
export const sayAt = (t) => {
  const [h, m] = t.split(':').map(Number)
  if (m !== 0) return say(t)
  return h === 12 ? 'noon' : `${say(t)} o'clock`
}
