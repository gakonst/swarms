import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as Phase from '../src/worker/Phase.ts'
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
  assert.ok(Turns.broke("None of this app's backers can pay right now"))
  assert.ok(!Turns.broke(null))
  assert.ok(Turns.broke('Messages stream error api_error: Boundless was not paid: No method found for challenges: tempo.session'))
})

test('a swarm paused for money reads its credit once its calls are over, and goes on when enough came back', async () => {
  const now = Date.now()
  const swarm = (left: string, pause: Phase.Pause, at = now - 60_000, settled?: number) => {
    let run: Phase.Run = { at, pause, settled, state: 'paused' }
    const requests: string[] = []
    const self = {
      agent: () => undefined,
      beacon: () => undefined,
      env: {
        DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
        GATEWAY: {
          fetch: async (request: Request) => {
            requests.push(new URL(request.url).pathname)
            const path = new URL(request.url).pathname
            if (path === '/api/keys/backings') return Response.json({ backings: [], left: '0', spent: '0' })
            return Response.json(path === '/api/keys/credit' ? { deposited: '1', left, spent: '0' } : { hands: [] })
          },
        },
        GATEWAY_URL: 'https://gateway.test',
        SWARMS_GATEWAY_KEY: 'test',
      },
      kv: { get: () => undefined, put: () => undefined },
      remember: () => undefined,
      run: () => run,
      set: (next: Phase.Run) => void (run = next),
    }
    return { requests, run: () => run, settle: () => Turns.settle(self as never, row, run as Phase.Paused) }
  }
  const row = { id: 'abc123abc123', machines: 0, pool_left: Number(left('0.03')), pool_spent: 0, setup: null, sponsor_left: 0, spent: 0 } as never
  const pause = { left: '30000', wake: null, why: 'money' } as const

  const early = swarm('0.03', pause, now - 5_000)
  const waited = await early.settle()
  assert.ok(waited !== null && waited >= now + 9_000 && waited <= now + 11_000)
  assert.equal(early.requests.length, 0)

  const short = swarm('0.03', pause)
  assert.equal(await short.settle(), null)
  assert.ok(short.requests.includes('/api/keys/credit'))
  const settled = short.run()
  assert.ok(settled.state === 'paused' && settled.settled !== undefined && settled.settled >= now)
  assert.equal(await short.settle(), null)
  assert.equal(short.requests.filter((path) => path === '/api/keys/credit').length, 1)

  const back = swarm('0.40', pause)
  assert.equal(await back.settle(), null)
  assert.equal(back.run().state, 'waiting')

  const refused = swarm('9.76', { left: '9760000', needs: '440960', wake: null, why: 'money' })
  assert.equal(await refused.settle(), null)
  assert.equal(refused.run().state, 'paused')

  const unfunded = swarm('5', { why: 'unfunded' }, now - 60_000, now - 60_000)
  assert.equal(await unfunded.settle(), null)
  assert.equal(unfunded.requests.length, 0)

  const later = swarm('0.03', pause, now - 3_600_000, now - 660_000)
  assert.equal(await later.settle(), null)
  assert.deepEqual(later.requests.sort(), ['/api/keys/backings', '/api/keys/credit'])
  const read = later.run()
  assert.ok(read.state === 'paused' && read.settled !== undefined && read.settled >= now)

  const found = swarm('5', { why: 'unfunded' }, now - 3_600_000, now - 660_000)
  assert.equal(await found.settle(), null)
  assert.equal(found.run().state, 'waiting')
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
