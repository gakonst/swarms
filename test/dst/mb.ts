import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'
import * as Flow from '../../src/worker/Flow.ts'
import * as Payment from '../../src/worker/machines/Payment.ts'
import * as Store from '../../src/worker/Store.ts'
import * as Words from '../../src/worker/Words.ts'
import type * as MoneyModule from '../../src/worker/Money.ts'
import { open } from '../d1.ts'

type Violation = { detail: string; invariant: string }

type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  branch: {
    branches: 5,
    breaks: 0.15,
    jump: 0.05,
    limitUnits: 30,
    notes: ['n1', 'n2', 'n3'],
    ops: 150,
    startMs: 1_000_000,
    tickMs: 1000,
    unit: 500_000n,
    units: 12,
    windowMs: 30 * 24 * 60 * 60 * 1000,
  },
  backing: { floors: 8, racers: 4, reach: [9_000_000n, 7_000_000n, 6_000_000n, 4_000_000n], refreshes: 2 },
  gateway: {
    based: 0.6,
    branches: 3,
    counted: 0.3,
    deposit: 0.4,
    end: 0.08,
    keys: 4,
    known: 0.6,
    over: 3,
    pool: 2_000_000n,
    rounds: 24,
    split: 0.3,
    spend: 0.5,
    steer: 0.6,
    unit: 1_000_000n,
    units: 12,
  },
  flow: { contributors: 3, ops: 60, parts: 3 },
  overdraw: { after: 3, before: 2, ended: 0.5, limitLeast: 2, limitMost: 40, overMost: 10, slackMost: 3 },
  pay: { commits: 4, crash: 0.15, duplicate: 0.25, moves: 10, pledges: 6, spends: 2, stale: 0.5, tries: 40 },
  steps: { draws: 200, records: 3 },
  transfer: { crash: 0.2, duplicate: 0.3, hashes: 5, tries: 40 },
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

type Address = `0x${string}`

const riders = ['0x' + 'a'.repeat(40), '0x' + 'b'.repeat(40), '0x' + 'c'.repeat(40)] as Address[]

const nodes = [Flow.free, 'root', 'n1', 'n2']

function shout(address: string) {
  return '0x' + address.slice(2).toUpperCase()
}

function world() {
  const d1 = open()
  d1.sqlite.exec("insert into swarms (id, title, goal, created_at, updated_at, form) values ('s1', 't', 'g', 0, 0, 'tree')")
  return d1
}

class Crash extends Error {}

function scheduler(random: Rng, crash: number) {
  const pending: { crash: boolean; resolve: (crashed: boolean) => void }[] = []
  const rate = { crash }
  let steps = 0
  const gate = async () => {
    const crashed = await new Promise<boolean>((resolve) => pending.push({ crash: random.chance(rate.crash), resolve }))
    if (crashed) throw new Crash('restart')
  }
  const run = async (work: Promise<unknown>[]) => {
    let done = 0
    for (const each of work) void each.finally(() => (done += 1)).catch(() => undefined)
    while (done < work.length) {
      await new Promise((resolve) => setImmediate(resolve))
      if (!pending.length) continue
      const next = pending.splice(Math.floor(random.next() * pending.length), 1)[0]
      steps += 1
      next?.resolve(next.crash)
    }
  }
  return { gate, rate, run, steps: () => steps }
}

function storage() {
  const map = new Map<string, unknown>()
  return {
    delete: (key: string) => map.delete(key),
    get: <T>(key: string) => (map.has(key) ? (structuredClone(map.get(key)) as T) : undefined),
    map,
    put: (key: string, value: unknown) => void map.set(key, structuredClone(value)),
  }
}

type Leg = { amount: bigint; contributor: string; kind: Flow.Kind; node: string; peer: string | null; run: string | null }

function add(map: Map<string, bigint>, key: string, amount: bigint) {
  map.set(key, (map.get(key) ?? 0n) + amount)
}

function nonzero(map: ReadonlyMap<string, bigint>, zero = false) {
  return JSON.stringify(
    [...map]
      .filter(([, value]) => zero || value !== 0n)
      .map(([key, value]) => [key, String(value)])
      .sort(),
  )
}

function expected(each: readonly Leg[]) {
  const grouped = new Map<string, Leg>()
  for (const leg of each) {
    const key = JSON.stringify([leg.node, leg.run, leg.contributor, leg.kind, leg.peer])
    grouped.set(key, { ...leg, amount: (grouped.get(key)?.amount ?? 0n) + leg.amount })
  }
  const legs = [...grouped.values()]
  const ledger = {
    committed: new Map<string, bigint>(),
    granted: new Map<string, bigint>(),
    inherited: new Map<string, bigint>(),
    left: new Map<string, bigint>(),
    pledged: new Map<string, bigint>(),
    spent: new Map<string, bigint>(),
  }
  const funders = new Map<string, Map<string, bigint>>()
  for (const leg of legs) {
    if (leg.kind === 'spend') add(ledger.spent, leg.node, -leg.amount)
    if (leg.run !== null) {
      add(ledger.committed, leg.run.split(':')[1] ?? '', leg.amount)
      continue
    }
    add(ledger.left, leg.node, leg.amount)
    if (leg.kind === 'pledge' || leg.kind === 'move' || (leg.kind === 'return' && leg.amount < 0n && leg.peer === Flow.free)) {
      add(ledger.pledged, leg.node, leg.amount)
      const own = funders.get(leg.node) ?? new Map<string, bigint>()
      add(own, leg.contributor, leg.amount)
      funders.set(leg.node, own)
    }
    if (leg.kind === 'grant') add(leg.amount > 0n ? ledger.inherited : ledger.granted, leg.node, leg.amount > 0n ? leg.amount : -leg.amount)
    if (leg.kind === 'return' && leg.amount < 0n && leg.peer !== Flow.free) add(ledger.inherited, leg.node, leg.amount)
    if (leg.kind === 'return' && leg.amount > 0n && leg.node !== Flow.free) add(ledger.granted, leg.node, -leg.amount)
  }
  return { funders, ledger }
}

function held(legs: readonly Leg[], bucket: Flow.Bucket) {
  const found = new Map<string, bigint>()
  for (const leg of legs) if (leg.node === bucket.node && leg.run === bucket.run) add(found, leg.contributor, leg.amount)
  return found
}

function splitCheck(random: Rng, fail: (invariant: string, detail: string) => void) {
  const pool = new Map<string, bigint>()
  for (const rider of riders) if (random.chance(0.8)) pool.set(rider, BigInt(random.int(-2, 9_000_000)))
  const amount = BigInt(random.int(0, 20_000_000))
  const parts = Flow.split(pool, amount)
  const positive = [...pool].filter(([, value]) => value > 0n).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0] < b[0] ? -1 : 1))
  const total = Flow.sum(positive.map(([, value]) => value))
  const want = amount > total ? total : amount
  const got = new Map(parts)
  const detail = JSON.stringify({ amount: String(amount), parts: parts.map(([c, v]) => [c, String(v)]), pool: [...pool].map(([c, v]) => [c, String(v)]) })
  if (Flow.sum(parts.map(([, value]) => value)) !== want) fail('split', 'parts do not add to what was asked ' + detail)
  let full = true
  for (const [contributor, value] of positive) {
    const part = got.get(contributor) ?? 0n
    const floor = total === 0n ? 0n : (want * value) / total
    if (part > value || part < floor) fail('split', contributor + ' outside its pro rata share ' + detail)
    if (part > floor && !full) fail('split', 'remainder skipped a larger share ' + detail)
    if (part < value) full = false
  }
  for (const [contributor, value] of parts)
    if (value <= 0n || !((pool.get(contributor) ?? 0n) > 0n)) fail('split', contributor + ' got a part it does not hold ' + detail)
}

async function flowLedger(seed: string): Promise<Outcome> {
  const random = rng(seed, 'flow_ledger')
  const { fail, violations } = recorder()
  const F = limits.flow
  const { env } = world()
  const legs: Leg[] = []
  const ids: { from: Flow.Bucket | null; id: string; kind: Flow.Kind; to: Flow.Bucket | null }[] = []
  const landed = new Set<string>()
  const runs: Flow.Bucket[] = []
  let steps = 0
  for (; steps < F.ops; steps++) {
    splitCheck(random, fail)
    const replay = ids.length && random.chance(0.15) ? random.pick(ids) : null
    const drawn = random.pick(['pledge', 'pledge', 'grant', 'move', 'commit', 'spend', 'settle', 'return'] as const)
    const node = (pool: readonly string[]) => ({ node: random.pick(pool), run: null })
    const kind = replay?.kind ?? drawn
    let from: Flow.Bucket | null = kind === 'pledge' ? null : node(nodes)
    let to: Flow.Bucket | null = kind === 'spend' ? null : node(nodes.filter((each) => each !== from?.node))
    if (kind === 'commit' && from) to = { node: from.node, run: 'r:' + from.node + ':' + steps }
    if (kind === 'spend' && runs.length && random.chance(0.6)) from = random.pick(runs)
    if (kind === 'settle' && runs.length) {
      from = random.pick(runs)
      to = { node: from.run?.split(':')[1] ?? '', run: null }
    }
    if (kind === 'commit' && to) runs.push(to)
    if (replay) {
      from = replay.from
      to = replay.to
    }
    const shares = from ? Flow.shares(await Flow.rows(env, 's1'), from) : new Map<string, bigint>()
    const parts: Flow.Part[] =
      from && random.chance(0.4)
        ? Flow.split(shares, BigInt(random.int(1, 9)) * 1_000_000n)
        : Array.from({ length: random.int(1, F.parts) }, () => {
            const rider = random.pick(riders.slice(0, F.contributors))
            return [random.chance(0.3) ? shout(rider) : rider, BigInt(random.int(0, 8)) * 500_000n] as const
          })
    const id = replay?.id ?? kind + ':' + steps
    const merged = new Map<string, bigint>()
    for (const [contributor, amount] of parts) if (amount > 0n) add(merged, contributor.toLowerCase(), amount)
    const before = from ? held(legs, from) : new Map<string, bigint>()
    const covered = !from || [...merged].every(([contributor, amount]) => amount <= (before.get(contributor) ?? 0n))
    const fresh = [...merged.keys()].filter((contributor) => !landed.has(id + ':' + contributor))
    const wrote = await Flow.write(env, { at: steps, from, id, kind, parts, swarm: 's1', to })
    const detail =
      kind +
      ' ' +
      id +
      ' ' +
      JSON.stringify([...merged].map(([c, v]) => [c, String(v)])) +
      ' from ' +
      JSON.stringify(from) +
      ' holding ' +
      JSON.stringify([...before].map(([c, v]) => [c, String(v)]))
    if (wrote && !fresh.length) fail('write once', detail)
    if (wrote && !covered) fail('covered', detail)
    if (!wrote && fresh.length && covered) fail('refused', detail)
    if (wrote) {
      if (!replay) ids.push({ from, id, kind, to })
      for (const contributor of fresh) {
        const amount = merged.get(contributor) ?? 0n
        landed.add(id + ':' + contributor)
        if (from) legs.push({ amount: -amount, contributor, kind, node: from.node, peer: to?.node ?? null, run: from.run })
        if (to) legs.push({ amount, contributor, kind, node: to.node, peer: from?.node ?? null, run: to.run })
      }
    }
    const rows = await Flow.rows(env, 's1')
    const ledger = Flow.fold(rows)
    const want = expected(legs)
    for (const key of ['committed', 'granted', 'inherited', 'left', 'pledged', 'spent'] as const)
      if (nonzero(ledger[key]) !== nonzero(want.ledger[key])) fail('fold', key + ' ' + nonzero(ledger[key]) + ' expected ' + nonzero(want.ledger[key]))
    for (const name of nodes) {
      const own = new Map([...(ledger.funders.get(name) ?? new Map<string, { amount: bigint }>())].map(([c, each]) => [c, each.amount]))
      const mine = new Map([...(want.funders.get(name) ?? new Map<string, bigint>())].filter(([, value]) => value > 0n))
      if (nonzero(own, true) !== nonzero(mine)) fail('fold', 'funders of ' + name + ' ' + nonzero(own, true) + ' expected ' + nonzero(mine))
    }
    const totals = Flow.totals(rows)
    const pledged = Flow.sum(legs.filter((leg) => leg.kind === 'pledge').map((leg) => leg.amount))
    const spent = -Flow.sum(legs.filter((leg) => leg.kind === 'spend').map((leg) => leg.amount))
    if (totals.pledged !== pledged || totals.spent !== spent || totals.held !== pledged - spent)
      fail(
        'totals',
        JSON.stringify({ held: String(totals.held), pledged: String(totals.pledged), spent: String(totals.spent), want: [String(pledged), String(spent)] }),
      )
    const buckets = new Map<string, bigint>()
    for (const leg of legs) add(buckets, leg.node + '/' + leg.run + '/' + leg.contributor, leg.amount)
    for (const [bucket, amount] of buckets) if (amount < 0n) fail('covered', bucket + ' holds ' + amount)
  }
  return { steps, violations }
}

type Write = (env: Cloudflare.Env, input: Parameters<typeof Flow.write>[1], gate: () => Promise<void>) => Promise<boolean>

const lanes: { write: Write } = { write: (env, input) => Flow.write(env, input) }

async function readThenWrite(...[env, input, gate]: Parameters<Write>) {
  if (input.from) {
    const rows = await Flow.rows(env, input.swarm)
    for (const [contributor, amount] of input.parts) if ((Flow.shares(rows, input.from).get(contributor.toLowerCase()) ?? 0n) < amount) return false
    await gate()
  }
  const wrote = await Flow.write(env, { ...input, from: null, to: input.to })
  if (wrote && input.from)
    await Flow.write(env, { ...input, from: null, id: input.id + ':out', parts: input.parts.map(([c, a]) => [c, -a] as const), to: input.from })
  return wrote
}

type Act = {
  amount: bigint
  contributor: string
  from: string | null
  fromRun?: string
  id: string
  key: string
  kind: 'commit' | 'move' | 'pledge' | 'spend'
  to: string | null
  toRun?: string
}

async function flowPay(seed: string): Promise<Outcome> {
  const random = rng(seed, 'flow_pay')
  const { fail, violations } = recorder()
  const P = limits.pay
  const d1 = world()
  const kv = storage()
  const { gate, rate, run, steps } = scheduler(random, P.crash)
  const acts: Act[] = []
  for (let n = 0; n < P.pledges; n++)
    acts.push({
      amount: BigInt(random.int(1, 9)) * 1_000_000n,
      contributor: random.pick(riders),
      from: null,
      id: '0xh' + seed + 'p' + n,
      key: 'p' + n,
      kind: 'pledge',
      to: random.pick(nodes),
    })
  for (let n = 0; n < P.moves; n++) {
    const from = random.pick(nodes)
    acts.push({
      amount: BigInt(random.int(1, 6)) * 1_000_000n,
      contributor: random.pick(riders),
      from,
      id: '',
      key: 'm' + n,
      kind: 'move',
      to: random.pick(nodes.filter((node) => node !== from)),
    })
  }
  for (let n = 0; n < P.spends; n++)
    acts.push({
      amount: BigInt(random.int(1, 12)) * 1_000_000n,
      contributor: random.pick(riders),
      from: random.pick(nodes),
      id: 'spend:' + n,
      key: 's' + n,
      kind: 'spend',
      to: null,
    })
  for (let n = 0; n < P.commits; n++) {
    const node = random.pick(nodes)
    const bucket = 'r:' + node + ':' + n
    const contributor = random.pick(riders)
    acts.push({
      amount: BigInt(random.int(1, 8)) * 1_000_000n,
      contributor,
      from: node,
      id: 'commit:' + n,
      key: 'c' + n,
      kind: 'commit',
      to: node,
      toRun: bucket,
    })
    acts.push({
      amount: BigInt(random.int(1, 20)) * 500_000n,
      contributor,
      from: node,
      fromRun: bucket,
      id: 'used:' + n,
      key: 'u' + n,
      kind: 'spend',
      to: null,
    })
  }
  const answers = new Map<string, string[]>()
  const used = new Map<string, Set<string>>()
  const check = async (when: string) => {
    const rows = await Flow.rows(d1.env, 's1')
    const audit = Payment.audit(rows)
    if (!Payment.balanced(audit))
      fail('ledger', when + ' held ' + audit.held + ' pledged ' + audit.pledged + ' spent ' + audit.spent + ' negative ' + JSON.stringify(audit.negative))
    if (!Payment.raised(rows)) fail('overspent', when + ' spent ' + audit.spent + ' of ' + audit.pledged)
  }
  const attempt = async (act: Act) => {
    const id = act.kind === 'move' ? Payment.id('move', act.from + '>' + act.to, act.contributor, act.key) : act.id
    used.set(act.key, (used.get(act.key) ?? new Set()).add(id))
    const done = await Payment.settle(
      kv,
      act.kind === 'pledge' ? 'pledge:' + id : id,
      {
        write: async () => {
          await gate()
          const wrote = await lanes.write(
            d1.env,
            {
              from: act.from === null ? null : { node: act.from, run: act.fromRun ?? null },
              id,
              kind: act.kind,
              parts: [[act.contributor, act.amount]],
              swarm: 's1',
              to: act.to === null ? null : { node: act.to, run: act.toRun ?? null },
            },
            gate,
          )
          await check(act.key)
          await gate()
          return wrote
        },
        written: async () => {
          await gate()
          return Flow.written(d1.env, 's1', id)
        },
      },
      () => kv.put('fx:' + act.key, (kv.get<number>('fx:' + act.key) ?? 0) + 1),
    )
    return done.at
  }
  const client = async (act: Act) => {
    const said: string[] = []
    for (let tries = 0; tries < P.tries; tries++) {
      const copies = random.chance(P.duplicate) ? 2 : 1
      const results = await Promise.allSettled(Array.from({ length: copies }, () => attempt(act)))
      const settled = results.flatMap((each) => (each.status === 'fulfilled' ? [each.value] : []))
      for (const each of results)
        if (each.status === 'rejected' && !(each.reason instanceof Crash) && !(each.reason instanceof Payment.Busy))
          fail('unexpected', String((each.reason as Error)?.stack ?? each.reason).slice(0, 300))
      said.push(...settled)
      if (settled.length) break
    }
    if (random.chance(P.stale)) said.push('stale:' + (await attempt(act).catch((error: unknown) => (error instanceof Crash ? 'crashed' : 'error'))))
    answers.set(act.key, said)
  }
  await run(acts.map((act) => client(act)))
  rate.crash = 0
  await run(acts.map(async (act) => answers.get(act.key)?.push('drained:' + (await attempt(act)))))
  await check('end')
  const rows = await Flow.rows(d1.env, 's1')
  const audit = Payment.audit(rows)
  const flows = d1.sqlite
    .prepare("select id from flows where swarm = 's1'")
    .all()
    .map((row) => String(row['id']))
  for (const act of acts) {
    const said = answers.get(act.key) ?? []
    const effects = kv.get<number>('fx:' + act.key) ?? 0
    const landed = [...(used.get(act.key) ?? [])].filter((id) => flows.some((row) => row.startsWith('s1:' + id + ':')))
    if (landed.length > 1) fail('keyed', act.key + ' landed as ' + landed.join(', '))
    const paid = said.some((each) => each.endsWith('paid'))
    if (paid && effects !== 1) fail('effects once', act.key + ' ran its effects ' + effects + ' times')
    if (!paid && effects !== 0) fail('effects without paid', act.key + ' ran its effects ' + effects + ' times, said ' + said.join(','))
    if (act.kind === 'pledge' && !paid) fail('pledge counted', act.key + ' said ' + said.join(','))
  }
  const pledged = acts.filter((act) => act.kind === 'pledge').reduce((sum, act) => sum + act.amount, 0n)
  if (audit.pledged !== pledged) fail('pledge counted', 'counted ' + audit.pledged + ' of ' + pledged)
  for (const key of kv.map.keys()) if (key.startsWith('pay:')) fail('slot closed', key + ' left open')
  return { steps: steps(), violations }
}

const paymentTable: Record<Payment.Payment['at'], (string | null)[]> = {
  owed: ['paying', null, null, null, null, null, null],
  paid: [null, null, null, null, null, null, null],
  paying: ['paying', 'paid', 'paid', 'refused', 'owed', null, 'owed'],
  refused: [null, null, null, null, null, null, null],
}

const transferTable: Record<Payment.Transfer['at'], (string | null)[]> = {
  announced: [null, null, null, null, null],
  counted: [null, null, null, null, 'announced'],
  credited: [null, null, 'counted', 'counted', null],
  refused: [null, null, null, null, null],
  seen: ['credited', 'refused', null, null, null],
}

async function paySteps(seed: string): Promise<Outcome> {
  const random = rng(seed, 'pay_steps')
  const { fail, violations } = recorder()
  const S = limits.steps
  let steps = 0
  for (; steps < S.draws; steps++) {
    const id = 'p' + random.int(0, 9)
    const tries = random.int(0, 5)
    const until = random.int(0, 20)
    const states: Payment.Payment[] = [
      { at: 'owed', id, tries },
      { at: 'paying', id, resumed: random.chance(0.5), tries: tries + 1, until },
      { at: 'paid', id, landed: random.chance(0.5) },
      { at: 'refused', id, why: 'x' },
    ]
    const now = random.int(0, 20)
    const events: Payment.Event[] = [
      { now, type: 'pay' },
      { type: 'landed' },
      { type: 'found' },
      { type: 'short', why: 'x' },
      { type: 'lost' },
      { now: until - 1, type: 'expired' },
      { now: until + random.int(0, 3), type: 'expired' },
    ]
    const state = random.pick(states)
    const had = 'tries' in state ? state.tries : 0
    const which = random.int(0, events.length - 1)
    const next = Payment.step(state, events[which] as Payment.Event)
    const want = paymentTable[state.at][which]
    if ((next?.at ?? null) !== want) fail('legal', state.at + ' on ' + JSON.stringify(events[which]) + ' went ' + (next?.at ?? null) + ' not ' + want)
    if (next && next.id !== id) fail('legal', 'id changed to ' + next.id)
    if (next?.at === 'paid' && next.landed !== (which === 1)) fail('legal', 'paid on ' + JSON.stringify(events[which]) + ' says landed ' + next.landed)
    if (
      next?.at === 'paying' &&
      (next.tries !== had + 1 || next.until !== now + Payment.limits.payingMs || next.resumed !== (state.at === 'paying' || had > 0))
    )
      fail('legal', 'paying ' + JSON.stringify(next) + ' from ' + JSON.stringify(state))
    if (next?.at === 'owed' && state.at !== 'owed' && next.tries !== had) fail('legal', 'owed lost its tries ' + JSON.stringify(next))
    const hash = '0x' + random.int(0, 9)
    const amount = BigInt(random.int(0, 9))
    const transfers: Payment.Transfer[] = [
      { at: 'seen', hash },
      { amount, at: 'credited', from: '0xa', hash },
      { amount, at: 'counted', first: true, from: '0xa', hash },
      { at: 'announced', hash },
      { at: 'refused', hash, why: 'x' },
    ]
    const deliveries: Payment.Delivery[] = [
      { amount, from: '0xA', type: 'credited' },
      { type: 'uncredited', why: 'x' },
      { type: 'gave' },
      { type: 'held' },
      { type: 'told' },
    ]
    const transfer = random.pick(transfers)
    const delivery = random.int(0, deliveries.length - 1)
    const moved = Payment.transfer(transfer, deliveries[delivery] as Payment.Delivery)
    const expect = transferTable[transfer.at][delivery]
    if ((moved?.at ?? null) !== expect)
      fail('legal transfer', transfer.at + ' on ' + (deliveries[delivery] as Payment.Delivery).type + ' went ' + (moved?.at ?? null) + ' not ' + expect)
    if (moved && moved.hash !== hash) fail('legal transfer', 'hash changed')
    if (moved?.at === 'credited' && moved.from !== '0xa') fail('legal transfer', 'sender kept its case ' + moved.from)
    if (moved?.at === 'counted' && moved.first !== (delivery === 2)) fail('legal transfer', 'counted first ' + moved.first + ' on ' + delivery)
    const key = random.chance(0.2) ? random.pick([null, undefined]) : 'k' + random.int(0, 3).toString(36).repeat(8)
    const rider = random.pick(riders)
    const a = Payment.id('move', 'root>n1', rider, key)
    const b = Payment.id('move', 'root>n1', random.chance(0.5) ? shout(rider) : rider, key)
    if (key && a !== b) fail('keyed id', key + ' gave ' + a + ' and ' + b)
    if (!key && a === b) fail('keyed id', 'two unkeyed requests share ' + a)
  }
  const records = [{ at: 'paying', more: true, tries: 2, until: 5, v: 2 }, { at: 'owed' }, { v: 1 }]
  for (let n = 0; n < S.records; n++) {
    const kv = storage()
    kv.put('pay:m', random.pick(records))
    let effects = 0
    const done = await Payment.settle(kv, 'm', { write: async () => false, written: async () => true }, () => (effects += 1)).catch((error: unknown) => ({
      at: String(error),
    }))
    if (done.at !== 'paid' || effects !== 1) fail('resume', 'an open record ended ' + done.at + ' with ' + effects + ' effects')
    else if (Payment.open(kv, 'm')) fail('resume', 'an open record ended ' + done.at + ' with ' + effects + ' effects, open ' + Payment.open(kv, 'm'))
  }
  const kv = storage()
  const saved = Payment.limits.payingMs
  Object.assign(Payment.limits, { payingMs: 1 })
  let effects = 0
  try {
    const hung = await Payment.settle(kv, 'm', { write: () => new Promise<boolean>(() => undefined), written: async () => false }, () => (effects += 1)).then(
      () => 'settled',
      (error: unknown) => (error instanceof Payment.Busy ? 'busy' : String(error)),
    )
    if (hung !== 'busy' || !Payment.open(kv, 'm')) fail('busy', 'a write that never answered ended ' + hung + ', open ' + Payment.open(kv, 'm'))
    for (let n = 0; n < 2; n++) await Payment.settle(kv, 'm', { write: async () => false, written: async () => true }, () => (effects += 1))
    if (effects !== 1 || Payment.open(kv, 'm')) fail('busy', 'the next attempts ran ' + effects + ' effects')
  } finally {
    Object.assign(Payment.limits, { payingMs: saved })
  }
  return { steps, violations }
}

async function transferOnce(seed: string): Promise<Outcome> {
  const random = rng(seed, 'transfer_once')
  const { fail, violations } = recorder()
  const T = limits.transfer
  const d1 = world()
  const kv = storage()
  const { gate, run, steps } = scheduler(random, T.crash)
  const hashes = Array.from({ length: T.hashes }, (_, n) => '0x' + seed + 'f' + n)
  const amounts = new Map(hashes.map((hash) => [hash, String(BigInt(random.int(1, 9)) * 1_000_000n)]))
  const told = new Map<string, number>()
  const deliver = async (hash: string) => {
    let state: Payment.Transfer | null = { at: 'seen', hash }
    await gate()
    state = Payment.transfer(state, { amount: BigInt(amounts.get(hash) ?? '0'), from: riders[0] as Address, type: 'credited' })
    const gift = await Store.give(d1.env, {
      amount: amounts.get(hash) ?? '0',
      channel: null,
      contributor: riders[0] as Address,
      id: hash,
      note: null,
      note_id: null,
      swarm: 's1',
      token: 'ousd',
    })
    state = state && Payment.transfer(state, { type: gift ? 'gave' : 'held' })
    await gate()
    if (state?.at !== 'counted') throw new Error('not counted')
    Payment.once(kv, 'told:new:' + hash, () => told.set(hash, (told.get(hash) ?? 0) + 1))
    return Payment.transfer(state, { type: 'told' })?.at
  }
  const client = async (hash: string) => {
    for (let tries = 0; tries < T.tries; tries++) {
      const results = await Promise.allSettled(Array.from({ length: random.chance(T.duplicate) ? 3 : 1 }, () => deliver(hash)))
      for (const each of results) if (each.status === 'rejected' && !(each.reason instanceof Crash)) fail('unexpected', String(each.reason))
      if (results.some((each) => each.status === 'fulfilled' && each.value === 'announced')) return
    }
    fail('announced', hash + ' never announced')
  }
  await run(hashes.map((hash) => client(hash)))
  const rows = d1.sqlite.prepare("select id, amount from contributions where swarm = 's1'").all()
  if (rows.length !== hashes.length) fail('counted once', rows.length + ' rows for ' + hashes.length + ' transfers')
  for (const row of rows) if (amounts.get(String(row['id'])) !== String(row['amount'])) fail('counted once', row['id'] + ' counted ' + row['amount'])
  for (const hash of hashes) if (told.get(hash) !== 1) fail('told once', hash + ' told ' + (told.get(hash) ?? 0) + ' times')
  return { steps: steps(), violations }
}

async function backingLower(seed: string): Promise<Outcome> {
  const random = rng(seed, 'backing_lower')
  const { fail, violations } = recorder()
  const B = limits.backing
  const d1 = world()
  const { gate, run, steps } = scheduler(random, 0)
  const backing = 'backing:0xkey'
  await Store.give(d1.env, {
    amount: '10000000',
    channel: '0xkey',
    contributor: riders[0] as Address,
    id: backing,
    note: null,
    note_id: null,
    swarm: 's1',
    token: 'mach',
  })
  const seen: bigint[] = []
  let time = 0
  const refresh = async () => {
    const gift = await Store.gift(d1.env, backing)
    const worth = B.reach[Math.min(time++, B.reach.length - 1)] as bigint
    await gate()
    if (BigInt(gift?.amount ?? '0') > worth) await Store.lower(d1.env, 's1', backing, String(worth), gift?.amount ?? '0')
    const now = BigInt((await Store.gift(d1.env, backing))?.amount ?? '0')
    if (seen.length && now > (seen.at(-1) as bigint)) fail('lower only', 'a backing went from ' + seen.at(-1) + ' up to ' + now)
    seen.push(now)
  }
  await run(
    Array.from({ length: B.racers }, async () => {
      for (let n = 0; n < B.refreshes; n++) await refresh()
    }),
  )
  for (let n = 0; n < B.floors; n++) {
    const floor = world()
    const id = 'backing:0x' + n
    const was = BigInt(random.int(1, 10)) * 1_000_000n
    const other = BigInt(random.int(0, 3)) * 1_000_000n
    await Store.give(floor.env, {
      amount: String(was),
      channel: `0x${n}`,
      contributor: riders[0] as Address,
      id,
      note: null,
      note_id: null,
      swarm: 's1',
      token: 'mach',
    })
    if (other)
      await Store.give(floor.env, {
        amount: String(other),
        channel: null,
        contributor: riders[1] as Address,
        id: '0xother' + n,
        note: null,
        note_id: null,
        swarm: 's1',
        token: 'ousd',
      })
    const spent = BigInt(random.int(0, 12)) * 1_000_000n
    floor.sqlite.prepare('update swarms set ' + random.pick(['sponsor_spent', 'pool_spent']) + " = ? where id = 's1'").run(spent)
    const amount = BigInt(random.int(0, Number(was / 1_000_000n))) * 1_000_000n
    const lowered = await Store.lower(floor.env, 's1', id, String(amount), String(was))
    const allowed = other + amount >= spent
    const now = BigInt((await Store.gift(floor.env, id))?.amount ?? '0')
    if ((lowered !== null) !== allowed || now !== (allowed ? amount : was))
      fail('spent floor', 'lowering ' + was + ' to ' + amount + ' with ' + other + ' more and ' + spent + ' spent left ' + now)
  }
  return { steps: steps(), violations }
}

const order = { fresh: true }
async function overdraw(seed: string): Promise<Outcome> {
  const random = rng(seed, 'overdraw')
  const { fail, violations } = recorder()
  const O = limits.overdraw
  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'cloudflare:workers'
        ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' }
        : next(specifier, context),
  })
  const Money = (await import('../../src/worker/Money.ts')) as typeof MoneyModule
  Money.guards.fresh = order.fresh
  const d1 = world()
  const unit = 1_000_000n
  const key = ('0x' + 'd'.repeat(40)) as Address
  const limit = BigInt(random.int(O.limitLeast, O.limitMost)) * unit
  const pooled = BigInt(random.int(1, O.limitMost)) * unit
  const slack = BigInt(random.int(0, O.slackMost)) * unit
  const over = slack + BigInt(random.int(1, O.overMost)) * unit
  const ended = random.chance(O.ended)
  const paid = BigInt(random.int(0, Number(limit / unit / 2n))) * unit
  await Store.give(d1.env, {
    amount: String(pooled + slack),
    channel: null,
    contributor: riders[1] as Address,
    id: '0xpool',
    note: null,
    note_id: null,
    swarm: 's1',
    token: 'ousd',
  })
  await Store.give(d1.env, {
    amount: String(limit),
    channel: key,
    contributor: riders[0] as Address,
    id: 'backing:' + key,
    note: null,
    note_id: null,
    swarm: 's1',
    token: 'mach',
  })
  const states: { ended: boolean; spent: bigint }[] = []
  for (let n = 0; n < O.before; n++) states.push({ ended: false, spent: (limit * BigInt(random.int(0, 4))) / 8n })
  states.push({ ended: false, spent: limit + over })
  for (let n = 0; n < O.after; n++) states.push({ ended, spent: paid })
  const now = { state: states[0] as { ended: boolean; spent: bigint } }
  const decimal = (units: bigint) =>
    (units < 0n ? '-' : '') + String((units < 0n ? -units : units) / unit) + '.' + String((units < 0n ? -units : units) % unit).padStart(6, '0')
  const logged: string[] = []
  const stored = new Map<string, unknown>()
  const self = {
    agent: () => undefined,
    beacon: () => undefined,
    changed: () => undefined,
    contributed: async () => undefined,
    env: {
      ...d1.env,
      GATEWAY: {
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname
          if (path === '/api/keys/credit') return Response.json({ deposited: '0', left: decimal(0n), spent: decimal(pooled) })
          const left = now.state.ended ? 0n : limit - now.state.spent
          return Response.json({
            backings: [
              {
                backer: riders[0],
                createdAt: 1,
                ended: now.state.ended,
                expiresAt: null,
                key,
                left: decimal(left),
                limit: decimal(limit),
                spent: decimal(now.state.spent),
                tag: null,
                token: 'mach',
              },
            ],
            left: decimal(left > 0n ? left : 0n),
            spent: decimal(now.state.spent),
          })
        },
      },
      GATEWAY_URL: 'https://gateway.test',
      SWARMS_GATEWAY_KEY: 'test',
    },
    kv: { get: (name: string) => stored.get(name), put: (name: string, value: unknown) => void stored.set(name, value) },
    log: (_kind: string, text: string) => void logged.push(text),
    remember: () => undefined,
    turn: () => false,
  }
  let steps = 0
  let held = limit
  for (const state of states) {
    now.state = state
    const row = await Store.find(d1.env, 's1')
    if (!row) return { steps, violations: [{ detail: 'no swarm', invariant: 'remaining' }] }
    await Money.refresh(self as never, row, { credit: true, hands: false })
    steps += 1
    const worth = state.ended ? state.spent : limit - state.spent > 0n ? limit : state.spent
    held = held > worth ? worth : held < state.spent ? state.spent : held
    const bound = pooled + slack + held - (pooled + state.spent)
    const after = await Store.find(d1.env, 's1')
    const remaining = BigInt(after?.remaining ?? 0)
    if (remaining > bound)
      fail(
        'remaining',
        'step ' + steps + ' remaining ' + remaining + ' over raised less real spent ' + bound + ' (limit ' + limit + ', spent ' + state.spent + ')',
      )
  }
  for (const text of logged) {
    const said = /approval of \$([\d.]+)/.exec(text)?.[1]
    if (said !== undefined && said !== Words.trim(decimal(limit)))
      fail('approval', 'funds line said approval of $' + said + ' for a $' + Words.trim(decimal(limit)) + ' approval')
  }
  return { steps, violations }
}

type Gift = { amount: bigint; channel: string | null; contributor: Address; id: string; note: string | null }

type Steer = { amount: bigint; at: number; branch: number | null; budget: number; contributor: Address; id: string; note: string }

const agent = 'agt'

function show(value: unknown) {
  return JSON.stringify(value, (_, each: unknown) => (typeof each === 'bigint' ? String(each) : each))
}

async function settledTakeBack(random: Rng, fail: (invariant: string, detail: string) => void) {
  const L = limits.branch
  const d1 = open()
  d1.sqlite
    .prepare(
      "insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at) values ('s', 'Swarm', 'The goal of the swarm', 'paused', 0, 0, 1, 1)",
    )
    .run()
  const c = riders[0] as Address
  const paid = BigInt(random.int(2, L.units)) * L.unit
  await Store.give(d1.env, { amount: String(paid), channel: '0xkk', contributor: c, id: 'backing:0xkk', note: null, note_id: null, swarm: 's', token: 'mach' })
  const behind = BigInt(random.int(1, Number(paid / L.unit))) * L.unit
  await Store.steer(d1.env, {
    amount: behind,
    branch: { agent, id: L.branches + 1 },
    contributor: c,
    id: 'f',
    note: 'branch',
    note_id: 'branch:' + (L.branches + 1),
    swarm: 's',
  })
  const left = BigInt(random.int(0, Number(behind / L.unit) - 1)) * L.unit
  await Store.settle(d1.env, { agent, branch: L.branches + 1, left, swarm: 's' })
  const before = (await Store.funds(d1.env, 's', agent)).shares.get(L.branches + 1)?.get(c)
  const taken = await Store.lower(d1.env, 's', 'backing:0xkk', '0', String(paid))
  const after = (await Store.funds(d1.env, 's', agent)).shares.get(L.branches + 1)?.get(c)
  if (taken === null || taken.length || before !== after)
    fail('lowered', 'lowering a backing behind a settled branch took back ' + show(taken) + ', held ' + before + ' then ' + after)
}

async function branchMoney(seed: string): Promise<Outcome> {
  const random = rng(seed, 'branch_money')
  const { fail, violations } = recorder()
  const L = limits.branch
  const d1 = open()
  d1.sqlite
    .prepare(
      "insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at) values ('s', 'Swarm', 'The goal of the swarm', 'paused', 0, 0, 1, 1)",
    )
    .run()
  const env = d1.env
  const batch = env.DB.batch.bind(env.DB)
  const failing = { next: false }
  ;(env.DB as { batch: unknown }).batch = async (statements: D1PreparedStatement[]) => {
    if (!failing.next) return batch(statements)
    failing.next = false
    return batch([...statements, env.DB.prepare('select * from nothing')])
  }
  const real = Date.now
  let now = L.startMs
  Date.now = () => now
  const gifts = new Map<string, Gift>()
  const steers: Steer[] = []
  const settled = new Set<number>()
  const groups: string[][] = []
  const of = (c: Address) => [...gifts.values()].filter((gift) => gift.contributor === c)
  const own = (c: Address) => Flow.sum(steers.filter((each) => each.contributor === c && each.budget === 0).map((each) => each.amount))
  const unnoted = (c: Address) =>
    Flow.sum(
      of(c)
        .filter((gift) => gift.note === null)
        .map((gift) => gift.amount),
    )
  const free = (c: Address) => unnoted(c) - own(c)
  const raised = () => Flow.sum([...gifts.values()].map((gift) => gift.amount))
  const live = (branch: number | null) => branch === null || !settled.has(branch)
  const branchOf = (branch: number | null) => (branch === null ? {} : { branch: { agent, id: branch } })
  const refunds = (branch: number, left: bigint | null) => {
    const held = new Map<string, { amount: bigint; budget: number; contributor: Address; since: number | null }>()
    for (const each of steers.filter((row) => row.branch === branch)) {
      const key = each.contributor + '/' + each.budget
      const found = held.get(key) ?? { amount: 0n, budget: each.budget, contributor: each.contributor, since: null }
      found.amount += each.amount
      if (each.amount > 0n) found.since = found.since === null ? each.at : Math.min(found.since, each.at)
      held.set(key, found)
    }
    const nets = new Map<string, { net: bigint; positive: bigint }>()
    for (const each of held.values()) {
      const found = nets.get(each.contributor) ?? { net: 0n, positive: 0n }
      found.net += each.amount
      if (each.amount > 0n) found.positive += each.amount
      nets.set(each.contributor, found)
    }
    const total = Flow.sum([...nets.values()].map((each) => (each.net > 0n ? each.net : 0n)))
    const scale = left === null || left > total ? total : left
    const out: { amount: bigint; at: number; budget: number; contributor: Address }[] = []
    for (const each of held.values()) {
      const net = nets.get(each.contributor) ?? { net: 0n, positive: 0n }
      if (net.net <= 0n || each.amount <= 0n || total <= 0n) continue
      const amount = (((scale * net.net) / total) * each.amount) / net.positive
      if (amount > 0n) out.push({ amount, at: each.budget === 1 ? (each.since ?? now) : now, budget: each.budget, contributor: each.contributor })
    }
    return out
  }
  const takeBack = (c: Address, step: number) => {
    const excess = own(c) - unnoted(c)
    const held = new Map<string, { at: number; branch: number | null; net: bigint; note: string }>()
    for (const each of steers.filter((row) => row.contributor === c && row.budget === 0 && live(row.branch))) {
      const key = each.note + '/' + each.branch
      const found = held.get(key) ?? { at: each.at, branch: each.branch, net: 0n, note: each.note }
      found.net += each.amount
      found.at = Math.max(found.at, each.at)
      held.set(key, found)
    }
    const ranked = [...held.values()].filter((each) => each.net > 0n).sort((a, b) => b.at - a.at || (a.note < b.note ? -1 : a.note > b.note ? 1 : 0))
    const branches: number[] = []
    let before = 0n
    for (const each of ranked) {
      if (excess > before) {
        const take = each.net < excess - before ? each.net : excess - before
        steers.push({ amount: -take, at: now, branch: each.branch, budget: 0, contributor: c, id: 'lower:' + step + ':' + each.note, note: each.note })
        if (each.branch !== null) branches.push(each.branch)
      }
      before += each.net
    }
    return branches
  }
  const compare = async (what: string) => {
    const members = (await Store.members(env, 's')).map((member) => [member.address, member.backed, member.steered, member.available]).sort()
    const wantMembers = riders
      .filter((c) => of(c).length)
      .map((c) => {
        const backed = Flow.sum(of(c).map((gift) => gift.amount))
        const steered = backed - unnoted(c) + own(c)
        return [c, Flow.usd(backed), Flow.usd(steered), Flow.usd(backed > steered ? backed - steered : 0n)]
      })
      .sort()
    if (show(members) !== show(wantMembers)) fail('members', what + ' ' + show(members) + ' expected ' + show(wantMembers))
    const money = await Store.funds(env, 's', agent)
    const shares = [...money.shares].flatMap(([branch, each]) => [...each].map(([c, amount]) => [branch, c, String(amount)])).sort()
    const wantShares = new Map<string, bigint>()
    for (const each of steers) if (each.branch !== null) add(wantShares, each.branch + '/' + each.contributor, each.amount)
    const expect = [...wantShares].map(([key, amount]) => [Number(key.split('/')[0]), key.split('/')[1], String(amount)]).sort()
    if (show(shares) !== show(expect)) fail('shares', what + ' ' + show(shares) + ' expected ' + show(expect))
    if (show([...money.settled].sort()) !== show([...settled].sort()))
      fail('settled', what + ' ' + show([...money.settled]) + ' expected ' + show([...settled]))
    const since = now - L.windowMs
    const allotted = [...(await Store.allotted(env, 's', since))].sort()
    const wantAllotted = new Map<string, bigint>()
    for (const each of steers) if (each.budget === 1 && each.at > since) add(wantAllotted, each.contributor, each.amount)
    if (show(allotted) !== show([...wantAllotted].sort())) fail('allotted', what + ' ' + show(allotted) + ' expected ' + show([...wantAllotted].sort()))
    const notes = (await Store.notes(env, 's', raised(), new Set())).map((note) => [note.id, note.weight, note.share]).sort()
    const weights = new Map<string, bigint>()
    for (const gift of gifts.values()) if (gift.note !== null) add(weights, gift.note, gift.amount)
    for (const each of steers) if (each.branch === null) add(weights, each.note, each.amount)
    const wantNotes = [...weights]
      .filter(([, weight]) => weight > 0n)
      .map(([id, weight]) => [id, Flow.usd(weight), raised() > 0n ? Number((weight * 10_000n) / raised()) / 10_000 : 0])
      .sort()
    if (show(notes) !== show(wantNotes)) fail('notes', what + ' ' + show(notes) + ' expected ' + show(wantNotes))
    const replaced = await Store.replaced(env, 's', 'next')
    const open = [...new Set(steers.flatMap((each) => (each.branch !== null && !settled.has(each.branch) ? [each.branch] : [])))].sort()
    const got = replaced.map((each) => [each.agent, [...each.branches].sort()])
    if (show(got) !== show(open.length ? [[agent, open]] : [])) fail('replaced', what + ' ' + show(got) + ' expected ' + show(open))
  }
  let steps = 0
  try {
    for (; steps < L.ops; steps++) {
      now += random.chance(L.jump) ? L.windowMs : random.int(1, L.tickMs)
      const c = random.pick(riders)
      const op = random.pick([
        'give',
        'give',
        'steer',
        'fund',
        'fund',
        'allot',
        'shift',
        'shift',
        'settle',
        'unsteer',
        'lower',
        'lower',
        'lower',
        'annotate',
      ] as const)
      const branch = random.int(1, L.branches)
      const amount = BigInt(random.int(1, L.units)) * L.unit
      const what = op + ' at ' + steps + ' by ' + c.slice(0, 4)
      if (op === 'give') {
        const backing = random.chance(0.5)
        const id = backing ? 'backing:0xk' + steps : '0xg' + steps
        const note = !backing && random.chance(0.25) ? random.pick(L.notes) : null
        const channel = backing ? (`0xk${steps}` as const) : null
        const gift = await Store.give(env, {
          amount: String(amount),
          channel,
          contributor: c,
          id,
          note: note && 'idea ' + note,
          note_id: note,
          swarm: 's',
          token: backing ? 'mach' : 'ousd',
        })
        if (!gift) fail('given', what + ' ' + id + ' not counted')
        gifts.set(id, { amount, channel, contributor: c, id, note })
      }
      if (op === 'steer' || op === 'fund' || op === 'allot') {
        const placed = steers.filter((each) => each.id.startsWith('x'))
        const id = placed.length && random.chance(0.1) ? random.pick(placed).id : 'x' + steps
        const target = op === 'fund' || (op === 'allot' && random.chance(0.5)) ? branch : null
        const note = target === null ? random.pick(L.notes) : 'branch:' + target
        const fresh = !steers.some((each) => each.id === id)
        const limit = random.chance(0.5) ? null : BigInt(random.int(1, L.limitUnits)) * L.unit
        const since = now - L.windowMs
        const used = Flow.sum(steers.filter((each) => each.contributor === c && each.budget === 1 && each.at > since).map((each) => each.amount))
        const want = op === 'allot' ? fresh && used + amount <= (limit ?? raised()) && live(target) : fresh && free(c) >= amount && live(target)
        const got =
          op === 'allot'
            ? await Store.allot(env, { amount, ...branchOf(target), contributor: c, id, limit, note: 'idea', note_id: note, since, swarm: 's' })
            : await Store.steer(env, { amount, ...branchOf(target), contributor: c, id, note: 'idea', note_id: note, swarm: 's' })
        if (got !== want)
          fail(op === 'allot' ? 'allot' : 'steer', what + ' ' + show({ amount, free: free(c), fresh, limit, raised: raised(), target, used }) + ' got ' + got)
        if (got) {
          steers.push({ amount, at: now, branch: target, budget: op === 'allot' ? 1 : 0, contributor: c, id, note })
          if (target !== null) groups.push([id])
        }
      }
      if (op === 'shift') {
        const to = random.pick(Array.from({ length: L.branches }, (_, n) => n + 1).filter((each) => each !== branch))
        const from = steers.filter((each) => each.contributor === c && each.branch === branch)
        const mine = Flow.sum(from.filter((each) => each.budget === 0).map((each) => each.amount))
        const team = from.filter((each) => each.budget === 1 && each.amount > 0n).map((each) => each.at)
        const ok = Flow.sum(from.map((each) => each.amount)) >= amount && live(branch) && live(to)
        const first = mine < 0n ? 0n : mine < amount ? mine : amount
        const legs = ok
          ? (
              [
                [0, first, now],
                [1, amount - first, team.length ? Math.min(...team) : now],
              ] as const
            ).flatMap(([budget, part, at]) => (part > 0n ? [branch + '/' + budget + '/' + -part + '/' + at, to + '/' + budget + '/' + part + '/' + at] : []))
          : []
        const ids = await Store.shift(env, { agent, amount, contributor: c, from: branch, swarm: 's', to })
        const rows = ids.length
          ? d1.sqlite.prepare('select id, branch, budget, amount, created_at from steers where id in (' + ids.map(() => '?').join(', ') + ')').all(...ids)
          : []
        const got = rows.map((row) => row['branch'] + '/' + row['budget'] + '/' + row['amount'] + '/' + row['created_at']).sort()
        if (show(got) !== show([...legs].sort())) fail('shift', what + ' ' + branch + '>' + to + ' ' + amount + ' got ' + show(got) + ' expected ' + show(legs))
        for (const row of rows)
          steers.push({
            amount: BigInt(String(row['amount'])),
            at: Number(row['created_at']),
            branch: Number(row['branch']),
            budget: Number(row['budget']),
            contributor: c,
            id: String(row['id']),
            note: 'branch:' + row['branch'],
          })
        if (ids.length) groups.push(ids)
      }
      if (op === 'settle') {
        const left = random.chance(0.25) ? null : BigInt(random.int(0, 2 * L.units)) * L.unit + (random.chance(0.3) ? 1n : 0n)
        const breaking = random.chance(L.breaks)
        const want = settled.has(branch) ? [] : refunds(branch, left)
        failing.next = breaking
        const got = await Store.settle(env, { agent, branch, left, swarm: 's' }).then(
          (rows) => rows,
          () => null,
        )
        failing.next = false
        if (breaking && got !== null) fail('settle atomic', what + ' a failed settle returned ' + show(got))
        if (!breaking) {
          const shown = (got ?? []).map((each) => each.contributor + '/' + each.budget + '/' + each.amount).sort()
          const expect = want.map((each) => each.contributor + '/' + each.budget + '/' + each.amount).sort()
          if (show(shown) !== show(expect)) fail('settle', what + ' branch ' + branch + ' left ' + left + ' got ' + show(shown) + ' expected ' + show(expect))
          for (const each of want)
            steers.push({
              amount: -each.amount,
              at: each.at,
              branch,
              budget: each.budget,
              contributor: each.contributor,
              id: 'settle:' + branch + ':' + each.contributor + ':' + each.budget,
              note: 'branch:' + branch,
            })
          settled.add(branch)
        }
      }
      if (op === 'unsteer' && groups.length) {
        const group = random.pick(groups)
        const blocked = steers.some((each) => group.includes(each.id) && each.branch !== null && settled.has(each.branch))
        await Store.unsteer(env, group)
        if (!blocked) steers.splice(0, steers.length, ...steers.filter((each) => !group.includes(each.id)))
      }
      const backings = [...gifts.values()].filter((gift) => gift.channel !== null)
      if (op === 'lower' && backings.length) {
        const gift = random.pick(backings)
        const stale = random.chance(0.2)
        const was = stale ? gift.amount + L.unit : gift.amount
        const to = BigInt(random.int(0, Number(gift.amount / L.unit))) * L.unit
        const got = await Store.lower(env, 's', gift.id, String(to), String(was))
        if (stale && got !== null) fail('lowered', what + ' a stale lower of ' + gift.id + ' from ' + was + ' landed')
        if (!stale) {
          gift.amount = to
          const want = takeBack(gift.contributor, steps)
          if (show((got ?? []).map((each) => each.branch).sort()) !== show(want.sort()))
            fail('lowered', what + ' ' + gift.id + ' to ' + to + ' took back from ' + show(got) + ' expected ' + show(want))
        }
      }
      const plain = [...gifts.values()].filter((gift) => gift.note === null)
      if (op === 'annotate' && plain.length) {
        const gift = random.pick(plain)
        const note = random.pick(L.notes)
        const want = free(gift.contributor) >= gift.amount
        if (await Store.annotate(env, 'other', gift.id, { note: 'idea ' + note, note_id: note }))
          fail('annotate', what + ' ' + gift.id + ' noted from another swarm')
        const got = await Store.annotate(env, 's', gift.id, { note: 'idea ' + note, note_id: note })
        if (!!got !== want) fail('annotate', what + ' ' + gift.id + ' free ' + free(gift.contributor) + ' got ' + !!got)
        if (got) gift.note = note
        const logged = d1.log.findLast((entry) => /update contributions set note/.test(entry.query))
        const plan = logged ? d1.plan(logged).join('; ') : ''
        if (!plan.includes('contributions_backing (swarm=? AND contributor=?)')) fail('indexed', what + ' ' + plan)
      }
      await compare(what)
    }
    await settledTakeBack(random, fail)
  } finally {
    Date.now = real
  }
  return { steps, violations }
}

async function gatewayMoney(seed: string): Promise<Outcome> {
  const random = rng(seed, 'gateway_money')
  const { fail, violations } = recorder()
  const G = limits.gateway
  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'cloudflare:workers'
        ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' }
        : next(specifier, context),
  })
  const Money = (await import('../../src/worker/Money.ts')) as typeof MoneyModule
  const { fresh } = await import('../board.ts')
  const d1 = world()
  const env = d1.env
  const keys = Array.from({ length: G.keys }, (_, n) => ({
    backer: random.pick(riders),
    ended: false,
    key: ('0x' + 'd'.repeat(39) + n) as Address,
    limit: BigInt(random.int(1, G.units)) * G.unit,
    spent: 0n,
    stale: false,
  }))
  for (const each of keys)
    if (random.chance(G.known))
      await Store.give(env, {
        amount: String(each.limit),
        channel: each.key,
        contributor: each.backer,
        id: 'backing:' + each.key,
        note: null,
        note_id: null,
        swarm: 's1',
        token: 'mach',
      })
  const deposits: { amount: string; created_at: number; from: string; hash: string; log: number; tag: string; token: string }[] = []
  const asked = { deposits: 0, deposited: 0n }
  const budgets: string[] = []
  const others: string[] = []
  const told: string[] = []
  const logged: string[] = []
  const stored = new Map<string, unknown>()
  const lefts = () => keys.map((each) => (each.ended && !each.stale ? 0n : each.limit - each.spent))
  const self = {
    agent: () => ({ id: agent }),
    beacon: () => undefined,
    board: fresh('swarm:mb'),
    changed: () => undefined,
    contributed: async (input: { hash: string }) => void told.push(input.hash),
    env: {
      ...env,
      GATEWAY: {
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname
          if (path === '/api/keys/credit') return Response.json({ deposited: Flow.usd(asked.deposited), left: Flow.usd(G.pool), spent: Flow.usd(0n) })
          if (path === '/api/keys/credit/deposits') {
            asked.deposits += 1
            return Response.json({ deposits })
          }
          if (path === '/api/keys/backings')
            return Response.json({
              backings: keys.map((each, n) => ({
                backer: each.backer,
                createdAt: 1,
                ended: each.ended,
                expiresAt: null,
                key: each.key,
                left: Flow.usd(lefts()[n] ?? 0n),
                limit: Flow.usd(each.limit),
                spent: Flow.usd(each.spent),
                tag: null,
                token: 'mach',
              })),
              left: Flow.usd(Flow.sum(lefts().map((left) => (left > 0n ? left : 0n)))),
              spent: Flow.usd(Flow.sum(keys.map((each) => each.spent))),
            })
          const budget = /^\/v1\/agents\/([^/]+)\/subagents\/(\d+)\/budget$/.exec(path)
          if (budget) {
            const body = (await request.json()) as { budget_usd: number }
            if (budget[1] === agent) budgets.push(budget[2] + '=' + body.budget_usd)
            else others.push(path)
            return Response.json({ agent: {} })
          }
          return Response.json({ error: 'not here' }, { status: 404 })
        },
      },
      GATEWAY_URL: 'https://gateway.test',
      SWARMS_GATEWAY_KEY: 'test',
    },
    kv: { get: (name: string) => stored.get(name), put: (name: string, value: unknown) => void stored.set(name, value) },
    log: (_kind: string, text: string) => void logged.push(text),
    remember: () => undefined,
    turn: () => false,
  }
  const bases = new Map<number, bigint>()
  for (let branch = 1; branch <= G.branches; branch++)
    if (random.chance(G.based)) {
      const base = BigInt(random.int(1, G.units)) * G.unit
      await Store.base(env, 's1', agent, branch, base)
      bases.set(branch, base)
    }
  const behind = async () => {
    const money = await Store.funds(env, 's1', agent)
    return new Map([...money.shares].map(([branch, each]) => [branch, Flow.sum(each.values())]))
  }
  let steps = 0
  for (; steps < G.rounds; steps++) {
    const lhs = BigInt(random.int(0, G.units)) * G.unit
    const balance = random.int(0, G.units) * Number(G.unit)
    const used = random.int(0, G.units) * Number(G.unit)
    const room = Money.room(lhs, { balance, spent: used })
    if (room !== (lhs < BigInt(balance - used) ? lhs : BigInt(balance - used)))
      fail('room', lhs + ' with ' + balance + ' raised and ' + used + ' spent gave ' + room)
    if (steps && steps < G.rounds - 1)
      for (const each of keys) {
        if (!each.ended && random.chance(G.spend)) {
          const next = each.spent + BigInt(random.int(1, G.units)) * (G.unit / 2n)
          const most = each.limit + BigInt(G.over) * G.unit
          each.spent = next < most ? next : most
        }
        if (each !== keys[0] && random.chance(G.end)) {
          each.ended = true
          each.stale = random.chance(0.5)
        }
      }
    if (steps === G.rounds - 1) {
      const rider = random.pick(riders)
      const probe = { backer: rider, ended: false, key: ('0x' + 'e'.repeat(40)) as Address, limit: 3n * G.unit, spent: 0n, stale: false }
      await Store.give(env, {
        amount: String(probe.limit),
        channel: probe.key,
        contributor: rider,
        id: 'backing:' + probe.key,
        note: null,
        note_id: null,
        swarm: 's1',
        token: 'mach',
      })
      await Store.base(env, 's1', agent, G.branches + 1, G.unit)
      bases.set(G.branches + 1, G.unit)
      const targets = [
        [agent, G.branches + 1],
        [agent, G.branches + 2],
        ['old', G.branches + 1],
      ] as const
      for (const [n, [who, branch]] of targets.entries())
        await Store.steer(env, {
          amount: G.unit,
          branch: { agent: who, id: branch },
          contributor: rider,
          id: 'probe' + n,
          note: 'branch',
          note_id: 'branch:' + branch,
          swarm: 's1',
        })
      probe.ended = true
      keys.push(probe)
    }
    if (random.chance(G.deposit)) {
      const hash = '0x' + seed + 'e' + steps
      const from = random.pick(riders)
      const amount = BigInt(random.int(1, G.units)) * (G.unit / 4n)
      const logs = random.chance(G.split) ? 2 : 1
      for (let log = 0; log < logs; log++)
        deposits.push({
          amount: Flow.usd(amount),
          created_at: steps,
          from: random.chance(0.5) ? shout(from) : from,
          hash: log ? shout(hash) : hash,
          log,
          tag: '0x' + '00'.repeat(16),
          token: random.pick(['ousd', 'pathusd']),
        })
      asked.deposited += amount * BigInt(logs)
      if (random.chance(G.counted))
        await Store.give(env, { amount: String(amount), channel: null, contributor: from, id: hash, note: null, note_id: null, swarm: 's1', token: 'ousd' })
    }
    if (random.chance(G.steer)) {
      const rider = random.pick(riders)
      const branch = random.int(1, G.branches)
      const where = random.pick(['idea', 'branch', 'branch', 'old'] as const)
      await Store.steer(env, {
        amount: BigInt(random.int(1, G.units)) * (G.unit / 2n),
        ...(where === 'idea' ? {} : { branch: { agent: where === 'old' ? 'old' : agent, id: branch } }),
        contributor: rider,
        id: 'g' + steps,
        note: 'idea',
        note_id: where === 'idea' ? 'n1' : 'branch:' + branch,
        swarm: 's1',
      })
    }
    const held = new Map((await Store.backings(env, 's1')).map((gift) => [gift.id, BigInt(gift.amount)]))
    const was = await behind()
    const hashes = [...new Set(deposits.map((each) => each.hash.toLowerCase()))]
    const counted = await Store.counted(env, hashes)
    const last = stored.get('deposited')
    const askedBefore = asked.deposits
    budgets.length = 0
    others.length = 0
    told.length = 0
    logged.length = 0
    const row = await Store.find(env, 's1')
    if (!row) return { steps, violations: [{ detail: 'no swarm', invariant: 'pool' }] }
    const money = await Money.refresh(self as never, row, { credit: true, hands: false })
    const lines: string[] = []
    for (const [n, each] of keys.entries()) {
      const id = 'backing:' + each.key
      const had = held.get(id)
      let want: bigint | undefined
      if (had === undefined) {
        want = each.spent > 0n ? each.spent : undefined
        if (want !== undefined)
          lines.push('A key ' + Words.short(each.backer) + ' approved at the gateway paid $' + Words.trim(Flow.usd(each.spent)) + ' for the swarm')
      } else {
        const left = lefts()[n] ?? 0n
        const worth = each.ended ? each.spent : each.spent + (left > 0n ? left : 0n)
        want = had > worth ? worth : had < each.spent ? each.spent : had
        if (want < had)
          lines.push(
            each.ended
              ? Words.short(each.backer) + "'s backing ended after paying $" + Words.trim(Flow.usd(want)) + '; the rest never left their wallet'
              : Words.short(each.backer) +
                  "'s approval of $" +
                  Words.trim(Flow.usd(each.limit)) +
                  ' can pay $' +
                  Words.trim(Flow.usd(want)) +
                  " in all; the rest is out of the swarm's reach and stays theirs",
          )
      }
      const now = (await Store.gift(env, id))?.amount
      if ((now === undefined ? undefined : BigInt(now)) !== want)
        fail('backing counted', 'round ' + steps + ' ' + show({ ended: each.ended, had, limit: each.limit, now, spent: each.spent, want }))
    }
    const said = logged.filter((text) => /approved at the gateway paid|backing ended after paying|can pay \$/.test(text)).sort()
    if (show(said) !== show(lines.sort())) fail('logged', 'round ' + steps + ' ' + show(said) + ' expected ' + show(lines))
    for (const member of await Store.members(env, 's1'))
      if (Number(member.steered) > Number(member.backed))
        fail('overcommitted', 'round ' + steps + ' ' + member.address + ' steers ' + member.steered + ' of ' + member.backed)
    const is = await behind()
    const wantBudgets = [...bases]
      .filter(([branch]) => (is.get(branch) ?? 0n) < (was.get(branch) ?? 0n))
      .map(([branch, base]) => {
        const total = base + (is.get(branch) ?? 0n)
        return branch + '=' + Number(total > 0n ? total : 1n) / 1_000_000
      })
      .sort()
    const posted = new Map<number, number[]>()
    for (const one of budgets) {
      const [branch, value] = one.split('=').map(Number) as [number, number]
      posted.set(branch, [...(posted.get(branch) ?? []), value])
    }
    const finals = [...posted].map(([branch, values]) => branch + '=' + values.at(-1)).sort()
    const climbed = [...posted].filter(([branch, values]) =>
      values.some((value, n) => value > (n ? (values[n - 1] ?? 0) : Number((bases.get(branch) ?? 0n) + (was.get(branch) ?? 0n)) / 1_000_000)),
    )
    if (show(finals) !== show(wantBudgets) || climbed.length || others.length)
      fail('budget', 'round ' + steps + ' ' + show(budgets) + ' expected ' + show(wantBudgets) + ', never climbing, and to others ' + show(others))
    const fetch = asked.deposited > 0n && last !== Flow.usd(asked.deposited)
    if (asked.deposits - askedBefore !== (fetch ? 1 : 0))
      fail(
        'asked',
        'round ' + steps + ' deposits asked ' + (asked.deposits - askedBefore) + ' times, deposited ' + Flow.usd(asked.deposited) + ' after ' + last,
      )
    const fresh = fetch ? hashes.filter((hash) => !counted.has(hash)) : []
    if (show([...told].sort()) !== show(fresh.sort())) fail('recovered', 'round ' + steps + ' told ' + show(told) + ' expected ' + show(fresh))
    for (const hash of fresh) {
      const logs = deposits.filter((each) => each.hash.toLowerCase() === hash)
      const gift = await Store.gift(env, hash)
      const first = logs[0]
      const amount = String(Flow.sum(logs.map((each) => BigInt(Math.round(Number(each.amount) * 1_000_000)))))
      if (!first || gift?.amount !== amount || gift.contributor !== first.from.toLowerCase() || gift.token !== first.token)
        fail('recovered', 'round ' + steps + ' ' + hash + ' counted as ' + show(gift) + ' from ' + show(logs))
    }
    const after = await Store.find(env, 's1')
    const pool = [after?.pool_left, after?.pool_spent, after?.sponsor_left, after?.sponsor_spent].map(Number)
    const wantPool = [G.pool, 0n, Flow.sum(lefts().map((left) => (left > 0n ? left : 0n))), Flow.sum(keys.map((each) => each.spent))].map(Number)
    if (show(pool) !== show(wantPool)) fail('pool', 'round ' + steps + ' ' + show(pool) + ' expected ' + show(wantPool))
    const reach = G.pool + Flow.sum(lefts().map((left) => (left > 0n ? left : 0n)))
    if (after && money.left !== Money.room(reach, after))
      fail('left', 'round ' + steps + ' left ' + money.left + ' for ' + reach + ' within reach and ' + after.balance + ' raised, ' + after.spent + ' spent')
  }
  return { steps, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  gateway_money: gatewayMoney,
  gateway_overdraw: overdraw,
  backing_lower: backingLower,
  branch_money: branchMoney,
  flow_ledger: flowLedger,
  flow_pay: flowPay,
  pay_steps: paySteps,
  transfer_once: transferOnce,
}

function flag<T extends Record<string, boolean>>(guards: T, key: keyof T) {
  return () => {
    guards[key] = false as T[keyof T]
    return () => {
      guards[key] = true as T[keyof T]
    }
  }
}

function racyWrite() {
  const write = lanes.write
  lanes.write = readThenWrite
  return () => {
    lanes.write = write
  }
}

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: flag(Flow.guards, 'covered'), invariant: 'covered', name: 'mb.flow.covered', scenario: 'flow_ledger', seeds: ['1', '2', '3'] },
  { flip: flag(Flow.guards, 'covered'), invariant: 'overspent', name: 'mb.pay.covered', scenario: 'flow_pay', seeds: ['1', '2', '3'] },
  { flip: racyWrite, invariant: 'ledger', name: 'mb.pay.racy', scenario: 'flow_pay', seeds: ['1', '2', '3'] },
  { flip: flag(Payment.guards, 'keyed'), invariant: 'keyed', name: 'mb.pay.keyed', scenario: 'flow_pay', seeds: ['1', '2', '3'] },
  { flip: flag(Payment.guards, 'closed'), invariant: 'effects once', name: 'mb.pay.closed', scenario: 'flow_pay', seeds: ['1', '2', '3'] },
  { flip: flag(Payment.guards, 'keyed'), invariant: 'keyed id', name: 'mb.steps.keyed', scenario: 'pay_steps', seeds: ['1', '2', '3'] },
  { flip: flag(Payment.guards, 'told'), invariant: 'told once', name: 'mb.transfer.told', scenario: 'transfer_once', seeds: ['1', '2', '3'] },
  { flip: flag(Payment.guards, 'fenced'), invariant: 'lowered', name: 'mb.branch.fenced', scenario: 'branch_money', seeds: ['1', '2', '3'] },
  { flip: flag(Payment.guards, 'fenced'), invariant: 'lower only', name: 'mb.backing.fenced', scenario: 'backing_lower', seeds: ['1', '2', '3'] },
  { flip: flag(order, 'fresh'), invariant: 'remaining', name: 'mb.overdraw.stale', scenario: 'gateway_overdraw', seeds: ['1', '2', '3'] },
]
