import { useEffect, useRef, useState } from 'react'
import type { Detail, Status as Kind } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Statuses from '../shared/Status.ts'
import { duration, minute } from './format.ts'
import { useNow } from './hooks.ts'

const labels = { done: 'Done', funding: 'Funding', paused: 'Paused', running: 'Running' } as const satisfies Record<Kind, string>

export function Status(props: { status: Kind }) {
  return (
    <span className="status" data-status={props.status}>
      <i />
      {labels[props.status]}
    </span>
  )
}

export type Standing = Statuses.Standing & { line: string }

type Stood = Statuses.Stood & Pick<Detail, 'reason' | 'updatedAt' | 'working'>

const lines: Record<Statuses.Word, string> = {
  'Needs money': 'Out of money. Fund it to keep going.',
  'Not started': 'Its funds cannot pay for a first step yet.',
  Resting: 'Resting: a note or new money wakes it.',
  Running: 'Starting up.',
  Starting: 'Starting up: its agent gets the brief in a moment.',
  'Stopped after errors': 'Stopped after errors. New money or a note restarts it.',
}

export function standing(swarm: Stood, now: number): Standing {
  const stood = Statuses.standing(swarm)
  if (stood.word === 'Running' && swarm.working?.stalled && swarm.working.progressed !== undefined)
    return { ...stood, line: `On it for ${duration(now - swarm.working.since)}, no progress for ${duration(now - swarm.working.progressed)}.` }
  if (stood.word === 'Running') return { ...stood, line: swarm.working ? `On it for ${duration(now - swarm.working.since)}.` : lines.Running }
  if (stood.mood === 'new') return { ...stood, line: 'Nobody has funded this yet.' }
  const said = stood.word === 'Starting' || !swarm.reason ? '' : Answer.local(Answer.spoken(swarm.reason) ?? '', swarm.updatedAt, minute)
  return { ...stood, line: said || lines[stood.word] }
}

export function useStanding(swarm: Stood) {
  const now = useNow(1000, swarm.status === 'running' && !!swarm.working)
  return standing(swarm, now)
}

export function Dot(props: { swarm: Stood }) {
  const stood = useStanding(props.swarm)
  return <i aria-label={stood.word} className="mood-dot" data-mood={stood.mood} role="img" title={stood.word} />
}

export function Energy(props: { onFund?: (() => void) | undefined; swarm: Stood & Pick<Detail, 'remaining'> }) {
  const stood = useStanding(props.swarm)
  const left = Number(props.swarm.remaining)
  const raised = Number(props.swarm.raised)
  const fill = raised > 0 ? Math.min(1, Math.max(0, left / raised)) : 0
  const before = useRef(left)
  const [charging, setCharging] = useState(false)
  useEffect(() => {
    if (left > before.current + 1e-6) {
      setCharging(true)
      const timer = setTimeout(() => setCharging(false), 1600)
      before.current = left
      return () => clearTimeout(timer)
    }
    before.current = left
  }, [left])
  const primary = !!(props.onFund && stood.action)
  return (
    <div className="energy" data-charging={charging} data-low={fill < 0.15} data-mood={stood.mood} data-primary={primary} data-status={props.swarm.status}>
      <div className="energy-row">
        <span className="energy-state">{stood.word}</span>
        <span aria-label={`${Answer.cash(left)} left to spend of ${Answer.cash(raised)} raised`} className="energy-bar" onClick={props.onFund} role="img">
          <i style={{ width: `${fill * 100}%` }} />
          <b>{Answer.cash(left)} left</b>
        </span>
        <span className="energy-total">{Answer.cash(raised)} raised</span>
        {props.onFund && (
          <button className="energy-fund" data-primary={primary} onClick={props.onFund} type="button">
            {primary ? stood.action : 'Fund'}
          </button>
        )}
      </div>
      <p aria-live="polite" className="energy-line">{stood.line}</p>
    </div>
  )
}
