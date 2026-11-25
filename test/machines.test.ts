// Deterministic simulations of the agent swarm's state machines: the run
// (machines/Run.ts), the lease (machines/Lease.ts, Work.holding), the serial
// lock's deadline (Work.serial), the event cursor (machines/Cursor.ts) and the
// tree runtime's first reclaim (Runner.ensure). Each simulation is seeded, so a
// failing seed replays; each invariant has a mutant: a test that turns its
// guard off and checks that the simulation goes red.

import assert from 'node:assert/strict'
import test from 'node:test'
import * as Run from '../src/worker/machines/Run.ts'
import * as Lease from '../src/worker/machines/Lease.ts'
import * as Cursor from '../src/worker/machines/Cursor.ts'
import * as Work from '../src/worker/Work.ts'
import type * as Phase from '../src/worker/Phase.ts'
import { board } from './board.ts'

function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const seeds = Array.from({ length: 200 }, (_, i) => i + 1)

function flipped<T extends Record<string, boolean>>(guards: T, key: keyof T, body: () => void | Promise<void>) {
  return async () => {
    guards[key] = false as T[keyof T]
    try {
      await body()
    } finally {
      guards[key] = true as T[keyof T]
    }
  }
}

// The run: one record, lives of the object that crash and come back over the
// same storage, past lives that wake late, and reports delivered twice.

type World = {
  basis?: number | undefined
  closed: Map<number, number>
  counts: Map<string, number>
  errors: string[]
  refused: { illegal: number; stale: number }
  started: Map<number, number>
  store: Run.Store
  transitions: Set<string>
  value: Run.Stored | undefined
}

const sync = new Set<Run.Effect>(['turned', 'logged', 'announced'])

export function world(): World {
  const w: World = { closed: new Map(), counts: new Map(), errors: [], refused: { illegal: 0, stale: 0 }, started: new Map(), store: undefined as never, transitions: new Set(), value: undefined }
  w.store = {
    get: () => (w.value === undefined ? undefined : structuredClone(w.value)),
    put: (run) => {
      const from = w.value ? Run.kind(w.value) : 'new'
      const to = Run.kind(run)
      if (!Run.can(from, to)) w.errors.push('illegal transition landed: ' + from + ' -> ' + to)
      w.transitions.add(from + '->' + to)
      // Rule 2: a write decided on an older read never lands over newer writes.
      if (w.basis !== undefined && w.basis !== Run.rev(w.value ?? { state: 'new' })) w.errors.push('a write decided on rev ' + w.basis + ' landed over rev ' + Run.rev(w.value ?? { state: 'new' }))
      w.basis = undefined
      if (run.state === 'starting' && w.closed.has(run.n)) w.errors.push('turn ' + run.n + ' started again after it closed')
      w.value = structuredClone(run)
    },
  }
  return w
}

function bump(w: World, key: string) {
  w.counts.set(key, (w.counts.get(key) ?? 0) + 1)
}

type Life = { at?: { n: number; pc: number }; last?: number; sleep?: number; pending?: { done: Promise<unknown>; resolve: () => void } | undefined; seen?: Run.Stored | undefined }

const report: Run.Report = { message: 'did a step', status: 'completed' }

function turned(run: Run.Stored) {
  return run.state === 'waiting' || run.state === 'paused' || run.state === 'new' ? ((run as { n?: number }).n ?? 0) : run.n
}

// One step of one life: read the run if it holds no fresh read, then act on
// what it read, fenced on that read's rev. Answers false when the life's
// in-flight effect is still waiting to be resolved.
export async function act(w: World, life: Life, rand: () => number, turns: { last: number }) {
  if (life.pending) {
    const { done, resolve } = life.pending
    life.pending = undefined
    resolve()
    await done.catch((error: unknown) => refuse(w, error))
    return
  }
  if (!life.seen) {
    life.seen = Run.read(w.store)
    life.last = turns.last
    // Sometimes the life then awaits a long while before it acts on what it read.
    if (rand() < 0.05) {
      life.sleep = Math.floor(rand() * 150)
      return
    }
  }
  const seen = life.seen
  const rev = Run.rev(seen)
  const k = Run.kind(seen)
  const pick = rand()
  try {
    if (pick < 0.03) {
      // An illegal move, which must be refused.
      const wrong = (Object.keys(Run.next) as Run.Kind[]).filter((to) => !Run.can(k, to) && to !== 'ending' && to !== 'new')
      const to = wrong[Math.floor(rand() * wrong.length)]
      if (to) fenced(w, rev, shape(to, turns.last + 1))
      life.seen = undefined
      return
    }
    if (k === 'new' || k === 'waiting') {
      if (pick < 0.7) {
        const n = (life.last ?? 0) + 1
        fenced(w, rev, { id: 'c' + n, n, since: null, state: 'starting', told: [] })
      } else if (pick < 0.85) fenced(w, rev, { at: 1, pause: { why: 'idle' }, state: 'paused' })
      else fenced(w, rev, { since: null, state: 'waiting', until: 1 })
    } else if (k === 'paused') {
      if (pick < 0.6) fenced(w, rev, { from: { why: 'idle' }, since: null, state: 'waiting', until: 1 })
      else fenced(w, rev, { ...(seen as Phase.Paused), settled: 2 })
    } else if (k === 'starting' && seen.state === 'starting') {
      if (pick < 0.7) {
        fenced(w, rev, { from: 0, n: seen.n, since: 1, started: 1, state: 'working', turn: 't' + seen.n })
        turns.last = Math.max(turns.last, seen.n)
      } else if (pick < 0.85) fenced(w, rev, { ...seen })
      else fenced(w, rev, { since: null, state: 'waiting', until: 1 })
    } else if (k === 'working' && seen.state === 'working') {
      if (pick < 0.15) fenced(w, rev, { ...seen, claim: 'k' })
      else Run.end(w.store, seen.n, report)
    } else if (k === 'ending' && seen.state === 'working') {
      const n = seen.n
      // A report for this turn delivered again.
      if (pick < 0.1) Run.end(w.store, n, report)
      // Run the effects in order from where this life is, as Turns.ending
      // does: a fresh life starts at the first and relies on the done marks.
      Run.ending(w.store, n)
      if (life.at?.n !== n) life.at = { n, pc: 0 }
      const next = Run.effects[life.at.pc++]
      if (next === undefined) {
        Run.close(w.store, n, pick < 0.5 ? { since: null, state: 'waiting', until: 1 } : { at: 1, pause: { why: 'rest', failures: 1 }, state: 'paused' })
        w.closed.set(n, (w.closed.get(n) ?? 0) + 1)
      } else if (sync.has(next)) Run.once(w.store, n, next, () => bump(w, n + ':' + next))
      else {
        let resolve = () => undefined as void
        const gate = new Promise<void>((done) => void (resolve = done))
        const done = Run.step(w.store, n, next, async () => {
          await gate
          bump(w, n + ':' + next)
        })
        life.pending = { done, resolve }
      }
    }
    life.seen = undefined
  } catch (error) {
    refuse(w, error)
    life.seen = undefined
  }
}

function fenced(w: World, rev: number, run: Phase.Run) {
  w.basis = rev
  try {
    return Run.write(w.store, run, rev)
  } finally {
    w.basis = undefined
  }
}

function refuse(w: World, error: unknown) {
  if (error instanceof Run.Refused) {
    if (error.kind === 'Stale') w.refused.stale++
    else w.refused.illegal++
    return
  }
  throw error
}

function shape(to: Run.Kind, n: number): Phase.Run {
  if (to === 'starting') return { id: 'x', n, since: null, state: 'starting', told: [] }
  if (to === 'working') return { from: 0, n, since: 1, started: 1, state: 'working', turn: 'x' }
  if (to === 'paused') return { at: 1, pause: { why: 'idle' }, state: 'paused' }
  return { since: null, state: 'waiting', until: 1 }
}

// Run one seeded simulation: up to three lives at once, crashes (a life
// dropped, a new one started over the same storage) and past lives that keep
// acting on what they read.
export async function simulate(seed: number, steps = 400) {
  const rand = random(seed)
  const w = world()
  const turns = { last: 0 }
  let lives: Life[] = [{}]

  for (let i = 0; i < steps; i++) {
    const roll = rand()
    if (roll < 0.05) {
      // The newest life dies here; it may wake later as a past life, acting
      // on what it last read, while a new life starts over the same storage.
      const dead = lives[lives.length - 1] as Life
      // It died after it read the run and before it wrote what it decided.
      if (!dead.seen) {
        dead.seen = Run.read(w.store)
        dead.last = turns.last
      }
      dead.sleep = Math.floor(rand() * 150)
      lives = [...lives.slice(-3), {}]
    }
    const life = lives[Math.floor(rand() * lives.length)] as Life
    for (const each of lives) if (each !== life && each.sleep) each.sleep--
    if (life.sleep) continue
    await act(w, life, rand, turns)
  }
  // Let every life finish what it began, then let one life finish the run.
  for (const life of lives) if (life.pending) await act(w, life, rand, turns)
  const last: Life = {}
  for (let i = 0; i < 80 && Run.kind(Run.read(w.store)) === 'ending'; i++) await act(w, last, () => 0.5, turns)
  return w
}

export function check(w: World) {
  const problems = [...w.errors]
  for (const [key, count] of w.counts) if (sync.has(key.split(':')[1] as Run.Effect) && count > 1) problems.push(key + ' ran ' + count + ' times')
  for (const [n, count] of w.closed) {
    if (count > 1) problems.push('turn ' + n + ' closed ' + count + ' times')
    for (const effect of Run.effects) if (!w.counts.get(n + ':' + effect)) problems.push('turn ' + n + ' closed without ' + effect)
  }
  return problems
}

test('the run machine: every seeded simulation never restarts a closed turn, folds each end once and every transition legal', async () => {
  const seen = new Set<string>()
  let stale = 0
  let illegal = 0
  for (const seed of seeds) {
    const w = await simulate(seed)
    assert.deepEqual(check(w), [], 'seed ' + seed)
    for (const transition of w.transitions) seen.add(transition)
    stale += w.refused.stale
    illegal += w.refused.illegal
  }
  const every = (Object.entries(Run.next) as [Run.Kind, readonly Run.Kind[]][]).flatMap(([from, tos]) => tos.map((to) => from + '->' + to))
  assert.deepEqual(every.filter((transition) => !seen.has(transition)), [], 'every transition is taken by some seed')
  assert.ok(stale > 0, 'stale writes were attempted and refused')
  assert.ok(illegal > 0, 'illegal writes were attempted and refused')
})

// A crash at every step of one turn: a first life runs k steps and dies, a
// second life over the same storage finishes; the first then wakes and keeps
// going on what it read (a past life).
test('the run machine: a crash at every step of a turn, and the dead life waking late, folds the turn once', async () => {
  const lifecycle = 2 + 1 + Run.effects.length * 2 + 1
  for (let k = 0; k <= lifecycle; k++) {
    for (const late of [false, true]) {
      const w = world()
      const turns = { last: 0 }
      const first: Life = {}
      const steady = () => 0.5
      // new -> starting, starting -> working, working -> ending, then effects.
      const choose = (i: number) => (i === 2 ? () => 0.9 : steady)
      for (let i = 0; i < k; i++) await act(w, first, choose(i), turns)
      const second: Life = {}
      for (let i = 0; i < 60 && !(w.closed.get(1) ?? 0); i++) await act(w, second, steady, turns)
      if (late) for (let i = 0; i < 6; i++) await act(w, first, steady, turns)
      assert.deepEqual(check(w), [], 'crash after ' + k + ' steps' + (late ? ', the dead life waking late' : ''))
      assert.equal(w.closed.get(1), 1, 'turn 1 closed once after a crash at ' + k)
    }
  }
})

test('the run machine: a report delivered twice keeps the first, and a write on an old read is refused', () => {
  const w = world()
  Run.write(w.store, { id: 'c1', n: 1, since: null, state: 'starting', told: [] })
  const working = Run.write(w.store, { from: 0, n: 1, since: 1, started: 1, state: 'working', turn: 't1' })
  Run.end(w.store, 1, report)
  Run.once(w.store, 1, 'turned', () => undefined)
  const again = Run.end(w.store, 1, { message: 'other', status: 'failed' })
  assert.deepEqual(again.ending?.done, ['turned'])
  assert.equal(again.ending?.report.message, 'did a step')
  assert.throws(() => Run.write(w.store, { ...working, claim: 'z' }, Run.rev(working)), (error: unknown) => error instanceof Run.Refused && error.kind === 'Illegal')
  assert.throws(() => Run.write(w.store, { from: 0, n: 1, since: 1, started: 1, state: 'working', turn: 't1', ending: again.ending } as Run.Stored, Run.rev(working)), (error: unknown) => error instanceof Run.Refused && error.kind === 'Stale')
  assert.throws(() => Run.end(w.store, 2, report), (error: unknown) => error instanceof Run.Refused && error.kind === 'Stale')
})

test('the run machine reads a record written before versioning, and the previous code reads an ending record as a turn still working', () => {
  const w = world()
  w.value = { from: 0, n: 3, since: 1, started: 1, state: 'working', turn: 't3' }
  assert.equal(Run.rev(Run.read(w.store)), 0)
  const ended = Run.end(w.store, 3, report)
  assert.equal(ended.state, 'working')
  assert.equal(ended.v, Run.version)
  assert.equal(Run.kind(ended), 'ending')
})

async function red(body: () => Promise<string[]>) {
  const problems = await body()
  assert.ok(problems.length > 0, 'the simulation catches the broken guard')
}

const many = async () => {
  const problems: string[] = []
  for (const seed of seeds.slice(0, 60)) problems.push(...check(await simulate(seed)))
  return problems
}

test('mutant: without the rev fence, a past life overwrites newer writes and can start a turn that already closed', flipped(Run.guards, 'fence', () => red(many)))

test('mutant: without the done marks, an effect of a turn end runs twice', flipped(Run.guards, 'once', () => red(many)))

test('mutant: a second report that restarts the end folds the turn twice', flipped(Run.guards, 'resume', () => red(many)))

test('mutant: without the transition table, an illegal transition lands', flipped(Run.guards, 'legal', () => red(many)))

// The lease: a board with one task, two holders, a clock, renews that answer,
// are refused or never arrive, and a new life that lets go of the old claim.

type Holder = { state: Lease.State }

function leaseSim(seed: number, steps = 300) {
  const rand = random(seed)
  const problems: string[] = []
  const kinds = new Set<string>()
  let now = 0
  const leaseMs = 30
  let board: { holder: number; until: number; claim: string } | undefined
  let claims = 0
  const holders: Holder[] = [{ state: Lease.unowned }, { state: Lease.unowned }]
  const refusedAt = new Map<Holder, number>()
  const apply = (h: Holder, event: Lease.Event) => {
    if (event.type === 'refused') refusedAt.set(h, h.state.epoch)
    h.state = Lease.step(h.state, event)
    kinds.add(h.state.kind)
  }
  for (let i = 0; i < steps; i++) {
    const who = Math.floor(rand() * 2)
    const h = holders[who] as Holder
    const roll = rand()
    if (board && now >= board.until) board = undefined
    if (roll < 0.15 && (h.state.kind === 'Unowned' || h.state.kind === 'Released' || h.state.kind === 'Lost')) {
      apply(h, { type: 'claim' })
      if (!board) {
        board = { claim: 'c' + ++claims, holder: who, until: now + leaseMs }
        apply(h, { claim: board.claim, type: 'claimed', until: board.until })
      } else apply(h, { type: 'held', why: 'Held' })
    } else if (roll < 0.45 && h.state.kind === 'Owned') {
      const fate = rand()
      if (fate < 0.2) apply(h, { type: 'transport' })
      else if (board && board.claim === h.state.claim) {
        board.until = now + leaseMs
        apply(h, { type: 'renewed', until: board.until })
      } else apply(h, { type: 'refused', why: 'NotHolder' })
    } else if (roll < 0.5 && board) {
      // A new life lets go of the claim at once (Work.reclaim).
      board = undefined
    } else if (roll < 0.6 && h.state.kind === 'Owned') {
      apply(h, { type: 'drain' })
      if (board && board.claim === (h.state as { claim: string }).claim) board = undefined
      apply(h, { type: 'released' })
    } else if (roll < 0.85) {
      now += Math.floor(rand() * 15)
      for (const each of holders) apply(each, { now, type: 'tick' })
    } else {
      // Work under the lease tries a fenced write: the board refuses it
      // unless it agrees this holder holds the claim, and a refusal is Lost.
      const s = h.state
      if (s.kind === 'Owned' && Lease.writable(s, s.epoch, now) && !(board && board.claim === s.claim && now < board.until)) apply(h, { type: 'refused', why: 'NotHolder' })
    }
    for (const each of holders) {
      const s = each.state
      if (s.kind === 'Owned' && now >= s.until) problems.push('seed ' + seed + ': a lease past its end is still owned')
      if (s.kind === 'Owned' && refusedAt.get(each) === s.epoch && Lease.writable(s, s.epoch, now)) problems.push('seed ' + seed + ': work may still write after its lease was refused')
    }
  }
  return { kinds, problems }
}

test('the lease machine: in every seeded simulation, work never writes after its lease is lost, and every state is reached', () => {
  const kinds = new Set<string>()
  for (const seed of seeds) {
    const sim = leaseSim(seed)
    assert.deepEqual(sim.problems, [])
    for (const kind of sim.kinds) kinds.add(kind)
  }
  assert.deepEqual([...kinds].sort(), ['Claiming', 'Draining', 'Lost', 'Owned', 'Released', 'Unowned'])
  assert.throws(() => Lease.step(Lease.unowned, { type: 'drain' }), Lease.Illegal)
  assert.equal(Lease.step({ epoch: 1, kind: 'Lost', why: 'x' }, { type: 'renewed', until: 99 }).kind, 'Lost', 'a late renew revives nothing')
})

const leaseRed = () => {
  const problems = seeds.flatMap((seed) => leaseSim(seed).problems)
  assert.ok(problems.length > 0, 'the simulation catches the broken guard')
}

test('mutant: a refused renew that is swallowed leaves work writing after the lease is lost', flipped(Lease.guards, 'lost', leaseRed))

test('mutant: a lease that runs out with no renew answering is still owned', flipped(Lease.guards, 'expiry', leaseRed))

// Work.holding over a real board whose renew is refused once the work started.
async function refusedRenew() {
  const one = board()
  const renew = one.renew
  let released = 0
  one.renew = async (id, claim, leaseMs) => {
    if (id === 'lock-r') return { ok: false, rejection: { kind: 'NotHolder' } }
    return renew(id, claim, leaseMs)
  }
  const release = one.release
  one.release = async (id, claim, note) => {
    if (id === 'lock-r') released++
    return release(id, claim, note)
  }
  let aborted = false
  const ran = await Work.holding(one, 'lock-r', 600, async (held) => {
    await new Promise<void>((resolve) => {
      held.signal.addEventListener('abort', () => resolve(), { once: true })
      setTimeout(resolve, 450)
    })
    aborted = held.signal.aborted
    return 'wrote'
  })
  return { aborted, ran, released }
}

test('Work.holding: a refused renew aborts the work, answers lost and does not release a claim that is no longer its own', async () => {
  const { aborted, ran, released } = await refusedRenew()
  assert.equal(aborted, true)
  assert.deepEqual(ran, { lost: 'NotHolder' })
  assert.equal(released, 0)
})

test('mutant: Work.holding that swallows a refused renew returns the value of work done after the lease was lost', flipped(Lease.guards, 'lost', async () => {
  const { aborted, ran } = await refusedRenew()
  assert.equal(aborted, false)
  assert.ok('value' in ran)
}))

// Work.serial: callers take turns, and a wait has a deadline.
async function contend(seed: number) {
  const rand = random(seed)
  const one = board()
  let inside = 0
  let most = 0
  const outcomes = await Promise.all(
    Array.from({ length: 5 }, async () => {
      try {
        await Work.serial(
          one,
          'budgeting',
          1_000,
          async () => {
            inside++
            most = Math.max(most, inside)
            await new Promise((resolve) => setTimeout(resolve, Math.floor(rand() * 20)))
            inside--
          },
          5,
          rand() < 0.3 ? 15 : 2_000,
        )
        return 'ran'
      } catch (error) {
        if (error instanceof Work.Busy) return 'busy'
        throw error
      }
    }),
  )
  return { most, outcomes }
}

test('Work.serial: in every seeded run callers take turns one at a time, and each either runs or is told Busy by its deadline', async () => {
  for (const seed of seeds.slice(0, 20)) {
    const { most, outcomes } = await contend(seed)
    assert.equal(most, 1, 'seed ' + seed)
    assert.ok(outcomes.every((outcome) => outcome === 'ran' || outcome === 'busy'))
  }
})

async function stuckWait() {
  const one = board()
  await Work.lock(one, 'budgeting', 60_000)
  const waited = Work.serial(one, 'budgeting', 60_000, async () => 'ran', 5, 60).then(
    () => 'ran',
    (error: unknown) => (error instanceof Work.Busy ? 'busy' : 'threw'),
  )
  return Promise.race([waited, new Promise((resolve) => setTimeout(() => resolve('hung'), 400))])
}

test('Work.serial: a lock that is never let go answers Busy at the deadline', async () => {
  assert.equal(await stuckWait(), 'busy')
})

test('mutant: Work.serial without a deadline spins forever on a lock that is never let go', flipped(Work.guards, 'deadline', async () => {
  assert.equal(await stuckWait(), 'hung')
}))

// The event cursor: pages read again, streams that reconnect from an older
// cursor, and restarts between the fold and the next page.
function cursorSim(seed: number) {
  const rand = random(seed)
  const total = 40
  const folded = new Map<number, number>()
  let saved = 0
  let memory = 0
  let at = 0
  for (let i = 0; i < 300 && saved < total; i++) {
    const roll = rand()
    if (roll < 0.1) {
      memory = saved
      at = Math.max(0, saved - Math.floor(rand() * 5))
      continue
    }
    const from = Math.max(0, at - Math.floor(rand() * 4))
    const page = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, j) => ({ seq: from + j + 1 })).filter((event) => event.seq <= total)
    const next = Cursor.fresh(page, memory)
    for (const event of next.events) folded.set(event.seq, (folded.get(event.seq) ?? 0) + 1)
    memory = next.cursor
    saved = memory
    at = memory
  }
  const problems: string[] = []
  for (let seq = 1; seq <= total; seq++) {
    const count = folded.get(seq) ?? 0
    if (count !== 1 && saved >= total) problems.push('seed ' + seed + ': event ' + seq + ' folded ' + count + ' times')
  }
  return problems
}

test('the event cursor: in every seeded simulation each event is folded exactly once', () => {
  assert.deepEqual(seeds.flatMap(cursorSim), [])
})

test('mutant: without the seq check, a page read again folds its events twice', flipped(Cursor.guards, 'seq', () => {
  assert.ok(seeds.flatMap(cursorSim).length > 0)
}))

