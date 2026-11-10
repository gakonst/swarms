import { forwardRef, type ReactNode, useState } from 'react'
import * as Answer from '../shared/Answer.ts'
import type { Config, Member, Summary } from '../shared/Api.ts'
import * as Status from '../shared/Status.ts'
import { site } from './boot.ts'
import { Gauge, line } from './Card.tsx'
import { Fuel, type Prefill, type Target } from './Contribute.tsx'
import * as Pay from './pay.ts'
import { Avatar } from './Room.tsx'

export const Box = forwardRef<HTMLElement, {
  config: Config | undefined
  extra?: ReactNode
  first?: boolean
  focus: number
  least?: string | undefined
  locked?: boolean | undefined
  members: readonly Member[]
  note: string
  onDone: (target: Target) => void
  onNote: (note: string) => void
  onOpen: () => void
  onSent?: (target: Target) => void
  open: boolean
  bare?: boolean
  prefill: Prefill
  shared?: boolean
  sign?: boolean
  steers?: boolean
  swarm: Pick<Summary, 'balance' | 'contributors' | 'id' | 'remaining' | 'status' | 'title' | 'why'>
  target: (step: (step: 'create') => void) => Promise<Target>
}>(function Box(props, ref) {
  const swarm = props.swarm
  const stood = Status.standing(swarm)
  const balance = Number(swarm.balance)
  const left = Number(swarm.remaining)
  const backers = props.members.filter((member) => Number(member.backed) > 0)
  const [copied, setCopied] = useState(false)
  const flow = Pay.useFlow(swarm.id)

  const share = async () => {
    const url = `${site()}/s/${swarm.id}`
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
      {!props.bare && (balance > 0 || swarm.contributors > 0) && <div className="box-top">
        <p className="box-balance"><b>{Answer.cash(balance)}</b> balance</p>
        <p className="box-people">
          {backers.length > 0 && <span className="box-faces">{backers.slice(0, 5).map((member) => <Avatar address={member.address} handle={member.handle} key={member.address} size="small" />)}</span>}
          {swarm.contributors > 0 ? `${swarm.contributors} rider${swarm.contributors === 1 ? '' : 's'}` : 'No riders yet'}
        </p>
      </div>}
      {balance > 0 && (
        <p className="box-gauge">
          <Gauge balance={balance} left={left} />
          <span>{Answer.cash(left)} left</span>
        </p>
      )}
      {!props.bare && <p className="box-state" data-mood={stood.mood}>{balance > 0 || swarm.contributors > 0 ? line(stood.word) : 'Be the first to ride it.'}</p>}
      {props.open || flow.at !== 'idle' ? (
        <Fuel config={props.config} extra={props.extra} first={props.first} focus={props.focus} least={props.least} locked={props.locked} note={props.note} onDone={props.onDone} onNote={props.onNote} onSent={props.onSent} prefill={props.prefill} sign={props.sign} slot={swarm.id} steers={props.steers} target={props.target} />
      ) : (
        <button className="btn btn-high fuel-go" onClick={props.onOpen} type="button">Ride it</button>
      )}
      {props.shared !== false && <button className="box-share" onClick={() => void share()} type="button">{copied ? 'Link copied' : 'Share ↗'}</button>}
    </aside>
  )
})
