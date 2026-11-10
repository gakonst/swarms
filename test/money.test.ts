import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as MoneyModule from '../src/worker/Money.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Money: typeof MoneyModule = await import('../src/worker/Money.ts')

const live = '0x' + 'a1'.repeat(20)
const ended = '0x' + 'b2'.repeat(20)
const backer = '0x' + 'c3'.repeat(20)

function swarm(gifts: { amount: string; channel: string; id: string }[]) {
  const writes: { args: unknown[]; sql: string }[] = []
  const logged: string[] = []
  const statement = (sql: string, args: unknown[] = []) => ({
    all: async () => ({ results: sql.includes('channel is not null') ? gifts : [] }),
    bind: (...bound: unknown[]) => statement(sql, bound),
    first: async () => {
      writes.push({ args, sql })
      if (sql.startsWith('insert or ignore into contributions')) return { amount: args[5], channel: args[2], contributor: args[3], created_at: 1, id: args[0], note: null, note_id: null, swarm: args[1], token: args[4] }
      return { contributors: 1, id: 'abc123abc123', machines: 0, pool_left: 400_000, pool_spent: 100_000, raised: 6_200_000, remaining: 4_400_000, sponsor_left: 4_000_000, sponsor_spent: 2_200_000, spent: 2_300_000 }
    },
    run: async () => {
      writes.push({ args, sql })
      return {}
    },
  })
  const self = {
    beacon: () => undefined,
    changed: () => undefined,
    env: {
      DB: { prepare: (sql: string) => statement(sql) },
      GATEWAY: {
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname
          if (path === '/api/keys/credit') return Response.json({ deposited: '0.5', left: '0.4', spent: '0.1' })
          return Response.json({
            backings: [
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
    kv: { get: () => undefined, put: () => undefined },
    log: (_kind: string, text: string) => void logged.push(text),
    remember: () => undefined,
  }
  return { logged, self: self as never, writes }
}

const row = { id: 'abc123abc123', machines: 0, pool_left: 0, pool_spent: 0, sponsor_left: 0, sponsor_spent: 0, spent: 0 } as never

test("a swarm's money is its credit and what its backers' keys can still pay, and a backing the gateway lists is counted once", async () => {
  const fresh = swarm([{ amount: '5000000', channel: ended, id: 'backing:' + ended }])
  const money = await Money.refresh(fresh.self, row, { credit: true, hands: false })
  assert.equal(money.left, 4_400_000n)
  const given = fresh.writes.filter((write) => write.sql.startsWith('insert or ignore into contributions'))
  assert.deepEqual(given.map((write) => [write.args[0], write.args[3], write.args[5]]), [['backing:' + live, backer, '5000000']])
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
  assert.deepEqual(lowered.map((write) => write.args), [['1200000', 'backing:' + ended, 'abc123abc123']])
  assert.equal(known.writes.filter((write) => write.sql.startsWith('insert or ignore into contributions')).length, 0)
  assert.ok(known.logged.some((text) => /ended after paying \$1\.2/.test(text)))

  const settled = swarm([
    { amount: '5000000', channel: live, id: 'backing:' + live },
    { amount: '1200000', channel: ended, id: 'backing:' + ended },
  ])
  await Money.refresh(settled.self, row, { credit: true, hands: false })
  assert.equal(settled.writes.filter((write) => write.sql.startsWith('update contributions')).length, 0)
})
