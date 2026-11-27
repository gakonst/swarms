import { createHash } from 'node:crypto'
import type { Route } from '../run.ts'
import type * as HarnessModule from '../run.ts'
import type * as FollowModule from '../../src/worker/Follow.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as BranchingModule from '../../src/worker/Branching.ts'
import type * as GatewayModule from '../../src/worker/Gateway.ts'
import type * as MoneyModule from '../../src/worker/Money.ts'
import type * as PhaseModule from '../../src/worker/Phase.ts'
import type * as ProviderModule from '../../src/worker/Provider.ts'
import type * as TurnsModule from '../../src/worker/Turns.ts'
import type * as SwarmModule from '../../src/worker/Swarm.ts'
import { reasons } from '../../src/shared/Status.ts'
import * as Run from '../../src/worker/machines/Run.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

type Fail = (invariant: string, detail: string) => void

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
  const fail: Fail = (invariant, detail) => {
    if (violations.length < limits.violations) violations.push({ detail, invariant })
  }
  return { fail, violations }
}

const real = {
  error: console.error,
  info: console.info,
  log: console.log,
  warn: console.warn,
  now: Date.now,
  random: Math.random,
  uuid: crypto.randomUUID.bind(crypto),
}

function pin(random: Rng) {
  Date.now = () => limits.start
  Math.random = () => random.next()
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(random.next() * 16).toString(16)).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ReturnType<Crypto['randomUUID']>
  }
  console.error = () => undefined
  console.info = () => undefined
  console.log = () => undefined
  console.warn = () => undefined
  return () => {
    console.warn = real.warn
    console.info = real.info
    console.log = real.log
    Date.now = real.now
    Math.random = real.random
    crypto.randomUUID = real.uuid
    console.error = real.error
  }
}

function scenario(name: string, cases: ((random: Rng, fail: Fail) => Promise<number>)[]) {
  return async (seed: string): Promise<Outcome> => {
    await load()
    const random = rng(seed, name)
    const { fail, violations } = recorder()
    const unpin = pin(random)
    const restore = pending?.()
    let steps = 0
    try {
      for (const one of cases) steps += await one(random, fail)
    } finally {
      restore?.()
      unpin()
    }
    return { steps, violations }
  }
}

export const limits = {
  start: Date.UTC(2027, 0, 4, 9),
  violations: 20,
  gateway: {
    backings: { passMs: [61_000, 110_000], rings: [2, 5] },
    lease: { checks: [2, 5], downChance: 0.5, finalMs: [30_000, 6 * 60_000], jitterMs: 50_000, leaseMinutes: 30, minutesBefore: [24, 29] },
    minuteMs: 60_000,
    quietMs: 600_000,
    resend: { amount: [1_000_000, 9_000_000], passMs: [30_000, 120_000] },
    retryMs: 30_000,
    shrink: 3,
    starting: { alarms: [2, 6], passMs: [20_000, 60_000], quietJitterMs: 120_000 },
    statuses: [500, 502, 503, 529],
    stuck: { before: [2, 4], passMs: [60_000, 120_000], stallMinutes: [21, 28] },
    throwing: { attempts: [2, 5], extra: [1, 3], jitterMs: 5_000 },
  },
  provider: { mostMinutes: 4 * 60 + 1, pollMs: 11_000, repeats: 3, retryMinutes: 11, ringsMost: 6, roundsMost: 4 },
  failures: {
    backoffMs: 15_000,
    calmMs: 10 * 60_000,
    cancelledMost: 6,
    centsBelow: 3,
    creditMost: 50,
    dollar: 1_000_000,
    failedLeast: 1_000,
    hourMs: 3_600_000,
    minuteMs: 60_000,
    msPerSecond: 1_000,
    pauseAlarmsMost: 30,
    settleMs: 15_000,
    stepMs: 30_000,
    tries: 8,
    viewsMost: 3,
    writeFailsMost: 3,
  },
  money: {
    api: { nulled: 0.5, origins: ['https://swarms.test', 'https://swarms.new', 'https://example.test'], roundsMost: 9 },
    branches: { keptLeast: 2, keptMost: 6, listedMost: 4, patienceMs: 5, slowMost: 400 },
    clock: { checkLeast: 11_000, checkMost: 14_000, minute: 60_000, reread: 10 * 60_000, retry: 15_000 },
    looks: { ageMs: 3_600_000, digits: 3, fundLeast: 1, fundMost: 9, lowMost: 49, needs: 50_000, units: 1000 },
    clip: 200,
    decimals: 6,
    hex: { digits: 64, top: 15 },
    micro: 1_000_000,
    mutants: { doubles: 3, figures: 2, retry: 4 },
    refused: { ringsMost: 3, settleMs: 15_000, unreadMs: 30_000 },
    stream: {
      closeAfter: 6_000,
      followLeast: 2_000,
      followMost: 2_400,
      heardAgain: 3,
      heardLive: 4,
      listenFails: 2,
      plansLeast: 2,
      plansMost: 9,
      ringsLeast: 4,
      ringsMost: 7,
    },
    topped: { firstLeast: 100_000, firstMost: 900_000, givenLeast: 1_000_000, givenMost: 9_000_000, laterLeast: 100_000, laterMost: 2_000_000, needs: '50000' },
    waits: { first: 10 * 60_000, second: 20 * 60_000 },
  },
  pause: {
    archive: { budgetCentsMost: 90, budgetCentsLeast: 2, unit: 10_000 },
    backing: { dollarsMost: 50, firstMinutesMost: 9, laterMinutesMost: 30, unit: 1_000_000 },
    minute: 60_000,
    patience: { firstMinutesLeast: 11, firstMinutesMost: 59, laterMinutesLeast: 61, laterMinutesMost: 120, wakeHoursLeast: 2, wakeHoursMost: 8 },
    refused: { countMost: 4, pollMs: 11_000, rereadMinutes: 10, sponsorMinutes: 15 },
    stall: { leaseMinutes: 30, pollsMost: 6, restartMs: 15_000, overMs: 61_000, overMostMs: 5 * 60_000 },
  },
}

let harness: typeof HarnessModule
let Phase: typeof PhaseModule
let Turns: typeof TurnsModule
let Swarm: typeof SwarmModule.Swarm
let Swarms: typeof SwarmModule
let Follow: typeof FollowModule
let Operations: typeof OperationsModule
let Branching: typeof BranchingModule
let Gateway: typeof GatewayModule
let Money: typeof MoneyModule
let Provider: typeof ProviderModule

async function load() {
  if (harness) return
  const loading = pin(rng('mf-run'))
  try {
    harness = await import('../run.ts')
    Phase = await import('../../src/worker/Phase.ts')
    Turns = await import('../../src/worker/Turns.ts')
    Swarms = await import('../../src/worker/Swarm.ts')
    Swarm = Swarms.Swarm
    Follow = await import('../../src/worker/Follow.ts')
    Operations = await import('../../src/worker/Operations.ts')
    Branching = await import('../../src/worker/Branching.ts')
    Gateway = await import('../../src/worker/Gateway.ts')
    Money = await import('../../src/worker/Money.ts')
    Provider = await import('../../src/worker/Provider.ts')
  } finally {
    loading()
  }
}

let pending: (() => () => void) | undefined

function gateway() {
  type World = ReturnType<Awaited<typeof import('../run.ts')>['world']>

  const between = (random: Rng, [lo, hi]: number[]) => random.int(lo as number, hi as number)

  const prompts = (calls: string[]) => calls.filter((call) => call === 'POST /v1/agents/agt_1/turns').length

  const failure = (random: Rng) => {
    const kind = random.pick(['throw', ...limits.gateway.statuses] as const)
    return Object.assign(
      () => {
        if (kind === 'throw') throw new TypeError(random.pick(['Network connection lost.', 'fetch failed', 'socket hang up']))
        return Response.json({ error: 'upstream hiccup' }, { status: kind })
      },
      { kind },
    )
  }

  const show = (value: unknown) => JSON.stringify(value)

  async function throwing(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    let credit = '1'
    const broken = failure(random)
    const attempts = between(random, limits.gateway.throwing.attempts)
    const rings = attempts + between(random, limits.gateway.throwing.extra)
    const w = world((request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '1', left: credit, spent: '0' })
      if (url.pathname === '/v1/agents/agt_1/turns' && request.method === 'POST') return broken()
      return undefined
    })
    try {
      await w.seed()
      await w.swarm.wake('money')
      for (let alarm = 0; alarm < rings; alarm++) {
        if (alarm === attempts) credit = '0'
        await w.ring()
        w.pass(limits.gateway.retryMs + random.int(0, limits.gateway.throwing.jitterMs))
      }
      const errors = w.errors()
      if (show(errors) !== show(['The gateway did not take the next message for the agent.']))
        fail('one error row', attempts + ' failed sends logged ' + show(errors))
      const sent = Math.min(attempts, limits.provider.repeats)
      if (prompts(w.calls) !== sent)
        fail('prompts sent', 'credit ran out after ' + attempts + ' failed sends but ' + prompts(w.calls) + ' prompts went out in ' + rings + ' alarms')
      for (let ring = 0; ring < limits.provider.ringsMost && Phase.outaged(Phase.paused(w.swarm.run())); ring++) {
        w.pass(Phase.rereadMs)
        await w.ring()
      }
      const run = w.swarm.run()
      if (run.state !== 'paused' || run.pause.why !== 'money')
        fail('money paused', 'with no credit left the run is ' + run.state + (run.state === 'paused' ? ' for ' + run.pause.why : ''))
      const status = await w.status()
      if (status.status !== 'funding' || status.why !== 'money') fail('money paused', 'the listed status is ' + show(status))
    } finally {
      w.restore()
    }
    return rings
  }

  async function resent(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    const broken = failure(random)
    const bodies: { id: string; prompt: string }[] = []
    const note =
      random.pick(['Try the other approach', 'Look at the parser first', 'Write the tests before the fix']) +
      ' ' +
      random.int(1, limits.gateway.resend.amount[0] as number)
    const w = world((async (request, url) => {
      if (url.pathname !== '/v1/agents/agt_1/turns' || request.method !== 'POST') return undefined
      bodies.push((await request.json()) as { id: string; prompt: string })
      return bodies.length === 1 ? broken() : undefined
    }) as Route)
    try {
      await w.seed()
      await w.swarm.wake('money')
      await w.ring()
      const waiting = w.swarm.run()
      const sent = waiting.state === 'waiting' ? waiting.sent?.prompt : undefined
      if (sent !== bodies[0]?.prompt) fail('same prompt', 'after the failed send the run is ' + waiting.state + ' keeping ' + show(sent?.slice(0, 40)))
      await w.give(String(between(random, limits.gateway.resend.amount)), '0x' + 'c'.repeat(64), note)
      w.pass(between(random, limits.gateway.resend.passMs))
      await w.ring()
      const state = w.swarm.run().state
      if (state !== 'working') fail('same prompt', 'the resent prompt left the run ' + state)
      if (bodies.length !== 2 || bodies[1]?.id !== bodies[0]?.id || bodies[1]?.prompt !== bodies[0]?.prompt)
        fail('same prompt', bodies.length + ' sends, ids ' + show(bodies.map((body) => body.id)) + ', same prompt ' + (bodies[1]?.prompt === bodies[0]?.prompt))
      if (bodies[1]?.prompt.includes(note)) fail('note untold', 'the resent prompt carries the note that came meanwhile')
      const steered = w.sql.exec('SELECT note FROM steered').toArray()
      if (steered.length) fail('note untold', 'recorded as told: ' + show(steered))
    } finally {
      w.restore()
    }
    return 2
  }

  async function unbacked(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    const rings = between(random, limits.gateway.backings.rings)
    const w = world(() => undefined)
    try {
      await w.seed()
      await w.swarm.wake('money')
      await w.ring()
      for (let alarm = 0; alarm < rings; alarm++) {
        w.swarm.checked = 0
        w.pass(between(random, limits.gateway.backings.passMs))
        await w.ring()
      }
      const asked = (path: string) => w.calls.filter((call) => call === 'GET ' + path).length
      if (asked('/api/keys/credit') < 2 || asked('/api/keys/backings') !== 1)
        fail(
          'backings once',
          'in ' +
            (rings + 1) +
            ' alarms it asked for credit ' +
            asked('/api/keys/credit') +
            ' times and for backings ' +
            asked('/api/keys/backings') +
            ' times',
        )
    } finally {
      w.restore()
    }
    return rings + 1
  }

  async function starting(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    let credit = '1'
    const w = world((_request, url) => (url.pathname === '/api/keys/credit' ? Response.json({ deposited: '1', left: credit, spent: '0' }) : undefined))
    const prepare = w.env.DB.prepare
    const thrown = random.pick(['D1_ERROR: Network connection lost.', 'D1_ERROR: database is locked', 'D1_ERROR: storage reset'])
    const alarms = between(random, limits.gateway.starting.alarms)
    try {
      await w.seed()
      w.env.DB.prepare = (query: string) => {
        if (query.startsWith('update swarms set status')) throw new Error(thrown)
        return prepare.call(w.env.DB, query)
      }
      await w.swarm.wake('money')
      let passed = 0
      for (let alarm = 0; alarm < alarms; alarm++) {
        await w.ring()
        const state = w.swarm.run().state
        if (state !== 'waiting') fail('never starting', 'alarm ' + alarm + ' left the run ' + state)
        const ms = between(random, limits.gateway.starting.passMs)
        passed += ms
        w.pass(ms)
      }
      const first = w.errors()
      if (show(first) !== show(['The swarm hit an error and will retry.']))
        fail('one error row', alarms + ' throwing alarms in ' + passed + ' ms logged ' + show(first))
      w.pass(limits.gateway.quietMs - passed + random.int(0, limits.gateway.starting.quietJitterMs))
      await w.ring()
      if (w.errors().length !== 2) fail('one error row', 'past ten minutes the feed has ' + w.errors().length + ' error rows')
      credit = '0'
      await w.ring()
      const run = w.swarm.run()
      if (run.state !== 'paused') fail('money paused', 'with no credit and a throwing step the run is ' + run.state)
      if (w.errors().length !== 2) fail('one error row', 'the pause added error rows: ' + show(w.errors()))
      if (prompts(w.calls) !== 0) fail('prompts sent', prompts(w.calls) + ' prompts went out while every step threw')
    } finally {
      w.env.DB.prepare = prepare
      w.restore()
    }
    return alarms + 2
  }

  async function leased(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    let failing = false
    const broken = failure(random)
    const w = world((_request, url) => (failing && url.pathname === '/v1/agents/agt_1/turns/agt_1:1' ? broken() : undefined))
    let rings = 1
    try {
      await w.seed()
      await w.swarm.wake('money')
      await w.ring()
      const started = Date.now()
      if (w.swarm.run().state !== 'working') fail('lease stop', 'the turn did not start: ' + w.swarm.run().state)
      const check = async (ms: number, down: boolean) => {
        w.pass(ms)
        w.swarm.checked = 0
        failing = down
        await w.ring()
        rings++
      }
      const checks = between(random, limits.gateway.lease.checks)
      const minutes = between(random, limits.gateway.lease.minutesBefore)
      const cuts = Array.from({ length: checks - 1 }, () => random.int(1, minutes - 1)).sort((a, b) => a - b)
      const marks = [0, ...cuts, minutes]
      for (let k = 1; k < marks.length; k++)
        await check(
          ((marks[k] as number) - (marks[k - 1] as number)) * limits.gateway.minuteMs + (k === 1 ? random.int(0, limits.gateway.lease.jitterMs) : 0),
          random.chance(limits.gateway.lease.downChance),
        )
      const before = [w.swarm.run().state, w.swarm.agent()?.id]
      if (show(before) !== show(['working', 'agt_1']))
        fail('lease stop', 'after ' + (Date.now() - started) + ' ms of a ' + limits.gateway.lease.leaseMinutes + ' minute lease the run is ' + show(before))
      if (w.errors().some((text) => /stopped the turn/.test(text))) fail('lease stop', 'the turn was stopped before its lease ran out: ' + show(w.errors()))
      const final = limits.gateway.lease.leaseMinutes * limits.gateway.minuteMs - (Date.now() - started) + between(random, limits.gateway.lease.finalMs)
      await check(final, random.chance(limits.gateway.lease.downChance))
      const idle = Math.round((Date.now() - started) / limits.gateway.minuteMs)
      const after = [w.swarm.run().state, w.swarm.agent()?.id]
      if (show(after) !== show(['waiting', 'agt_1'])) fail('lease stop', 'after the lease ran out the run is ' + show(after))
      if (!w.calls.includes('POST /v1/agents/agt_1/turns/agt_1:1/cancel')) fail('lease stop', 'the stopped turn was not cancelled')
      const message = String(w.sql.exec('SELECT message FROM turns WHERE n = 1').toArray()[0]?.['message'])
      if (!message.includes('made no model call or tool call for ' + idle + ' minutes'))
        fail('lease stop', 'expected ' + idle + ' idle minutes, the turn says ' + show(message))
    } finally {
      w.restore()
    }
    return rings
  }

  async function stuck(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    const w = world(() => undefined)
    let rings = 0
    const ring = async (ms: number) => {
      w.pass(ms)
      w.swarm.checked = 0
      await w.ring()
      rings++
    }
    try {
      await w.seed()
      const before = between(random, limits.gateway.stuck.before)
      for (let n = 1; n <= before; n++)
        w.sql.exec(
          "INSERT INTO turns (n, turn, started_at, ended_at, status, spent_before, spent) VALUES (?, ?, ?, ?, ?, '0', '0')",
          n,
          'agt_0:' + n,
          n,
          n,
          random.pick(['failed', 'cancelled']),
        )
      await w.swarm.wake('money')
      await ring(0)
      if (w.swarm.run().state !== 'working') fail('stuck', 'the turn did not start: ' + w.swarm.run().state)
      await ring(between(random, limits.gateway.stuck.passMs))
      const status = await w.status()
      if (status.status !== 'running' || status.why !== 'stuck') fail('stuck', before + ' failed turns without spending list it as ' + show(status))
      if (w.swarm.why() !== 'stuck') fail('stuck', 'its why is ' + w.swarm.why())
      const stalledReason = w.swarm.view({ feed: 0 }).reason
      if (stalledReason !== 'Its last turns made no progress. It tries again by itself.')
        fail('stuck reason', 'with no kept failure it says ' + show(stalledReason))
      const code = random.pick(limits.gateway.statuses)
      w.swarm.kv.put('failure', { at: Date.now(), code: 'api_error', message: 'boom', route: 'Messages', status: code })
      const failedReason = w.swarm.view({ feed: 0 }).reason
      if (failedReason !== 'Its AI calls keep failing (error ' + code + '). It tries again by itself.')
        fail('stuck reason', 'with a kept ' + code + ' it says ' + show(failedReason))
      w.swarm.kv.put('failure', {
        at: Date.now(),
        code: 'api_error',
        message: "Tempo Agents cannot pay the network fee to open your key's channel right now: its fee sponsor is out of funds.",
        route: 'Messages',
        status: code,
      })
      const sponsorReason = w.swarm.view({ feed: 0 }).reason ?? ''
      if (!/^Waiting on Tempo, not on money/.test(sponsorReason)) fail('stuck reason', 'with an unfunded fee sponsor it says ' + show(sponsorReason))
      w.swarm.kv.delete('failure')
      w.swarm.kv.put('advanced', Date.now())
      await ring(between(random, limits.gateway.stuck.passMs))
      const moving = await w.status()
      if (moving.status !== 'running' || moving.why !== null) fail('stuck', 'once its agent made progress it lists as ' + show(moving))
      const movingReason = w.swarm.view({ feed: 0 }).reason
      if (movingReason !== null) fail('stuck reason', 'once its agent made progress it says ' + show(movingReason))
      await ring(between(random, limits.gateway.stuck.stallMinutes) * limits.gateway.minuteMs)
      const stalled = await w.status()
      if (stalled.status !== 'running' || stalled.why !== 'stuck') fail('stuck', 'a turn with no progress for a while lists as ' + show(stalled))
      if (w.errors().some((text) => /no model call or tool call/.test(text))) fail('stall quiet', 'a stall reached the feed: ' + show(w.errors()))
      const ended = w.sql.exec('SELECT message FROM turns WHERE turn = ?', 'agt_1:1').toArray()[0]?.['message']
      if (w.swarm.run().state !== 'working' || ended) fail('stall quiet', 'a stall stopped the turn: ' + w.swarm.run().state + ' ' + show(ended))
    } finally {
      w.restore()
    }
    return rings
  }

  const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
    'mf-run.errors': scenario('mf-run.errors', [starting]),
    'mf-run.gateway': scenario('mf-run.gateway', [throwing, resent, unbacked]),
    'mf-run.lease': scenario('mf-run.lease', [leased, stuck]),
  }

  type Proto = Record<string, unknown>

  const proto = new Proxy({} as Proto, {
    get: (_target, key) => Reflect.get(Swarm.prototype, key),
    set: (_target, key, value) => Reflect.set(Swarm.prototype, key, value),
  })

  function patched(name: string, wrap: (original: (...args: never[]) => unknown) => (this: InstanceType<typeof Swarm>, ...args: never[]) => unknown) {
    return () => {
      const original = proto[name] as (...args: never[]) => unknown
      proto[name] = wrap(original)
      return () => void (proto[name] = original)
    }
  }

  function getter(name: string, wrap: (value: unknown) => unknown) {
    return () => {
      const original = Object.getOwnPropertyDescriptor(Swarm.prototype, name) as PropertyDescriptor
      Object.defineProperty(Swarm.prototype, name, {
        ...original,
        get(this: unknown) {
          return wrap(original.get?.call(this))
        },
      })
      return () => void Object.defineProperty(Swarm.prototype, name, original)
    }
  }

  type Moved = { sent?: { told?: unknown }; state: string }

  const staleErrors = patched(
    'log',
    (original) =>
      function (this: unknown, ...args: never[]) {
        const [kind, text, detail, origin] = args as unknown as [string, string, string | null | undefined, Record<string, unknown> | undefined]
        return original.call(this, ...([kind, text, detail, kind === 'error' ? { ...origin, at: 0 } : origin] as never[]))
      },
  )

  const sendStaysStarting = patched(
    'move',
    (original) =>
      function (this: InstanceType<typeof Swarm>, ...args: never[]) {
        const [row, run, fields] = args as unknown as [never, Moved, never]
        return run.state === 'waiting' && run.sent ? this.moved(row, fields) : original.call(this, ...args)
      },
  )

  const pauseDropped = patched(
    'set',
    (original) =>
      function (this: InstanceType<typeof Swarm>, ...args: never[]) {
        const [run] = args as unknown as [Moved]
        return run.state === 'paused' ? this.run() : original.call(this, ...args)
      },
  )

  const throwStaysStarting = patched(
    'set',
    (original) =>
      function (this: InstanceType<typeof Swarm>, ...args: never[]) {
        const [run] = args as unknown as [Moved]
        return run.state === 'waiting' && this.run().state === 'starting' ? this.run() : original.call(this, ...args)
      },
  )

  const sentForgotten = patched(
    'move',
    (original) =>
      function (this: unknown, ...args: never[]) {
        const [row, run, ...rest] = args as unknown as [never, Moved, ...never[]]
        return original.call(this, ...([row, run.state === 'waiting' && run.sent ? { ...run, sent: undefined } : run, ...rest] as never[]))
      },
  )

  const toldForgotten = patched(
    'run',
    (original) =>
      function (this: unknown, ...args: never[]) {
        const run = original.call(this, ...args) as Moved
        return run.state === 'waiting' && run.sent ? { ...run, sent: { ...run.sent, told: undefined } } : run
      },
  )

  const unbackedForgotten = getter('kv', (value) => {
    const kv = value as {
      delete: (key: string) => unknown
      get: (key: string) => unknown
      list: (options?: unknown) => unknown
      put: (key: string, value: unknown) => void
    }
    return {
      delete: (key: string) => kv.delete(key),
      get: (key: string) => kv.get(key),
      list: (options?: unknown) => kv.list(options),
      put: (key: string, value: unknown) => (key === 'unbacked' ? undefined : kv.put(key, value)),
    }
  })

  const stuckIgnored = patched(
    'why',
    (original) =>
      function (this: unknown, ...args: never[]) {
        const why = original.call(this, ...args)
        return why === 'stuck' ? null : why
      },
  )

  const shortLeases = getter(
    'board',
    (value) =>
      new Proxy(value as object, {
        get(target, key) {
          const found = Reflect.get(target, key) as unknown
          if (typeof found !== 'function') return found
          if (key !== 'task') return found.bind(target)
          return async (task: string) => {
            const read = (await found.call(target, task)) as { untilMs?: number } | undefined
            return read?.untilMs === undefined
              ? read
              : { ...read, untilMs: read.untilMs - Math.floor((limits.gateway.lease.leaseMinutes * limits.gateway.minuteMs) / limits.gateway.shrink) }
          }
        },
      }),
  )

  function stallOff() {
    Follow.guards.stall = false
    return () => void (Follow.guards.stall = true)
  }

  function reworded() {
    const said = reasons as unknown as Record<string, string>
    const was = said['stalled'] as string
    said['stalled'] = 'Stuck.'
    return () => void (said['stalled'] = was)
  }

  const seeds = ['1', '2', '3']

  const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
    { flip: () => staleErrors(), invariant: 'one error row', name: 'mf-run.gateway.quiet', scenario: 'mf-run.gateway', seeds },
    { flip: () => staleErrors(), invariant: 'one error row', name: 'mf-run.errors.quiet', scenario: 'mf-run.errors', seeds },
    { flip: () => sendStaysStarting(), invariant: 'prompts sent', name: 'mf-run.gateway.recheck', scenario: 'mf-run.gateway', seeds },
    { flip: () => pauseDropped(), invariant: 'money paused', name: 'mf-run.gateway.pause', scenario: 'mf-run.gateway', seeds },
    { flip: () => pauseDropped(), invariant: 'money paused', name: 'mf-run.errors.pause', scenario: 'mf-run.errors', seeds },
    { flip: () => sentForgotten(), invariant: 'same prompt', name: 'mf-run.gateway.resend', scenario: 'mf-run.gateway', seeds },
    { flip: () => toldForgotten(), invariant: 'note untold', name: 'mf-run.gateway.told', scenario: 'mf-run.gateway', seeds },
    { flip: () => unbackedForgotten(), invariant: 'backings once', name: 'mf-run.gateway.backings', scenario: 'mf-run.gateway', seeds },
    { flip: () => throwStaysStarting(), invariant: 'never starting', name: 'mf-run.errors.starting', scenario: 'mf-run.errors', seeds },
    { flip: () => stallOff(), invariant: 'lease stop', name: 'mf-run.lease.stop', scenario: 'mf-run.lease', seeds },
    { flip: () => stuckIgnored(), invariant: 'stuck', name: 'mf-run.lease.stuck', scenario: 'mf-run.lease', seeds },
    { flip: () => reworded(), invariant: 'stuck reason', name: 'mf-run.lease.reason', scenario: 'mf-run.lease', seeds },
    { flip: () => shortLeases(), invariant: 'stall quiet', name: 'mf-run.lease.quiet', scenario: 'mf-run.lease', seeds },
  ]
  return { canaries, scenarios }
}

function failures() {
  const seen = (value: unknown) => JSON.stringify(value)

  const same = (a: unknown, b: unknown) => seen(a) === seen(b)

  async function recall(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    const w = world(() => undefined)
    try {
      await w.seed()
      const route = random.pick(['Messages', 'Responses'] as const)
      const status = random.pick([500, 502, 503, 529] as const)
      const code = random.pick(['api_error', 'overloaded_error', 'rate_limit_error'] as const)
      const message = random.pick([
        "Tempo Agents cannot pay the network fee to open your key's channel right now: its fee sponsor is out of funds.",
        'The upstream model is overloaded, try again later.',
        'Upstream timed out after the first byte.',
      ] as const)
      const error = route + ' HTTP ' + status + ': ' + JSON.stringify({ error: { message, type: code }, type: 'error' })
      const at = random.int(limits.failures.failedLeast, limits.failures.hourMs)
      let index = 0
      let clock = at
      if (random.chance(0.5))
        w.swarm.log('error', 'A model call failed.', JSON.stringify({ call_index: index++, error: 'Messages HTTP 500: older' }), {
          at: clock - limits.failures.failedLeast,
        })
      w.swarm.log('error', 'A model call failed: ' + message, JSON.stringify({ call_index: index++, error }), { at })
      const cancelled = random.int(1, limits.failures.cancelledMost)
      for (let one = 0; one < cancelled; one++) {
        clock += random.int(1, limits.failures.failedLeast)
        if (random.chance(0.5)) w.swarm.log('error', 'The run failed.', JSON.stringify({ status: 'failed' }), { at: clock })
        w.swarm.log('error', 'A model call failed.', JSON.stringify({ call_index: index++, error: 'the turn was cancelled' }), { at: clock })
      }
      w.swarm.kv.delete('failure')
      const expected = { at, code, message, route, status }
      const first = w.swarm.view({ feed: 0 }).failure
      if (!same(first, expected))
        fail('failure recalled', 'after ' + cancelled + ' cancelled calls the view read ' + seen(first) + ' instead of ' + seen(expected))
      w.swarm.log('error', 'A model call failed.', JSON.stringify({ call_index: index++, error: 'Messages HTTP 500: newer' }), { at: clock + 1 })
      const again = w.swarm.view({ feed: 0 }).failure
      if (!same(again, first)) fail('read once', 'a second view read ' + seen(again) + ' after the first read ' + seen(first))
      w.swarm.kv.put('failure', null)
      const cleared = w.swarm.view({ feed: 0 }).failure
      if (cleared !== null) fail('kept null', 'a kept null failure read back as ' + seen(cleared))
      return 3
    } finally {
      w.restore()
    }
  }

  async function refused(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    const status = random.pick([400, 422] as const)
    const w = world((request, url) =>
      url.pathname.endsWith('/turns') && request.method === 'POST' ? Response.json({ error: 'bad turn' }, { status }) : undefined,
    )
    try {
      await w.seed()
      await w.swarm.wake('money')
      await w.ring()
      const first = w.swarm.run()
      const due = (await w.swarm.board.task('turn:1'))?.dueAtMs
      if (!(first.state === 'waiting' && first.until === Date.now() + limits.failures.backoffMs && due === first.until))
        fail('board backoff', 'a ' + status + ' left the run ' + seen(first) + ' with the board due at ' + due + ', now ' + Date.now())
      let steps = 1
      for (let attempt = 1; attempt < limits.failures.tries; attempt++, steps++) {
        w.pass(random.int(limits.failures.backoffMs * 2 ** (limits.failures.tries - 1), limits.failures.hourMs))
        await w.ring()
      }
      const task = await w.swarm.board.task('turn:1')
      if (task?.phase !== 'failed' || task.attempts !== limits.failures.tries)
        fail(
          'eight tries',
          'after ' + limits.failures.tries + ' refusals of ' + status + ' the task is ' + task?.phase + ' with ' + task?.attempts + ' attempts',
        )
      if (!w.errors().some((text) => text.includes('failed ' + limits.failures.tries + ' tries in a row')))
        fail('exhausted told', 'the feed errors are ' + seen(w.errors()))
      if (w.swarm.agent() !== undefined) fail('agent dropped', 'the swarm kept agent ' + seen(w.swarm.agent()))
      w.pass(random.int(limits.failures.minuteMs, 2 * limits.failures.minuteMs))
      await w.ring()
      const fresh = await w.swarm.board.task('turn:1.1')
      if (fresh?.attempts !== 1) fail('new agent', 'the next agent turn turn:1.1 is ' + seen(fresh && { attempts: fresh.attempts, phase: fresh.phase }))
      return steps + 1
    } finally {
      w.restore()
    }
  }

  async function uncreated(random: Rng, fail: Fail) {
    const { id, rider, world } = await import('../run.ts')
    const dollars = random.int(2, limits.failures.creditMost)
    const kind = random.pick(['thrown', '500', '502', '503'] as const)
    let credit = '0.01'
    const w = world((request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: credit, left: credit, spent: '0' })
      if (url.pathname === '/v1/agents' && request.method === 'POST') {
        if (kind === 'thrown') throw new TypeError('Network connection lost.')
        return Response.json({ error: 'upstream hiccup' }, { status: Number(kind) })
      }
      return undefined
    })
    try {
      await w.seed('10000')
      w.sql.exec("INSERT INTO turns (n, turn, started_at, ended_at, status, spent_before) VALUES (1, 'agt_0:1', 1, 2, 'completed', '0')")
      await w.swarm.wake('money')
      await w.ring()
      const before = await w.status()
      if (!same(before, { status: 'paused', why: 'money' })) fail('paused money', 'a swarm with $0.01 left reads ' + seen(before))
      credit = dollars + '.01'
      const hash = '0x' + random.pick(['d', 'e', 'f'] as const).repeat(64)
      await w.give(String(dollars * limits.failures.dollar), hash)
      await w.swarm.contributed({ amount: String(dollars), contributor: rider, hash, kind: 'new', note: null, noteId: null, swarm: id, token: 'pathusd' })
      await w.ring()
      w.pass(random.int(limits.failures.stepMs, limits.failures.stepMs + limits.failures.backoffMs))
      await w.ring()
      const after = await w.status()
      if (!same(after, { status: 'running', why: null }))
        fail('retrying', 'with $' + dollars + ' and the agent failing to be created (' + kind + ') the swarm reads ' + seen(after))
      const reason = w.swarm.view({ feed: 0 }).reason
      if (reason !== null) fail('no reason', 'with the agent failing to be created (' + kind + ') the swarm says ' + seen(reason))
      if (!same(w.errors(), ['The gateway did not create the agent.']))
        fail('one error row', 'with the agent failing to be created (' + kind + ') the feed errors are ' + seen(w.errors()))
      return 3
    } finally {
      w.restore()
    }
  }

  async function rewritten(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    let credit = '1'
    let report: Record<string, unknown> = { request_id: 'agt_1:1', status: 'running' }
    const w = world((_request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '1', left: credit, spent: '0' })
      if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json(report)
      return undefined
    })
    try {
      await w.seed()
      await w.swarm.wake('money')
      await w.ring()
      const running = await w.status()
      if (!same(running, { status: 'running', why: null })) fail('running', 'the started swarm reads ' + seen(running))
      const prepare = w.env.DB.prepare
      const failures = random.int(1, limits.failures.writeFailsMost)
      let left = failures
      const broken = random.pick(['D1_ERROR: Network connection lost.', 'D1_ERROR: storage operation exceeded timeout', 'Network connection lost.'] as const)
      w.env.DB.prepare = (query: string) => {
        if (left && query.startsWith('update swarms set status')) {
          left -= 1
          throw new Error(broken)
        }
        return prepare(query)
      }
      credit = '0.0' + random.int(0, limits.failures.centsBelow)
      report = { ok: { message: 'done a step' }, request_id: 'agt_1:1', status: 'completed' }
      w.swarm.checked = 0
      await w.ring()
      for (let step = 0; step < failures; step++) {
        w.pass(random.int(limits.failures.stepMs, 2 * limits.failures.stepMs))
        await w.ring()
      }
      const run = w.swarm.run()
      const stale = await w.status()
      if (run.state !== 'paused' || left !== 0 || !same(stale, { status: 'running', why: null }))
        fail(
          'stale list',
          'with ' + credit + ' dollars left the run is ' + run.state + ', ' + left + ' of ' + failures + ' failing writes left, the list reads ' + seen(stale),
        )
      w.pass(random.int(limits.failures.stepMs, 2 * limits.failures.stepMs))
      await w.ring()
      const written = await w.status()
      if (!same(written, { status: 'paused', why: 'money' }))
        fail('written again', 'after ' + failures + ' failed writes (' + broken + ') the next step left the list at ' + seen(written))
      return failures + 3
    } finally {
      w.restore()
    }
  }

  async function settledOnce(random: Rng, fail: Fail, gone: boolean) {
    const { world } = await import('../run.ts')
    const state = random.pick(['pending', 'queued', 'running'] as const)
    const missing = random.pick([404, 410, 400] as const)
    const w = world((_request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '1', left: '0.01', spent: '0.99' })
      if (url.pathname === '/v1/agents/agt_gone/subagents')
        return gone
          ? Response.json({ error: 'No agent has this id.' }, { status: missing })
          : Response.json({ agents: [{ agent_id: 2, parent_agent_id: null, role: 'r', status: { state }, task: 't' }] })
      return undefined
    })
    try {
      await w.seed()
      const age = random.int(limits.failures.settleMs, limits.failures.minuteMs)
      w.swarm.kv.put('agent', { briefed: true, cursor: 0, id: 'agt_gone', instructed: true, url: 'backers' })
      w.swarm.kv.put('run', { at: Date.now() - age, pause: { left: '10000', needs: '50000', wake: null, why: 'money' }, state: 'paused' })
      let alarms = 0
      for (let next: number | null = Date.now(); next !== null && alarms < limits.failures.pauseAlarmsMost; next = w.alarm()) {
        await w.ring()
        w.pass(limits.failures.minuteMs)
        alarms += 1
      }
      const run = w.swarm.run()
      const how = gone ? 'the gateway answering ' + missing : 'a subagent ' + state
      if (!(run.state === 'paused' && run.settled !== undefined)) fail('settled once', 'with ' + how + ' the pause is ' + seen(run))
      const reads = w.calls.filter((call) => call === 'GET /api/keys/credit').length
      if (reads !== 1) fail('settled once', 'with ' + how + ' the credit was read ' + reads + ' times in ' + alarms + ' alarms')
      const expected = gone ? 1 : Math.ceil((limits.failures.calmMs - age) / limits.failures.minuteMs) + 1
      if (alarms !== expected)
        fail(gone ? 'gone at once' : 'calm wait', 'with ' + how + ' a pause ' + age + ' ms old settled after ' + alarms + ' alarms, not ' + expected)
      return alarms
    } finally {
      w.restore()
    }
  }

  async function pauses(random: Rng, fail: Fail) {
    const gone = random.chance(0.5)
    const first = await settledOnce(random, fail, gone)
    return first + (await settledOnce(random, fail, !gone))
  }

  async function lost(random: Rng, fail: Fail) {
    const { id, world } = await import('../run.ts')
    const recorded = async () => {
      const w = world(() => undefined)
      try {
        await w.seed()
        w.swarm.kv.delete('id')
        const views = random.int(1, limits.failures.viewsMost)
        for (let one = 0; one < views; one++) {
          await w.viewed()
          w.pass(random.int(0, limits.failures.minuteMs))
        }
        const unseen = [w.swarm.run().state, w.alarm()]
        if (!same(unseen, ['new', null])) fail('unseen stays', 'a swarm without its id viewed ' + views + ' times is ' + seen(unseen))
        await w.swarm.funded(id)
        const woken = w.alarm()
        await w.ring()
        if (woken === null || w.swarm.run().state !== 'working')
          fail('funded starts', 'a transfer recorded again set the alarm to ' + woken + ' and left the swarm ' + w.swarm.run().state)
      } finally {
        w.restore()
      }
    }
    const viewed = async () => {
      const w = world(() => undefined)
      try {
        await w.seed()
        w.pass(random.int(0, limits.failures.hourMs))
        await w.viewed()
        const woken = w.alarm()
        await w.ring()
        if (woken === null || w.swarm.run().state !== 'working')
          fail('viewed starts', 'a viewed swarm whose wake was lost set the alarm to ' + woken + ' and is ' + w.swarm.run().state)
      } finally {
        w.restore()
      }
    }
    const order = random.chance(0.5) ? [recorded, viewed] : [viewed, recorded]
    for (const one of order) await one()
    return 2
  }

  const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
    'mf-run.failures': scenario('mf-run.failures', [recall, refused, uncreated]),
    'mf-run.writes': scenario('mf-run.writes', [rewritten, pauses]),
    'mf-run.wakes': scenario('mf-run.wakes', [lost]),
  }

  type Method = (...args: unknown[]) => unknown

  const proto = new Proxy({} as Record<string, Method>, {
    get: (_target, key) => Reflect.get(Swarm.prototype, key),
    set: (_target, key, value) => Reflect.set(Swarm.prototype, key, value),
  })

  function patched(name: string, mutant: (original: Method) => Method) {
    return () => {
      const original = proto[name] as Method
      proto[name] = mutant(original)
      return () => void (proto[name] = original)
    }
  }

  type Store = {
    delete: (key: string) => boolean
    get: (key: string) => unknown
    list: (options?: unknown) => unknown
    put: (key: string, value: unknown) => void
  }

  function kv(mutant: (store: Store) => Store) {
    return () => {
      const original = Object.getOwnPropertyDescriptor(Swarm.prototype, 'kv') as PropertyDescriptor
      Object.defineProperty(Swarm.prototype, 'kv', {
        configurable: true,
        get(this: unknown) {
          return mutant(original.get?.call(this) as Store)
        },
      })
      return () => void Object.defineProperty(Swarm.prototype, 'kv', original)
    }
  }

  function unguarded(key: 'fresh' | 'gone' | 'ordered') {
    return () => {
      const guards = Turns.guards as Record<string, boolean>
      guards[key] = false
      return () => void (guards[key] = true)
    }
  }

  function retried(key: 'backoffMs' | 'maxAttempts', by: (value: number) => number) {
    return () => {
      const retry = Turns.retry as Record<string, number>
      const was = retry[key] as number
      retry[key] = by(was)
      return () => void (retry[key] = was)
    }
  }

  const forgetful = kv((store) => ({
    delete: (key) => store.delete(key),
    get: (key) => (key === 'failure' ? undefined : store.get(key)),
    list: (options) => store.list(options),
    put: (key, value) => store.put(key, value),
  }))

  const clinging = kv((store) => ({
    delete: (key) => (key === 'agent' ? false : store.delete(key)),
    get: (key) => store.get(key),
    list: (options) => store.list(options),
    put: (key, value) => store.put(key, value),
  }))

  const detailless = patched(
    'log',
    (log) =>
      function (this: unknown, kind, text, _detail, origin) {
        return log.call(this, kind, text, null, origin)
      },
  )

  const errorless = patched(
    'log',
    (log) =>
      function (this: unknown, kind, text, detail, origin) {
        return kind === 'error' ? undefined : log.call(this, kind, text, detail, origin)
      },
  )

  const seconds = patched(
    'log',
    (log) =>
      function (this: unknown, kind, text, detail, origin) {
        const given = (origin ?? {}) as { at?: number }
        return log.call(this, kind, text, detail, { ...given, at: Math.floor((given.at ?? Date.now()) / limits.failures.msPerSecond) })
      },
  )

  const unprojected = patched(
    'moved',
    () =>
      async function (this: { waiters: Set<() => void> }) {
        for (const waiter of [...this.waiters]) waiter()
      },
  )

  const listless = () => {
    Swarms.guards.listed = false
    return () => void (Swarms.guards.listed = true)
  }

  const unstepped = patched(
    'project',
    (project) =>
      function (this: unknown, ...args) {
        return args.length > 1 ? project.apply(this, args) : Promise.resolve(false)
      },
  )

  const remembered = patched(
    'move',
    (move) =>
      function (this: { run: () => PhaseModule.Run }, row, run, ...rest) {
        const from = Phase.paused(this.run())
        const next = run as PhaseModule.Run
        return move.call(this, row, next.state === 'waiting' && next.from === undefined && from ? { ...next, from } : next, ...rest)
      },
  )

  const unsettled = patched(
    'set',
    (set) =>
      function (this: unknown, run, ...rest) {
        const { settled: _settled, ...kept } = run as { settled?: number }
        return set.call(this, kept, ...rest)
      },
  )

  const agentless = patched('agent', () => () => undefined)

  const unfunded = patched(
    'funded',
    () =>
      async function (this: { cue: (cue: string) => void; kv: Store; marked: number }, swarm) {
        this.marked += 1
        this.kv.put('id', swarm)
        this.cue('credit')
      },
  )

  const unhealed = patched('tend', () => () => undefined)

  const eager = patched(
    'heal',
    (heal) =>
      async function (this: { ctx: { storage: { setAlarm: (at: number) => Promise<void> } }; kv: Store; run: () => PhaseModule.Run }) {
        if (this.run().state === 'new' && !this.kv.get('id')) return this.ctx.storage.setAlarm(Date.now())
        return heal.call(this)
      },
  )

  const seeds = ['1', '2', '3']

  const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
    { flip: () => detailless(), invariant: 'failure recalled', name: 'mf-run.recall.detail', scenario: 'mf-run.failures', seeds },
    { flip: () => forgetful(), invariant: 'read once', name: 'mf-run.recall.once', scenario: 'mf-run.failures', seeds },
    { flip: () => forgetful(), invariant: 'kept null', name: 'mf-run.recall.null', scenario: 'mf-run.failures', seeds },
    { flip: () => retried('backoffMs', (ms) => ms * 2)(), invariant: 'board backoff', name: 'mf-run.refused.backoff', scenario: 'mf-run.failures', seeds },
    { flip: () => retried('maxAttempts', (n) => n + 1)(), invariant: 'eight tries', name: 'mf-run.refused.tries', scenario: 'mf-run.failures', seeds },
    { flip: () => errorless(), invariant: 'exhausted told', name: 'mf-run.refused.told', scenario: 'mf-run.failures', seeds },
    { flip: () => clinging(), invariant: 'agent dropped', name: 'mf-run.refused.dropped', scenario: 'mf-run.failures', seeds },
    { flip: () => unguarded('fresh')(), invariant: 'new agent', name: 'mf-run.refused.fresh', scenario: 'mf-run.failures', seeds },
    { flip: () => unprojected(), invariant: 'paused money', name: 'mf-run.uncreated.projected', scenario: 'mf-run.failures', seeds },
    { flip: () => remembered(), invariant: 'retrying', name: 'mf-run.uncreated.from', scenario: 'mf-run.failures', seeds },
    { flip: () => remembered(), invariant: 'no reason', name: 'mf-run.uncreated.reason', scenario: 'mf-run.failures', seeds },
    { flip: () => seconds(), invariant: 'one error row', name: 'mf-run.uncreated.quiet', scenario: 'mf-run.failures', seeds },
    { flip: () => listless(), invariant: 'running', name: 'mf-run.writes.started', scenario: 'mf-run.writes', seeds },
    { flip: () => unguarded('ordered')(), invariant: 'stale list', name: 'mf-run.writes.stale', scenario: 'mf-run.writes', seeds },
    { flip: () => unstepped(), invariant: 'written again', name: 'mf-run.writes.again', scenario: 'mf-run.writes', seeds },
    { flip: () => unsettled(), invariant: 'settled once', name: 'mf-run.pause.settled', scenario: 'mf-run.writes', seeds },
    { flip: () => unguarded('gone')(), invariant: 'gone at once', name: 'mf-run.pause.gone', scenario: 'mf-run.writes', seeds },
    { flip: () => agentless(), invariant: 'calm wait', name: 'mf-run.pause.calm', scenario: 'mf-run.writes', seeds },
    { flip: () => eager(), invariant: 'unseen stays', name: 'mf-run.wakes.unseen', scenario: 'mf-run.wakes', seeds },
    { flip: () => unfunded(), invariant: 'funded starts', name: 'mf-run.wakes.funded', scenario: 'mf-run.wakes', seeds },
    { flip: () => unhealed(), invariant: 'viewed starts', name: 'mf-run.wakes.viewed', scenario: 'mf-run.wakes', seeds },
  ]
  return { canaries, scenarios }
}

function money() {
  type World = ReturnType<(typeof import('../run.ts'))['world']>

  function shuffle<T>(random: Rng, items: readonly T[]) {
    const out = [...items]
    for (let i = out.length - 1; i > 0; i--) {
      const j = random.int(0, i)
      ;[out[i], out[j]] = [out[j] as T, out[i] as T]
    }
    return out
  }

  const coins = (units: number) => (units / limits.money.micro).toFixed(limits.money.decimals)

  const hash = (random: Rng) => '0x' + Array.from({ length: limits.money.hex.digits }, () => random.int(0, limits.money.hex.top).toString(16)).join('')

  function down(random: Rng) {
    const kind = random.pick(['thrown', '503', '500', '502'] as const)
    const answer = (): Response => {
      if (kind === 'thrown') throw new TypeError('Network connection lost.')
      return Response.json({ error: 'down' }, { status: Number(kind) })
    }
    return { answer, kind }
  }

  async function looks(random: Rng, fail: Fail) {
    const { id, world } = await import('../run.ts')
    const L = limits.money.looks
    const money = () => ({ left: String(random.int(1, L.needs - 1)), needs: String(L.needs), wake: null, why: 'money' })
    const open = (pause: Record<string, unknown>) => {
      let credit = (random.int(1, L.lowMost) / L.units).toFixed(L.digits)
      const funds = String(random.int(L.fundLeast, L.fundMost))
      const w = world((_request, url) => (url.pathname === '/api/keys/credit' ? Response.json({ deposited: '1', left: credit, spent: '0' }) : undefined))
      const ready = async () => {
        await w.seed()
        w.swarm.kv.put('run', { at: Date.now() - L.ageMs, pause, settled: Date.now(), state: 'paused' })
      }
      const reads = () => w.calls.filter((call) => call === 'GET /api/keys/credit').length
      return { fund: () => void (credit = funds), ready, reads, w }
    }
    const replayed = async () => {
      const { ready, reads, w } = open(money())
      try {
        await ready()
        await w.swarm.funded(id)
        await w.ring()
        const seen = [w.swarm.run().state, reads(), w.alarm()]
        if (seen[1] !== 1) fail('reread once', 'a counted transfer recorded again read the money ' + seen[1] + ' times')
        if (seen[0] !== 'paused' || seen[2] !== null) fail('held', 'a transfer recorded again with no money left the run ' + seen[0] + ' with alarm ' + seen[2])
        const posts = w.calls.filter((call) => call.startsWith('POST')).length
        if (posts) fail('held', 'a paused swarm with no money made ' + posts + ' POST calls')
        return 1
      } finally {
        w.restore()
      }
    }
    const recorded = async () => {
      const { fund, ready, w } = open(money())
      try {
        await ready()
        fund()
        w.pass(random.int(0, limits.money.clock.reread - limits.money.clock.minute))
        await w.viewed()
        if (w.alarm() !== null) fail('held', 'a view before the reread was due set the alarm to ' + w.alarm())
        await w.swarm.funded(id)
        await w.ring()
        if (w.swarm.run().state !== 'working') fail('resumed', 'a transfer recorded once money was there left the run ' + w.swarm.run().state)
        return 1
      } finally {
        w.restore()
      }
    }
    const viewed = (pause: Record<string, unknown>) => async () => {
      const { fund, ready, w } = open(pause)
      try {
        await ready()
        fund()
        const early = random.int(limits.money.clock.minute, limits.money.clock.reread - limits.money.clock.minute)
        w.pass(early)
        await w.viewed()
        if (w.alarm() !== null) fail('held', 'a pause for ' + pause['why'] + ' viewed ' + early + 'ms after its reread set the alarm to ' + w.alarm())
        w.pass(limits.money.clock.reread - early + random.int(0, limits.money.clock.reread))
        await w.viewed()
        await w.ring()
        if (w.swarm.run().state !== 'working')
          fail('resumed', 'a funded pause for ' + pause['why'] + ' viewed past its reread left the run ' + w.swarm.run().state)
        return 1
      } finally {
        w.restore()
      }
    }
    const short = async () => {
      const { ready, reads, w } = open(money())
      try {
        await ready()
        w.pass(limits.money.clock.reread + random.int(0, limits.money.clock.reread))
        await w.viewed()
        await w.ring()
        await w.viewed()
        const seen = [w.swarm.run().state, reads(), w.alarm()]
        if (seen[1] !== 1) fail('reread once', 'an unfunded pause viewed twice around a reread read the money ' + seen[1] + ' times')
        if (seen[0] !== 'paused' || seen[2] !== null) fail('held', 'an unfunded pause viewed late left the run ' + seen[0] + ' with alarm ' + seen[2])
        return 1
      } finally {
        w.restore()
      }
    }
    let steps = 0
    for (const block of shuffle(random, [replayed, recorded, viewed(money()), viewed({ why: 'unfunded' }), short])) steps += await block()
    return steps
  }

  async function topped(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    const L = limits.money.topped
    const first = random.int(L.firstLeast, L.firstMost)
    const given = random.int(L.givenLeast, L.givenMost)
    let credit = coins(first)
    const running = { request_id: 'agt_1:1', status: 'running' }
    let report: Record<string, unknown> = running
    const w = world((_request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: credit, left: credit, spent: '0' })
      if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json(report)
      return undefined
    })
    const failing = async () => {
      report = { error: 'Boundless was not paid: fetch failed', request_id: 'agt_1:1', status: 'failed' }
      w.swarm.checked = 0
      w.pass(random.int(limits.money.clock.checkLeast, limits.money.clock.checkMost))
      await w.ring()
      report = running
    }
    try {
      await w.seed(String(first))
      await w.swarm.wake('money')
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('resumed', 'a swarm with ' + first + ' units did not start: ' + w.swarm.run().state)
      credit = coins(first + given)
      await w.give(String(given), hash(random))
      await failing()
      if (w.swarm.run().state !== 'waiting')
        fail('tries again', 'a turn failing for money after ' + given + ' units came in left the run ' + w.swarm.run().state)
      w.pass(limits.money.clock.retry + random.int(0, limits.money.clock.retry))
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('tries again', 'the retry after new money left the run ' + w.swarm.run().state)
      await failing()
      const paused = w.swarm.run()
      const wake = Date.now() + limits.money.waits.second
      const want = { balance: String(first + given), left: String(first + given), needs: L.needs, remaining: String(first + given), wake, why: 'money' }
      const got = paused.state === 'paused' ? paused.pause : paused.state
      if (JSON.stringify(got) !== JSON.stringify(want))
        fail('pause figures', 'a second failure with nothing new put in paused with ' + JSON.stringify(got) + ', not ' + JSON.stringify(want))
      w.pass(limits.money.refused.settleMs)
      await w.ring()
      if (w.swarm.run().state !== 'paused' || w.alarm() !== wake)
        fail('held', 'the settled pause left the run ' + w.swarm.run().state + ' with alarm ' + w.alarm() + ', not ' + wake)
      await w.give(String(random.int(L.laterLeast, L.laterMost)), hash(random))
      w.pass(limits.money.clock.reread + random.int(0, limits.money.clock.minute))
      await w.viewed()
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('resumed', 'money put in during the pause left the run ' + w.swarm.run().state)
      return 1
    } finally {
      w.restore()
    }
  }

  async function refused(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    const R = limits.money.refused
    const running = { request_id: 'agt_1:1', status: 'running' }
    let report: Record<string, unknown> = running
    let off = false
    const broken = down(random)
    const w = world((_request, url) => {
      if (off && (url.pathname === '/api/keys/credit' || url.pathname === '/api/keys/backings')) return broken.answer()
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '5', left: '5', spent: '0' })
      if (url.pathname.startsWith('/v1/agents/agt_1/turns/agt_1:')) return Response.json(report)
      return undefined
    })
    const failing = async () => {
      report = { error: 'Boundless was not paid: fetch failed', request_id: 'agt_1:1', status: 'failed' }
      w.swarm.checked = 0
      w.pass(random.int(limits.money.clock.checkLeast, limits.money.clock.checkMost))
      await w.ring()
      report = running
    }
    const waited = (want: number, what: string) => {
      const run = w.swarm.run()
      const got = run.state === 'paused' && run.pause.why === 'money' ? run.pause.wake : run.state
      if (got !== want) fail('doubles', what + ' paused until ' + got + ', not ' + want)
      return typeof got === 'number' ? got : want
    }
    let steps = 0
    try {
      await w.seed('5000000')
      await w.swarm.wake('money')
      await w.ring()
      await failing()
      const wake = waited(Date.now() + limits.money.waits.first, 'the first refusal')
      let at = Date.now() + R.settleMs
      for (let ring = random.int(1, R.ringsMost); ring > 0; ring--, steps++) {
        w.pass(at - Date.now())
        await w.ring()
        if (w.swarm.run().state !== 'paused' || w.alarm() !== wake)
          fail(
            'held',
            'a refused pause rung at ' +
              (Date.now() - wake) +
              'ms from its wake left the run ' +
              w.swarm.run().state +
              ' with alarm ' +
              w.alarm() +
              ', not ' +
              wake,
          )
        at = random.int(Date.now() + 1, wake - 1)
      }
      w.pass(wake - Date.now() + random.int(0, limits.money.clock.minute))
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('resumed', 'the refused pause past its wake left the run ' + w.swarm.run().state)
      await failing()
      const second = waited(Date.now() + limits.money.waits.second, 'the second refusal')
      const chat = w.sql
        .exec("SELECT text FROM chat WHERE parent IS NULL AND node IS NOT 'board' ORDER BY id")
        .toArray()
        .map((row) => String(row['text']))
      const told = ['Started working.', 'Its last step could not be paid for, though it has money. It tries again by itself.']
      if (JSON.stringify(chat) !== JSON.stringify(told)) fail('told once', 'the room heard ' + JSON.stringify(chat))

      off = true
      w.pass(second - Date.now() + random.int(0, limits.money.clock.minute))
      await w.ring()
      const retry = Date.now() + limits.money.clock.minute
      if (w.swarm.run().state !== 'paused' || w.alarm() !== retry)
        fail('unread holds', 'money that read ' + broken.kind + ' left the run ' + w.swarm.run().state + ' with alarm ' + w.alarm() + ', not ' + retry)
      off = false
      w.pass(limits.money.clock.minute + random.int(0, limits.money.clock.minute))
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('resumed', 'money readable again left the run ' + w.swarm.run().state)
    } finally {
      w.restore()
    }
    const unread = world((_request, url) => (off && url.pathname === '/api/keys/credit' ? broken.answer() : undefined))
    try {
      off = true
      await unread.seed()
      await unread.swarm.wake('money')
      await unread.ring()
      const seen = [unread.swarm.run().state, unread.errors()]
      if (JSON.stringify(seen) !== JSON.stringify(['waiting', ['The gateway did not say how much money the swarm has.']]))
        fail('unread holds', 'a start whose money read ' + broken.kind + ' left ' + JSON.stringify(seen))
      off = false
      unread.pass(R.unreadMs + random.int(0, limits.money.clock.retry))
      await unread.ring()
      if (unread.swarm.run().state !== 'working') fail('resumed', 'a start whose money read again left the run ' + unread.swarm.run().state)
    } finally {
      unread.restore()
    }
    return steps + 1
  }

  async function listens(random: Rng, fail: Fail) {
    const { world } = await import('../run.ts')
    const S = limits.money.stream
    const broken = down(random)
    let live: () => Response = broken.answer
    const w = world((_request, url) => (url.pathname === '/v1/agents/agt_1/events' && url.searchParams.get('live') === '1' ? live() : undefined))
    const heard = () => w.calls.filter((call) => call.includes('live=1')).length
    let steps = 0
    try {
      await w.seed()
      await w.swarm.wake('money')
      const rings = random.int(S.ringsLeast, S.ringsMost)
      for (let ring = 0; ring < rings; ring++, steps++) {
        await w.ring()
        w.pass(random.int(S.followLeast, S.followMost))
      }
      if (w.swarm.run().state !== 'working' || heard() !== S.listenFails)
        fail(
          'listens twice',
          rings + ' alarms on a stream failing with ' + broken.kind + ' left the run ' + w.swarm.run().state + ' after ' + heard() + ' listens',
        )
      w.pass(limits.money.clock.minute + random.int(0, limits.money.clock.minute))
      await w.ring()
      if (heard() !== S.heardAgain || w.swarm.stream.state !== 'polling')
        fail('listens again', 'a minute later the swarm listened ' + heard() + ' times and is ' + w.swarm.stream.state)
      const words = 'Weighing ' + random.int(S.plansLeast, S.plansMost) + ' plans.'
      const thought = { event: { event: { payload: { item_id: 'rs_1', offset: 0, text: words }, type: 'reasoning.summary.delta' }, source: 'session' }, seq: 1 }
      live = () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (w.swarm.kv.get('thinking') !== undefined) {
                w.pass(S.closeAfter)
                return controller.close()
              }
              controller.enqueue(new TextEncoder().encode('event: live\ndata: ' + JSON.stringify(thought) + '\n\n'))
            },
          }),
        )
      w.pass(limits.money.clock.minute + random.int(0, limits.money.clock.minute))
      await w.ring()
      const thinking = JSON.stringify(w.swarm.kv.get('thinking'))
      if (heard() !== S.heardLive || !String(thinking).includes(words) || w.swarm.stream.state !== 'streaming')
        fail('listens again', 'a working stream was heard ' + heard() + ' times, thinking ' + thinking + ', state ' + w.swarm.stream.state)
      return steps
    } finally {
      w.restore()
    }
  }

  async function named(random: Rng, fail: Fail) {
    const OpenApi = await import('../../src/worker/OpenApi.ts')
    const Phase = await import('../../src/worker/Phase.ts')
    const document = OpenApi.document(random.pick(limits.money.api.origins)) as unknown as { components: { schemas: { Status: { enum: string[] } } } }
    const listed = document.components.schemas.Status.enum
    if (JSON.stringify(listed) !== JSON.stringify(['funding', 'running', 'paused', 'archived'])) fail('api statuses', 'the API names ' + JSON.stringify(listed))
    const asked = random.pick(['done', 'Done', 'finished'] as const)
    if (Operations.schema.list.safeParse({ status: asked }).success) fail('done refused', 'listing by status ' + asked + ' was accepted')
    const money = {
      left: String(random.int(0, limits.money.micro)),
      wake: random.chance(limits.money.api.nulled) ? null : random.int(1, limits.money.micro),
      why: 'money',
    } as const
    const runs = [
      { state: 'new' },
      { since: null, state: 'waiting', until: 0 },
      { from: money, since: null, state: 'waiting', until: 0 },
      { id: 'a:1', n: 1, since: null, state: 'starting', told: [] },
      { from: 0, n: 1, since: 1, started: 1, state: 'working', turn: 't' },
      { at: 0, pause: money, state: 'paused' },
      { at: 0, pause: { why: 'unfunded' }, state: 'paused' },
    ] as const
    const rounds = [0, random.int(1, limits.money.api.roundsMost)]
    const projected = new Set(shuffle(random, runs).flatMap((run) => rounds.map((n) => Phase.project(run as never, n).status)))
    if (JSON.stringify([...projected, 'archived'].sort()) !== JSON.stringify([...Operations.statuses].sort()))
      fail(
        'projected statuses',
        'runs project to ' + JSON.stringify([...projected, 'archived'].sort()) + ' but the API names ' + JSON.stringify([...Operations.statuses]),
      )
    return 1
  }

  async function branches(random: Rng, fail: Fail) {
    const { id, world } = await import('../run.ts')
    const B = limits.money.branches
    const Branching = await import('../../src/worker/Branching.ts')
    let answer: () => Response | Promise<Response> = () => Response.json({ agents: [] })
    const w = world((_request, url) => (url.pathname === '/v1/agents/agt_1/subagents' ? answer() : undefined))
    const patient = globalThis.setTimeout
    globalThis.setTimeout = ((work: () => void, ms?: number) => patient(work, ms === Branching.patienceMs ? B.patienceMs : ms)) as typeof setTimeout
    const old = Array.from({ length: random.int(1, B.listedMost) }, (_, i) => ({
      id: i + 1,
      role: random.pick(['explorer', 'prover', 'tester']),
      status: { state: random.pick(['running', 'closed']) },
    }))
    const keep = () => w.swarm.kv.put('subagents', { agent: 'agt_1', at: Date.now() - Branching.keptMs * random.int(B.keptLeast, B.keptMost), list: old })
    const timed = <T>(work: Promise<T>) => Promise.race([work, new Promise<'late'>((resolve) => patient(() => resolve('late'), B.slowMost))])
    try {
      await w.seed()
      w.swarm.kv.put('agent', { briefed: true, cursor: 0, id: 'agt_1' })
      keep()
      let release = () => {}
      answer = () => new Promise<Response>((resolve) => (release = () => resolve(Response.json({ agents: [] }))))
      const slow = await timed(w.swarm.subagents(id))
      if (slow === 'late' || !slow.ok || slow.value.list.length !== old.length)
        fail(
          'held when slow',
          'a slow listing answered ' + JSON.stringify(slow).slice(0, limits.money.clip) + ' instead of the ' + old.length + ' kept branches',
        )
      release()
      const broken = down(random)
      answer = broken.answer
      keep()
      w.swarm.listing = undefined
      const failing = await timed(w.swarm.subagents(id))
      if (failing === 'late' || !failing.ok || failing.value.list.length !== old.length)
        fail('held when failing', 'a listing failing with ' + broken.kind + ' answered ' + JSON.stringify(failing).slice(0, limits.money.clip))
      const listed = Array.from({ length: random.pick(Array.from({ length: B.listedMost + 1 }, (_, n) => n).filter((n) => n !== old.length)) }, (_, i) => ({
        agent_id: i + 1,
        parent_agent_id: null,
        role: 'explorer',
        status: { state: 'running' },
        task: 't',
      }))
      answer = () => Response.json({ agents: listed })
      w.swarm.listing = undefined
      const fresh = await timed(w.swarm.subagents(id))
      if (fresh === 'late' || !fresh.ok || fresh.value.list.length !== listed.length)
        fail('fresh answered', 'a working listing of ' + listed.length + ' answered ' + JSON.stringify(fresh).slice(0, limits.money.clip))
      return 1
    } finally {
      w.restore()
    }
  }

  type Proto = Record<string, (...args: unknown[]) => unknown>

  function patched(name: string, make: (was: (...args: unknown[]) => unknown) => (...args: unknown[]) => unknown) {
    return () => {
      const proto = new Proxy({} as Proto, {
        get: (_target, key) => Reflect.get(Swarm.prototype, key),
        set: (_target, key, value) => Reflect.set(Swarm.prototype, key, value),
      })
      const was = proto[name] as (...args: unknown[]) => unknown
      proto[name] = make(was)
      return () => void (proto[name] = was)
    }
  }

  function retimed(retry: { backoffMs: number }, by: number) {
    return () => {
      const was = retry.backoffMs
      retry.backoffMs = was * by
      return () => void (retry.backoffMs = was)
    }
  }

  const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
    'mf-run.money': scenario('mf-run.money', [looks, topped, refused]),
    'mf-run.live': scenario('mf-run.live', [listens, branches]),
    'mf-run.api': scenario('mf-run.api', [named]),
  }

  type Self = InstanceType<typeof Swarm>

  function stored(list: readonly string[], change: (items: string[]) => void) {
    return () => {
      const items = list as unknown as string[]
      const was = [...items]
      change(items)
      return () => void items.splice(0, items.length, ...was)
    }
  }

  function lenient() {
    const list = Operations.schema.list as unknown as { safeParse: (value: unknown) => unknown }
    const was = list.safeParse
    list.safeParse = (value: unknown) => ({ data: value, success: true })
    return () => void (list.safeParse = was)
  }

  const guarded = (guards: Record<string, boolean>, key: string) => () => {
    guards[key] = false
    return () => void (guards[key] = true)
  }

  const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
    {
      flip: patched(
        'funded',
        () =>
          async function (this: Self, swarm: unknown) {
            this.kv.put('id', swarm)
            this.cue('credit')
            const run = this.run()
            if (run.state === 'paused' || run.state === 'waiting' || run.state === 'new') await this.ctx.storage.setAlarm(Date.now())
          },
      ),
      invariant: 'reread once',
      name: 'mf-run.money.replay',
      scenario: 'mf-run.money',
      seeds: ['1', '2', '3'],
    },
    {
      flip: patched(
        'heal',
        (was) =>
          async function (this: Self) {
            await was.call(this)
            if (this.run().state === 'paused') await this.ctx.storage.setAlarm(Date.now())
          },
      ),
      invariant: 'held',
      name: 'mf-run.money.eager',
      scenario: 'mf-run.money',
      seeds: ['1', '2', '3'],
    },
    {
      flip: patched(
        'set',
        (was) =>
          function (this: Self, run: unknown, expect: unknown) {
            if (this.run().state === 'paused' && (run as { state: string }).state === 'waiting') return
            return was.call(this, run, expect)
          },
      ),
      invariant: 'resumed',
      name: 'mf-run.money.stuck',
      scenario: 'mf-run.money',
      seeds: ['1', '2', '3'],
    },
    {
      flip: () => retimed(Turns.retry, limits.money.mutants.retry)(),
      invariant: 'tries again',
      name: 'mf-run.money.retry',
      scenario: 'mf-run.money',
      seeds: ['1', '2', '3'],
    },
    {
      flip: patched(
        'move',
        (was) =>
          function (this: Self, row: unknown, run: unknown, ...rest: unknown[]) {
            const { balance: _balance, ...kept } = run as Record<string, unknown>
            return was.call(this, row, kept, ...rest)
          },
      ),
      invariant: 'tries again',
      name: 'mf-run.money.grew',
      scenario: 'mf-run.money',
      seeds: ['1', '2', '3'],
    },
    {
      flip: () => retimed(Turns.paying, limits.money.mutants.figures)(),
      invariant: 'pause figures',
      name: 'mf-run.money.figures',
      scenario: 'mf-run.money',
      seeds: ['1', '2', '3'],
    },
    {
      flip: () => retimed(Turns.paying, limits.money.mutants.doubles)(),
      invariant: 'doubles',
      name: 'mf-run.money.doubles',
      scenario: 'mf-run.money',
      seeds: ['1', '2', '3'],
    },
    {
      flip: patched(
        'set',
        (was) =>
          function (this: Self, run: unknown, expect: unknown) {
            const { again: _again, ...kept } = run as Record<string, unknown>
            return was.call(this, kept, expect)
          },
      ),
      invariant: 'told once',
      name: 'mf-run.money.told',
      scenario: 'mf-run.money',
      seeds: ['1', '2', '3'],
    },
    { flip: () => guarded(Turns.guards, 'known')(), invariant: 'unread holds', name: 'mf-run.money.unread', scenario: 'mf-run.money', seeds: ['1', '2', '3'] },
    {
      flip: () => guarded(Follow.guards, 'twice')(),
      invariant: 'listens twice',
      name: 'mf-run.live.twice',
      scenario: 'mf-run.live',
      seeds: ['1', '2', '3'],
    },
    {
      flip: () => guarded(Follow.guards, 'again')(),
      invariant: 'listens again',
      name: 'mf-run.live.again',
      scenario: 'mf-run.live',
      seeds: ['1', '2', '3'],
    },
    {
      flip: patched(
        'subagents',
        (was) =>
          function (this: Self, swarm: unknown) {
            return was.call(this, swarm, true)
          },
      ),
      invariant: 'held when slow',
      name: 'mf-run.live.slow',
      scenario: 'mf-run.live',
      seeds: ['1', '2', '3'],
    },
    {
      flip: patched(
        'subagents',
        (was) =>
          function (this: Self, swarm: unknown, fresh: unknown) {
            this.kv.delete('subagents')
            return was.call(this, swarm, fresh)
          },
      ),
      invariant: 'held when failing',
      name: 'mf-run.live.failing',
      scenario: 'mf-run.live',
      seeds: ['1', '2', '3'],
    },
    {
      flip: patched(
        'subagents',
        (was) =>
          function (this: Self, swarm: unknown, fresh: unknown) {
            const kept = this.kv.get<Record<string, unknown>>('subagents')
            if (kept) this.kv.put('subagents', { ...kept, at: Date.now() })
            return was.call(this, swarm, fresh)
          },
      ),
      invariant: 'fresh answered',
      name: 'mf-run.live.fresh',
      scenario: 'mf-run.live',
      seeds: ['1', '2', '3'],
    },
    {
      flip: () => stored(Operations.statuses, (items) => void items.push('done'))(),
      invariant: 'api statuses',
      name: 'mf-run.api.done',
      scenario: 'mf-run.api',
      seeds: ['1', '2', '3'],
    },
    { flip: () => lenient(), invariant: 'done refused', name: 'mf-run.api.lenient', scenario: 'mf-run.api', seeds: ['1', '2', '3'] },
    {
      flip: () => guarded(Phase.guards, 'listed')(),
      invariant: 'projected statuses',
      name: 'mf-run.api.dropped',
      scenario: 'mf-run.api',
      seeds: ['1', '2', '3'],
    },
  ]
  return { canaries, scenarios }
}

function pauses() {
  const world = async () => harness.world

  async function stalled(random: Rng, fail: Fail) {
    const w = (await world())(() => undefined)
    const L = limits.pause.stall
    try {
      await w.seed()
      await w.swarm.wake('money')
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('stall stopped', 'the turn did not start: ' + w.swarm.run().state)
      const polls = random.int(1, L.pollsMost)
      let idle = 0
      for (let poll = 0; poll < polls; poll++) {
        const left = (L.leaseMinutes - 1) * limits.pause.minute - idle
        const ms = poll === polls - 1 ? left : random.int(1, Math.max(1, Math.floor(left / 2)))
        idle += ms
        w.pass(ms)
        w.swarm.checked = 0
        await w.ring()
        if (w.swarm.run().state !== 'working')
          fail('stall stopped', 'after ' + idle + 'ms idle the turn was ' + w.swarm.run().state + ', before its lease ran out')
      }
      w.pass(random.int(L.overMs, L.overMostMs))
      w.swarm.checked = 0
      await w.ring()
      const state = w.swarm.run().state
      const cancelled = w.calls.includes('POST /v1/agents/agt_1/turns/agt_1:1/cancel')
      const said = w.errors().some((text) => /made no model call or tool call for \d+ minutes/.test(text) || /stopped with an error/.test(text))
      if (state !== 'waiting' || !cancelled || !said)
        fail('stall stopped', 'past the lease the run was ' + state + ', cancelled ' + cancelled + ', error row ' + said)
      w.pass(L.restartMs)
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('stall stopped', 'the swarm did not start another turn: ' + w.swarm.run().state)
      return polls + 3
    } finally {
      w.restore()
    }
  }

  async function patience(random: Rng, fail: Fail) {
    const w = (await world())((_request, url) => (url.pathname === '/api/keys/credit' ? Response.json({ deposited: '5', left: '5', spent: '0' }) : undefined))
    const L = limits.pause.patience
    try {
      await w.seed('5000000')
      const at = Date.now()
      const wake = at + random.int(L.wakeHoursLeast, L.wakeHoursMost) * 60 * limits.pause.minute
      w.swarm.kv.put('run', { at, pause: { balance: '5000000', left: '5000000', needs: '50000', wake, why: 'money' }, settled: at, state: 'paused' })
      await w.swarm.ctx.storage.setAlarm(wake)
      const first = random.int(L.firstMinutesLeast, L.firstMinutesMost)
      w.pass(first * limits.pause.minute)
      await w.viewed()
      await w.ring()
      if (w.swarm.run().state !== 'paused') fail('pause patience', 'viewed ' + first + ' minutes in, before an hour, the pause became ' + w.swarm.run().state)
      await w.swarm.ctx.storage.setAlarm(wake)
      const later = random.int(L.laterMinutesLeast, L.laterMinutesMost)
      w.pass((later - first) * limits.pause.minute)
      await w.viewed()
      const alarm = w.alarm()
      if (alarm === null || alarm > Date.now() + limits.pause.minute)
        fail('pause patience', 'viewed ' + later + ' minutes in, the alarm stayed at ' + alarm + ' for a wake ' + (wake - at) + 'ms ahead')
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('pause patience', 'viewed ' + later + ' minutes in with money there, the pause stayed ' + w.swarm.run().state)
      return 4
    } finally {
      w.restore()
    }
  }

  async function boundless(random: Rng, fail: Fail) {
    const { id } = await import('../run.ts')
    const Setup = await import('../../src/shared/Setup.ts')
    const made: { model?: string }[] = []
    const metered = [Setup.fable, Setup.opus]
    const pairs = [
      ['boundless/anthropic/claude-fable-5.2', Setup.fable],
      ['boundless/anthropic/claude-opus-5.5', Setup.opus],
    ] as const
    const [from, to] = random.pick(pairs)
    const listed = [...metered, ...pairs.map(([direct]) => direct)].filter((model) => model === from || random.chance(0.7) || metered.includes(model))
    const w = (await world())((async (request, url) => {
      if (url.pathname === '/v1/models')
        return Response.json({
          data: listed.map((model) => ({
            capabilities: { tools: true },
            id: model,
            kind: 'generate',
            metered: true,
            pricing: { cached: 0.2, input: 4, output: 20 },
          })),
        })
      if (url.pathname === '/v1/agents' && request.method === 'POST') {
        made.push((await request.clone().json()) as { model?: string })
        return Response.json({ id: 'agt_1' })
      }
      return undefined
    }) as Route)
    try {
      await w.seed('5000000')
      const kept = random.chance(0.5) ? to : from
      const old = {
        harness: 'claude',
        model: from,
        most: '440960',
        step: '65600',
        steps: {},
        subagents: { harnesses: ['claude'], models: random.chance(0.5) ? [from] : [from, kept] },
        template: 'fable',
      }
      await w.env.DB.prepare('update swarms set setup = ? where id = ?').bind(JSON.stringify(old), id).run()
      w.swarm.kv.put('agent', { briefed: true, cursor: random.int(1, 50), id: 'agt_old', instructed: true, url: 'backers' })
      w.swarm.kv.put('instructions', 'the old instructions, naming ' + from)
      await w.swarm.wake('money')
      await w.ring()
      const row = (await w.env.DB.prepare('select setup from swarms where id = ?').bind(id).first()) as { setup: string }
      const setup = JSON.parse(row.setup) as { model: string; subagents: { models: string[] }; template: string }
      const got = JSON.stringify([
        setup.model,
        setup.subagents.models,
        setup.template,
        w.swarm.run().state,
        w.swarm.agent()?.id,
        made.map((agent) => agent.model),
      ])
      const want = JSON.stringify([to, [to], 'fable', 'working', 'agt_1', [to]])
      if (got !== want) fail('off boundless', 'from ' + from + ' with the gateway listing ' + listed.join(',') + ' the swarm became ' + got + ', not ' + want)
      if (String(w.swarm.kv.get('instructions')).includes('boundless/')) fail('off boundless', 'the old instructions naming ' + from + ' were kept')
      const said = w.sql
        .exec("SELECT text FROM feed WHERE kind = 'status'")
        .toArray()
        .some((entry) => /Moved the swarm off Boundless: it runs on Claude (Fable 5\.2|Opus 5\.5) now/.test(String(entry['text'])))
      if (!said) fail('off boundless', 'no status line said the swarm moved off ' + from)
      return 2
    } finally {
      w.restore()
    }
  }

  async function backing(random: Rng, fail: Fail) {
    const { id, rider } = await import('../run.ts')
    const L = limits.pause.backing
    const key = '0x' + 'e'.repeat(40)
    const limit = random.int(2, L.dollarsMost)
    const paid = random.int(1, limit - 1)
    let state = {
      backer: rider,
      createdAt: 1,
      ended: false,
      expiresAt: null,
      key,
      left: String(limit),
      limit: String(limit),
      spent: '0',
      tag: null,
      token: 'mach',
    }
    const w = (await world())((_request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '0', left: '0', spent: '0' })
      if (url.pathname === '/api/keys/backings') return Response.json({ backings: [state], left: state.ended ? '0' : state.left, spent: state.spent })
      return undefined
    })
    try {
      await w.seed('0')
      await w.env.DB.prepare("insert into contributions (id, swarm, channel, contributor, token, amount, created_at) values (?, ?, ?, ?, 'mach', ?, 1)")
        .bind('backing:' + key, id, key, rider, String(limit * L.unit))
        .run()
      w.swarm.kv.put('run', { at: Date.now() - 60 * limits.pause.minute, pause: { left: '0', wake: null, why: 'money' }, settled: Date.now(), state: 'paused' })
      state = { ...state, ended: true, left: '0', spent: String(paid) }
      const amount = async () =>
        (
          await w.env.DB.prepare('select amount from contributions where id = ?')
            .bind('backing:' + key)
            .first<{ amount: string }>()
        )?.amount
      const first = random.int(1, L.firstMinutesMost)
      w.pass(first * limits.pause.minute)
      await w.viewed()
      const early = [w.alarm(), await amount()]
      if (early[0] !== null || early[1] !== String(limit * L.unit))
        fail('backing lowered', 'viewed ' + first + ' minutes after the pause settled it read ' + JSON.stringify(early))
      const later = random.int(L.firstMinutesMost + 1, L.laterMinutesMost)
      w.pass((later - first) * limits.pause.minute)
      await w.viewed()
      await w.ring()
      const late = [w.swarm.run().state, await amount()]
      if (late[0] !== 'paused' || late[1] !== String(paid * L.unit))
        fail(
          'backing lowered',
          'a $' + limit + ' backing that ended after paying $' + paid + ' read ' + JSON.stringify(late) + ' when viewed ' + later + ' minutes in',
        )
      return 3
    } finally {
      w.restore()
    }
  }

  const broke = "Messages HTTP 503: Tempo Agents cannot pay the network fee to open your key's channel right now"

  const sponsorless =
    'Messages HTTP 503: {"error":{"message":"Tempo Agents cannot pay the network fee to open your key\'s channel right now: its fee sponsor is out of funds. This key has no OUSD, pathUSD or USDC.e limit, so it cannot pay the fee itself.","type":"api_error"},"type":"error"}'

  const stalledError = 'The agent made no model call or tool call for 30 minutes, so the swarm stopped the turn to start another.'

  async function unpaid(random: Rng, fail: Fail, sponsor: boolean) {
    const { id } = await import('../run.ts')
    const Store = await import('../../src/worker/Store.ts')
    const L = limits.pause.refused
    const invariant = sponsor ? 'sponsor wait' : 'refused not counted'
    let report: Record<string, unknown> = { request_id: 'agt_1:1', status: 'running' }
    const w = (await world())((_request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '5', left: '5', spent: '0' })
      if (url.pathname.startsWith('/v1/agents/agt_1/turns/agt_1:')) return Response.json(report)
      return undefined
    })
    try {
      await w.seed('5000000')
      await w.swarm.wake('money')
      await w.ring()
      if (w.swarm.run().state !== 'working') fail(invariant, 'the turn did not start: ' + w.swarm.run().state)
      const agent = w.swarm.agent()?.id
      const count = random.int(1, L.countMost)
      w.swarm.kv.put('unpaid', { count, error: sponsor ? sponsorless : broke })
      report = { error: stalledError, request_id: 'agt_1:1', status: 'failed' }
      w.swarm.checked = 0
      w.pass(random.int(L.pollMs, 2 * L.pollMs))
      await w.ring()
      const paused = w.swarm.run()
      const pause = paused.state === 'paused' ? paused.pause : undefined
      const wake = pause?.why === 'money' ? pause.wake : undefined
      if (!sponsor) {
        if (wake !== Date.now() + L.rereadMinutes * limits.pause.minute)
          fail(invariant, 'after ' + count + ' unpaid calls the stalled turn left ' + JSON.stringify(paused))
      } else {
        const sponsored = pause?.why === 'money' && pause.sponsor === true
        if (!sponsored || wake === null || wake === undefined || wake > Date.now() + L.sponsorMinutes * limits.pause.minute)
          fail(invariant, 'a turn the fee sponsor could not pay left ' + JSON.stringify(paused))
        const said = pause ? Phase.reason(pause) : ''
        if (!/^Waiting on Tempo, not on money/.test(said)) fail(invariant, 'the pause said ' + JSON.stringify(said))
        if (w.swarm.agent()?.id !== agent) fail(invariant, 'the agent ' + agent + ' was replaced by ' + w.swarm.agent()?.id)
        const row = await Store.find(w.env, id)
        const seen = JSON.stringify([row?.why, row?.waiting, row ? Store.summary(row).waiting : undefined])
        if (seen !== JSON.stringify(['money', 'tempo', 'tempo'])) fail(invariant, 'D1 read the wait as ' + seen)
      }
      if (w.swarm.kv.get('unpaid') !== undefined) fail(invariant, 'the unpaid count was kept: ' + JSON.stringify(w.swarm.kv.get('unpaid')))
      return 3
    } finally {
      w.restore()
    }
  }

  async function archive(random: Rng, fail: Fail) {
    const { id, rider } = await import('../run.ts')
    const L = limits.pause.archive
    const budget = random.int(L.budgetCentsLeast, L.budgetCentsMost)
    const spent = random.int(0, budget - 1)
    const failure = random.pick(['503', '500', 'throw'] as const)
    let listing: () => Response = () => {
      if (failure === 'throw') throw new TypeError('fetch failed')
      return Response.json({ detail: "The subagents' spending could not be read from the ledger; retry." }, { status: Number(failure) })
    }
    const w = (await world())((_request, url) => (url.pathname === '/v1/agents/agt_old/subagents' ? listing() : undefined))
    try {
      await w.seed()
      await w.env.DB.prepare(
        "insert into steers (id, swarm, contributor, note, note_id, amount, created_at, budget, branch, agent) values ('s1', ?1, ?2, 'branch 7', 'branch:7', ?3, 1, 0, 7, 'agt_old')",
      )
        .bind(id, rider, String(budget * L.unit))
        .run()
      const returned = async () =>
        (
          await w.env.DB.prepare(
            'select coalesce(sum(-cast(amount as integer)), 0) as back from steers where swarm = ?1 and branch = 7 and cast(amount as integer) < 0',
          )
            .bind(id)
            .first<{ back: number }>()
        )?.back
      const refused = await w.swarm.archive(id, Date.now()).then(
        () => false,
        (error: unknown) => /could not be read/.test(String(error)),
      )
      const early = await returned()
      if (!refused || early !== 0)
        fail('branches unsettled', 'with the spend unreadable (' + failure + ') the archive refused ' + refused + ' and returned ' + early)
      listing = () =>
        Response.json({
          agents: [{ agent_id: 7, budget_usd: budget / 100, parent_agent_id: null, role: 'b', spent_usd: spent / 100, status: { state: 'closed' }, task: 't' }],
        })
      await w.swarm.archive(id, Date.now())
      const back = await returned()
      if (back !== (budget - spent) * L.unit) fail('branches unsettled', 'a branch given ' + budget + ' cents that spent ' + spent + ' returned ' + back)
      return 2
    } finally {
      w.restore()
    }
  }

  function flag<T extends Record<string, boolean>>(guards: T, key: keyof T & string) {
    return () => {
      ;(guards as Record<string, boolean>)[key] = false
      return () => void ((guards as Record<string, boolean>)[key] = true)
    }
  }

  function reworded() {
    const said = reasons as unknown as Record<string, string>
    const was = said['sponsor'] as string
    said['sponsor'] = said['refused'] as string
    return () => void (said['sponsor'] = was)
  }

  const scenarios = {
    'mf-run.pause': scenario('mf-run.pause', [patience, backing, archive]),
    'mf-run.stall': scenario('mf-run.stall', [stalled, boundless, (random, fail) => unpaid(random, fail, false), (random, fail) => unpaid(random, fail, true)]),
  }

  const canaries = [
    { flip: () => flag(Follow.guards, 'stall')(), invariant: 'stall stopped', name: 'mf-run.stall.lease', scenario: 'mf-run.stall', seeds: ['1', '2', '3'] },
    { flip: () => flag(Gateway.guards, 'direct')(), invariant: 'off boundless', name: 'mf-run.stall.direct', scenario: 'mf-run.stall', seeds: ['1', '2', '3'] },
    {
      flip: () => flag(Run.guards, 'unpaid')(),
      invariant: 'refused not counted',
      name: 'mf-run.stall.unpaid',
      scenario: 'mf-run.stall',
      seeds: ['1', '2', '3'],
    },
    { flip: () => reworded(), invariant: 'sponsor wait', name: 'mf-run.stall.sponsor', scenario: 'mf-run.stall', seeds: ['1', '2', '3'] },
    {
      flip: () => flag(Phase.guards, 'patience')(),
      invariant: 'pause patience',
      name: 'mf-run.pause.patience',
      scenario: 'mf-run.pause',
      seeds: ['1', '2', '3'],
    },
    { flip: () => flag(Money.guards, 'lower')(), invariant: 'backing lowered', name: 'mf-run.pause.lower', scenario: 'mf-run.pause', seeds: ['1', '2', '3'] },
    {
      flip: () => flag(Branching.guards, 'unread')(),
      invariant: 'branches unsettled',
      name: 'mf-run.pause.unread',
      scenario: 'mf-run.pause',
      seeds: ['1', '2', '3'],
    },
  ]
  return { canaries, scenarios }
}

function providers() {
  const world = async () => harness.world
  const spendLimit = 'Compute provider error 8: Workspace swarms-gw has exceeded its spend limit. Raise it in the workspace settings to start new sandboxes.'
  const capacity = '{"code":"unavailable","detail":"Modal has no capacity for an H200 in any region right now."}'

  async function outage(random: Rng, fail: Fail) {
    const { id } = await import('../run.ts')
    const Store = await import('../../src/worker/Store.ts')
    const L = limits.provider
    const hard = random.chance(0.5)
    const text = hard ? spendLimit : capacity
    const fails = hard ? 1 : L.repeats
    let up = false
    let probes = 0
    let seq = 0
    let events: unknown[] = []
    let report: Record<string, unknown> = { request_id: 'agt_1:1', status: 'running' }
    const w = (await world())((request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '5', left: '5', spent: '0' })
      if (url.pathname === '/v1/agents/agt_1/events' && url.searchParams.get('live') !== '1') {
        const page = events
        events = []
        return Response.json({ events: page, has_more: false, next_cursor: seq })
      }
      if (url.pathname.startsWith('/v1/agents/agt_1/turns/agt_1:')) return Response.json(report)
      if (url.pathname === '/v1/compute/create' && request.method === 'POST') {
        probes += 1
        return up
          ? Response.json({ provider: 'modal', sandboxId: 'sb-probe' })
          : Response.json({ code: 'upstream_failed', detail: spendLimit }, { status: 502 })
      }
      if (url.pathname === '/v1/compute/terminate') return Response.json({ ok: true })
      return undefined
    })
    const turns = () => w.calls.filter((call) => call === 'POST /v1/agents/agt_1/turns').length
    try {
      await w.seed('5000000')
      await w.swarm.wake('money')
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('provider pause', 'the turn did not start: ' + w.swarm.run().state)
      const before = random.int(0, L.repeats - 1)
      for (let i = 0; i < before; i++)
        events.push({
          created_at: Date.now(),
          event: { event: { payload: { result: 'ok', status: 'completed', tool: 'mcp__gateway__compute_status' }, type: 'tool.result' }, source: 'agent' },
          request_id: 'agt_1:1',
          seq: ++seq,
        })
      for (let i = 0; i < fails; i++)
        events.push({
          created_at: Date.now(),
          event: {
            event: { payload: { result: [{ text, type: 'text' }], status: 'failed', tool: 'mcp__gateway__compute_create' }, type: 'tool.result' },
            source: 'agent',
          },
          request_id: 'agt_1:1',
          seq: ++seq,
        })
      w.swarm.checked = 0
      for (let ring = 0; ring < L.ringsMost && w.swarm.run().state === 'working'; ring++) {
        w.pass(random.int(L.pollMs, 2 * L.pollMs))
        await w.ring()
      }
      const paused = w.swarm.run()
      const pause = paused.state === 'paused' ? paused.pause : undefined
      const down = Phase.outaged(pause)
      if (!down || down.name !== 'modal' || down.spent !== hard)
        fail('provider pause', (hard ? 'a spend-limit failure' : fails + ' identical capacity failures') + ' left ' + JSON.stringify(paused))
      const said = pause ? Phase.reason(pause) : ''
      if (hard && said !== "Waiting on Modal: the gateway's GPU provider account is over its spend limit. It tries again by itself.")
        fail('provider pause', 'the pause said ' + JSON.stringify(said))
      const row = await Store.find(w.env, id)
      const seen = JSON.stringify([row?.status, row?.why, row ? Store.summary(row).waiting : undefined])
      if (down && seen !== JSON.stringify(['paused', 'provider', 'modal'])) fail('provider pause', 'D1 read the wait as ' + seen)
      report = { request_id: 'agt_1:1', status: 'completed' }
      const started = turns()
      const rounds = random.int(1, L.roundsMost)
      for (let round = 0; round < rounds; round++) {
        w.pass(L.mostMinutes * limits.pause.minute)
        await w.ring()
        await w.ring()
      }
      if (turns() !== started)
        fail('provider spend', 'the swarm started ' + (turns() - started) + ' turns over ' + rounds + ' rounds while its provider was down')
      if (down && probes < rounds) fail('provider spend', 'it probed ' + probes + ' times over ' + rounds + ' rounds')
      const held = w.swarm.run()
      if (down && (held.state !== 'paused' || !Phase.outaged(held.pause)))
        fail('provider pause', 'with the provider still down it left ' + JSON.stringify(held))
      up = true
      for (let ring = 0; ring < L.ringsMost && turns() === started; ring++) {
        w.pass(L.mostMinutes * limits.pause.minute)
        await w.ring()
      }
      if (down && turns() === started) fail('provider resume', 'after the provider came back the swarm stayed ' + JSON.stringify(w.swarm.run()))
      if (w.swarm.kv.get('provider') !== undefined) fail('provider resume', 'the outage was kept: ' + JSON.stringify(w.swarm.kv.get('provider')))
      return 4
    } finally {
      w.restore()
    }
  }

  async function stall(random: Rng, fail: Fail) {
    const { id } = await import('../run.ts')
    const Store = await import('../../src/worker/Store.ts')
    const L = limits.provider
    const failure = "The gateway failed: Error. Retry; if it repeats, send POST /v1/feedback with this response's cf-ray (none)."
    let up = false
    const w = (await world())((request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '5', left: '5', spent: '0' })
      if (url.pathname === '/v1/agents/agt_1/turns' && request.method === 'POST' && !up)
        return Response.json({ code: 'internal_error', detail: failure }, { status: random.pick([500, 502, 503]) })
      return undefined
    })
    const turns = () => w.calls.filter((call) => call === 'POST /v1/agents/agt_1/turns').length
    try {
      await w.seed('5000000')
      await w.swarm.wake('money')
      await w.ring()
      for (let ring = 0; ring < L.ringsMost && w.swarm.run().state !== 'paused'; ring++) {
        w.pass(random.int(L.retryMinutes, 2 * L.retryMinutes) * limits.pause.minute)
        await w.ring()
      }
      const paused = w.swarm.run()
      const pause = paused.state === 'paused' ? paused.pause : undefined
      const down = Phase.outaged(pause)
      if (!down || down.name !== 'gateway' || turns() > L.repeats)
        fail('gateway pause', turns() + ' prompts the gateway refused with a 5xx left ' + JSON.stringify(paused))
      const said = pause ? Phase.reason(pause) : ''
      if (down && said !== "Waiting on the gateway: it keeps failing to take the agent's next message. It tries again by itself.")
        fail('gateway pause', 'the pause said ' + JSON.stringify(said))
      const row = await Store.find(w.env, id)
      const seen = JSON.stringify([row?.why, row ? Store.summary(row).waiting : undefined])
      if (down && seen !== JSON.stringify(['provider', 'gateway'])) fail('gateway pause', 'D1 read the wait as ' + seen)
      const tried = turns()
      const rounds = random.int(1, L.roundsMost)
      for (let round = 0; round < rounds; round++) {
        w.pass(L.mostMinutes * limits.pause.minute)
        await w.ring()
        await w.ring()
      }
      if (down && turns() - tried > rounds) fail('gateway spend', 'it prompted ' + (turns() - tried) + ' times over ' + rounds + ' rounds of backoff')
      const held = w.swarm.run()
      if (down && (held.state !== 'paused' || Phase.outaged(held.pause)?.name !== 'gateway'))
        fail('gateway pause', 'with the gateway still failing it left ' + JSON.stringify(held))
      up = true
      const before = turns()
      for (let ring = 0; ring < L.ringsMost && w.swarm.run().state !== 'working'; ring++) {
        w.pass(L.mostMinutes * limits.pause.minute)
        await w.ring()
      }
      if (down && (turns() === before || w.swarm.run().state !== 'working'))
        fail('gateway resume', 'after the gateway came back the swarm stayed ' + JSON.stringify(w.swarm.run()))
      if (w.swarm.kv.get('gateway') !== undefined) fail('gateway resume', 'the stall was kept: ' + JSON.stringify(w.swarm.kv.get('gateway')))
      return 4
    } finally {
      w.restore()
    }
  }

  const scenarios = { 'mf-run.provider': scenario('mf-run.provider', [outage]), 'mf-run.gateway-stall': scenario('mf-run.gateway-stall', [stall]) }

  const canaries = [
    {
      flip: () => {
        Provider.guards.pause = false
        return () => void (Provider.guards.pause = true)
      },
      invariant: 'provider pause',
      name: 'mf-run.provider.keep',
      scenario: 'mf-run.provider',
      seeds: ['1', '2', '3', '4'],
    },
    {
      flip: () => {
        Provider.guards.gateway = false
        return () => void (Provider.guards.gateway = true)
      },
      invariant: 'gateway pause',
      name: 'mf-run.gateway-stall.retry',
      scenario: 'mf-run.gateway-stall',
      seeds: ['1', '2', '3', '4'],
    },
  ]
  return { canaries, scenarios }
}

const parts = [gateway(), failures(), money(), pauses(), providers()]

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = Object.assign({}, ...parts.map((part) => part.scenarios))

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = parts
  .flatMap((part) => part.canaries)
  .map((canary) => ({
    ...canary,
    flip: () => {
      pending = canary.flip
      return () => void (pending = undefined)
    },
  }))
