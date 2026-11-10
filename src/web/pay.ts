import { useCallback, useSyncExternalStore } from 'react'
import * as Api from './api.ts'
import { message } from './hooks.ts'

export type Owed =
  | { amount: string; hash: string; note: string; swarm: string; way: 'sent' }
  | { amount: string; id: string; keyAuthorization: unknown; note: string; swarm: string; way: 'approved' }

export type Counted = { at: 'counted' } | { at: 'later' } | { at: 'refused'; reason: string }

export type Working = 'connect' | 'create' | 'record' | 'send'

export type Step = { at: 'idle' } | { at: 'busy'; step: Working } | { amount: string; at: 'done'; kept: boolean } | { at: 'failed'; error: string; hash?: string }

export type Flow = Step | { at: 'unrecorded'; owed: Owed }

export const idle: Step = { at: 'idle' }

const next: Record<Step['at'], readonly Step['at'][]> = {
  busy: ['busy', 'done', 'failed', 'idle'],
  done: ['busy', 'idle'],
  failed: ['busy', 'failed', 'idle'],
  idle: ['busy', 'failed'],
}

export function can(from: Flow, to: Step) {
  if (from.at === 'unrecorded') return to.at === 'busy' && to.step === 'record'
  return next[from.at].includes(to.at)
}

export function code(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
}

const kept = 'swarms.owed'

let saved: { all: readonly Owed[]; raw: string | null } = { all: [], raw: null }

const flows = new Map<string, Step>()

const unrecorded = new WeakMap<Owed, Flow>()

const watchers = new Map<string, Set<() => void>>()

function notify() {
  for (const listeners of [...watchers.values()]) for (const listener of [...listeners]) listener()
}

function owing(): readonly Owed[] {
  if (Api.fixture) return saved.all
  try {
    const raw = localStorage.getItem(kept)
    if (raw !== saved.raw) {
      const all: unknown = raw ? JSON.parse(raw) : []
      saved = { all: Array.isArray(all) ? (all as Owed[]) : [], raw }
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
  notify()
}

function named(owed: Owed) {
  return owed.way === 'sent' ? owed.hash : owed.id
}

function without(owed: Owed) {
  return owing().filter((each) => named(each) !== named(owed))
}

export function flow(slot: string): Flow {
  const step = flows.get(slot) ?? idle
  const owed = step.at === 'busy' ? undefined : owing().find((each) => each.swarm === slot)
  if (!owed) return step
  const waiting = unrecorded.get(owed) ?? { at: 'unrecorded', owed }
  unrecorded.set(owed, waiting)
  return waiting
}

export function move(slot: string, to: Step) {
  const from = flow(slot)
  if (!can(from, to)) throw new Error(`A payment cannot go from ${from.at} to ${to.at}.`)
  if (to.at === 'idle') flows.delete(slot)
  else flows.set(slot, to)
  notify()
}

export function watch(slot: string, listener: () => void) {
  const listeners = watchers.get(slot) ?? new Set()
  watchers.set(slot, listeners.add(listener))
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    watchers.delete(slot)
    if (flows.get(slot)?.at !== 'busy') flows.delete(slot)
  }
}

export function useFlow(slot: string) {
  return useSyncExternalStore(useCallback((listener: () => void) => watch(slot, listener), [slot]), () => flow(slot), () => idle)
}

function refuses(error: unknown, way: Owed['way']) {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  return status >= 400 && status < 500 && status !== 408 && status !== 429 && !(status === 404 && way === 'sent')
}

async function count(owed: Owed): Promise<Counted> {
  const note = owed.note ? { note: owed.note } : {}
  for (let attempt = 0; ; attempt++) {
    try {
      if (owed.way === 'sent') await Api.contribute(owed.swarm, { hash: owed.hash, ...note })
      else await Api.approved(owed.swarm, owed.id, { keyAuthorization: owed.keyAuthorization, ...note })
      return { at: 'counted' }
    } catch (error) {
      if (code(error) === 'conflict') return { at: 'counted' }
      if (owed.way === 'sent' && attempt < 3 && code(error) === 'not_found') {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        continue
      }
      return refuses(error, owed.way) ? { at: 'refused', reason: message(error) } : { at: 'later' }
    }
  }
}

export async function record(owed: Owed, from = owed.swarm) {
  keep([...without(owed), owed])
  if (from !== owed.swarm) move(from, idle)
  move(owed.swarm, { at: 'busy', step: 'record' })
  const counted = await count(owed)
  if (counted.at !== 'later') keep(without(owed))
  move(owed.swarm, counted.at === 'counted' ? { amount: owed.amount, at: 'done', kept: owed.way === 'approved' } : counted.at === 'refused' ? { at: 'failed', error: counted.reason, ...(owed.way === 'sent' ? { hash: owed.hash } : {}) } : idle)
  return counted
}
