import type { Mood } from '../shared/Status.ts'
import * as Limits from '../shared/Limits.ts'

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
  stuck: [
    ['#ffd166', '#f4f4ee', '#8d8d86', '#161616'],
    ['#ffe29a', '#d9d9d2', '#ff8a5c', '#ffffff'],
    ['#f2c14e', '#e6e6de', '#7a52e0', '#f4f4ee'],
  ],
  new: [
    ['#bfe9e6', '#dff4f2', '#161616', '#49c6c0'],
    ['#9b9b9b', '#8a45f0', '#00ff00', '#c9c9c9'],
    ['#d9d9d2', '#8d8d86', '#7a52e0', '#f4f4ee'],
  ],
}

function hash(text: string, seed: number) {
  let value = Limits.Edge.fnvOffset ^ seed
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), Limits.Edge.fnvPrime)
  value ^= value >>> Limits.WebArt.mixShift
  value = Math.imul(value, Limits.WebArt.mixPrime)
  return ((value ^ (value >>> Limits.WebArt.finalShift)) >>> 0) / Limits.Web.uint32Span
}

export function swatch(id: string, mood: Mood) {
  const set = palettes[mood]
  return set[Math.floor(hash(id, 1) * set.length)]!
}

export function Art(props: { id: string; mood: Mood; wide?: boolean }) {
  const width = props.wide ? Limits.WebArt.wideWidth : Limits.WebArt.width
  const height = Limits.WebArt.height
  const colors = swatch(props.id, props.mood)
  const paths = ['', '', '', '']
  let y = 0
  let row = 0
  let last: [number, number, number][] = []
  while (y < height) {
    const tall = Math.min(height - y, Limits.WebArt.runHeights[Math.floor(hash(props.id, Limits.WebArt.heightSeed + row) * Limits.WebArt.runHeights.length)]!)
    let runs: [number, number, number][] = []
    if (row > 0 && hash(props.id, Limits.WebArt.shiftSeed + row) < Limits.WebArt.shiftShare) runs = last.map(([x, w, c]) => [Math.max(0, Math.min(width - w, x + Math.round((hash(props.id, Limits.WebArt.shiftBySeed + row) - Limits.WebArt.centre) * Limits.WebArt.shiftMost))), w, c])
    else {
      const count = 1 + Math.floor(hash(props.id, Limits.WebArt.countSeed + row) * (props.wide ? Limits.WebArt.wideRuns : Limits.WebArt.runs))
      for (let index = 0; index < count; index++) {
        const w = 2 + Math.floor(hash(props.id, Limits.WebArt.widthSeed + row * Limits.WebArt.seedStride + index) ** 2 * width * Limits.WebArt.widthShare)
        const x = Math.floor(hash(props.id, Limits.WebArt.xSeed + row * Limits.WebArt.seedStride + index) * (width - 1))
        runs.push([x, Math.min(w, width - x), 1 + Math.floor(hash(props.id, Limits.WebArt.colorSeed + row * Limits.WebArt.seedStride + index) ** Limits.WebArt.colorSkew * Limits.WebArt.colors)])
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
      <path d={paths[Limits.WebArt.topLayer]} fill={colors[Limits.WebArt.topLayer]} />
    </svg>
  )
}
