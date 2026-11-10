import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as BranchingModule from '../src/worker/Branching.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import type * as StoreModule from '../src/worker/Store.ts'
import * as Credit from '../src/shared/Credit.ts'
import { open } from './d1.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')
const Branching: typeof BranchingModule = await import('../src/worker/Branching.ts')
const Store: typeof StoreModule = await import('../src/worker/Store.ts')
const { Swarm } = await import('../src/worker/Swarm.ts')

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
  const self = { agent: () => ({ id: 'agt' }), budgeting: Promise.resolve(), changed: () => undefined, get env() { return env }, log: () => undefined, touch: () => undefined }
  const object = {
    contributed: said('contributed'),
    direct: (...args: Parameters<InstanceType<typeof Swarm>['direct']>) => Swarm.prototype.direct.apply(self as never, args),
    subagents: async () => ({ ok: true, value: { agent: 'agt', list: listed } }),
    voice: said('voice'),
    wake: said('wake'),
  }
  const env: Cloudflare.Env = {
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

test("a fund the branch could not be told about is undone and the budget set from what is still behind the branch, another rider's fund included", async () => {
  const other = '0x00000000000000000000000000000000000000b2'
  const budgets: unknown[] = []
  const { env, member } = world(
    (path, body) => {
      if (path.endsWith('/messages')) return new Response('down', { status: 503 })
      if (path.endsWith('/budget')) budgets.push((body as { budget_usd: number }).budget_usd)
      return { agent: { ...running, agent_id: 2 } }
    },
    [closed, { ...running, budget_usd: 5 }],
  )
  await Store.give(env, { amount: '2000000', channel: null, contributor: rider, id: '0xfeed', note: null, note_id: null, swarm: id, token: 'ousd' })
  await Store.give(env, { amount: '1000000', channel: null, contributor: other, id: '0xbeef', note: null, note_id: null, swarm: id, token: 'ousd' })
  await Store.base(env, id, 'agt', 2, 5_000_000n)
  assert.equal(await Store.steer(env, { amount: 1_000_000n, branch: { agent: 'agt', id: 2 }, contributor: other, id: 'f2', note: 'branch 2', note_id: 'branch:2', swarm: id }), true)

  const refused = await Operations.fund(env, { amount: '2', branch: 2, message: 'Write the proof first', swarm: id }, rider)
  assert.deepEqual([refused.ok, refused.ok ? null : refused.status], [false, 502])
  assert.deepEqual(budgets, [8, 6])
  assert.deepEqual(await member(), ['2.000000', '0.000000', '2.000000'])
  assert.equal((await Store.funds(env, id, 'agt')).shares.get(2)?.get(other), 1_000_000n)
})

test('a transfer already counted is refused, and still wakes a swarm that missed it; its note is refused once its money is behind something else', async () => {
  const hash = '0x' + 'ab'.repeat(32)
  const { calls, env, member } = world((path) => (path === '/api/keys/credit' ? { created: true, credit: {}, deposits: [{ amount: '10', from: rider, log: 0, tag: Credit.tag(id, 'idea two'), token: 'ousd' }] } : {}))
  const first = await Operations.contribute(env, { hash, swarm: id })
  assert.deepEqual([first.ok && first.value.created, calls.map(([name]) => name)], [true, ['contributed']])

  const repeated = await Operations.contribute(env, { hash, swarm: id })
  assert.deepEqual([repeated.ok, repeated.ok ? null : repeated.status, calls.slice(1)], [false, 409, [['wake', 'money']]])

  assert.equal(await Store.steer(env, { amount: 10_000_000n, contributor: rider, id: 's1', note: 'idea one', note_id: 'n1', swarm: id }), true)
  const noted = await Operations.contribute(env, { hash, note: 'idea two', swarm: id })
  assert.deepEqual([noted.ok, noted.ok ? null : noted.detail, calls.slice(2)], [false, 'This transaction is already counted, and its money is already behind another idea or a branch.', [['wake', 'money']]])
  assert.deepEqual(await member(), ['10.000000', '10.000000', '0.000000'])
})

test('a swarm told of money wakes before it logs and announces it, so a failed announcement leaves it awake', async () => {
  const woken: string[] = []
  const self = {
    env: { DB: { prepare: () => ({ bind: () => ({ first: async () => Promise.reject(new Error('D1 is down')) }) }) } },
    kv: { put: () => undefined },
    log: () => undefined,
    marked: 0,
    wake: async (reason: string) => void woken.push(reason),
  }
  const input = { amount: '5', contributor: rider, hash: '0x' + 'ab'.repeat(32), note: null, noteId: null, swarm: id, token: 'ousd' } as const
  await assert.rejects(Swarm.prototype.contributed.call(self as never, { ...input, kind: 'new' }), /D1 is down/)
  await assert.rejects(Swarm.prototype.contributed.call(self as never, { ...input, kind: 'noted', note: 'idea', noteId: 'n1' }), /D1 is down/)
  assert.deepEqual(woken, ['money', 'money'])
})
