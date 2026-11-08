import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import * as Status from '../shared/Status.ts'
import { here } from './boot.ts'
import { Field, type Hive } from './Field.tsx'
import { ago, usd } from './format.ts'
import { open, problems } from './research.ts'
import { href, Link, navigate, prefetch } from './router.tsx'
import * as Wire from './wire.ts'

const order = { running: 0, paused: 1, funding: 2, done: 3 } as const

const openIdeas = open

const filters = [
  ['open', 'Explore'],
  ['following', 'Following'],
  ['running', 'Running'],
  ['resting', 'Resting'],
  ['waiting', 'Not started'],
  ['money', 'Needs money'],
] as const

type Filter = (typeof filters)[number][0]

const aliases: Record<string, Filter> = { fuel: 'money', live: 'running' }

const fits: Record<Filter, (swarm: Summary) => boolean> = {
  following: () => true,
  money: (swarm) => Status.word(swarm) === 'Needs money',
  open: (swarm) => swarm.status !== 'done',
  resting: (swarm) => Status.word(swarm) === 'Resting' || Status.word(swarm) === 'Stopped after errors',
  running: (swarm) => swarm.status === 'running',
  waiting: (swarm) => Status.word(swarm) === 'Not started' || Status.word(swarm) === 'Starting',
}

function sorted(swarms: readonly Summary[] | undefined) {
  return [...(swarms ?? [])].filter((swarm) => !/operator test|headless check|channel check|audit fixes check|second audit check|template check|settle check|start exactly two subagents|stop stays stopped|steer and stop check|branch budget check|channel open check/i.test(swarm.title)).sort((a, b) => order[a.status] - order[b.status] || b.createdAt - a.createdAt)
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
        <span className="tile-raised">{swarm.contributors} backer{swarm.contributors === 1 ? "" : "s"} · {usd(swarm.raised)}</span>
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
    <span className="sky-title">
      {words.join(' ')} <span className="sky-last">{last}<span aria-hidden="true" className="sky-arrow">→</span></span>
    </span>
  )
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

function facts(swarm: Summary, now: number | undefined) {
  return [plural(swarm.contributors, 'backer'), Number(swarm.spent) > 0 ? `${usd(swarm.spent)} spent` : '', now ? `updated ${ago(swarm.updatedAt, now)}` : ''].filter(Boolean).join(' · ')
}

function follow(event: MouseEvent, path: string | undefined) {
  if (!path || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  event.stopPropagation()
  navigate(path)
}

export function Home() {
  const list = Wire.useSwarms()
  const swarms = sorted(list.data?.swarms)
  const open = swarms.filter((swarm) => swarm.status !== 'done')
  const counted = Status.count(swarms)
  const latest = Math.max(0, ...swarms.map((swarm) => swarm.updatedAt))
  const ranked = Status.ranked(open.length ? open : swarms, latest)
  const free = list.data ? openIdeas(swarms) : problems
  const sky = useRef<HTMLDivElement>(null)
  const start = useRef<HTMLDivElement>(null)
  const join = useRef<HTMLDivElement>(null)
  const tags = useRef<HTMLDivElement>(null)
  const legend = useRef<HTMLElement>(null)
  const [focus, setFocus] = useState<string>()
  const [lit, setLit] = useState<string>()
  const [group, setGroup] = useState<Status.Mood>()
  const [flat, setFlat] = useState(false)
  const [now, setNow] = useState<number>()
  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const hives = useMemo<Hive[]>(
    () => {
      const clock = now ?? latest
      const joins = ranked.slice(0, 52).map(
        (item): Hive => ({
          about: (item.answer && Answer.gist(item.answer.text)) || item.goal,
          detail: `${Status.word(item)} · ${usd(item.raised)}`,
          facts: facts(item, now),
          fresh: item.status === 'running' ? 1 : 1 / (1 + Math.max(0, clock - item.updatedAt) / 86_400_000),
          home: 'join',
          id: item.id,
          mood: Status.standing(item).mood,
          title: item.title,
          updated: item.updatedAt,
          weight: Number(item.raised),
        }),
      )
      const seeds = free.slice(0, 12).map((item): Hive => ({ about: item.title, detail: item.hint, facts: 'No swarm yet · start one', fresh: 0.35, home: 'start', id: `idea:${item.id}`, mood: 'new', title: item.label, updated: 0, weight: 0 }))
      return joins.flatMap((hive, index) => (index % 4 === 3 && seeds.length ? [hive, seeds.shift()!] : [hive])).concat(seeds)
    },
    [ranked.map((item) => [item.id, item.status, item.why, item.raised, item.remaining, item.spent, item.contributors, item.updatedAt, item.title, item.answer?.text.length].join()).join('|'), free.map((item) => item.id).join(), now],
  )
  const moods = open.reduce<Record<Status.Mood, number>>((sum, item) => ({ ...sum, [Status.standing(item).mood]: sum[Status.standing(item).mood] + 1 }), { errors: 0, live: 0, money: 0, new: free.length, resting: 0 })
  const keys = (
    [
      ['live', `${moods.live} running`, '/join?filter=running'],
      ['money', `${moods.money} need${moods.money === 1 ? 's' : ''} money`, '/join?filter=money'],
      ['resting', `${moods.resting} resting`, '/join?filter=resting'],
      ['errors', `${moods.errors} stopped`, '/join?filter=resting'],
      ['new', `${moods.new} waiting`, '/new'],
    ] as const
  ).filter(([mood]) => list.data && moods[mood] > 0)
  const path = (id: string) => (id.startsWith('idea:') ? `/new?q=${id.slice(5)}` : `/s/${id}`)
  const tagged = hives.slice(0, 24)

  return (
    <div className="sky" data-active={focus ?? lit} data-group={group} data-lit={!!lit} onClickCapture={(event) => follow(event, lit && path(lit))} ref={sky}>
      <Field avoid={legend} focus={focus} group={group} hives={hives} homes={{ join, start }} ignore=".sky-block, .sky-tag, .sky-flat, .sky-key" onFail={() => setFlat(true)} onPick={setLit} surface={sky} tags={tags} />
      <div className="sky-block sky-start" ref={start}>
        <Link className="sky-link" to="/new">
          <span className="sky-kicker">{Status.ideas(free.length)}</span>
          <Title text="Start a breakthrough" />
          <span className="sky-text">Give a big idea a team of AI researchers. They explore different approaches, build and test in public, and show what worked, what failed, and what’s next.</span>
        </Link>
      </div>
      <div className="sky-block sky-join" ref={join}>
        <Link className="sky-link" to="/join">
          <span className="sky-kicker">
            {counted.running > 0 && <i className="chip-live" />}
            {!list.data ? (list.error ? 'Offline' : 'Looking…') : counted.text}
          </span>
          <Title text="Be part of the future" />
          <span className="sky-text">Find a mission you care about. Chip in with others, follow the discoveries, and help shape what happens next. No expertise needed. Your money funds the work; every contribution is visible.</span>
        </Link>
      </div>
      <nav aria-label="Key" className="sky-key" ref={legend}>
        {keys.map(([mood, label, to]) => (
          <Link className="sky-key-item" data={{ 'data-mood': mood }} key={mood} lit={group === mood} onHover={(hovering) => setGroup(hovering ? mood : undefined)} to={to}>
            <i aria-hidden="true" className="mood-dot" data-mood={mood} />
            {label}
          </Link>
        ))}
      </nav>
      <nav aria-label="Swarms and ideas" className="sky-tags" ref={tags}>
        {tagged.map((hive) => (
          <Link className="sky-tag" data={{ 'data-mood': hive.mood, 'data-tag': hive.id }} key={hive.id} lit={lit === hive.id} onHover={(hovering) => setFocus(hovering ? hive.id : undefined)} to={path(hive.id)}>
            <b>{hive.title}</b>
            <small>{hive.detail}</small>
          </Link>
        ))}
      </nav>
      {flat && (
        <div className="sky-flat">
          {tagged.slice(0, 6).map((hive) => (
            <Link className="sky-chip" key={hive.id} to={path(hive.id)}>
              {hive.title}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

export function Join() {
  const list = Wire.useSwarms()
  const [following, setFollowing] = useState<string[]>([])
  useEffect(() => {
    try { setFollowing(Object.keys(localStorage).filter((key) => key.startsWith('following:')).map((key) => key.slice(10))) } catch {}
  }, [])
  const [start] = useState(asked)
  const [filter, setFilter] = useState<Filter>(start.filter)
  const [picked, setPicked] = useState<string | undefined>(start.open)
  const swarms = sorted(list.data?.swarms)
  const shown = swarms.filter((swarm) => filter === 'following' ? following.includes(swarm.id) : fits[filter](swarm))
  const count = (key: Filter) => swarms.filter((swarm) => key === 'following' ? following.includes(swarm.id) : fits[key](swarm)).length
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
            <span>{filter === 'following' ? 'Follow a mission to find it here on this device.' : filter === 'resting' ? 'Nothing resting right now.' : filter === 'money' ? 'Every swarm has money.' : filter === 'running' ? 'Nothing running right now.' : filter === 'waiting' ? 'Nothing waiting to start.' : 'No swarms yet.'}</span>
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
