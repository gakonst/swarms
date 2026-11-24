import { type ReactNode, type TouchEvent, useEffect, useRef, useSyncExternalStore } from 'react'
import type { Detail, Listing, Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Site from '../shared/Site.ts'
import { seeded } from './boot.ts'
import { cash } from './Branches.tsx'
import { type Channel as Room, holding, type Thread, useShape } from './channels.ts'
import { Spiral } from './Field.tsx'
import { Switcher } from './Switcher.tsx'
import * as Status from '../shared/Status.ts'
import { board, live, sown, stood } from './Home.tsx'
import { Inline } from './Markdown.tsx'
import { Link } from './router.tsx'
import { useLive } from './Share.tsx'
import { Mark } from './Tree.tsx'
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

const shown = 4

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

function Servers(props: { current: string | undefined; items: readonly Summary[]; listing: Listing | undefined; unread: (swarm: Summary) => boolean }) {
  const heads = props.listing?.heads ?? {}
  return (
    <nav aria-label="Problems" className="servers">
      <Link className="server server-home" data={{ 'data-live': 'false', 'data-unread': 'false' }} label="Home: #general" lit={props.current === 'general' || props.current === undefined} title="Home" to="/">
        <i aria-hidden="true">#</i>
      </Link>
      <span aria-hidden="true" className="servers-rule" />
      <ol className="servers-list" data-loading={!props.listing}>
        {props.items.map((swarm) => {
          const word = stood(swarm, heads[swarm.id]).word
          const working = word === 'Working'
          const tag = Status.tag(word)
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
                <Spiral cells={sown(swarm, heads[swarm.id])} id={swarm.id} live={working} />
              </Link>
            </li>
          )
        })}
      </ol>
      <Link className="server server-add" label="Start a problem, $1 or more" title="Start a problem" to="/new">
        <i aria-hidden="true">+</i>
      </Link>
    </nav>
  )
}

function Foot() {
  return (
    <footer className="rail-foot">
      <Link to="/about">Swarm riders</Link>
      <Link to="/faq">FAQ</Link>
      <Link to="/docs">API</Link>
      <a href={Site.essay}>Swarm riding, by Paradigm</a>
    </footer>
  )
}

function Home(props: { channel: string | undefined; items: readonly Summary[]; listing: Listing | undefined; unread: (swarm: Summary) => boolean }) {
  const raised = props.items.reduce((sum, swarm) => sum + Number(swarm.balance), 0)
  const heads = props.listing?.heads ?? {}
  return (
    <nav aria-label="Channels" className="rail">
      <header className="side-head">
        <b>Swarms</b>
        <span className="side-meta" data-ready={!!props.listing}>{props.items.length} problems · {cash(String(raised))}</span>
      </header>
      <div className="rail-scroll">
        <Link className="rail-row rail-general" lit={props.channel === 'general'} to="/">
          <i aria-hidden="true" className="rail-hash">#</i>
          <span className="rail-name">general</span>
          <span className="rail-meta">Everyone on Swarms</span>
        </Link>
        <Link className="rail-start" to="/new">
          <i aria-hidden="true">+</i>Start a problem<span>$1+</span>
        </Link>
        <p className="rail-label"><span>Problems</span></p>
        <ol className="rail-list" data-loading={!props.listing}>
          {props.items.map((swarm) => {
            const word = stood(swarm, heads[swarm.id]).word
            const working = word === 'Working'
            const tag = Status.tag(word)
            return (
              <li key={swarm.id}>
                <Link
                  className="rail-row rail-problem"
                  data={{ 'data-live': String(working), 'data-old': String(!!swarm.archivedAt), 'data-unread': String(props.unread(swarm)) }}
                  label={`${swarm.title}, ${cash(swarm.balance)} from ${riders(swarm.contributors)}${tag ? `, ${tag}` : ''}`}
                  to={Nickname.path(swarm)}
                >
                  <Spiral cells={sown(swarm, heads[swarm.id])} id={swarm.id} live={working} />
                  <Inline className="rail-name" text={swarm.title} />
                  <span className="rail-money">{cash(swarm.balance)}</span>
                  <span className="rail-meta" data-word={word}>{tag ? <>{working && <i className="rail-live" />}{tag}</> : riders(swarm.contributors)}</span>
                </Link>
              </li>
            )
          })}
        </ol>
        <Link className="rail-browse" to="/ideas">Browse every problem and idea</Link>
      </div>
      <Foot />
    </nav>
  )
}

function ThreadRow(props: { base: string; leaf: 't' | 'c'; lit: boolean; thread: Thread }) {
  const thread = props.thread
  return (
    <li>
      <Link className="rail-thread" data={{ 'data-live': String(thread.live) }} lit={props.lit} to={`${props.base}/${props.leaf}/${thread.id}`}>
        <Mark checking={thread.checking} status={thread.status} />
        <Inline className="rail-thread-name" text={thread.title} />
        {Number(thread.money) > 0 && <span className="rail-thread-money">{cash(thread.money)}</span>}
        {thread.doing && <Inline className="rail-thread-doing" text={thread.doing} />}
      </Link>
    </li>
  )
}

function ChannelRow(props: { base: string; channel: Room; leaf: 't' | 'c'; lit: boolean; open: boolean; thread: string | undefined }) {
  const channel = props.channel
  const threads = props.open ? channel.threads : channel.threads.slice(0, shown)
  const rest = channel.threads.length - threads.length
  return (
    <li>
      <Link className="rail-row rail-channel" data={{ 'data-live': String(channel.live) }} lit={props.lit} to={`${props.base}/c/${channel.id}`}>
        <i aria-hidden="true" className="rail-hash">#</i>
        <Inline className="rail-name" text={channel.title} />
        {Number(channel.money) > 0 && <span className="rail-money">{cash(channel.money)}</span>}
      </Link>
      {threads.length > 0 && (
        <ol aria-label="Threads" className="rail-threads">
          {threads.map((each) => <ThreadRow base={props.base} key={each.id} leaf={props.leaf} lit={props.thread === each.id} thread={each} />)}
          {rest > 0 && (
            <li>
              <Link className="rail-thread rail-thread-all" to={`${props.base}/c/${channel.id}`}>{rest} more</Link>
            </li>
          )}
        </ol>
      )}
    </li>
  )
}

function SwarmSide(props: { general: boolean; id: string; room: string | undefined; swarm: Summary | undefined; thread: string | undefined; word: Status.Word | undefined }) {
  const shape = useShape(props.id)
  const swarm = props.swarm
  const base = swarm ? Nickname.path(swarm) : `/s/${encodeURIComponent(props.id)}`
  const held = (shape?.form === 'agent' ? holding(shape, props.room)?.id : props.room) ?? holding(shape, props.thread)?.id
  const inside = props.thread ?? (shape?.form === 'agent' ? props.room : undefined)
  const list = shape?.channels ?? []
  const spent = list.reduce((sum, channel) => sum + Number(channel.money), 0)
  return (
    <nav aria-label="Channels" className="rail">
      <header className="side-head">
        {swarm ? <Inline className="side-title" text={swarm.title} /> : <b className="side-title" />}
        <span className="side-meta" data-ready={!!swarm}>{swarm ? <>{cash(swarm.balance)} · {riders(swarm.contributors)}{props.word && Status.tag(props.word) && <> · {props.word === 'Working' && <i className="rail-live" />}{Status.tag(props.word)}</>}</> : ' '}</span>
      </header>
      <div className="rail-scroll">
        <Link className="rail-row rail-general" lit={props.general && !held && !props.thread} to={base}>
          <i aria-hidden="true" className="rail-hash">#</i>
          <span className="rail-name">general</span>
          <span className="rail-meta">Riders and the lead</span>
        </Link>
        {list.length > 0 && (
          <>
            <p className="rail-label">
              <span>{shape?.form === 'tree' ? 'Programs' : 'Branches'}</span>
              <span>{list.length}{spent > 0 && <> · {cash(String(spent))}{shape?.form === 'agent' ? ' spent' : ''}</>}</span>
            </p>
            <ol className="rail-list">
              {list.map((channel) => <ChannelRow base={base} channel={channel} key={channel.id} leaf={shape?.form === 'tree' ? 't' : 'c'} lit={held === channel.id && !channel.threads.some((each) => each.id === inside)} open={held === channel.id} thread={inside} />)}
            </ol>
          </>
        )}
        <Link className="rail-browse" to="/">‹ #general on Swarms</Link>
      </div>
      <Foot />
    </nav>
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

export function Shell(props: { channel: string | undefined; children: ReactNode; general: boolean; listing: boolean; onList: (open: boolean) => void; room: string | undefined; thread: string | undefined }) {
  const swiped = useSwipe(props.listing ? { right: () => props.onList(false) } : { edge: () => props.onList(true), left: () => props.onList(true) })
  const list = Wire.useSwarms()
  const items = channels(list.data)
  const unread = useUnread(items, props.channel)
  const id = props.channel !== 'general' ? props.channel : undefined
  const shown = useLive(id)
  const swarm = id ? (shown ?? list.data?.swarms.find((each) => each.id === id) ?? seeded<Detail>(id)) : undefined
  return (
    <div className="hub" data-listing={props.listing || undefined} onClick={(event) => props.listing && event.target === event.currentTarget && props.onList(false)} {...swiped}>
      <div className="drawer">
        <Servers current={props.channel} items={items} listing={list.data} unread={unread} />
        {id ? <SwarmSide general={props.general} id={id} key={id} room={props.room} swarm={swarm} thread={props.thread} word={swarm && stood(swarm, list.data?.heads?.[id]).word} /> : <Home channel={props.channel} items={items} listing={list.data} unread={unread} />}
      </div>
      <div className="hub-main" inert={props.listing || undefined}>{props.children}</div>
      <Switcher current={props.channel} items={items} listing={list.data} onList={props.onList} unread={unread} />
    </div>
  )
}
