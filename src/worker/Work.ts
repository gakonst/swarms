// A swarm's own coordination, as a board of tasks with leased claims.
//
// Every lock, timer and once-only step the swarm used to keep by hand (the
// single-flight step, the budgeting chain, the soft locks in kv, the stuck and
// stall timers, retry backoff, the steered notes, branch settlement and the
// hand cap) is a task on nanocode-ts's Board, which keeps its log in the
// object's own SQLite: claimed with a lease, renewed while it is alive,
// released or finished. This module is the few helpers the swarm builds on
// the board: locks, once-only steps and letting go of a past life's locks.

import type { Board as Boards } from 'nanocode-ts'

export type Board = Boards.Board
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

// The wait before the next try after `attempts` failed ones, as the board's
// Terms.retry schedules it: backoffMs, doubled for every try after the first.
export function delay(retry: Retry, attempts: number) {
  return retry.backoffMs * 2 ** Math.max(0, attempts - 1)
}

// When a renewed lease now runs out, from the board's verdict.
export function until(verdict: Verdict) {
  if (!verdict.ok) return undefined
  const renewed = (verdict.change as { Renewed?: { until_ms?: unknown } } | null)?.Renewed
  return typeof renewed?.until_ms === 'number' ? renewed.until_ms : undefined
}

const methods = ['cancel', 'charter', 'claim', 'close', 'finish', 'grant', 'group', 'heed', 'held', 'post', 'ready', 'refresh', 'release', 'renew', 'reply', 'revoke', 'steer', 'steers', 'submit', 'task', 'tasks', 'work'] as const satisfies readonly Exclude<keyof Board, 'actor' | 'scope'>[]

// A board that opens on its first call: `open` runs once, and every call
// waits for it, so the object can hand out its board before the open lands.
// An open that fails is tried again on the next call. The board queues its
// own commands, so the object's alarm, requests and timers may call it at once.
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

// Post a task unless it is there already.
export async function ensure(board: Board, task: NewTask) {
  if (await board.task(task.id)) return
  const posted = await board.post(task)
  if (!posted.ok && posted.rejection.kind !== 'Exists') throw new Error(`Posting ${task.id} was refused: ${posted.rejection.kind}`)
}

// A lock is a task that is never finished: holding it is a claim, letting go
// is a release, and a lock whose holder died opens again when its lease lapses.
export async function lock(board: Board, id: string, leaseMs: number, labels: Record<string, string> = instance) {
  await ensure(board, { id, labels, spec: `lock ${id}` })
  return board.claim(id, { leaseMs })
}

// Locks that only guard work in this object's own memory: when the object
// starts again, whatever its earlier life held is let go at once rather than
// when the lease lapses, since nothing of that life is running any more.
export const instance = { lock: 'instance' }

// A lock that outlives the object, such as a throttle.
export const lasting = { lock: 'lasting' }

// Let go of the instance locks an earlier life held. The swarm claims as one
// actor in every life, so this runs once as its board opens, before this life
// has claimed anything: every instance lock still held is a past life's.
export async function reclaim(board: Board) {
  for (const task of await board.held()) if (task.labels['lock'] === instance.lock && task.claim) await board.release(task.id, task.claim, 'its holder restarted')
}

// Run `work` holding the lock `id`, renewing its lease every third of it while
// the work runs; while another holds it, `work` does not run and the refusal
// comes back instead.
export async function holding<T>(board: Board, id: string, leaseMs: number, work: () => Promise<T>): Promise<{ value: T } | { rejection: Rejection }> {
  const held = await lock(board, id, leaseMs)
  if (!held.ok) return { rejection: held.rejection }
  const timer = setInterval(() => void board.renew(id, held.claim, leaseMs).catch(() => undefined), Math.max(1, Math.floor(leaseMs / 3)))
  try {
    return { value: await work() }
  } finally {
    clearInterval(timer)
    await board.release(id, held.claim)
  }
}

// Run `work` once the lock `id` is free: callers take turns, one at a time.
export async function serial<T>(board: Board, id: string, leaseMs: number, work: () => Promise<T>, waitMs = 50): Promise<T> {
  for (;;) {
    const ran = await holding(board, id, leaseMs, work)
    if ('value' in ran) return ran.value
    if (ran.rejection.kind !== 'Held') throw new Error(`The lock ${id} was refused: ${ran.rejection.kind}`)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
}

// A once-only step, keyed by `id`: claimed here, finished when `work` returns,
// and never run again by anyone once finished. A step that threw opens again.
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
