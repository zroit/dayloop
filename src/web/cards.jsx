// Echo Show style cards. Every card is drawn from data the agent computed this turn.

export function Card({ card }) {
  const View = { plan: TimelineCard, replan: TimelineCard, memory: MemoryCard, close: CloseCard, done: DoneCard }[card.type]
  return View ? <View card={card} /> : null
}

function TimelineCard({ card }) {
  const isReplan = card.type === 'replan'
  // On a replan, what happened before the restart is folded into one line.
  const earlier = isReplan ? card.rows.filter((r) => r.start < card.restartAt && !r.movedFrom && !r.shiftedFrom) : []
  const rows = card.rows.filter((r) => !earlier.includes(r))
  return (
    <div className="card timeline">
      <span className="kicker">{isReplan ? `Replan · restart at ${card.restartAt}` : `Plan · Day ${card.day}`}</span>
      <h3>{card.title}</h3>
      {card.top3 && (
        <div className="top3">
          {card.top3.map((t, i) => <span key={t} className="top"><b>{i + 1}</b>{t}</span>)}
        </div>
      )}
      <ol className="rows">
        {earlier.length > 0 && (
          <li className="row event personal past">
            <span className="t">{earlier[0].start}</span>
            <span className="name">Earlier today: {earlier.length} items</span>
            <span className="tags"><em className="tag dim">unchanged</em></span>
          </li>
        )}
        {rows.map((r, i) => (
          <li key={i} className={`row ${r.kind} ${r.type ?? ''} ${r.past ? 'past' : ''} ${r.movedFrom || r.shiftedFrom ? 'changed' : ''}`}>
            <span className="t">{r.start}</span>
            <span className="name">{r.title}</span>
            <span className="tags">
              {r.movedFrom && <em className="tag move">{r.reason === 'preference' ? 'your preference' : 'conflict'} · was {r.movedFrom}</em>}
              {r.shiftedFrom && <em className="tag shift">was {r.shiftedFrom}</em>}
              {r.promiseTo && !r.past && <em className="tag vow">promise · {r.promiseTo}</em>}
              {r.past && <em className="tag dim">earlier</em>}
            </span>
          </li>
        ))}
        {card.overflow.map((o, i) => (
          <li key={`o${i}`} className="row overflow">
            <span className="t">later</span>
            <span className="name">{o.title}</span>
            <span className="tags"><em className="tag risk">doesn't fit · {o.promiseTo ? `promise to ${o.promiseTo} at risk` : 'to tomorrow'}</em></span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function MemoryCard({ card }) {
  return (
    <div className="card memory">
      <span className="kicker">Memory · from yesterday's session</span>
      <h3>{card.title}</h3>
      <ul className="recall">
        {card.recalled.map((r, i) => (
          <li key={i}><strong>{r.label}</strong><span>{r.detail}</span></li>
        ))}
      </ul>
      {card.actedOn.length > 0 && (
        <div className="acted">
          <span className="kicker">So this morning I</span>
          {card.actedOn.map((a, i) => <p key={i}>{a}</p>)}
        </div>
      )}
    </div>
  )
}

function CloseCard({ card }) {
  return (
    <div className="card close">
      <span className="kicker">Evening close · Day {card.day}</span>
      <h3>{card.title}</h3>
      <div className="kpis">
        <div className="kpi ok"><b>{card.kept.length}</b><span>promises kept</span></div>
        <div className="kpi warn"><b>{card.renegotiated.length}</b><span>renegotiated, with a heads-up</span></div>
        <div className={`kpi ${card.broken.length ? 'risk' : 'ok'}`}><b>{card.broken.length}</b><span>broken silently</span></div>
      </div>
      <div className="cols">
        <div>
          <span className="kicker">Carried into tomorrow</span>
          {card.carried.map((c, i) => <p key={i}>{i === 0 ? 'First: ' : ''}{c}</p>)}
        </div>
        <div>
          <span className="kicker">Learned</span>
          <p>{card.preference ? `No calls before ${card.preference}` : 'No new preference'}</p>
        </div>
      </div>
    </div>
  )
}

function DoneCard({ card }) {
  return (
    <div className="card done">
      <span className="kicker">Approved by you</span>
      <h3>{card.title}</h3>
      <ul className="checks">
        {card.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
    </div>
  )
}
