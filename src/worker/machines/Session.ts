import { z } from 'zod'
import * as Assert from '../../shared/Assert.ts'
import * as Limits from '../../shared/Limits.ts'

export const version = 1

export type State =
  | { kind: 'Steady'; rotations: number[] }
  | { at: number; from: string; kind: 'Rotating'; rotations: number[]; why: string }
  | { agent: string; at: number; from: string; kind: 'Seeding'; rotations: number[]; why: string }
  | { at: number; from: string; kind: 'Spent'; paused: boolean; rotations: number[] }

export type Event =
  | { agent: string; at: number; type: 'unusable'; why: string }
  | { agent: string; type: 'made' }
  | { agent: string; type: 'seeded' }
  | { type: 'paused' }
  | { type: 'resumed' }

export type Stored = State & { rev: number; v: number }

export type Store = { get(): unknown; put(state: Stored): void }

export const steady: State = { kind: 'Steady', rotations: [] }

export const guards = { fence: true, limit: true, window: true }

const rotations = z.array(z.number()).max(Limits.Session.rotationsPerDay)

const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('Steady'), rotations }),
  z.object({ at: z.number(), from: z.string(), kind: z.literal('Rotating'), rotations, why: z.string() }),
  z.object({ agent: z.string(), at: z.number(), from: z.string(), kind: z.literal('Seeding'), rotations, why: z.string() }),
  z.object({ at: z.number(), from: z.string(), kind: z.literal('Spent'), paused: z.boolean(), rotations }),
])

const stored = z.intersection(schema, z.object({ rev: z.number().int().nonnegative(), v: z.literal(version) }))

export class Refused extends Error {
  readonly kind: 'Illegal' | 'Stale'
  constructor(kind: 'Illegal' | 'Stale', detail: string) {
    super(kind + ': ' + detail)
    this.kind = kind
  }
}

export function read(store: Store): Stored {
  const kept = store.get()
  return kept === undefined ? { ...steady, rev: 0, v: version } : (stored.parse(kept) as Stored)
}

export function rev(state: Stored) {
  return state.rev
}

export function within(state: State, now: number) {
  return guards.window ? state.rotations.filter((at) => at > now - Limits.Session.dayMs) : state.rotations
}

export function since(state: State) {
  return state.rotations.at(-1) ?? 0
}

export function step(state: State, event: Event): State {
  const next = move(state, event)
  Assert.assert(next.rotations.length <= Limits.Session.rotationsPerDay, 'A session keeps only the rotations of its last day.', next)
  Assert.assert(next.kind !== 'Seeding' || next.agent !== next.from, 'A fresh session is a new agent.', next)
  return next
}

function move(state: State, event: Event): State {
  switch (event.type) {
    case 'unusable': {
      if (state.kind === 'Spent') return state
      if (state.kind === 'Rotating') break
      if (state.kind === 'Seeding' && state.agent !== event.agent) break
      const kept = within(state, event.at)
      if (guards.limit && kept.length >= Limits.Session.rotationsPerDay)
        return { at: event.at, from: event.agent, kind: 'Spent', paused: false, rotations: kept.slice(-Limits.Session.rotationsPerDay) }
      return { at: event.at, from: event.agent, kind: 'Rotating', rotations: [...kept, event.at].slice(-Limits.Session.rotationsPerDay), why: event.why }
    }
    case 'made':
      if (state.kind === 'Rotating' || state.kind === 'Seeding')
        return { agent: event.agent, at: state.at, from: state.from, kind: 'Seeding', rotations: state.rotations, why: state.why }
      break
    case 'seeded':
      if (state.kind === 'Seeding' && state.agent === event.agent) return { kind: 'Steady', rotations: state.rotations }
      if (state.kind === 'Steady') return state
      break
    case 'paused':
      if (state.kind === 'Spent') return { ...state, paused: true }
      break
    case 'resumed':
      if (state.kind === 'Spent' && state.paused) return { kind: 'Steady', rotations: state.rotations }
      break
  }
  throw new Refused('Illegal', state.kind + ' cannot take ' + event.type)
}

export function write(store: Store, next: State, expect: number): Stored {
  const now = read(store)
  if (guards.fence && rev(now) !== expect) throw new Refused('Stale', 'rev ' + rev(now) + ', expected ' + expect)
  const kept: Stored = { ...next, rev: rev(now) + 1, v: version }
  Assert.assert(kept.rev === rev(now) + 1, 'A session write moves its rev by one.', { from: rev(now), to: kept.rev })
  store.put(kept)
  return kept
}

export function apply(store: Store, event: Event): Stored {
  const now = read(store)
  return write(store, step(now, event), rev(now))
}

export function kv(storage: { get<T>(key: string): T | undefined; put(key: string, value: unknown): void }): Store {
  return { get: () => storage.get<unknown>('session'), put: (state) => storage.put('session', state) }
}
