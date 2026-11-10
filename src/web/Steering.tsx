import { type FormEvent, useEffect, useState, useSyncExternalStore } from 'react'
import type { Detail, Me, Roster, Seat, Steering as Policy } from '../shared/Api.ts'
import * as Mention from '../shared/Mention.ts'
import { Alert, explain } from './Alert.tsx'
import * as Api from './api.ts'
import { seeded } from './boot.ts'
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
  const roster = useSyncExternalStore(watch, () => rosters.get(id) ?? seeded<Roster>(`team:${id}`), () => seeded<Roster>(`team:${id}`))
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

export function steerer(steering: Policy, roster: Roster | undefined, address: string | undefined) {
  return steering !== 'team' || !!seated(roster, address)
}

const steerings = [
  ['team', 'You', 'and whoever you add'],
  ['open', 'Every rider', 'with their own money'],
] as const

export function Steered(props: { disabled?: boolean; onPick: (steering: Policy) => void; steering: Policy }) {
  return (
    <div aria-label="Steered by" className="runs" role="radiogroup">
      <p>Steered by</p>
      {steerings.map(([name, label, hint]) => (
        <label data-on={props.steering === name} key={name}>
          <input checked={props.steering === name} disabled={props.disabled} name="steered" onChange={() => props.onPick(name)} type="radio" value={name} />
          <i aria-hidden="true" />
          <span><b>{label}</b> <span>{hint}</span></span>
        </label>
      ))}
    </div>
  )
}

export type Gate = 'checking' | 'signed-out' | 'unnamed' | { at: 'not-member'; team: boolean } | { at: 'open'; from: 'backing' | 'team' | null; left: string | null }

export function gate(wallet: State, steering: Policy, roster: Roster | undefined, room?: { me: Me | null }): Gate {
  if (!wallet.session) return wallet.pending ? 'checking' : 'signed-out'
  if (wallet.account && !wallet.account.name) return 'unnamed'
  const team = steering === 'team'
  const seat = seated(roster, wallet.session.address)
  if (team && seat) return { at: 'open', from: 'team', left: seat.left }
  if (room) {
    if (!room.me) return 'checking'
    return room.me.member || seat ? { at: 'open', from: team ? null : 'backing', left: team ? null : room.me.available } : { at: 'not-member', team }
  }
  if (!team) return { at: 'open', from: 'backing', left: null }
  return roster ? { at: 'not-member', team } : 'checking'
}

export function useGate(swarm: Pick<Detail, 'id' | 'steering'>) {
  const wallet = useWallet()
  return gate(wallet, swarm.steering, useRoster(swarm.id, swarm.steering))
}

function named(seats: readonly Seat[], me: string | undefined) {
  const names = seats.map((seat) => (seat.address === me ? 'you' : Mention.at(seat.handle)))
  return names.length <= 2 ? names.join(' and ') : `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

export function Reins(props: { swarm: Pick<Detail, 'id' | 'steering'> }) {
  const wallet = useWallet()
  const me = wallet.session?.address
  const roster = useRoster(props.swarm.id, props.swarm.steering)
  const [open, setOpen] = useState(false)
  const team = (roster?.steering ?? props.swarm.steering) === 'team'
  const seats = roster?.seats ?? []
  return (
    <>
      <button className="reins" onClick={() => setOpen(true)} type="button">
        Steered by <b>{team ? (seats.length ? named(seats, me) : '…') : 'every rider'}</b>
      </button>
      {open && (
        <div className="sheet reins-sheet" onClick={(event) => event.target === event.currentTarget && setOpen(false)}>
          <div className="sheet-card">
            <button aria-label="Close" className="sheet-close" onClick={() => setOpen(false)} type="button">×</button>
            <Who id={props.swarm.id} me={me} roster={roster} team={team} />
          </div>
        </div>
      )}
    </>
  )
}

function Who(props: { id: string; me: string | undefined; roster: Roster | undefined; team: boolean }) {
  const [member, setMember] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const roster = props.roster
  const admin = !!props.me && !!roster?.admins.includes(props.me as `0x${string}`)
  const who = member.trim()
  const valid = /^0x[0-9a-fA-F]{40}$/.test(who) || !Mention.invalid(who.replace(/^@/, ''))

  const act = async (run: () => Promise<Roster>) => {
    setBusy(true)
    setError(undefined)
    try {
      share(props.id, await run())
      return true
    } catch (reason) {
      setError(message(reason))
      return false
    } finally {
      setBusy(false)
    }
  }

  const add = (event: FormEvent) => {
    event.preventDefault()
    void act(() => Api.seat(props.id, { member: who, role: 'member' })).then((ok) => ok && setMember(''))
  }

  return (
    <section aria-labelledby="reins-title" className="reins-who">
      <h2 id="reins-title">Who steers</h2>
      {admin ? (
        <Steered disabled={busy} onPick={(steering) => void act(() => Api.steering(props.id, { steering }))} steering={props.team ? 'team' : 'open'} />
      ) : (
        <p className="reins-say">{props.team ? 'Only the riders here steer it. Every rider can fund it and talk in its chat.' : 'Every rider steers it with their own money.'}</p>
      )}
      {props.team && (
        <ul className="reins-list">
          {(roster?.seats ?? []).map((seat) => (
            <li key={seat.address}>
              <b>{Mention.at(seat.handle)}</b>
              {seat.address === props.me && <span>you</span>}
              {(admin || seat.address === props.me) && !(seat.role === 'admin' && roster?.admins.length === 1) && (
                <button disabled={busy} onClick={() => void act(() => Api.unseat(props.id, seat.address))} type="button">{seat.address === props.me ? 'Leave' : 'Remove'}</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {admin && props.team && (
        <form className="reins-add" onSubmit={add}>
          <input aria-label="Let a rider steer" autoCapitalize="none" autoComplete="off" disabled={busy} onChange={(event) => setMember(event.target.value)} placeholder="@username or 0x…" spellCheck={false} value={member} />
          <button className="btn btn-high" disabled={busy || !valid} type="submit">Add</button>
        </form>
      )}
      {error && <Alert title={explain(error).title} tone="bad">{explain(error).detail}</Alert>}
    </section>
  )
}
