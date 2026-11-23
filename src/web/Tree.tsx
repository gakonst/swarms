import { type CSSProperties, memo, type MouseEvent } from 'react'
import type * as Tree from '../shared/Tree.ts'
import * as Grove from './grove.ts'
import { href, navigate } from './router.tsx'

const words: Record<Tree.Status, string> = { 'dead end': 'Dead end', funded: 'Ridden', 'in flight': 'In flight', proposed: 'Proposed', proven: 'Proven' }

export function word(status: Tree.Status) {
  return words[status]
}

export function Mark(props: { checking?: boolean | undefined; status: Tree.Status }) {
  return <i aria-label={props.checking ? 'Checking' : words[props.status]} className="mark" data-checking={props.checking || undefined} data-status={props.status} role="img" />
}

function plain(event: MouseEvent<HTMLAnchorElement>) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

export const Row = memo(function Row(props: { blocked: number; landed: number | undefined; onPick: (node: Tree.Node) => void; row: Grove.Row; selected: boolean; to: string }) {
  const node = props.row.node
  const share = Grove.share(node)
  return (
    <li
      className="tree-row"
      data-dim={!props.row.hit || undefined}
      data-frontier={props.row.frontier || undefined}
      data-landed={props.landed ? String(props.landed) : undefined}
      data-selected={props.selected || undefined}
      style={{ '--depth': props.row.depth } as CSSProperties}
    >
      <a
        aria-current={props.selected ? 'true' : undefined}
        aria-expanded={node.children.length ? props.row.open : undefined}
        href={href(props.to)}
        onClick={(event) => {
          if (!plain(event)) return
          event.preventDefault()
          props.onPick(node)
        }}
      >
        <span className="tree-row-fold" aria-hidden="true">{node.children.length ? (props.row.open ? '▾' : '▸') : ''}</span>
        <Mark checking={node.run?.checking} status={node.status} />
        <span className="tree-row-title">{node.title}</span>
        {props.row.frontier && <span className="tree-row-tag">frontier</span>}
        {props.blocked > 0 && <span className="tree-row-tag" data-tone="wait" title="Waits on lemmas that are not proven yet">needs {props.blocked}</span>}
        <span className="tree-row-proven" title="Proven in this subtree">{node.counts.proven > 0 ? `${node.counts.proven} ✓` : ''}</span>
        <span className="tree-row-bar" title={`$${Number(node.money.subtree.spent).toFixed(2)} spent of $${(Number(node.money.subtree.spent) + Number(node.money.subtree.left)).toFixed(2)}`}>
          <i style={{ width: `${Math.round(share * 100)}%` }} />
        </span>
        <span className="tree-row-by">@{node.by.handle}</span>
      </a>
    </li>
  )
})

function blocked(node: Tree.Node, nodes: Readonly<Record<string, Tree.Node>>) {
  return Grove.closed(node) ? 0 : node.needs.filter((need) => nodes[need]?.status !== 'proven').length
}

export function Filters(props: { filter: Grove.Filter; nodes: Readonly<Record<string, Tree.Node>>; onFilter: (filter: Grove.Filter) => void }) {
  const all = Object.values(props.nodes)
  return (
    <div aria-label="Show" className="chips tree-filters" role="tablist">
      {Grove.filters.map(([key, label]) => (
        <button aria-selected={props.filter === key} className="chip" key={key} onClick={() => props.onFilter(key)} role="tab" type="button">
          {label}
          <span className="chip-count">{key === 'all' ? all.length : all.filter((node) => Grove.fits(key, node)).length}</span>
        </button>
      ))}
    </div>
  )
}

export function Outline(props: { filter: Grove.Filter; landed: Readonly<Record<string, number>>; nodes: Readonly<Record<string, Tree.Node>>; onPick: (node: Tree.Node) => void; open: ReadonlySet<string>; path: (nid: string) => string; selected: string }) {
  const rows = Grove.rows(props.nodes, 'root', props.open, props.filter)
  if (!rows.length) return <p className="tree-empty">{props.filter === 'all' ? 'Nothing here yet.' : 'Nothing matches.'}</p>
  return (
    <ol className="tree-rows" role="tree">
      {rows.map((row) => <Row blocked={blocked(row.node, props.nodes)} key={row.node.id} landed={props.landed[row.node.id]} onPick={props.onPick} row={row} selected={row.node.id === props.selected} to={props.path(row.node.id)} />)}
    </ol>
  )
}

export function Level(props: { at: string; filter: Grove.Filter; landed: Readonly<Record<string, number>>; level: (nid: string) => string; nodes: Readonly<Record<string, Tree.Node>>; onPick: (node: Tree.Node) => void; path: (nid: string) => string }) {
  const trail = Grove.trail(props.nodes, props.at)
  const here = props.nodes[props.at]
  const rows = Grove.level(props.nodes, props.at, props.filter)
  return (
    <div className="level">
      <nav aria-label="Where you are" className="crumbs">
        {trail.map((node, index) => (
          <span key={node.id}>
            {index > 0 && <i aria-hidden="true">›</i>}
            {index === trail.length - 1 ? <b>{node.title}</b> : <a href={href(props.level(node.id))} onClick={(event) => { if (!plain(event)) return; event.preventDefault(); navigate(props.level(node.id), { keep: true, replace: true }) }}>{node.title}</a>}
          </span>
        ))}
      </nav>
      {here && (
        <a className="level-head" href={href(props.path(here.id))} onClick={(event) => { if (!plain(event)) return; event.preventDefault(); navigate(props.path(here.id), { keep: true }) }}>
          <Mark checking={here.run?.checking} status={here.status} />
          <span className="level-title">{here.form === 'goal' ? 'The whole swarm' : here.title}</span>
          <span className="level-go">Read and ride ›</span>
        </a>
      )}
      {rows.length ? (
        <ol className="tree-rows" role="list">
          {rows.map((row) => <Row blocked={blocked(row.node, props.nodes)} key={row.node.id} landed={props.landed[row.node.id]} onPick={props.onPick} row={row} selected={false} to={row.node.children.length ? props.level(row.node.id) : props.path(row.node.id)} />)}
        </ol>
      ) : (
        <p className="tree-empty">{props.filter === 'all' ? 'Nothing under it yet. Propose a lemma.' : 'Nothing matches here.'}</p>
      )}
    </div>
  )
}
