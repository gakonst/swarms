import type { Status, Why } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import * as Store from './Store.ts'

export type Pause =
  | { why: 'unfunded' }
  | { left: string; needs?: string | undefined; wake: number | null; why: 'money' }
  | { wanted: string; why: 'costly' }
  | { failures: number; why: 'rest' }
  | { why: 'idle' }

export type Told = [note: string, weight: string]

export type Run =
  | { state: 'new' }
  | { from?: Pause | undefined; retry?: Retry | undefined; since: number | null; state: 'waiting'; until: number }
  | { id: string; n: number; since: number | null; state: 'starting'; told: Told[] }
  | { from: number; n: number; since: number; started: number; state: 'working'; turn: string; wanted?: string | undefined }
  | { at: number; pause: Pause; state: 'paused' }

export type Retry = { count: number; error: string; logged: number }

export type State = Run['state']

export type Reason = 'money' | 'note'

const next: Record<State, readonly State[]> = {
  new: ['waiting', 'starting', 'paused'],
  paused: ['paused', 'waiting'],
  starting: ['starting', 'working', 'waiting'],
  waiting: ['waiting', 'starting', 'paused'],
  working: ['working', 'waiting', 'paused'],
}

export function can(from: State, to: State) {
  return next[from].includes(to)
}

export function check(from: State, to: State) {
  if (!can(from, to)) throw new Error(`A swarm cannot go from ${from} to ${to}.`)
}

export function wakes(pause: Pause, reason: Reason) {
  return reason === 'money' || pause.why === 'rest' || pause.why === 'costly' || pause.why === 'idle'
}

export function due(run: Run, now: number) {
  return run.state === 'paused' && run.pause.why === 'money' && run.pause.wake !== null && run.pause.wake <= now
}

export function project(run: Run, n: number): { status: Status; why: Why | null } {
  const pause = paused(run)
  if (pause) return { status: n ? 'paused' : 'funding', why: pause.why }
  if (run.state === 'new' || (run.state === 'waiting' && n === 0)) return { status: 'funding', why: null }
  return { status: 'running', why: null }
}

export function reason(pause: Pause) {
  const cash = (units: string) => Answer.cash(Number(Memo.decimal(BigInt(units))))
  if (pause.why === 'unfunded') return 'Not started: nobody has funded it yet.'
  if (pause.why === 'money') return `Out of money: ${cash(pause.left)} left, and one step can cost up to ${cash(pause.needs ?? String(Store.reserve))}. Fund it to keep going.`
  if (pause.why === 'costly') return `Paused: its next step needs about ${cash(pause.wanted)} at once, more than any one backer has left in it. Fund it to keep going.`
  if (pause.why === 'idle') return 'Waiting for backers: new money, a steer or a message in its room wakes it.'
  return `Stopped after ${pause.failures} errors in a row. New money or a note restarts it.`
}

export function same(a: Pause, b: Pause) {
  return reason(a) === reason(b) && a.why === b.why
}

export function paused(run: Run): Pause | undefined {
  return run.state === 'paused' ? run.pause : run.state === 'waiting' ? run.from : undefined
}

export function since(run: Run) {
  if (run.state === 'working') return run.since
  if (run.state === 'waiting' || run.state === 'starting') return run.since
  return null
}

export type Old = { get<T>(key: string): T | undefined }

export function migrated(kv: Old, n: number, now: number): Run {
  const turn = kv.get<string>('turn')
  const started = kv.get<number>('started') ?? now
  const since = kv.get<number>('since') ?? null
  const wanted = kv.get<string>('wanted')
  if (turn) return { from: 0, n, since: since ?? started, started, state: 'working', turn, ...(wanted ? { wanted } : {}) }
  const paused = kv.get<string>('paused')
  const why = kv.get<string>('why')
  if (paused || kv.get<boolean>('refunded') || kv.get<number>('refundAt') !== undefined) {
    if (why === 'unfunded') return { at: now, pause: { why: 'unfunded' }, state: 'paused' }
    if (why === 'rest') return { at: now, pause: { failures: Number(/after (\d+) errors/.exec(paused ?? '')?.[1] ?? 3), why: 'rest' }, state: 'paused' }
    if (why === 'costly') return { at: now, pause: { wanted: wanted ?? units(/about \$([\d.]+)/.exec(paused ?? '')?.[1]), why: 'costly' }, state: 'paused' }
    return { from: { left: units(kv.get<string>('left')), wake: null, why: 'money' }, since: null, state: 'waiting', until: now }
  }
  if (!n && !kv.get<string>('agent')) return { state: 'new' }
  return { since, state: 'waiting', until: now }
}

function units(decimal: string | undefined) {
  return /^\d+(\.\d{1,6})?$/.test(decimal ?? '') ? String(Memo.units(decimal as string)) : '0'
}
