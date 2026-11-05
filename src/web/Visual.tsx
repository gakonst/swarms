import { useEffect, useRef, useState } from 'react'
import type { Detail, Status as Kind, Summary } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import { duration, minute, ratio, usd } from './format.ts'
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

export function Bar(props: { swarm: Pick<Summary, 'raised' | 'remaining' | 'spent' | 'status'> }) {
  const spent = ratio(props.swarm.spent, props.swarm.raised)
  return (
    <div className="bar" data-status={props.swarm.status}>
      <div className="bar-track">
        <div className="bar-spent" style={{ width: `${spent * 100}%` }} />
      </div>
      <div className="bar-legend">
        <span>{usd(props.swarm.spent)} spent</span>
        <span>
          {usd(props.swarm.remaining)} left of {usd(props.swarm.raised)}
        </span>
      </div>
    </div>
  )
}

export type Mood = 'live' | 'money' | 'resting' | 'errors' | 'new' | 'done'

export type Standing = { action: string | null; label: string; line: string; mood: Mood }

type Stood = Pick<Detail, 'raised' | 'reason' | 'status' | 'updatedAt' | 'why' | 'working'>

export function standing(swarm: Stood, now: number): Standing {
  if (swarm.status === 'done') return { action: null, label: 'Finished', line: 'Finished. Its result stays here for anyone to read.', mood: 'done' }
  if (swarm.status === 'running') return { action: null, label: 'Running', line: swarm.working ? `On it for ${duration(now - swarm.working.since)}.` : 'Starting up.', mood: 'live' }
  const said = swarm.reason ? Answer.local(Answer.spoken(swarm.reason) ?? '', swarm.updatedAt, minute) : ''
  if (swarm.status === 'funding' && Number(swarm.raised) <= 0) return { action: 'Fund $2 to start it', label: 'Not started', line: 'Nobody has funded this yet.', mood: 'new' }
  if (swarm.why === 'idle') return { action: null, label: 'Resting', line: said || 'Resting: a note or new money wakes it.', mood: 'resting' }
  if (swarm.why === 'rest') return { action: null, label: 'Stopped after errors', line: said || 'Stopped after errors. New money or a note restarts it.', mood: 'errors' }
  if (swarm.status === 'funding') return { action: 'Add $2 to start it', label: 'Not started', line: said || 'Its funds cannot pay for a first step yet.', mood: 'money' }
  return { action: 'Add $2 to wake it', label: 'Needs money', line: said || 'Out of money. Fund it to keep going.', mood: 'money' }
}

export function useStanding(swarm: Stood) {
  const now = useNow(1000, swarm.status === 'running' && !!swarm.working)
  return standing(swarm, now)
}

export function Dot(props: { swarm: Stood }) {
  const stood = useStanding(props.swarm)
  return <i aria-label={stood.label} className="mood-dot" data-mood={stood.mood} role="img" title={stood.label} />
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
        <span className="energy-state">{stood.label}</span>
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
