import type * as Tree from '../shared/Tree.ts'
import * as Grove from './grove.ts'

const words: Record<Tree.Status, string> = { 'dead end': 'Dead end', funded: 'Ridden', 'in flight': 'In flight', proposed: 'Proposed', proven: 'Proven' }

export function word(status: Tree.Status) {
  return words[status]
}

export function Mark(props: { checking?: boolean | undefined; status: Tree.Status }) {
  return <i aria-label={props.checking ? 'Checking' : words[props.status]} className="mark" data-checking={props.checking || undefined} data-status={props.status} role="img" />
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
