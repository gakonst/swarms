import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { fresh } from './board.ts'
import type * as MoneyModule from '../src/worker/Money.ts'
import './host.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Money: typeof MoneyModule = await import('../src/worker/Money.ts')

const live = '0x' + 'a1'.repeat(20)
const ended = '0x' + 'b2'.repeat(20)
const backer = '0x' + 'c3'.repeat(20)

function swarm(gifts: { amount: string; channel: string; id: string }[], behind: { agent: string; amount: number; base: string; branch: number }[] = [], credited: { deposited: string; deposits: unknown[]; known: string[] } = { deposited: '0.5', deposits: [], known: [] }, keys?: { ended: boolean; key: string; left: string; limit: string; spent: string }[]) {
  const writes: { args: unknown[]; sql: string }[] = []
  const logged: string[] = []
  const budgets: [string, unknown][] = []
  const listed: string[] = []
  const told: unknown[] = []
  const stored = new Map<string, unknown>()
  const read = (sql: string) =>
    sql.includes('json_each') ? credited.known.map((id) => ({ id })) : sql.includes('channel is not null') ? gifts : sql.includes('returning agent, branch') || sql.includes('from branches') || sql.includes('group by agent, branch, contributor') ? behind.map((each) => ({ ...each, contributor: backer, settled_at: null })) : []
  const statement = (sql: string, args: unknown[] = []) => ({
    all: async () => ({ meta: { changes: 1 }, results: read(sql) }),
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => {
      writes.push({ args, sql })
      if (sql.startsWith('insert or ignore into contributions')) return { amount: args[5], channel: args[2], contributor: args[3], created_at: 1, id: args[0], note: null, note_id: null, swarm: args[1], token: args[4] }
      return { balance: 6_700_000, contributors: 1, id: 'abc123abc123', machines: 0, pool_left: 400_000, pool_spent: 100_000, remaining: 4_400_000, sponsor_left: 4_000_000, sponsor_spent: 2_200_000, spent: 2_300_000 }
    },
    run: async () => {
      writes.push({ args, sql })
      return {}
    },
  })
  const self = {
    agent: () => ({ id: 'agt' }),
    beacon: () => undefined,
    board: fresh('swarm:test'),
    changed: () => undefined,
    env: {
      DB: {
        batch: async (statements: ReturnType<typeof statement>[]) => Promise.all(statements.map((each) => each.run().then(() => each.all()))),
        prepare: (sql: string) => statement(sql),
      },
      GATEWAY: {
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname
          if (path.endsWith('/budget')) {
            budgets.push([path, await request.json()])
            return Response.json({ agent: {} })
          }
          if (path === '/api/keys/credit') return Response.json({ deposited: credited.deposited, left: '0.4', spent: '0.1' })
          if (path === '/api/keys/credit/deposits') {
            listed.push(request.headers.get('gateway-app') ?? '')
            return Response.json({ deposits: credited.deposits })
          }
          return Response.json({
            backings: keys?.map((each) => ({ backer, createdAt: 1, expiresAt: null, tag: null, token: 'mach', ...each })) ?? [
              { backer, createdAt: 1, ended: false, expiresAt: null, key: live, left: '4', limit: '5', spent: '1', tag: null, token: 'mach' },
              { backer, createdAt: 1, ended: true, expiresAt: null, key: ended, left: '0', limit: '1.2', spent: '1.2', tag: null, token: 'mach' },
            ],
            left: '4',
            spent: '2.2',
          })
        },
      },
      GATEWAY_URL: 'https://gateway.test',
      SWARMS_GATEWAY_KEY: 'test',
    },
    contributed: async (input: unknown) => void told.push(input),
    kv: { get: (key: string) => stored.get(key), put: (key: string, value: unknown) => void stored.set(key, value) },
    log: (_kind: string, text: string) => void logged.push(text),
    remember: () => undefined,
  }
  return { budgets, listed, logged, self: self as never, told, writes }
}

const row = { balance: 0, id: 'abc123abc123', machines: 0, pool_left: 0, pool_spent: 0, sponsor_left: 0, sponsor_spent: 0, spent: 0 } as never

test("a swarm's money is its credit and what its backers' keys can still pay, and a key Swarms never counted is counted only at what it paid", async () => {
  const fresh = swarm([{ amount: '5000000', channel: ended, id: 'backing:' + ended }])
  const money = await Money.refresh(fresh.self, row, { credit: true, hands: false })
  assert.equal(money.left, 4_400_000n)
  const given = fresh.writes.filter((write) => write.sql.startsWith('insert or ignore into contributions'))
  assert.deepEqual(given.map((write) => [write.args[0], write.args[3], write.args[5]]), [['backing:' + live, backer, '1000000']])
  const pooled = fresh.writes.find((write) => write.sql.startsWith('update swarms set'))
  assert.ok(pooled?.sql.includes('sponsor_left = ?') && pooled.args.includes(4_000_000) && pooled.args.includes(2_200_000))
})

test('a backing that ended is lowered to what it paid, since the rest never left the wallet', async () => {
  const known = swarm([
    { amount: '5000000', channel: live, id: 'backing:' + live },
    { amount: '5000000', channel: ended, id: 'backing:' + ended },
  ])
  await Money.refresh(known.self, row, { credit: true, hands: false })
  const lowered = known.writes.filter((write) => write.sql.startsWith('update contributions set amount'))
  assert.deepEqual(lowered.map((write) => write.args), [['1200000', 'backing:' + ended, 'abc123abc123', '5000000']])
  assert.equal(known.writes.filter((write) => write.sql.startsWith('insert or ignore into contributions')).length, 0)
  assert.ok(known.logged.some((text) => /ended after paying \$1\.2/.test(text)))
  assert.ok(known.writes.some((write) => write.sql.includes('insert into steers') && write.args[0] === 'abc123abc123' && write.args[1] === 'backing:' + ended))
  assert.deepEqual(known.budgets, [])

  const settled = swarm([
    { amount: '5000000', channel: live, id: 'backing:' + live },
    { amount: '1200000', channel: ended, id: 'backing:' + ended },
  ])
  await Money.refresh(settled.self, row, { credit: true, hands: false })
  assert.equal(settled.writes.filter((write) => write.sql.startsWith('update contributions')).length, 0)

  const paying = swarm([
    { amount: '400000', channel: live, id: 'backing:' + live },
    { amount: '1200000', channel: ended, id: 'backing:' + ended },
  ])
  await Money.refresh(paying.self, row, { credit: true, hands: false })
  assert.deepEqual(paying.writes.filter((write) => write.sql.startsWith('update contributions set amount')).map((write) => write.args), [['1000000', 'backing:' + live, 'abc123abc123', '400000']])
  assert.ok(!paying.logged.some((text) => /ended after paying/.test(text)))

  const stranded = swarm([
    { amount: '25000000', channel: live, id: 'backing:' + live },
    { amount: '1200000', channel: ended, id: 'backing:' + ended },
  ])
  await Money.refresh(stranded.self, row, { credit: true, hands: false })
  assert.deepEqual(stranded.writes.filter((write) => write.sql.startsWith('update contributions set amount')).map((write) => write.args), [['5000000', 'backing:' + live, 'abc123abc123', '25000000']])
  assert.ok(stranded.logged.some((text) => /approval of \$25 can pay \$5 in all/.test(text)))
})

test('a branch whose money came from a backing that ended gets the budget still behind it, and a branch of an old agent or with no budget is left alone', async () => {
  const gifts = [
    { amount: '5000000', channel: live, id: 'backing:' + live },
    { amount: '5000000', channel: ended, id: 'backing:' + ended },
  ]
  const funded = swarm(gifts, [
    { agent: 'agt', amount: 2_000_000, base: '1000000', branch: 3 },
    { agent: 'old', amount: 2_000_000, base: '1000000', branch: 4 },
  ])
  await Money.refresh(funded.self, row, { credit: true, hands: false })
  assert.deepEqual(funded.budgets, [['/v1/agents/agt/subagents/3/budget', { budget_usd: 3 }]])
})

test('a transfer the gateway credited and Swarms never counted is found by its hash and counted once, and the gateway is asked again only when its deposited total moves', async () => {
  const lost = '0x' + '11'.repeat(32)
  const counted = '0x' + '22'.repeat(32)
  const sender = '0x' + 'd4'.repeat(20)
  const deposits = [
    { amount: '0.2', created_at: 1, from: sender, hash: lost, log: 1, tag: '0x' + '00'.repeat(16), token: 'ousd' },
    { amount: '0.05', created_at: 1, from: sender, hash: lost.toUpperCase().replace('0X', '0x'), log: 4, tag: '0x' + '00'.repeat(16), token: 'ousd' },
    { amount: '0.25', created_at: 2, from: backer, hash: counted, log: 0, tag: '0x' + '00'.repeat(16), token: 'pathusd' },
  ]
  const found = swarm([], [], { deposited: '0.5', deposits, known: [counted] })
  await Money.refresh(found.self, row, { credit: true, hands: false })
  assert.deepEqual(found.listed, ['swarm-abc123abc123'])
  const given = found.writes.filter((write) => write.sql.startsWith('insert or ignore into contributions') && !String(write.args[0]).startsWith('backing:'))
  assert.deepEqual(given.map((write) => [write.args[0], write.args[1], write.args[2], write.args[3], write.args[4], write.args[5], write.args[6]]), [[lost, 'abc123abc123', null, sender, 'ousd', '250000', null]])
  assert.deepEqual(found.told, [{ amount: '0.250000', contributor: sender, hash: lost, kind: 'new', note: null, noteId: null, swarm: 'abc123abc123', token: 'ousd' }])

  await Money.refresh(found.self, row, { credit: true, hands: false })
  assert.equal(found.listed.length, 1)

  const empty = swarm([], [], { deposited: '0', deposits, known: [] })
  await Money.refresh(empty.self, row, { credit: true, hands: false })
  assert.deepEqual(empty.listed, [])
})

test('a backing that paid past its limit counts at what it paid on every refresh, so the balance never flips between two totals', async () => {
  // Production, 2026-11-24 and 25: f3a42cf87339's backing said $9.834302 paid with $5 within reach, and every
  // refresh lowered it to $5 and the next raised it back, so the rail, switcher and detail read $100.52 or $95.69.
  const keys = [{ ended: false, key: live, left: '-4.834302', limit: '5', spent: '9.834302' }]
  for (const amount of ['9834302', '5000000']) {
    const each = swarm([{ amount, channel: live, id: 'backing:' + live }], [], undefined, keys)
    await Money.refresh(each.self, row, { credit: true, hands: false })
    const written = each.writes.filter((write) => write.sql.startsWith('update contributions set amount')).map((write) => write.args)
    assert.deepEqual(written, amount === '9834302' ? [] : [['9834302', 'backing:' + live, 'abc123abc123', '5000000']])
    assert.ok(!each.logged.some((text) => /can pay \$5 in all/.test(text)))
  }
  const ended = swarm([{ amount: '9834302', channel: live, id: 'backing:' + live }], [], undefined, [{ ...keys[0]!, ended: true }])
  await Money.refresh(ended.self, row, { credit: true, hands: false })
  assert.equal(ended.writes.filter((write) => write.sql.startsWith('update contributions set amount')).length, 0)
})
