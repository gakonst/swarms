import type * as Kinds from '../shared/Surface.ts'
import { Markdown } from './Markdown.tsx'

function fixed(value: number) {
  const size = Math.abs(value)
  return size >= 100 ? value.toFixed(0) : size >= 10 ? value.toFixed(1).replace(/\.0$/, '') : value.toFixed(2).replace(/0$/, '')
}

function Chart(props: { node: Extract<Kinds.Node, { kind: 'chart' }> }) {
  const node = props.node
  const width = 600
  const height = 150
  const pad = 14
  const values = [...node.points, ...node.tried.map(([, value]) => value), ...(node.goal === null ? [] : [node.goal])]
  const low = Math.min(...values)
  const high = Math.max(...values)
  const span = high - low || 1
  const slots = Math.max(node.points.length, ...node.tried.map(([at]) => at + 1))
  const x = (index: number) => pad + (index * (width - pad * 2)) / Math.max(slots - 1, 1)
  const y = (value: number) => height - pad - ((value - low) / span) * (height - pad * 2)
  const line = node.points.map((value, index) => (index ? 'L' : 'M') + x(index).toFixed(1) + ' ' + y(value).toFixed(1)).join(' ')
  const last = node.points[node.points.length - 1] ?? 0
  return (
    <figure className="surface-chart">
      <figcaption>
        <b>{fixed(last)}{node.unit}</b>
        {node.goal !== null && <span>{node.goalLabel ?? 'goal'} {fixed(node.goal)}{node.unit}</span>}
      </figcaption>
      <svg aria-hidden="true" preserveAspectRatio="none" viewBox={'0 0 ' + width + ' ' + height}>
        {node.goal !== null && <line className="flow-goal" vectorEffect="non-scaling-stroke" x1={pad} x2={width - pad} y1={y(node.goal)} y2={y(node.goal)} />}
        <path className="flow-area" d={line + ' L' + x(node.points.length - 1) + ' ' + (height - pad) + ' L' + pad + ' ' + (height - pad) + ' Z'} />
        <path className="flow-line" d={line} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="surface-dots" aria-hidden="true">
        {node.tried.map(([at, value], index) => <i data-tried="true" key={'t' + index} style={{ left: (x(at) / width) * 100 + '%', top: (y(value) / height) * 100 + '%' }} />)}
        {node.points.map((value, index) => <i key={index} style={{ left: (x(index) / width) * 100 + '%', top: (y(value) / height) * 100 + '%' }} />)}
      </div>
    </figure>
  )
}

function Bars(props: { node: Extract<Kinds.Node, { kind: 'bars' }> }) {
  const node = props.node
  const max = node.max ?? Math.max(...node.items.map((item) => item.value), node.mark ?? 0)
  const at = (value: number) => Math.min(100, (value / (max || 1)) * 100) + '%'
  return (
    <ul className="surface-bars">
      {node.items.map((item, index) => (
        <li key={index}>
          <span>{item.label}</span>
          <b>{item.note ?? fixed(item.value) + (node.unit ?? '')}</b>
          <i data-tone={item.tone ?? undefined}>
            <em style={{ width: at(item.value) }} />
            {node.mark !== null && <s style={{ left: at(node.mark) }} />}
          </i>
        </li>
      ))}
    </ul>
  )
}

function Range(props: { node: Extract<Kinds.Node, { kind: 'range' }> }) {
  const node = props.node
  const unit = node.unit ?? ''
  const pad = (node.high - node.low) * 0.4 || Math.abs(node.mid) * 0.2 || 1
  const from = node.low - pad
  const to = node.high + pad
  const at = (value: number) => ((value - from) / (to - from)) * 100 + '%'
  return (
    <div className="surface-range">
      <p>
        <b>{fixed(node.mid)}{unit}</b>
        <span>likely {fixed(node.low)}{unit} to {fixed(node.high)}{unit}</span>
      </p>
      <i aria-hidden="true">
        <em style={{ left: at(node.low), right: 'calc(100% - ' + at(node.high) + ')' }} />
        <s style={{ left: at(node.mid) }} />
      </i>
      {node.note && <small>{node.note}</small>}
    </div>
  )
}

function Body(props: { node: Kinds.Node; onChat: () => void; onSteer: (note: string) => void }) {
  const node = props.node
  switch (node.kind) {
    case 'asks':
      return (
        <ul className="surface-asks">
          {node.items.map((ask, index) => (
            <li key={index}>
              <span>
                <b>{ask.text}</b>
                {ask.amount && <em>{ask.amount}</em>}
                {ask.why && <small>{ask.why}</small>}
              </span>
              <button data-primary={index === 0 || undefined} onClick={() => (ask.action === 'chat' ? props.onChat() : props.onSteer(ask.text))} type="button">{ask.label}</button>
            </li>
          ))}
        </ul>
      )
    case 'stats':
      return (
        <dl className="surface-stats">
          {node.items.map((stat, index) => (
            <div key={index}>
              <dt>{stat.label}</dt>
              <dd>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )
    case 'checklist': {
      const marks = { doing: '◐', done: '✓', failed: '×', todo: '○' } as const
      return (
        <ul className="surface-checks">
          {node.items.map((item, index) => (
            <li data-state={item.state} key={index}>
              {item.group && item.group !== node.items[index - 1]?.group && <b>{item.group}</b>}
              <span><i aria-hidden="true">{marks[item.state]}</i>{item.text}</span>
            </li>
          ))}
        </ul>
      )
    }
    case 'chart':
      return <Chart node={node} />
    case 'bars':
      return <Bars node={node} />
    case 'list': {
      const Tag = node.numbered ? 'ol' : 'ul'
      return (
        <Tag className="surface-list">
          {node.items.map((item, index) => (
            <li key={index}>
              <span>
                {item.text}
                {item.note && <small>{item.note}</small>}
              </span>
              {item.state && <em data-tone={item.tone ?? undefined}>{item.state}</em>}
            </li>
          ))}
        </Tag>
      )
    }
    case 'meter':
      return (
        <div className="surface-meter">
          <p>
            <b>{node.value.toLocaleString('en-US')} / {node.max.toLocaleString('en-US')}</b>
            {node.label && <span>{node.label}</span>}
          </p>
          <i aria-hidden="true"><em style={{ width: (node.value / node.max) * 100 + '%' }} /></i>
        </div>
      )
    case 'range':
      return <Range node={node} />
    case 'tiles':
      return (
        <ul className="surface-tiles">
          {node.items.map((tile, index) => (
            <li data-tone={tile.tone ?? undefined} key={index} title={tile.state ?? undefined}>
              <b>{tile.label}</b>
              {tile.state && <small>{tile.state}</small>}
            </li>
          ))}
        </ul>
      )
    case 'text':
      return <Markdown text={node.text} />
    case 'status':
      return null
  }
}

export function Surface(props: { nodes: readonly Kinds.Node[]; onChat: () => void; onSteer: (note: string) => void }) {
  const nodes = props.nodes.filter((node) => node.kind !== 'status')
  if (!nodes.length) return null
  return (
    <div className="surface">
      {nodes.map((node) => (
        <section className="surface-card" data-kind={node.kind} data-wide={node.wide || node.kind === 'asks' || node.kind === 'stats' || undefined} key={node.id}>
          {node.title && <h3>{node.title}</h3>}
          <Body node={node} onChat={props.onChat} onSteer={props.onSteer} />
        </section>
      ))}
    </div>
  )
}
