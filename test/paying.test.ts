import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { Challenge } from 'mppx'
import type * as PayingModule from '../src/worker/Paying.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Paying: typeof PayingModule = await import('../src/worker/Paying.ts')

const recipient = '0x40def0Cf3B5d28B6e9a7976BA10591e515AfECFE'
const ousd = '0x20c0000000000000000000006a37DA5C996874BE'
const wallet = '0x00000000000000000000000000000000000000aa'

function challenge(amount: number, to = recipient) {
  return Challenge.serialize(Challenge.from({ id: 'c' + amount, intent: 'session', method: 'tempo', realm: 'gateway', request: { amount: String(amount), currency: ousd, methodDetails: { chainId: 4217 }, recipient: to } }))
}

function swarm(fields: { clients?: string[]; raised?: number; kv?: Record<string, unknown> } = {}) {
  const store = new Map<string, unknown>(Object.entries(fields.kv ?? { id: 'abc123abc123' }))
  const kv = {
    delete: (key: string) => store.delete(key),
    get: <T>(key: string) => store.get(key) as T | undefined,
    list: <T>(options: { prefix?: string } = {}) => new Map([...store].filter(([key]) => key.startsWith(options.prefix ?? '')) as [string, T][]).entries(),
    put: (key: string, value: unknown) => void store.set(key, value),
  }
  const logs: [string, string][] = []
  const credentials: unknown[] = []
  const reads = { count: 0 }
  const row = { id: 'abc123abc123', raised: fields.raised ?? 0, sealed_wallet: 'sealed', sponsor_left: 0, wallet }
  const self = {
    clients: new Map(['pool', ...(fields.clients ?? [])].map((id) => [id, {
      createCredential: async (_response: Response, context: unknown) => {
        credentials.push({ ...(context as object), source: id })
        if ((context as { depositRaw?: string }).depositRaw) store.set(`mppx:${id}:k`, JSON.stringify({ channelId: '0x' + String(store.size).padStart(64, '0'), descriptor: {}, opened: true }))
        return 'Payment voucher'
      },
    }])),
    callers: new Map(),
    held: undefined,
    balancing: undefined,
    heldAt: 0,
    holding: new Map(),
    lanes: new Map(),
    cue: () => {},
    env: { TEMPO_RPC: 'http://127.0.0.1:9' },
    found: async () => {
      reads.count += 1
      return structuredClone(row)
    },
    kv,
    log: (kind: string, text: string) => void logs.push([kind, text]),
    run: () => ({ state: 'new' }),
    set: () => {},
  }
  return { credentials, kv, logs, reads, row, self: self as never, store }
}

test("the payer refuses an outside service past the swarm's per-call, hourly and per-host limits", () => {
  const { row, self, store } = swarm()
  const call = (amount: string, path = 'https://api.exa.ai/search') => Paying.passable(self, row as never, { amount, challenge: challenge(Number(amount) * 1e6), operation: 'agent.fetch', path, secret: '' })
  assert.match(String((call('0.3') as { detail: string }).detail), /at most \$0\.25 a call; api\.exa\.ai asked \$0\.3/)
  assert.equal(call('0.25'), undefined)
  assert.ok(call('0.250001'))
  store.set('passed', [{ amount: '400000', at: Date.now(), host: 'api.exa.ai' }])
  const host = call('0.2') as { detail: string; retry: number }
  assert.match(host.detail, /one outside service at most \$0\.5 an hour, and api\.exa\.ai had \$0\.4/)
  assert.equal(host.retry, 60)
  assert.equal(call('0.2', 'https://other.example/x'), undefined)
  store.set('passed', [{ amount: '400000', at: Date.now(), host: 'api.exa.ai' }, { amount: '450000', at: Date.now(), host: 'b.example' }])
  assert.match(String((call('0.2', 'https://c.example/x') as { detail: string }).detail), /at most \$1 an hour, and \$0\.85 went to them/)
  store.set('passed', [{ amount: '900000', at: Date.now() - 3_700_000, host: 'api.exa.ai' }])
  assert.equal(call('0.2'), undefined)
})

test("the payer's hourly limit for outside services grows with what the swarm raised", () => {
  const { row, self, store } = swarm({ raised: 100_000_000 })
  store.set('passed', [{ amount: '2000000', at: Date.now(), host: 'a.example' }])
  assert.equal(Paying.passable(self, row as never, { amount: '0.2', challenge: challenge(200_000), operation: 'agent.fetch', path: 'https://b.example/x', secret: '' }), undefined)
  store.set('passed', [{ amount: '2450000', at: Date.now(), host: 'a.example' }, { amount: '2450000', at: Date.now(), host: 'b.example' }])
  assert.match(String((Paying.passable(self, row as never, { amount: '0.2', challenge: challenge(200_000), operation: 'agent.fetch', path: 'https://c.example/x', secret: '' }) as { detail: string }).detail), /at most \$5 an hour/)
})

test('a paid outside call is recorded, and an agent fetch is logged, while a refusal records nothing', () => {
  const { self, store, logs } = swarm()
  const input = { amount: '0.01', challenge: challenge(10_000), operation: 'agent.fetch', path: 'https://api.exa.ai/search', secret: '' }
  Paying.passed(self, input, { code: 'limit_reached', detail: 'no', status: 402 })
  assert.equal(store.get('passed'), undefined)
  Paying.passed(self, input, { authorization: 'Payment x' })
  assert.deepEqual((store.get('passed') as { amount: string; host: string }[]).map((item) => [item.amount, item.host]), [['10000', 'api.exa.ai']])
  assert.match(logs[0]?.[1] ?? '', /paid \$0\.01 to an outside service/)
})

test("the payer pays only for its own swarm's app and refuses a request above the per-request cap", async () => {
  const { self } = swarm()
  assert.equal(((await Paying.charge(self, { app: 'swarm-other', challenge: challenge(5000), operation: 'model.responses', secret: '' })) as { status: number }).status, 401)
  const capped = (await Paying.charge(self, { challenge: challenge(11_000_000), operation: 'model.responses', secret: '' })) as { detail: string; status: number }
  assert.equal(capped.status, 402)
  assert.match(capped.detail, /costs \$11, more than the \$10/)
})

test('a voucher on an open channel signs what the gateway requires, what it already accepted plus one, or what was spent with the calls in flight and this one', async () => {
  const channel = { at: 0, confirmed: true, deposit: '1000000', descriptor: {}, id: '0x' + '0c'.repeat(32), signed: '100000' }
  const pay = (input: { snapshots?: object[]; pending?: object[]; spent?: string }) => {
    const { credentials, row, self, store } = swarm({ kv: { 'channel:pool': channel, id: 'abc123abc123', ...(input.pending ? { 'pending:pool': input.pending } : {}), ...(input.spent ? { 'spent:pool': input.spent } : {}) } })
    const source = Paying.sources(self, row as never)[0]
    return Paying.attempt(self, row as never, source as never, { challenge: challenge(5000), operation: 'model.responses', secret: '' }, (input.snapshots ?? []) as never).then((paid) => ({ cumulative: (credentials[0] as { cumulativeAmountRaw?: string } | undefined)?.cumulativeAmountRaw, paid, store }))
  }
  assert.equal((await pay({})).cumulative, '105000')
  assert.equal((await pay({ spent: '200000' })).cumulative, '205000')
  const snapshot = { acceptedCumulative: '300000', channelId: channel.id, deposit: '1000000', requiredCumulative: '250000', spent: '280000' }
  assert.equal((await pay({ snapshots: [snapshot] })).cumulative, '300001')
  assert.equal((await pay({ snapshots: [{ ...snapshot, requiredCumulative: '400000' }] })).cumulative, '400000')
  const flight = [{ amount: '30000', at: Date.now(), cumulative: '330000' }]
  const both = await pay({ pending: flight, snapshots: [{ ...snapshot, spent: '290000' }] })
  assert.equal(both.cumulative, '330001')
  assert.deepEqual((both.store.get('pending:pool') as { cumulative: string }[]).map((item) => item.cumulative), ['330000', '330001'])
  assert.equal((both.store.get('channel:pool') as { signed: string }).signed, '330001')
  const old = [{ amount: '30000', at: Date.now() - 60_000, cumulative: '330000' }]
  assert.equal((await pay({ pending: old, snapshots: [{ ...snapshot, spent: '290000' }] })).cumulative, '300001')
})

test('the payer offers nothing when the gateway asks for a token the swarm does not pay in', async () => {
  const { row, self } = swarm({ kv: { 'channel:pool': { at: 0, confirmed: true, deposit: '1000000', descriptor: {}, id: '0x' + '0c'.repeat(32), signed: '0' }, id: 'abc123abc123' } })
  const source = Paying.sources(self, row as never)[0]
  const other = Challenge.serialize(Challenge.from({ id: 'm', intent: 'session', method: 'tempo', realm: 'gateway', request: { amount: '5000', currency: '0x20c000000000000000000000f37de3740ADec032', methodDetails: { chainId: 4217 }, recipient } }))
  const failed = (await Paying.attempt(self, row as never, source as never, { challenge: other, operation: 'model.responses', secret: '' }, [])) as { failed: string; small: boolean }
  assert.match(failed.failed, /offered no OUSD session/)
  assert.equal(failed.small, true)
})

test("a gateway snapshot of a closing channel banks what it spent and forgets it, and a source refused again rests", async () => {
  const channel = { at: 0, confirmed: true, deposit: '1000000', descriptor: {}, id: '0x' + '0d'.repeat(32), signed: '50000' }
  const snapshot = { acceptedCumulative: '60000', channelId: channel.id, deposit: '1000000', requiredCumulative: '60001', spent: '60000' }
  const closing = swarm({ kv: { 'channel:pool': channel, id: 'abc123abc123', 'spent:pool': '40000' } })
  const answer = (await Paying.charge(closing.self, { challenge: challenge(5000), channels: [{ ...snapshot, closing: true }], operation: 'model.responses', secret: '' })) as { code: string; status: number }
  assert.equal(answer.status, 402)
  assert.equal(closing.store.get('banked:pool'), '60000')
  assert.equal(closing.store.has('spent:pool'), false)
  assert.equal(closing.store.has('channel:pool'), false)
  assert.equal(Paying.used(closing.self, 'pool'), 60000n)
  assert.ok((closing.store.get('exhausted:pool') as number) > Date.now())
  assert.match(closing.logs.at(-1)?.[1] ?? '', /cannot pay right now/)
  const ordered = swarm({ kv: { 'channel:pool': channel, id: 'abc123abc123' } })
  const again = await Paying.charge(ordered.self, { attempt: 2, challenge: challenge(5000), channels: [snapshot], operation: 'model.responses', rejected: { detail: 'Delta too small', status: 402 }, secret: '' })
  assert.ok('authorization' in again)
  assert.equal(ordered.store.get('exhausted:pool'), undefined)
  const refused = swarm({ kv: { 'channel:pool': channel, id: 'abc123abc123' } })
  await Paying.charge(refused.self, { attempt: 2, challenge: challenge(5000), channels: [snapshot], operation: 'model.responses', rejected: { detail: 'channel is closing', status: 402 }, secret: '' })
  assert.equal(refused.store.get('spent:pool'), '60000')
  assert.ok((refused.store.get('exhausted:pool') as number) > Date.now() + 9 * 60_000)
  assert.match(refused.logs[0]?.[1] ?? '', /refused a payment on one of the swarm wallet's channels again/)
})

test('the swarm wakes when its earliest set-aside source comes back, within eight days', () => {
  const now = Date.now()
  const { self } = swarm({ kv: { 'exhausted:hand:0x1': now + 50_000, 'exhausted:pool': now + 90_000, 'exhausted:stale': now - 1, 'exhausted:far': now + 9 * 86_400_000 } })
  assert.equal(Paying.rested(self), now + 52_000)
  assert.equal(Paying.rested(swarm().self), null)
})

test("a model call is paid from the swarm row the object already holds, read again only to word a refusal", async () => {
  const channel = { at: 0, confirmed: true, deposit: '1000000', descriptor: {}, id: '0x' + '0e'.repeat(32), signed: '0' }
  const kept = swarm({ kv: { 'channel:pool': channel, id: 'abc123abc123' } })
  const held = kept.self as unknown as { steady: unknown }
  held.steady = { ...kept.row, raised: 0, sponsor_left: 0 }
  const marks: { attempts?: number; row?: number; sign?: number } = {}
  const paid = await Paying.charge(kept.self, { challenge: challenge(5000), operation: 'model.responses', secret: '' }, marks)
  assert.ok('authorization' in paid)
  assert.equal(kept.reads.count, 0)
  assert.equal(marks.attempts, 1)
  assert.equal(Paying.outcome(paid), 'voucher')
  const fresh = swarm({ kv: { 'channel:pool': channel, id: 'abc123abc123' } })
  await Paying.charge(fresh.self, { challenge: challenge(5000), operation: 'model.responses', secret: '' })
  assert.equal(fresh.reads.count, 1)
  const refused = swarm({ kv: { id: 'abc123abc123' } })
  const refusedHeld = refused.self as unknown as { found: () => Promise<unknown>; steady: unknown }
  refusedHeld.steady = { ...refused.row, sponsor_left: 0 }
  refusedHeld.found = async () => ({ ...refused.row, sponsor_left: 3_000_000 })
  const answer = (await Paying.charge(refused.self, { challenge: challenge(5000), operation: 'model.responses', secret: '' })) as { detail: string }
  assert.match(answer.detail, /hold \$3 in all/)
})

test("a model call the gateway could not fit on any contribution channel, though they hold money, is refused as squeezed and recorded so the swarm backs off", async () => {
  const before = Date.now()
  const refused = swarm({ kv: { id: 'abc123abc123', sponsoredMost: '244000' } })
  const held = refused.self as unknown as { found: () => Promise<unknown>; steady: unknown }
  held.steady = { ...refused.row, sponsor_left: 0 }
  held.found = async () => ({ ...refused.row, sponsor_left: 584_992 })
  const answer = (await Paying.charge(refused.self, { challenge: challenge(28_451), operation: 'model.responses', secret: '' })) as { code: string; detail: string }
  assert.equal(answer.code, 'limit_reached')
  assert.match(answer.detail, /no room for it on the MACH channels it spends for the swarm \(\$0\.584992 in all, the largest \$0\.244\)/)
  assert.ok((refused.store.get('squeezed') as number) >= before)
  const scarce = swarm({ kv: { id: 'abc123abc123', sponsoredMost: '1000' } })
  const short = scarce.self as unknown as { found: () => Promise<unknown>; steady: unknown }
  short.steady = { ...scarce.row, sponsor_left: 0 }
  short.found = async () => ({ ...scarce.row, sponsor_left: 584_992 })
  await Paying.charge(scarce.self, { challenge: challenge(28_451), operation: 'model.responses', secret: '' })
  assert.equal(scarce.store.get('squeezed'), undefined)
})

function quiet<T>(work: () => Promise<T>) {
  const said: string[] = []
  const log = console.log
  console.log = (line: string) => void said.push(line)
  return work().then((value) => ({ said: said.map((line) => JSON.parse(line) as Record<string, unknown>), value })).finally(() => (console.log = log))
}

test('a lead and its explorers asking at once on one channel get vouchers in arrival order, each its price above the one before', async () => {
  const channel = { at: 0, confirmed: true, deposit: '1000000', descriptor: {}, id: '0x' + '0f'.repeat(32), signed: '100000' }
  const { credentials, self, store } = swarm({ kv: { 'channel:pool': channel, id: 'abc123abc123' } })
  const prices = [5000, 7000, 3000, 9000, 4000, 6000]
  const { said, value } = await quiet(() => Promise.all(prices.map((price) => Paying.queued(self, { challenge: challenge(price), operation: 'model.responses', secret: '' }))))
  assert.ok(value.every((paid) => 'authorization' in paid))
  const signed = credentials.map((item) => Number((item as { cumulativeAmountRaw: string }).cumulativeAmountRaw))
  let total = 100000
  assert.deepEqual(signed, prices.map((price) => (total += price)))
  assert.equal((store.get('channel:pool') as { signed: string }).signed, String(total))
  assert.deepEqual((store.get('pending:pool') as { cumulative: string }[]).map((item) => Number(item.cumulative)), signed)
  assert.equal(said.length, prices.length)
  assert.ok(said.every((line) => typeof line['waited'] === 'number' && typeof line['worked'] === 'number' && line['paid'] === 'voucher'))
})

test("asks that all carry the gateway's same snapshot still sign increasing vouchers, each covering what was spent, the asks before it and its own price", async () => {
  const channel = { at: 0, confirmed: true, deposit: '1000000', descriptor: {}, id: '0x' + '1f'.repeat(32), signed: '300000' }
  const { credentials, self } = swarm({ kv: { 'channel:pool': channel, id: 'abc123abc123' } })
  const snapshot = { acceptedCumulative: '300000', channelId: channel.id, deposit: '1000000', requiredCumulative: '290000', spent: '280000' }
  const prices = [20000, 10000, 15000, 5000]
  await quiet(() => Promise.all(prices.map((price) => Paying.queued(self, { challenge: challenge(price), channels: [snapshot], operation: 'model.responses', secret: '' }))))
  const signed = credentials.map((item) => Number((item as { cumulativeAmountRaw: string }).cumulativeAmountRaw))
  assert.deepEqual(signed, [300001, 310000, 325000, 330000])
  for (let index = 1; index < signed.length; index++) assert.ok(signed[index]! > signed[index - 1]!)
  let held = 280000
  prices.forEach((price, index) => {
    held += price
    assert.ok(signed[index]! >= held)
  })
})

test("a hand owner's ask during the lead's asks is signed on the owner's own channel, and neither channel's vouchers move the other's", async () => {
  const owner = '0x5555555555555555555555555555555555555555'
  const pool = { at: 0, confirmed: true, deposit: '1000000', descriptor: {}, id: '0x' + '2f'.repeat(32), signed: '50000' }
  const hand = { at: 0, confirmed: true, deposit: '500000', descriptor: {}, id: '0x' + '3f'.repeat(32), signed: '20000' }
  const { credentials, self, store } = swarm({ clients: ['hand:' + owner], kv: { ['channel:hand:' + owner]: hand, 'channel:pool': pool, id: 'abc123abc123' } })
  const asks = [
    { challenge: challenge(5000), operation: 'model.responses', secret: '' },
    { challenge: [challenge(8000, owner), challenge(8000)], hand: 'box', operation: 'hand.use', recipient: owner as `0x${string}`, secret: '' },
    { challenge: challenge(5000), operation: 'model.responses', secret: '' },
    { challenge: [challenge(8000, owner), challenge(8000)], hand: 'box', operation: 'hand.use', recipient: owner as `0x${string}`, secret: '' },
  ]
  await quiet(() => Promise.all(asks.map((input) => Paying.queued(self, input))))
  const by = (source: string) => credentials.filter((item) => (item as { source: string }).source === source).map((item) => Number((item as { cumulativeAmountRaw: string }).cumulativeAmountRaw))
  assert.deepEqual(by('pool'), [55000, 60000])
  assert.deepEqual(by('hand:' + owner), [28000, 36000])
  assert.equal((store.get('channel:pool') as { signed: string }).signed, '60000')
  assert.equal((store.get('channel:hand:' + owner) as { signed: string }).signed, '36000')
})

test('subagent trees get channels of their own while the wallet can fund them, and share the least busy ones after', () => {
  const lanes = Array.from({ length: Paying.most }, (_, at) => Paying.lane(at))
  const { row, self } = swarm({ clients: lanes.slice(1) })
  const held = self as unknown as { held: unknown; heldAt: number }
  held.held = { ousd: 350_000n, pathusd: 0n, usdce: 0n }
  held.heldAt = Date.now()
  const pick = (tree: number | undefined) => {
    const [first] = Paying.route(self, row as never, { challenge: challenge(5000), operation: 'model.responses', secret: '', tree }, [])
    ;(self as unknown as { lanes: Map<string, unknown> }).lanes.set(first!.id, { depth: 1, flow: [], tail: Promise.resolve() })
    return first!.id
  }
  assert.equal(pick(undefined), 'pool')
  assert.equal(pick(1), 'pool.1')
  assert.equal(pick(2), 'pool')
  assert.equal(pick(undefined), 'pool')
  assert.equal(pick(1), 'pool.1')
  assert.equal(Paying.who({ tree: 3 }), 'tree:3')
  assert.equal(Paying.who({ subagent: 4 }), 'subagent:4')
  assert.equal(Paying.who({}), 'lead')
})

test('channels opened at once never put in more than the wallet holds, and a refused credential gives its share back', async () => {
  const { credentials, row, self } = swarm({ clients: ['pool.1', 'pool.2'] })
  const held = self as unknown as { held: unknown; heldAt: number }
  held.held = { ousd: 150_000n, pathusd: 0n, usdce: 0n }
  held.heldAt = Date.now()
  const source = (id: string) => ({ currency: ousd, id, label: "the swarm's wallet" })
  const asks = ['pool', 'pool.1', 'pool.2'].map((id) => Paying.attempt(self, row as never, source(id) as never, { challenge: challenge(5000), operation: 'model.responses', secret: '' }, []))
  const results = await Promise.all(asks)
  const opened = credentials.map((item) => Number((item as { depositRaw?: string }).depositRaw ?? 0))
  assert.deepEqual(opened, [100_000, 48_000])
  assert.ok(opened.reduce((sum, amount) => sum + amount, 0) <= 150_000 - 2_000)
  assert.ok('authorization' in results[0]! && 'authorization' in results[1]!)
  assert.match((results[2] as { failed: string }).failed, /It can put in 0\.000000 now/)
})
