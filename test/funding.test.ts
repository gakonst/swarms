import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as BranchingModule from '../src/worker/Branching.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import type * as StoreModule from '../src/worker/Store.ts'
import { open } from './d1.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')
const Branching: typeof BranchingModule = await import('../src/worker/Branching.ts')
const Store: typeof StoreModule = await import('../src/worker/Store.ts')

const id = 'abc123abc123'
const rider = '0x00000000000000000000000000000000000000a1'
const owner = '0x00000000000000000000000000000000000000ee'

type Listed = { agent_id: number; budget_usd?: number; parent_agent_id: null; role: string; spent_usd?: number; status: { state: string }; task: string }

function world(gateway: (path: string, body: unknown) => unknown = () => ({}), listed: Listed[] = []) {
  const db = open()
  db.sqlite.prepare("insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at) values (?, 'Swarm', 'The goal of the swarm', 'paused', 0, 0, 1, 1)").run(id)
  db.sqlite.prepare("insert into names (address, name, updated_at) values (?, 'ada', 1)").run(rider)
  const calls: [string, ...unknown[]][] = []
  const said = (name: string) => async (...args: unknown[]) => (calls.push([name, ...args]), { ok: true, value: null })
  const object = { contributed: said('contributed'), direct: said('direct'), subagents: async () => ({ ok: true, value: { agent: 'agt', list: listed } }), voice: said('voice'), wake: said('wake') }
  const env = {
    ...db.env,
    GATEWAY: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname
        const answer = path === '/api/keys/me' ? { wallet: owner } : gateway(path, request.method === 'POST' ? await request.json() : undefined)
        return answer instanceof Response ? answer : Response.json(answer)
      },
    },
    GATEWAY_URL: 'https://gateway.test',
    SWARMS: { get: () => object, idFromName: (name: string) => name },
    SWARMS_GATEWAY_KEY: 'test',
    SWARMS_URL: 'https://swarms.test',
  } as unknown as Cloudflare.Env
  const member = async () => {
    const found = (await Store.members(env, id)).find((each) => each.address === rider)
    return [found?.backed, found?.steered, found?.available]
  }
  return { calls, db, env, member }
}

async function funded(env: Cloudflare.Env, branch: number, amount: bigint) {
  await Store.give(env, { amount: String(amount), channel: null, contributor: rider, id: '0xfeed', note: null, note_id: null, swarm: id, token: 'ousd' })
  assert.equal(await Store.steer(env, { amount, branch: { agent: 'agt', id: branch }, contributor: rider, id: 'f1', note: `branch ${branch}`, note_id: `branch:${branch}`, swarm: id }), true)
}

const closed: Listed = { agent_id: 1, budget_usd: 5, parent_agent_id: null, role: 'tester', spent_usd: 2, status: { state: 'closed' }, task: 'Test it' }
const running: Listed = { agent_id: 2, budget_usd: 1, parent_agent_id: null, role: 'writer', spent_usd: 0, status: { state: 'running' }, task: 'Write it' }

test('a branch the lead closed is settled when the gateway lists it, and looked for again at the next turn end until it does', async () => {
  let listing = false
  const { db, env, member } = world(() => (listing ? { agents: [closed, running] } : new Response('down', { status: 503 })))
  await funded(env, 1, 3_000_000n)
  const kv = new Map<string, unknown>()
  const self = { agent: () => ({ id: 'agt' }), env, kv: { get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value) } } as never
  const row = { id } as never

  await Branching.settled(self, row)
  assert.equal(kv.get('settledAt'), undefined)
  assert.deepEqual(await member(), ['3.000000', '3.000000', '0.000000'])

  listing = true
  await Branching.settled(self, row)
  assert.equal(typeof kv.get('settledAt'), 'number')
  assert.deepEqual(await member(), ['3.000000', '0.000000', '3.000000'])
  assert.equal(db.sqlite.prepare('select count(*) as n from branches where settled_at is not null').get()?.['n'], 1)
})

test('money behind a branch the lead closed goes back to its riders before a move from it or a stop is refused', async () => {
  const { calls, env, member } = world(undefined, [closed, running])
  await funded(env, 1, 3_000_000n)
  const moved = await Operations.move(env, { amount: '1', branch: 1, swarm: id, to: 2 }, rider)
  assert.deepEqual([moved.ok, moved.ok ? null : moved.status], [false, 409])
  assert.deepEqual(await member(), ['3.000000', '0.000000', '3.000000'])
  assert.deepEqual(calls.map(([name, , text]) => [name, text]), [['voice', '$3 that tester had not spent went back to its backers, to put behind something else.']])

  const stopped = await Operations.stop(env, { branch: 1, swarm: id }, rider)
  assert.deepEqual([stopped.ok, stopped.ok ? null : stopped.status], [false, 409])
  assert.equal(calls.length, 1)
  assert.deepEqual(await member(), ['3.000000', '0.000000', '3.000000'])
})
