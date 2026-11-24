import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Listing, Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Status from '../shared/Status.ts'
import { cash } from './Branches.tsx'
import { Spiral } from './Field.tsx'
import { sown, stood } from './Home.tsx'
import { Inline } from './Markdown.tsx'
import { Link } from './router.tsx'

const recentKey = 'swarms_recent'

const none: readonly string[] = []

let recent: readonly string[] | undefined

const watchers = new Set<() => void>()

function readRecent() {
  if (recent) return recent
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]')
    recent = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : none
  } catch {
    recent = none
  }
  return recent
}

function watchRecent(listener: () => void) {
  watchers.add(listener)
  return () => {
    watchers.delete(listener)
  }
}

function remember(id: string) {
  const known = readRecent()
  if (known[0] === id) return
  recent = [id, ...known.filter((each) => each !== id)].slice(0, 24)
  try {
    localStorage.setItem(recentKey, JSON.stringify(recent))
  } catch {}
  for (const watcher of watchers) watcher()
}

function never() {
  return () => {}
}

function riders(count: number) {
  return `${count.toLocaleString('en-US')} rider${count === 1 ? '' : 's'}`
}

export function Switcher(props: { current: string | undefined; items: readonly Summary[]; listing: Listing | undefined; unread: (swarm: Summary) => boolean }) {
  const known = useSyncExternalStore(watchRecent, readRecent, () => none)
  const client = useSyncExternalStore(never, () => true, () => false)
  const order = useRef<readonly string[]>(none)
  const list = useRef<HTMLOListElement>(null)
  const heads = props.listing?.heads ?? {}
  const ready = client && !!props.listing
  if (ready && props.items.some((swarm) => !order.current.includes(swarm.id))) {
    const rank = (swarm: Summary, index: number) => [props.unread(swarm) ? 0 : 1, swarm.archivedAt ? 1 : 0, known.includes(swarm.id) ? known.indexOf(swarm.id) : known.length + index] as const
    order.current = props.items
      .map((swarm, index) => ({ id: swarm.id, key: rank(swarm, index) }))
      .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2])
      .map((each) => each.id)
  }
  const byId = new Map(props.items.map((swarm) => [swarm.id, swarm]))
  const shown = order.current.flatMap((id) => byId.get(id) ?? [])
  useEffect(() => {
    if (props.current && props.current !== 'general') remember(props.current)
  }, [props.current])
  useEffect(() => {
    const element = list.current?.querySelector<HTMLElement>('[data-lit]')
    const box = list.current
    if (!element || !box) return
    const left = element.offsetLeft - box.offsetLeft
    if (left < box.scrollLeft || left + element.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollTo({ left: Math.max(0, left - (box.clientWidth - element.offsetWidth) / 2) })
  }, [props.current, shown.length])
  return (
    <nav aria-label="Switch channel" className="switcher">
      <ol className="switcher-list" data-ready={ready} ref={list}>
        <li>
          <Link className="switch switch-home" label="#general on Swarms" lit={props.current === 'general'} to="/">
            <i aria-hidden="true">#</i>
            <span className="switch-name">general</span>
          </Link>
        </li>
        {shown.map((swarm) => {
          const standing = stood(swarm, heads[swarm.id])
          const tag = Status.tag(standing.word)
          const working = standing.word === 'Working'
          return (
            <li key={swarm.id}>
              <Link
                className="switch"
                data={{ 'data-mood': standing.mood, 'data-old': String(!!swarm.archivedAt), 'data-unread': String(props.unread(swarm)) }}
                label={`${swarm.title}, ${cash(swarm.balance)} from ${riders(swarm.contributors)}${tag ? `, ${tag}` : ''}`}
                lit={props.current === swarm.id}
                to={Nickname.path(swarm)}
              >
                <Spiral cells={sown(swarm, heads[swarm.id])} id={swarm.id} live={working} />
                <Inline className="switch-name" text={swarm.title} />
                <span className="switch-meta"><i aria-hidden="true" />{cash(swarm.balance)}</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

