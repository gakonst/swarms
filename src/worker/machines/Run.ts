// The agent swarm's run, as one record with typed transitions.
//
// The record lives in the object's kv under 'run' and is written only here.
// Every write bumps 'rev', and a writer that read an older rev is refused
// ('Stale'), so a past life of the object (or a step that awaited while a
// newer one moved the run) cannot overwrite a newer state. A turn's end is the
// 'ending' state: entered in one write with the report it ends on, before the
// first effect of the end, and each effect is marked done in the record, so a
// restart replays only the effects that did not land and the turn is folded
// exactly once.
//
// Rollback: 'ending' is stored as state 'working' with an 'ending' field, a
// shape the previous Worker reads as a turn still running (it would follow the
// turn and end it again, as before), and 'rev'/'v' are extra fields the
// previous code ignores. A record it writes back drops 'rev', which reads as 0
// here: older than any rev this code holds, so a fenced write refuses rather
// than overwrite it.

import type * as Phase from '../Phase.ts'

export const version = 2

// The effects of a turn's end, in the order they run.
export const effects = ['turned', 'heard', 'attempted', 'reported', 'logged', 'published', 'announced', 'exposed'] as const

export type Effect = (typeof effects)[number]

export type Report = { error?: string | undefined; message: string | null; status: 'cancelled' | 'completed' | 'failed' }

// What the end decided, kept once the 'turned' effect lands, so a replay acts
// on the same figures rather than reading them again.
export type Facts = {
  attempts?: number | undefined
  balance: string
  commits: string[]
  due?: number | undefined
  finished?: boolean | undefined
  left: string
  needs: string
  pushed: string
  refused: boolean
  short: boolean
  spent: string
  sponsor: boolean
}

export type Ending = { done: Effect[]; facts?: Facts | undefined; report: Report; unpaid?: { count: number; error: string } | undefined }

export type Kind = Phase.State | 'ending'

export type Stored = Phase.Run & { ending?: Ending | undefined; rev?: number | undefined; v?: number | undefined }

export type Store = { get(): Stored | undefined; put(run: Stored): void }

// Every legal transition. 'working' leaves only through 'ending', so every
// turn is ended by the one path that folds it once.
export const next: Record<Kind, readonly Kind[]> = {
  ending: ['ending', 'waiting', 'paused'],
  new: ['waiting', 'starting', 'paused'],
  paused: ['paused', 'waiting'],
  starting: ['starting', 'working', 'waiting'],
  waiting: ['waiting', 'starting', 'paused'],
  working: ['working', 'ending'],
}

// Guards the tests turn off one at a time to check that the simulation
// catches each broken invariant. Never changed outside tests.
export const guards = { fence: true, legal: true, once: true, resume: true }

export class Refused extends Error {
  readonly kind: 'Illegal' | 'Stale'
  constructor(kind: 'Illegal' | 'Stale', detail: string) {
    super(kind + ': ' + detail)
    this.kind = kind
  }
}

export function kind(run: Phase.Run | Stored): Kind {
  return run.state === 'working' && (run as Stored).ending ? 'ending' : run.state
}

export function can(from: Kind, to: Kind) {
  return next[from].includes(to)
}

export function read(store: Store): Stored {
  return store.get() ?? { state: 'new' }
}

export function rev(run: Stored) {
  return run.rev ?? 0
}

// Write the run. 'expect' fences the write on the rev the writer read.
export function write(store: Store, run: Phase.Run | Stored, expect?: number): Stored {
  const now = read(store)
  if (guards.legal && !can(kind(now), kind(run))) throw new Refused('Illegal', kind(now) + ' -> ' + kind(run))
  if (guards.fence && expect !== undefined && rev(now) !== expect) throw new Refused('Stale', 'rev ' + rev(now) + ', expected ' + expect)
  const { rev: _rev, v: _v, ...rest } = run as Stored
  const stored: Stored = { ...(rest as Stored), rev: rev(now) + 1, v: version }
  store.put(stored)
  return stored
}

// working -> ending, with the report it ends on. A second delivery of a
// report for a turn already ending keeps the first (its done effects stay).
export function end(store: Store, n: number, report: Report, unpaid?: Ending['unpaid']): Stored {
  const now = read(store)
  if (now.state !== 'working' || now.n !== n) throw new Refused('Stale', 'turn ' + n + ' is not running (' + kind(now) + ')')
  if (now.ending && guards.resume) return now
  return write(store, { ...now, ending: { done: [], report, ...(unpaid ? { unpaid } : {}) } }, rev(now))
}

export type Ended = Extract<Phase.Run, { state: 'working' }> & { ending: Ending; rev?: number | undefined; v?: number | undefined }

export function ending(store: Store, n: number): Ended {
  const now = read(store)
  if (kind(now) !== 'ending' || now.state !== 'working' || now.n !== n) throw new Refused('Stale', 'turn ' + n + ' is not ending (' + kind(now) + ')')
  return now as Ended
}

export function done(run: Stored, effect: Effect) {
  return guards.once && !!run.ending?.done.includes(effect)
}

function mark(store: Store, n: number, effect: Effect, facts?: Partial<Facts>) {
  const now = ending(store, n)
  const kept = facts ? ({ ...now.ending.facts, ...facts } as Facts) : now.ending.facts
  write(store, { ...now, ending: { ...now.ending, done: [...now.ending.done, effect], ...(kept ? { facts: kept } : {}) } }, rev(now))
}

// A synchronous effect (a feed row, a room line): checked, done and marked in
// one step with no await, so it lands exactly once.
export function once(store: Store, n: number, effect: Effect, work: () => Partial<Facts> | void): boolean {
  if (done(ending(store, n), effect)) return false
  const facts = work()
  mark(store, n, effect, facts ?? undefined)
  return true
}

// An effect that awaits (a gateway or D1 call). It is keyed by its caller so
// that repeating it changes nothing; a restart between the call and the mark
// repeats it, and a life whose turn moved on while it awaited is refused.
export async function step(store: Store, n: number, effect: Effect, work: () => Promise<Partial<Facts> | void>): Promise<boolean> {
  if (done(ending(store, n), effect)) return false
  const facts = await work()
  if (done(ending(store, n), effect)) return false
  mark(store, n, effect, facts ?? undefined)
  return true
}

// ending -> waiting | paused.
export function close(store: Store, n: number, to: Phase.Run): Stored {
  const now = ending(store, n)
  if (to.state !== 'waiting' && to.state !== 'paused') throw new Refused('Illegal', 'ending -> ' + to.state)
  return write(store, to, rev(now))
}

export function kv(storage: { delete(key: string): unknown; get<T>(key: string): T | undefined; put(key: string, value: unknown): void }): Store {
  return { get: () => storage.get<Stored>('run'), put: (run) => storage.put('run', run) }
}

