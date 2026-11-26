import * as Assert from '../../shared/Assert.ts'
import * as Phase from '../Phase.ts'

export const version = 2

export const effects = ['turned', 'heard', 'attempted', 'reported', 'logged', 'published', 'announced', 'exposed'] as const

export type Effect = (typeof effects)[number]

export type Report = { error?: string | undefined; message: string | null; status: 'cancelled' | 'completed' | 'failed' }

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
  remaining?: string | undefined
  short: boolean
  spent: string
  sponsor: boolean
}

export type Ending = { done: Effect[]; facts?: Facts | undefined; report: Report; unpaid?: { count: number; error: string } | undefined }

export type Kind = Phase.State | 'ending'

export type Stored = Phase.Run & { ending?: Ending | undefined; rev?: number | undefined; v?: number | undefined }

export type Store = { get(): Stored | undefined; put(run: Stored): void }

export const next: Record<Kind, readonly Kind[]> = {
  ending: ['ending', 'waiting', 'paused'],
  new: ['waiting', 'starting', 'paused'],
  paused: ['paused', 'waiting'],
  starting: ['starting', 'working', 'waiting'],
  waiting: ['waiting', 'starting', 'paused'],
  working: ['working', 'ending'],
}

export const guards = { fence: true, legal: true, once: true, resume: true, unpaid: true }

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
  const kept = store.get()
  return kept === undefined ? { state: 'new' } : (Phase.parse(kept) as Stored)
}

export function rev(run: Stored) {
  return run.rev ?? 0
}

export function write(store: Store, run: Phase.Run | Stored, expect?: number): Stored {
  const now = read(store)
  if (guards.legal && !can(kind(now), kind(run))) throw new Refused('Illegal', kind(now) + ' -> ' + kind(run))
  if (guards.fence && expect !== undefined && rev(now) !== expect) throw new Refused('Stale', 'rev ' + rev(now) + ', expected ' + expect)
  const { rev: _rev, v: _v, ...rest } = run as Stored
  const stored: Stored = { ...(rest as Stored), rev: rev(now) + 1, v: version }
  Assert.assert(stored.rev === rev(now) + 1 && stored.v === version, 'A run write moves its rev by one.', { from: rev(now), to: stored.rev })
  store.put(stored)
  return stored
}

export function end(store: Store, n: number, report: Report, unpaid?: Ending['unpaid']): Stored {
  const now = read(store)
  if (now.state !== 'working' || now.n !== n) throw new Refused('Stale', 'turn ' + n + ' is not running (' + kind(now) + ')')
  if (now.ending && guards.resume) return now
  return write(store, { ...now, ending: { done: [], report, ...(unpaid && guards.unpaid ? { unpaid } : {}) } }, rev(now))
}

export type Ended = Extract<Phase.Run, { state: 'working' }> & { ending: Ending; rev?: number | undefined; v?: number | undefined }

export function ending(store: Store, n: number): Ended {
  const now = read(store)
  if (kind(now) !== 'ending' || now.state !== 'working' || now.n !== n) throw new Refused('Stale', 'turn ' + n + ' is not ending (' + kind(now) + ')')
  Assert.assert(now.ending !== undefined, 'An ending run holds its ending.', { n })
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

export function once(store: Store, n: number, effect: Effect, work: () => Partial<Facts> | void): boolean {
  if (done(ending(store, n), effect)) return false
  const facts = work()
  mark(store, n, effect, facts ?? undefined)
  return true
}

export async function step(store: Store, n: number, effect: Effect, work: () => Promise<Partial<Facts> | void>): Promise<boolean> {
  if (done(ending(store, n), effect)) return false
  const facts = await work()
  if (done(ending(store, n), effect)) return false
  mark(store, n, effect, facts ?? undefined)
  return true
}

export function close(store: Store, n: number, to: Phase.Run): Stored {
  const now = ending(store, n)
  if (to.state !== 'waiting' && to.state !== 'paused') throw new Refused('Illegal', 'ending -> ' + to.state)
  return write(store, to, rev(now))
}

export function kv(storage: { delete(key: string): unknown; get<T>(key: string): T | undefined; put(key: string, value: unknown): void }): Store {
  return { get: () => storage.get<Stored>('run'), put: (run) => storage.put('run', run) }
}
