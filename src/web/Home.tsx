import { useEffect, useMemo, useState } from 'react'
import type { Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Status from '../shared/Status.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { Card, fromProblem, fromSwarm, type Idea } from './Card.tsx'
import { type Cell, Field, type Hive } from './Field.tsx'
import { usd } from './format.ts'
import { open as openProblems, problems } from './research.ts'
import { href, Link } from './router.tsx'
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
  const current = ranked.filter((swarm) => swarm.form === 'tree' && !swarm.archivedAt)
  const earlier = ranked.filter((swarm) => !(swarm.form === 'tree' && !swarm.archivedAt)).map(fromSwarm)
  const ideas = current.map(fromSwarm).flatMap((idea, index) => (index % 3 === 2 && seeds.length ? [idea, seeds.shift()!] : [idea])).concat(seeds)
  return { earlier, free, ideas, latest, list, open, ranked }
}

function Earlier(props: { ideas: readonly Idea[] }) {
  if (!props.ideas.length) return null
  return (
    <details className="earlier">
      <summary>Earlier swarms <span className="chip-count">{props.ideas.length}</span></summary>
      <p className="fine">Archived and read-only: what each found stays, and so does any money left in it.</p>
      <Grid ideas={props.ideas} loading={false} />
    </details>
  )
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

function grown(swarm: Summary, head: Record<Tree.Status, number> | undefined): Record<Cell, number> {
  if (head) {
    const raw = { dead: head['dead end'], flight: head['in flight'], open: head.funded + head.proposed + 1, proven: head.proven, spent: 0 }
    const sum = raw.dead + raw.flight + raw.open + raw.proven
    const scale = sum > 220 ? 220 / sum : 1
    const out = { dead: Math.round(raw.dead * scale), flight: Math.round(raw.flight * scale), open: Math.round(raw.open * scale), proven: Math.round(raw.proven * scale), spent: 0 }
    return { ...out, open: out.open + Math.max(0, 8 - sum) }
  }
  const balance = Math.max(0, Number(swarm.balance))
  const count = Math.min(200, Math.round(12 + 14 * Math.sqrt(balance)))
  const spent = balance > 0 ? Math.round(count * Math.min(1, Math.max(0, Number(swarm.spent)) / balance)) : 0
  const flight = swarm.status === 'running' ? Math.min(count - spent, Math.max(1, Math.min(5, swarm.machines))) : 0
  return { dead: 0, flight, open: count - spent - flight, proven: 0, spent }
}

function useHeads(ids: readonly string[]) {
  const [heads, setHeads] = useState<Readonly<Record<string, Record<Tree.Status, number>>>>({})
  const key = ids.join()
  useEffect(() => {
    let alive = true
    for (const id of ids)
      Api.tree(id, { depth: 0 })
        .then((view) => {
          const root = view.nodes.find((node) => node.parent === null)
          if (alive && root) setHeads((kept) => ({ ...kept, [id]: root.counts }))
        })
        .catch(() => {})
    return () => {
      alive = false
    }
  }, [key])
  return heads
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

export function Home() {
  const { earlier, free, ideas, list, open, ranked } = useIdeas()
  const [view, setView] = useState<'popular' | 'live' | 'new'>('popular')
  const heads = useHeads(ranked.filter((item) => item.form === 'tree' && !item.archivedAt).slice(0, 6).map((item) => item.id))
  const hives = useMemo<Hive[]>(() => {
    const joins = [...ranked].sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt)).slice(0, 14).map(
      (item): Hive => ({
        cells: grown(item, heads[item.id]),
        detail: `${item.archivedAt ? 'Earlier' : Status.pill(Status.word(item))} · ${usd(item.balance)}`,
        id: item.id,
        live: item.status === 'running' && !item.archivedAt,
        old: !!item.archivedAt,
        path: Nickname.path(item),
        title: item.title,
      }),
    )
    const seeds = free.slice(0, 4).map((item): Hive => ({ cells: { dead: 0, flight: 0, open: 8, proven: 0, spent: 0 }, detail: 'No riders yet', id: `idea:${item.id}`, live: false, old: false, path: Nickname.usable(item.id) ? `/${item.id}` : `/new?q=${item.id}`, title: item.label }))
    return joins.concat(seeds)
  }, [ranked.map((item) => [item.id, item.status, item.balance, item.spent, item.machines, item.archivedAt].join()).join('|'), free.map((item) => item.id).join(), heads])
  const working = open.filter((swarm) => swarm.status === 'running').length
  const balance = open.reduce((sum, swarm) => sum + Math.max(0, Number(swarm.remaining)), 0)
  const shown = ideas.filter((idea) => (view === 'live' ? fits.running(idea) : view === 'new' ? fits.waiting(idea) : true)).slice(0, 12)
  const tabs = [['popular', 'Popular'], ['live', 'Working now'], ['new', 'No riders yet']] as const

  return (
    <div className="home">
      <section className="hero">
        <h1 className="hero-title">Make a breakthrough.</h1>
        <Go />
      </section>
      <section aria-label="Swarms at work" className="sky">
        <Field hives={hives} />
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
          <Earlier ideas={earlier} />
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
  const { earlier, ideas, list } = useIdeas()
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
      <Earlier ideas={earlier} />
    </div>
  )
}
