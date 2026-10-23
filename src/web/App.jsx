import { useEffect, useRef, useState } from 'react'
import { localBackend, mcpBackend } from './backend.js'
import { promiseLedger } from '../core/planner.js'
import { Card } from './cards.jsx'

const STEP_MS = 420
const delay = (ms) => new Promise((r) => setTimeout(r, ms))

const SCRIPT = [
  { id: 'morning', clock: '08:00', text: 'Alexa, build my day.' },
  { id: 'midday', clock: '14:00', text: "Alexa, the design review ran long. I'm 40 minutes behind." },
  { id: 'evening', clock: '18:00', text: "Alexa, close my day. Everything's done except the monthly report. And no calls before 10 tomorrow." },
]

const SERVICE = (tool) =>
  tool?.startsWith('calendar') ? 'cal' : tool?.startsWith('tasks') ? 'task' : tool?.startsWith('team') ? 'team'
    : tool?.startsWith('client') ? 'client' : tool?.startsWith('memory') || tool?.startsWith('day_') ? 'mem' : 'plan'

const sessionKey = (s) => `dayloop-session-${s}`
function loadSession(s) {
  try { return JSON.parse(sessionStorage.getItem(sessionKey(s))) ?? null } catch { return null }
}
function saveSession(s, data) {
  try { sessionStorage.setItem(sessionKey(s), JSON.stringify(data)) } catch { /* ignore */ }
}

function nextScript(world) {
  if (world.day !== 1) return null
  const plan = world.plan
  if (!plan) return SCRIPT[0]
  if (world.pending) return null
  if (plan.status === 'closed') return { id: 'sleep', clock: null, text: 'Good night (end the session)' }
  if (plan.delayMin) return SCRIPT[2]
  return SCRIPT[1]
}

export default function App() {
  const [backend, setBackend] = useState(null)
  const [world, setWorld] = useState(null)
  const [transcript, setTranscript] = useState([])
  const [steps, setSteps] = useState([])
  const [cards, setCards] = useState([])
  const [cardIdx, setCardIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState('')
  const [voice, setVoice] = useState(false)
  const [error, setError] = useState(null)
  const stepsRef = useRef(null)
  const chatRef = useRef(null)
  const greeted = useRef(false)

  useEffect(() => {
    const url = new URLSearchParams(location.search).get('mcp')
    ;(url ? mcpBackend(url) : Promise.resolve(localBackend()))
      .then(async (b) => {
        const w = await b.state()
        const s = loadSession(w.session)
        if (s) { setTranscript(s.transcript); setSteps(s.steps); setCards(s.cards) }
        setBackend(b); setWorld(w)
      })
      .catch((e) => setError(`Could not reach the MCP server at ${url}: ${e.message}`))
  }, [])

  useEffect(() => { if (world) saveSession(world.session, { transcript, steps, cards }) }, [world, transcript, steps, cards])
  useEffect(() => { stepsRef.current?.scrollTo({ top: stepsRef.current.scrollHeight, behavior: 'smooth' }) }, [steps])
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }) }, [transcript])

  // A new session that DayLoop opens itself: the proactive Day 2 morning.
  useEffect(() => {
    if (!world?.greetOnOpen || greeted.current || busy) return
    greeted.current = true
    setTranscript([{ role: 'system', text: `New session ${world.session}. The conversation is gone; DayLoop only has its memory.` }])
    const t = setTimeout(() => run({ action: 'build_day' }), 1400)
    return () => clearTimeout(t)
  }, [world]) // eslint-disable-line react-hooks/exhaustive-deps

  function speak(text) {
    if (!voice || !text || !('speechSynthesis' in window)) return
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-US'
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }

  async function run(inputObj, userText) {
    if (busy || !backend) return
    setBusy(true)
    if (userText) setTranscript((t) => [...t, { role: 'user', text: userText }])
    try {
      const r = await backend.turn(inputObj)
      for (const s of r.steps) {
        setSteps((prev) => [...prev, { ...s, clock: r.world.clock, day: r.world.day }])
        await delay(STEP_MS)
      }
      setWorld(r.world)
      if (r.reply) setTranscript((t) => [...t, { role: 'agent', text: r.reply }])
      if (r.cards.length) { setCards(r.cards); setCardIdx(0) }
      speak(r.reply)
      return r
    } catch (e) {
      setTranscript((t) => [...t, { role: 'system', text: `Error: ${e.message}` }])
    } finally {
      setBusy(false)
    }
  }

  async function sayScripted(item) {
    if (item.id === 'sleep') return sleep()
    if (item.clock && item.clock !== world.clock) setWorld(await backend.setClock(item.clock))
    await run({ utterance: item.text }, item.text)
  }

  async function sleep() {
    setBusy(true)
    setTranscript((t) => [...t, { role: 'user', text: 'Good night.' }])
    await backend.turn({ action: 'sleep' })
    await delay(600)
    location.reload()
  }

  function submit(text) {
    const t = text.trim()
    if (!t) return
    setInput('')
    if (/\b(next day|day 2|new day|good night)\b/i.test(t) && world.plan?.status === 'closed') return sleep()
    run({ utterance: t }, t)
  }

  function mic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return setTranscript((t) => [...t, { role: 'system', text: 'Speech input is not available in this browser. Type instead.' }])
    const r = new SR()
    r.lang = 'en-US'
    r.onresult = (e) => submit(e.results[0][0].transcript)
    r.start()
  }

  async function reset() {
    try { Object.keys(sessionStorage).filter((k) => k.startsWith('dayloop-')).forEach((k) => sessionStorage.removeItem(k)) } catch { /* ignore */ }
    await backend.reset()
    location.reload()
  }

  if (error) return <div className="fatal">{error}</div>
  if (!world) return <div className="fatal">Starting DayLoop...</div>

  const ledger = promiseLedger(world)
  const next = nextScript(world)
  const pending = world.pending
  const toolCalls = steps.filter((s) => s.kind === 'tool').length

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <img className="logo" src="./logo.svg" alt="" />
          <div>
            <h1>DayLoop</h1>
            <p>Your day will break. Your promises don't have to.</p>
          </div>
        </div>
        <div className="pills">
          <span className="pill clock">Day {world.day} · {world.clock}</span>
          <span className="pill">Session {world.session}</span>
          <span className="pill engine">{backend.label}</span>
          <span className="pill sim">Simulated Alexa+</span>
          <button className="ghost" onClick={() => setVoice(!voice)}>{voice ? 'Voice on' : 'Voice off'}</button>
          <button className="ghost danger" onClick={reset}>Reset demo</button>
        </div>
      </header>

      <main className="grid">
        <section className="panel convo">
          <h2>Conversation</h2>
          <div className="chat" ref={chatRef}>
            {transcript.length === 0 && <p className="hint">Say "Alexa, build my day" or tap the line below.</p>}
            {transcript.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.role !== 'system' && <span className="who">{m.role === 'user' ? 'You' : 'DayLoop'}</span>}
                {m.text}
              </div>
            ))}
            {busy && <div className="bubble agent thinking"><span className="dots"><i /><i /><i /></span></div>}
          </div>
          <div className="say">
            {pending && !busy && <button className="chip approve" onClick={() => run({ utterance: 'Approve' }, 'Approve.')}>"Approve."</button>}
            {next && !busy && (
              <button className="chip" onClick={() => sayScripted(next)}>
                {next.clock && <span className="at">{next.clock}</span>}"{next.text}"
              </button>
            )}
          </div>
          <form className="input" onSubmit={(e) => { e.preventDefault(); submit(input) }}>
            <button type="button" className="mic" onClick={mic} aria-label="Speak">Mic</button>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder='Type or say: "Build my day"' disabled={busy} />
            <button type="submit" disabled={busy}>Send</button>
          </form>
        </section>

        <section className="center">
          <div className="device">
            <div className="screen">
              {cards.length ? <Card card={cards[Math.min(cardIdx, cards.length - 1)]} world={world} /> : <Welcome world={world} />}
            </div>
            {cards.length > 1 && (
              <div className="dots-nav">
                {cards.map((c, i) => <button key={i} className={i === cardIdx ? 'on' : ''} onClick={() => setCardIdx(i)} aria-label={c.title} />)}
              </div>
            )}
          </div>

          {pending ? (
            <div className="tray">
              <div className="tray-head">
                <span className="badge hold">Drafted, not sent</span>
                <strong>{pending.label}</strong>
              </div>
              <div className="drafts">
                {pending.messages.map((m, i) => (
                  <div key={i} className="draft">
                    <span className="to">{m.channel === 'team' ? 'Team chat' : 'Client'} · {m.to}</span>
                    <p>{m.text}</p>
                  </div>
                ))}
              </div>
              <div className="tray-actions">
                <button className="primary" disabled={busy} onClick={() => run({ utterance: 'Approve' }, 'Approve.')}>Approve and send</button>
                <button className="ghost" disabled={busy} onClick={() => run({ utterance: 'Not now' }, 'Not now.')}>Not now</button>
              </div>
            </div>
          ) : (
            <Ledger ledger={ledger} />
          )}
        </section>

        <section className="panel steps">
          <h2>Agent steps <span className="count">{toolCalls} tool calls</span></h2>
          <div className="steplist" ref={stepsRef}>
            {steps.length === 0 && <p className="hint">Every tool call DayLoop makes across Calendar, Tasks, Team Chat, Client Inbox and Memory shows up here.</p>}
            {steps.map((s, i) => (
              <div key={i} className={`step ${s.kind === 'tool' ? SERVICE(s.tool) : 'think'}`}>
                <div className="step-head">
                  <span className="tool">{s.kind === 'tool' ? s.tool : 'reasoning'}</span>
                  <span className="when">D{s.day} {s.clock}</span>
                </div>
                <div className="step-body">{s.kind === 'tool' ? s.summary : s.text}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="foot">Simulated Alexa+ experience · simulated data · the same tools are served over MCP (Streamable HTTP) · made by <a href="https://zroit.com" target="_blank" rel="noreferrer">ZroIT</a></footer>
    </div>
  )
}

function Welcome({ world }) {
  return (
    <div className="card welcome">
      <span className="kicker">Day {world.day} · {world.clock}</span>
      <h3>Good morning.</h3>
      <p className="lead">I read your calendar, task board, team chat and client inbox myself, build the day, and keep every promise you made to a client in view.</p>
      <p className="lead dim">When the day breaks, I tell people before they have to chase you. Nothing leaves without your approval.</p>
    </div>
  )
}

const STATE_LABEL = { open: 'Not planned yet', on_track: 'On track', at_risk: 'At risk', kept: 'Kept', scheduled: 'Due later', broken: 'Broken' }

function Ledger({ ledger }) {
  return (
    <div className="ledger">
      <h2>Promise ledger</h2>
      <div className="promises">
        {ledger.map((p) => (
          <div key={p.taskId} className={`promise ${p.state}`}>
            <div className="p-top">
              <span className="p-state">{STATE_LABEL[p.state]}{p.renegotiated && p.state !== 'kept' ? ' · renegotiated' : ''}</span>
              <span className="p-by">{p.byDay > 1 ? `Day ${p.byDay} ` : ''}{p.byTime}</span>
            </div>
            <div className="p-what">{p.what.replace(/^the /, '')} <span className="dim">to {p.contact}</span></div>
          </div>
        ))}
      </div>
    </div>
  )
}
