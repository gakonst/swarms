import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import * as Status from '../shared/Status.ts'
import { here } from './boot.ts'
import { ago, usd } from './format.ts'
import { open, problems } from './research.ts'
import { href, Link, navigate, prefetch } from './router.tsx'
import * as Wire from './wire.ts'

const order = { running: 0, paused: 1, funding: 2, done: 3 } as const

const openIdeas = open

const filters = [
  ['open', 'Open'],
  ['running', 'Running'],
  ['resting', 'Resting'],
  ['waiting', 'Not started'],
  ['money', 'Needs money'],
] as const

type Filter = (typeof filters)[number][0]

const aliases: Record<string, Filter> = { fuel: 'money', live: 'running' }

const fits: Record<Filter, (swarm: Summary) => boolean> = {
  money: (swarm) => Status.word(swarm) === 'Needs money',
  open: (swarm) => swarm.status !== 'done',
  resting: (swarm) => Status.word(swarm) === 'Resting' || Status.word(swarm) === 'Stopped after errors',
  running: (swarm) => swarm.status === 'running',
  waiting: (swarm) => Status.word(swarm) === 'Not started' || Status.word(swarm) === 'Starting',
}

function sorted(swarms: readonly Summary[] | undefined) {
  return [...(swarms ?? [])].sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt)
}

function asked() {
  const query = here().searchParams
  const raw = query.get('filter') ?? ''
  const filter = filters.some(([key]) => key === raw) ? (raw as Filter) : aliases[raw] ?? 'open'
  return { filter, open: query.get('open') ?? undefined }
}

function keep(filter: Filter, open: string | undefined) {
  const query = new URLSearchParams()
  if (filter !== 'open') query.set('filter', filter)
  if (open) query.set('open', open)
  const search = query.toString()
  history.replaceState(history.state, '', href(`/join${search ? `?${search}` : ''}`))
}

function Tile(props: { onPick: () => void; open: boolean; swarm: Summary }) {
  const swarm = props.swarm
  const page = `/s/${swarm.id}`
  const word = Status.word(swarm)
  return (
    <li data-open={props.open}>
      <button aria-expanded={props.open} className="tile-swarm" onClick={() => (props.open ? navigate(page) : props.onPick())} onFocus={() => prefetch(page)} onPointerEnter={() => prefetch(page)} onTouchStart={() => prefetch(page)} title={props.open ? undefined : swarm.title} type="button">
        <i className="tile-dot" data-status={swarm.status} title={word} />
        <span className="tile-title">{swarm.title}</span>
        <span className="tile-raised">{usd(swarm.raised)}</span>
        {props.open && (
          <span className="tile-more">
            <span className="tile-goal">{swarm.goal}</span>
            {swarm.answer && Answer.gist(swarm.answer.text) && <span className="tile-answer">{Answer.gist(swarm.answer.text)}</span>}
            <span className="tile-facts">
              <span><b>{word}</b></span>
              <span><b>{usd(swarm.remaining)}</b> left</span>
              <span><b>{swarm.contributors}</b> backer{swarm.contributors === 1 ? '' : 's'}</span>
              <span>{ago(swarm.updatedAt)}</span>
            </span>
            <span className="tile-go">Open it →</span>
          </span>
        )}
      </button>
    </li>
  )
}

function Title(props: { text: string }) {
  const words = props.text.split(' ')
  const last = words.pop()
  return (
    <span className="door-title">
      {words.join(' ')} <span className="door-last">{last}<span aria-hidden="true" className="door-arrow">→</span></span>
    </span>
  )
}

export function Home() {
  const list = Wire.useSwarms()
  const swarms = sorted(list.data?.swarms)
  const open = swarms.filter((swarm) => swarm.status !== 'done')
  const counted = Status.count(swarms)
  const latest = Math.max(0, ...swarms.map((swarm) => swarm.updatedAt))
  const peek = Status.ranked(open.length ? open : swarms, latest).slice(0, 4)
  const free = list.data ? openIdeas(swarms) : problems
  const ideas = free.slice(0, 4)

  return (
    <div className="page doors">
      <div className="door door-start">
        <Link className="door-link" to="/new">
          <span className="door-kicker">{Status.ideas(free.length)}</span>
          <Title text="Start a breakthrough" />
        </Link>
        <span className="door-cards">
          {ideas.map((item) => (
            <Link className="door-card" key={item.id} to={`/new?q=${item.id}`}>
              <i className="tile-mark" data-tone={problems.indexOf(item) % 3} />
              <b>{item.label}</b>
              <small>{item.hint}</small>
            </Link>
          ))}
        </span>
      </div>
      <div className="door door-join">
        <Link className="door-link" to="/join">
          <span className="door-kicker">
            {counted.running > 0 && <i className="chip-live" />}
            {!list.data ? (list.error ? 'Offline' : 'Looking…') : counted.text}
          </span>
          <Title text="Be part of the future" />
        </Link>
        <span className="door-cards">
          {peek.map((swarm) => (
            <Link className="door-card" key={swarm.id} to={`/s/${swarm.id}`}>
              <i className="tile-dot" data-status={swarm.status} title={Status.word(swarm)} />
              <b>{swarm.title}</b>
              <em>{Status.word(swarm)} · {usd(swarm.raised)}</em>
            </Link>
          ))}
          {!list.data && Array.from({ length: 4 }, (_, index) => <span className="door-card door-ghost" key={index} />)}
          {list.data && !peek.length && <span className="door-card door-none"><b>Nothing yet. Be the first.</b></span>}
        </span>
      </div>
    </div>
  )
}

export function Join() {
  const list = Wire.useSwarms()
  const [start] = useState(asked)
  const [filter, setFilter] = useState<Filter>(start.filter)
  const [picked, setPicked] = useState<string | undefined>(start.open)
  const swarms = sorted(list.data?.swarms)
  const shown = swarms.filter((swarm) => fits[filter](swarm))
  const count = (key: Filter) => swarms.filter((swarm) => fits[key](swarm)).length
  const choose = (next: Filter) => {
    setFilter(next)
    keep(next, picked)
  }
  const pick = (id: string) => {
    setPicked(id)
    keep(filter, id)
  }

  return (
    <div className="page start">
      <section aria-labelledby="join-title" className="world">
        <header className="world-bar">
          <h1 id="join-title">Be part of the future.</h1>
          <div aria-label="Show" className="world-filters" role="tablist">
            {filters.map(([key, label]) => (
              <button aria-selected={filter === key} className="chip" key={key} onClick={() => choose(key)} role="tab" type="button">
                {key === 'running' && list.data && count(key) > 0 && <i className="chip-live" />}
                {label}
                <span className="chip-count">{list.data ? count(key) : ''}</span>
              </button>
            ))}
          </div>
        </header>
        {list.error && !list.data ? (
          <button className="world-empty" onClick={() => location.reload()} type="button">
            <span>Can't reach Swarms.</span>
            <b>Tap to try again ↻</b>
          </button>
        ) : list.data && shown.length === 0 ? (
          <Link className="world-empty" to="/new">
            <span>{filter === 'resting' ? 'Nothing resting right now.' : filter === 'money' ? 'Every swarm has money.' : filter === 'running' ? 'Nothing running right now.' : filter === 'waiting' ? 'Nothing waiting to start.' : 'No swarms yet.'}</span>
            <b>Start a swarm →</b>
          </Link>
        ) : (
          <ol className="tiles-swarm" data-loading={!list.data}>
            {shown.map((swarm) => <Tile key={swarm.id} onPick={() => pick(swarm.id)} open={picked === swarm.id} swarm={swarm} />)}
            {!list.data && Array.from({ length: 4 }, (_, index) => <li className="tile-ghost" key={index} />)}
          </ol>
        )}
      </section>
    </div>
  )
}
