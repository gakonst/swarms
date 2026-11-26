import { createHash } from 'node:crypto'
import * as Cursor from '../../src/worker/machines/Cursor.ts'
import * as Hand from '../../src/worker/machines/Hand.ts'
import * as Lease from '../../src/worker/machines/Lease.ts'
import * as Payment from '../../src/worker/machines/Payment.ts'
import * as Run from '../../src/worker/machines/Run.ts'
import * as Tree from '../../src/worker/machines/Tree.ts'
import * as Work from '../../src/worker/Work.ts'
import type * as Phase from '../../src/worker/Phase.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  cursor: { events: 4000, maxGap: 3, page: 16, steps: 5000 },
  fold: { runs: 12, steps: 2000 },
  hand: { hands: 12, steps: 2000 },
  lease: {
    deadlineMs: 250,
    holders: 4,
    jumpMaxMs: 400,
    latencyMs: 5,
    leaseMs: 300,
    steps: 40_000,
    virtualMs: 12_000,
    waitMs: 40,
    workMaxMs: 700,
  },
  payment: {
    attempts: 12,
    logical: 150,
    rounds: 50,
    spreadMs: 60_000,
    steps: 40_000,
  },
  run: { lives: 4, opsPerLife: 40, steps: 3000 },
  violations: 20,
}

type Rng = {
  chance: (p: number) => boolean
  int: (lo: number, hi: number) => number
  next: () => number
  pick: <T>(items: readonly T[]) => T
}

function rng(...parts: (number | string)[]): Rng {
  const digest = createHash('sha256').update(parts.join(':')).digest()
  let a = digest.readUInt32LE(0)
  let b = digest.readUInt32LE(4)
  let c = digest.readUInt32LE(8)
  let d = digest.readUInt32LE(12)
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0
    d = (d + 1) >>> 0
    a = (b ^ (b >>> 9)) >>> 0
    b = (c + (c << 3)) >>> 0
    c = ((c << 21) | (c >>> 11)) >>> 0
    c = (c + t) >>> 0
    return t / 4294967296
  }
  return {
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    next,
    pick: (items) => items[Math.floor(next() * items.length)] as never,
  }
}

function recorder() {
  const violations: Violation[] = []
  const fail = (invariant: string, detail: string) => {
    if (violations.length < limits.violations) violations.push({ detail, invariant })
  }
  return { fail, violations }
}

type Timer = {
  at: number
  fn: () => void
  handle: Handle
  live: boolean
  seq: number
}

class Handle {
  readonly timer: Timer
  constructor(timer: Timer) {
    this.timer = timer
  }
  close() {
    this.timer.live = false
    return this
  }
  hasRef() {
    return true
  }
  ref() {
    return this
  }
  refresh() {
    return this
  }
  unref() {
    return this
  }
  [Symbol.toPrimitive]() {
    return this.timer.seq
  }
}

function before(a: Timer, b: Timer) {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq)
}

class Clock {
  activity = 0
  heap: Timer[] = []
  now: number
  seq = 0
  constructor(start: number) {
    this.now = start
  }
  add(fn: () => void, ms: unknown = 0) {
    this.activity += 1
    const timer = {
      at: this.now + Math.max(0, Number(ms) || 0),
      fn,
      live: true,
      seq: ++this.seq,
    } as Timer
    timer.handle = new Handle(timer)
    this.heap.push(timer)
    let i = this.heap.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (!before(this.heap[i] as Timer, this.heap[up] as Timer)) break
      ;[this.heap[i], this.heap[up]] = [this.heap[up] as Timer, this.heap[i] as Timer]
      i = up
    }
    return timer.handle
  }
  pop() {
    const top = this.heap[0]
    const last = this.heap.pop()
    if (top && last && top !== last) {
      this.heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < this.heap.length && before(this.heap[l] as Timer, this.heap[m] as Timer)) m = l
        if (r < this.heap.length && before(this.heap[r] as Timer, this.heap[m] as Timer)) m = r
        if (m === i) break
        ;[this.heap[i], this.heap[m]] = [this.heap[m] as Timer, this.heap[i] as Timer]
        i = m
      }
    }
    return top
  }
  peek() {
    while (this.heap[0] && !this.heap[0].live) this.pop()
    return this.heap[0]
  }
}

const real = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  Date: globalThis.Date,
  random: Math.random,
  setImmediate: globalThis.setImmediate,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
  uuid: crypto.randomUUID.bind(crypto),
}

const start = Date.UTC(2027, 0, 4, 9)

function install(clock: Clock, random: Rng) {
  const g = globalThis as Record<string, unknown>
  g['setTimeout'] = (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => clock.add(() => fn(...args), ms)
  g['clearTimeout'] = (handle: unknown) => {
    if (handle instanceof Handle) handle.close()
    else if (handle !== undefined) real.clearTimeout(handle as never)
  }
  g['setInterval'] = (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const every = Math.max(1, Number(ms) || 1)
    const state = { closed: false, current: undefined as Handle | undefined }
    const tick = () => {
      if (state.closed) return
      state.current = clock.add(tick, every)
      fn(...args)
    }
    state.current = clock.add(tick, every)
    const handle = new Handle({
      at: 0,
      fn: () => undefined,
      handle: undefined as never,
      live: true,
      seq: -1,
    })
    handle.close = () => {
      state.closed = true
      state.current?.close()
      return handle
    }
    return handle
  }
  g['clearInterval'] = (handle: unknown) => {
    if (handle instanceof Handle) handle.close()
    else if (handle !== undefined) real.clearInterval(handle as never)
  }
  class SimDate extends real.Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.now)
      else super(...(args as [number]))
    }
    static override now() {
      return clock.now
    }
  }
  g['Date'] = SimDate
  Math.random = () => random.next()
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(random.next() * 16).toString(16)).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}` as `${string}-${string}-${string}-${string}-${string}`
  }
  return () => {
    g['setTimeout'] = real.setTimeout
    g['clearTimeout'] = real.clearTimeout
    g['setInterval'] = real.setInterval
    g['clearInterval'] = real.clearInterval
    g['Date'] = real.Date
    Math.random = real.random
    crypto.randomUUID = real.uuid
  }
}

function tick() {
  return new Promise<void>((resolve) => real.setImmediate(resolve))
}

async function drain(clock: Clock) {
  for (let idle = 0; idle < 2;) {
    const was = clock.activity
    await tick()
    idle = clock.activity === was ? idle + 1 : 0
  }
}

async function advance(clock: Clock, end: number, budget: number, check: () => void) {
  let steps = 0
  for (; steps < budget; steps++) {
    await drain(clock)
    check()
    const next = clock.peek()
    if (!next || next.at > end) break
    clock.pop()
    next.live = false
    clock.now = Math.max(clock.now, next.at)
    clock.activity += 1
    next.fn()
  }
  await drain(clock)
  check()
  return steps
}

function sleep(clock: Clock, ms: number) {
  return new Promise<void>((resolve) => clock.add(resolve, ms))
}

type Life = { alive: boolean; id: number }

const awaited: ReadonlySet<Run.Effect> = new Set<Run.Effect>(['turned', 'attempted', 'published'])

const kinds: readonly Run.Kind[] = ['new', 'waiting', 'starting', 'working', 'paused']

async function run(seed: string): Promise<Outcome> {
  const random = rng(seed, 'run')
  const { fail, violations } = recorder()
  const map = new Map<string, unknown>()
  const observe = (next: Run.Stored) => {
    const prev = (map.get('run') as Run.Stored | undefined) ?? { state: 'new' }
    const from = Run.kind(prev)
    const to = Run.kind(next)
    if (!Run.can(from, to)) fail('legal', from + ' -> ' + to + ' at rev ' + Run.rev(prev))
    if (Run.rev(next) !== Run.rev(prev) + 1) fail('rev', 'rev ' + Run.rev(prev) + ' -> ' + Run.rev(next))
    if (next.v !== Run.version) fail('versioned', 'a run was stored at version ' + String(next.v) + ', not ' + Run.version)
    if (next.state !== 'working' || !next.ending) return
    const now = next.ending
    if (new Set(now.done).size !== now.done.length) fail('effect once', 'turn ' + next.n + ' marked ' + now.done.join(','))
    if (prev.state !== 'working' || !prev.ending || prev.n !== next.n) return
    const was = prev.ending
    if (JSON.stringify(was.report) !== JSON.stringify(now.report))
      fail('first report', 'turn ' + next.n + ' report ' + was.report.status + ' -> ' + now.report.status)
    if (was.done.some((effect, i) => now.done[i] !== effect))
      fail('first report', 'turn ' + next.n + ' done ' + was.done.join(',') + ' -> ' + now.done.join(','))
  }
  const storage = (life: Life) => ({
    delete: (key: string) => {
      if (life.alive) map.delete(key)
    },
    get: <T>(key: string) => (map.has(key) ? structuredClone(map.get(key)) : undefined) as T | undefined,
    put: (key: string, value: unknown) => {
      if (!life.alive) return
      const copy = structuredClone(value) as Run.Stored
      if (key === 'run') observe(copy)
      map.set(key, copy)
    },
  })
  const legacy = new Map<string, unknown>([['run', { from: 0, n: 3, since: 1, started: 1, state: 'working', turn: 't3' }]])
  const older: Run.Store = {
    get: () => structuredClone(legacy.get('run')) as Run.Stored | undefined,
    put: (value) => void legacy.set('run', structuredClone(value)),
  }
  if (Run.rev(Run.read(older)) !== 0) fail('versioned', 'a record written before versioning reads at rev ' + Run.rev(Run.read(older)))
  const ended = Run.end(older, 3, { message: 'done', status: 'completed' })
  if (Run.kind(ended) !== 'ending' || ended.state !== 'working' || ended.v !== Run.version)
    fail('versioned', 'a record written before versioning ended as ' + Run.kind(ended) + ' at version ' + String(ended.v))
  const pending: { life: Life; resolve: () => void }[] = []
  const pause = (life: Life) => new Promise<void>((resolve) => pending.push({ life, resolve }))
  const touch = (n: number, effect: Run.Effect) => {
    const now = map.get('run') as Run.Stored | undefined
    if (now?.state === 'working' && now.n === n && now.ending?.done.includes(effect))
      fail('effect once', 'turn ' + n + ' ran ' + effect + ' after it was marked done')
  }
  const write = (store: Run.Store, next: Phase.Run | Run.Stored, expect: number) => {
    const was = Run.rev(Run.read(store))
    Run.write(store, next, expect)
    if (was !== expect) fail('stale write', 'a writer that read rev ' + expect + ' landed over rev ' + was)
  }
  const report = (): Run.Report => {
    const at = random.int(0, 2)
    if (at === 0) return { message: 'done', status: 'completed' }
    if (at === 1) return { error: 'boom', message: null, status: 'failed' }
    return { message: null, status: 'cancelled' }
  }
  const make = (kind: Run.Kind, n: number): Run.Stored => {
    if (kind === 'new') return { state: 'new' }
    if (kind === 'waiting') return { since: null, state: 'waiting', until: 0 }
    if (kind === 'paused') return { at: 0, pause: { why: 'idle' }, state: 'paused' } as never
    if (kind === 'starting') return { id: 't' + n, n, since: null, state: 'starting', told: [] }
    const working = {
      from: 0,
      n,
      since: 0,
      started: 0,
      state: 'working',
      turn: 't' + n,
    } as const
    return kind === 'working' ? working : { ...working, ending: { done: [], report: report() } }
  }
  let turns = 0
  const act = async (life: Life, store: Run.Store) => {
    const now = Run.read(store)
    const rev = Run.rev(now)
    const kind = Run.kind(now)
    if (random.chance(0.1)) {
      const target = make(random.pick(kinds), random.int(0, turns + 1))
      await pause(life)
      write(store, target, rev)
      return
    }
    if (kind === 'new' || kind === 'waiting') {
      const n = turns + 1
      const paused = random.chance(0.15)
      await pause(life)
      write(store, make(paused ? 'paused' : 'starting', n), rev)
      if (!paused) turns = Math.max(turns, n)
      return
    }
    if (kind === 'paused') {
      await pause(life)
      write(store, make('waiting', 0), rev)
      return
    }
    if (now.state === 'starting') {
      await pause(life)
      write(store, make('working', now.n), rev)
      return
    }
    if (now.state !== 'working') return
    const n = now.n
    if (!now.ending) {
      await pause(life)
      Run.end(store, n, report())
      if (random.chance(0.4)) {
        await pause(life)
        Run.end(store, n, report())
      }
      return
    }
    for (const effect of Run.effects) {
      if (awaited.has(effect))
        await Run.step(store, n, effect, async () => {
          touch(n, effect)
          await pause(life)
        })
      else Run.once(store, n, effect, () => touch(n, effect))
      if (random.chance(0.3)) await pause(life)
    }
    await pause(life)
    Run.close(store, n, make(random.chance(0.8) ? 'waiting' : 'paused', 0))
  }
  const lives = new Set<Life>()
  let ids = 0
  const spawn = () => {
    const life = { alive: true, id: ++ids }
    lives.add(life)
    const store = Run.kv(storage(life))
    void (async () => {
      for (let op = 0; op < limits.run.opsPerLife && life.alive; op++) {
        try {
          await act(life, store)
        } catch (error) {
          if (!(error instanceof Run.Refused)) fail('unexpected', String((error as Error)?.stack ?? error).slice(0, 300))
        }
        await pause(life)
      }
      lives.delete(life)
    })()
  }
  let steps = 0
  for (; steps < limits.run.steps; steps++) {
    while (lives.size < limits.run.lives) spawn()
    await tick()
    if (!pending.length) continue
    const [entry] = pending.splice(random.int(0, pending.length - 1), 1)
    if (!entry) continue
    if (random.chance(0.02)) {
      entry.life.alive = false
      lives.delete(entry.life)
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i]?.life === entry.life) pending.splice(i, 1)
    } else entry.resolve()
  }
  return { steps, violations }
}

type Holder = {
  active: boolean
  claim: string | null
  expiredAt: number | null
  held: Work.Held | null
  id: number
  jumpBase: number
  late: boolean
  refusedAt: number | null
  until: number
  waitStart: number | null
}

async function lease(seed: string): Promise<Outcome> {
  const random = rng(seed, 'lease')
  const { fail, violations } = recorder()
  const L = limits.lease
  const tickMs = Math.max(1, Math.floor(L.leaseMs / 3))
  const clock = new Clock(start)
  const restore = install(clock, rng(seed, 'lease', 'global'))
  try {
    const end = clock.now + L.virtualMs
    const slot = { claim: null as string | null, seq: 0, until: 0 }
    const known = new Set<string>()
    const refused = new Set<string>()
    let jumped = 0
    const later = <T>(apply: () => T, fault: 'after' | 'before' | null = null, deliver?: (value: T) => void) =>
      new Promise<T>((resolve, reject) => {
        clock.add(
          () => {
            if (fault === 'before') {
              clock.add(() => reject(new Error('transport')), random.int(0, L.latencyMs))
              return
            }
            const value = apply()
            clock.add(
              () => {
                if (fault === 'after') return reject(new Error('transport'))
                deliver?.(value)
                resolve(value)
              },
              random.int(0, L.latencyMs),
            )
          },
          random.int(0, L.latencyMs),
        )
      })
    const verdict = (): Work.Verdict => ({
      change: null,
      event: 'e',
      found: true,
      ok: true,
      seq: slot.seq,
    })
    const refusal = (kind: 'Held' | 'NotHolder' | 'Stale') => ({
      ok: false as const,
      rejection: { kind },
    })
    const boardFor = (h: Holder) =>
      ({
        actor: 'sim',
        claim: (_id: string, options: { leaseMs: number }) =>
          later(
            (): Work.Claimed => {
              const now = clock.now
              if (slot.claim && now < slot.until) return refusal('Held')
              slot.seq += 1
              slot.claim = 'c' + slot.seq
              slot.until = now + options.leaseMs
              return {
                claim: slot.claim,
                ok: true,
                seq: slot.seq,
                tookOver: false,
                untilMs: slot.until,
              }
            },
            null,
            (value) => {
              if (!value.ok) return
              h.claim = value.claim
              h.until = value.untilMs
            },
          ),
        post: (task: Work.NewTask) =>
          later(() => {
            known.add(task.id)
            return verdict()
          }),
        release: (_id: string, claim: string) =>
          later((): Work.Verdict => {
            if (refused.has(claim)) fail('lost release', 'holder ' + h.id + ' released claim ' + claim + ' after its renew was refused')
            if (slot.claim !== claim) return refusal('NotHolder')
            slot.claim = null
            return verdict()
          }),
        renew: (_id: string, claim: string, leaseMs: number) => {
          const fault = random.chance(0.08) ? random.pick(['after', 'before'] as const) : null
          const spurious = random.chance(0.04)
          return later(
            (): Work.Verdict => {
              const now = clock.now
              if (spurious) return refusal('Stale')
              if (slot.claim !== claim || now >= slot.until) return refusal('NotHolder')
              slot.until = now + leaseMs
              return {
                change: { Renewed: { until_ms: slot.until } },
                event: 'renewed',
                found: true,
                ok: true,
                seq: slot.seq,
              }
            },
            fault,
            (value) => {
              if (h.claim !== claim) return
              if (value.ok) h.until = Math.max(h.until, Work.until(value) ?? 0)
              else if (h.active) {
                h.refusedAt = clock.now
                refused.add(claim)
              }
            },
          )
        },
        scope: 'sim',
        task: (id: string) => later(() => (known.has(id) ? ({ id } as Work.Task) : null)),
      }) as never as Work.Board
    const holders: Holder[] = Array.from({ length: L.holders }, (_, id) => ({
      active: false,
      claim: null,
      expiredAt: null,
      held: null,
      id,
      jumpBase: 0,
      late: false,
      refusedAt: null,
      until: 0,
      waitStart: null,
    }))
    const bound = (h: Holder) => (h.waitStart ?? 0) + L.deadlineMs + L.waitMs + (jumped - h.jumpBase)
    const ended = (h: Holder) => {
      if (h.waitStart === null) return
      if (!h.late && clock.now > bound(h)) fail('deadline', 'holder ' + h.id + ' waited ' + (clock.now - h.waitStart) + ' ms')
      h.waitStart = null
    }
    const check = () => {
      const now = clock.now
      const writers = holders.filter((h) => h.active && h.held?.writable())
      if (writers.length > 1) fail('one writer', 'holders ' + writers.map((h) => h.id).join(',') + ' writable at ' + (now - start))
      for (const h of writers)
        if (h.claim !== slot.claim || now >= slot.until) fail('one writer', 'holder ' + h.id + ' writable without the board lease at ' + (now - start))
      for (const h of holders) {
        if (h.active && h.held) {
          if (now < h.until) h.expiredAt = null
          else h.expiredAt ??= now
          if (h.expiredAt !== null && now >= h.expiredAt + tickMs + 1 && !h.held.signal.aborted) {
            fail('lost aborts', 'holder ' + h.id + ' lease ran out at ' + (h.until - start) + ' and its work still runs at ' + (now - start))
            h.expiredAt = Number.POSITIVE_INFINITY
          }
          if (h.refusedAt !== null) {
            if (h.held.writable() || !h.held.signal.aborted)
              fail('lost aborts', 'holder ' + h.id + ' renew refused at ' + (h.refusedAt - start) + ' but still writable or not aborted')
            h.refusedAt = null
          }
        }
        if (h.waitStart !== null && !h.late && now > bound(h)) {
          fail('deadline', 'holder ' + h.id + ' still waiting ' + (now - h.waitStart) + ' ms for the lock')
          h.late = true
        }
      }
    }
    const live = async (h: Holder) => {
      const board = boardFor(h)
      while (clock.now < end) {
        await sleep(clock, random.int(0, 150))
        const direct = random.chance(0.3)
        if (!direct) {
          h.waitStart = clock.now
          h.jumpBase = jumped
          h.late = false
        }
        const work = async (held: Work.Held) => {
          ended(h)
          h.held = held
          h.active = true
          h.expiredAt = null
          h.refusedAt = null
          const stop = clock.now + random.int(10, L.workMaxMs)
          while (clock.now < stop && !held.signal.aborted) {
            await sleep(clock, random.int(5, 60))
            held.writable()
          }
          h.active = false
          return h.id
        }
        try {
          if (direct) await Work.holding(board, 'lock', L.leaseMs, work)
          else await Work.serial(board, 'lock', L.leaseMs, work, L.waitMs, L.deadlineMs as typeof Work.serialWaitMs)
        } catch (error) {
          if (error instanceof Work.Busy) ended(h)
          else if (!(error instanceof Work.Lost)) fail('unexpected', String((error as Error)?.stack ?? error).slice(0, 300))
        }
        h.active = false
        h.waitStart = null
      }
    }
    const jump = () => {
      if (clock.now >= end) return
      const by = random.int(50, L.jumpMaxMs)
      clock.now += by
      jumped += by
      clock.add(jump, random.int(1000, 3000))
    }
    clock.add(jump, random.int(1000, 3000))
    for (const h of holders) void live(h)
    const steps = await advance(clock, end, L.steps, check)
    return { steps, violations }
  } finally {
    restore()
  }
}

async function cursor(seed: string): Promise<Outcome> {
  const random = rng(seed, 'cursor')
  const { fail, violations } = recorder()
  const C = limits.cursor
  const events: { seq: number }[] = []
  for (let seq = 0, i = 0; i < C.events; i++) events.push({ seq: (seq += random.int(1, C.maxGap)) })
  const last = events[events.length - 1]?.seq ?? 0
  const saved = { cursor: 0 }
  let memory = 0
  const seen: number[] = [0]
  const applied = new Map<number, number>()
  let top = 0
  let steps = 0
  for (; steps < C.steps && saved.cursor < last; steps++) {
    if (random.chance(0.05)) memory = saved.cursor
    const from = random.chance(0.2) ? random.pick(seen) : memory
    const page: { seq: number }[] = []
    for (const event of events.filter((e) => e.seq > from).slice(0, random.int(1, C.page))) {
      page.push(event)
      if (random.chance(0.1)) page.push(event)
    }
    if (random.chance(0.05)) continue
    const folded = Cursor.fresh(page, saved.cursor)
    for (const event of folded.events) {
      const count = (applied.get(event.seq) ?? 0) + 1
      applied.set(event.seq, count)
      if (count > 1) fail('seq once', 'seq ' + event.seq + ' applied ' + count + ' times')
      if (event.seq <= top) fail('seq order', 'seq ' + event.seq + ' applied after ' + top)
      top = Math.max(top, event.seq)
    }
    saved.cursor = folded.cursor
    memory = folded.cursor
    seen.push(folded.cursor)
  }
  for (const event of events)
    if (event.seq <= saved.cursor && applied.get(event.seq) !== 1) fail('seq once', 'seq ' + event.seq + ' applied ' + (applied.get(event.seq) ?? 0) + ' times')
  if (saved.cursor < last) fail('seq once', 'cursor stopped at ' + saved.cursor + ' of ' + last)
  return { steps, violations }
}

type Logical = {
  attempts: number
  contributor: string
  covered: boolean
  effects: number
  key: string
  kind: Payment.Kind
  paid: boolean
  refused: boolean
  rows: Set<string>
  scope: string
  told: number
}

async function payment(seed: string): Promise<Outcome> {
  const random = rng(seed, 'payment')
  const { fail, violations } = recorder()
  const P = limits.payment
  const clock = new Clock(start)
  const restore = install(clock, rng(seed, 'payment', 'global'))
  try {
    const kv = new Map<string, unknown>()
    const ledger = new Map<string, string>()
    const owner = new Map<string, Logical>()
    let ids = 0
    const view = (life: Life): Payment.Kv => ({
      delete: (key: string) => {
        if (life.alive) kv.delete(key)
      },
      get: <T>(key: string) => kv.get(key) as T | undefined,
      put: (key: string, value: unknown) => {
        if (life.alive) kv.set(key, structuredClone(value))
      },
    })
    const latency = (slow: boolean) => (slow ? random.int(Payment.limits.payingMs, 2 * Payment.limits.payingMs) : random.int(1, 500))
    const io = (life: Life, p: Logical, pid: string, faulty: boolean): Payment.Io => ({
      write: () =>
        new Promise<boolean>((resolve, reject) => {
          const fault = faulty && random.chance(0.25) ? random.pick(['after', 'before', 'crash', 'slow'] as const) : null
          clock.add(
            () => {
              if (fault === 'before') {
                if (life.alive) reject(new Error('transport'))
                return
              }
              const landed = p.covered && !ledger.has(pid)
              if (landed) {
                ledger.set(pid, p.key)
                p.rows.add(pid)
                if (p.rows.size > 1) fail('ledger once', p.key + ' landed as ' + [...p.rows].join(', '))
              }
              if (fault === 'crash') life.alive = false
              if (!life.alive) return
              if (fault === 'after') reject(new Error('transport'))
              else resolve(landed)
            },
            latency(fault === 'slow'),
          )
        }),
      written: () =>
        new Promise<boolean>((resolve) => {
          const fault = faulty && random.chance(0.15) ? random.pick(['crash', 'slow'] as const) : null
          clock.add(
            () => {
              if (fault === 'crash') life.alive = false
              if (life.alive) resolve(ledger.has(pid))
            },
            latency(fault === 'slow'),
          )
        }),
    })
    const tell = (life: Life, p: Logical) =>
      Payment.once(view(life), 'told:' + p.key, () => {
        p.told += 1
        if (p.told > 1) fail('told once', p.key + ' told ' + p.told + ' times')
      })
    const attempt = async (p: Logical, faulty: boolean, known?: string) => {
      if (faulty && ++p.attempts > P.attempts) return
      const life = { alive: true, id: ++ids }
      const pid = known ?? Payment.id(p.kind, p.scope, p.contributor, p.key)
      owner.set(pid, p)
      const effects = () => {
        p.effects += 1
        if (p.effects > 1) fail('effects once', p.key + ' ran its effects ' + p.effects + ' times')
        if (!p.rows.size) fail('refused no effects', p.key + ' ran effects with no ledger row')
      }
      try {
        const done = await Payment.settle(view(life), pid, io(life, p, pid, faulty), effects, clock.now)
        if (done.at === 'paid') {
          p.paid = true
          tell(life, p)
          if (faulty && random.chance(0.2)) tell(life, p)
          if (faulty && random.chance(0.3)) clock.add(() => void attempt(p, faulty), random.int(1, 5000))
        } else {
          p.refused = true
          if (p.effects) fail('refused no effects', p.key + ' refused after its effects ran')
        }
      } catch (error) {
        if (!(error instanceof Payment.Busy) && (error as Error)?.message !== 'transport')
          fail('unexpected', String((error as Error)?.stack ?? error).slice(0, 300))
        if (life.alive) clock.add(() => void attempt(p, faulty), random.int(100, 5000))
      }
    }
    const payments: Logical[] = Array.from({ length: P.logical }, (_, i) => ({
      attempts: 0,
      contributor: '0x' + String(i % 4).repeat(40),
      covered: random.chance(0.85),
      effects: 0,
      key: 'k' + i,
      kind: random.pick(['fund', 'move', 'pledge', 'steer'] as const),
      paid: false,
      refused: false,
      rows: new Set<string>(),
      scope: 's' + (i % 3),
      told: 0,
    }))
    for (const p of payments) {
      const at = random.int(0, P.spreadMs)
      clock.add(() => void attempt(p, true), at)
      if (random.chance(0.3)) clock.add(() => void attempt(p, true), at + random.int(0, 50))
    }
    const quiet = () => undefined
    let steps = await advance(clock, Number.POSITIVE_INFINITY, P.steps, quiet)
    for (let round = 0; round < P.rounds; round++) {
      const open = [...kv.keys()].filter((key) => key.startsWith('pay:')).map((key) => key.slice(4))
      const left = payments.filter((p) => !p.paid && !p.refused)
      if (!open.length && !left.length) break
      for (const pid of open) {
        const p = owner.get(pid)
        if (p) void attempt(p, false, pid)
      }
      for (const p of left) void attempt(p, false)
      steps += await advance(clock, Number.POSITIVE_INFINITY, P.steps, quiet)
    }
    for (const p of payments) {
      if (p.rows.size && p.effects !== 1) fail('effects once', p.key + ' landed and ran its effects ' + p.effects + ' times')
      if (!p.rows.size && p.effects) fail('refused no effects', p.key + ' never landed but ran its effects')
      if (!p.covered && p.rows.size) fail('refused no effects', p.key + ' was not covered but landed')
      if (!p.paid && !p.refused) fail('settled', p.key + ' never settled')
    }
    for (const key of kv.keys()) if (key.startsWith('pay:')) fail('slot closed', key + ' left open')
    return { steps, violations }
  } finally {
    restore()
  }
}

const legalHand = new Set([
  '-:issued',
  'issued:minted',
  'issued:revoking',
  'issued:returned',
  'minted:revoking',
  'revoking:revoking',
  'revoking:minted',
  'revoking:returned',
])

async function hand(seed: string): Promise<Outcome> {
  const random = rng(seed, 'hand')
  const { fail, violations } = recorder()
  const H = limits.hand
  const states = new Map<number, Hand.Hand>()
  const history = new Map<number, Hand.HandEvent[]>()
  const fresh = (at: number): Hand.HandEvent => {
    const kind = random.pick(['issue', 'mint', 'kept', 'return', 'revoke'] as const)
    if (kind === 'issue') return { at, kind, life: 'l' + random.int(0, 3) }
    if (kind === 'revoke')
      return {
        at,
        by: random.pick(['evicted', 'failed', 'owner'] as const),
        kind,
        life: 'l' + random.int(0, 3),
      }
    return { at, kind }
  }
  const deliver = (h: number, event: Hand.HandEvent, replay: boolean) => {
    const at = states.get(h)
    const stepped = Hand.machine.step(at, event)
    if (!stepped.ok) return
    const pair = (at?.state ?? '-') + ':' + stepped.state.state
    if (!legalHand.has(pair)) fail('legal pair', 'hand ' + h + ' ' + pair + ' on ' + event.kind)
    if (replay && JSON.stringify(stepped.state) !== JSON.stringify(at))
      fail('replay', 'hand ' + h + ' replayed ' + event.kind + ' moved ' + (at?.state ?? '-') + ' -> ' + stepped.state.state)
    states.set(h, stepped.state)
    if (!replay) history.set(h, [...(history.get(h) ?? []), event])
  }
  let steps = 0
  for (; steps < H.steps; steps++) {
    const h = random.int(0, H.hands - 1)
    const past = history.get(h) ?? []
    const event = past.length && random.chance(0.3) ? random.pick(past) : fresh(steps)
    deliver(h, event, false)
    if (random.chance(0.3)) deliver(h, event, true)
  }
  return { steps, violations }
}

const foldRank: Record<Tree.FoldState, number> = {
  checking: 2,
  quieted: 4,
  splitting: 3,
  told: 1,
}

const foldReach = {
  check: 'checking',
  quiet: 'quieted',
  split: 'splitting',
  tell: 'told',
} as const

async function fold(seed: string): Promise<Outcome> {
  const random = rng(seed, 'fold')
  const { fail, violations } = recorder()
  const F = limits.fold
  const map = new Map<string, unknown>()
  const kv: Tree.Kv = {
    delete: (key: string) => map.delete(key),
    get: <T>(key: string) => (map.has(key) ? structuredClone(map.get(key)) : undefined) as T | undefined,
    put: (key: string, value: unknown) => {
      map.set(key, structuredClone(value))
    },
  }
  const effects = new Map<string, number>()
  const history = new Map<string, Tree.FoldEvent[]>()
  const deliver = (key: string, event: Tree.FoldEvent) => {
    const was = Tree.foldMachine.read(kv.get(key))
    const applied = Tree.apply(kv, key, event, (next) => {
      const slot = key + ':' + next.state
      const count = (effects.get(slot) ?? 0) + 1
      effects.set(slot, count)
      if (count > 1) fail('effect once', slot + ' applied ' + count + ' times')
    })
    const now = Tree.foldMachine.read(kv.get(key))
    if (was && now && foldRank[now.state] < foldRank[was.state]) fail('rank', key + ' fell ' + was.state + ' -> ' + now.state)
    const replay = was !== undefined && foldRank[was.state] >= foldRank[foldReach[event.kind]]
    if (replay && (applied || JSON.stringify(was) !== JSON.stringify(now))) fail('replay', key + ' ' + event.kind + ' on ' + was.state + ' changed the fold')
    if (applied) history.set(key, [...(history.get(key) ?? []), event])
  }
  let steps = 0
  for (; steps < F.steps; steps++) {
    const key = Tree.foldKey('r' + random.int(0, F.runs - 1))
    const past = history.get(key) ?? []
    const kind = random.pick(['check', 'quiet', 'split', 'tell', 'tell'] as const)
    const event: Tree.FoldEvent = past.length && random.chance(0.3) ? random.pick(past) : kind === 'split' ? { fresh: ['n' + steps], kind } : { kind }
    deliver(key, event)
    if (random.chance(0.3)) deliver(key, event)
  }
  return { steps, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  cursor,
  fold,
  hand,
  lease,
  payment,
  run,
}

function flag<T extends Record<string, boolean>>(guards: T, key: keyof T) {
  return () => {
    guards[key] = false as T[keyof T]
    return () => {
      guards[key] = true as T[keyof T]
    }
  }
}

function terminalLost() {
  const step = Hand.machine.step
  Hand.machine.step = (at, event) => step(at?.state === 'returned' ? { ...at, state: 'issued' } : at, event)
  return () => {
    Hand.machine.step = step
  }
}

function replayed() {
  const step = Tree.foldMachine.step
  Tree.foldMachine.step = (at, event) => step(at && event.kind !== 'tell' ? { ...at, state: 'told' } : at, event)
  return () => {
    Tree.foldMachine.step = step
  }
}

export const canaries: {
  flip: () => () => void
  invariant: string
  name: string
  scenario: string
  seeds: string[]
}[] = [
  {
    flip: flag(Run.guards, 'fence'),
    invariant: 'stale write',
    name: 'run.fence',
    scenario: 'run',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Run.guards, 'legal'),
    invariant: 'legal',
    name: 'run.legal',
    scenario: 'run',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Run.guards, 'once'),
    invariant: 'effect once',
    name: 'run.once',
    scenario: 'run',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Run.guards, 'resume'),
    invariant: 'first report',
    name: 'run.resume',
    scenario: 'run',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Lease.guards, 'expiry'),
    invariant: 'lost aborts',
    name: 'lease.expiry',
    scenario: 'lease',
    seeds: ['1', '13', '15'],
  },
  {
    flip: flag(Lease.guards, 'lost'),
    invariant: 'lost aborts',
    name: 'lease.lost',
    scenario: 'lease',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Work.guards, 'deadline'),
    invariant: 'deadline',
    name: 'work.deadline',
    scenario: 'lease',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Cursor.guards, 'seq'),
    invariant: 'seq once',
    name: 'cursor.seq',
    scenario: 'cursor',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Payment.guards, 'closed'),
    invariant: 'effects once',
    name: 'payment.closed',
    scenario: 'payment',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Payment.guards, 'keyed'),
    invariant: 'ledger once',
    name: 'payment.keyed',
    scenario: 'payment',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flag(Payment.guards, 'told'),
    invariant: 'told once',
    name: 'payment.told',
    scenario: 'payment',
    seeds: ['1', '2', '3'],
  },
  {
    flip: terminalLost,
    invariant: 'legal pair',
    name: 'hand.terminal',
    scenario: 'hand',
    seeds: ['1', '2', '3'],
  },
  {
    flip: replayed,
    invariant: 'replay',
    name: 'fold.replay',
    scenario: 'fold',
    seeds: ['1', '2', '3'],
  },
]
