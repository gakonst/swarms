import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as TurnsModule from '../src/worker/Turns.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Turns: typeof TurnsModule = await import('../src/worker/Turns.ts')

test('failed turns never stop the swarm: they wait 15 s, then back off from a minute up to half an hour', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 8, 20].map(Turns.backoff), [15_000, 15_000, 15_000, 60_000, 120_000, 240_000, 1_800_000, 1_800_000])
})

test('failed turns count back to the last completed one', () => {
  const statuses = [{ status: 'failed' }, { status: 'failed' }, { status: 'completed' }, { status: 'failed' }]
  const self = (rows: { status: string }[]) => ({ ctx: { storage: { sql: { exec: (_query: string, _since: number, limit: number) => ({ toArray: () => rows.slice(0, limit) }) } } } }) as never
  assert.equal(Turns.failing(self(statuses), 0), 2)
  assert.equal(Turns.failing(self(statuses.slice(2)), 0), 0)
  assert.equal(Turns.failing(self([{ status: 'failed' }, { status: 'failed' }, { status: 'failed' }, { status: 'failed' }]), 0), 3)
})

test("a turn the gateway refused because the swarm's credit ran out counts as out of money", () => {
  assert.ok(Turns.broke("Responses HTTPS request was rejected with HTTP 402: {\"error\":{\"message\":\"This app's credit has $0 left and this request holds $0.002325. Send MACH\"}}"))
  assert.ok(!Turns.broke('vercel/openai/gpt-6-luna failed upstream at vercel with HTTP 402'))
  assert.ok(!Turns.broke(null))
})

test('a swarm paused for money reads its credit once its calls are over, and goes on when enough came back', async () => {
  const now = Date.now()
  const swarm = (left: string, kv = new Map<string, unknown>()) => {
    const moved: unknown[] = []
    const requests: string[] = []
    const self = {
      agent: () => undefined,
      beacon: () => undefined,
      env: {
        DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
        GATEWAY: {
          fetch: async (request: Request) => {
            requests.push(new URL(request.url).pathname)
            return Response.json(new URL(request.url).pathname === '/api/keys/credit' ? { deposited: '1', left, spent: '0' } : { hands: [] })
          },
        },
        GATEWAY_URL: 'https://gateway.test',
        SWARMS_GATEWAY_KEY: 'test',
      },
      kv: { get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value) },
      remember: () => undefined,
      set: (run: unknown) => void moved.push(run),
    }
    return { kv, moved, requests, self: self as never }
  }
  const row = { id: 'abc123abc123', machines: 0, pool_left: Number(left('0.03')), pool_spent: 0, setup: null, sponsor_left: 0, spent: 0 } as never
  const pause = { left: '30000', wake: null, why: 'money' } as const

  const early = swarm('0.03')
  const waited = await Turns.settle(early.self, row, { at: now - 5_000, pause })
  assert.ok(waited !== null && waited >= now + 9_000 && waited <= now + 11_000)
  assert.equal(early.requests.length, 0)

  const short = swarm('0.03')
  assert.equal(await Turns.settle(short.self, row, { at: now - 60_000, pause }), null)
  assert.ok(short.requests.includes('/api/keys/credit'))
  assert.equal(short.moved.length, 0)
  assert.equal(await Turns.settle(short.self, row, { at: now - 60_000, pause }), null)
  assert.equal(short.requests.filter((path) => path === '/api/keys/credit').length, 1)

  const back = swarm('0.40')
  assert.equal(await Turns.settle(back.self, row, { at: now - 60_000, pause }), null)
  assert.equal((back.moved[0] as { state: string }).state, 'waiting')

  const unfunded = swarm('5')
  assert.equal(await Turns.settle(unfunded.self, row, { at: now - 60_000, pause: { why: 'unfunded' } }), null)
  assert.equal(unfunded.requests.length, 0)
})

function left(usd: string) {
  return BigInt(Math.round(Number(usd) * 1_000_000))
}

test("settledUsd reads the turn's settled spend from the gateway's turn report", () => {
  assert.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: 0.092138, status: 'completed' }), 92138n)
  assert.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: 0, status: 'completed' }), 0n)
  assert.equal(Turns.settledUsd({ request_id: 'agt_1:10', status: 'completed' }), undefined)
  assert.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: -1, status: 'completed' }), undefined)
  assert.equal(Turns.settledUsd(undefined), undefined)
})
