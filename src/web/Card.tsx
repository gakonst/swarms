import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import * as Status from '../shared/Status.ts'
import { usd } from './format.ts'
import { Link } from './router.tsx'

export type Idea = { backers: number; href: string; id: string; left: number; mood: Status.Mood; pitch: string; raised: number; title: string; word: Status.Word }

export const pill = Status.pill

export const line = Status.line

export const lead = Answer.opening

export function fromSwarm(swarm: Summary): Idea {
  const stood = Status.standing(swarm)
  return { backers: swarm.contributors, href: `/s/${swarm.id}`, id: swarm.id, left: Number(swarm.remaining), mood: stood.mood, pitch: lead(swarm.goal, swarm.title), raised: Number(swarm.raised), title: swarm.title, word: stood.word }
}

export function fromProblem(problem: Problem): Idea {
  return { backers: 0, href: `/new?q=${problem.id}`, id: `idea:${problem.id}`, left: 0, mood: 'new', pitch: problem.hint, raised: 0, title: problem.label, word: 'Not started' }
}

function hash(text: string, seed: number) {
  let value = 2166136261 ^ seed
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  return ((value >>> 0) % 100000) / 100000
}

const tones: Record<Status.Mood, readonly [string, string, string]> = {
  live: ['#e6f3df', '#bfe0ad', '#1a7a3c'],
  money: ['#fbf3e1', '#f1d9a6', '#b8801a'],
  new: ['#f3f6ee', '#e1e9d6', '#6d8e52'],
}

export function Cover(props: { id: string; mood: Status.Mood; weight?: number }) {
  const [from, to, ink] = tones[props.mood]
  const cx = 110 + hash(props.id, 1) * 100
  const cy = 52 + hash(props.id, 2) * 36
  const reach = 30 + Math.min(26, Math.sqrt(Math.max(0, props.weight ?? 0)) * 4)
  const count = 16 + Math.floor(hash(props.id, 3) * 14)
  const dots = Array.from({ length: count }, (_, index) => {
    const angle = hash(props.id, 10 + index) * Math.PI * 2
    const distance = Math.sqrt(hash(props.id, 50 + index)) * reach
    return { r: 1.2 + hash(props.id, 90 + index) * 2.6, x: cx + Math.cos(angle) * distance * 1.5, y: cy + Math.sin(angle) * distance * 0.8 }
  })
  const far = Array.from({ length: 3 }, (_, index) => ({ x: 24 + hash(props.id, 200 + index) * 272, y: 18 + hash(props.id, 210 + index) * 104 }))
  const gradient = `g-${props.id.replace(/[^a-z0-9]/gi, '')}`
  return (
    <svg aria-hidden="true" className="cover" preserveAspectRatio="xMidYMid slice" viewBox="0 0 320 140">
      <defs>
        <linearGradient id={gradient} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect fill={`url(#${gradient})`} height="140" width="320" />
      {far.map((spot, index) => <line key={index} stroke={ink} strokeDasharray="2 4" strokeOpacity=".25" x1={cx} x2={spot.x} y1={cy} y2={spot.y} />)}
      {far.map((spot, index) => <circle cx={spot.x} cy={spot.y} fill="none" key={index} r="3" stroke={ink} strokeOpacity=".4" />)}
      <g className="cover-dots">
        {dots.filter((_, index) => index % 3 === 0).map((dot, index) => <line key={index} stroke={ink} strokeOpacity=".22" x1={cx} x2={dot.x} y1={cy} y2={dot.y} />)}
        {dots.map((dot, index) => <circle cx={dot.x} cy={dot.y} fill={ink} fillOpacity={0.35 + hash(props.id, 120 + index) * 0.55} key={index} r={dot.r} />)}
      </g>
      <circle cx={cx} cy={cy} fill="#fff" r="6" stroke={ink} strokeWidth="2" />
    </svg>
  )
}

export function Pill(props: { word: Status.Word; mood: Status.Mood }) {
  return (
    <span className="pill" data-mood={props.mood}>
      <i />
      {pill(props.word)}
    </span>
  )
}

export function Gauge(props: { left: number; raised: number }) {
  const fill = props.raised > 0 ? Math.min(1, Math.max(0, props.left / props.raised)) : 0
  return (
    <span aria-hidden="true" className="gauge" data-low={fill < 0.15}>
      <i style={{ width: `${Math.round(fill * 1000) / 10}%` }} />
    </span>
  )
}

export function Card(props: { idea: Idea }) {
  const idea = props.idea
  return (
    <li>
      <Link className="card" data={{ 'data-mood': idea.mood }} to={idea.href}>
        <span className="card-cover">
          <Cover id={idea.id} mood={idea.mood} weight={idea.raised} />
          <Pill mood={idea.mood} word={idea.word} />
        </span>
        <span className="card-body">
          <b className="card-title">{idea.title}</b>
          {idea.pitch && <span className="card-pitch">{idea.pitch}</span>}
          <span className="card-stats">
            <span>{idea.raised > 0 ? <><b>{usd(String(idea.raised))}</b> · {idea.backers} backer{idea.backers === 1 ? '' : 's'}</> : 'Be the first backer'}</span>
            <span className="card-go">Back it →</span>
          </span>
        </span>
      </Link>
    </li>
  )
}
