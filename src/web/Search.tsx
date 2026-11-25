import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Listing, Summary, TreeView } from '../shared/Api.ts'
import * as Fuzzy from '../shared/Fuzzy.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Prose from '../shared/Prose.ts'
import * as Status from '../shared/Status.ts'
import type * as Tree from '../shared/Tree.ts'
import { cash } from './Branches.tsx'
import * as Api from './api.ts'
import { type Shape, shareTree, useShapes } from './channels.ts'
import * as Local from './local.ts'
import { stood } from './Home.tsx'
import { Badge } from './Picture.tsx'
import { Link, navigate, prefetch, usePath } from './router.tsx'
import { channels } from './Shell.tsx'
import { Mark, word as said } from './Tree.tsx'
import * as Wire from './wire.ts'

export type Found =
  | { at: 'problem'; exact: boolean; key: string; marks: readonly number[]; score: number; swarm: Summary; title: string; to: string; under: string; underMarks: readonly number[] }
  | { at: 'thread'; exact: boolean; key: string; live: boolean; marks: readonly number[]; money: string; score: number; status: Tree.Status; swarm: Summary; title: string; to: string; under: string; underMarks: readonly number[] }

const most = { problems: 8, rest: 6 }

const reach = 600

function excerpt(text: string, marks: readonly number[]) {
  const first = marks[0] ?? 0
  const start = first > 40 ? text.lastIndexOf(' ', first - 30) + 1 : 0
  const end = Math.min(text.length, start + 140)
  return { marks: marks.filter((at) => at >= start && at < end).map((at) => at - start), text: (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : ''), shift: start > 0 ? 1 : 0 }
}

function goalOf(swarm: Summary) {
  const goal = Prose.plain(Prose.line(swarm.goal)).slice(0, reach)
  return Fuzzy.same(goal, Prose.plain(swarm.title)) ? '' : goal
}

export function find(query: string, listing: Listing | undefined, shapes: readonly (readonly [string, Shape])[]): Found[] {
  const swarms = channels(listing)
  const ask = query.trim()
  if (!ask) {
    return swarms
      .filter((swarm) => !swarm.archivedAt)
      .slice(0, most.problems)
      .map((swarm) => ({ at: 'problem', exact: true, key: swarm.id, marks: [], score: 0, swarm, title: Prose.plain(swarm.title), to: Nickname.path(swarm), under: goalOf(swarm), underMarks: [] }))
  }
  const problems: Found[] = []
  for (const swarm of swarms) {
    const title = Prose.plain(swarm.title)
    const goal = goalOf(swarm)
    const named = Fuzzy.match(ask, title)
    const said = named ? undefined : Fuzzy.match(ask, goal)
    if (!named && !said) continue
    const shown = said ? excerpt(goal, said.marks) : { marks: [], shift: 0, text: goal }
    problems.push({
      at: 'problem',
      exact: (named ?? said)!.exact,
      key: swarm.id,
      marks: named?.marks ?? [],
      score: (named ? named.score : said!.score * 0.4) - (swarm.archivedAt ? 40 : 0),
      swarm,
      title,
      to: Nickname.path(swarm),
      under: shown.text,
      underMarks: shown.marks.map((at) => at + shown.shift),
    })
  }
  const bySwarm = new Map(swarms.map((swarm) => [swarm.id, swarm]))
  const rest: Found[] = []
  for (const [id, shape] of shapes) {
    const swarm = bySwarm.get(id)
    if (!swarm) continue
    const base = Nickname.path(swarm)
    const under = Prose.plain(swarm.title)
    for (const thread of shape.threads) {
      const named = Prose.plain(thread.title)
      const found = Fuzzy.match(ask, named)
      if (found) rest.push({ at: 'thread', exact: found.exact, key: `${id}/t/${thread.id}`, live: thread.live, marks: found.marks, money: thread.money, score: found.score * 0.85, status: thread.status, swarm, title: named, to: `${base}/t/${thread.id}`, under, underMarks: [] })
    }
  }
  const strict = problems.some((each) => each.exact) || rest.some((each) => each.exact)
  const ranked = (list: Found[], cap: number) => list.filter((each) => each.exact || !strict).sort((a, b) => b.score - a.score).slice(0, cap)
  return [...ranked(problems, most.problems), ...ranked(rest, most.rest)]
}

const gathered = new Set<string>()

function gather(swarms: readonly Summary[], known: readonly (readonly [string, Shape])[]) {
  const held = new Set(known.map(([id]) => id))
  for (const swarm of swarms.filter((each) => !each.archivedAt).slice(0, most.problems)) {
    if (held.has(swarm.id) || gathered.has(swarm.id)) continue
    gathered.add(swarm.id)
    const id = swarm.id
    if (swarm.form !== 'tree') continue
    const key = `tree:${id}`
    const kept = Local.fresh(key) ? Local.value<TreeView>(key) : undefined
    void (kept ? Promise.resolve(kept) : Local.load(key, () => Api.tree(id, { depth: 2 }))).then((view) => shareTree(id, Object.fromEntries(view.nodes.map((node) => [node.id, node]))), () => gathered.delete(id))
  }
}

export function useFound(query: string) {
  const list = Wire.useSwarms()
  const shapes = useShapes()
  const asking = query.trim().length > 0
  useEffect(() => {
    if (asking && list.data) gather(channels(list.data), shapes)
  }, [asking, list.data])
  return { found: useMemo(() => find(query, list.data, shapes), [query, list.data, shapes]), listing: list.data }
}

function Lit(props: { className: string; marks: readonly number[]; text: string }) {
  if (!props.marks.length) return <span className={props.className}>{props.text}</span>
  return (
    <span className={props.className}>
      {Fuzzy.spans(props.text, props.marks).map((part, index) => (part.lit ? <mark key={index}>{part.text}</mark> : part.text))}
    </span>
  )
}

function riders(count: number) {
  return `${count.toLocaleString('en-US')} rider${count === 1 ? '' : 's'}`
}


function Row(props: { active: boolean; found: Found; id: string; listing: Listing | undefined; onPick: () => void; onPoint: () => void }) {
  const found = props.found
  const head = props.listing?.heads?.[found.swarm.id]
  const word = found.at === 'problem' ? stood(found.swarm, head).word : undefined
  const tag = word ? Status.tagged(found.swarm, word) : undefined
  return (
    <li aria-selected={props.active} className="find-row" data-active={props.active || undefined} id={props.id} onClickCapture={props.onPick} onPointerMove={props.onPoint} role="option">
      <Link className="find-link" data={{ 'data-at': found.at }} to={found.to}>
        <span aria-hidden="true" className="find-icon">
          {found.at === 'problem' ? <Badge head={head} live={word === 'Working'} swarm={found.swarm} /> : <Mark status={found.status} />}
        </span>
        <span className="find-text">
          <Lit className="find-title" marks={found.marks} text={found.title} />
          {found.under && <Lit className="find-under" marks={found.underMarks} text={found.under} />}
        </span>
        <span className="find-side">
          <span className="find-money">{cash(found.at === 'problem' ? found.swarm.balance : found.money)}</span>
          <span className="find-state" data-word={word} data-status={found.at === 'problem' ? undefined : found.status}>
            {found.at === 'problem' ? (tag ? <>{word === 'Working' && <i className="rail-live" />}{tag}</> : riders(found.swarm.contributors)) : said(found.status)}
          </span>
        </span>
      </Link>
    </li>
  )
}

export function useCursor(found: readonly Found[], query: string) {
  const [active, setActive] = useState(0)
  useEffect(() => setActive(0), [query])
  const clamped = found.length ? Math.min(active, found.length - 1) : -1
  const keys = (event: KeyboardEvent<HTMLInputElement>, onEscape?: () => void) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!found.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((clamped + step + found.length) % found.length)
    } else if (event.key === 'Enter') {
      const picked = found[clamped]
      if (!picked) return
      event.preventDefault()
      navigate(picked.to)
    } else if (event.key === 'Escape' && onEscape) {
      event.preventDefault()
      onEscape()
    }
  }
  useEffect(() => {
    const picked = found[clamped]
    if (picked) prefetch(picked.to)
  }, [found[clamped]?.to])
  return { active: clamped, keys, setActive }
}

export function Results(props: { active: number; empty?: ReactNode; found: readonly Found[]; id: string; label: string; listing: Listing | undefined; onPick?: () => void; onPoint: (index: number) => void }) {
  const list = useRef<HTMLOListElement>(null)
  useEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [props.active])
  if (!props.found.length) return <>{props.empty}</>
  const split = props.found.findIndex((each) => each.at !== 'problem')
  return (
    <ol aria-label={props.label} className="find-list" id={props.id} ref={list} role="listbox">
      {props.found.map((found, index) => (
        <Fragmented first={index === split} key={found.key}>
          <Row active={index === props.active} found={found} id={`${props.id}-${index}`} listing={props.listing} onPick={() => props.onPick?.()} onPoint={() => props.onPoint(index)} />
        </Fragmented>
      ))}
    </ol>
  )
}

function Fragmented(props: { children: ReactNode; first: boolean }) {
  return (
    <>
      {props.first && <li aria-hidden="true" className="find-label" role="presentation">Channels and threads</li>}
      {props.children}
    </>
  )
}

let opened = false

const openWatchers = new Set<() => void>()

function watchOpen(listener: () => void) {
  openWatchers.add(listener)
  return () => {
    openWatchers.delete(listener)
  }
}

export function show(next: boolean) {
  if (opened === next) return
  opened = next
  for (const watcher of openWatchers) watcher()
}

export function useShortcut() {
  useEffect(() => {
    const listener = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        show(!opened)
      }
    }
    addEventListener('keydown', listener)
    return () => removeEventListener('keydown', listener)
  }, [])
}

export function Palette() {
  const open = useSyncExternalStore(watchOpen, () => opened, () => false)
  const path = usePath()
  const first = useRef(path)
  useEffect(() => {
    if (path !== first.current) show(false)
    first.current = path
  }, [path])
  return open ? <Sheet /> : null
}

function Sheet() {
  const [query, setQuery] = useState('')
  const { found, listing } = useFound(query)
  const cursor = useCursor(found, query)
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    return () => back?.focus?.()
  }, [])
  return (
    <div className="find-scrim" onPointerDown={(event) => event.target === event.currentTarget && show(false)}>
      <div aria-label="Search problems" aria-modal="true" className="find" role="dialog">
        <label className="find-field">
          <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
          <input
            aria-activedescendant={cursor.active >= 0 ? `${id}-${cursor.active}` : undefined}
            aria-autocomplete="list"
            aria-controls={id}
            aria-expanded="true"
            aria-label="Search problems and threads"
            autoComplete="off"
            enterKeyHint="go"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => cursor.keys(event, () => show(false))}
            placeholder="Search problems and threads"
            ref={input}
            role="combobox"
            spellCheck={false}
            type="search"
            value={query}
          />
          <button aria-label="Close search" className="find-close" onClick={() => show(false)} type="button"><kbd>esc</kbd><span>Cancel</span></button>
        </label>
        <Results
          active={cursor.active}
          empty={<NoMatch query={query} />}
          found={found}
          id={id}
          label={query.trim() ? 'Matches' : 'Top problems'}
          listing={listing}
          onPick={() => show(false)}
          onPoint={cursor.setActive}
        />
      </div>
    </div>
  )
}

export function NoMatch(props: { query: string }) {
  const asked = props.query.trim()
  return (
    <div className="find-none">
      <p>{asked ? <>Nothing matches <b>{asked}</b> yet.</> : 'No problems yet.'}</p>
      <Link className="btn btn-high find-start" to={asked ? `/new?q=${encodeURIComponent(asked)}` : '/new'}>Start a swarm<span>$1+</span></Link>
    </div>
  )
}

export function Opener(props: { className: string; children: ReactNode; label?: string }) {
  return (
    <button aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K" aria-label={props.label} className={props.className} onClick={() => show(true)} type="button">
      {props.children}
    </button>
  )
}
