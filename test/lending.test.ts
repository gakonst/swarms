import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as MoneyModule from '../src/worker/Money.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import type * as StoreModule from '../src/worker/Store.ts'
import type * as SwarmModule from '../src/worker/Swarm.ts'
import { open } from './d1.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Money: typeof MoneyModule = await import('../src/worker/Money.ts')
const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')
const Store: typeof StoreModule = await import('../src/worker/Store.ts')
const { Swarm }: typeof SwarmModule = await import('../src/worker/Swarm.ts')

const id = 'abc123abc123'
const dayMs = 86_400_000

type Listing = { connected: boolean; name: string; requests?: number }[] | 503

function world(listing: Listing) {
  const db = open()
  const detached: string[] = []
  const gateway = { listing }
  db.sqlite.prepare("insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at) values (?, 't', 'g', 'running', 1, 0, 1, 1)").run(id)
  const env = {
    ...db.env,
    GATEWAY: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname
        if (request.method === 'DELETE') return (detached.push(decodeURIComponent(path.split('/').at(-1) ?? '')), Response.json({ disconnected: true }))
        return gateway.listing === 503 ? new Response('upstream', { status: 503 }) : Response.json({ hands: gateway.listing })
      },
    },
    GATEWAY_URL: 'https://gateway.test',
    SWARMS_GATEWAY_KEY: 'test',
  }
  const kv = new Map<string, unknown>([['id', id]])
  const logged: string[] = []
  const self = {
    beacon: () => undefined,
    changed: () => undefined,
    env,
    kv: { get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value) },
    log: (_kind: string, text: string) => void logged.push(text),
    remember: () => undefined,
    turn: () => undefined,
  }
  const object = {
    hand: async () => ({ ok: true, value: { command: 'nc hand', short: 'nc', token: 'token', url: 'wss://gateway.test' } }),
    lent: () => Swarm.prototype.lent.call(self as never),
  }
  const lend = (name: string, created: number, seen: number | null, contributor: string | null = null) =>
    db.sqlite.prepare('insert into hands (swarm, name, label, contributor, created_at, seen_at) values (?, ?, ?, ?, ?, ?)').run(id, name, name, contributor, created, seen)
  const names = () => db.sqlite.prepare('select name from hands where swarm = ? order by created_at').all(id).map((row) => String(row['name']))
  return { db, detached, env: { ...env, SWARMS: { get: () => object, idFromName: (name: string) => name } } as never, gateway, kv, lend, logged, names, self: self as never }
}

test('a hands listing that failed leaves the machines as they were: none is logged leaving and the count stays', async () => {
  const flap = world(503)
  flap.kv.set('hands', [{ connected: true, name: 'mbp-abc123' }])
  flap.db.sqlite.prepare('update swarms set machines = 1 where id = ?').run(id)
  const row = await Store.find(flap.env, id)
  assert.ok(row)
  const failed = await Money.refresh(flap.self, row, { credit: false, hands: true })
  assert.deepEqual(flap.logged, [])
  assert.deepEqual(flap.kv.get('hands'), [{ connected: true, name: 'mbp-abc123' }])
  assert.equal(failed.row.machines, 1)
  assert.equal((await Store.find(flap.env, id))?.machines, 1)

  flap.gateway.listing = [{ connected: true, name: 'mbp-abc123' }]
  await Money.refresh(flap.self, row, { credit: false, hands: true })
  assert.deepEqual(flap.logged, [])

  flap.gateway.listing = []
  const left = await Money.refresh(flap.self, row, { credit: false, hands: true })
  assert.deepEqual(flap.logged, ['Machine mbp-abc123 left.'])
  assert.deepEqual(flap.kv.get('hands'), [])
  assert.equal(left.row.machines, 0)
})

test('a hands listing that failed evicts no machine and detaches none', async () => {
  const now = Date.now()
  const down = world(503)
  down.lend('live-1', now - 3 * dayMs, now - 2 * dayMs)
  const issued = await Operations.hand(down.env, { swarm: id })
  assert.equal(issued.ok, true)
  assert.deepEqual(down.detached, [])
  assert.deepEqual(down.names(), ['live-1', issued.ok ? issued.value.name : ''])

  const up = world([{ connected: false, name: 'gone-1' }, { connected: true, name: 'live-1' }])
  up.lend('gone-1', now - 3 * dayMs, null)
  up.lend('live-1', now - 3 * dayMs, now - 2 * dayMs)
  const next = await Operations.hand(up.env, { swarm: id })
  assert.deepEqual(up.detached, ['gone-1'])
  assert.deepEqual(up.names(), ['live-1', next.ok ? next.value.name : ''])
})
