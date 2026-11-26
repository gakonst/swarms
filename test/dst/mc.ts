import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Board } from 'nanocode-ts'
import { Sql } from 'nanocode-ts/node'
import type { Reaction, Said } from '../../src/shared/Api.ts'
import * as Standing from '../../src/shared/Status.ts'
import { reasons } from '../../src/shared/Status.ts'
import { redact } from '../../src/shared/Trail.ts'
import * as Cursor from '../../src/worker/machines/Cursor.ts'
import * as Run from '../../src/worker/machines/Run.ts'
import * as Phase from '../../src/worker/Phase.ts'
import * as Store from '../../src/worker/Store.ts'
import * as Work from '../../src/worker/Work.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  archived: { checks: 400 },
  lifecycle: { events: 9, overlap: 3, rings: 3, waitRounds: 2000 },
  outbox: { steps: 400, unpostedTwins: false },
  phase: { checks: 3000, moneyMost: 10_000_000, nMost: 3 },
  work: {
    actors: 3,
    backoffs: [50, 100, 250],
    caps: 3,
    deadlineMs: 400,
    leaseMs: [50, 120, 400],
    leaseSteps: 80,
    lives: 3,
    locks: 4,
    maxAttempts: 4,
    onceSteps: 12,
    opens: 3,
    serialMost: 5,
    steerKeys: 5,
    steerSteps: 30,
    tasks: 4,
    waitMs: 40,
    workMaxMs: 500,
  },
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

function canon(value: unknown): string {
  if (typeof value === 'bigint') return value.toString() + 'n'
  if (Array.isArray(value)) return '[' + value.map(canon).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .sort()
        .map((key) => key + ':' + canon((value as Record<string, unknown>)[key]))
        .join(',') +
      '}'
    )
  return JSON.stringify(value) ?? 'undefined'
}

const states: readonly Phase.State[] = ['new', 'waiting', 'starting', 'working', 'paused']

const allowed: Record<Phase.State, readonly Phase.State[]> = {
  new: ['waiting', 'starting', 'paused'],
  paused: ['paused', 'waiting'],
  starting: ['starting', 'working', 'waiting'],
  waiting: ['waiting', 'starting', 'paused'],
  working: ['working', 'waiting', 'paused'],
}

const sentences = {
  broke: 'Out of money. Ride it to keep it going.',
  refused: 'Its last step could not be paid for, though it has money. It tries again by itself.',
  unfunded: 'Nobody is riding it yet.',
}

const whys = ['unfunded', 'money', 'costly', 'rest', 'idle'] as const

function dollarsSpec(atomics: bigint) {
  const cents = Number(atomics) / 10_000
  return cents >= 10 ? '$' + (Math.round(cents) / 100).toFixed(2) : '$' + String(Number((cents / 100).toPrecision(2)))
}

function shortSpec(pause: Extract<Phase.Pause, { why: 'money' }>) {
  const has = BigInt(pause.remaining ?? pause.left)
  if (pause.needs === undefined || has <= 0n) return sentences.broke
  if (has < BigInt(pause.needs))
    return (
      'Needs more money: it has ' +
      dollarsSpec(has) +
      ' left, and its next step can cost up to ' +
      dollarsSpec(BigInt(pause.needs)) +
      '. Ride it to keep it going.'
    )
  const left = BigInt(pause.left) > 0n ? BigInt(pause.left) : 0n
  return (
    'Capped by approvals: it still has ' +
    dollarsSpec(has) +
    ", but its riders' approvals at the gateway let it spend only " +
    dollarsSpec(left) +
    ' now, and its next step can cost up to ' +
    dollarsSpec(BigInt(pause.needs)) +
    '. A rider raising their approval or a new ride wakes it.'
  )
}

function refusedSpec(pause: Phase.Pause) {
  return pause.why === 'money' && pause.needs !== undefined && BigInt(pause.left) >= BigInt(pause.needs)
}

function wokenSpec(run: Phase.Run) {
  if (run.state !== 'paused' || run.pause.why !== 'money') return Infinity
  if (run.pause.wake !== null) return Math.min(run.pause.wake, run.at + Phase.maxPatienceMs)
  return refusedSpec(run.pause) ? run.at + Phase.rereadMs : Infinity
}

function pausedSpec(run: Phase.Run) {
  if (run.state === 'paused') return run.pause
  if (run.state === 'waiting') return run.from
  return undefined
}

async function phase(seed: string): Promise<Outcome> {
  const random = rng(seed, 'phase')
  const { fail, violations } = recorder()
  const L = limits.phase
  const amount = () => String(random.int(0, L.moneyMost))
  const pause = (at: number): Phase.Pause => {
    const why = random.pick(whys)
    if (why === 'unfunded') return { why }
    if (why === 'costly') return { wanted: amount(), why }
    if (why === 'rest') return { failures: random.int(1, 9), why }
    if (why === 'idle') return { why }
    const wake = random.chance(0.5) ? null : at + random.int(-Phase.rereadMs, 3 * Phase.maxPatienceMs)
    return {
      left: amount(),
      wake,
      why,
      ...(random.chance(0.5) ? { needs: amount() } : {}),
      ...(random.chance(0.5) ? { balance: amount() } : {}),
      ...(random.chance(0.6) ? { remaining: amount() } : {}),
      ...(random.chance(0.3) ? { sponsor: true as const } : {}),
    }
  }
  const make = (state: Phase.State, at: number): Phase.Run => {
    if (state === 'new') return { state }
    if (state === 'paused')
      return { at, pause: pause(at), state, ...(random.chance(0.6) ? { settled: at + random.int(-Phase.rereadMs, 2 * Phase.rereadMs) } : {}) }
    const since = random.chance(0.4) ? null : at + random.int(0, 1000)
    if (state === 'waiting') return { since, state, until: at, ...(random.chance(0.6) ? { from: pause(at) } : {}) }
    const again = random.chance(0.3) ? { again: random.chance(0.5) } : {}
    if (state === 'starting') return { id: 'a:' + at, n: random.int(1, 9), since, state, told: [], ...again }
    return { from: 0, n: random.int(1, 9), since: since ?? at, started: at, state, turn: 't' + at, ...again }
  }
  let steps = 0
  for (; steps < L.checks; steps++) {
    const from = random.pick(states)
    const to = random.pick(states)
    const legal = allowed[from].includes(to)
    if (Phase.can(from, to) !== legal) fail('transition', from + ' -> ' + to + ' should be ' + (legal ? 'allowed' : 'refused'))
    let threw = ''
    try {
      Phase.check(from, to)
    } catch (error) {
      threw = String(error)
    }
    if (legal ? threw !== '' : !threw.includes('cannot go from ' + from + ' to ' + to))
      fail('transition', 'check ' + from + ' -> ' + to + ' threw ' + JSON.stringify(threw))
    const at = random.int(0, 10) * Phase.rereadMs
    const run = make(random.pick(states), at)
    const woken = wokenSpec(run)
    const settled = run.state === 'paused' ? run.settled : undefined
    const now = random.pick([
      at + random.int(0, 2 * Phase.maxPatienceMs),
      Number.isFinite(woken) ? woken : at,
      Number.isFinite(woken) ? woken - 1 : at + 1,
      settled === undefined ? at : settled + Phase.rereadMs,
      settled === undefined ? at : settled + Phase.rereadMs - 1,
    ])
    const shown = canon(run) + ' at ' + now
    if (Phase.due(run, now) !== woken <= now) fail('wake', 'due ' + shown + ' should be ' + (woken <= now))
    const waking = Number.isFinite(woken) && woken > now ? woken : null
    if (Phase.waking(run, now) !== waking) fail('wake', 'waking ' + shown + ' was ' + Phase.waking(run, now) + ', not ' + waking)
    if (run.state === 'paused') {
      const unread = run.settled === undefined || now - run.settled >= Phase.rereadMs || (woken <= now && run.settled < woken)
      if (Phase.unread(run, now) !== unread) fail('unread', shown + ' should be ' + (unread ? 'read again' : 'left'))
    }
    const reason = random.pick(['money', 'note'] as const)
    const one = pause(at)
    const stale = one.why === 'idle' || one.why === 'rest' || one.why === 'costly'
    if (Phase.wakes(one, reason) !== (reason === 'money' || stale)) fail('wakes', canon(one) + ' on ' + reason)
    if (Phase.stale(one.why) !== stale || Phase.stale(null) || Phase.stale(undefined)) fail('wakes', 'stale ' + one.why)
    const sentence =
      one.why === 'unfunded'
        ? sentences.unfunded
        : refusedSpec(one)
          ? one.why === 'money' && one.sponsor
            ? reasons.sponsor
            : sentences.refused
          : one.why === 'money'
            ? shortSpec(one)
            : sentences.broke
    if (Phase.reason(one) !== sentence) fail('reason', canon(one) + ' said ' + JSON.stringify(Phase.reason(one)))
    if (one.why === 'money') {
      const { remaining: _dropped, ...older } = one
      const needs = BigInt(random.int(1, L.moneyMost))
      const spent = BigInt(random.int(0, L.moneyMost))
      const has = random.pick([0n, BigInt(random.int(1, Number(needs))), needs + BigInt(random.int(0, L.moneyMost)), -BigInt(random.int(1, 9))])
      const row = { balance: Number(spent + has), setup: random.chance(0.2) ? null : JSON.stringify({ most: String(needs) }), spent: Number(spent) }
      const live = row.setup === null ? Store.reserveOf(row) : needs
      const before = Phase.reason(older)
      const told = Store.reasoned(row, before)
      const expected =
        before !== sentences.broke || has <= 0n
          ? before
          : has < live
            ? shortSpec({ left: String(has), needs: String(live), remaining: String(has), wake: null, why: 'money' })
            : 'Capped by approvals: it still has ' +
              dollarsSpec(has) +
              ", but its riders' approvals at the gateway let it spend less than its next step can cost, up to " +
              dollarsSpec(live) +
              '. A rider raising their approval or a new ride wakes it.'
      if (told !== expected) fail('older pause', canon(older) + ' with ' + has + ' left of ' + live + ' said ' + JSON.stringify(told))
      if (has > 0n && Standing.starved(before) && told === sentences.broke) fail('older pause', canon(older) + ' still said out of money with ' + has + ' left')
    }
    const money = {
      balance: BigInt(amount()),
      left: BigInt(amount()),
      reserve: BigInt(amount()),
      ...(random.chance(0.3) ? { due: random.chance(0.5) } : {}),
    }
    if (one.why === 'money' && one.balance !== undefined && random.chance(0.3)) money.balance = BigInt(one.balance) + BigInt(random.int(0, 1))
    if (random.chance(0.2)) money.left = money.reserve + BigInt(random.int(-1, 0))
    const resumes =
      money.left >= money.reserve &&
      (!refusedSpec(one) || money.due === true || (one.why === 'money' && one.balance !== undefined && money.balance > BigInt(one.balance)))
    if (Phase.resumes(one, money) !== resumes) fail('resumes', canon(one) + ' with ' + canon(money) + ' should ' + (resumes ? '' : 'not ') + 'resume')
    const other = random.chance(0.5) ? { ...one } : pause(at)
    if (other.why === 'money' && random.chance(0.5)) other.left = amount()
    const same = one.why === other.why && (one.why !== 'money' || other.why !== 'money' || !one.sponsor === !other.sponsor)
    if (Phase.same(one, other) !== same) fail('same', canon(one) + ' vs ' + canon(other))
    const n = random.int(0, L.nMost)
    const stuck = random.chance(0.5)
    const held = pausedSpec(run)
    const projected = held
      ? { status: n ? 'paused' : 'funding', why: held.why }
      : run.state === 'new' || (run.state === 'waiting' && n === 0)
        ? { status: 'funding', why: null }
        : { status: 'running', why: stuck ? 'stuck' : null }
    if (canon(Phase.project(run, n, stuck)) !== canon(projected))
      fail('project', shown + ' n=' + n + ' stuck=' + stuck + ' gave ' + canon(Phase.project(run, n, stuck)))
    const sponsor = random.chance(0.5)
    const waits = held ? (held.why === 'money' && held.sponsor ? 'tempo' : null) : stuck && sponsor ? 'tempo' : null
    if (Phase.waiting(run, stuck, sponsor) !== waits) fail('waiting', shown + ' stuck=' + stuck + ' sponsor=' + sponsor)
    const again =
      run.state === 'starting' || run.state === 'working' ? run.again === true : run.state === 'waiting' && run.from !== undefined && refusedSpec(run.from)
    if (Phase.again(run) !== again) fail('again', shown)
    const old = migration(random, n, now)
    const got = Phase.migrated({ get: <T>(key: string) => old.kv[key] as T | undefined }, n, now)
    if (canon(got) !== canon(old.run)) fail('migrated', canon(old.kv) + ' became ' + canon(got) + ', not ' + canon(old.run))
  }
  return { steps, violations }
}

function migration(random: Rng, n: number, now: number): { kv: Record<string, unknown>; run: Phase.Run } {
  const kind = random.int(0, 6)
  const since = random.chance(0.5) ? random.int(1, 99) : undefined
  if (kind === 0) {
    const started = random.chance(0.5) ? random.int(1, 99) : undefined
    const wanted = random.chance(0.5) ? String(random.int(1, 999)) : undefined
    return {
      kv: { since, started, turn: 'r' + n, wanted },
      run: { from: 0, n, since: since ?? started ?? now, started: started ?? now, state: 'working', turn: 'r' + n, ...(wanted ? { wanted } : {}) },
    }
  }
  if (kind === 1) {
    const agent = random.chance(0.5) ? 'agt' : undefined
    return { kv: { agent, since }, run: !n && !agent ? { state: 'new' } : { since: since ?? null, state: 'waiting', until: now } }
  }
  const flag = random.pick([{ paused: 'Paused' }, { refunded: true }, { refundAt: random.int(0, 9) }])
  if (kind === 2) {
    const micro = random.int(0, 99_999_999)
    const left = random.pick([(micro / 1e6).toFixed(6), String(Math.floor(micro / 1e6)), undefined, 'lots'])
    const units = left === undefined || left === 'lots' ? '0' : left.includes('.') ? String(micro) : String(Math.floor(micro / 1e6) * 1e6)
    return {
      kv: { ...flag, left, why: random.pick(['money', 'idle', undefined]) },
      run: { from: { left: units, wake: null, why: 'money' }, since: null, state: 'waiting', until: now },
    }
  }
  if (kind === 3) {
    const failures = random.int(1, 99)
    const counted = random.chance(0.7)
    return {
      kv: { paused: counted ? 'Stopped after ' + failures + ' errors in a row.' : 'Stopped.', why: 'rest' },
      run: { at: now, pause: { failures: counted ? failures : 3, why: 'rest' }, state: 'paused' },
    }
  }
  if (kind === 4) {
    const cents = random.int(1, 9999)
    const wanted = random.chance(0.3) ? String(random.int(1, 999)) : undefined
    return {
      kv: { paused: 'Paused: its next step needs about $' + (cents / 100).toFixed(2) + ' at once', wanted, why: 'costly' },
      run: { at: now, pause: { wanted: wanted ?? String(cents * 10_000), why: 'costly' }, state: 'paused' },
    }
  }
  if (kind === 5) return { kv: { ...flag, why: 'unfunded' }, run: { at: now, pause: { why: 'unfunded' }, state: 'paused' } }
  return { kv: { agent: 'agt', since, why: 'money' }, run: { since: since ?? null, state: 'waiting', until: now } }
}

const me = '0x00000000000000000000000000000000000000aa'

const others = ['0x00000000000000000000000000000000000000bb', '0x00000000000000000000000000000000000000cc'] as const

const words = [' hello ', 'hello', 'same', 'same', 'yo', 'my key sk-tempo-abcdefghijkl'] as const

const refusal = 'At most 10 messages a minute in a room; wait a moment.'

type State = 'sending' | 'queued' | 'failed' | 'sent'

type Shown = Said & { client?: string; error?: string; sending?: Exclude<State, 'sent'> }

type Draft = { client: string; error?: string; parent?: number; state: State; text: string }

type Outboxes = {
  define(kind: string, sender: (draft: Draft) => Promise<Said>): void
  draft(client: string): Draft | undefined
  fly(swarm: string, message: number, emoji: string, me: string, on: boolean): () => void
  forget(client: string): void
  held(swarm: string, message: number, list: readonly Reaction[] | undefined): Reaction[]
  key(message: Shown): string
  list(place: string): readonly Draft[]
  reset(): void
  resume(): void
  retry(client: string): void
  send(place: string, input: { after: number; author: string; parent?: number; text: string }): string
  shown(place: string, messages: readonly Said[], list: readonly Draft[]): { landed: string[]; shown: Shown[] }
}

const outboxPath = '../../src/web/outbox.ts'

type Answer = 'ok' | 'refuse' | 'offline' | 'hang'

type Mine = { after: number; error?: string; forgotten: boolean; message?: number; parent?: number; sent?: number; state: State; text: string }

function realTick() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

async function outbox(seed: string): Promise<Outcome> {
  const Outbox = (await import(outboxPath)) as Outboxes
  const random = rng(seed, 'outbox')
  const { fail, violations } = recorder()
  const L = limits.outbox
  const uuid = crypto.randomUUID.bind(crypto)
  let ids = 0
  crypto.randomUUID = () => ('00000000-0000-4000-a000-' + String(++ids).padStart(12, '0')) as ReturnType<typeof crypto.randomUUID>
  Outbox.reset()
  const place = 'room:' + createHash('sha256').update(seed).digest('hex').slice(0, 12)
  const swarm = place.slice(5)
  const log: Said[] = []
  let seen = 0
  const late = new Set<number>()
  const mine = new Map<string, Mine>()
  const calls: { answer: Answer; client: string; reject: (error: unknown) => void; resolve: (said: Said) => void; said?: Said }[] = []
  const keyed = new Map<number, string>()
  const flights = new Map<string, { land: () => void; on: boolean; turn: number }>()
  const landings: { key: string; land: () => void; turn: number }[] = []
  let turns = 0
  const variant = () => (random.chance(0.5) ? me : me.toUpperCase().replace('0X', '0x'))
  const post = (author: string, text: string, parent?: number): Said => {
    const said: Said = {
      artifact: null,
      at: log.length + 1,
      author: author as Said['author'],
      id: log.length + 1,
      mentions: [],
      steer: null,
      text: redact(text.trim()),
      ...(parent !== undefined ? { parent } : {}),
    }
    log.push(said)
    return said
  }
  Outbox.define(
    'room',
    (draft) =>
      new Promise<Said>((resolve, reject) => {
        const answer = random.pick(['ok', 'ok', 'refuse', 'offline', 'hang'] as const)
        const said = answer === 'ok' || (answer === 'hang' && random.chance(0.5)) ? post(variant(), draft.text, draft.parent) : undefined
        const entry = mine.get(draft.client)
        const alone =
          !entry ||
          ![...mine.values()].some(
            (other) => other !== entry && !other.forgotten && other.parent === entry.parent && redact(other.text.trim()) === redact(entry.text.trim()),
          )
        if (said && random.chance(0.3) && (limits.outbox.unpostedTwins || alone)) late.add(said.id)
        if (entry && said) entry.sent = said.id
        calls.push({ answer, client: draft.client, reject, resolve, ...(said ? { said } : {}) })
      }),
  )
  const visible = () => log.slice(0, seen).filter((said) => !late.has(said.id))
  const shows = (id: number | undefined) => id !== undefined && id <= seen && !late.has(id)
  const check = (step: number) => {
    const shown = Outbox.shown(place, visible(), Outbox.list(place))
    const list = shown.shown
    const keys = list.map(Outbox.key)
    if (new Set(keys).size !== keys.length) fail('one copy', 'step ' + step + ' keys ' + keys.join(','))
    const real = list.filter((each) => !each.sending)
    if (new Set(real.map((each) => each.id)).size !== real.length) fail('one copy', 'step ' + step + ' ids ' + real.map((each) => each.id).join(','))
    const firstPending = list.findIndex((each) => each.sending)
    if (firstPending >= 0 && list.slice(firstPending).some((each) => !each.sending)) fail('pending last', 'step ' + step)
    if (real.some((each, i) => i > 0 && (real[i - 1] as Said).id >= each.id)) fail('order', 'step ' + step + ' ids ' + real.map((each) => each.id).join(','))
    for (const said of visible())
      if (real.filter((each) => each.id === said.id).length !== 1) fail('one copy', 'message ' + said.id + ' not shown once at step ' + step)
    for (const each of real) {
      const was = keyed.get(each.id)
      if (each.client && was && was !== each.client) fail('key stable', 'message ' + each.id + ' moved from c' + was + ' to c' + each.client)
      if (was && !each.client) fail('key stable', 'message ' + each.id + ' lost its key c' + was)
      if (each.client) keyed.set(each.id, each.client)
    }
    for (const [client, entry] of mine) {
      const draft = Outbox.draft(client)
      if (entry.forgotten) {
        if (draft) fail('forgotten', 'draft ' + client + ' is back as ' + draft.state)
        continue
      }
      if (!draft || draft.state !== entry.state) fail('state', 'draft ' + client + ' is ' + draft?.state + ', not ' + entry.state)
      if ((draft?.error ?? undefined) !== entry.error) fail('state', 'draft ' + client + ' error ' + draft?.error + ', not ' + entry.error)
      const at = list.filter((each) => each.client === client)
      if (at.length !== 1) {
        fail('one copy', 'draft ' + client + ' shown ' + at.length + ' times at step ' + step)
        continue
      }
      const one = at[0] as Shown
      const landed = shown.landed.includes(client)
      const inLog = !one.sending && visible().some((said) => said.id === one.id)
      if (landed !== inLog) fail('landed', 'draft ' + client + ' landed=' + landed + ' but its echo is ' + (inLog ? '' : 'not ') + 'in view')
      if (shows(entry.sent) && one.sending) fail('landed', 'draft ' + client + ' still shows ' + one.sending + ' though its echo ' + entry.sent + ' is in view')
      if (entry.message !== undefined && one.id !== entry.message) fail('answered', 'draft ' + client + ' answered as ' + entry.message + ' shows ' + one.id)
      if (one.sending) {
        const want = entry.state === 'sent' ? 'answered' : entry.state
        if (one.sending !== want) fail('state', 'draft ' + client + ' shows ' + one.sending + ', not ' + want)
        if (one.text !== entry.text.trim()) fail('state', 'draft ' + client + ' shows ' + JSON.stringify(one.text))
        if ((one.error ?? undefined) !== entry.error) fail('state', 'draft ' + client + ' shows error ' + one.error)
      } else {
        const author = (one.author ?? '').toLowerCase()
        const text = entry.text.trim()
        const fits = author === me && (one.text === text || one.text === redact(text)) && (one.parent ?? undefined) === entry.parent && one.id > entry.after
        if (!fits) fail('mine', 'draft ' + client + ' ' + JSON.stringify(entry.text) + ' claimed ' + canon(one))
      }
    }
    for (const message of [4, 5, 44]) {
      const server: Reaction[] = []
      for (const emoji of ['👍', '🎉']) {
        const who = [...others, me]
          .filter(() => random.chance(0.5))
          .map((address) => (address === me ? (variant() as Reaction['who'][number]) : (address as Reaction['who'][number])))
        if (who.length) server.push({ emoji, who })
      }
      const got = Outbox.held(swarm, message, server)
      for (const emoji of ['👍', '🎉']) {
        const base = new Set((server.find((each) => each.emoji === emoji)?.who ?? []).map((address) => address.toLowerCase()))
        const flight = flights.get(message + ':' + emoji)
        if (flight) {
          base.delete(me)
          if (flight.on) base.add(me)
        }
        const found = got.filter((each) => each.emoji === emoji)
        const have = new Set((found[0]?.who ?? []).map((address) => address.toLowerCase()))
        if (found.length > 1 || (found[0] && found[0].who.length === 0) || canon([...have].sort()) !== canon([...base].sort()))
          fail('reaction', 'message ' + message + ' ' + emoji + ' shows ' + canon(found) + ' over ' + canon(server) + ' with ' + canon(flight ?? null))
      }
    }
  }
  try {
    let steps = 0
    for (; steps < L.steps; steps++) {
      const roll = random.int(0, 11)
      if (roll <= 2) {
        const parent = random.chance(0.15) ? 9 : undefined
        const picked = random.pick(words)
        const twin = [...mine.values()].some(
          (entry) =>
            !entry.forgotten &&
            (entry.sent === undefined || late.has(entry.sent)) &&
            entry.parent === parent &&
            redact(entry.text.trim()) === redact(picked.trim()),
        )
        const text = twin && !limits.outbox.unpostedTwins ? 'note ' + steps : picked
        const after = visible().at(-1)?.id ?? 0
        const before = ids + 1
        mine.set('00000000-0000-4000-a000-' + String(before).padStart(12, '0'), {
          after,
          forgotten: false,
          state: 'sending',
          text,
          ...(parent !== undefined ? { parent } : {}),
        })
        Outbox.send(place, { after, author: variant(), text, ...(parent !== undefined ? { parent } : {}) })
      } else if (roll === 3) post(random.pick(others), random.pick(words), random.chance(0.3) ? 9 : undefined)
      else if (roll === 4) post(variant(), random.pick(words), 11)
      else if (roll === 5) {
        seen = random.int(seen, log.length)
        for (const id of late) if (random.chance(0.5)) late.delete(id)
      } else if (roll === 6 && calls.length) {
        const call = calls.splice(random.int(0, calls.length - 1), 1)[0] as (typeof calls)[number]
        const entry = mine.get(call.client) as Mine
        if (call.answer === 'hang') calls.push(call)
        else {
          if (call.answer === 'ok') call.resolve(call.said as Said)
          else if (call.answer === 'refuse') call.reject(new Error(refusal))
          else call.reject(new TypeError('Failed to fetch'))
          await realTick()
          if (!entry.forgotten) {
            if (call.answer === 'ok') {
              entry.state = 'sent'
              entry.message = (call.said as Said).id
            } else if (call.answer === 'refuse') {
              entry.state = 'failed'
              entry.error = refusal
            } else entry.state = 'queued'
          }
        }
      } else if (roll === 7) {
        const stuck = [...mine].filter(([, entry]) => !entry.forgotten && (entry.state === 'failed' || entry.state === 'queued'))
        if (stuck.length) {
          const [client, entry] = random.pick(stuck)
          entry.state = 'sending'
          delete entry.error
          Outbox.retry(client)
        }
      } else if (roll === 8) {
        const twins = (entry: Mine) =>
          [...mine.values()].some(
            (other) =>
              other !== entry &&
              !other.forgotten &&
              other.parent === entry.parent &&
              redact(other.text.trim()) === redact(entry.text.trim()) &&
              other.after < (entry.sent ?? 0),
          )
        const live = [...mine].filter(
          ([, entry]) => !entry.forgotten && (entry.sent === undefined || shows(entry.sent)) && (limits.outbox.unpostedTwins || !twins(entry)),
        )
        if (live.length && random.chance(0.4)) {
          const [client, entry] = random.pick(live)
          entry.forgotten = true
          Outbox.forget(client)
        }
      } else if (roll === 9) {
        const message = random.pick([4, 5, 44])
        const emoji = random.pick(['👍', '🎉'])
        const on = random.chance(0.5)
        const land = Outbox.fly(swarm, message, emoji, variant(), on)
        const turn = ++turns
        flights.set(message + ':' + emoji, { land, on, turn })
        landings.push({ key: message + ':' + emoji, land, turn })
      } else if (roll === 10 && landings.length) {
        const landing = landings.splice(random.int(0, landings.length - 1), 1)[0] as (typeof landings)[number]
        landing.land()
        if (flights.get(landing.key)?.turn === landing.turn) flights.delete(landing.key)
      } else if (roll === 11) {
        for (const [, entry] of mine) if (!entry.forgotten && entry.state === 'queued') entry.state = 'sending'
        Outbox.resume()
      }
      check(steps)
    }
    return { steps, violations }
  } finally {
    Outbox.reset()
    crypto.randomUUID = uuid
  }
}

type Timer = { at: number; fn: () => void; live: boolean; seq: number }

class Clock {
  now: number
  seq = 0
  timers: Timer[] = []
  constructor(now: number) {
    this.now = now
  }
  add(fn: () => void, ms: unknown) {
    const timer = { at: this.now + Math.max(0, Number(ms) || 0), fn, live: true, seq: ++this.seq }
    this.timers.push(timer)
    return timer
  }
  next() {
    this.timers = this.timers.filter((timer) => timer.live)
    let best: Timer | undefined
    for (const timer of this.timers) if (!best || timer.at < best.at || (timer.at === best.at && timer.seq < best.seq)) best = timer
    return best
  }
}

const virtualStart = Date.UTC(2027, 0, 4, 9)

function install(clock: Clock) {
  const g = globalThis as Record<string, unknown>
  const saved = {
    clearInterval: g['clearInterval'],
    clearTimeout: g['clearTimeout'],
    Date: g['Date'],
    setInterval: g['setInterval'],
    setTimeout: g['setTimeout'],
  }
  const RealDate = Date
  const stop = (handle: unknown) => {
    if (handle && typeof handle === 'object' && 'live' in handle) (handle as Timer).live = false
  }
  g['setTimeout'] = (fn: () => void, ms?: number) => clock.add(fn, ms)
  g['clearTimeout'] = stop
  g['setInterval'] = (fn: () => void, ms?: number) => {
    const every = Math.max(1, Number(ms) || 1)
    const handle = { at: 0, fn, live: true, seq: 0 }
    const tick = () => {
      if (!handle.live) return
      clock.add(tick, every)
      fn()
    }
    clock.add(tick, every)
    return handle
  }
  g['clearInterval'] = stop
  class SimDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(clock.now)
      else super(...(args as [number]))
    }
    static override now() {
      return clock.now
    }
  }
  g['Date'] = SimDate
  return () => Object.assign(g, saved)
}

async function drain() {
  for (let i = 0; i < 4; i++) await realTick()
}

async function settle<T>(clock: Clock, promise: Promise<T>): Promise<T> {
  let done = false
  const watched = promise.finally(() => void (done = true))
  watched.catch(() => undefined)
  for (;;) {
    await drain()
    if (done) return watched
    const timer = clock.next()
    if (!timer) return watched
    timer.live = false
    clock.now = Math.max(clock.now, timer.at)
    timer.fn()
  }
}

let compiled: Promise<WebAssembly.Module> | undefined

function wasm() {
  return (compiled ??= (WebAssembly as unknown as { compile(bytes: Uint8Array): Promise<WebAssembly.Module> }).compile(
    readFileSync(createRequire(import.meta.url).resolve('nanocode-ts/nanocode_wasm.wasm')),
  ))
}

async function opened(host: ReturnType<typeof Sql.open>, scope: string, actor: string) {
  const module = await wasm()
  return Work.opening(scope, actor, () => Board.open({ actor, module, scope, sql: host }))
}

const grantAll = { can: { '*': ['manage'] }, who: [{ id: 'swarm', kind: 'kind' }] } as never

async function work(seed: string): Promise<Outcome> {
  const random = rng(seed, 'work')
  const { fail, violations } = recorder()
  const L = limits.work
  const clock = new Clock(virtualStart)
  const restore = install(clock)
  const hosts: ReturnType<typeof Sql.open>[] = []
  const host = () => {
    const one = Sql.open(':memory:')
    hosts.push(one)
    return one
  }
  let steps = 0
  const run = <T>(promise: Promise<T>) => settle(clock, promise)
  try {
    const leaseHost = host()
    const actors: Work.Board[] = []
    for (let i = 0; i < L.actors; i++) actors.push(await opened(leaseHost, 'swarm:abc', 'swarm:a' + i))
    if (!(await run((actors[0] as Work.Board).grant(grantAll, { key: 'grant-swarms' }))).ok) fail('exclusive', 'the grant to other swarms was refused')
    const tasks = Array.from({ length: L.tasks }, (_, i) => 't' + i)
    for (const id of tasks) await run(Work.ensure(actors[0] as Work.Board, { id, spec: 'turn' }))
    const holders = new Map<string, { actor: number; claim: string; until: number }>()
    const stale: { actor: number; claim: string; id: string }[] = []
    for (let i = 0; i < L.leaseSteps; i++, steps++) {
      if (random.chance(0.4)) clock.now += random.int(0, Math.max(...L.leaseMs) * 2)
      const now = clock.now
      const who = random.int(0, L.actors - 1)
      const board = actors[who] as Work.Board
      const id = random.pick(tasks)
      const leaseMs = random.pick(L.leaseMs)
      await run(board.refresh())
      const holder = holders.get(id)
      const live = (each: { until: number } | undefined) => !!each && each.until > clock.now
      const roll = random.int(0, 3)
      if (roll <= 1) {
        const cap = random.chance(0.4) ? random.int(1, L.caps) : undefined
        const busy = [...holders].filter(([other, each]) => other !== id && live(each)).length
        const got = await run(board.claim(id, { leaseMs, ...(cap !== undefined ? { cap } : {}) }))
        if (holder && holder.until === now) {
          if (got.ok) holders.set(id, { actor: who, claim: got.claim, until: got.untilMs })
          continue
        }
        const full = cap !== undefined && busy >= cap
        if (live(holder)) {
          if (got.ok || (got.rejection.kind !== 'Held' && !(full && got.rejection.kind === 'Full')))
            fail('exclusive', id + ' held by a' + holder?.actor + ' until +' + ((holder?.until ?? 0) - now) + 'ms was ' + canon(got) + ' for a' + who)
        } else if (full) {
          if (got.ok || got.rejection.kind !== 'Full') fail('cap', id + ' claimed past cap ' + cap + ' with ' + busy + ' held: ' + canon(got))
        } else if (!got.ok) fail('exclusive', id + ' free (' + canon(holder ?? null) + ') was refused for a' + who + ': ' + canon(got))
        else {
          if (got.tookOver !== !!holder) fail('exclusive', id + ' took over ' + got.tookOver + ' from ' + canon(holder ?? null))
          if (got.untilMs !== now + leaseMs) fail('renew until', id + ' claimed until +' + (got.untilMs - now) + ', not +' + leaseMs)
        }
        if (got.ok) {
          if (holder) stale.push({ actor: holder.actor, claim: holder.claim, id })
          holders.set(id, { actor: who, claim: got.claim, until: got.untilMs })
        }
      } else if (roll === 2) {
        const old = random.chance(0.4) && stale.length ? random.pick(stale) : undefined
        const mineNow = holder && holder.actor === who ? holder.claim : undefined
        const claim = old?.id === id ? old.claim : (mineNow ?? 'not the claim')
        const verdict = await run(board.renew(id, claim, leaseMs))
        const until = Work.until(verdict)
        if (verdict.ok !== (until !== undefined)) fail('renew until', 'renew of ' + id + ' ok=' + verdict.ok + ' until=' + until)
        if (claim !== holder?.claim || holder.actor !== who) {
          if (verdict.ok) fail('exclusive', 'a' + who + ' renewed ' + id + ' with a claim it does not hold: ' + canon(verdict))
        } else if (live(holder) && !verdict.ok) fail('renew until', 'the holder of ' + id + ' could not renew: ' + canon(verdict))
        if (verdict.ok && holder) {
          if (until !== now + leaseMs) fail('renew until', id + ' renewed until +' + ((until ?? 0) - now) + ', not +' + leaseMs)
          const task = await run(board.task(id))
          if (task?.untilMs !== until) fail('renew until', id + ' says until ' + task?.untilMs + ', the renew ' + until)
          holder.until = until ?? 0
        }
      } else if (holder && holder.actor === who) {
        const released = await run(board.release(id, holder.claim))
        if (released.ok) {
          stale.push({ actor: who, claim: holder.claim, id })
          holders.delete(id)
        } else if (live(holder)) fail('exclusive', 'the holder of ' + id + ' could not release: ' + canon(released))
      }
    }

    for (let attempts = 0; attempts <= 6; attempts++)
      for (const backoffMs of L.backoffs) {
        const want = backoffMs * 2 ** Math.max(0, attempts - 1)
        if (Work.delay({ backoffMs, maxAttempts: L.maxAttempts }, attempts) !== want)
          fail('backoff', 'delay after ' + attempts + ' tries is ' + Work.delay({ backoffMs, maxAttempts: L.maxAttempts }, attempts) + ', not ' + want)
      }
    const retryBoard = await opened(host(), 'swarm:abc', 'swarm:abc')
    const retry = { backoffMs: random.pick(L.backoffs), maxAttempts: random.int(1, L.maxAttempts) }
    await run(Work.ensure(retryBoard, { id: 'r', spec: 'turn', terms: { retry } }))
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++, steps++) {
      const claimed = await run(retryBoard.claim('r', { leaseMs: 1_000 }))
      if (!claimed.ok) {
        fail('backoff', 'try ' + attempt + ' of r could not claim at its due time: ' + canon(claimed))
        break
      }
      const failedAt = clock.now
      await run(retryBoard.finish('r', claimed.claim, { failed: 'no' }))
      const found = await run(retryBoard.task('r'))
      if (attempt === retry.maxAttempts) {
        if (found?.phase !== 'failed' || found.attempts !== retry.maxAttempts)
          fail('backoff', 'after ' + attempt + ' failed tries r is ' + found?.phase + ' with ' + found?.attempts + ' attempts')
        break
      }
      const wait = Work.delay(retry, attempt)
      if (found?.phase !== 'open' || found.dueAtMs !== failedAt + wait)
        fail('backoff', 'try ' + attempt + ' of r is ' + found?.phase + ' due +' + ((found?.dueAtMs ?? 0) - failedAt) + ', not +' + wait)
      clock.now = failedAt + random.int(0, wait - 1)
      const early = await run(retryBoard.ready({ atMs: clock.now }))
      if (early.some((each) => each.id === 'r')) fail('backoff', 'r is ready ' + (failedAt + wait - clock.now) + 'ms before its due time')
      if ((await run(retryBoard.claim('r', { leaseMs: 1_000 }))).ok)
        fail('backoff', 'r was claimed ' + (failedAt + wait - clock.now) + 'ms before its due time')
      clock.now = failedAt + wait
      if (!(await run(retryBoard.ready({ atMs: clock.now }))).some((each) => each.id === 'r')) fail('backoff', 'r is not ready at its due time')
    }

    const steerBoard = await opened(host(), 'swarm:abc', 'swarm:abc')
    await run(Work.ensure(steerBoard, { id: 'notes', labels: Work.instance, spec: 'notes' }))
    const kept: { body: string; key: string }[] = []
    const used = new Set<string>()
    for (let i = 0; i < L.steerSteps; i++, steps++) {
      if (random.chance(0.7) || !kept.length) {
        const key = 'n' + random.int(1, L.steerKeys)
        const body = 'note ' + key + ' ' + i
        const sent = await run(steerBoard.steer('notes', body, { key }))
        if (!sent.ok) fail('steer once', 'steer ' + key + ' was refused: ' + canon(sent))
        if (!used.has(key)) kept.push({ body, key })
        used.add(key)
      } else {
        const steers = await run(steerBoard.steers('notes'))
        const upto = random.int(0, steers.length - 1)
        const held = await run(Work.lock(steerBoard, 'notes', 1_000))
        if (!held.ok) fail('steer once', 'notes could not be locked: ' + canon(held))
        else {
          const heeded = await run(steerBoard.heed('notes', held.claim, (steers[upto] as Work.Steer).seq))
          if (!heeded.ok) fail('steer once', 'heed was refused: ' + canon(heeded))
          else kept.splice(0, upto + 1)
          await run(steerBoard.release('notes', held.claim))
        }
      }
      const bodies = (await run(steerBoard.steers('notes'))).map((each) => each.body)
      if (canon(bodies) !== canon(kept.map((each) => each.body)))
        fail('steer once', 'steers ' + canon(bodies) + ', not ' + canon(kept.map((each) => each.body)))
    }

    const onceBoard = await opened(host(), 'swarm:abc', 'swarm:abc')
    const finished = new Set<string>()
    for (let i = 0; i < L.onceSteps; i++, steps++) {
      const id = 'settle:' + random.int(1, 3)
      const throws = random.chance(0.4)
      let ran = 0
      let answer: unknown
      try {
        answer = await run(
          Work.once(onceBoard, id, 1_000, async () => {
            ran++
            if (throws) throw new Error('down')
            return i
          }),
        )
      } catch (error) {
        answer = { threw: String(error) }
      }
      const want = finished.has(id) ? { ran: false } : throws ? { threw: 'Error: down' } : { ran: true, value: i }
      if (canon(answer) !== canon(want) || ran !== (finished.has(id) ? 0 : 1))
        fail('once', id + ' answered ' + canon(answer) + ' after ' + ran + ' runs, not ' + canon(want))
      if (!throws) finished.add(id)
    }

    const serialBoard = await opened(host(), 'swarm:abc', 'swarm:abc')
    let inside = 0
    const callers = random.int(2, L.serialMost)
    const began = clock.now
    const outcomes = await run(
      Promise.allSettled(
        Array.from({ length: callers }, (_, i) =>
          Work.serial(
            serialBoard,
            'budgeting',
            random.pick(L.leaseMs),
            async () => {
              inside++
              if (inside > 1) fail('serial', 'caller ' + i + ' ran beside ' + (inside - 1) + ' others')
              if (clock.now > began + L.deadlineMs + L.waitMs)
                fail('deadline', 'caller ' + i + ' ran ' + (clock.now - began) + 'ms after it asked, past ' + L.deadlineMs)
              await new Promise((resolve) => setTimeout(resolve, random.int(1, L.workMaxMs)))
              inside--
              return i
            },
            L.waitMs,
            L.deadlineMs as typeof Work.serialWaitMs,
          ),
        ),
      ),
    )
    steps += callers
    for (const [i, outcome] of outcomes.entries())
      if (outcome.status === 'rejected' && !(outcome.reason instanceof Work.Busy)) fail('serial', 'caller ' + i + ' failed: ' + String(outcome.reason))

    const lifeHost = host()
    const lockIds = Array.from({ length: L.locks }, (_, i) => ({ id: 'lock' + i, labels: random.chance(0.5) ? Work.instance : Work.lasting }))
    let life = await opened(lifeHost, 'swarm:abc', 'swarm:abc')
    for (let n = 0; n < L.lives; n++, steps++) {
      for (const lock of lockIds) await run(Work.lock(life, lock.id, 60_000, lock.labels))
      clock.now += random.int(0, 1_000)
      life = await opened(lifeHost, 'swarm:abc', 'swarm:abc')
      await run(Work.reclaim(life))
      for (const lock of lockIds) {
        const again = await run(Work.lock(life, lock.id, 60_000, lock.labels))
        if (again.ok !== (lock.labels === Work.instance))
          fail('reclaim', lock.id + ' (' + lock.labels.lock + ') after a restart ' + (again.ok ? 'was free' : 'stayed held'))
        if (lock.labels === Work.instance) {
          const skipped = await run(Work.holding(life, lock.id, 1_000, async () => 1))
          if (!('rejection' in skipped) || skipped.rejection.kind !== 'Held')
            fail('reclaim', 'holding ' + lock.id + ' while this life holds it gave ' + canon(skipped))
        }
      }
    }

    const failures = random.int(0, L.opens)
    let opens = 0
    const module = await wasm()
    const openHost = host()
    const lazy = Work.opening('swarm:abc', 'swarm:abc', async () => {
      opens++
      if (opens <= failures) throw new Error('not yet ' + opens)
      return Board.open({ actor: 'swarm:abc', module, scope: 'swarm:abc', sql: openHost })
    })
    if (lazy.scope !== 'swarm:abc' || lazy.actor !== 'swarm:abc' || opens !== 0) fail('opening', 'the board opened before its first call')
    for (let i = 0; i <= failures; i++, steps++) {
      const both = await run(Promise.allSettled([lazy.tasks(), lazy.tasks()]))
      const ok = i === failures
      if (both.some((each) => (each.status === 'fulfilled') !== ok))
        fail('opening', 'call ' + i + ' of ' + failures + ' failed opens gave ' + both.map((each) => each.status).join(','))
      if (opens !== i + 1) fail('opening', 'after ' + (i + 1) + ' calls it opened ' + opens + ' times')
    }
    await run(Work.ensure(lazy, { id: 't', spec: 'turn' }))
    if (canon((await run(lazy.tasks())).map((each) => each.id)) !== canon(['t']) || opens !== failures + 1)
      fail('opening', 'it opened ' + opens + ' times for ' + failures + ' failures')
    return { steps, violations }
  } finally {
    restore()
    for (const one of hosts) one.close()
  }
}

async function waitFor(check: () => boolean, rounds: number) {
  for (let i = 0; i < rounds && !check(); i++) await realTick()
  return check()
}

async function lifecycle(seed: string): Promise<Outcome> {
  const random = rng(seed, 'lifecycle')
  const { fail, violations } = recorder()
  const L = limits.lifecycle
  const { world } = await import('../run.ts')
  const counted = (w: ReturnType<typeof world>, query: string, ...values: unknown[]) => Number(w.sql.exec(query, ...values).one()?.['n'])
  let steps = 0
  {
    let report: Record<string, unknown> = { request_id: 'agt_1:1', status: 'running' }
    let hung = 0
    let wake = () => undefined as void
    const hangs = random.pick(['gone', 'throw', 'empty'] as const)
    const w = world((_request, url) => {
      if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json(report)
      if (url.pathname === '/v1/kv/list' && report['status'] === 'completed' && hung++ === 0)
        return new Promise<Response>(
          (resolve, reject) =>
            void (wake = () =>
              hangs === 'throw'
                ? reject(new TypeError('fetch failed'))
                : resolve(hangs === 'empty' ? Response.json({ keys: [] }) : Response.json({ error: 'gone' }, { status: 503 }))),
        )
      return undefined
    })
    try {
      await w.seed()
      await w.swarm.wake('money')
      await w.ring()
      if (w.swarm.run().state !== 'working') fail('stays closed', 'the turn did not start: ' + w.swarm.run().state)
      report = { ok: { message: 'Did step ' + seed }, request_id: 'agt_1:1', status: 'completed' }
      w.swarm.checked = 0
      const first = w.swarm.alarm()
      if (!(await waitFor(() => hung === 1, L.waitRounds))) fail('turn once', 'the turn end never reached its last effect')
      const Life = w.swarm.constructor as new (ctx: unknown, env: unknown) => typeof w.swarm
      const again = new Life(w.swarm.ctx, w.swarm.env)
      await again.alarm()
      const ended = again.run().state
      if (ended !== 'waiting') fail('stays closed', 'the second life left the run ' + ended)
      wake()
      await first
      steps += 2
      if (again.run().state !== 'waiting') fail('stays closed', 'the first life, waking late with ' + hangs + ', moved the run back to ' + again.run().state)
      const updates = counted(w, "SELECT COUNT(*) AS n FROM feed WHERE text LIKE 'Posted an update%'")
      const lines = counted(w, "SELECT COUNT(*) AS n FROM chat WHERE text LIKE 'Update:%'")
      if (updates !== 1 || lines !== 1)
        fail('turn once', 'the turn end posted ' + updates + ' updates and ' + lines + ' chat lines when its last effect answered ' + hangs)
    } finally {
      w.restore()
    }
  }
  {
    const total = random.int(3, L.events)
    const tool = (seq: number) => ({
      created_at: seq * 1000,
      event: { event: { payload: { arguments: '{}', call_id: 'c' + seq, name: 'kv_get' }, type: 'tool.call' }, source: 'agent' },
      seq,
    })
    let serving = false
    const w = world((_request, url) => {
      if (!serving || url.pathname !== '/v1/agents/agt_1/events' || url.searchParams.get('live') === '1') return undefined
      const after = Number(url.searchParams.get('after') ?? 0)
      if (after >= total) return Response.json({ events: [], has_more: false, next_cursor: after })
      const from = random.int(Math.max(1, after - L.overlap), after + 1)
      const to = random.int(after + 1, total)
      return Response.json({ events: Array.from({ length: to - from + 1 }, (_, i) => tool(from + i)), has_more: to < total, next_cursor: to })
    })
    try {
      await w.seed()
      await w.swarm.wake('money')
      await w.ring()
      serving = true
      const rows = () => Array.from({ length: total }, (_, i) => counted(w, 'SELECT COUNT(*) AS n FROM feed WHERE event = ?', i + 1))
      for (let ring = 0; ring < L.rings && (rows().at(-1) ?? 0) === 0; ring++, steps++) {
        w.swarm.stream = { retry: Date.now() + 3_600_000, state: 'polling' }
        w.swarm.checked = Date.now()
        await w.ring()
      }
      const got = rows()
      if (!got[0] || got.some((n) => n !== got[0])) fail('seq once', total + ' events read in overlapping pages wrote rows ' + got.join(','))
    } finally {
      w.restore()
    }
  }
  return { steps, violations }
}

function flag<T extends Record<string, boolean>>(guards: T, key: keyof T & string) {
  return () => {
    ;(guards as Record<string, boolean>)[key] = false
    return () => void ((guards as Record<string, boolean>)[key] = true)
  }
}

function reworded() {
  const said = reasons as unknown as Record<string, string>
  const was = said['broke'] as string
  said['broke'] = 'Paused.'
  return () => void (said['broke'] = was)
}

async function archived(seed: string): Promise<Outcome> {
  const random = rng(seed, 'archived')
  const { fail, violations } = recorder()
  const lifecycles = ['funding', 'running', 'paused'] as const
  const whys = [null, 'unfunded', 'money', 'costly', 'rest', 'idle', 'stuck'] as const
  let steps = 0
  for (; steps < limits.archived.checks; steps++) {
    const at = random.chance(0.5) ? random.int(1, limits.archived.checks) : null
    const row = {
      ai: null,
      answer: null,
      archived_at: at,
      balance: random.int(0, limits.phase.moneyMost),
      contributors: random.int(0, limits.phase.nMost),
      created_at: steps,
      form: 'agent',
      goal: 'goal',
      id: 's' + steps,
      machines: 0,
      nickname: null,
      pool_left: 0,
      problem: null,
      remaining: random.int(0, limits.phase.moneyMost),
      setup: null,
      spent: 0,
      status: random.pick(lifecycles),
      steering: 'open',
      title: 'swarm ' + steps,
      updated_at: steps,
      waiting: random.chance(0.5) ? 'tempo' : null,
      why: random.pick(whys),
    } as unknown as Store.Row
    const shown = Store.summary(row)
    const told = canon({ archived_at: at, status: row.status, why: row.why })
    if ((shown.status === 'archived') !== (at !== null)) fail('archived status', told + ' showed status ' + shown.status)
    if (at === null && shown.status !== row.status) fail('archived status', told + ' showed status ' + shown.status)
    if (at !== null && (shown.why !== null || shown.waiting !== null))
      fail('archived status', told + ' still showed why ' + shown.why + ' waiting ' + shown.waiting)
    const word = Standing.word({ ...shown, archivedAt: random.chance(0.5) ? shown.archivedAt : null })
    if ((word === 'Stopped') !== (at !== null)) fail('archived status', told + ' read as ' + word)
  }
  return { steps, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { archived, lifecycle, outbox, phase, work }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: flag(Run.guards, 'once'), invariant: 'turn once', name: 'lifecycle.once', scenario: 'lifecycle', seeds: ['1', '2', '3'] },
  { flip: flag(Cursor.guards, 'seq'), invariant: 'seq once', name: 'lifecycle.seq', scenario: 'lifecycle', seeds: ['1', '2', '3'] },
  { flip: reworded, invariant: 'reason', name: 'phase.reason', scenario: 'phase', seeds: ['1', '2', '3'] },
  { flip: flag(Store.guards, 'archived'), invariant: 'archived status', name: 'store.archived', scenario: 'archived', seeds: ['1', '2', '3'] },
  { flip: flag(Phase.guards, 'exact'), invariant: 'reason', name: 'phase.short', scenario: 'phase', seeds: ['1', '2', '3'] },
  { flip: flag(Standing.guards, 'live'), invariant: 'older pause', name: 'phase.older', scenario: 'phase', seeds: ['1', '2', '3'] },
  { flip: flag(Work.guards, 'deadline'), invariant: 'deadline', name: 'work.serial.deadline', scenario: 'work', seeds: ['1', '2', '3'] },
]
