import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Chatter, Detail, Lobby, Part, Pulse } from '../shared/Api.ts'
import * as Api from './api.ts'
import { usePoll } from './hooks.ts'

export type Mode = 'listen' | 'room'

export type Cause = 'changed' | 'welcome'

export type Signal = Chatter | { type: 'open' | 'closed' } | { cause: Cause; parts: readonly Part[]; type: 'stir' }

export type State = 'opening' | 'live' | 'down'

export const parts = ['artifacts', 'branches', 'code', 'detail', 'feed', 'hands', 'members', 'roster'] as const satisfies readonly Part[]

const lingerMs = 5000

const welcomeMs = 4000

type Wire = {
  applied: string | undefined
  held: Map<Part, Cause>
  line: Api.Line
  linger: ReturnType<typeof setTimeout> | undefined
  listeners: Set<(signal: Signal) => void>
  open: boolean
  state: State
  users: number
  welcomed: number
}

const wires = new Map<string, Wire>()

const watchers = new Set<() => void>()

function named(id: string, mode: Mode) {
  return `${mode}:${id}`
}

function notify() {
  for (const watcher of watchers) watcher()
}

function dispatch(wire: Wire, signal: Signal) {
  for (const listener of [...wire.listeners]) listener(signal)
}

function stir(wire: Wire, stirred: readonly Part[], cause: Cause) {
  if (document.visibilityState === 'hidden') {
    for (const part of stirred) if (wire.held.get(part) !== 'welcome') wire.held.set(part, cause)
    return
  }
  dispatch(wire, { cause, parts: stirred, type: 'stir' })
}

function heard(wire: Wire, event: Chatter | { type: 'open' | 'closed' }) {
  if (event.type === 'open' || event.type === 'closed') wire.open = event.type === 'open'
  if (event.type === 'closed') {
    if (wire.state !== 'down') {
      wire.state = 'down'
      notify()
    }
  }
  if (event.type === 'welcome') {
    wire.welcomed += 1
    if (wire.state !== 'live') {
      wire.state = 'live'
      notify()
    }
    const known = wire.applied
    wire.applied = event.version
    if (wire.welcomed > 1 || event.version !== known) stir(wire, parts, 'welcome')
    return
  }
  if (event.type === 'pulse' || event.type === 'changed') wire.applied = event.version
  dispatch(wire, event)
  if (event.type === 'changed') stir(wire, event.parts, 'changed')
}

function released() {
  if (document.visibilityState === 'hidden') return
  for (const wire of wires.values()) {
    if (!wire.held.size) continue
    const held = [...wire.held]
    wire.held.clear()
    for (const cause of ['welcome', 'changed'] as const) {
      const stirred = held.flatMap(([part, why]) => (why === cause ? [part] : []))
      if (stirred.length) dispatch(wire, { cause, parts: stirred, type: 'stir' })
    }
  }
}

let watching = false

function open(id: string, mode: Mode) {
  if (!watching) {
    watching = true
    document.addEventListener('visibilitychange', released)
  }
  const wire: Wire = { applied: undefined, held: new Map(), line: Api.chatter(id, mode === 'listen', (event) => heard(wire, event)), linger: undefined, listeners: new Set(), open: false, state: 'opening', users: 0, welcomed: 0 }
  setTimeout(() => {
    if (wire.state !== 'opening') return
    wire.state = 'down'
    notify()
  }, welcomeMs)
  wires.set(named(id, mode), wire)
  return wire
}

export function join(id: string, mode: Mode, listener: (signal: Signal) => void) {
  const name = named(id, mode)
  const wire = wires.get(name) ?? open(id, mode)
  clearTimeout(wire.linger)
  wire.users += 1
  wire.listeners.add(listener)
  return () => {
    wire.listeners.delete(listener)
    wire.users -= 1
    if (wire.users > 0) return
    wire.linger = setTimeout(() => {
      if (wire.users > 0) return
      wire.line.close()
      wires.delete(name)
      notify()
    }, lingerMs)
  }
}

export function state(id: string, mode: Mode): State {
  return wires.get(named(id, mode))?.state ?? 'opening'
}

export function connected(id: string, mode: Mode = 'room') {
  return wires.get(named(id, mode))?.open ?? false
}

export function live(id: string, mode: Mode = 'room') {
  return state(id, mode) === 'live'
}

export function line(id: string) {
  return wires.get(named(id, 'room'))?.line
}

function watch(listener: () => void) {
  watchers.add(listener)
  return () => {
    watchers.delete(listener)
  }
}

export function useWire(id: string, mode: Mode, listener?: (signal: Signal) => void): State {
  const handler = useRef(listener)
  useEffect(() => {
    handler.current = listener
  })
  useEffect(() => join(id, mode, (signal) => handler.current?.(signal)), [id, mode])
  return useSyncExternalStore(watch, () => state(id, mode), () => 'opening' as const)
}

type Hall = { close: () => void; linger: ReturnType<typeof setTimeout> | undefined; listeners: Set<(event: Lobby) => void>; state: State; users: number }

let hall: Hall | undefined

function opened() {
  const made: Hall = {
    close: Api.lobby((event) => {
      if (event.type === 'closed' || event.type === 'welcome') {
        made.state = event.type === 'welcome' ? 'live' : 'down'
        notify()
      }
      if (event.type === 'welcome' || event.type === 'swarm') for (const listener of [...made.listeners]) listener(event)
    }),
    linger: undefined,
    listeners: new Set(),
    state: 'opening',
    users: 0,
  }
  setTimeout(() => {
    if (made.state !== 'opening') return
    made.state = 'down'
    notify()
  }, welcomeMs)
  return made
}

export function enter(listener: (event: Lobby) => void) {
  const current = (hall ??= opened())
  clearTimeout(current.linger)
  current.users += 1
  current.listeners.add(listener)
  return () => {
    current.listeners.delete(listener)
    current.users -= 1
    if (current.users > 0) return
    current.linger = setTimeout(() => {
      if (current.users > 0 || hall !== current) return
      current.close()
      hall = undefined
      notify()
    }, lingerMs)
  }
}

export function useLobby(listener: (event: Lobby) => void): State {
  const handler = useRef(listener)
  useEffect(() => {
    handler.current = listener
  })
  useEffect(() => enter((event) => handler.current(event)), [])
  return useSyncExternalStore(watch, () => hall?.state ?? 'opening', () => 'opening' as const)
}

const listMs = 60_000

export function useSwarms() {
  const lobby = useLobby((event) => {
    if (event.type === 'welcome') reload()
    else set((data) => data && { swarms: [event.swarm, ...data.swarms.filter((swarm) => swarm.id !== event.swarm.id)] })
  })
  const [list, reload, set] = usePoll(() => Api.swarms(), lobby === 'down' ? listMs : null, 'swarms', { keep: true })
  return list
}

export function pulsed(detail: Detail | undefined, pulse: Pulse): Detail | undefined {
  return detail && { ...detail, ...pulse.swarm, hands: pulse.hands, reason: pulse.reason, why: pulse.why, working: pulse.working }
}

export function stirred(signal: Signal, part: Part) {
  return signal.type === 'stir' && signal.parts.includes(part)
}
