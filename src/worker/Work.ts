// A swarm's own coordination, as a board of tasks with leased claims.
//
// Every lock, timer and once-only step the swarm used to keep by hand (the
// single-flight step, the budgeting chain, the soft locks in kv, the stuck and
// stall timers, retry backoff, the steered notes, branch settlement and the
// hand cap) is a task here: claimed with a lease, renewed while it is alive,
// released or finished. `Board` is the shape of nanocode-ts's `Board`, which
// opens over the swarm's own SQLite; until that build is pinned, `local` keeps
// the same semantics in tables of the same database, so a swarm's claims live
// as long as the object's storage does.

export type Phase = 'open' | 'claimed' | 'done' | 'failed' | 'cancelled' | 'blocked'

export type Retry = { backoffMs: number; maxAttempts: number }

export type Terms = { assignee?: string; dueAtMs?: number; every?: number; retry?: Retry }

export type Post = { id: string; labels?: Record<string, string>; needs?: string[]; parent?: string; spec: string; terms?: Terms }

export type Task = {
  attempts: number
  claim?: string | undefined
  dueAtMs?: number | undefined
  id: string
  labels: Record<string, string>
  needs: string[]
  outcome?: string | undefined
  parent: string | null
  phase: Phase
  spec: string
  terms: Terms
  untilMs?: number | undefined
  worker?: string | undefined
}

export type Rejection =
  | { kind: 'Exists' }
  | { kind: 'UnknownTask' }
  | { kind: 'UnknownParent'; parent: string }
  | { kind: 'UnknownNeed'; need: string }
  | { kind: 'Waiting'; need?: string | undefined; untilMs?: number | undefined }
  | { claim: string; kind: 'Held'; untilMs: number; worker?: string | undefined }
  | { kind: 'NotHolder' }
  | { kind: 'Terminal' }
  | { kind: 'Unheeded'; upto: number }
  | { cap: number; kind: 'Full' }

export type Verdict = { ok: true } | { ok: false; rejection: Rejection }

export type Claimed = { claim: string; ok: true; tookOver: boolean; untilMs: number } | { ok: false; rejection: Rejection }

export type Outcome = { done: string } | { failed: string }

export type Steer = { atMs: number; by: string; id: string; key?: string | undefined; text: string }

export interface Board {
  claim(id: string, opts: { atMs?: number; cap?: number; key?: string; leaseMs: number }): Claimed
  finish(id: string, claim: string, outcome: Outcome): Verdict
  heed(id: string, claim: string, steers: readonly string[]): Verdict
  held(atMs?: number): Task[]
  label(id: string, set: Record<string, string>, unset?: readonly string[]): Verdict
  post(task: Post, opts?: { key?: string }): Verdict
  ready(opts?: { atMs?: number; label?: [string, string] }): Task[]
  release(id: string, claim: string, note?: string): Verdict
  renew(id: string, claim: string, leaseMs: number): Claimed
  steer(id: string, text: string, opts?: { key?: string }): Verdict
  steers(id: string): Steer[]
  task(id: string): Task | null
  tasks(): Task[]
}

export type Sql = { exec<T extends Record<string, SqlStorageValue>>(query: string, ...values: unknown[]): { toArray(): T[] } }

const schema = [
  "CREATE TABLE IF NOT EXISTS work_tasks (scope TEXT NOT NULL, id TEXT NOT NULL, parent TEXT, spec TEXT NOT NULL, labels TEXT NOT NULL DEFAULT '{}', needs TEXT NOT NULL DEFAULT '[]', terms TEXT NOT NULL DEFAULT '{}', phase TEXT NOT NULL, claim TEXT, worker TEXT, until_ms INTEGER, due_at_ms INTEGER, attempts INTEGER NOT NULL DEFAULT 0, outcome TEXT, PRIMARY KEY (scope, id))",
  'CREATE TABLE IF NOT EXISTS work_keys (scope TEXT NOT NULL, key TEXT NOT NULL, PRIMARY KEY (scope, key))',
  'CREATE TABLE IF NOT EXISTS work_steers (seq INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, task TEXT NOT NULL, by TEXT NOT NULL, at_ms INTEGER NOT NULL, body TEXT NOT NULL, key TEXT, heeded INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS work_steers_pending ON work_steers (scope, task) WHERE heeded = 0',
]

type Stored = {
  attempts: number
  claim: string | null
  due_at_ms: number | null
  id: string
  labels: string
  needs: string
  outcome: string | null
  parent: string | null
  phase: string
  spec: string
  terms: string
  until_ms: number | null
  worker: string | null
}

function loaded(row: Stored): Task {
  return {
    attempts: Number(row.attempts),
    ...(row.claim === null ? {} : { claim: row.claim }),
    ...(row.due_at_ms === null ? {} : { dueAtMs: Number(row.due_at_ms) }),
    id: row.id,
    labels: JSON.parse(row.labels) as Record<string, string>,
    needs: JSON.parse(row.needs) as string[],
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    parent: row.parent,
    phase: row.phase as Phase,
    spec: row.spec,
    terms: JSON.parse(row.terms) as Terms,
    ...(row.until_ms === null ? {} : { untilMs: Number(row.until_ms) }),
    ...(row.worker === null ? {} : { worker: row.worker }),
  }
}

export function terminal(phase: Phase) {
  return phase === 'done' || phase === 'failed' || phase === 'cancelled'
}

// The wait before the next try after `attempts` failed ones, as the board's
// Terms.retry schedules it: backoffMs, doubled for every try after the first.
export function delay(retry: Retry, attempts: number) {
  return retry.backoffMs * 2 ** Math.max(0, attempts - 1)
}

function fail(rejection: Rejection): { ok: false; rejection: Rejection } {
  return { ok: false, rejection }
}

const ok = { ok: true } as const

export function local(sql: Sql, scope: string, actor: string): Board {
  for (const statement of schema) sql.exec(statement)
  const now = (at?: number) => Math.max(at ?? 0, Date.now())
  const read = (id: string) => sql.exec<Stored>('SELECT * FROM work_tasks WHERE scope = ? AND id = ?', scope, id).toArray()[0]
  const task = (id: string) => {
    const row = read(id)
    return row ? loaded(row) : null
  }
  const seen = (key: string) => sql.exec<{ seen: number }>('SELECT 1 AS seen FROM work_keys WHERE scope = ? AND key = ?', scope, key).toArray().length > 0
  const keep = (key: string | undefined) => {
    if (key !== undefined) sql.exec('INSERT OR IGNORE INTO work_keys (scope, key) VALUES (?, ?)', scope, key)
  }
  const pending = (id: string) => sql.exec<{ seq: number }>('SELECT seq FROM work_steers WHERE scope = ? AND task = ? AND heeded = 0 ORDER BY seq', scope, id).toArray()
  const held = (found: Task, at: number) => found.phase === 'claimed' && (found.untilMs ?? 0) > at
  const holds = (id: string, claim: string): Task | Rejection => {
    const found = task(id)
    if (!found) return { kind: 'UnknownTask' }
    if (terminal(found.phase)) return { kind: 'Terminal' }
    if (found.phase !== 'claimed' || found.claim !== claim) return { kind: 'NotHolder' }
    return found
  }
  const waiting = (found: Task, at: number): Rejection | undefined => {
    if (found.dueAtMs !== undefined && found.dueAtMs > at) return { kind: 'Waiting', untilMs: found.dueAtMs }
    for (const need of found.needs) if (task(need)?.phase !== 'done') return { kind: 'Waiting', need }
    return undefined
  }
  const all = () => sql.exec<Stored>('SELECT * FROM work_tasks WHERE scope = ? ORDER BY id', scope).toArray().map(loaded)

  return {
    claim(id, opts) {
      const at = now(opts.atMs)
      const found = task(id)
      if (!found) return fail({ kind: 'UnknownTask' })
      if (terminal(found.phase)) return fail({ kind: 'Terminal' })
      if (held(found, at)) return fail({ claim: found.claim ?? '', kind: 'Held', untilMs: found.untilMs ?? at, worker: found.worker })
      const wait = waiting(found, at)
      if (wait) return fail(wait)
      if (opts.cap !== undefined) {
        const others = all().filter((other) => other.id !== id && held(other, at)).length
        if (others >= opts.cap) return fail({ cap: opts.cap, kind: 'Full' })
      }
      const tookOver = found.phase === 'claimed'
      const claim = opts.key ?? `${actor}.${crypto.randomUUID()}`
      const untilMs = at + opts.leaseMs
      sql.exec("UPDATE work_tasks SET phase = 'claimed', claim = ?, worker = ?, until_ms = ?, due_at_ms = NULL, attempts = attempts + 1 WHERE scope = ? AND id = ?", claim, actor, untilMs, scope, id)
      return { claim, ok: true, tookOver, untilMs }
    },
    finish(id, claim, outcome) {
      const found = holds(id, claim)
      if ('kind' in found) return fail(found)
      const unheeded = pending(id).at(-1)
      if (unheeded) return fail({ kind: 'Unheeded', upto: Number(unheeded.seq) })
      const retry = found.terms.retry
      if ('failed' in outcome && retry && found.attempts < retry.maxAttempts) {
        sql.exec("UPDATE work_tasks SET phase = 'open', claim = NULL, worker = NULL, until_ms = NULL, due_at_ms = ?, outcome = ? WHERE scope = ? AND id = ?", Date.now() + delay(retry, found.attempts), outcome.failed, scope, id)
        return ok
      }
      sql.exec('UPDATE work_tasks SET phase = ?, until_ms = NULL, outcome = ? WHERE scope = ? AND id = ?', 'done' in outcome ? 'done' : 'failed', 'done' in outcome ? outcome.done : outcome.failed, scope, id)
      return ok
    },
    heed(id, claim, steers) {
      const found = holds(id, claim)
      if ('kind' in found) return fail(found)
      const upto = Math.max(0, ...steers.map(Number))
      if (!pending(id).some((steer) => Number(steer.seq) === upto)) return fail({ kind: 'Unheeded', upto })
      sql.exec('UPDATE work_steers SET heeded = 1 WHERE scope = ? AND task = ? AND seq <= ?', scope, id, upto)
      return ok
    },
    held(atMs) {
      const at = now(atMs)
      return all().filter((found) => held(found, at))
    },
    label(id, set, unset = []) {
      const found = task(id)
      if (!found) return fail({ kind: 'UnknownTask' })
      const labels = { ...found.labels, ...set }
      for (const key of unset) delete labels[key]
      sql.exec('UPDATE work_tasks SET labels = ? WHERE scope = ? AND id = ?', JSON.stringify(labels), scope, id)
      return ok
    },
    post(posted, opts = {}) {
      if (opts.key !== undefined && seen(opts.key)) return ok
      if (read(posted.id)) return fail({ kind: 'Exists' })
      if (posted.parent !== undefined && !read(posted.parent)) return fail({ kind: 'UnknownParent', parent: posted.parent })
      for (const need of posted.needs ?? []) if (!read(need)) return fail({ kind: 'UnknownNeed', need })
      keep(opts.key)
      sql.exec(
        "INSERT INTO work_tasks (scope, id, parent, spec, labels, needs, terms, phase, due_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)",
        scope,
        posted.id,
        posted.parent ?? null,
        posted.spec,
        JSON.stringify(posted.labels ?? {}),
        JSON.stringify(posted.needs ?? []),
        JSON.stringify(posted.terms ?? {}),
        posted.terms?.dueAtMs ?? null,
      )
      return ok
    },
    ready(opts = {}) {
      const at = now(opts.atMs)
      return all().filter((found) => (found.phase === 'open' || (found.phase === 'claimed' && !held(found, at))) && !waiting(found, at) && (!opts.label || found.labels[opts.label[0]] === opts.label[1]))
    },
    release(id, claim, note) {
      const found = holds(id, claim)
      if ('kind' in found) return fail(found)
      sql.exec("UPDATE work_tasks SET phase = 'open', claim = NULL, worker = NULL, until_ms = NULL, outcome = ? WHERE scope = ? AND id = ?", note ?? null, scope, id)
      return ok
    },
    renew(id, claim, leaseMs) {
      const found = holds(id, claim)
      if ('kind' in found) return fail(found)
      const untilMs = Date.now() + leaseMs
      sql.exec('UPDATE work_tasks SET until_ms = ? WHERE scope = ? AND id = ?', untilMs, scope, id)
      return { claim, ok: true, tookOver: false, untilMs }
    },
    steer(id, text, opts = {}) {
      const found = task(id)
      if (!found) return fail({ kind: 'UnknownTask' })
      if (terminal(found.phase)) return fail({ kind: 'Terminal' })
      if (opts.key !== undefined && seen(opts.key)) return ok
      keep(opts.key)
      sql.exec('INSERT INTO work_steers (scope, task, by, at_ms, body, key) VALUES (?, ?, ?, ?, ?, ?)', scope, id, actor, Date.now(), text, opts.key ?? null)
      return ok
    },
    steers(id) {
      return sql
        .exec<{ at_ms: number; body: string; by: string; key: string | null; seq: number }>('SELECT seq, by, at_ms, body, key FROM work_steers WHERE scope = ? AND task = ? AND heeded = 0 ORDER BY seq', scope, id)
        .toArray()
        .map((row) => ({ atMs: Number(row.at_ms), by: row.by, id: String(row.seq), ...(row.key === null ? {} : { key: row.key }), text: row.body }))
    },
    task,
    tasks: all,
  }
}

// Post a task unless it is there already.
export function ensure(board: Board, task: Post) {
  const posted = board.post(task)
  if (!posted.ok && posted.rejection.kind !== 'Exists') throw new Error(`Posting ${task.id} was refused: ${posted.rejection.kind}`)
}

// A lock is a task that is never finished: holding it is a claim, letting go
// is a release, and a lock whose holder died opens again when its lease lapses.
export function lock(board: Board, id: string, leaseMs: number, labels: Record<string, string> = instance) {
  ensure(board, { id, labels, spec: `lock ${id}` })
  return board.claim(id, { leaseMs })
}

// Locks that only guard work in this object's own memory: when the object
// starts again, whatever its earlier life held is let go at once rather than
// when the lease lapses, since nothing of that life is running any more.
export const instance = { lock: 'instance' }

// A lock that outlives the object, such as a throttle.
export const lasting = { lock: 'lasting' }

export function reclaim(board: Board, actor: string) {
  for (const task of board.held()) if (task.labels['lock'] === 'instance' && task.worker !== actor && task.claim) board.release(task.id, task.claim, 'its holder restarted')
}

// Run `work` holding the lock `id`, renewing its lease every third of it while
// the work runs; while another holds it, `work` does not run and the refusal
// comes back instead.
export async function holding<T>(board: Board, id: string, leaseMs: number, work: () => Promise<T>): Promise<{ value: T } | { rejection: Rejection }> {
  const held = lock(board, id, leaseMs)
  if (!held.ok) return { rejection: held.rejection }
  const timer = setInterval(() => board.renew(id, held.claim, leaseMs), Math.max(1, Math.floor(leaseMs / 3)))
  try {
    return { value: await work() }
  } finally {
    clearInterval(timer)
    board.release(id, held.claim)
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
  ensure(board, { id, spec: `once ${id}` })
  const held = board.claim(id, { leaseMs })
  if (!held.ok) return { ran: false }
  try {
    const value = await work()
    board.finish(id, held.claim, { done: '' })
    return { ran: true, value }
  } catch (error) {
    board.release(id, held.claim, String(error))
    throw error
  }
}
