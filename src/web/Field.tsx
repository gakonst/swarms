const cells = ['proven', 'dead', 'spent', 'flight', 'open'] as const

export type Cell = (typeof cells)[number]

const gap = 4.4

const size = 40

function hash(text: string) {
  let value = 2166136261
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  return (value >>> 0) / 4294967296
}

function marks(counts: Record<Cell, number>, id: string) {
  const out: Record<Cell, string> = { dead: '', flight: '', open: '', proven: '', spent: '' }
  const b = gap / (Math.PI * 2)
  const start = hash(id) * Math.PI * 2
  const half = gap * 0.36
  let index = 0
  for (const cell of cells)
    for (let count = 0; count < counts[cell]; count++, index++) {
      const theta = Math.sqrt((2 * (index + 3) * gap) / b)
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
