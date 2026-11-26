import './hook.ts'
import { createHash } from 'node:crypto'
import { fence, raw } from './host.ts'
import type * as SwarmModule from '../../src/worker/Swarm.ts'
import type * as StoreModule from '../../src/worker/Store.ts'
import type * as NodesModule from '../../src/worker/Nodes.ts'
import type * as RunnerModule from '../../src/worker/Runner.ts'
import type * as FlowModule from '../../src/worker/Flow.ts'
import type * as RunModule from '../run.ts'
import type * as D1Module from '../d1.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as CreditModule from '../../src/shared/Credit.ts'
import type * as TreeModule from '../../src/worker/machines/Tree.ts'
import type * as SubModule from '../../src/worker/machines/Sub.ts'
import type * as HandModule from '../../src/worker/machines/Hand.ts'
import type * as RunModule2 from '../../src/worker/machines/Run.ts'
import type * as MemoModule from '../../src/shared/Memo.ts'
import { readFileSync } from 'node:fs'

const { Swarm }: typeof SwarmModule = await import('../../src/worker/Swarm.ts')
const Store: typeof StoreModule = await import('../../src/worker/Store.ts')
const Nodes: typeof NodesModule = await import('../../src/worker/Nodes.ts')
const Runner: typeof RunnerModule = await import('../../src/worker/Runner.ts')
const Flow: typeof FlowModule = await import('../../src/worker/Flow.ts')
const { storage }: typeof RunModule = await import('../run.ts')
const { open }: typeof D1Module = await import('../d1.ts')
const Memo: typeof MemoModule = await import('../../src/shared/Memo.ts')
const Operations: typeof OperationsModule = await import('../../src/worker/Operations.ts')
const Credit: typeof CreditModule = await import('../../src/shared/Credit.ts')
const Tree: typeof TreeModule = await import('../../src/worker/machines/Tree.ts')
const SubMachine: typeof SubModule = await import('../../src/worker/machines/Sub.ts')
const HandMachine: typeof HandModule = await import('../../src/worker/machines/Hand.ts')
const Run: typeof RunModule2 = await import('../../src/worker/machines/Run.ts')
const older = JSON.parse(readFileSync(new URL('../rpc-older.json', import.meta.url), 'utf8')) as { methods: string[] }

export const faultNames = ['evict', 'crash', 'dup', 'reorder', 'stale', 'staleList', 'retry', 'move', 'refuse', 'partition', 'lag', 'skew', 'stranded', 'chainLag'] as const

export type Fault = (typeof faultNames)[number]

export const rates: Record<Fault, number> = { chainLag: 0.3, crash: 0.004, dup: 0.2, evict: 0.04, lag: 0.1, move: 0.3, partition: 0.03, refuse: 0.05, reorder: 0.2, retry: 0.3, skew: 0.3, stale: 0.1, staleList: 0.05, stranded: 0.15 }

export const limits = { attempts: 120, chainLagMs: 60_000, partitionMostMs: 5 * 60_000, partitionLeastMs: 20_000, retryMostMs: 10_000, retryLeastMs: 500 }

export type Options = { activeMs: number; children: number; deadlineMs: number; faults: readonly Fault[]; offset: number; pledges: number; seed: string; swarms: number; tailMs: number }

export const defaults: Options = { activeMs: 45 * 60_000, children: 6, deadlineMs: 15 * 60_000, faults: faultNames, offset: 0, pledges: 6, seed: '1', swarms: 4, tailMs: 4 * 60 * 60_000 }

export type Invariant =
  | 'duplicate fold'
  | 'lost result'
  | 'ledger drift'
  | 'negative balance'
  | 'missed deadline'
  | 'stuck without wake'
  | 'unfinished at end'
  | 'lost pledge'
  | 'leaked subagent'
  | 'overspent'
  | 'unexpected error'
  | 'illegal transition'
  | 'unversioned record'
  | 'charged past deposit'
  | 'duplicate payment'
  | 'stranded counted'

export type Violation = { detail: string; invariant: Invariant; swarm: number }

export type Report = {
  counts: { children: number; evictions: number; folds: number; gatewayCalls: number; moves: number; pledges: number; redeliveries: number; steps: number; subagents: number }
  ledger: { contributed: string; drift: string; held: string; spentGateway: string; spentLedger: string }
  options: Options
  slowestFoldMs: number
  trace: string
  violations: Violation[]
  virtualMs: number
  wallMs: number
}

class Evicted extends Error {
  constructor() {
    super('evicted')
  }
}

export type Rng = { chance: (p: number) => boolean; int: (lo: number, hi: number) => number; next: () => number; pick: <T>(items: readonly T[]) => T }

export function rng(...parts: (number | string)[]): Rng {
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

type Timer = { at: number; fn: () => void; handle: Handle; live: boolean; seq: number }

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
    const timer = { at: this.now + Math.max(0, Number(ms) || 0), fn, live: true, seq: ++this.seq } as Timer
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

function before(a: Timer, b: Timer) {
  return a.at < b.at || (a.at === b.at && a.seq < b.seq)
}

const real = {
  clearInterval: globalThis.clearInterval,
  clearTimeout: globalThis.clearTimeout,
  Date: globalThis.Date,
  digest: crypto.subtle.digest.bind(crypto.subtle),
  error: console.error,
  random: Math.random,
  setImmediate: globalThis.setImmediate,
  setInterval: globalThis.setInterval,
  setTimeout: globalThis.setTimeout,
  uuid: crypto.randomUUID.bind(crypto),
  values: crypto.getRandomValues.bind(crypto),
  warn: console.warn,
}

const start = Date.UTC(2027, 0, 4, 9)

type Sub = {
  agent: string
  blocked: number | null
  budget: bigint
  completed: number | null
  ends: number
  error: string | null
  id: number
  key: string | null
  output: Record<string, unknown> | null
  role: string
  spent: bigint
  state: string
  summary: string
  task: string
}

type Stream = { agent: string; controller: ReadableStreamDefaultController<Uint8Array>; inc: Incarnation }

type Incarnation = { alive: boolean; die: () => void; died: Promise<void>; env: Cloudflare.Env; gen: number; previous: boolean; swarm: InstanceType<typeof Swarm> }

type Pledge = { acked: number | null; amount: bigint; contributor: string; hash: string; nid: string | null; stranded: boolean; to: string | null }

type Transfer = { amount: bigint; from: string; hash: string; lands: number; stranded: boolean; tag: string }

type Sim = {
  calls: number
  clock: Clock
  db: ReturnType<typeof open>
  errors: string[]
  faulty: boolean
  options: Options
  rate: Record<Fault, number>
  steps: number
  swarms: SimSwarm[]
  trace: ReturnType<typeof createHash>
}

type SimSwarm = {
  agentCount: number
  agents: Set<string>
  alarmToken: number
  charged: bigint
  credited: Set<string>
  deposited: bigint
  moveKeys: Set<string>
  partitioned: number
  transfers: Map<string, Transfer>
  worker: Cloudflare.Env
  wrong: { detail: string; invariant: Invariant }[]
  alarming: Incarnation | null
  children: number
  evictions: { at: number; why: string }[]
  frames: Map<string, string[]>
  history: Map<string, string[]>
  id: string
  inc: Incarnation
  index: number
  keyed: Map<string, Sub>
  moves: number
  overspent: string | null
  pledges: Pledge[]
  random: { drive: Rng; faults: Rng; gateway: Rng }
  redeliveries: number
  store: ReturnType<typeof storage>
  streams: Set<Stream>
  subs: Sub[]
}

const riders = ['0x' + '1'.repeat(40), '0x' + '2'.repeat(40), '0x' + '3'.repeat(40), '0x' + '4'.repeat(40)]

const encoder = new TextEncoder()

const hang = () => Promise.reject<never>(new Evicted())

function usd(micro: bigint) {
  return Number(micro) / 1_000_000
}

function micro(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? BigInt(Math.round(value * 1_000_000)) : 0n
}

export function decimal(micro: bigint) {
  const sign = micro < 0n ? '-' : ''
  const abs = micro < 0n ? -micro : micro
  return sign + (abs / 1_000_000n).toString() + '.' + (abs % 1_000_000n).toString().padStart(6, '0')
}

function install(sim: Sim) {
  const clock = sim.clock
  const global = rng(sim.options.seed, 'global')
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
    const handle = new Handle({ at: 0, fn: () => undefined, handle: undefined as never, live: true, seq: -1 })
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
  Math.random = () => global.next()
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(global.next() * 16).toString(16)).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}` as `${string}-${string}-${string}-${string}-${string}`
  }
  crypto.getRandomValues = (<T extends ArrayBufferView>(array: T) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(global.next() * 256)
    return array
  }) as typeof crypto.getRandomValues
  crypto.subtle.digest = (async (algorithm: string | { name: string }, data: BufferSource) => {
    const name = typeof algorithm === 'string' ? algorithm : algorithm.name
    if (name.toUpperCase() !== 'SHA-256') return real.digest(algorithm, data)
    const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    const out = createHash('sha256').update(view).digest()
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
  }) as typeof crypto.subtle.digest
  const noted = (args: unknown[]) => {
    const text = args.map((arg) => (arg instanceof Error ? arg.message : String(arg))).join(' ')
    if (!/evicted|Network connection lost|Durable Object reset/.test(text)) sim.errors.push(text.slice(0, 300))
  }
  console.error = (...args: unknown[]) => noted(args)
  console.warn = () => undefined
  const rejected = (reason: unknown) => {
    if (reason instanceof Evicted) return
    sim.errors.push('unhandled: ' + String((reason as Error)?.stack ?? reason).slice(0, 300))
  }
  process.on('unhandledRejection', rejected)
  return () => {
    g['setTimeout'] = real.setTimeout
    g['clearTimeout'] = real.clearTimeout
    g['setInterval'] = real.setInterval
    g['clearInterval'] = real.clearInterval
    g['Date'] = real.Date
    Math.random = real.random
    crypto.randomUUID = real.uuid
    crypto.getRandomValues = real.values as typeof crypto.getRandomValues
    crypto.subtle.digest = real.digest as typeof crypto.subtle.digest
    console.error = real.error
    console.warn = real.warn
    process.off('unhandledRejection', rejected)
  }
}

async function drain(clock: Clock) {
  for (let idle = 0; idle < 2; ) {
    const before = clock.activity
    await new Promise((resolve) => real.setImmediate(resolve))
    idle = clock.activity === before ? idle + 1 : 0
  }
}

async function runUntil(sim: Sim, end: number) {
  const clock = sim.clock
  for (;;) {
    await drain(clock)
    sim.db.log.length = 0
    const next = clock.peek()
    if (!next || next.at > end) break
    clock.pop()
    next.live = false
    clock.now = Math.max(clock.now, next.at)
    clock.activity += 1
    try {
      next.fn()
    } catch (error) {
      if (!(error instanceof Evicted)) sim.errors.push('timer: ' + String((error as Error)?.stack ?? error).slice(0, 300))
    }
  }
  clock.now = Math.max(clock.now, end)
}

function sleep(sim: Sim, ms: number) {
  return new Promise<void>((resolve) => sim.clock.add(resolve, ms))
}

function weight(label: string) {
  return label.startsWith('gateway') || label.startsWith('d1') ? 1 : 0.5
}

function crashing(sim: Sim, sw: SimSwarm, label: string) {
  if (!sim.faulty || !sim.options.faults.includes('crash')) return false
  return sw.random.faults.chance(sim.rate.crash * weight(label))
}

async function guard<T>(sim: Sim, sw: SimSwarm, inc: Incarnation, label: string, work: () => Promise<T> | T): Promise<T> {
  sim.clock.activity += 1
  if (!inc.alive) return hang()
  await null
  if (!inc.alive) return hang()
  if (crashing(sim, sw, label)) {
    evict(sim, sw, 'before ' + label)
    return hang()
  }
  let value: T
  try {
    value = await work()
  } catch (error) {
    if (!inc.alive) return hang()
    throw error
  }
  if (!inc.alive) return hang()
  if (crashing(sim, sw, label)) {
    evict(sim, sw, 'after ' + label)
    return hang()
  }
  return value
}

function evict(sim: Sim, sw: SimSwarm, why: string) {
  const inc = sw.inc
  if (!inc.alive) return
  inc.alive = false
  inc.die()
  sw.evictions.push({ at: sim.clock.now, why })
  sim.trace.update(`${sim.clock.now} ${sw.index} evict ${why}\n`)
  for (const stream of [...sw.streams])
    if (stream.inc === inc) {
      sw.streams.delete(stream)
      try {
        stream.controller.error(new Error('evicted'))
      } catch {}
    }
  try {
    void Runner.stop(inc.swarm).catch(() => undefined)
  } catch {}
  if (sw.alarming === inc) sw.alarming = null
  sim.clock.add(() => restart(sim, sw), sw.random.faults.int(0, 5_000))
}

function restart(sim: Sim, sw: SimSwarm) {
  const previous = sim.faulty && sim.options.faults.includes('skew') && sw.random.faults.chance(sim.rate.skew)
  sw.inc = incarnation(sim, sw, sw.inc.gen + 1, previous)
  const at = sw.store.alarm()
  if (at !== null) arm(sim, sw, at)
}

function arm(sim: Sim, sw: SimSwarm, at: number) {
  const token = ++sw.alarmToken
  sim.clock.add(() => void fire(sim, sw, token), Math.max(0, at - sim.clock.now))
}

async function fire(sim: Sim, sw: SimSwarm, token: number, tries = 0) {
  if (token !== sw.alarmToken) return
  const at = sw.store.alarm()
  if (at === null || at > sim.clock.now) return
  const inc = sw.inc
  if (!inc.alive) return
  if (sw.alarming) {
    sim.clock.add(() => void fire(sim, sw, token, tries), 1_000)
    return
  }
  sw.alarming = inc
  const finished = await Promise.race([
    inc.swarm.alarm().then(
      () => 'ok' as const,
      (error: unknown) => {
        if (!(error instanceof Evicted)) sim.errors.push('alarm: ' + String((error as Error)?.message ?? error).slice(0, 300))
        return 'threw' as const
      },
    ),
    inc.died.then(() => 'died' as const),
  ])
  if (finished === 'died') return
  sw.alarming = null
  if (finished === 'ok') {
    if (sw.store.alarm() === at && token === sw.alarmToken) sw.store.rung()
    return
  }
  if (tries < 6) {
    const retry = ++sw.alarmToken
    sim.clock.add(() => void fire(sim, sw, retry, tries + 1), 1_000 * 2 ** tries)
  }
}

const statement = Symbol('statement')

function fencedDb(sim: Sim, sw: SimSwarm, inc: Incarnation, db: D1Database): D1Database {
  const wrap = (inner: D1PreparedStatement): D1PreparedStatement =>
    ({
      [statement]: inner,
      all: () => guard(sim, sw, inc, 'd1', () => inner.all()),
      bind: (...values: unknown[]) => wrap(inner.bind(...values)),
      first: (column?: string) => guard(sim, sw, inc, 'd1', () => (column === undefined ? inner.first() : inner.first(column))),
      raw: () => guard(sim, sw, inc, 'd1', () => inner.raw()),
      run: () => guard(sim, sw, inc, 'd1', () => inner.run()),
    }) as unknown as D1PreparedStatement
  const fenced = {
    batch: (statements: D1PreparedStatement[]) => guard(sim, sw, inc, 'd1', () => db.batch(statements.map((one) => (one as unknown as Record<symbol, D1PreparedStatement>)[statement] ?? one))),
    prepare: (query: string) => wrap(db.prepare(query)),
    withSession: () => fenced,
  }
  return fenced as unknown as D1Database
}

function fencedBoard<T extends object>(sim: Sim, sw: SimSwarm, inc: Incarnation, board: T): T {
  return new Proxy(board, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => guard(sim, sw, inc, 'board.' + String(prop), () => (value as (...args: unknown[]) => unknown).apply(target, args))
    },
  })
}

const foldRank: Record<string, number> = { checking: 2, quieted: 4, splitting: 3, told: 1 }

const settledMarks = ['folded:', 'paid:pledge:', 'paid:move:', 'paid:steer:', 'told:']

const versioned = ['ran:', 'seen:', 'lent:', 'pay:', 'paid:pledge:', 'paid:move:', 'paid:steer:', 'told:']

const watched = [...new Set([...settledMarks, ...versioned, 'run'])]

function wrong(sim: Sim, sw: SimSwarm, invariant: Invariant, detail: string) {
  if (sw.wrong.length < 20) sw.wrong.push({ detail: detail + ' at +' + Math.round((sim.clock.now - start) / 1000) + 's', invariant })
}

function version(value: unknown) {
  return value && typeof value === 'object' ? (value as { v?: unknown }).v : undefined
}

export function record(sim: Sim, sw: SimSwarm, key: string, before: unknown, after: unknown) {
  sim.steps += 1
  if (after === undefined) {
    if (before !== undefined && settledMarks.some((prefix) => key.startsWith(prefix))) wrong(sim, sw, 'illegal transition', key + ' was deleted; a settled mark never reopens')
    return
  }
  if (versioned.some((prefix) => key.startsWith(prefix)) && typeof version(after) !== 'number') wrong(sim, sw, 'unversioned record', key + ' was stored without a version')
  if (key.startsWith('ran:')) {
    const was = Tree.readFold(before)
    const next = Tree.readFold(after)
    if (was && next && (foldRank[next.state] ?? 0) < (foldRank[was.state] ?? 0)) wrong(sim, sw, 'illegal transition', key + ' fell from ' + was.state + ' to ' + next.state)
  } else if (key.startsWith('seen:')) {
    const was = SubMachine.read(before)
    const next = SubMachine.read(after)
    if (!next) wrong(sim, sw, 'unversioned record', key + ' is not a readable subagent record')
    else if (was) {
      const from = SubMachine.rank(was.sub.status.state)
      const to = SubMachine.rank(next.sub.status.state)
      if (to < from) wrong(sim, sw, 'illegal transition', key + ' went back from ' + was.sub.status.state + ' to ' + next.sub.status.state)
      else if (from === 2 && next.sub.status.state !== was.sub.status.state) wrong(sim, sw, 'illegal transition', key + ' changed its ended state ' + was.sub.status.state + ' to ' + next.sub.status.state)
      if (Memo.units(next.spent) < Memo.units(was.spent)) wrong(sim, sw, 'illegal transition', key + ' spent fell from ' + was.spent + ' to ' + next.spent)
    }
  } else if (key.startsWith('lent:')) {
    const was = HandMachine.read(before)
    const next = HandMachine.read(after)
    if (!next) wrong(sim, sw, 'unversioned record', key + ' is not a readable hand record')
    else if (was?.state === 'returned' && next.state !== 'returned' && next.life === was.life) wrong(sim, sw, 'illegal transition', key + ' left returned for ' + next.state)
  } else if (key === 'run' && before !== undefined) {
    const was = (before ?? { state: 'new' }) as Parameters<typeof Run.kind>[0]
    const next = after as Parameters<typeof Run.kind>[0]
    if (!Run.can(Run.kind(was), Run.kind(next))) wrong(sim, sw, 'illegal transition', 'run went ' + Run.kind(was) + ' -> ' + Run.kind(next))
    if (Run.rev(next as never) !== Run.rev(was as never) + 1) wrong(sim, sw, 'illegal transition', 'run rev went ' + Run.rev(was as never) + ' -> ' + Run.rev(next as never))
  } else if (key.startsWith('pay:')) {
    const at = (after as { at?: unknown }).at
    if (at !== 'owed' && at !== 'paying') wrong(sim, sw, 'illegal transition', key + ' holds ' + String(at))
  }
}

function fencedStorage(sim: Sim, sw: SimSwarm, inc: Incarnation) {
  const inner = sw.store.storage
  const watching = (key: string) => watched.some((prefix) => key.startsWith(prefix))
  const sync = <T>(work: () => T) => {
    if (!inc.alive) throw new Evicted()
    sim.clock.activity += 1
    return work()
  }
  return {
    [fence]: { board: <T extends object>(board: T) => fencedBoard(sim, sw, inc, board) },
    [raw]: inner,
    deleteAlarm: () =>
      guard(sim, sw, inc, 'storage', async () => {
        await inner.deleteAlarm()
        sw.alarmToken += 1
      }),
    getAlarm: () => guard(sim, sw, inc, 'storage', () => inner.getAlarm()),
    kv: {
      delete: (key: string) =>
        sync(() => {
          const before = watching(key) ? inner.kv.get(key) : undefined
          const done = inner.kv.delete(key)
          if (before !== undefined) record(sim, sw, key, before, undefined)
          return done
        }),
      get: (key: string) => sync(() => inner.kv.get(key)),
      list: (options?: { prefix?: string }) => sync(() => inner.kv.list(options)),
      put: (key: string, value: unknown) =>
        sync(() => {
          const before = watching(key) ? inner.kv.get(key) : undefined
          inner.kv.put(key, value)
          if (watching(key)) record(sim, sw, key, before, value)
        }),
    },
    setAlarm: (at: number) =>
      guard(sim, sw, inc, 'storage', async () => {
        await inner.setAlarm(at)
        arm(sim, sw, at)
      }),
    sql: { exec: (query: string, ...values: unknown[]) => sync(() => inner.sql.exec(query, ...values)) },
  }
}

function incarnation(sim: Sim, sw: SimSwarm, gen: number, previous = false): Incarnation {
  let die = () => undefined as void
  const died = new Promise<void>((resolve) => (die = resolve))
  const inc = { alive: true, die, died, gen, previous } as Incarnation
  inc.env = {
    DB: fencedDb(sim, sw, inc, sim.db.env.DB),
    GATEWAY: { fetch: (request: Request) => guard(sim, sw, inc, 'gateway', () => gateway(sim, sw, inc, request)) },
    GATEWAY_URL: 'https://gateway.test',
    GITHUB: { fetch: async (request: Request) => (request.method === 'GET' ? Response.json({ workflow_runs: [] }) : new Response(null, { status: 204 })) },
    LOBBY: { getByName: () => ({ changed: async () => undefined }) },
    SWARMS_GATEWAY_KEY: 'test',
    SWARMS_GITHUB_TOKEN: 't',
    SWARMS_URL: 'https://swarms.test',
  } as unknown as Cloudflare.Env
  const ctx = {
    acceptWebSocket: () => undefined,
    getTags: () => [],
    getWebSockets: () => [],
    id: { toString: () => sw.id },
    setWebSocketAutoResponse: () => undefined,
    storage: fencedStorage(sim, sw, inc),
    waitUntil: (work: Promise<unknown>) => void work.catch(() => undefined),
  }
  inc.swarm = new Swarm(ctx as never, inc.env)
  return inc
}

function rawSub(sub: Sub) {
  return {
    agent_id: sub.id,
    budget_usd: usd(sub.budget),
    parent_agent_id: null,
    role: sub.role,
    spent_usd: usd(sub.spent),
    status: { state: sub.state, ...(sub.output ? { output: sub.output } : {}), ...(sub.error ? { error: sub.error } : {}) },
    task: sub.task,
  }
}

function listing(sw: SimSwarm, agent: string) {
  return JSON.stringify(sw.subs.filter((sub) => sub.agent === agent).map(rawSub))
}

function changed(sim: Sim, sw: SimSwarm, sub: Sub) {
  const history = sw.history.get(sub.agent) ?? []
  history.push(listing(sw, sub.agent))
  if (history.length > 8) history.shift()
  sw.history.set(sub.agent, history)
  const frames = sw.frames.get(sub.agent) ?? []
  const frame = 'data: ' + JSON.stringify({ created_at: sim.clock.now, event: { source: 'subagent', update: { id: sub.id, status: rawSub(sub).status, type: 'status' } }, seq: frames.length + 1 }) + '\n\n'
  frames.push(frame)
  sw.frames.set(sub.agent, frames)
  const faults = sim.faulty ? sim.options.faults : []
  for (const stream of [...sw.streams]) {
    if (stream.agent !== sub.agent) continue
    const send = (text: string) => {
      if (!sw.streams.has(stream)) return
      try {
        stream.controller.enqueue(encoder.encode(text))
        sim.clock.activity += 1
      } catch {
        sw.streams.delete(stream)
      }
    }
    if (faults.includes('reorder') && sw.random.gateway.chance(sim.rate.reorder)) {
      sw.redeliveries += 1
      sim.clock.add(() => send(frame), sw.random.gateway.int(1_000, 30_000))
    } else send(frame)
    if (faults.includes('dup') && sw.random.gateway.chance(sim.rate.dup)) {
      sw.redeliveries += 1
      send(frame)
    }
    if (faults.includes('stale') && frames.length > 1 && sw.random.gateway.chance(sim.rate.stale)) {
      sw.redeliveries += 1
      send(sw.random.gateway.pick(frames.slice(0, -1)))
    }
  }
}

function output(sim: Sim, sw: SimSwarm, sub: Sub) {
  const room = sim.options.children - sw.children
  const split = room > 0 && sw.random.gateway.chance(0.8)
  const n = split ? Math.min(room, sw.random.gateway.int(1, 3)) : 0
  sw.children += n
  const children = Array.from({ length: n }, (_, j) => ({ needs: [], spec: 'Part ' + j, statement: null, title: `Lemma ${sw.index}.${sub.id}.${j}` }))
  const outcome = split ? 'split' : sw.random.gateway.pick(['progress', 'stuck'])
  return { children, commit: null, outcome, summary: sub.summary, theorem: null, why: null }
}

function raised(sim: Sim, sw: SimSwarm, at: string) {
  if (sw.overspent) return
  const row = sim.db.sqlite
    .prepare("select coalesce(sum(case when kind = 'pledge' then amount else 0 end), 0) as pledged, coalesce(sum(case when kind = 'spend' then -amount else 0 end), 0) as spent from flows where swarm = ?")
    .get(sw.id) as { pledged: number; spent: number }
  const pledged = BigInt(row.pledged)
  let charged = 0n
  let allowed = 0n
  for (const sub of sw.subs) {
    charged += sub.spent
    allowed += sub.state === 'running' && sub.budget > sub.spent ? sub.budget : sub.spent
  }
  const when = 'at +' + Math.round((sim.clock.now - start) / 1000) + 's (' + at + ')'
  sw.charged = charged
  if (charged > sw.deposited) wrong(sim, sw, 'charged past deposit', 'the gateway charged ' + decimal(charged) + ' past ' + decimal(sw.deposited) + ' deposited (' + at + ')')
  if (BigInt(row.spent) > pledged) sw.overspent = 'the ledger spent ' + decimal(BigInt(row.spent)) + ' of ' + decimal(pledged) + ' raised ' + when
  else if (charged > pledged) sw.overspent = 'the gateway charged ' + decimal(charged) + ' of ' + decimal(pledged) + ' raised ' + when
  else if (allowed > pledged) sw.overspent = 'the gateway was allowed ' + decimal(allowed) + ' of ' + decimal(pledged) + ' raised ' + when
}

function life(sim: Sim, sw: SimSwarm, sub: Sub) {
  const step = () => {
    if (sub.state !== 'running') return
    if (sim.clock.now >= sub.ends) {
      sub.state = 'completed'
      sub.completed = sim.clock.now
      sub.output = output(sim, sw, sub)
      changed(sim, sw, sub)
      return
    }
    const room = sub.budget - sub.spent
    const spend = BigInt(sw.random.gateway.int(1_000, 400_000))
    sub.spent += spend < room ? spend : room > 0n ? room : 0n
    raised(sim, sw, sub.summary + ' spent')
    if (sub.spent >= sub.budget) {
      sub.blocked ??= sim.clock.now
      if (sim.clock.now - sub.blocked > 10 * 60_000) {
        sub.state = 'failed'
        sub.completed = sim.clock.now
        sub.error = 'over_limit ' + sub.summary
        changed(sim, sw, sub)
        return
      }
    } else sub.blocked = null
    changed(sim, sw, sub)
    sim.clock.add(step, sw.random.gateway.int(10_000, 90_000))
  }
  sim.clock.add(step, sw.random.gateway.int(5_000, 30_000))
}

function standing(sw: SimSwarm) {
  return { deposited: decimal(sw.deposited), left: decimal(sw.deposited - sw.charged), spent: decimal(sw.charged) }
}

function deposit(transfer: Transfer) {
  return { amount: decimal(transfer.amount), created_at: transfer.lands, from: transfer.from, hash: transfer.hash, log: 0, tag: transfer.tag, token: 'pathusd' }
}

function credit(sim: Sim, sw: SimSwarm, hash: string) {
  const transfer = sw.transfers.get(hash.toLowerCase())
  if (!transfer || sim.clock.now < transfer.lands) return Response.json({ code: 'not_found', detail: 'No receipt for ' + hash }, { status: 404 })
  if (transfer.stranded) return Response.json({ code: 'invalid_request', detail: 'The transfer names no app of this key' }, { status: 400 })
  const created = !sw.credited.has(transfer.hash)
  if (created) {
    sw.credited.add(transfer.hash)
    sw.deposited += transfer.amount
  }
  return Response.json({ created, credit: standing(sw), deposits: [deposit(transfer)] })
}

async function gateway(sim: Sim, sw: SimSwarm, inc: Incarnation | null, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  sim.calls += 1
  sim.trace.update(`${sim.clock.now} ${sw.index} ${inc ? 'do' : 'worker'} ${method} ${path}${url.search}\n`)
  const faults = sim.faulty ? sim.options.faults : []
  if (faults.includes('partition') && sim.clock.now < sw.partitioned) throw new TypeError('Network connection lost.')
  const body = method === 'POST' ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {}
  const lagging = faults.includes('lag') && sw.random.faults.chance(sim.rate.lag)
  if (path === '/api/keys/credit' && method === 'POST' && typeof body['hash'] === 'string') return credit(sim, sw, body['hash'])
  if (path === '/api/keys/credit' && lagging) return Response.json({ code: 'unavailable', detail: 'The spend read is behind' }, { status: 503 })
  if (path === '/api/keys/credit') return Response.json(standing(sw))
  if (path === '/api/keys/credit/deposits') return Response.json({ deposits: [...sw.credited].map((hash) => deposit(sw.transfers.get(hash) as Transfer)) })
  if (path === '/v1/agents' && method === 'POST') {
    const id = `agt_${sw.index}_${++sw.agentCount}`
    sw.agents.add(id)
    return Response.json({ id })
  }
  const agent = path.match(/^\/v1\/agents\/([^/]+)/)?.[1]
  if (agent && !sw.agents.has(agent)) return Response.json({ code: 'not_found', detail: 'No agent ' + agent }, { status: 404 })
  if (agent && path === `/v1/agents/${agent}/subagents` && method === 'POST') {
    if (faults.includes('refuse') && sw.random.gateway.chance(sim.rate.refuse)) {
      if (sw.random.gateway.chance(0.5)) return Response.json({ error: 'over_limit' }, { status: 402 })
      return Response.json({ code: 'conflict', detail: 'spawn host:' + String(body['key']) + ' is already starting' }, { status: 409 })
    }
    const key = String(body['key'] ?? '')
    const known = key ? sw.keyed.get(key) : undefined
    if (known) return Response.json({ agent: rawSub(known), created: false })
    const id = sw.subs.length + 1
    const sub: Sub = {
      agent,
      blocked: null,
      budget: micro(body['budget_usd']),
      completed: null,
      ends: sim.clock.now + sw.random.gateway.int(60_000, 15 * 60_000),
      error: null,
      id,
      key: key || null,
      output: null,
      role: String(body['role'] ?? ''),
      spent: 0n,
      state: 'running',
      summary: `sim ${sw.index} sub ${id}`,
      task: String(body['task'] ?? ''),
    }
    sw.subs.push(sub)
    if (key) sw.keyed.set(key, sub)
    raised(sim, sw, sub.summary + ' spawned')
    changed(sim, sw, sub)
    life(sim, sw, sub)
    return Response.json({ agent: rawSub(sub), created: true }, { status: 201 })
  }
  if (agent && path === `/v1/agents/${agent}/subagents` && lagging) return Response.json({ code: 'unavailable', detail: 'The subagent list is behind' }, { status: 503 })
  if (agent && path === `/v1/agents/${agent}/subagents`) {
    const history = sw.history.get(agent) ?? []
    if (faults.includes('staleList') && history.length > 1 && sw.random.faults.chance(sim.rate.staleList)) return Response.json({ agents: JSON.parse(sw.random.faults.pick(history.slice(0, -1))) as unknown[] })
    return Response.json({ agents: JSON.parse(listing(sw, agent)) as unknown[] })
  }
  const one = agent ? path.match(/^\/v1\/agents\/[^/]+\/subagents\/(\d+)\/(budget|close|messages)$/) : null
  if (agent && one) {
    const sub = sw.subs.find((each) => each.agent === agent && each.id === Number(one[1]))
    if (!sub) return Response.json({ code: 'not_found' }, { status: 404 })
    if (one[2] === 'budget') {
      sub.budget = micro(body['budget_usd'])
      if (sub.budget > sub.spent) sub.blocked = null
      raised(sim, sw, sub.summary + ' budgeted')
      changed(sim, sw, sub)
      return Response.json({ agent: rawSub(sub) })
    }
    if (one[2] === 'messages') return Response.json({ disposition: 'queued' })
    if (sub.state === 'running') {
      sub.state = 'closed'
      sub.completed = sim.clock.now
      changed(sim, sw, sub)
    }
    return Response.json({ agents: JSON.parse(listing(sw, agent)) as unknown[] })
  }
  if (agent && path === `/v1/agents/${agent}/events` && url.searchParams.get('live') === '1') {
    let entry: Stream | undefined
    const stream = new ReadableStream<Uint8Array>({
      cancel: () => void (entry && sw.streams.delete(entry)),
      start: (controller) => {
        if (inc) entry = { agent, controller, inc }
        sw.streams.add(entry)
      },
    })
    request.signal.addEventListener('abort', () => {
      if (!entry) return
      sw.streams.delete(entry)
      try {
        entry.controller.error(new Error('aborted'))
      } catch {}
    })
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
  }
  if (agent && path === `/v1/agents/${agent}/events`) return Response.json({ events: [], has_more: false, next_cursor: 0 })
  if (path === '/v1/models') return Response.json({ data: [] })
  if (path === '/api/keys/me') return Response.json({ wallet: '0x' + 'e'.repeat(40) })
  if (path === '/api/keys/backings') return Response.json({ backings: [], left: '0', spent: '0' })
  if (path === '/v1/hands') return Response.json({ hands: [] })
  return Response.json({ code: 'not_found', detail: 'The simulated gateway has no ' + method + ' ' + path }, { status: 404 })
}

const reset = 'Durable Object reset because its code was updated.'

function isReset(error: unknown) {
  return error instanceof Evicted || (error instanceof Error && (error.message === reset || /does not implement the method/.test(error.message)))
}

async function rpc(sim: Sim, sw: SimSwarm, method: string, args: unknown[]): Promise<unknown> {
  const inc = sw.inc
  sim.clock.activity += 1
  await null
  if (!inc.alive) throw new Error(reset)
  if (inc.previous && !older.methods.includes(method)) throw new TypeError('The RPC receiver does not implement the method "' + method + '".')
  const fn = (inc.swarm as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
  if (typeof fn !== 'function') throw new TypeError('The RPC receiver does not implement the method "' + method + '".')
  const answer = await Promise.race([Promise.resolve(fn.apply(inc.swarm, args)).then((value) => ({ value })), inc.died.then(() => null)])
  if (!answer) throw new Error(reset)
  return answer.value === undefined ? undefined : structuredClone(answer.value)
}

function workerEnv(sim: Sim, sw: SimSwarm): Cloudflare.Env {
  const stub = new Proxy({}, { get: (_, method) => (typeof method !== 'string' || method === 'then' ? undefined : (...args: unknown[]) => rpc(sim, sw, method, args)) })
  return {
    DB: sim.db.env.DB,
    GATEWAY: {
      fetch: async (request: Request) => {
        sim.clock.activity += 1
        await null
        return gateway(sim, sw, null, request)
      },
    },
    GATEWAY_URL: 'https://gateway.test',
    LOBBY: { getByName: () => ({ changed: async () => undefined }) },
    SWARMS: { get: () => stub, idFromName: (name: string) => name },
    SWARMS_GATEWAY_KEY: 'test',
    SWARMS_URL: 'https://swarms.test',
  } as unknown as Cloudflare.Env
}

async function request<T>(sw: SimSwarm, work: (inc: Incarnation) => Promise<T>): Promise<{ dead: true } | { dead: false; value: T }> {
  const inc = sw.inc
  if (!inc.alive) return { dead: true }
  return Promise.race([work(inc).then((value) => ({ dead: false as const, value })), inc.died.then(() => ({ dead: true as const }))])
}

async function deliver(sim: Sim, sw: SimSwarm, pledge: Pledge) {
  for (let tries = 0; tries < limits.attempts; tries++) {
    try {
      const answered = await Operations.contribute(sw.worker, { hash: pledge.hash, swarm: sw.id, ...(pledge.nid ? { node: pledge.nid } : {}) })
      if (answered.ok) {
        if (pledge.stranded) wrong(sim, sw, 'stranded counted', pledge.hash.slice(0, 10) + ' named no swarm but was taken')
        pledge.acked ??= sim.clock.now
        pledge.to ??= pledge.nid ?? Nodes.root
        return
      }
      const status = (answered as { status?: number }).status
      if (status === 400 && pledge.stranded) return
      if (status !== 404 && status !== 502 && status !== 503) {
        sim.errors.push('contribute ' + String(status) + ': ' + JSON.stringify(answered).slice(0, 300))
        return
      }
    } catch (error) {
      if (!isReset(error)) sim.errors.push('pledge: ' + String((error as Error)?.message ?? error).slice(0, 300))
    }
    await sleep(sim, sw.random.drive.int(limits.retryLeastMs, limits.retryMostMs))
  }
}

async function nodes(sw: SimSwarm) {
  try {
    const read = await request(sw, (inc) => inc.swarm.treeRead(sw.id, { depth: 8, root: Nodes.root, status: undefined }))
    if (read.dead || !read.value.ok) return []
    return read.value.value.nodes.filter((node) => node.id !== Nodes.triage).map((node) => node.id)
  } catch {
    return []
  }
}

function drive(sim: Sim, sw: SimSwarm) {
  const { activeMs, pledges } = sim.options
  for (let i = 0; i < pledges; i++) {
    const at = i === 0 ? 0 : sw.random.drive.int(0, activeMs)
    const amount = BigInt(sw.random.drive.int(2, 12)) * 1_000_000n + BigInt(sw.random.drive.int(0, 99)) * 10_000n
    const contributor = sw.random.drive.pick(riders)
    const hash = '0x' + createHash('sha256').update(`${sim.options.seed}:${sw.index}:${i}`).digest('hex')
    const targeted = i > 0 && sw.random.drive.chance(0.5)
    const retried = sim.options.faults.includes('retry') && sw.random.drive.chance(sim.rate.retry)
    const late = sw.random.drive.chance(0.5) ? 0 : sw.random.drive.int(1_000, 120_000)
    const stranded = sim.options.faults.includes('stranded') && sw.random.drive.chance(sim.rate.stranded)
    const lag = sim.options.faults.includes('chainLag') && sw.random.drive.chance(sim.rate.chainLag) ? sw.random.drive.int(1_000, limits.chainLagMs) : 0
    const pledge: Pledge = { acked: null, amount, contributor, hash, nid: null, stranded, to: null }
    sw.pledges.push(pledge)
    sim.clock.add(
      () =>
        void (async () => {
          if (targeted) pledge.nid = sw.random.drive.pick([Nodes.root, ...(await nodes(sw))])
          const tag = stranded ? '0x' + '0'.repeat(32) : pledge.nid && pledge.nid !== Nodes.root ? Credit.tag(sw.id, 'n:' + pledge.nid) : Credit.tag(sw.id)
          sw.transfers.set(hash, { amount, from: contributor, hash, lands: sim.clock.now + lag, stranded, tag })
          if (retried) {
            sw.redeliveries += 1
            sim.clock.add(() => void deliver(sim, sw, pledge), late)
          }
          await deliver(sim, sw, pledge)
        })(),
      at,
    )
  }
  if (sim.options.faults.includes('move')) {
    const moves = Math.round(pledges * sim.rate.move * 2)
    for (let i = 0; i < moves; i++)
      sim.clock.add(
        () =>
          void (async () => {
            const known = await nodes(sw)
            const funded = sw.pledges.filter((pledge) => pledge.acked !== null && pledge.to)
            if (!funded.length || known.length < 2) return
            const from = sw.random.drive.pick(funded)
            const to = sw.random.drive.pick(known.filter((nid) => nid !== from.to))
            if (!to || !from.to) return
            sw.moves += 1
            const key = 'm' + sw.index + '.' + i
            sw.moveKeys.add(key)
            const input = { amount: decimal(BigInt(sw.random.drive.int(5, 20)) * 100_000n), contributor: from.contributor, from: from.to as string, key, to }
            if (sim.options.faults.includes('retry') && sw.random.drive.chance(sim.rate.retry)) {
              sw.redeliveries += 1
              sim.clock.add(() => void rpc(sim, sw, 'treeMove', [sw.id, input]).catch(() => undefined), sw.random.drive.int(0, 120_000))
            }
            await rpc(sim, sw, 'treeMove', [sw.id, input]).catch(() => undefined)
          })(),
        sw.random.drive.int(5 * 60_000, activeMs),
      )
  }
  if (sim.options.faults.includes('partition')) {
    const tick = () => {
      if (!sim.faulty) return
      if (sw.random.faults.chance(sim.rate.partition)) sw.partitioned = sim.clock.now + sw.random.faults.int(limits.partitionLeastMs, limits.partitionMostMs)
      sim.clock.add(tick, 60_000)
    }
    sim.clock.add(tick, sw.random.faults.int(10_000, 60_000))
  }
  if (sim.options.faults.includes('evict')) {
    const tick = () => {
      if (!sim.faulty) return
      if (sw.random.faults.chance(sim.rate.evict)) evict(sim, sw, 'idle eviction')
      sim.clock.add(tick, 60_000)
    }
    sim.clock.add(tick, sw.random.faults.int(10_000, 60_000))
  }
}

async function plant(sim: Sim, sw: SimSwarm) {
  await Store.insert(sim.db.env, { creator: null, form: 'tree', goal: 'g', id: sw.id, problem: null, setup: null, steering: 'open', title: 'Load ' + sw.index })
  await sw.inc.swarm.plant({
    dispatcher: 'spawn',
    reviewed: true,
    rules: 'rules',
    root: { statement: null, title: 'Root ' + sw.index, words: 'The question.' },
    seed: [],
    settings: { ...Nodes.defaults, triageShare: 0 },
    setup: null,
    swarm: sw.id,
  })
}

const ended = ['done', 'failed', 'cancelled']

async function check(sim: Sim, sw: SimSwarm, violations: Violation[]) {
  const now = sim.clock.now
  const add = (invariant: Invariant, detail: string) => violations.push({ detail, invariant, swarm: sw.index })
  const progress = sw.store.storage.sql.exec("SELECT at, text FROM tree_deltas WHERE event = 'progress'").toArray() as { at: number; text: string }[]
  const board = sw.inc.swarm.board
  let folds = 0
  let slowest = 0
  for (const sub of sw.subs) {
    const marks = progress.filter((row) => row.text === sub.summary || row.text === sub.error)
    folds += marks.length
    if (marks.length > 1) {
      const between = sw.evictions.filter((one) => one.at >= (marks[0]?.at ?? 0) && one.at <= (marks.at(-1)?.at ?? 0)).map((one) => one.why)
      add('duplicate fold', `${sub.summary} (${sub.role}) folded ${marks.length} times, at ${marks.map((mark) => '+' + Math.round((mark.at - start) / 1000) + 's').join(' and ')}; evicted in between: ${between.join(', ') || 'never'}`)
    }
    if (sub.state === 'running') add('leaked subagent', `${sub.summary} (${sub.role}) still running at the end`)
    const match = sub.role.match(/^n:(.+)#(\d+)$/)
    const run = match ? Nodes.runId(match[1] ?? '', Number(match[2])) : null
    const task = run ? await board.task(run) : null
    if ((sub.state === 'completed' || sub.state === 'failed') && marks.length === 0 && task?.phase !== 'cancelled')
      add('lost result', `${sub.summary} (${sub.role}) ${sub.state} at +${Math.round(((sub.completed ?? start) - start) / 1000)}s but never folded; its run is ${task?.phase ?? 'missing'}`)
    const first = marks[0]
    if (first && sub.completed !== null) {
      const late = first.at - sub.completed
      slowest = Math.max(slowest, late)
      if (late > sim.options.deadlineMs) add('missed deadline', `${sub.summary} folded ${Math.round(late / 1000)}s after it finished`)
    }
  }
  const tasks = await board.tasks()
  const open = tasks.filter((task) => (task.labels['kind'] === 'run' || task.labels['kind'] === 'verify') && !ended.includes(task.phase))
  for (const task of tasks)
    if (task.untilMs && task.untilMs < now - 60_000 && !ended.includes(task.phase) && task.claim) add('missed deadline', `${task.id} is still held; its lease ran out ${Math.round((now - task.untilMs) / 1000)}s ago`)
  const alarm = sw.store.alarm()
  const listed = open.map((task) => task.id + ' ' + task.phase).join(', ')
  if (open.length && alarm === null) add('stuck without wake', `${listed} open with no alarm set`)
  else if (open.length) add('unfinished at end', `${listed} still open ${Math.round(sim.options.tailMs / 60_000)} minutes after the last fault`)
  if (sw.overspent) add('overspent', sw.overspent)
  for (const pledge of sw.pledges) if (pledge.acked === null && !pledge.stranded) add('lost pledge', `${pledge.hash.slice(0, 10)} for ${decimal(pledge.amount)} was never acknowledged` + (sw.credited.has(pledge.hash) ? ', though the gateway credited it' : ', and the gateway never credited it'))
  for (const one of sw.wrong) add(one.invariant, one.detail)
  for (const pledge of sw.pledges) {
    if (!pledge.stranded) continue
    const taken = sim.db.sqlite.prepare("select count(*) as n from flows where swarm = ? and id like ? || '%'").get(sw.id, sw.id + ':' + pledge.hash.toLowerCase()) as { n: number }
    if (taken.n > 0) add('stranded counted', pledge.hash.slice(0, 10) + ' named no swarm but reached the ledger')
  }
  const landed = sw.pledges.filter((pledge) => !pledge.stranded && pledge.acked !== null).length
  const funded = sw.store.storage.sql.exec("SELECT COUNT(*) AS n FROM tree_deltas WHERE event = 'funded' AND text LIKE '% rode it with $%'").one() as { n: number }
  if (Number(funded.n) > landed) add('duplicate payment', funded.n + ' pledges were announced for ' + landed + ' transfers')
  const moved = sim.db.sqlite.prepare("select count(*) as n from flows where swarm = ? and kind = 'move' and amount > 0").get(sw.id) as { n: number }
  if (Number(moved.n) > sw.moveKeys.size) add('duplicate payment', moved.n + ' moves landed for ' + sw.moveKeys.size + ' asked')
  const rows = await Flow.rows(sim.db.env, sw.id)
  const totals = Flow.totals(rows)
  const buckets = new Map<string, bigint>()
  for (const row of rows) {
    const key = row.node + '|' + (row.run ?? '') + '|' + row.contributor
    buckets.set(key, (buckets.get(key) ?? 0n) + row.amount)
  }
  for (const [key, amount] of buckets) if (amount < 0n) add('negative balance', `${key} holds ${decimal(amount)}`)
  const contributed = sw.pledges.reduce((sum, pledge) => sum + (pledge.stranded ? 0n : pledge.amount), 0n)
  const spentGateway = sw.subs.reduce((sum, sub) => sum + sub.spent, 0n)
  const drift = contributed - spentGateway - totals.held
  if (totals.pledged !== contributed) add('ledger drift', `the ledger holds ${decimal(totals.pledged)} pledged; riders sent ${decimal(contributed)}`)
  if (totals.spent !== spentGateway) add('ledger drift', `the ledger spent ${decimal(totals.spent)}; the gateway charged ${decimal(spentGateway)}`)
  if (drift !== 0n) add('ledger drift', `contributed ${decimal(contributed)} − charged ${decimal(spentGateway)} − held ${decimal(totals.held)} = ${decimal(drift)}`)
  return { contributed, drift, folds, held: totals.held, slowest, spentGateway, spentLedger: totals.spent }
}

export async function simulate(input: Partial<Options> = {}): Promise<Report> {
  const options = { ...defaults, ...input }
  const began = performance.now()
  const sim: Sim = { calls: 0, clock: new Clock(start), db: open(), errors: [], faulty: false, options, rate: { ...rates }, steps: 0, swarms: [], trace: createHash('sha256') }
  const timing = { ...Runner.timing }
  const restore = install(sim)
  try {
    for (let i = 0; i < options.swarms; i++) {
      const index = options.offset + i
      const sw = {
        agentCount: 0,
        agents: new Set<string>(),
        alarmToken: 0,
        alarming: null,
        charged: 0n,
        credited: new Set<string>(),
        deposited: 0n,
        moveKeys: new Set<string>(),
        partitioned: 0,
        transfers: new Map<string, Transfer>(),
        wrong: [],
        children: 0,
        evictions: [],
        frames: new Map(),
        history: new Map(),
        id: createHash('sha256').update(`${options.seed}:swarm:${index}`).digest('hex').slice(0, 12),
        index,
        keyed: new Map(),
        moves: 0,
        overspent: null,
        pledges: [],
        random: { drive: rng(options.seed, index, 'drive'), faults: rng(options.seed, index, 'faults'), gateway: rng(options.seed, index, 'gateway') },
        redeliveries: 0,
        store: storage(),
        streams: new Set(),
        subs: [],
      } as unknown as SimSwarm
      sw.inc = incarnation(sim, sw, 0)
      sw.worker = workerEnv(sim, sw)
      sim.swarms.push(sw)
    }
    for (const sw of sim.swarms) await plant(sim, sw)
    await runUntil(sim, start)
    sim.faulty = true
    for (const sw of sim.swarms) drive(sim, sw)
    await runUntil(sim, start + options.activeMs)
    sim.faulty = false
    await runUntil(sim, start + options.activeMs + options.tailMs)
    const violations: Violation[] = []
    const ledger = { contributed: 0n, drift: 0n, held: 0n, spentGateway: 0n, spentLedger: 0n }
    let folds = 0
    let slowest = 0
    for (const sw of sim.swarms) {
      const found = await check(sim, sw, violations)
      folds += found.folds
      slowest = Math.max(slowest, found.slowest)
      ledger.contributed += found.contributed
      ledger.drift += found.drift
      ledger.held += found.held
      ledger.spentGateway += found.spentGateway
      ledger.spentLedger += found.spentLedger
    }
    for (const error of [...new Set(sim.errors)].slice(0, 20)) violations.push({ detail: error, invariant: 'unexpected error', swarm: -1 })
    for (const sw of sim.swarms)
      for (const stream of sw.streams)
        try {
          stream.controller.error(new Error('done'))
        } catch {}
    for (const sw of sim.swarms) if (sw.inc.alive) void Runner.stop(sw.inc.swarm).catch(() => undefined)
    await drain(sim.clock)
    const sum = (pick: (sw: SimSwarm) => number) => sim.swarms.reduce((total, sw) => total + pick(sw), 0)
    return {
      counts: {
        children: sum((sw) => sw.children),
        evictions: sum((sw) => sw.evictions.length),
        folds,
        gatewayCalls: sim.calls,
        moves: sum((sw) => sw.moves),
        pledges: sum((sw) => sw.pledges.length),
        redeliveries: sum((sw) => sw.redeliveries),
        steps: sim.steps,
        subagents: sum((sw) => sw.subs.length),
      },
      ledger: { contributed: decimal(ledger.contributed), drift: decimal(ledger.drift), held: decimal(ledger.held), spentGateway: decimal(ledger.spentGateway), spentLedger: decimal(ledger.spentLedger) },
      options,
      slowestFoldMs: slowest,
      trace: sim.trace.digest('hex').slice(0, 16),
      violations,
      virtualMs: sim.clock.now - start,
      wallMs: Math.round(performance.now() - began),
    }
  } finally {
    restore()
    Object.assign(Runner.timing, timing)
  }
}
