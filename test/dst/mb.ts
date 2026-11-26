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
  backing: { floors: 8, racers: 4, reach: [9_000_000n, 7_000_000n, 6_000_000n, 4_000_000n], refreshes: 2 },
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  gateway_overdraw: overdraw,
  backing_lower: backingLower,
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
  { flip: flag(Payment.guards, 'fenced'), invariant: 'lower only', name: 'mb.backing.fenced', scenario: 'backing_lower', seeds: ['1', '2', '3'] },
  { flip: flag(order, 'fresh'), invariant: 'remaining', name: 'mb.overdraw.stale', scenario: 'gateway_overdraw', seeds: ['1', '2', '3'] },
]
