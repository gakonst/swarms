import type { Mood } from '../shared/Status.ts'

const palettes: Record<Mood, readonly (readonly [string, string, string, string])[]> = {
  live: [
    ['#c8f500', '#d9d9d2', '#ff7ab8', '#1d0b5e'],
    ['#c8f500', '#8d8d86', '#f4f4ee', '#7a52e0'],
    ['#b6ef00', '#e6e6de', '#161616', '#ff7ab8'],
  ],
  money: [
    ['#ff5fae', '#ffd3ea', '#ffffff', '#c4189a'],
    ['#f2e9f0', '#ff7ab8', '#d14fd1', '#ffffff'],
    ['#ff8a5c', '#ffe1cf', '#ff5fae', '#ffffff'],
  ],
  new: [
    ['#bfe9e6', '#dff4f2', '#161616', '#49c6c0'],
    ['#9b9b9b', '#8a45f0', '#00ff00', '#c9c9c9'],
    ['#d9d9d2', '#8d8d86', '#7a52e0', '#f4f4ee'],
  ],
}

function hash(text: string, seed: number) {
  let value = 2166136261 ^ seed
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  value ^= value >>> 13
  value = Math.imul(value, 0x5bd1e995)
  return ((value ^ (value >>> 15)) >>> 0) / 4294967296
}

export function swatch(id: string, mood: Mood) {
  const set = palettes[mood]
  return set[Math.floor(hash(id, 1) * set.length)]!
}

export function Art(props: { id: string; mood: Mood; wide?: boolean }) {
  const width = props.wide ? 96 : 40
  const height = 40
  const colors = swatch(props.id, props.mood)
  const paths = ['', '', '', '']
  let y = 0
  let row = 0
  let last: [number, number, number][] = []
  while (y < height) {
    const tall = Math.min(height - y, [1, 1, 2, 2, 3, 5, 8][Math.floor(hash(props.id, 100 + row) * 7)]!)
    let runs: [number, number, number][] = []
    if (row > 0 && hash(props.id, 200 + row) < 0.45) runs = last.map(([x, w, c]) => [Math.max(0, Math.min(width - w, x + Math.round((hash(props.id, 300 + row) - 0.5) * 6))), w, c])
    else {
      const count = 1 + Math.floor(hash(props.id, 400 + row) * (props.wide ? 7 : 4))
      for (let index = 0; index < count; index++) {
        const w = 2 + Math.floor(hash(props.id, 500 + row * 16 + index) ** 2 * width * 0.7)
        const x = Math.floor(hash(props.id, 600 + row * 16 + index) * (width - 1))
        runs.push([x, Math.min(w, width - x), 1 + Math.floor(hash(props.id, 700 + row * 16 + index) ** 1.6 * 3)])
      }
    }
    for (const [x, w, c] of runs) paths[c] += `M${x} ${y}h${w}v${tall}h-${w}z`
    last = runs
    y += tall
    row++
  }
  const dots = `d-${props.id.replace(/[^a-z0-9]/gi, '')}${props.wide ? 'w' : ''}`
  return (
    <svg aria-hidden="true" className="art" preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges" viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <pattern height="1" id={dots} patternUnits="userSpaceOnUse" width="1">
          <rect fill={colors[0]} height="1" width="1" />
          <rect fill={colors[1]} height=".5" width=".5" />
          <rect fill={colors[1]} height=".5" width=".5" x=".5" y=".5" />
        </pattern>
      </defs>
      <rect fill={colors[0]} height={height} width={width} />
      <path d={paths[1]} fill={`url(#${dots})`} />
      <path d={paths[2]} fill={colors[2]} />
      <path d={paths[3]} fill={colors[3]} />
    </svg>
  )
}
