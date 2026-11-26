import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import * as Limits from '../shared/Limits.ts'
import * as Api from './api.ts'
import { message } from './hooks.ts'

export type Owed = { amount: string; hash: string; node?: string | undefined; note: string; parent?: string | undefined; started?: boolean | undefined; swarm: string; title?: string | undefined }

export type Why = 'broke' | 'cancelled' | 'offline' | 'other'

export type Act =
  | { at: 'idle' }
  | { at: 'signing' }
  | { at: 'creating' }
  | { at: 'paying' }
  | { at: 'counting'; owed: Owed; tries: number }
  | { at: 'owed'; owed: Owed; tries: number }
  | { amount: string; at: 'counted'; node?: string | undefined; parent?: string | undefined; started?: boolean | undefined; swarm: string; title?: string | undefined }
  | { at: 'failed'; error: string; why: Why }
  | { at: 'refused'; error: string; owed: Owed }

export type Event =
  | { creates: boolean; signed: boolean; type: 'start' }
  | { type: 'signed' }
  | { type: 'created' }
  | { owed: Owed; type: 'sent' }
  | { type: 'counted' }
  | { type: 'later' }
  | { error: string; type: 'refused' }
  | { error: string; type: 'failed' }
  | { type: 'retry' }
  | { type: 'reset' }

export type Counted = { at: 'counted' } | { at: 'later' } | { at: 'refused'; reason: string }

export const idle: Act = { at: 'idle' }

export const retries = Limits.Pay.retryMs

export function slot(swarm: string, node?: string) {
  return node ? `${swarm}/n/${node}` : swarm
}

export function proposing(swarm: string, parent: string) {
  return `${swarm}/propose/${parent}`
}

function home(owed: Owed) {
  return slot(owed.swarm, owed.node)
}

export function why(error: string): Why {
  if (/declined|rejected|denied|cancel|closed the/i.test(error)) return 'cancelled'
  if (/less than|insufficient|too little|balance/i.test(error)) return 'broke'
  if (/fetch|network|unavailable|not answering|timeout/i.test(error)) return 'offline'
  return 'other'
}

function startable(act: Act) {
  return act.at === 'idle' || act.at === 'failed' || act.at === 'counted' || act.at === 'refused'
}

export function next(act: Act, event: Event): Act | null {
  switch (event.type) {
    case 'start':
      return startable(act) ? (event.creates && !event.signed ? { at: 'signing' } : event.creates ? { at: 'creating' } : { at: 'paying' }) : null
    case 'signed':
      return act.at === 'signing' ? { at: 'creating' } : null
    case 'created':
      return act.at === 'creating' ? { at: 'paying' } : null
    case 'sent':
      return act.at === 'paying' ? { at: 'counting', owed: event.owed, tries: 0 } : null
    case 'counted':
      return act.at === 'counting' ? { amount: act.owed.amount, at: 'counted', node: act.owed.node, parent: act.owed.parent, started: act.owed.started, swarm: act.owed.swarm, title: act.owed.title } : null
    case 'later':
      return act.at === 'counting' ? { at: 'owed', owed: act.owed, tries: act.tries } : null
    case 'refused':
      return act.at === 'counting' ? { at: 'refused', error: event.error, owed: act.owed } : null
    case 'failed':
      return act.at === 'signing' || act.at === 'creating' || act.at === 'paying' ? { at: 'failed', error: event.error, why: why(event.error) } : null
    case 'retry':
      return act.at === 'owed' ? { at: 'counting', owed: act.owed, tries: act.tries + 1 } : null
    case 'reset':
      return act.at === 'counted' || act.at === 'failed' || act.at === 'refused' ? idle : null
  }
}

export function busy(act: Act) {
  return act.at === 'signing' || act.at === 'creating' || act.at === 'paying' || act.at === 'counting'
}

export function sent(act: Act) {
  return act.at === 'counting' || act.at === 'owed' || act.at === 'refused' ? act.owed : undefined
}

export function code(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
}

const kept = 'swarms.owed'

let saved: { all: readonly Owed[]; raw: string | null } = { all: [], raw: null }

const acts = new Map<string, Act>()

const derived = new WeakMap<Owed, Act & { at: 'owed' }>()

const tried = new Map<string, number>()

const watchers = new Map<string, Set<() => void>>()

const heard = new Set<(slot: string, act: Act) => void>()

const timers = new Map<string, ReturnType<typeof setTimeout>>()

let version = 0

function notify() {
  version += 1
  for (const listeners of [...watchers.values()]) for (const listener of [...listeners]) listener()
}

function owing(): readonly Owed[] {
  if (Api.fixture) return saved.all
  try {
    const raw = localStorage.getItem(kept)
    if (raw !== saved.raw) {
      const all: unknown = raw ? JSON.parse(raw) : []
      saved = { all: Array.isArray(all) ? (all as Owed[]).filter((each) => typeof each?.hash === 'string' && typeof each?.swarm === 'string') : [], raw }
    }
  } catch {}
  return saved.all
}

function keep(all: readonly Owed[]) {
  const raw = JSON.stringify(all)
  let stored = saved.raw
  try {
    if (!Api.fixture) {
      localStorage.setItem(kept, raw)
      stored = raw
    }
  } catch {}
  saved = { all, raw: stored }
}

function without(owed: Owed) {
  return owing().filter((each) => each.hash !== owed.hash)
}

export function flow(slot: string): Act {
  const act = acts.get(slot)
  if (act) return act
  const owed = owing().find((each) => home(each) === slot)
  if (!owed) return idle
  const tries = tried.get(owed.hash) ?? 0
  const known = derived.get(owed)
  if (known?.tries === tries) return known
  const waiting = { at: 'owed', owed, tries } as const
  derived.set(owed, waiting)
  return waiting
}

export function can(slot: string, event: Event) {
  return next(flow(slot), event) !== null
}

export function move(slot: string, event: Event) {
  const from = flow(slot)
  const to = next(from, event)
  if (!to) throw new Error(`A payment cannot go from ${from.at} on ${event.type}.`)
  const at = event.type === 'sent' ? home(event.owed) : slot
  if (at !== slot) acts.delete(slot)
  if (to.at === 'owed') tried.set(to.owed.hash, to.tries)
  if (to.at === 'idle' || to.at === 'owed') acts.delete(at)
  else acts.set(at, to)
  schedule(at, to)
  notify()
  for (const listener of [...heard]) listener(at, to)
  return to
}

function schedule(at: string, to: Act) {
  clearTimeout(timers.get(at))
  timers.delete(at)
  const wait = to.at === 'owed' ? Limits.Pay.retryMs[to.tries] : undefined
  if (wait === undefined) return
  timers.set(
    at,
    setTimeout(() => {
      timers.delete(at)
      void retry(at)
    }, wait),
  )
}

export function listen(listener: (slot: string, act: Act) => void) {
  heard.add(listener)
  return () => {
    heard.delete(listener)
  }
}

export function watch(slot: string, listener: () => void) {
  const listeners = watchers.get(slot) ?? new Set()
  watchers.set(slot, listeners.add(listener))
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    watchers.delete(slot)
    const act = acts.get(slot)
    if (act && !busy(act) && act.at !== 'refused') acts.delete(slot)
  }
}

function refuses(error: unknown) {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  return status >= 400 && status < 500 && status !== 404 && status !== 408 && status !== 429
}

async function count(owed: Owed): Promise<Counted> {
  const note = owed.note ? { note: owed.note } : {}
  for (let attempt = 0; attempt <= Limits.Pay.countRetries; attempt++) {
    try {
      if (owed.node) {
        await Api.ride(owed.swarm, { hash: owed.hash, node: owed.node })
        if (owed.note) await Api.steerNode(owed.swarm, owed.node, { amount: '0', note: owed.note }).catch(() => {})
      } else await Api.contribute(owed.swarm, { hash: owed.hash, ...note })
      return { at: 'counted' }
    } catch (error) {
      if (code(error) === 'conflict') return { at: 'counted' }
      if (attempt < Limits.Pay.countRetries && code(error) === 'not_found') {
        await new Promise((resolve) => setTimeout(resolve, Limits.Pay.countRetryMs))
        continue
      }
      return refuses(error) ? { at: 'refused', reason: message(error) } : { at: 'later' }
    }
  }
  throw new Error(`Counting ${owed.hash} ran past its ${Limits.Pay.countRetries} retries.`)
}

async function counting(owed: Owed) {
  const counted = await count(owed)
  if (counted.at !== 'later') keep(without(owed))
  move(home(owed), counted.at === 'counted' ? { type: 'counted' } : counted.at === 'refused' ? { error: counted.reason, type: 'refused' } : { type: 'later' })
  return counted
}

export function record(owed: Owed, from = home(owed)) {
  keep([...without(owed), owed])
  move(from, { owed, type: 'sent' })
  return counting(owed)
}

export async function retry(slot: string): Promise<Counted | undefined> {
  const act = flow(slot)
  if (act.at !== 'owed') return undefined
  move(slot, { type: 'retry' })
  return counting(act.owed)
}

export function forget(slot: string) {
  const act = flow(slot)
  if (act.at === 'refused' || act.at === 'counted' || act.at === 'failed') move(slot, { type: 'reset' })
}

export function ghosts(swarm: string, parent: string): readonly { act: Act; owed: Owed }[] {
  const found = new Map<string, { act: Act; owed: Owed }>()
  for (const owed of owing()) if (owed.swarm === swarm && owed.parent === parent) found.set(owed.hash, { act: flow(home(owed)), owed })
  for (const act of acts.values()) {
    const owed = sent(act)
    if (owed && owed.swarm === swarm && owed.parent === parent) found.set(owed.hash, { act, owed })
  }
  return [...found.values()]
}

export function resume() {
  for (const owed of owing()) if (flow(home(owed)).at === 'owed') void retry(home(owed))
}

if (typeof document !== 'undefined') {
  addEventListener('beforeunload', (event) => {
    if ([...acts.values()].some((act) => act.at === 'creating' || act.at === 'paying')) event.preventDefault()
  })
  addEventListener('online', resume)
  setTimeout(resume, Limits.Pay.resumeMs)
}

function useVersion() {
  return useSyncExternalStore(useCallback((listener: () => void) => watch('*', listener), []), () => version, () => 0)
}

export function useGhosts(swarm: string, parent: string) {
  useVersion()
  return ghosts(swarm, parent)
}

const shown = new Set<string>()

export function useKept(slot: string, open: () => void) {
  const act = useFlow(slot)
  const owed = act.at === 'owed' || act.at === 'refused' ? act.owed : undefined
  const opener = useRef(open)
  opener.current = open
  useEffect(() => {
    if (!owed || shown.has(owed.hash)) return
    shown.add(owed.hash)
    opener.current()
  }, [owed])
}

export function useFlow(slot: string) {
  return useSyncExternalStore(useCallback((listener: () => void) => watch(slot, listener), [slot]), () => flow(slot), () => idle)
}
