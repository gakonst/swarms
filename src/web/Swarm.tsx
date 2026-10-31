import { useEffect, useRef, useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Config, Detail, Entry, Note, Round } from '../shared/Api.ts'
import * as Api from './api.ts'
import { Feed } from './Feed.tsx'
import { Budgets, Contributions, Pledges } from './Backing.tsx'
import { Connect } from './Connect.tsx'
import { Box } from './Contribute.tsx'
import { ago, duration, mach, percent, short, usd } from './format.ts'
import { type Draft, useLive, useNow, usePoll } from './hooks.ts'
import { Machines } from './Machines.tsx'
import { Mission } from './Mission.tsx'
import { Markdown } from './Markdown.tsx'
import { Link } from './router.tsx'
import { Bar, Status } from './Visual.tsx'

function merge(previous: Entry[], next: readonly Entry[]) {
  const known = new Set(previous.map((entry) => entry.seq))
  const fresh = next.filter((entry) => !known.has(entry.seq))
  if (fresh.length === 0) return previous
  return [...previous, ...fresh].sort((a, b) => a.seq - b.seq).slice(-500)
}


const rounds = { cancelled: 'Cancelled', completed: 'Completed', failed: 'Failed', running: 'Running' } as const satisfies Record<Round['status'], string>


export function Swarm(props: { config: Config | undefined; id: string }) {
  const [detail, reload] = usePoll(() => Api.swarm(props.id), 5000, props.id)
  const [entries, setEntries] = useState<Entry[]>([])
  const [note, setNote] = useState('')
  const last = useRef(0)
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'mission' | 'findings' | 'fund'>(() => new URLSearchParams(location.search).get('view') === 'fund' ? 'fund' : 'mission')
  const loaded = detail.data !== undefined
  const draft = useLive(props.id, detail.data?.status === 'running')

  useEffect(() => {
    setEntries([])
    last.current = 0
  }, [props.id])

  useEffect(() => {
    if (detail.data) setEntries((previous) => merge(previous, detail.data?.feed ?? []))
  }, [detail.data])

  useEffect(() => {
    last.current = entries.at(-1)?.seq ?? 0
  }, [entries])

  useEffect(() => {
    if (detail.data) document.title = `${detail.data.title} · Swarms`
  }, [detail.data?.title])

  useEffect(() => {
    if (!loaded) return
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const run = async () => {
      try {
        const { entries: next } = await Api.feed(props.id, last.current)
        if (alive) setEntries((previous) => merge(previous, next))
      } catch {}
      if (alive) timer = setTimeout(() => void run(), 2000)
    }
    timer = setTimeout(() => void run(), 2000)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [loaded, props.id])

  if (!detail.data)
    return (
      <section className="page missing">
        <p className="label">{detail.error ? 'Could not load the swarm' : 'Loading…'}</p>
        {detail.error && (
          <p className="lead">
            {detail.error} <Link to="/">Back to all swarms</Link>
          </p>
        )}
      </section>
    )

  const swarm = detail.data
  const live = swarm.status === 'running'
  const back = (text: string) => {
    setNote(text)
    setView('fund')
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => document.getElementById('amount')?.focus({ preventScroll: true }), 400)
  }

  return (
    <article className="page swarm game-swarm" data-status={swarm.status}>
      <div className="quest-title"><div><Meta swarm={swarm} /><h1>{swarm.title}</h1></div><span className="quest-mode">{Api.fixture ? 'DEMO QUEST' : 'LIVE QUEST'}</span></div>
      <nav aria-label="Quest view" className="quest-tabs">
        <button aria-pressed={view === 'mission'} onClick={() => setView('mission')} type="button">The expedition</button>
        <button aria-pressed={view === 'findings'} onClick={() => setView('findings')} type="button">Findings</button>
        {swarm.status !== 'done' && <button aria-pressed={view === 'fund'} className="quest-fund-tab" onClick={() => setView('fund')} type="button">Add fuel +</button>}
      </nav>
      <div hidden={view !== 'mission'}>
        <Mission entries={entries} swarm={swarm} />
        <div className="mission-extras">
          <details className="game-details"><summary>The research question</summary><p>{swarm.goal}</p></details>
          <details className="game-details"><summary>Activity log</summary><Feed entries={entries} live={live} /></details>
          <details className="game-details"><summary>Machines · {swarm.hands.filter((hand) => hand.connected).length} connected</summary><Machines hands={swarm.hands} live={live} /><Connect swarm={swarm} /></details>
          <details className="game-details"><summary>Research rounds</summary><History draft={draft} history={swarm.history} /></details>
          <details className="game-details"><summary>Community notes</summary><Notes notes={swarm.notes} onBack={back} done={swarm.status === 'done'} /></details>
          <details className="game-details"><summary>Funding record</summary><Ledger config={props.config} swarm={swarm} /><Budgets budgets={swarm.budgets} config={props.config} /><Contributions config={props.config} contributions={swarm.contributions} /><Pledges config={props.config} pledges={swarm.pledges} /></details>
        </div>
      </div>
      <section className="quest-findings" hidden={view !== 'findings'}><Latest draft={draft} swarm={swarm} /></section>
      <section className="quest-funding" hidden={view !== 'fund'}><Box config={props.config} note={note} noteRef={box} onDone={reload} onNote={setNote} swarm={swarm} /></section>
    </article>
  )
}

function Meta(props: { swarm: Detail }) {
  const now = useNow()
  const running = props.swarm.history.findLast((round) => round.status === 'running')
  return (
    <p className="meta">
      <Status status={props.swarm.status} />
      {running ? (
        <span>
          Round {running.n} · {duration(now - running.startedAt)}
        </span>
      ) : (
        props.swarm.rounds > 0 && <span>{props.swarm.rounds === 1 ? '1 round' : `${props.swarm.rounds} rounds`}</span>
      )}
      <span>Started {ago(props.swarm.createdAt, now)}</span>
    </p>
  )
}

function Ledger(props: { config: Config | undefined; swarm: Detail }) {
  const swarm = props.swarm
  const slots = Math.max(swarm.parallel, swarm.workers, 1)
  return (
    <div className="ledger">
      <p className="label">{swarm.status === 'done' ? 'Spent' : 'Left to spend'}</p>
      <p className="figure">
        {mach(swarm.status === 'done' ? swarm.spent : swarm.remaining)} <span>USD</span>
      </p>
      <Bar swarm={swarm} />
      <div className="slots" data-live={swarm.status === 'running'}>
        <span className="slots-row" aria-hidden>
          {Array.from({ length: slots }, (_, index) => (
            <i className={index < swarm.workers ? 'slot slot-on' : 'slot'} key={index} style={{ animationDelay: `${index * -0.35}s` }} />
          ))}
        </span>
        <span>
          {swarm.status === 'running' ? `${swarm.workers} of ${swarm.parallel} explorers at work` : `Room for ${swarm.parallel} explorer${swarm.parallel === 1 ? '' : 's'}`}
        </span>
      </div>
      <dl className="figures">
        <div>
          <dt>Machines</dt>
          <dd>{swarm.machines}</dd>
        </div>
        <div>
          <dt>Backers</dt>
          <dd>{swarm.contributors}</dd>
        </div>
        <div>
          <dt>Rounds</dt>
          <dd>{swarm.rounds}</dd>
        </div>
      </dl>
      {swarm.wallet && (
        <p className="address">
          <span>Swarm wallet</span>
          {props.config ? (
            <a href={`${props.config.explorer}/address/${swarm.wallet}`} rel="noreferrer" target="_blank" title={swarm.wallet}>
              {short(swarm.wallet)} ↗
            </a>
          ) : (
            <span>{short(swarm.wallet)}</span>
          )}
          <span>{usd(swarm.pool)} pooled</span>
        </p>
      )}
      {props.config && (
        <p className="fine">
          Stablecoins count one to one. Each explorer beyond the first needs {usd(props.config.perWorker)} left to spend, and the swarm pauses below {usd(props.config.reserve)}.
        </p>
      )}
    </div>
  )
}

function Notes(props: { done: boolean; notes: readonly Note[]; onBack: (note: string) => void }) {
  if (props.notes.length === 0) return <p className="empty">No notes yet. A transfer, a budget or a pledge can carry one, and the swarm weighs it by the money behind it.</p>
  return (
    <ol className="notes">
      {props.notes.map((note, index) => (
        <li className="note" key={note.id}>
          <span className="index">[{index + 1}]</span>
          <div>
            <p className="note-text">{note.note}</p>
            <div className="share">
              <div style={{ width: `${Math.max(1, note.share * 100)}%` }} />
            </div>
            <p className="note-meta">
              <span>{usd(note.weight)}</span>
              <span>{percent(note.share)} of everything in</span>
              <span>{note.backers === 1 ? '1 backer' : `${note.backers} backers`}</span>
              <span className={note.steered ? 'tag tag-on' : 'tag'}>{note.steered ? 'Sent to the swarm' : 'Not sent yet'}</span>
            </p>
            {!props.done && (
              <button className="btn btn-low" onClick={() => props.onBack(note.note)} type="button">
                Back this note
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

const waiting = {
  done: 'The swarm ended without a report.',
  funding: 'No answer yet. The first transfer, budget or pledge starts round 1, and its report lands here.',
  paused: 'No answer yet. The swarm is paused until more money comes in.',
  running: '',
} as const

function writing(draft: Draft | undefined, round: Round | undefined) {
  if (!draft || !round || draft.round !== round.n) return undefined
  const text = draft.items.at(-1)?.text
  return { text: text ? Answer.parse(round.n, text, 0).text : '', thinking: draft.thinking }
}

function Latest(props: { draft: Draft | undefined; swarm: Detail }) {
  const now = useNow()
  const answer = props.swarm.answer
  const running = props.swarm.history.findLast((round) => round.status === 'running')
  const live = writing(props.draft, running)
  return (
    <div className="answer">
      {running && (
        <div className="answer-live">
          <p className="answer-meta">
            <i className="answer-dot" />
            Round {running.n} is writing{answer ? ' the next answer' : ' the first answer'} · {duration(now - running.startedAt)}
          </p>
          {live?.text ? (
            <Markdown streaming text={live.text} />
          ) : (
            <p className="answer-thinking">{live?.thinking ? `Thinking: …${live.thinking.slice(-280)}` : 'The lead is working. Its words stream in here as it writes them.'}</p>
          )}
        </div>
      )}
      {answer ? (
        <div className="answer-final">
          <p className="answer-meta">
            <span>Round {answer.round}</span>
            <span>{ago(answer.at, now)}</span>
            {answer.done ? <span className="tag tag-on">Reported complete</span> : answer.next && <span>Next: {answer.next}</span>}
          </p>
          <Markdown text={answer.text} />
        </div>
      ) : (
        !running && <p className="empty">{waiting[props.swarm.status]}</p>
      )}
    </div>
  )
}

function History(props: { draft: Draft | undefined; history: readonly Round[] }) {
  const now = useNow()
  if (props.history.length === 0) return <p className="empty">No rounds yet. Each round ends with a report, and it shows up here.</p>
  const ordered = [...props.history].sort((a, b) => b.n - a.n)
  const latest = ordered.find((round) => round.message)?.n
  return (
    <ol className="rounds">
      {ordered.map((round) => (
        <li className="round" data-status={round.status} key={round.n}>
          <details open={round.status === 'running' || round.n === latest}>
            <summary>
              <span className="round-n">Round {round.n}</span>
              <span className="round-status">
                <i />
                {rounds[round.status]}
              </span>
              <span>{duration((round.endedAt ?? now) - round.startedAt)}</span>
              <span>{usd(round.spent)}</span>
            </summary>
            {round.message ? (
              <Markdown text={round.message} />
            ) : round.status === 'running' && writing(props.draft, round)?.text ? (
              <Markdown streaming text={writing(props.draft, round)?.text ?? ''} />
            ) : (
              <p className="empty">{round.status === 'running' ? 'Working. The report streams in here as the lead writes it.' : 'No report.'}</p>
            )}
          </details>
        </li>
      ))}
    </ol>
  )
}

