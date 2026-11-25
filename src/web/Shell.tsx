import { type ReactNode, type TouchEvent, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Listing, Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Rail from '../shared/Rail.ts'
import * as Site from '../shared/Site.ts'
import { boot } from './boot.ts'
import { cash } from './Branches.tsx'
import { Switcher } from './Switcher.tsx'
import * as Status from '../shared/Status.ts'
import { board, live, stood } from './Home.tsx'
import { Inline } from './Markdown.tsx'
import { Badge } from './Picture.tsx'
import { Link } from './router.tsx'
import { Opener, Palette, useShortcut } from './Search.tsx'
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

const railWatchers = new Set<() => void>()

let rail: Rail.Rail | undefined

function readRail() {
  rail ??= boot()?.rail ?? Rail.parse(document.cookie)
  return rail
}

function servedRail() {
  return boot()?.rail ?? 'collapsed'
}

function watchRail(listener: () => void) {
  railWatchers.add(listener)
  return () => {
    railWatchers.delete(listener)
  }
}

function setRail(next: Rail.Rail) {
  rail = next
  document.cookie = Rail.written(next)
  for (const watcher of railWatchers) watcher()
}

function riders(count: number) {
  return `${count.toLocaleString('en-US')} rider${count === 1 ? '' : 's'}`
}

export function channels(listing: Listing | undefined) {
  const heads = listing?.heads ?? {}
  return board(listing).sort((a, b) => Number(!!a.archivedAt) - Number(!!b.archivedAt) || Number(live(b, heads[b.id])) - Number(live(a, heads[a.id])) || Number(b.balance) - Number(a.balance))
}

function useUnread(items: readonly Summary[], current: string | undefined) {
  const known = useSyncExternalStore(watchSeen, readSeen, () => nothing)
  const now = items.find((swarm) => swarm.id === current)
  useEffect(() => {
    if (now) visit(now.id, now.updatedAt)
  }, [now?.id, now?.updatedAt])
  return (swarm: Summary) => swarm.id !== current && known[swarm.id] !== undefined && swarm.updatedAt > known[swarm.id]!
}

function Servers(props: { current: string | undefined; items: readonly Summary[]; listing: Listing | undefined; rail: Rail.Rail; unread: (swarm: Summary) => boolean }) {
  const heads = props.listing?.heads ?? {}
  const open = props.rail === 'expanded'
  return (
    <nav aria-label="Problems" className="servers">
      <Link className="server server-home" data={{ 'data-live': 'false', 'data-unread': 'false' }} label="Home: #general" lit={props.current === 'general' || props.current === undefined} title="Home" to="/">
        <span aria-hidden="true" className="server-pill"><i>#</i></span>
        <span aria-hidden="true" className="server-text"><span className="server-name">general</span><span className="server-line">Everyone on Swarms</span></span>
      </Link>
      <Opener className="server server-search" label="Search problems and threads">
        <span aria-hidden="true" className="server-pill"><svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg></span>
        <span aria-hidden="true" className="server-text"><span className="server-name">Search</span><span className="server-line">Problems and threads</span></span>
        <kbd aria-hidden="true" className="server-side server-key">⌘K</kbd>
      </Opener>
      <span aria-hidden="true" className="servers-rule" />
      <ol className="servers-list" data-loading={!props.listing}>
        {props.items.map((swarm) => {
          const word = stood(swarm, heads[swarm.id]).word
          const working = word === 'Working'
          const tag = Status.tagged(swarm, word)
          return (
            <li key={swarm.id}>
              <Link
                className="server"
                data={{ 'data-live': String(working), 'data-old': String(!!swarm.archivedAt), 'data-unread': String(props.unread(swarm)) }}
                label={`${swarm.title}, ${cash(swarm.balance)} from ${riders(swarm.contributors)}${tag ? `, ${tag}` : ''}`}
                lit={props.current === swarm.id}
                title={`${swarm.title} · ${cash(swarm.balance)}`}
                to={Nickname.path(swarm)}
              >
                <span className="server-pill"><Badge head={heads[swarm.id]} live={working} swarm={swarm} /></span>
                <span aria-hidden="true" className="server-text"><Inline className="server-name" text={swarm.title} /><Inline className="server-line" text={swarm.goal} /></span>
                <span aria-hidden="true" className="server-side"><span className="server-money">{cash(swarm.balance)}</span><span className="server-state" data-word={word}>{tag ? <>{working && <i className="rail-live" />}{tag}</> : riders(swarm.contributors)}</span></span>
              </Link>
            </li>
          )
        })}
      </ol>
      <Link className="server server-add" label="Start a swarm, $1 or more" title="Start a swarm" to="/new">
        <span aria-hidden="true" className="server-pill"><i>+</i></span>
        <span aria-hidden="true" className="server-text"><span className="server-name">Start a swarm</span><span className="server-line">$1 or more</span></span>
      </Link>
      <div className="servers-end">
        <button aria-expanded={open} aria-label={open ? 'Hide problem details' : 'Show problem details'} className="servers-toggle" onClick={() => setRail(Rail.toggle(props.rail))} title={open ? 'Collapse' : 'Expand'} type="button">
          <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
        </button>
        <Foot />
      </div>
    </nav>
  )
}

function Foot() {
  return (
    <footer className="servers-foot">
      <Link label="Swarm riders" title="Swarm riders" to="/about"><span aria-hidden="true" className="foot-short">Riders</span><span aria-hidden="true" className="foot-long">Swarm riders</span></Link>
      <Link label="FAQ" title="FAQ" to="/faq">FAQ</Link>
      <Link label="API" title="API" to="/docs">API</Link>
      <a aria-label="Swarm riding, by Paradigm" href={Site.essay} title="Swarm riding, by Paradigm"><span aria-hidden="true" className="foot-short">Essay</span><span aria-hidden="true" className="foot-long">Swarm riding, by Paradigm</span></a>
    </footer>
  )
}

const swipe = 56

const edge = 28

function held(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, pre, .tabs, .tree-filters, .overlay, .sheet, [data-swipe="off"]')
}

export function useSwipe(handlers: { edge?: (() => void) | undefined; left?: (() => void) | undefined; right?: (() => void) | undefined }) {
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
      else if (from.x < edge && handlers.edge) handlers.edge()
      else handlers.right?.()
    },
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      event.stopPropagation()
      const touch = event.touches[0]
      start.current = touch && event.touches.length === 1 && !held(event.target) && matchMedia('(max-width: 899px)').matches ? { x: touch.clientX, y: touch.clientY } : undefined
    },
  }
}

export function Shell(props: { channel: string | undefined; children: ReactNode; listing: boolean; onList: (open: boolean) => void }) {
  const swiped = useSwipe(props.listing ? { left: () => props.onList(false) } : { edge: () => props.onList(true) })
  const onList = props.onList
  useEffect(() => {
    if (!props.listing) return
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onList(false)
    }
    addEventListener('keydown', listener)
    return () => removeEventListener('keydown', listener)
  }, [props.listing, onList])
  const list = Wire.useSwarms()
  const items = channels(list.data)
  const unread = useUnread(items, props.channel)
  const rail = useSyncExternalStore(watchRail, readRail, servedRail)
  useShortcut()
  return (
    <div className="hub" data-listing={props.listing || undefined} data-rail={rail} onClick={(event) => props.listing && event.target === event.currentTarget && props.onList(false)} {...swiped}>
      <div className="drawer" id="channels">
        <Servers current={props.channel} items={items} listing={list.data} rail={rail} unread={unread} />
      </div>
      <div className="hub-main" inert={props.listing || undefined}>
        {props.children}
      </div>
      <Switcher current={props.channel} items={items} listing={list.data} unread={unread} />
      <Palette />
    </div>
  )
}
