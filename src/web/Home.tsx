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

const order = { running: 0, paused: 1, funding: 2, done: 3 } as const

const filters = [
  ['open', 'All'],
  ['running', 'Working now'],
  ['money', 'Needs funding'],
  ['waiting', 'New'],
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
  const swarms = sorted(list.data?.swarms)
  const open = swarms.filter((swarm) => swarm.status !== 'done')
  const latest = Math.max(0, ...swarms.map((swarm) => swarm.updatedAt))
  const ranked = Status.ranked(open, latest)
  const free = list.data ? openProblems(swarms) : list.error ? [...problems] : []
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
  const copy = useRef<HTMLDivElement>(null)
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
        facts: [plural(item.contributors, 'backer'), now ? `updated ${ago(item.updatedAt, now)}` : ''].filter(Boolean).join(' · '),
        fresh: item.status === 'running' ? 1 : 1 / (1 + Math.max(0, clock - item.updatedAt) / 86_400_000),
        home: 'join',
        id: item.id,
        mood: Status.standing(item).mood,
        title: item.title,
        updated: item.updatedAt,
        weight: Number(item.balance),
      }),
    )
    const seeds = free.slice(0, 10).map((item): Hive => ({ about: item.hint, detail: 'New idea', facts: 'Be the first backer', fresh: 0.35, home: 'start', id: `idea:${item.id}`, mood: 'new', title: item.label, updated: 0, weight: 0 }))
    return joins.concat(seeds)
  }, [ranked.map((item) => [item.id, item.status, item.why, item.balance, item.contributors, item.updatedAt, item.answer?.text.length].join()).join('|'), free.map((item) => item.id).join(), now])
  const working = open.filter((swarm) => swarm.status === 'running').length
  const balance = open.reduce((sum, swarm) => sum + Number(swarm.balance), 0)
  const shown = ideas.filter((idea) => (view === 'live' ? fits.running(idea) : view === 'new' ? fits.waiting(idea) : true)).slice(0, 12)
  const path = (id: string) => (id.startsWith('idea:') ? `/new?q=${id.slice(5)}` : `/s/${id}`)
  const tabs = [['popular', 'Popular'], ['live', 'Working now'], ['new', 'New ideas']] as const

  return (
    <div className="home">
      <section className="hero" data-lit={!!lit} onClickCapture={(event) => follow(event, lit && path(lit))} ref={sky}>
        <Field hives={hives} homes={{ start: copy }} ignore=".hero-copy" onPick={setLit} surface={sky} />
        <div className="hero-copy" ref={copy}>
          <h1>Back an idea.<br />AI builds it.</h1>
          <p>Chip in a few dollars. AI agents get to work, in public.</p>
          <p className="hero-live" data-ready={!!list.data}>
            {working > 0 && <><i className="live-dot" />{working} working now · </>}
            {plural(ideas.length, 'idea')}{balance > 0 && <> · {usd(String(balance))} balance</>}
          </p>
        </div>
      </section>
      <section aria-labelledby="ideas-title" className="shelf">
        <header className="shelf-head">
          <h2 id="ideas-title">Pick an idea to back</h2>
          <div aria-label="Show" className="chips" role="tablist">
            {tabs.map(([key, label]) => <button aria-selected={view === key} className="chip" key={key} onClick={() => setView(key)} role="tab" type="button">{label}</button>)}
          </div>
        </header>
        {list.error && !list.data ? (
          <button className="world-empty" onClick={() => location.reload()} type="button"><span>Can't reach Swarms.</span><b>Tap to try again ↻</b></button>
        ) : (
          <Grid ideas={shown} loading={!list.data && !list.error} />
        )}
        <Link className="shelf-more" to="/ideas">See all {list.data ? plural(ideas.length, 'idea') : 'ideas'} →</Link>
      </section>
      <section aria-label="How it works" className="steps">
        <ol>
          <li><b>1</b><span>Pick an idea</span></li>
          <li><b>2</b><span>Chip in a few dollars</span></li>
          <li><b>3</b><span>Read what AI finds</span></li>
        </ol>
      </section>
      <section className="own">
        <h2>Got an idea?</h2>
        <Link className="btn btn-high own-go" to="/new">Start an idea</Link>
      </section>
    </div>
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
        <h1>All ideas</h1>
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
          <span>{filter === 'running' ? 'Nothing is working right now.' : filter === 'money' ? 'Every idea has money.' : 'Nothing here yet.'}</span>
          <b>Start an idea →</b>
        </Link>
      ) : (
        <Grid ideas={shown} loading={!list.data} />
      )}
    </div>
  )
}
