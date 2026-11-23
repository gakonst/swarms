import { useEffect, useState } from 'react'
import type { Listing, Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Status from '../shared/Status.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Api from './api.ts'
import { here } from './boot.ts'
import { cash, doing, Faces } from './Branches.tsx'
import { Card, fromProblem, fromSwarm, lead, type Idea } from './Card.tsx'
import { type Cell, Spiral } from './Field.tsx'
import { ago } from './format.ts'
import { useNow } from './hooks.ts'
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

const first = 6

const step = 8

const least = 1

type Doing = { at: number; text: string }

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
  return { earlier, ideas, list }
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

function live(swarm: Summary, head: Tree.Headline | undefined) {
  return !swarm.archivedAt && (swarm.status === 'running' || (head?.inFlight ?? 0) > 0)
}

function board(listing: Listing | undefined) {
  return (listing?.swarms ?? [])
    .filter((swarm) => !Status.test(swarm) && Number(swarm.balance) >= least)
    .sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || Number(b.balance) - Number(a.balance) || b.updatedAt - a.updatedAt)
}

function sown(swarm: Summary, head: Tree.Headline | undefined): Record<Cell, number> {
  const balance = Math.max(0, Number(swarm.balance))
  const count = Math.round(Math.min(44, 8 + 4 * Math.sqrt(balance)))
  if (head) {
    const nodes = Math.max(1, head.proven + head.deadEnds + head.inFlight + head.frontier)
    const proven = Math.round((count * head.proven) / nodes)
    const dead = Math.round((count * head.deadEnds) / nodes)
    const flight = Math.min(count - proven - dead, head.inFlight, 5)
    return { dead, flight, open: count - proven - dead - flight, proven, spent: 0 }
  }
  const spent = balance > 0 ? Math.round(count * Math.min(1, Math.max(0, Number(swarm.spent)) / balance)) : 0
  const flight = live(swarm, head) ? Math.min(count - spent, Math.max(1, Math.min(5, swarm.machines))) : 0
  return { dead: 0, flight, open: count - spent - flight, proven: 0, spent }
}

function useDoing(swarms: readonly Summary[]) {
  const [found, setFound] = useState<Readonly<Record<string, Doing>>>({})
  const key = swarms.map((swarm) => `${swarm.id}:${swarm.updatedAt}`).join()
  useEffect(() => {
    let alive = true
    for (const swarm of swarms)
      Api.tree(swarm.id, { depth: 8 })
        .then((view) => {
          const latest = view.nodes.flatMap((node) => doing(node) ?? []).sort((a, b) => b.at - a.at)[0]
          if (alive && latest) setFound((kept) => ({ ...kept, [swarm.id]: latest }))
        })
        .catch(() => {})
    return () => {
      alive = false
    }
  }, [key])
  return found
}

function told(swarm: Summary, head: Tree.Headline | undefined, said: Doing | undefined): Doing | null {
  if (said) return said
  if (head) return { at: head.lastProvenAt ?? swarm.updatedAt, text: `${head.proven} proven · ${head.inFlight} in flight` }
  return swarm.answer && !swarm.answer.done ? { at: swarm.answer.at, text: lead(swarm.answer.text, swarm.title) } : null
}

function Activity(props: { doing: Doing | undefined; head: Tree.Headline | undefined; now: number; swarm: Summary }) {
  const swarm = props.swarm
  if (swarm.archivedAt) return <span className="lot-line">Archived</span>
  if (!live(swarm, props.head)) return <span className="lot-line">{props.head?.proven ? `${props.head.proven} proven` : Status.pill(Status.word(swarm))}</span>
  const said = told(swarm, props.head, props.doing)
  return (
    <span className="lot-line" data-live="true">
      <span>{said?.text || 'Working now'}</span>
      <time>{ago(said?.at ?? swarm.updatedAt, props.now)}</time>
    </span>
  )
}

function Lot(props: { doing: Doing | undefined; funders: readonly Tree.Funder[]; head: Tree.Headline | undefined; now: number; swarm: Summary }) {
  const swarm = props.swarm
  const working = live(swarm, props.head)
  return (
    <li className="limb lot" data-old={!!swarm.archivedAt || undefined} data-status={working ? 'in flight' : undefined}>
      <Link className="lot-link" to={Nickname.path(swarm)}>
        <Spiral cells={sown(swarm, props.head)} id={swarm.id} live={working} />
        <span className="lot-title">{swarm.title}</span>
        <span className="lot-money">{cash(swarm.balance)}</span>
        <span className="lot-faces"><Faces funders={props.funders} riders={swarm.contributors} /></span>
        <Activity doing={props.doing} head={props.head} now={props.now} swarm={swarm} />
      </Link>
    </li>
  )
}

function count(value: number) {
  return value.toLocaleString('en-US')
}

export function Home() {
  const list = Wire.useSwarms()
  const now = useNow(30_000)
  const [limit, setLimit] = useState(first)
  const items = board(list.data)
  const shown = items.slice(0, limit)
  const hidden = items.slice(limit)
  const heads = list.data?.heads ?? {}
  const said = useDoing(shown.filter((swarm) => swarm.form === 'tree' && live(swarm, heads[swarm.id])))
  const raised = items.reduce((sum, swarm) => sum + Number(swarm.balance), 0)
  const working = items.filter((swarm) => live(swarm, heads[swarm.id])).length
  const riders = list.data?.riders ?? items.reduce((sum, swarm) => sum + swarm.contributors, 0)

  return (
    <div className="home">
      <section className="hero">
        <h1 className="hero-title">Put a few dollars into an AI swarm and watch it work.</h1>
        <dl className="tally-site" data-ready={!!list.data}>
          <div><dt>riders</dt><dd>{count(riders)}</dd></div>
          <div><dt>raised</dt><dd>{cash(String(raised))}</dd></div>
          <div data-live={working > 0}><dt>working now</dt><dd>{count(working)}</dd></div>
        </dl>
      </section>
      <section aria-label="Swarms" className="site-board">
        {list.error && !list.data ? (
          <button className="world-empty" onClick={() => location.reload()} type="button"><span>Can't reach Swarms.</span><b>Tap to try again ↻</b></button>
        ) : (
          <ol className="limbs lots" data-loading={!list.data}>
            {shown.map((swarm) => <Lot doing={said[swarm.id]} funders={list.data?.funders?.[swarm.id] ?? []} head={heads[swarm.id]} key={swarm.id} now={now} swarm={swarm} />)}
            {hidden.length > 0 && (
              <li className="limb limb-more">
                <button onClick={() => setLimit(limit + step)} type="button">See {hidden.length} more<span>{cash(String(hidden.reduce((sum, swarm) => sum + Number(swarm.balance), 0)))}</span></button>
              </li>
            )}
            <li className="limb limb-propose">
              <Link to="/new"><i aria-hidden="true">+</i>Start a swarm<span>$1+</span></Link>
            </li>
          </ol>
        )}
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
