import type { MouseEvent } from 'react'
import { href, navigate } from './router.tsx'

export const cells = ['proven', 'dead', 'spent', 'flight', 'open'] as const

export type Cell = (typeof cells)[number]

export type Hive = { cells: Record<Cell, number>; detail: string; id: string; live: boolean; old: boolean; path: string; title: string }

type Frame = { gap: number; height: number; label: number; most: number; width: number }

const frames = {
  tall: { gap: 10, height: 450, label: 13, most: 7, width: 450 },
  wide: { gap: 11, height: 560, label: 15, most: 14, width: 1368 },
} satisfies Record<string, Frame>

type Spot = { h: number; hive: Hive; k: number; r: number; w: number; x: number; y: number }

function hash(text: string) {
  let value = 2166136261
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  return (value >>> 0) / 4294967296
}

function total(hive: Hive) {
  return cells.reduce((sum, cell) => sum + hive.cells[cell], 0)
}

function reach(count: number, gap: number) {
  return gap * Math.sqrt((count + 3) / Math.PI) + gap / 2
}

function marks(hive: Hive, gap: number) {
  const out: Record<Cell, string> = { dead: '', flight: '', open: '', proven: '', spent: '' }
  const b = gap / (Math.PI * 2)
  const start = hash(hive.id) * Math.PI * 2
  const half = gap * 0.36
  let index = 0
  for (const cell of cells)
    for (let count = 0; count < hive.cells[cell]; count++, index++) {
      const theta = Math.sqrt((2 * (index + 3) * gap) / b)
      const x = b * theta * Math.cos(theta + start)
      const y = b * theta * Math.sin(theta + start)
      out[cell] += `M${(x - half).toFixed(1)} ${y.toFixed(1)}h${(half * 2).toFixed(1)}M${x.toFixed(1)} ${(y - half).toFixed(1)}v${(half * 2).toFixed(1)}`
    }
  return out
}

function name(text: string, room: number, size: number) {
  const most = Math.max(8, Math.floor(room / (size * 0.5)))
  return text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text
}

function fit(hives: readonly Hive[], frame: Frame, k: number) {
  const spots: Spot[] = []
  const pad = frame.gap * 1.6
  const step = frame.gap
  for (const hive of hives) {
    const r = reach(total(hive), frame.gap) * k
    const w = Math.max(r * 2, frame.label * 9)
    const h = r * 2 + frame.label * 2.7
    let best: { d: number; x: number; y: number } | undefined
    for (let y = pad + r; y + h - r <= frame.height - pad; y += step)
      for (let x = pad + w / 2; x + w / 2 <= frame.width - pad; x += step) {
        const free = spots.every((spot) => Math.abs(spot.x - x) * 2 >= spot.w + w + pad || Math.abs(spot.y + spot.h / 2 - spot.r - (y + h / 2 - r)) * 2 >= spot.h + h + pad)
        if (!free) continue
        const d = ((x - frame.width / 2) / frame.width) ** 2 + ((y + h / 2 - r - frame.height / 2) / frame.height) ** 2 + hash(`${hive.id}${x}${y}`) * 0.004
        if (!best || d < best.d) best = { d, x, y }
      }
    if (best) spots.push({ h, hive, k, r, w, x: best.x, y: best.y })
  }
  return spots
}

function plan(hives: readonly Hive[], frame: Frame) {
  const shown = [...hives].slice(0, frame.most).sort((a, b) => total(b) - total(a))
  const room = shown.reduce((sum, hive) => {
    const r = reach(total(hive), frame.gap)
    return sum + Math.max(r * 2, frame.label * 9) * (r * 2 + frame.label * 2.7)
  }, 0)
  let k = Math.min(1.7, Math.max(0.6, Math.sqrt((frame.width * frame.height * 0.3) / Math.max(1, room))))
  let spots = fit(shown, frame, k)
  for (let tries = 0; tries < 8 && spots.length < shown.length; tries++) {
    k *= 0.88
    spots = fit(shown, frame, k)
  }
  return spread(spots, frame)
}

function spread(spots: readonly Spot[], frame: Frame) {
  if (spots.length < 2) return spots
  const pad = frame.gap * 1.6
  const mid = (spot: Spot) => spot.y - spot.r + spot.h / 2
  const xs = spots.map((spot) => spot.x)
  const ys = spots.map(mid)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const sx = Math.min(...spots.map((spot) => (spot.x === cx ? Infinity : (frame.width / 2 - pad - spot.w / 2) / Math.abs(spot.x - cx))))
  const sy = Math.min(...spots.map((spot) => (mid(spot) === cy ? Infinity : (frame.height / 2 - pad - spot.h / 2) / Math.abs(mid(spot) - cy))))
  const ax = Math.min(2.2, Math.max(1, sx))
  const ay = Math.min(2.2, Math.max(1, sy))
  return spots.map((spot) => ({ ...spot, x: frame.width / 2 + (spot.x - cx) * ax, y: frame.height / 2 + (mid(spot) - cy) * ay - spot.h / 2 + spot.r }))
}

function Sky(props: { frame: Frame; hives: readonly Hive[]; shape: string }) {
  const { frame } = props
  return (
    <svg className={`field field-${props.shape}`} preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${frame.width} ${frame.height}`}>
      {plan(props.hives, frame).map((spot) => {
        const drawn = marks(spot.hive, frame.gap * spot.k)
        return (
          <a aria-label={`${spot.hive.title}, ${spot.hive.detail}`} className="hive" data-live={spot.hive.live} data-old={spot.hive.old} data-path={spot.hive.path} href={href(spot.hive.path)} key={spot.hive.id}>
            <rect fill="transparent" height={spot.h} width={spot.w} x={spot.x - spot.w / 2} y={spot.y - spot.r} />
            <g transform={`translate(${spot.x.toFixed(1)} ${spot.y.toFixed(1)})`}>
              <g className="hive-spin" strokeWidth={Math.max(1.3, 1.5 * spot.k)}>
                {cells.map((cell) => drawn[cell] && <path className={`mark mark-${cell}`} d={drawn[cell]} key={cell} />)}
              </g>
            </g>
            <text className="hive-title" fontSize={frame.label} textAnchor="middle" x={spot.x} y={spot.y + spot.r + frame.label * 1.1}>{name(spot.hive.title, spot.w, frame.label)}</text>
            <text className="hive-detail" fontSize={frame.label * 0.68} textAnchor="middle" x={spot.x} y={spot.y + spot.r + frame.label * 2.15}>{spot.hive.detail}</text>
          </a>
        )
      })}
    </svg>
  )
}

function open(event: MouseEvent) {
  const link = event.target instanceof Element ? event.target.closest<SVGAElement>('a[data-path]') : null
  const path = link?.dataset['path']
  if (!path || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  navigate(path)
}

export function Field(props: { hives: readonly Hive[] }) {
  return (
    <div className="fields" onClick={open}>
      <Sky frame={frames.wide} hives={props.hives} shape="wide" />
      <Sky frame={frames.tall} hives={props.hives} shape="tall" />
    </div>
  )
}
