import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as TurnsModule from '../src/worker/Turns.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Turns: typeof TurnsModule = await import('../src/worker/Turns.ts')

test('turns failed on squeezed payments back off for one and two minutes, then shut down the machines, then rest after six', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(Turns.squeezing), [{ wait: 60_000 }, { wait: 120_000 }, 'sweep', { wait: 15_000 }, { wait: 15_000 }, 'rest', 'rest'])
})

test('turns failed on squeezed payments do not count toward the errors that stop the swarm', () => {
  const statuses = [
    { n: 9, status: 'failed' },
    { n: 8, status: 'failed' },
    { n: 7, status: 'failed' },
    { n: 6, status: 'failed' },
    { n: 5, status: 'completed' },
  ]
  const self = (squeezed: number[]) =>
    ({
      ctx: { storage: { sql: { exec: (_query: string, _since: number, limit: number) => ({ toArray: () => statuses.slice(0, limit) }) } } },
      kv: { get: (key: string) => (key === 'squeezedTurns' ? squeezed : undefined) },
    }) as never
  assert.equal(Turns.failing(self([]), 0), 3)
  assert.equal(Turns.failing(self([8, 9]), 0), 2)
  assert.equal(Turns.failing(self([6, 7, 8, 9]), 0), 0)
})

test('a paused swarm reads its wallet channel again once its calls are over, and once per voucher', async () => {
  const now = Date.now()
  const store = new Map<string, unknown>([
    ['channel:pool', { confirmed: true, signed: '500' }],
    ['paid:pool', now - 5_000],
  ])
  const self = { kv: { get: (key: string) => store.get(key), put: (key: string, value: unknown) => void store.set(key, value) } } as never
  const row = { id: 'abc123abc123', wallet: '0x00000000000000000000000000000000000000aa' } as never
  const waited = await Turns.settle(self, row, { at: now - 60_000 })
  assert.ok(waited !== null && waited >= now + 9_000 && waited <= now + 11_000)
  store.set('settled:pool', '500')
  assert.equal(await Turns.settle(self, row, { at: now - 60_000 }), null)
  store.set('channel:pool', { confirmed: true, signed: '700' })
  assert.ok((await Turns.settle(self, row, { at: now })) !== null)
})

test('an update waits for backers only when its last line says so', () => {
  assert.ok(Turns.waiting('Still at 1.316x, and $4 is too little for another experiment.\n\nWaiting for backers.'))
  assert.ok(Turns.waiting('Holding.\n**Waiting for backers.**\n'))
  assert.ok(Turns.waiting('Waiting for backers'))
  assert.ok(!Turns.waiting('Waiting for backers to fund the Wishlist before the next branch.\n\nThe kernel is at 1.316x.'))
  assert.ok(!Turns.waiting('I am not Waiting for backers yet.'))
})

test("settledUsd reads the turn's settled spend from the gateway's turn report", () => {
  assert.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: 0.092138, status: 'completed' }), 92138n)
  assert.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: 0, status: 'completed' }), 0n)
  assert.equal(Turns.settledUsd({ request_id: 'agt_1:10', status: 'completed' }), undefined)
  assert.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: -1, status: 'completed' }), undefined)
  assert.equal(Turns.settledUsd(undefined), undefined)
})
