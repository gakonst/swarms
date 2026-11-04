import { useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import * as Api from './api.ts'
import { ago, usd } from './format.ts'
import { usePoll } from './hooks.ts'
import { open, problems } from './research.ts'
import { Link, navigate, prefetch } from './router.tsx'

const order = { running: 0, paused: 1, funding: 2, done: 3 } as const

const openIdeas = open

const filters = [
  ['open', 'Open'],
  ['live', 'Live now'],
  ['resting', 'Resting'],
  ['fuel', 'Needs fuel'],
] as const

type Filter = (typeof filters)[number][0]

const fueled = (swarm: Summary) => Number(swarm.remaining) >= 0.05

const fits: Record<Filter, (swarm: Summary) => boolean> = {
  fuel: (swarm) => swarm.status !== 'running' && !fueled(swarm),
  live: (swarm) => swarm.status === 'running',
  open: (swarm) => swarm.status !== 'done',
  resting: (swarm) => swarm.status !== 'running' && fueled(swarm),
}

function sorted(swarms: readonly Summary[] | undefined) {
  return [...(swarms ?? [])].sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt)
}

function Tile(props: { onPick: () => void; open: boolean; swarm: Summary }) {
  const swarm = props.swarm
  const page = `/s/${swarm.id}`
  return (
    <li data-open={props.open}>
      <button aria-expanded={props.open} className="tile-swarm" onClick={() => (props.open ? navigate(page) : props.onPick())} onFocus={() => prefetch(page)} onPointerEnter={() => prefetch(page)} onTouchStart={() => prefetch(page)} type="button">
        <i className="tile-dot" data-status={swarm.status} />
        <span className="tile-title">{swarm.title}</span>
        <span className="tile-raised">{usd(swarm.raised)}</span>
        {props.open && (
          <span className="tile-more">
            <span className="tile-goal">{swarm.goal}</span>
            {swarm.answer && Answer.gist(swarm.answer.text) && <span className="tile-answer">{Answer.gist(swarm.answer.text)}</span>}
            <span className="tile-facts">
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

export function Home() {
  const [list] = usePoll(() => Api.swarms(), 5000, 'swarms', { keep: true })
  const swarms = sorted(list.data?.swarms)
  const open = swarms.filter((swarm) => swarm.status !== 'done')
  const live = open.filter((swarm) => swarm.status === 'running').length
  const peek = (open.length ? open : swarms).slice(0, 4)
  const free = list.data ? openIdeas(swarms) : problems
  const ideas = free.slice(0, 4)

  return (
    <div className="page doors">
      <Link className="door door-start" to="/new">
        <span className="door-kicker">{free.length} ideas waiting</span>
        <span className="door-title">Start a breakthrough<span aria-hidden="true" className="door-arrow">→</span></span>
        <span aria-hidden="true" className="door-cards">
          {ideas.map((item) => (
            <span className="door-card" key={item.id}>
              <i className="tile-mark" data-tone={problems.indexOf(item) % 3} />
              <b>{item.label}</b>
            </span>
          ))}
        </span>
      </Link>
      <Link className="door door-join" to="/join">
        <span className="door-kicker">
          {live > 0 && <i className="chip-live" />}
          {!list.data ? (list.error ? 'Offline' : 'Looking…') : live ? `${live} live now` : `${open.length} open`}
        </span>
        <span className="door-title">Be part of the future<span aria-hidden="true" className="door-arrow">→</span></span>
        <span aria-hidden="true" className="door-cards">
          {peek.map((swarm) => (
            <span className="door-card" data-status={swarm.status} key={swarm.id}>
              <i className="tile-dot" data-status={swarm.status} />
              <b>{swarm.title}</b>
              <em>{usd(swarm.raised)}</em>
            </span>
          ))}
          {!list.data && Array.from({ length: 4 }, (_, index) => <span className="door-card door-ghost" key={index} />)}
          {list.data && !peek.length && <span className="door-card door-none"><b>Nothing yet. Be the first.</b></span>}
        </span>
      </Link>
    </div>
  )
}

export function Join() {
  const [list] = usePoll(() => Api.swarms(), 5000, 'swarms', { keep: true })
  const [filter, setFilter] = useState<Filter>('open')
  const [picked, setPicked] = useState<string>()
  const swarms = sorted(list.data?.swarms)
  const shown = swarms.filter((swarm) => fits[filter](swarm))
  const count = (key: Filter) => swarms.filter((swarm) => fits[key](swarm)).length

  return (
    <div className="page start">
      <section aria-labelledby="join-title" className="world">
        <header className="world-bar">
          <h1 id="join-title">Be part of the future.</h1>
          <div aria-label="Show" className="world-filters" role="tablist">
            {filters.map(([key, label]) => (
              <button aria-selected={filter === key} className="chip" key={key} onClick={() => setFilter(key)} role="tab" type="button">
                {key === 'live' && <i className="chip-live" />}
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
            <span>{filter === 'resting' ? 'Nothing resting right now.' : filter === 'fuel' ? 'Every swarm has fuel.' : filter === 'live' ? 'Nothing live right now.' : 'No swarms yet.'}</span>
            <b>Start one →</b>
          </Link>
        ) : (
          <ol className="tiles-swarm" data-loading={!list.data}>
            {shown.map((swarm) => <Tile key={swarm.id} onPick={() => setPicked(swarm.id)} open={picked === swarm.id} swarm={swarm} />)}
            {!list.data && Array.from({ length: 4 }, (_, index) => <li className="tile-ghost" key={index} />)}
          </ol>
        )}
      </section>
    </div>
  )
}
