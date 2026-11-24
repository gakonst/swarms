import { type ReactNode, type TouchEvent, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Listing, Summary, TreeView } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Site from '../shared/Site.ts'
import type * as Tree from '../shared/Tree.ts'
import { seeded, server } from './boot.ts'
import { cash } from './Branches.tsx'
import { board, live } from './Home.tsx'
import { Inline } from './Markdown.tsx'
import { Link } from './router.tsx'
import * as Wire from './wire.ts'

const seenKey = 'swarms_seen'

const nothing: Readonly<Record<string, number>> = {}

let seen: Readonly<Record<string, number>> | undefined

const seenWatchers = new Set<() => void>()

function readSeen() {
  if (seen) return seen
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(seenKey) ?? '{}')
    seen = typeof raw === 'object' && raw !== null ? (raw as Record<string, number>) : nothing
  } catch {
    seen = nothing
  }
  return seen
}

function watchSeen(listener: () => void) {
  seenWatchers.add(listener)
  return () => {
    seenWatchers.delete(listener)
  }
}

function visit(id: string, at: number) {
  const known = readSeen()
  if ((known[id] ?? 0) >= at) return
  seen = { ...known, [id]: at }
  try {
    localStorage.setItem(seenKey, JSON.stringify(seen))
  } catch {}
  for (const watcher of seenWatchers) watcher()
}

const shown = 5

const threadWatchers = new Set<() => void>()

const threads = new Map<string, readonly Tree.Node[]>()

const grown = new WeakMap<TreeView, readonly Tree.Node[]>()

function top(nodes: readonly Tree.Node[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return (byId.get('root')?.children ?? []).flatMap((nid) => byId.get(nid) ?? []).sort((a, b) => Number(b.money.subtree.pledged) - Number(a.money.subtree.pledged))
}

function same(a: readonly Tree.Node[], b: readonly Tree.Node[]) {
  return a.length === b.length && a.every((node, index) => node.id === b[index]?.id && node.title === b[index]?.title && node.status === b[index]?.status && node.money.subtree.pledged === b[index]?.money.subtree.pledged)
}

export function share(id: string, nodes: Readonly<Record<string, Tree.Node>>) {
  const next = top(Object.values(nodes))
  const before = threads.get(id) ?? planted(id)
  if (before && same(before, next)) return
  threads.set(id, next)
  for (const watcher of threadWatchers) watcher()
}

function planted(id: string) {
  const view = seeded<TreeView>(`tree:${id}`)
  if (!view) return undefined
  if (server) return top(view.nodes)
  const kept = grown.get(view)
  if (kept) return kept
  const made = top(view.nodes)
  grown.set(view, made)
  return made
}

function watchThreads(listener: () => void) {
  threadWatchers.add(listener)
  return () => {
    threadWatchers.delete(listener)
  }
}

function useThreads(id: string | undefined) {
  return useSyncExternalStore(
    watchThreads,
    () => (id ? (threads.get(id) ?? planted(id)) : undefined),
    () => (id ? planted(id) : undefined),
  )
}

function Threads(props: { base: string; id: string; thread: string | undefined }) {
  const list = useThreads(props.id)
  if (!list?.length) return null
  return (
    <ol aria-label="Threads" className="rail-threads">
      {list.slice(0, shown).map((node) => (
        <li key={node.id}>
          <Link className="rail-thread" data={{ 'data-live': String(node.status === 'in flight' || node.counts['in flight'] > 0) }} lit={props.thread === node.id} to={`${props.base}/t/${node.id}`}>
            <Inline className="rail-thread-name" text={node.title} />
            <span className="rail-thread-money">{cash(node.money.subtree.pledged)}</span>
          </Link>
        </li>
      ))}
      <li>
        <Link className="rail-thread rail-thread-all" to={`${props.base}/board`}>
          {list.length > shown ? `All ${list.length} threads` : 'All threads'}
        </Link>
      </li>
    </ol>
  )
}

function riders(count: number) {
  return `${count.toLocaleString('en-US')} rider${count === 1 ? '' : 's'}`
}

export function channels(listing: Listing | undefined) {
  const heads = listing?.heads ?? {}
  return board(listing).sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || Number(live(b, heads[b.id])) - Number(live(a, heads[a.id])) || Number(b.balance) - Number(a.balance))
}

function Channel(props: { current: boolean; listing: Listing | undefined; swarm: Summary; thread: string | undefined; unread: boolean }) {
  const swarm = props.swarm
  const base = Nickname.path(swarm)
  const working = live(swarm, props.listing?.heads?.[swarm.id])
  return (
    <li>
      <Link
        className="rail-row"
        data={{ 'data-live': String(working), 'data-old': String(!!swarm.archivedAt), 'data-unread': String(props.unread) }}
        label={`${swarm.title}, ${cash(swarm.balance)} from ${riders(swarm.contributors)}${working ? ', working now' : ''}`}
        lit={props.current}
        to={base}
      >
        <i aria-hidden="true" className="rail-hash">#</i>
        <Inline className="rail-name" text={swarm.title} />
        <span className="rail-money">{cash(swarm.balance)}</span>
        <span className="rail-meta">{swarm.archivedAt ? 'Archived' : working ? <><i className="rail-live" />working now</> : riders(swarm.contributors)}</span>
      </Link>
      {props.current && swarm.form === 'tree' && !swarm.archivedAt && <Threads base={base} id={swarm.id} thread={props.thread} />}
    </li>
  )
}

export function Rail(props: { channel: string | undefined; thread: string | undefined }) {
  const list = Wire.useSwarms()
  const known = useSyncExternalStore(watchSeen, readSeen, () => nothing)
  const items = channels(list.data)
  const current = items.find((swarm) => swarm.id === props.channel)
  const raised = items.reduce((sum, swarm) => sum + Number(swarm.balance), 0)

  useEffect(() => {
    if (current) visit(current.id, current.updatedAt)
  }, [current?.id, current?.updatedAt])

  return (
    <nav aria-label="Channels" className="rail">
      <div className="rail-scroll">
        <Link className="rail-row rail-general" lit={props.channel === 'general'} to="/">
          <i aria-hidden="true" className="rail-hash">#</i>
          <span className="rail-name">general</span>
          <span className="rail-meta">Everyone on Swarms</span>
        </Link>
        <p className="rail-label">
          <span>Channels</span>
          <span data-ready={!!list.data}>{items.length} · {cash(String(raised))}</span>
        </p>
        <ol className="rail-list" data-loading={!list.data}>
          {items.map((swarm) => (
            <Channel current={swarm.id === props.channel} key={swarm.id} listing={list.data} swarm={swarm} thread={swarm.id === props.channel ? props.thread : undefined} unread={swarm.id !== props.channel && known[swarm.id] !== undefined && swarm.updatedAt > known[swarm.id]!} />
          ))}
        </ol>
        <Link className="rail-start" to="/new">
          <i aria-hidden="true">+</i>Start a channel<span>$1+</span>
        </Link>
        <Link className="rail-browse" to="/ideas">Browse every channel and idea</Link>
      </div>
      <footer className="rail-foot">
        <Link to="/about">Swarm riders</Link>
        <Link to="/faq">FAQ</Link>
        <Link to="/docs">API</Link>
        <a href={Site.essay}>Swarm riding, by Paradigm</a>
      </footer>
    </nav>
  )
}

const swipe = 56

function held(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, pre, .tabs, .tree-filters, .overlay, .sheet, [data-swipe="off"]')
}

export function useSwipe(handlers: { left?: (() => void) | undefined; right?: (() => void) | undefined }) {
  const start = useRef<{ x: number; y: number } | undefined>(undefined)
  return {
    onTouchCancel: () => {
      start.current = undefined
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const from = start.current
      const touch = event.changedTouches[0]
      start.current = undefined
      event.stopPropagation()
      if (!from || !touch) return
      const dx = touch.clientX - from.x
      const dy = touch.clientY - from.y
      if (Math.abs(dx) < swipe || Math.abs(dx) < Math.abs(dy) * 1.6) return
      if (dx < 0) handlers.left?.()
      else handlers.right?.()
    },
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      event.stopPropagation()
      const touch = event.touches[0]
      start.current = touch && event.touches.length === 1 && !held(event.target) && matchMedia('(max-width: 899px)').matches ? { x: touch.clientX, y: touch.clientY } : undefined
    },
  }
}

export function Shell(props: { channel: string | undefined; children: ReactNode; listing: boolean; onList: (open: boolean) => void; thread: string | undefined }) {
  const swiped = useSwipe(props.listing ? { right: () => props.onList(false) } : { left: () => props.onList(true) })
  return (
    <div className="hub" data-listing={props.listing || undefined} {...swiped}>
      <Rail channel={props.channel} thread={props.thread} />
      <div className="hub-main" inert={props.listing || undefined}>{props.children}</div>
    </div>
  )
}
