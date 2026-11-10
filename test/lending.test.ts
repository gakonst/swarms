import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as OperationsModule from '../src/worker/Operations.ts'
import type * as SwarmModule from '../src/worker/Swarm.ts'
import { open } from './d1.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')
const { Swarm }: typeof SwarmModule = await import('../src/worker/Swarm.ts')

const id = 'abc123abc123'
const dayMs = 86_400_000

type Listing = { connected: boolean; name: string; requests?: number }[] | 503

function world(listing: Listing) {
  const db = open()
  const detached: string[] = []
  db.sqlite.prepare("insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at) values (?, 't', 'g', 'running', 1, 0, 1, 1)").run(id)
  const env = {
    ...db.env,
    GATEWAY: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname
        if (request.method === 'DELETE') return (detached.push(decodeURIComponent(path.split('/').at(-1) ?? '')), Response.json({ disconnected: true }))
        return listing === 503 ? new Response('upstream', { status: 503 }) : Response.json({ hands: listing })
      },
    },
    GATEWAY_URL: 'https://gateway.test',
    SWARMS_GATEWAY_KEY: 'test',
  }
  const self = { env, kv: { get: (key: string) => (key === 'id' ? id : undefined) } }
  const object = {
    hand: async () => ({ ok: true, value: { command: 'nc hand', short: 'nc', token: 'token', url: 'wss://gateway.test' } }),
    lent: () => Swarm.prototype.lent.call(self as never),
  }
  const lend = (name: string, created: number, seen: number | null, contributor: string | null = null) =>
    db.sqlite.prepare('insert into hands (swarm, name, label, contributor, created_at, seen_at) values (?, ?, ?, ?, ?, ?)').run(id, name, name, contributor, created, seen)
  const names = () => db.sqlite.prepare('select name from hands where swarm = ? order by created_at').all(id).map((row) => String(row['name']))
  return { db, detached, env: { ...env, SWARMS: { get: () => object, idFromName: (name: string) => name } } as never, lend, names }
}

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
