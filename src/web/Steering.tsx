import { useEffect, useSyncExternalStore } from 'react'
import type { Detail, Me, Roster, Steering as Policy } from '../shared/Api.ts'
import * as Api from './api.ts'
import { useWallet } from './hooks.ts'
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
