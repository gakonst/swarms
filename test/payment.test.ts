import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Flow from '../src/worker/Flow.ts'
import * as Payment from '../src/worker/machines/Payment.ts'
import * as Store from '../src/worker/Store.ts'
import { open } from './d1.ts'

// A seeded simulation of the money paths: real D1 statements on SQLite, one
// object's storage that survives a crash at any await, and riders whose pages
// retry, duplicate and replay every request. Every invariant has a mutant: the
// same run with one guard turned off must go red.

const riders = ['0x' + 'a'.repeat(40), '0x' + 'b'.repeat(40), '0x' + 'c'.repeat(40)]
const nodes = [Flow.free, 'root', 'n1', 'n2']

function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Crash extends Error {}

function storage() {
  const map = new Map<string, unknown>()
  return {
    delete: (key: string) => map.delete(key),
    get: <T>(key: string) => (map.has(key) ? (structuredClone(map.get(key)) as T) : undefined),
    map,
    put: (key: string, value: unknown) => void map.set(key, structuredClone(value)),
  }
}

function world() {
  const d1 = open()
  d1.sqlite.exec("insert into swarms (id, title, goal, created_at, updated_at, form) values ('s1', 't', 'g', 0, 0, 'tree')")
  return d1
}

// Each await on the network is a gate the scheduler opens in a seeded order,
// and at each a crash can stop the request: the object restarts on the same
// storage and the rider's page tries again.
function scheduler(rand: () => number, crashRate: number) {
  const pending: { crash: boolean; resolve: (crashed: boolean) => void }[] = []
  const rate = { crash: crashRate }
  const gate = async () => {
    const crashed = await new Promise<boolean>((resolve) => pending.push({ crash: rand() < rate.crash, resolve }))
    if (crashed) throw new Crash('restart')
  }
  const run = async (work: Promise<unknown>[]) => {
    let done = 0
    for (const each of work) void each.finally(() => (done += 1)).catch(() => undefined)
    while (done < work.length) {
      await new Promise((resolve) => setImmediate(resolve))
      if (!pending.length) continue
      const next = pending.splice(Math.floor(rand() * pending.length), 1)[0]
      next?.resolve(next.crash)
    }
  }
  return { gate, rate, run }
}

type Act = { amount: bigint; contributor: string; from: string | null; fromRun?: string; id: string; key: string; kind: 'commit' | 'move' | 'pledge' | 'spend'; to: string | null; toRun?: string }

type Write = (env: Cloudflare.Env, input: Parameters<typeof Flow.write>[1], gate: () => Promise<void>) => Promise<boolean>

async function brokenWrite(...[env, input, gate]: Parameters<Write>) {
  if (input.from) {
    const rows = await Flow.rows(env, input.swarm)
    for (const [contributor, amount] of input.parts) if ((Flow.shares(rows, input.from).get(contributor.toLowerCase()) ?? 0n) < amount) return false
    await gate()
  }
  return Flow.write(env, { ...input, from: null, to: input.to }).then(async (wrote) => {
    if (wrote && input.from) await Flow.write(env, { ...input, from: null, id: input.id + ':out', parts: input.parts.map(([c, a]) => [c, -a] as const), to: input.from })
    return wrote
  })
}

async function simulate(seed: number, options: { crash?: number; write?: Write } = {}) {
  const rand = random(seed)
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T
  const d1 = world()
  const kv = storage()
  const { gate, rate, run } = scheduler(rand, options.crash ?? 0.15)
  const write: Write = options.write ?? ((env, input) => Flow.write(env, input))
  const seen = new Set<string>()
  const acts: Act[] = []
  for (let n = 0; n < 6; n++) acts.push({ amount: BigInt(1 + Math.floor(rand() * 9)) * 1_000_000n, contributor: pick(riders), from: null, id: '0xh' + seed + n, key: '0xh' + seed + n, kind: 'pledge', to: pick(nodes) })
  for (let n = 0; n < 10; n++) {
    const from = pick(nodes)
    const to = pick(nodes.filter((node) => node !== from))
    acts.push({ amount: BigInt(1 + Math.floor(rand() * 6)) * 1_000_000n, contributor: pick(riders), from, id: '', key: 'k' + seed + 'x' + n, kind: 'move', to })
  }
  for (let n = 0; n < 2; n++) acts.push({ amount: BigInt(1 + Math.floor(rand() * 12)) * 1_000_000n, contributor: pick(riders), from: pick(nodes), id: 'spend:' + seed + n, key: 'spend' + n, kind: 'spend', to: null })
  for (let n = 0; n < 4; n++) {
    const node = pick(nodes)
    const run = node + ':r' + n
    const contributor = pick(riders)
    acts.push({ amount: BigInt(1 + Math.floor(rand() * 8)) * 1_000_000n, contributor, from: node, id: 'commit:' + seed + n, key: 'commit' + n, kind: 'commit', to: node, toRun: run })
    acts.push({ amount: BigInt(1 + Math.floor(rand() * 20)) * 500_000n, contributor, from: node, fromRun: run, id: 'used:' + seed + n, key: 'used' + n, kind: 'spend', to: null })
  }
  const answers = new Map<string, string[]>()
  const ledgerOk: boolean[] = []
  const withinRaised: boolean[] = []

  const used = new Map<string, Set<string>>()
  const attempt = async (act: Act) => {
    const id = act.kind === 'move' ? Payment.id('move', act.from + '>' + act.to, act.contributor, act.key) : act.id
    used.set(act.key, (used.get(act.key) ?? new Set()).add(id))
    const slot = act.kind === 'pledge' ? 'pledge:' + id : id
    const done = await Payment.settle(
      kv,
      slot,
      {
        write: async () => {
          await gate()
          const wrote = await write(d1.env, { from: act.from === null ? null : { node: act.from, run: act.fromRun ?? null }, id, kind: act.kind, parts: [[act.contributor, act.amount]], swarm: 's1', to: act.to === null ? null : { node: act.to, run: act.toRun ?? null } }, gate)
          const rows = await Flow.rows(d1.env, 's1')
          ledgerOk.push(Payment.balanced(Payment.audit(rows)))
          withinRaised.push(Payment.raised(rows))
          await gate()
          return wrote
        },
        written: async () => {
          await gate()
          return Flow.written(d1.env, 's1', id)
        },
      },
      () => {
        seen.add(done_key(act))
        kv.put('fx:' + act.key, (kv.get<number>('fx:' + act.key) ?? 0) + 1)
      },
    )
    return done.at
  }
  const done_key = (act: Act) => act.kind + ':' + act.key

  const client = async (act: Act) => {
    const said: string[] = []
    for (let tries = 0; tries < 40; tries++) {
      const copies = rand() < 0.25 ? 2 : 1
      const results = await Promise.allSettled(Array.from({ length: copies }, () => attempt(act)))
      const settled = results.flatMap((each) => (each.status === 'fulfilled' ? [each.value] : []))
      for (const each of results) if (each.status === 'rejected' && !(each.reason instanceof Crash) && !(each.reason instanceof Payment.Busy)) throw each.reason
      said.push(...settled)
      if (settled.includes('paid') || (settled.includes('refused') && !settled.includes('paid'))) break
    }
    if (rand() < 0.5) said.push('stale:' + (await attempt(act).catch((error: unknown) => (error instanceof Crash ? 'crashed' : 'error'))))
    answers.set(act.key, said)
  }
  await run(acts.map((act) => client(act)))
  rate.crash = 0
  await run(acts.map(async (act) => answers.get(act.key)?.push('drained:' + (await attempt(act)))))

  const rows = await Flow.rows(d1.env, 's1')
  const audit = Payment.audit(rows)
  const flows = d1.sqlite.prepare("select id from flows where swarm = 's1'").all().map((row) => String(row['id']))
  const faults: string[] = []
  if (ledgerOk.includes(false) || !Payment.balanced(audit)) faults.push('ledger')
  if (withinRaised.includes(false) || !Payment.raised(rows)) faults.push('overspent')
  for (const act of acts) {
    const said = answers.get(act.key) ?? []
    const effects = kv.get<number>('fx:' + act.key) ?? 0
    const landed = [...(used.get(act.key) ?? [])].filter((id) => flows.some((row) => row.startsWith('s1:' + id + ':')))
    if (landed.length > 1) faults.push('keyed ' + act.key)
    const paid = said.some((each) => each.endsWith('paid'))
    if (paid && effects !== 1) faults.push('effects ' + act.key + ' ' + effects)
    if (!paid && effects !== 0) faults.push('effects without paid ' + act.key)
    if (act.kind === 'pledge' && !paid) faults.push('pledge never counted ' + act.key)
  }
  const pledged = acts.filter((act) => act.kind === 'pledge').reduce((sum, act) => sum + act.amount, 0n)
  if (audit.pledged !== pledged) faults.push('counted ' + audit.pledged + ' of ' + pledged)
  if ([...kv.map.keys()].some((key) => key.startsWith('pay:'))) faults.push('open payments left')
  return { answers, audit, faults }
}

const seeds = Array.from({ length: 60 }, (_, n) => n + 1)

test('every transition of a payment, and only those, is allowed', () => {
  const states: Payment.Payment[] = [
    { at: 'owed', id: 'p', tries: 0 },
    { at: 'paying', id: 'p', resumed: false, tries: 1, until: 10 },
    { at: 'paid', id: 'p', landed: true },
    { at: 'refused', id: 'p', why: 'x' },
  ]
  const events: Payment.Event[] = [{ now: 5, type: 'pay' }, { type: 'landed' }, { type: 'found' }, { type: 'short', why: 'x' }, { type: 'lost' }, { now: 5, type: 'expired' }, { now: 10, type: 'expired' }]
  const table = states.map((state) => events.map((event) => Payment.step(state, event)?.at ?? null))
  assert.deepEqual(table, [
    ['paying', null, null, null, null, null, null],
    ['paying', 'paid', 'paid', 'refused', 'owed', null, 'owed'],
    [null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null],
  ])
  assert.deepEqual(Payment.step(states[1] as Payment.Payment, { type: 'found' }), { at: 'paid', id: 'p', landed: false })
})

test('every transition of a transfer, and only those, is allowed', () => {
  const states: Payment.Transfer[] = [
    { at: 'seen', hash: '0x1' },
    { amount: 1n, at: 'credited', from: '0xa', hash: '0x1' },
    { amount: 1n, at: 'counted', first: true, from: '0xa', hash: '0x1' },
    { at: 'announced', hash: '0x1' },
    { at: 'refused', hash: '0x1', why: 'x' },
  ]
  const deliveries: Payment.Delivery[] = [{ amount: 1n, from: '0xA', type: 'credited' }, { type: 'uncredited', why: 'x' }, { type: 'gave' }, { type: 'held' }, { type: 'told' }]
  assert.deepEqual(
    states.map((state) => deliveries.map((delivery) => Payment.transfer(state, delivery)?.at ?? null)),
    [
      ['credited', 'refused', null, null, null],
      [null, null, 'counted', 'counted', null],
      [null, null, null, null, 'announced'],
      [null, null, null, null, null],
      [null, null, null, null, null],
    ],
  )
})

test('riders paying, moving and spending at once, with crashes, duplicates and stale replays, move each dollar once and keep the ledger exact', async () => {
  const outcomes = new Set<string>()
  for (const seed of seeds) {
    const { answers, audit, faults } = await simulate(seed)
    assert.deepEqual(faults, [], 'seed ' + seed)
    assert.equal(audit.held, audit.pledged - audit.spent)
    for (const said of answers.values()) for (const each of said) outcomes.add(each)
  }
  assert.ok(outcomes.has('paid') && outcomes.has('refused') && outcomes.has('stale:paid'), [...outcomes].join(','))
})

async function red(flip: () => () => void, write?: Write) {
  const undo = flip()
  try {
    const faults: string[] = []
    for (const seed of seeds) faults.push(...(await simulate(seed, write ? { write } : {})).faults)
    return faults.join('|')
  } finally {
    undo()
  }
}

function off(guard: keyof typeof Payment.guards) {
  return () => {
    Payment.guards[guard] = false
    return () => void (Payment.guards[guard] = true)
  }
}

test('mutant: a move keyed per attempt instead of by the rider\'s key moves money twice, and the simulation catches it', async () => {
  assert.match(await red(off('keyed')), /keyed /)
})

test('mutant: effects run by every attempt that finds its write instead of the one that closes it run twice, and the simulation catches it', async () => {
  assert.match(await red(off('closed')), /effects \S+ 2/)
})

test('mutant: a reservation or spend that lands without checking what its bucket holds spends more than riders sent, and the simulation catches it', async () => {
  assert.match(
    await red(() => {
      Flow.guards.covered = false
      return () => void (Flow.guards.covered = true)
    }),
    /overspent/,
  )
})

test('mutant: a ledger write that reads the balance and then writes, instead of one balance-checked insert, overdraws, and the simulation catches it', async () => {
  assert.match(await red(() => () => undefined, brokenWrite), /ledger/)
})

test('a write that never answers is refused with Busy at its deadline, stays owed, and the next attempt finishes it once', async () => {
  const kv = storage()
  const saved = Payment.limits.payingMs
  Payment.limits.payingMs = 5
  let effects = 0
  try {
    await assert.rejects(Payment.settle(kv, 'm', { write: () => new Promise(() => undefined), written: async () => false }, () => (effects += 1)), Payment.Busy)
    assert.equal(Payment.open(kv, 'm'), true)
    assert.equal((await Payment.settle(kv, 'm', { write: async () => false, written: async () => true }, () => (effects += 1))).at, 'paid')
    assert.equal((await Payment.settle(kv, 'm', { write: async () => false, written: async () => true }, () => (effects += 1))).at, 'paid')
    assert.equal(effects, 1)
  } finally {
    Payment.limits.payingMs = saved
  }
})

test('an open payment written by a newer or older object is still finished: the record is versioned and read leniently', async () => {
  for (const record of [{ at: 'paying', tries: 2, until: 5, v: 2, more: true }, { at: 'owed' }, { v: 1 }]) {
    const kv = storage()
    kv.put('pay:m', record)
    let effects = 0
    assert.equal((await Payment.settle(kv, 'm', { write: async () => false, written: async () => true }, () => (effects += 1))).at, 'paid')
    assert.equal(effects, 1)
    assert.equal(Payment.open(kv, 'm'), false)
  }
})

test('a request from the previous Worker carries no key: each one is its own payment, as before', () => {
  const a = Payment.id('move', 'root>n1', riders[0] as string, undefined)
  const b = Payment.id('move', 'root>n1', riders[0] as string, null)
  assert.notEqual(a, b)
  assert.equal(Payment.id('move', 'root>n1', riders[0] as string, 'abcdefgh'), Payment.id('move', 'root>n1', (riders[0] as string).toUpperCase().replace('0X', '0x'), 'abcdefgh'))
})

async function contributions(seed: number) {
  const rand = random(seed)
  const d1 = world()
  const kv = storage()
  const { gate, run } = scheduler(rand, 0.2)
  const hashes = Array.from({ length: 5 }, (_, n) => '0x' + seed.toString(16) + 'f' + n)
  const amounts = new Map(hashes.map((hash) => [hash, String(BigInt(1 + Math.floor(rand() * 9)) * 1_000_000n)]))
  let told = 0
  const deliver = async (hash: string) => {
    let state: Payment.Transfer | null = { at: 'seen', hash }
    await gate()
    state = Payment.transfer(state, { amount: BigInt(amounts.get(hash) ?? '0'), from: riders[0] as string, type: 'credited' })
    const gift = await Store.give(d1.env, { amount: amounts.get(hash) ?? '0', channel: null, contributor: riders[0] as string, id: hash, note: null, note_id: null, swarm: 's1', token: 'ousd' })
    state = state && Payment.transfer(state, { type: gift ? 'gave' : 'held' })
    await gate()
    if (state?.at !== 'counted') throw new Error('not counted')
    Payment.once(kv, 'told:new:' + hash, () => (told += 1))
    state = Payment.transfer(state, { type: 'told' })
    return state?.at
  }
  const client = async (hash: string) => {
    for (let tries = 0; tries < 40; tries++) {
      const copies = rand() < 0.3 ? 3 : 1
      const results = await Promise.allSettled(Array.from({ length: copies }, () => deliver(hash)))
      if (results.some((each) => each.status === 'fulfilled' && each.value === 'announced')) return
    }
    throw new Error('never announced')
  }
  await run(hashes.map((hash) => client(hash)))
  const rows = d1.sqlite.prepare("select id, amount from contributions where swarm = 's1'").all()
  const faults: string[] = []
  if (rows.length !== hashes.length) faults.push('rows ' + rows.length)
  for (const row of rows) if (amounts.get(String(row['id'])) !== String(row['amount'])) faults.push('amount ' + row['id'])
  if (told !== hashes.length) faults.push('told ' + told + ' of ' + hashes.length)
  return faults
}

test('a transfer delivered many times at once, after crashes and out of order, is counted once and announced once', async () => {
  for (const seed of seeds) assert.deepEqual(await contributions(seed), [], 'seed ' + seed)
})

test('mutant: an announcement that does not check it was told announces twice, and the simulation catches it', async () => {
  const undo = off('told')()
  try {
    let caught = false
    for (const seed of seeds) if ((await contributions(seed)).length) caught = true
    assert.equal(caught, true)
  } finally {
    undo()
  }
})

async function lowering(seed: number) {
  const rand = random(seed)
  const d1 = world()
  const { gate, run } = scheduler(rand, 0)
  await Store.give(d1.env, { amount: '10000000', channel: '0xkey', contributor: riders[0] as string, id: 'backing:0xkey', note: null, note_id: null, swarm: 's1', token: 'mach' })
  const seen: bigint[] = []
  const reach = [9_000_000n, 7_000_000n, 6_000_000n, 4_000_000n]
  let time = 0
  const refresh = async () => {
    const gift = await Store.gift(d1.env, 'backing:0xkey')
    const worth = reach[Math.min(time++, reach.length - 1)] as bigint
    await gate()
    const held = BigInt(gift?.amount ?? '0')
    if (held > worth) await Store.lower(d1.env, 's1', 'backing:0xkey', String(worth), gift?.amount ?? '0')
    seen.push(BigInt((await Store.gift(d1.env, 'backing:0xkey'))?.amount ?? '0'))
  }
  await run(Array.from({ length: 4 }, () => refresh().then(refresh)))
  return seen.every((value, index) => index === 0 || value <= (seen[index - 1] as bigint))
}

test('a backing lowered by refreshes racing on older and newer gateway reads only ever goes down', async () => {
  for (const seed of seeds) assert.equal(await lowering(seed), true, 'seed ' + seed)
})

test('mutant: a blind lower lets an older read raise a backing back up, and the simulation catches it', async () => {
  const undo = off('fenced')()
  try {
    const results = await Promise.all(seeds.map((seed) => lowering(seed)))
    assert.ok(results.includes(false))
  } finally {
    undo()
  }
})

test('a ledger write with one contributor twice is checked against their whole amount', async () => {
  const { env } = world()
  const ana = riders[0] as string
  assert.equal(await Flow.write(env, { from: null, id: 'h', kind: 'pledge', parts: [[ana, 3n]], swarm: 's1', to: { node: 'root', run: null } }), true)
  assert.equal(await Flow.write(env, { from: { node: 'root', run: null }, id: 'm', kind: 'move', parts: [[ana, 2n], [ana.toUpperCase().replace('0X', '0x'), 2n]], swarm: 's1', to: { node: 'n1', run: null } }), false)
  assert.equal(Payment.balanced(Payment.audit(await Flow.rows(env, 's1'))), true)
})

test('a backing is never lowered below what the swarm has spent', async () => {
  const d1 = world()
  const ana = riders[0] as string
  await Store.give(d1.env, { amount: '10000000', channel: '0xkey', contributor: ana, id: 'backing:0xkey', note: null, note_id: null, swarm: 's1', token: 'mach' })
  d1.sqlite.exec("update swarms set sponsor_spent = 8000000 where id = 's1'")
  assert.equal(await Store.lower(d1.env, 's1', 'backing:0xkey', '7000000', '10000000'), null)
  assert.equal((await Store.gift(d1.env, 'backing:0xkey'))?.amount, '10000000')
  assert.notEqual(await Store.lower(d1.env, 's1', 'backing:0xkey', '8000000', '10000000'), null)
  assert.equal((await Store.gift(d1.env, 'backing:0xkey'))?.amount, '8000000')
})
