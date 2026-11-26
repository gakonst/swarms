import * as Limits from '../shared/Limits.ts'
const cells = ['proven', 'dead', 'spent', 'flight', 'open'] as const

export type Cell = (typeof cells)[number]

const gap = Limits.WebField.gap

const size = Limits.WebField.size

function hash(text: string) {
  let value: number = Limits.Edge.fnvOffset
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), Limits.Edge.fnvPrime)
  return (value >>> 0) / Limits.Web.uint32Span
}

function marks(counts: Record<Cell, number>, id: string) {
  const out: Record<Cell, string> = { dead: '', flight: '', open: '', proven: '', spent: '' }
  const b = gap / (Math.PI * 2)
  const start = hash(id) * Math.PI * 2
  const half = gap * Limits.WebField.half
  let index = 0
  for (const cell of cells)
    for (let count = 0; count < counts[cell]; count++, index++) {
      const theta = Math.sqrt((2 * (index + Limits.WebField.start) * gap) / b)
      const x = b * theta * Math.cos(theta + start)
      const y = b * theta * Math.sin(theta + start)
      out[cell] += `M${(x - half).toFixed(1)} ${y.toFixed(1)}h${(half * 2).toFixed(1)}M${x.toFixed(1)} ${(y - half).toFixed(1)}v${(half * 2).toFixed(1)}`
    }
  return out
}

export function Spiral(props: { cells: Record<Cell, number>; id: string; live: boolean }) {
  const drawn = marks(props.cells, props.id)
  return (
    <svg aria-hidden="true" className="spiral" data-live={props.live} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}>
      <g className="spiral-spin">{cells.map((cell) => drawn[cell] && <path className={`spot spot-${cell}`} d={drawn[cell]} key={cell} />)}</g>
    </svg>
  )
}
