import * as Answer from '../shared/Answer.ts'
import type { Cover, Summary } from '../shared/Api.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import * as Status from '../shared/Status.ts'
import { usd } from './format.ts'
import { Tile } from './Cover.tsx'
import { Link } from './router.tsx'

export type Idea = { backers: number; balance: number; cover: Cover | null; href: string; id: string; left: number; mood: Status.Mood; pitch: string; title: string; word: Status.Word }

export const pill = Status.pill

export const line = Status.line

export const lead = Answer.opening

export function fromSwarm(swarm: Summary): Idea {
  const stood = Status.standing(swarm)
  return { backers: swarm.contributors, balance: Number(swarm.balance), cover: swarm.cover, href: `/s/${swarm.id}`, id: swarm.id, left: Number(swarm.remaining), mood: stood.mood, pitch: lead(swarm.goal, swarm.title), title: swarm.title, word: stood.word }
}

export function fromProblem(problem: Problem): Idea {
  return { backers: 0, balance: 0, cover: null, href: `/new?q=${problem.id}`, id: `idea:${problem.id}`, left: 0, mood: 'new', pitch: problem.hint, title: problem.label, word: 'Not started' }
}

export function Pill(props: { word: Status.Word; mood: Status.Mood }) {
  return (
    <span className="pill" data-mood={props.mood}>
      <i />
      {pill(props.word)}
    </span>
  )
}

export function Gauge(props: { balance: number; left: number }) {
  const fill = props.balance > 0 ? Math.min(1, Math.max(0, props.left / props.balance)) : 0
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
        <Tile className="card-art" cover={idea.cover} id={idea.id} mood={idea.mood} />
        <span className="card-body">
          <b className="card-title">{idea.title}</b>
          {idea.pitch && <span className="card-pitch">{idea.pitch}</span>}
          <span className="card-stats">
            <i />
            {pill(idea.word)}
            {idea.balance > 0 && <> · {usd(String(idea.balance))} · {idea.backers} rider{idea.backers === 1 ? '' : 's'}</>}
          </span>
        </span>
      </Link>
    </li>
  )
}
