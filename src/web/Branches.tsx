import { type CSSProperties, type MouseEvent, useState } from 'react'
import type { Config } from '../shared/Api.ts'
import type * as Tree from '../shared/Tree.ts'
import { Compose, Pending } from './Compose.tsx'
import { ago, usd } from './format.ts'
import * as Grove from './grove.ts'
import { Inline } from './Markdown.tsx'
import { Overlay } from './Overlay.tsx'
import { Avatar } from './Room.tsx'
import { why } from './Node.tsx'
import * as Pay from './pay.ts'
import { href, Link } from './router.tsx'
import { Mark } from './Tree.tsx'

export type Shape = 'tree' | 'spine'

type Doing = { text: string; at: number }

const first: Record<number, number> = { 0: 5, 1: 3 }
const step = 6

export function cash(value: string) {
  const number = Number(value)
  return number >= 100 ? `$${Math.round(number).toLocaleString('en-US')}` : usd(value)
}

export function doing(node: Tree.Node): Doing | null {
  const run = node.run as (Tree.Run & { doing?: Doing | null }) | null
  return node.status === 'in flight' && run?.doing?.text ? run.doing : null
}

function plain(event: MouseEvent<HTMLElement>) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export function Faces(props: { funders: readonly Tree.Funder[]; riders: number }) {
  const shown = props.funders.filter((funder) => funder.who.address).slice(0, 3)
  const rest = props.riders - shown.length
  if (!props.riders) return null
  return (
    <span aria-label={`${props.riders} rider${props.riders === 1 ? '' : 's'}`} className="faces" role="img">
      {shown.map((funder) => <Avatar address={funder.who.address!} handle={funder.who.handle} key={funder.who.address} size="small" />)}
      {rest > 0 && <b>+{rest}</b>}
    </span>
  )
}

export function Tally(props: { node: Tree.Node }) {
  const counts = props.node.counts
  const proven = Math.min(counts.proven, 9)
  if (!counts.proven && !counts['in flight'] && !counts['dead end']) return null
  return (
    <span aria-label={`${counts.proven} proven, ${counts['in flight']} in flight, ${counts['dead end']} dead ends`} className="tally" role="img">
      {proven > 0 && <i data-kind="proven">{'+'.repeat(proven)}{counts.proven > proven ? ` ${counts.proven}` : ''}</i>}
      {counts['in flight'] > 0 && <i data-kind="flight">{'•'.repeat(Math.min(counts['in flight'], 5))}</i>}
      {counts['dead end'] > 0 && <i data-kind="dead">{'×'.repeat(Math.min(counts['dead end'], 5))}</i>}
    </span>
  )
}

type Props = {
  composing: string | undefined
  config: Config | undefined
  filter: Grove.Filter
  fresh: ReadonlySet<string>
  landed: Readonly<Record<string, number>>
  more: Readonly<Record<string, number>>
  nodes: Readonly<Record<string, Tree.Node>>
  now: number
  onCompose: (nid: string | undefined) => void
  onFold: (node: Tree.Node) => void
  onMore: (id: string, count: number) => void
  onPick: (node: Tree.Node) => void
  open: ReadonlySet<string>
  path: (nid: string) => string
  propose: (nid: string) => string
  selected: string
  shape: Shape
  swarm: string
}

function Bud(props: Props & { depth: number; node: Tree.Node }) {
  const node = props.node
  const live = doing(node)
  const open = props.open.has(node.id) || props.filter !== 'all'
  const folds = node.children.length > 0 && node.form !== 'goal' && props.filter === 'all'
  const act = Pay.useFlow(Pay.slot(props.swarm, node.id))
  const coming = act.at === 'counting' || act.at === 'owed' ? act.owed.amount : undefined
  return (
    <div className="bud">
      <Mark checking={node.run?.checking} status={node.status} />
      <a
        aria-current={props.selected === node.id ? 'true' : undefined}
        className="bud-title"
        href={href(props.path(node.id))}
        onClick={(event) => {
          if (!plain(event)) return
          event.preventDefault()
          props.onPick(node)
        }}
      >
        <Inline text={node.title} />
      </a>
      <span className="bud-meta">
        <span className="bud-money">{cash(node.money.subtree.pledged)}{coming && <i className="bud-coming" title={act.at === 'owed' ? 'Sent, not counted yet' : 'Counting'}>+{cash(coming)}</i>}</span>
        <Faces funders={node.funders} riders={node.riders} />
        {node.children.length > 0 && <Tally node={node} />}
        {folds && (
          <button aria-controls={open ? `limbs-${node.id}` : undefined} aria-expanded={open} aria-label={open ? `Fold ${node.title}` : `Show the ${node.children.length} under ${node.title}`} className="bud-fold" onClick={() => props.onFold(node)} type="button">
            <i aria-hidden="true" />{open ? 'Fold' : `${node.children.length} under it`}
          </button>
        )}
      </span>
      {live ? (
        <span className="bud-doing"><Inline text={live.text} /><time>{ago(live.at, props.now)}</time></span>
      ) : node.status === 'in flight' && node.run ? (
        <span className="bud-doing">{node.run.checking ? 'The verifier is building it' : `Run ${node.run.k} · ${usd(node.run.spent)} of ${usd(node.run.budget)}`}</span>
      ) : null}
    </div>
  )
}

function Limb(props: Props & { depth: number; id: string; index: number }) {
  const ghosts = Pay.useGhosts(props.swarm, props.id)
  const [spot, setSpot] = useState<HTMLAnchorElement | null>(null)
  const node = props.nodes[props.id]
  if (!node) return null
  const open = node.form === 'goal' || props.open.has(node.id) || props.filter !== 'all'
  const ranked = open ? Grove.ranked(props.nodes, node.id, props.filter) : []
  const kids = ranked.filter((kid) => !props.fresh.has(kid.id))
  const pinned = ranked.filter((kid) => props.fresh.has(kid.id))
  const limit = props.more[node.id] ?? first[props.depth] ?? 3
  const hidden = kids.slice(limit)
  const shown = [...kids.slice(0, limit), ...pinned]
  const proposing = open && !Grove.closed(node) && props.filter === 'all'
  const waiting = proposing ? ghosts.filter((ghost) => !ghost.owed.node || !props.nodes[ghost.owed.node]) : []
  const composing = proposing && props.composing === node.id
  return (
    <li
      className="limb"
      data-depth={props.depth}
      data-dim={(props.filter !== 'all' && !Grove.fits(props.filter, node)) || undefined}
      data-landed={props.landed[node.id] ? String(props.landed[node.id]) : undefined}
      data-selected={props.selected === node.id || undefined}
      data-side={props.index % 2 ? 'left' : 'right'}
      data-status={node.status}
      style={{ '--i': props.index } as CSSProperties}
    >
      <Bud {...props} node={node} />
      {(shown.length > 0 || proposing) && (
        <ol className="limbs" id={`limbs-${node.id}`}>
          {shown.map((kid, index) => <Limb {...props} depth={props.depth + 1} id={kid.id} index={index} key={kid.id} />)}
          {hidden.length > 0 && (
            <li className="limb limb-more">
              <button onClick={() => props.onMore(node.id, limit + step)} type="button">
                See {hidden.length} more<span>{cash(Grove.sum(hidden))}</span>
              </button>
            </li>
          )}
          {waiting.map((ghost) => (
            <li className="limb limb-ghost" data-depth={props.depth + 1} key={ghost.owed.hash}>
              <Pending act={ghost.act} owed={ghost.owed} />
            </li>
          ))}
          {proposing && (
            <li className="limb limb-propose">
              {composing && (
                <Overlay anchor={spot} className="compose-card" label="Add a sub-item" onClose={() => props.onCompose(undefined)}>
                  <Compose config={props.config} onSent={() => props.onCompose(undefined)} parent={node} swarm={props.swarm} />
                </Overlay>
              )}
              <a aria-expanded={composing} aria-haspopup="dialog" href={href(props.propose(node.id))} ref={setSpot} onClick={(event) => {
                if (!plain(event)) return
                event.preventDefault()
                props.onCompose(node.id)
              }}>
                <i aria-hidden="true">+</i>Add a sub-item<span>$1+</span>
              </a>
            </li>
          )}
        </ol>
      )}
    </li>
  )
}

export function Peek(props: { node: Tree.Node; nodes: Readonly<Record<string, Tree.Node>>; onRide: (node: Tree.Node, anchor: HTMLElement) => void; to: string }) {
  const node = props.node
  const rides = !Grove.closed(node) && node.form !== 'triage'
  return (
    <div className="peek" data-rides={rides || undefined}>
      <Link className="peek-read" keep to={props.to}>
        <span className="peek-head"><Mark checking={node.run?.checking} status={node.status} /><b>{node.form === 'goal' ? 'The whole swarm' : node.title}</b></span>
        <span className="peek-why">{why(node, props.nodes)}</span>
        <span className="peek-meta"><span className="bud-money">{cash(node.money.subtree.pledged)}</span><Faces funders={node.funders} riders={node.riders} /><span className="peek-go">Read more ›</span></span>
      </Link>
      {rides && <button className="btn btn-high peek-ride" onClick={(event) => props.onRide(node, event.currentTarget)} type="button">Ride it</button>}
    </div>
  )
}

export function Branches(props: Props) {
  if (!props.nodes['root']) return <p className="tree-empty">Nothing here yet.</p>
  return (
    <ol className="branches" data-shape={props.shape}>
      <Limb {...props} depth={0} id="root" index={0} />
    </ol>
  )
}
