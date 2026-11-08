import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Detail, Me, Roster, Steering as Policy } from '../shared/Api.ts'
import { Alert, explain } from './Alert.tsx'
import * as Mention from '../shared/Mention.ts'
import * as Api from './api.ts'
import { usd } from './format.ts'
import { message, useWallet } from './hooks.ts'
import type { State } from './wallet.ts'
import * as Wire from './wire.ts'

const rosters = new Map<string, Roster>()
const listeners = new Set<() => void>()

function share(id: string, roster: Roster) {
  rosters.set(id, roster)
  for (const listener of listeners) listener()
}

function watch(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const loops = new Map<string, { count: number; leave: () => void; timer: ReturnType<typeof setInterval> | undefined }>()
const flights = new Map<string, Promise<void>>()

const rosterMs = 60_000

function fetched(id: string) {
  const flying = flights.get(id)
  if (flying) return flying
  const flight = Api.team(id)
    .then((value) => share(id, value), () => {})
    .finally(() => flights.delete(id))
  flights.set(id, flight)
  return flight
}

export function useRoster(id: string, steering: Policy) {
  const roster = useSyncExternalStore(watch, () => rosters.get(id), () => undefined)
  const wired = Wire.useWire(id, 'room')
  useEffect(() => {
    const loop = loops.get(id)
    if (loop) loop.count += 1
    else {
      void fetched(id)
      loops.set(id, {
        count: 1,
        leave: Wire.join(id, 'room', (signal) => {
          if (signal.type === 'roster') share(id, signal.roster)
          else if (Wire.stirred(signal, 'roster')) void fetched(id)
        }),
        timer: undefined,
      })
    }
    return () => {
      const current = loops.get(id)
      if (!current) return
      current.count -= 1
      if (current.count > 0) return
      clearInterval(current.timer)
      current.leave()
      loops.delete(id)
    }
  }, [id, steering])
  useEffect(() => {
    const loop = loops.get(id)
    if (!loop) return
    clearInterval(loop.timer)
    loop.timer = wired === 'down' ? setInterval(() => void fetched(id), rosterMs) : undefined
  }, [id, wired, steering])
  return roster
}

export function seated(roster: Roster | undefined, address: string | undefined) {
  return address ? roster?.seats.find((seat) => seat.address === address.toLowerCase()) : undefined
}

export type Gate = 'checking' | 'signed-out' | 'unnamed' | { at: 'not-member'; team: boolean } | { at: 'open'; from: 'backing' | 'team'; left: string | null }

export function gate(wallet: State, steering: Policy, roster: Roster | undefined, room?: { me: Me | null }): Gate {
  if (!wallet.session) return wallet.pending ? 'checking' : 'signed-out'
  if (wallet.account && !wallet.account.name) return 'unnamed'
  const team = steering === 'team'
  const seat = seated(roster, wallet.session.address)
  if (team && seat) return { at: 'open', from: 'team', left: seat.left }
  if (room) {
    if (!room.me) return 'checking'
    return room.me.member || seat ? { at: 'open', from: 'backing', left: room.me.available } : { at: 'not-member', team }
  }
  if (!team) return { at: 'open', from: 'backing', left: null }
  return roster ? { at: 'not-member', team } : 'checking'
}

export function useGate(swarm: Pick<Detail, 'id' | 'steering'>) {
  const wallet = useWallet()
  return gate(wallet, swarm.steering, useRoster(swarm.id, swarm.steering))
}

export function Steering(props: { onChange: () => void; swarm: Detail }) {
  const wallet = useWallet()
  const me = wallet.session?.address
  const roster = useRoster(props.swarm.id, props.swarm.steering)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [member, setMember] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [budget, setBudget] = useState('')
  const [allowance, setAllowance] = useState('')

  const preset = roster?.memberBudget
  useEffect(() => {
    if (preset !== undefined) setAllowance(preset === null ? '' : String(Number(preset)))
  }, [preset])

  const admin = !!me && !!roster?.admins.includes(me as `0x${string}`)
  const team = (roster?.steering ?? props.swarm.steering) === 'team'
  const amount = (text: string) => (text.trim() === '' ? null : Number(text.replace('$', '')))

  const act = async (run: () => Promise<Roster>) => {
    setBusy(true)
    setError(undefined)
    try {
      share(props.swarm.id, await run())
      props.onChange()
      return true
    } catch (reason) {
      setError(message(reason))
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <details className="steering">
      <summary>
        <b>{team ? 'Its team steers it' : 'Help shape the research'}</b>
        <span>{team ? `${roster?.seats.length ?? 0} on the team, each with a budget of the swarm's money` : 'each with their own money'}</span>
      </summary>
      {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
      {admin && (
        <div aria-label="Who steers" className="steering-choice" role="radiogroup">
          <button aria-checked={!team} disabled={busy} onClick={() => void act(() => Api.steering(props.swarm.id, { steering: 'open' }))} role="radio" type="button">Any backer</button>
          <button aria-checked={team} disabled={busy} onClick={() => void act(() => Api.steering(props.swarm.id, { steering: 'team' }))} role="radio" type="button">Only the team</button>
        </div>
      )}
      {admin && team && (
        <form className="steering-form" onSubmit={(event) => { event.preventDefault(); void act(() => Api.steering(props.swarm.id, { memberBudget: amount(allowance) })) }}>
          <label>Each member's budget, per 30 days <span>$<input disabled={busy} inputMode="decimal" onChange={(event) => setAllowance(event.target.value)} placeholder="no limit" value={allowance} /></span></label>
          <button className="btn btn-low" disabled={busy} type="submit">Save</button>
        </form>
      )}
      {!!roster?.seats.length && (
        <ol className="steering-list">
          {roster.seats.map((seat) => (
            <li key={seat.address}>
              <span className="steering-who">{Mention.at(seat.handle)}{seat.address === me && <span className="tag">you</span>}</span>
              <span className="steering-role">{seat.role}</span>
              <span className="steering-budget">{seat.limit === null ? 'no limit' : `${usd(seat.left ?? '0')} of ${usd(seat.limit)} left`}</span>
              {(admin || seat.address === me) && !(seat.role === 'admin' && roster.admins.length === 1) && (
                <button className="btn btn-minimal" disabled={busy} onClick={() => void act(() => Api.unseat(props.swarm.id, seat.address))} type="button">{seat.address === me ? 'Leave' : 'Remove'}</button>
              )}
            </li>
          ))}
        </ol>
      )}
      {admin && (
        <form
          className="steering-form"
          onSubmit={(event) => {
            event.preventDefault()
            void act(() => Api.seat(props.swarm.id, { ...(budget.trim() ? { budget: amount(budget) } : {}), member: member.trim(), role })).then((ok) => {
              if (ok) {
                setMember('')
                setBudget('')
              }
            })
          }}
        >
          <input aria-label="Wallet to add" disabled={busy} onChange={(event) => setMember(event.target.value)} placeholder="0x… wallet to let steer" value={member} />
          <div aria-label="Role" className="steering-choice" role="radiogroup">
            <button aria-checked={role === 'member'} disabled={busy} onClick={() => setRole('member')} role="radio" type="button">Member</button>
            <button aria-checked={role === 'admin'} disabled={busy} onClick={() => setRole('admin')} role="radio" type="button">Admin</button>
          </div>
          <span>$<input aria-label="Budget per 30 days" disabled={busy} inputMode="decimal" onChange={(event) => setBudget(event.target.value)} placeholder="team's" value={budget} /></span>
          <button className="btn btn-low" disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(member.trim())} type="submit">Add</button>
        </form>
      )}
      {!admin && !team && <p className="steering-note">Chat and share sources here. To sponsor research, write @swarm and your idea; you’ll review its funding before sending it.</p>}
      {!admin && team && !roster?.seats.some((seat) => seat.address === me) && <p className="steering-note">Anyone funds it and talks here; only its team steers. Ask an admin to add you.</p>}
    </details>
  )
}
