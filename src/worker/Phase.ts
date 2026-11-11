import type { Status, Why } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'

export type Pause =
  | { why: 'unfunded' }
  | { balance?: string | undefined; left: string; needs?: string | undefined; wake: number | null; why: 'money' }
  | { wanted: string; why: 'costly' }
  | { failures: number; why: 'rest' }
  | { why: 'idle' }

export type Told = [note: string, weight: string]

export type Sent = { id: string; prompt: string; told: Told[] }

export type Run =
  | { state: 'new' }
  | { from?: Pause | undefined; sent?: Sent | undefined; since: number | null; state: 'waiting'; until: number }
  | { again?: boolean | undefined; balance?: string | undefined; id: string; n: number; prompt?: string | undefined; since: number | null; state: 'starting'; told: Told[] }
  | { again?: boolean | undefined; balance?: string | undefined; from: number; n: number; since: number; started: number; state: 'working'; turn: string; wanted?: string | undefined }
  | { at: number; pause: Pause; settled?: number | undefined; state: 'paused' }

export type Paused = Extract<Run, { state: 'paused' }>

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

export const rereadMs = 10 * 60_000

export const maxPatienceMs = 60 * 60_000

export function unread(run: Paused, now: number) {
  return run.settled === undefined || now - run.settled >= rereadMs || (due(run, now) && run.settled < woken(run))
}

export function refused(pause: Pause) {
  return pause.why === 'money' && pause.needs !== undefined && BigInt(pause.left) >= BigInt(pause.needs)
}

export function resumes(pause: Pause, money: { balance: bigint; due?: boolean | undefined; left: bigint; reserve: bigint }) {
  if (money.left < money.reserve) return false
  if (!refused(pause) || money.due) return true
  return pause.why === 'money' && pause.balance !== undefined && money.balance > BigInt(pause.balance)
}

export function due(run: Run, now: number) {
  return woken(run) <= now
}

function woken(run: Run) {
  if (run.state !== 'paused' || run.pause.why !== 'money') return Infinity
  if (run.pause.wake !== null) return Math.min(run.pause.wake, run.at + maxPatienceMs)
  return refused(run.pause) ? run.at + rereadMs : Infinity
}

export function waking(run: Run, now: number) {
  const wake = woken(run)
  return wake !== Infinity && wake > now ? wake : null
}

export function patience(failures: number) {
  return Math.min(maxPatienceMs, rereadMs * 2 ** Math.max(0, failures - 1))
}

export function project(run: Run, n: number): { status: Status; why: Why | null } {
  const pause = paused(run)
  if (pause) return { status: n ? 'paused' : 'funding', why: pause.why }
  if (run.state === 'new' || (run.state === 'waiting' && n === 0)) return { status: 'funding', why: null }
  return { status: 'running', why: null }
}

export function reason(pause: Pause) {
  if (pause.why === 'unfunded') return 'Nobody is riding it yet.'
  if (refused(pause)) return 'Its last step could not be paid for, though it has money. It tries again by itself.'
  return 'Out of money. Ride it to keep it going.'
}

export function same(a: Pause, b: Pause) {
  return a.why === b.why
}

export function stale(why: Why | null | undefined) {
  return why === 'idle' || why === 'rest' || why === 'costly'
}

export function paused(run: Run): Pause | undefined {
  return run.state === 'paused' ? run.pause : run.state === 'waiting' ? run.from : undefined
}

export function sent(run: Run): Sent | undefined {
  if (run.state === 'waiting') return run.sent
  return run.state === 'starting' && run.prompt !== undefined ? { id: run.id, prompt: run.prompt, told: run.told } : undefined
}

export function again(run: Run) {
  if (run.state === 'starting' || run.state === 'working') return run.again === true
  return run.state === 'waiting' && run.from !== undefined && refused(run.from)
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
