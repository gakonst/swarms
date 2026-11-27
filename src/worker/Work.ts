
import type { Board as Boards } from 'nanocode-ts'
import * as Lease from './machines/Lease.ts'
import * as Limits from '../shared/Limits.ts'

export type Board = Boards.Board
export type Cap = Boards.Cap
export type Claimed = Boards.Claimed
export type NewTask = Boards.NewTask
export type Outcome = Boards.Outcome
export type Phase = Boards.Phase
export type Rejection = Boards.Rejection
export type Retry = Boards.Retry
export type Steer = Boards.Steer
export type Task = Boards.Task
export type Verdict = Boards.Verdict

export function terminal(phase: Phase) {
  return phase === 'done' || phase === 'failed' || phase === 'cancelled'
}

export function delay(retry: Retry, attempts: number) {
  return retry.backoffMs * 2 ** Math.max(0, attempts - 1)
}

export function until(verdict: Verdict) {
  if (!verdict.ok) return undefined
  const renewed = (verdict.change as { Renewed?: { until_ms?: unknown } } | null)?.Renewed
  return typeof renewed?.until_ms === 'number' ? renewed.until_ms : undefined
}

const methods = ['cancel', 'charter', 'checkpoint', 'claim', 'close', 'finish', 'grant', 'group', 'heed', 'held', 'maxText', 'opened', 'post', 'ready', 'refresh', 'release', 'renew', 'reply', 'revoke', 'setTextLimit', 'steer', 'steers', 'submit', 'task', 'tasks', 'work'] as const satisfies readonly Exclude<keyof Board, 'actor' | 'scope'>[]

export function opening(scope: string, actor: string, open: () => Promise<Board>): Board {
  let opened: Promise<Board> | undefined
  const board = () =>
    (opened ??= open().catch((error: unknown) => {
      opened = undefined
      throw error
    }))
  const calls = Object.fromEntries(methods.map((name) => [name, async (...args: never[]) => ((await board())[name] as (...args: never[]) => unknown)(...args)]))
  return { ...calls, actor, scope } as never as Board
}

export async function ensure(board: Board, task: NewTask) {
  if (await board.task(task.id)) return
  const posted = await board.post(task)
  if (!posted.ok && posted.rejection.kind !== 'Exists') throw new Error(`Posting ${task.id} was refused: ${posted.rejection.kind}`)
}

export async function lock(board: Board, id: string, leaseMs: number, labels: Record<string, string> = instance) {
  await ensure(board, { id, labels, spec: `lock ${id}` })
  return board.claim(id, { leaseMs })
}

export const instance = { lock: 'instance' }

export const lasting = { lock: 'lasting' }

export async function reclaim(board: Board) {
  const stale = (await board.held()).flatMap((task) => (task.labels['lock'] === instance.lock && task.claim ? [{ claim: task.claim, id: task.id }] : []))
  await Promise.all(stale.map((task) => board.release(task.id, task.claim, 'its holder restarted')))
}

export type Held = { epoch: number; signal: AbortSignal; writable: () => boolean }

export class Lost extends Error {
  readonly id: string
  readonly why: string
  constructor(id: string, why: string) {
    super('The lock ' + id + ' was lost: ' + why)
    this.id = id
    this.why = why
  }
}

export class Busy extends Error {
  readonly id: string
  readonly waitedMs: number
  constructor(id: string, waitedMs: number) {
    super('The lock ' + id + ' stayed held for ' + waitedMs + ' ms')
    this.id = id
    this.waitedMs = waitedMs
  }
}

export const guards = { deadline: true }

export async function holding<T>(board: Board, id: string, leaseMs: number, work: (held: Held) => Promise<T>): Promise<{ value: T } | { rejection: Rejection } | { lost: string }> {
  let state = Lease.step(Lease.unowned, { type: 'claim' })
  const held = await lock(board, id, leaseMs)
  if (!held.ok) return { rejection: held.rejection }
  state = Lease.step(state, { claim: held.claim, epoch: held.seq, type: 'claimed', until: held.untilMs })
  const epoch = state.epoch
  const stop = new AbortController()
  const apply = (event: Lease.Event) => {
    state = Lease.step(state, event)
    if (state.kind === 'Lost' && !stop.signal.aborted) stop.abort(new Lost(id, state.why))
  }
  const timer = setInterval(() => {
    apply({ now: Date.now(), type: 'tick' })
    if (state.kind !== 'Owned') return
    void board.renew(id, held.claim, leaseMs).then(
      (verdict) => apply(verdict.ok ? { type: 'renewed', until: until(verdict) ?? Date.now() + leaseMs } : { type: 'refused', why: verdict.rejection.kind }),
      () => apply({ type: 'transport' }),
    )
  }, Math.max(Limits.Work.renewFloorMs, Math.floor(leaseMs / Limits.Work.renewsPerLease)))
  try {
    const value = await work({ epoch, signal: stop.signal, writable: () => Lease.writable(state, epoch, Date.now()) })
    apply({ now: Date.now(), type: 'tick' })
    if (state.kind === 'Lost') return { lost: state.why }
    return { value }
  } finally {
    clearInterval(timer)
    if (state.kind === 'Owned') {
      state = Lease.step(state, { type: 'drain' })
      const released = await board.release(id, held.claim)
      state = Lease.step(state, released.ok ? { type: 'released' } : { type: 'refused', why: released.rejection.kind })
    }
  }
}

export const serialWaitMs = Limits.Work.serialWaitMs

export const serialPollMs = Limits.Work.serialPollMs

export async function serial<T>(board: Board, id: string, leaseMs: number, work: (held: Held) => Promise<T>, waitMs: number = serialPollMs, deadlineMs: number = serialWaitMs): Promise<T> {
  const deadline = Date.now() + deadlineMs
  let ran = await holding(board, id, leaseMs, work)
  while ('rejection' in ran && ran.rejection.kind === 'Held' && !(guards.deadline && Date.now() + waitMs > deadline)) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, serialWaitMs)))
    ran = await holding(board, id, leaseMs, work)
  }
  if ('value' in ran) return ran.value
  if ('lost' in ran) throw new Lost(id, ran.lost)
  if (ran.rejection.kind !== 'Held') throw new Error(`The lock ${id} was refused: ${ran.rejection.kind}`)
  throw new Busy(id, deadlineMs)
}


export async function once<T>(board: Board, id: string, leaseMs: number, work: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  await ensure(board, { id, spec: `once ${id}` })
  const held = await board.claim(id, { leaseMs })
  if (!held.ok) return { ran: false }
  try {
    const value = await work()
    await board.finish(id, held.claim, { done: '' })
    return { ran: true, value }
  } catch (error) {
    await board.release(id, held.claim, String(error))
    throw error
  }
}
