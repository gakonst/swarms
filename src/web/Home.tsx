import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import * as Status from '../shared/Status.ts'
import { here } from './boot.ts'
import { Card, fromProblem, fromSwarm, type Idea } from './Card.tsx'
import { Field, type Hive } from './Field.tsx'
import { ago, usd } from './format.ts'
import { open as openProblems, problems } from './research.ts'
import { href, Link, navigate } from './router.tsx'
import * as Wire from './wire.ts'

const order = { running: 0, paused: 1, funding: 2 } as const

const filters = [
  ['open', 'All'],
  ['running', 'Working now'],
  ['money', 'Needs money'],
  ['waiting', 'No riders yet'],
] as const

type Filter = (typeof filters)[number][0]

const aliases: Record<string, Filter> = { fuel: 'money', live: 'running', new: 'waiting' }

const fits: Record<Filter, (idea: Idea) => boolean> = {
  money: (idea) => idea.word === 'Needs money',
  open: () => true,
  running: (idea) => idea.word === 'Running' || idea.word === 'Starting',
  waiting: (idea) => idea.word === 'Not started',
}

function sorted(swarms: readonly Summary[] | undefined) {
  return [...(swarms ?? [])].filter((swarm) => !Status.test(swarm)).sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt)
}

function useIdeas() {
  const list = Wire.useSwarms()
  const open = sorted(list.data?.swarms)
  const latest = Math.max(0, ...open.map((swarm) => swarm.updatedAt))
  const ranked = Status.ranked(open, latest)
  const free = list.data ? openProblems(open) : list.error ? [...problems] : []
  const seeds = free.map(fromProblem)
  const ideas = ranked.map(fromSwarm).flatMap((idea, index) => (index % 3 === 2 && seeds.length ? [idea, seeds.shift()!] : [idea])).concat(seeds)
  return { free, ideas, latest, list, open, ranked }
}

function Grid(props: { ideas: readonly Idea[]; loading: boolean }) {
  return (
    <ul className="cards" data-loading={props.loading}>
      {props.ideas.map((idea) => <Card idea={idea} key={idea.id} />)}
      {props.loading && Array.from({ length: 6 }, (_, index) => <li className="card-ghost" key={index} />)}
    </ul>
  )
}

function asked() {
  const query = here().searchParams
  const raw = query.get('filter') ?? ''
  return filters.some(([key]) => key === raw) ? (raw as Filter) : aliases[raw] ?? 'open'
}

function keep(filter: Filter) {
  history.replaceState(history.state, '', href(`/ideas${filter === 'open' ? '' : `?filter=${filter}`}`))
}

function follow(event: MouseEvent, path: string | undefined) {
  if (!path || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  event.stopPropagation()
  navigate(path)
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function Home() {
  const { free, ideas, latest, list, open, ranked } = useIdeas()
  const sky = useRef<HTMLElement>(null)
  const [lit, setLit] = useState<string>()
  const [view, setView] = useState<'popular' | 'live' | 'new'>('popular')
  const [now, setNow] = useState<number>()
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const hives = useMemo<Hive[]>(() => {
    const clock = now ?? latest
    const joins = ranked.slice(0, 40).map(
      (item): Hive => ({
        about: (item.answer && Answer.gist(item.answer.text)) || item.goal,
        detail: `${Status.word(item)} · ${usd(item.balance)}`,
        facts: [plural(item.contributors, 'rider'), now ? `updated ${ago(item.updatedAt, now)}` : ''].filter(Boolean).join(' · '),
        fresh: item.status === 'running' ? 1 : 1 / (1 + Math.max(0, clock - item.updatedAt) / 86_400_000),
        home: 'join',
        id: item.id,
        mood: Status.standing(item).mood,
        title: item.title,
        updated: item.updatedAt,
        weight: Number(item.balance),
      }),
    )
    const seeds = free.slice(0, 10).map((item): Hive => ({ about: item.hint, detail: 'No riders yet', facts: 'Be the first rider', fresh: 0.35, home: 'start', id: `idea:${item.id}`, mood: 'new', title: item.label, updated: 0, weight: 0 }))
    return joins.concat(seeds)
  }, [ranked.map((item) => [item.id, item.status, item.why, item.balance, item.contributors, item.updatedAt, item.answer?.text.length].join()).join('|'), free.map((item) => item.id).join(), now])
  const working = open.filter((swarm) => swarm.status === 'running').length
  const balance = open.reduce((sum, swarm) => sum + Number(swarm.balance), 0)
  const shown = ideas.filter((idea) => (view === 'live' ? fits.running(idea) : view === 'new' ? fits.waiting(idea) : true)).slice(0, 12)
  const path = (id: string) => (id.startsWith('idea:') ? `/new?q=${id.slice(5)}` : `/s/${id}`)
  const tabs = [['popular', 'Popular'], ['live', 'Working now'], ['new', 'No riders yet']] as const

  return (
    <div className="home">
      <section className="hero">
        <h1 className="hero-title">Make a breakthrough.</h1>
        <Go />
      </section>
      <section aria-label="Swarms at work" className="sky" data-lit={!!lit} onClickCapture={(event) => follow(event, lit && path(lit))} ref={sky}>
        <Field hives={hives} homes={{}} onPick={setLit} surface={sky} />
      </section>
      <p className="hero-live" data-ready={!!list.data}>
        {working > 0 && <><i className="live-dot" />{working} working now · </>}
        {plural(ideas.length, 'swarm')}{balance > 0 && <> · {usd(String(balance))} to spend</>}
      </p>
      <section className="intro">
        <p>A swarm is many AI agents working one hard problem, in the open. A rider points it: names the goal, puts in a few dollars of compute, and steers by what it finds.</p>
      </section>
      <section aria-labelledby="ideas-title" className="band">
        <header className="band-head">
          <h2 id="ideas-title">Swarms</h2>
          <div aria-label="Show" className="chips" role="tablist">
            {tabs.map(([key, label]) => <button aria-selected={view === key} className="chip" key={key} onClick={() => setView(key)} role="tab" type="button">{label}</button>)}
          </div>
        </header>
        <div className="band-main">
          {list.error && !list.data ? (
            <button className="world-empty" onClick={() => location.reload()} type="button"><span>Can't reach Swarms.</span><b>Tap to try again ↻</b></button>
          ) : (
            <Grid ideas={shown} loading={!list.data && !list.error} />
          )}
          <Link className="band-more" to="/ideas">All {list.data ? plural(ideas.length, 'swarm') : 'swarms'}</Link>
        </div>
      </section>
      <section aria-labelledby="how-title" className="band">
        <header className="band-head"><h2 id="how-title">How it works</h2></header>
        <ol className="band-main steps">
          <li><b>[1]</b><span>Pick a swarm, or start one with a problem of your own</span></li>
          <li><b>[2]</b><span>Put in a few dollars and say where it should go</span></li>
          <li><b>[3]</b><span>Read what it finds, and steer again</span></li>
        </ol>
      </section>
      <section aria-labelledby="riders-title" className="band">
        <header className="band-head"><h2 id="riders-title">Swarm riders</h2></header>
        <div className="band-main creed">
          <p>Commanding a swarm of agents to a productive end is a new skill. It is closer to running experiments than to writing software: say what counts as better, build the test, and let the swarm cook.</p>
          <Link className="band-more" to="/about">Read the manifesto</Link>
        </div>
      </section>
      <section className="own">
        <Go />
      </section>
    </div>
  )
}

export function Go() {
  return (
    <ol className="go">
      <li><Link to="/new"><b>[1]</b><span>Start a swarm</span></Link></li>
      <li><Link to="/ideas"><b>[2]</b><span>Ride a swarm</span></Link></li>
    </ol>
  )
}

export function Join() {
  const { ideas, list } = useIdeas()
  const [filter, setFilter] = useState<Filter>(asked)
  const fit = (key: Filter, idea: Idea) => fits[key](idea)
  const shown = ideas.filter((idea) => fit(filter, idea))
  const count = (key: Filter) => ideas.filter((idea) => fit(key, idea)).length
  const choose = (next: Filter) => {
    setFilter(next)
    keep(next)
  }

  return (
    <div className="page browse">
      <header className="browse-head">
        <h1>Swarms</h1>
        <div aria-label="Show" className="chips" role="tablist">
          {filters.filter(([key]) => key === 'open' || key === filter || !list.data || count(key) > 0).map(([key, label]) => (
            <button aria-selected={filter === key} className="chip" key={key} onClick={() => choose(key)} role="tab" type="button">
              {key === 'running' && list.data && count(key) > 0 && <i className="live-dot" />}
              {label}
              <span className="chip-count">{list.data ? count(key) : ''}</span>
            </button>
          ))}
        </div>
      </header>
      {list.error && !list.data ? (
        <button className="world-empty" onClick={() => location.reload()} type="button"><span>Can't reach Swarms.</span><b>Tap to try again ↻</b></button>
      ) : list.data && shown.length === 0 ? (
        <Link className="world-empty" to="/new">
          <span>{filter === 'running' ? 'Nothing is working right now.' : filter === 'money' ? 'Every swarm has money.' : 'Nothing here yet.'}</span>
          <b>Start a swarm →</b>
        </Link>
      ) : (
        <Grid ideas={shown} loading={!list.data} />
      )}
    </div>
  )
}
