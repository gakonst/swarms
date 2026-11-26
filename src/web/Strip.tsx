import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'
import type { Contribution, Detail } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Prose from '../shared/Prose.ts'
import { spent, usd } from './format.ts'
import { Inline, Markdown } from './Markdown.tsx'
import { Avatar } from './Room.tsx'
import { href, Link } from './router.tsx'
import { Opener } from './Search.tsx'
import { stamp } from './format.ts'
import * as Limits from '../shared/Limits.ts'

export type Tab = 'chat' | 'board' | 'results' | 'code' | 'about'

export type Backer = { address: string; amount: string; handle: string | null }

const tabs: readonly (readonly [Tab, string])[] = [
  ['chat', 'Chat'],
  ['board', 'Board'],
  ['results', 'Results'],
  ['code', 'Code'],
  ['about', 'About'],
]

export function tab(tail: string): Tab {
  if (tail.startsWith('/n/')) return 'board'
  const name = tail.replace(/^\//, '')
  return tabs.some(([key]) => key === name) ? (name as Tab) : 'chat'
}

export function at(base: string, view: Tab) {
  return view === 'chat' ? base : `${base}/${view}`
}

export function dollars(value: string) {
  return usd(value)
}

export function backers(contributions: readonly Contribution[], names: ReadonlyMap<string, string>): Backer[] {
  const sums = new Map<string, bigint>()
  for (const gift of contributions) {
    const key = gift.contributor.toLowerCase()
    sums.set(key, (sums.get(key) ?? 0n) + units(gift.amount))
  }
  return [...sums].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([address, sum]) => ({ address, amount: decimal(sum), handle: names.get(address) ?? null }))
}

export function profile(backer: { address: string; handle: string | null }) {
  return `/u/${encodeURIComponent(backer.handle && !backer.handle.startsWith('0x') ? backer.handle : backer.address)}`
}

function named(backer: Backer) {
  return backer.handle && !backer.handle.startsWith('0x') ? `@${backer.handle}` : `${backer.address.slice(0, Limits.SharedMention.headChars)}…${backer.address.slice(-Limits.SharedMention.tailChars)}`
}

export function Backers(props: { list: readonly Backer[]; size: number }) {
  const shown = props.list.slice(0, props.size)
  if (!shown.length) return null
  return (
    <ol aria-label="Top riders" className="backers">
      {shown.map((backer, index) => (
        <li key={backer.address}>
          <Link className="backer" label={`${index + 1}. ${named(backer)}, ${dollars(backer.amount)}`} to={profile(backer)}>
            <Avatar address={backer.address} handle={backer.handle ?? backer.address} size="small" />
            <span className="backer-name">{named(backer)}</span>
            <b>{dollars(backer.amount)}</b>
          </Link>
        </li>
      ))}
    </ol>
  )
}

export function Strip(props: { backers: readonly Backer[]; children?: ReactNode; edit?: ReactNode; onRide: ((anchor: HTMLElement) => void) | undefined; raised: string; riders: number; title: string; topic: string }) {
  return (
    <header aria-label="The channel" className="strip">
      <div className="strip-head">
        <h1 className="strip-title">
          <Opener className="strip-switch">
            <i aria-hidden="true">#</i>
            <Inline text={props.title} />
            <svg aria-hidden="true" className="strip-switch-mark" viewBox="0 0 16 16"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg>
          </Opener>
        </h1>
        {props.edit}
        <p className="strip-stats">
          <span className="strip-big strip-riders"><b>{props.riders.toLocaleString('en-US')}</b> rider{props.riders === 1 ? '' : 's'}</span>
          <span className="strip-big"><b>{dollars(props.raised)}</b> raised</span>
          {props.children}
        </p>
        {props.onRide && <button className="btn btn-high strip-ride" onClick={(event) => props.onRide?.(event.currentTarget)} type="button">Ride it</button>}
      </div>
      <div className="strip-line">
        <p className="strip-topic" title={Prose.plain(props.topic)}><Inline text={props.topic} /></p>
        <Backers list={props.backers} size={Limits.WebStrip.backers} />
      </div>
    </header>
  )
}

export function useZoom() {
  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === '\\') {
        event.preventDefault()
        setZoomed((current) => !current)
        return
      }
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('.find-scrim, .overlay')) return
      setZoomed((current) => {
        if (current) event.preventDefault()
        return false
      })
    }
    addEventListener('keydown', listener)
    return () => removeEventListener('keydown', listener)
  }, [])
  return [zoomed, () => setZoomed((current) => !current)] as const
}

export function Tabs(props: { base: string; board: string; onShow: (view: Tab) => void; open?: { label: string; onClose: () => void } | undefined; view: Tab; zoom?: { on: boolean; onToggle: () => void } | undefined }) {
  return (
    <nav aria-label="Artifacts" className="tabs">
      {tabs.map(([key, label]) => (
        <a
          aria-current={props.view === key && !props.open ? 'page' : undefined}
          className={key === 'chat' ? 'tab tab-chat' : 'tab'}
          data-default={(key === 'board' && props.view === 'chat' && !props.open) || undefined}
          href={href(at(props.base, key))}
          key={key}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            props.onShow(key)
          }}
        >
          {key === 'board' ? props.board : label}
        </a>
      ))}
      {props.open && (
        <span aria-current="page" className="tab tab-open">
          {props.open.label}
          <button aria-label="Close the thread" className="tab-close" onClick={props.open.onClose} type="button"><span aria-hidden="true">×</span></button>
        </span>
      )}
      {props.zoom && (
        <button aria-keyshortcuts="Meta+Backslash Control+Backslash" aria-label={props.zoom.on ? 'Show the chat again' : 'Expand this panel over the chat'} aria-pressed={props.zoom.on} className="tab-zoom" onClick={props.zoom.onToggle} title={props.zoom.on ? 'Show the chat (Esc)' : 'Expand (⌘\\)'} type="button">
          <svg aria-hidden="true" viewBox="0 0 16 16">{props.zoom.on ? <path d="M9.5 2.5v4h4M6.5 13.5v-4h-4M9.5 6.5l4.5-4.5M6.5 9.5 2 14" /> : <path d="M10 2.5h3.5V6M6 13.5H2.5V10M13.5 2.5 9 7M2.5 13.5 7 9" />}</svg>
        </button>
      )}
    </nav>
  )
}

function opening(text: string) {
  return text.split(/(?<=[.?!])\s/)[0]?.trim().toLowerCase()
}

export function explainer(swarm: Detail, spec?: string) {
  const about = swarm.about?.trim()
  if (about) return about
  const goal = swarm.goal.trim()
  const more = spec?.replace(/^#[^\n]*\n+/, '').trim()
  if (!more || goal.includes(more)) return goal
  if (more.includes(goal) || opening(more) === opening(goal)) return more.length > goal.length ? more : goal
  return `${goal}\n\n${more}`
}

export function Explainer(props: { swarm: Detail; spec?: string | undefined }) {
  const swarm = props.swarm
  return (
    <section aria-label="About this swarm" className="explainer">
      <Markdown text={explainer(swarm, props.spec)} />
      <dl className="explainer-facts">
        <dt>Started</dt><dd>{stamp(swarm.createdAt)}</dd>
        <dt>Raised</dt><dd>{dollars(swarm.balance)} from {swarm.contributors} rider{swarm.contributors === 1 ? '' : 's'}</dd>
        <dt>Spent</dt><dd>{spent(swarm.spent)}</dd>
        <dt>Left</dt><dd>{dollars(swarm.remaining)}</dd>
      </dl>
    </section>
  )
}
