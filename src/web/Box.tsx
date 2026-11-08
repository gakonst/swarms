import { forwardRef, useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Config, Member, Summary } from '../shared/Api.ts'
import * as Status from '../shared/Status.ts'
import { Gauge, line } from './Card.tsx'
import { Fuel, type Prefill, type Target } from './Contribute.tsx'
import { Avatar } from './Room.tsx'

export const Box = forwardRef<HTMLElement, {
  config: Config | undefined
  focus: number
  least?: string | undefined
  locked?: boolean | undefined
  members: readonly Member[]
  note: string
  onDone: (target: Target) => void
  onNote: (note: string) => void
  onOpen: () => void
  open: boolean
  bare?: boolean
  prefill: Prefill
  shared?: boolean
  swarm: Pick<Summary, 'contributors' | 'id' | 'raised' | 'remaining' | 'status' | 'title' | 'why'>
  target: (step: (step: 'create') => void) => Promise<Target>
}>(function Box(props, ref) {
  const swarm = props.swarm
  const stood = Status.standing(swarm)
  const raised = Number(swarm.raised)
  const left = Number(swarm.remaining)
  const backers = props.members.filter((member) => Number(member.backed) > 0)
  const [copied, setCopied] = useState(false)

  const share = async () => {
    const url = `${location.origin}/s/${swarm.id}`
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: swarm.title, url })
      else {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch {}
  }

  return (
    <aside className="box" data-open={props.open} id="back" ref={ref}>
      {!props.bare && (raised > 0 || swarm.contributors > 0) && <div className="box-top">
        <p className="box-raised"><b>{Answer.cash(raised)}</b> raised</p>
        <p className="box-people">
          {backers.length > 0 && <span className="box-faces">{backers.slice(0, 5).map((member) => <Avatar address={member.address} handle={member.handle} key={member.address} size="small" />)}</span>}
          {swarm.contributors > 0 ? `${swarm.contributors} backer${swarm.contributors === 1 ? '' : 's'}` : 'No backers yet'}
        </p>
      </div>}
      {raised > 0 && (
        <p className="box-gauge">
          <Gauge left={left} raised={raised} />
          <span>{Answer.cash(left)} left</span>
        </p>
      )}
      {!props.bare && <p className="box-state" data-mood={stood.mood}>{raised > 0 || swarm.contributors > 0 ? line(stood.word) : 'Be the first to back it.'}</p>}
      {props.open ? (
        <Fuel config={props.config} focus={props.focus} least={props.least} locked={props.locked} note={props.note} onDone={props.onDone} onNote={props.onNote} prefill={props.prefill} target={props.target} />
      ) : (
        <button className="btn btn-high fuel-go" onClick={props.onOpen} type="button">Back it</button>
      )}
      {props.shared !== false && <button className="box-share" onClick={() => void share()} type="button">{copied ? 'Link copied' : 'Share ↗'}</button>}
    </aside>
  )
})
