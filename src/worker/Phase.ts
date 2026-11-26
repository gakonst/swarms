import { z } from 'zod'
import type { Failure, Halt, Lifecycle, Provider, Waiting, Why } from '../shared/Api.ts'
import * as Assert from '../shared/Assert.ts'
import * as Memo from '../shared/Memo.ts'
import { failing, outage, reasons, short } from '../shared/Status.ts'
import * as Limits from '../shared/Limits.ts'

export type Outage = { message: string; name: Provider; spent: boolean; tries: number }

export type Pause =
  | { why: 'unfunded' }
  | {
      balance?: string | undefined
      left: string
      needs?: string | undefined
      provider?: Outage | undefined
      remaining?: string | undefined
      sponsor?: true | undefined
      wake: number | null
      why: 'money'
    }
  | { wanted: string; why: 'costly' }
  | { failures: number; why: 'rest' }
  | { why: 'idle' }

export type Told = [note: string, weight: string]

export type Sent = { id: string; prompt: string; told: Told[] }

export type Run =
  | { state: 'new' }
  | { from?: Pause | undefined; sent?: Sent | undefined; since: number | null; state: 'waiting'; until: number }
  | {
      again?: boolean | undefined
      balance?: string | undefined
      id: string
      n: number
      prompt?: string | undefined
      since: number | null
      state: 'starting'
      told: Told[]
    }
  | {
      again?: boolean | undefined
      balance?: string | undefined
      claim?: string | undefined
      from: number
      n: number
      since: number
      started: number
      state: 'working'
      task?: string | undefined
      turn: string
      wanted?: string | undefined
    }
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
  Assert.assert(can(from, to), `A swarm cannot go from ${from} to ${to}.`, { from, to })
}

const told = z.tuple([z.string(), z.string()])

const pause = z.discriminatedUnion('why', [
  z.object({ why: z.literal('unfunded') }).loose(),
  z
    .object({
      balance: z.string().optional(),
      left: z.string(),
      needs: z.string().optional(),
      provider: z
        .object({ message: z.string(), name: z.enum(['browserbase', 'e2b', 'modal']), spent: z.boolean(), tries: z.number() })
        .loose()
        .optional(),
      remaining: z.string().optional(),
      sponsor: z.literal(true).optional(),
      wake: z.number().nullable().default(null),
      why: z.literal('money'),
    })
    .loose(),
  z.object({ wanted: z.string(), why: z.literal('costly') }).loose(),
  z.object({ failures: z.number(), why: z.literal('rest') }).loose(),
  z.object({ why: z.literal('idle') }).loose(),
])

const sentSchema = z.object({ id: z.string(), prompt: z.string(), told: z.array(told) }).loose()

export const schema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('new') }).loose(),
  z.object({ from: pause.optional(), sent: sentSchema.optional(), since: z.number().nullable(), state: z.literal('waiting'), until: z.number() }).loose(),
  z
    .object({
      again: z.boolean().optional(),
      balance: z.string().optional(),
      id: z.string(),
      n: z.number(),
      prompt: z.string().optional(),
      since: z.number().nullable(),
      state: z.literal('starting'),
      told: z.array(told),
    })
    .loose(),
  z
    .object({
      again: z.boolean().optional(),
      balance: z.string().optional(),
      claim: z.string().optional(),
      from: z.number(),
      n: z.number(),
      since: z.number(),
      started: z.number(),
      state: z.literal('working'),
      task: z.string().optional(),
      turn: z.string(),
      wanted: z.string().optional(),
    })
    .loose(),
  z.object({ at: z.number(), pause, settled: z.number().optional(), state: z.literal('paused') }).loose(),
])

export function parse(raw: unknown): Run | undefined {
  if (raw === undefined) return undefined
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return Assert.fail('A stored swarm run does not parse.', parsed.error.issues)
  return parsed.data as Run
}

export function outaged(pause: Pause | undefined): Outage | undefined {
  return pause?.why === 'money' && guards.provider ? pause.provider : undefined
}

export function halt(pause: Pause): Halt {
  return outaged(pause) ? 'provider' : pause.why
}

export function wakes(pause: Pause, reason: Reason) {
  if (outaged(pause)) return reason === 'note'
  return reason === 'money' || pause.why === 'rest' || pause.why === 'costly' || pause.why === 'idle'
}

export const rereadMs = Limits.Phase.rereadMs

export const maxPatienceMs = Limits.Phase.maxPatienceMs

export function unread(run: Paused, now: number) {
  return run.settled === undefined || now - run.settled >= rereadMs || (due(run, now) && run.settled < woken(run))
}

export function refused(pause: Pause) {
  return pause.why === 'money' && pause.needs !== undefined && BigInt(pause.left) >= BigInt(pause.needs)
}

export function resumes(pause: Pause, money: { balance: bigint; due?: boolean | undefined; left: bigint; reserve: bigint }) {
  if (money.left < money.reserve) return false
  if (outaged(pause)) return false
  if (!refused(pause) || money.due) return true
  return pause.why === 'money' && pause.balance !== undefined && money.balance > BigInt(pause.balance)
}

export function due(run: Run, now: number) {
  return woken(run) <= now
}

function woken(run: Run) {
  if (run.state !== 'paused' || run.pause.why !== 'money') return Infinity
  if (outaged(run.pause) && run.pause.wake !== null) return run.pause.wake
  if (run.pause.wake !== null) return guards.patience ? Math.min(run.pause.wake, run.at + maxPatienceMs) : run.pause.wake
  return refused(run.pause) ? run.at + rereadMs : Infinity
}

export function waking(run: Run, now: number) {
  const wake = woken(run)
  return wake !== Infinity && wake > now ? wake : null
}

export function project(run: Run, n: number, stuck = false): Lifecycle {
  const pause = paused(run)
  if (pause) return n && guards.listed ? { status: 'paused', why: halt(pause) } : { status: 'funding', why: halt(pause) }
  if (run.state === 'new' || (run.state === 'waiting' && n === 0)) return { status: 'funding', why: null }
  return { status: 'running', why: stuck ? 'stuck' : null }
}

export function waiting(run: Run, stuck: boolean, sponsor: boolean): Waiting | null {
  const pause = paused(run)
  if (pause) return outaged(pause)?.name ?? (pause.why === 'money' && pause.sponsor ? 'tempo' : null)
  return stuck && sponsor ? 'tempo' : null
}

export function reason(pause: Pause) {
  if (pause.why === 'unfunded') return reasons.unfunded
  const down = outaged(pause)
  if (down) return outage(down.name, down.spent)
  if (refused(pause) && pause.why === 'money' && pause.sponsor) return reasons.sponsor
  if (refused(pause)) return reasons.refused
  if (pause.why !== 'money' || !guards.exact) return reasons.broke
  return short(pause)
}

export const guards = { exact: true, listed: true, patience: true, provider: true }

export function stuck(failure: Failure | null, sponsor: boolean) {
  if (sponsor) return reasons.sponsor
  if (!failure) return reasons.stalled
  return failing(failure.status ?? failure.code)
}

export function same(a: Pause, b: Pause) {
  return a.why === b.why && (a.why !== 'money' || b.why !== 'money' || (!a.sponsor === !b.sponsor && outaged(a)?.name === outaged(b)?.name))
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
    if (why === 'rest')
      return {
        at: now,
        pause: { failures: Number(/after (\d+) errors/.exec(paused ?? '')?.[1] ?? Limits.WorkerPhase.restFailures), why: 'rest' },
        state: 'paused',
      }
    if (why === 'costly') return { at: now, pause: { wanted: wanted ?? units(/about \$([\d.]+)/.exec(paused ?? '')?.[1]), why: 'costly' }, state: 'paused' }
    return { from: { left: units(kv.get<string>('left')), wake: null, why: 'money' }, since: null, state: 'waiting', until: now }
  }
  if (!n && !kv.get<string>('agent')) return { state: 'new' }
  return { since, state: 'waiting', until: now }
}

function units(decimal: string | undefined) {
  return /^\d+(\.\d{1,6})?$/.test(decimal ?? '') ? String(Memo.units(decimal as string)) : '0'
}
