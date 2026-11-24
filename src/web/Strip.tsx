import type { MouseEvent, ReactNode } from 'react'
import type { Contribution, Detail } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Prose from '../shared/Prose.ts'
import { usd } from './format.ts'
import { Inline, Markdown } from './Markdown.tsx'
import { Avatar } from './Room.tsx'
import { href, Link } from './router.tsx'
import { stamp } from './format.ts'

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
  const number = Number(value)
  return number >= 100 ? `$${Math.round(number).toLocaleString('en-US')}` : usd(value)
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
  return backer.handle && !backer.handle.startsWith('0x') ? `@${backer.handle}` : `${backer.address.slice(0, 6)}…${backer.address.slice(-4)}`
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

export function Strip(props: { backers: readonly Backer[]; children?: ReactNode; onRide: ((anchor: HTMLElement) => void) | undefined; raised: string; riders: number; title: string; topic: string }) {
  return (
    <header aria-label="The channel" className="strip">
      <div className="strip-head">
        <h1 className="strip-title"><i aria-hidden="true">#</i><Inline text={props.title} /></h1>
        <p className="strip-stats">
          <span className="strip-big"><b>{props.riders.toLocaleString('en-US')}</b> rider{props.riders === 1 ? '' : 's'}</span>
          <span className="strip-big"><b>{dollars(props.raised)}</b> raised</span>
          {props.children}
        </p>
        {props.onRide && <button className="btn btn-high strip-ride" onClick={(event) => props.onRide?.(event.currentTarget)} type="button">Ride it</button>}
      </div>
      <div className="strip-line">
        <p className="strip-topic" title={Prose.plain(props.topic)}><Inline text={props.topic} /></p>
        <Backers list={props.backers} size={3} />
      </div>
    </header>
  )
}

export function Tabs(props: { base: string; board: string; onShow: (view: Tab) => void; unread: number; view: Tab }) {
  return (
    <nav aria-label="Channel" className="tabs" data-view={props.view}>
      {tabs.map(([key, label]) => (
        <a
          aria-current={props.view === key ? 'page' : undefined}
          className="tab"
          data-tab={key}
          href={href(at(props.base, key))}
          key={key}
          onClick={(event: MouseEvent<HTMLAnchorElement>) => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            event.preventDefault()
            props.onShow(key)
          }}
        >
          {key === 'board' ? props.board : label}
          {key === 'chat' && props.unread > 0 && props.view !== 'chat' && <i className="tab-unread">{props.unread}</i>}
        </a>
      ))}
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
        <dt>Spent</dt><dd>{dollars(swarm.spent)}</dd>
        <dt>Left</dt><dd>{dollars(swarm.remaining)}</dd>
      </dl>
    </section>
  )
}
