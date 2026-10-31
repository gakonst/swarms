import { useState } from 'react'
import type { Detail, Entry, Researcher } from '../shared/Api.ts'
import { ago, usd } from './format.ts'
import { useNow } from './hooks.ts'
import { Markdown } from './Markdown.tsx'

const labels = { pending: 'Joining', running: 'Exploring', completed: 'Reported', failed: 'Needs help', interrupted: 'Paused', closing: 'Stopping', closed: 'Stopped' } as const

export function Mission(props: { swarm: Detail; entries: readonly Entry[] }) {
  const swarm = props.swarm
  const [selectedRound, setRound] = useState<number>()
  const [selected, setSelected] = useState('lead')
  const now = useNow(5000)
  const round = swarm.history.find((item) => item.n === selectedRound) ?? swarm.history.at(-1)
  const number = round?.n ?? 1
  const active = round?.status === 'running' && swarm.status === 'running'
  const latest = props.entries.findLast((entry) => entry.round === number && (entry.kind === 'tool' || entry.kind === 'message'))
  const lead: Researcher = {
    id: 'lead', name: 'Lead researcher', task: 'Coordinate the expedition and bring the findings together.', parent: null, round: number,
    state: round?.status === 'completed' ? 'completed' : round?.status === 'failed' ? 'failed' : active ? 'running' : swarm.status === 'paused' ? 'interrupted' : 'pending',
    action: active ? latest?.text ?? 'Planning the next experiment' : round?.status === 'completed' ? 'Round report delivered' : 'Waiting for the next round',
    output: round?.status === 'completed' ? round.message : null, updatedAt: round?.endedAt ?? latest?.at ?? swarm.updatedAt, events: 0, toolsCompleted: 0, lastSequence: 0,
  }
  const researchers = (swarm.researchers ?? []).filter((item) => item.round === number)
  const party = [lead, ...researchers]
  const current = party.find((item) => item.id === selected) ?? lead
  const reached = current.state === 'completed' ? 3 : current.state === 'running' ? 2 : 1
  const select = (id: string) => {
    setSelected(id)
    if (matchMedia('(max-width: 799px)').matches) requestAnimationFrame(() => document.getElementById('researcher-detail')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }))
  }
  return (
    <section aria-label="Quest progress" className="mission">
      <div className="mission-summary"><div><span className="label">Expedition progress</span><h2>{active ? `Round ${number} is underway` : swarm.status === 'done' ? 'Expedition complete' : round ? `Round ${number}` : 'Ready when you are'}</h2></div><div className="mission-fuel"><span className="label">Left to spend</span><span>{usd(swarm.remaining)}</span></div></div>
      <ol aria-label="Research rounds" className="round-trail">
        {swarm.history.slice(-6).map((item) => <li key={item.n}><button aria-pressed={item.n === number} data-state={item.status} onClick={() => { setRound(item.n); setSelected('lead') }} type="button"><span>{item.status === 'completed' ? '✓' : item.status === 'failed' ? '!' : item.status === 'running' ? '◉' : '−'}</span>Round {item.n}</button></li>)}
        {swarm.history.length === 0 && <li className="round-upcoming">Round 1 · waiting for money</li>}
      </ol>
      <div className="mission-camp">
        <div className="mission-camp-label"><span>Your research party</span><span>{researchers.length ? `${party.length} tracked` : `${Math.max(1, swarm.workers)} researchers`}</span></div>
        <div aria-label="Research team" className="party">
          {party.map((member, index) => <button aria-controls="researcher-detail" aria-pressed={current.id === member.id} className="party-member" data-state={member.state} key={member.id} onClick={() => select(member.id)} type="button"><span aria-hidden="true" className="researcher-avatar"><i /><i /><b>{member.state === 'completed' ? '✓' : String(index + 1).padStart(2, '0')}</b></span><span className="party-name">{member.name}</span><span className="party-state">{labels[member.state]}</span></button>)}
        </div>
        {!researchers.length && swarm.workers > 1 && <p className="party-untracked">{swarm.workers - 1} subagents · individual tracking starts with new events.</p>}
      </div>
      <div aria-live="polite" className="researcher-detail" id="researcher-detail">
        <div className="researcher-detail-head"><h3>{current.name}</h3><span className="researcher-status" data-state={current.state}>{labels[current.state]}</span></div>
        <ol aria-label="Researcher progress" className="agent-trail">{['Joined', 'Working', 'Reported'].map((label, index) => <li data-reached={index < reached} key={label}><i aria-hidden="true" />{label}</li>)}</ol>
        <p className="researcher-action">{current.action ?? 'Waiting for an update'}</p>
        <p className="researcher-time">Updated {ago(current.updatedAt, now)}{current.id !== 'lead' && ` · ${current.toolsCompleted} actions finished`}</p>
        <details className="game-details"><summary>The assignment</summary><p>{current.task || 'Assignment details were not included in this event.'}</p>{current.parent && <p>Parent: {party.find((item) => item.id === current.parent)?.name ?? current.parent}</p>}</details>
        {current.output && <details className="game-details"><summary>Read the result</summary><Markdown text={current.output} /></details>}
      </div>
    </section>
  )
}
