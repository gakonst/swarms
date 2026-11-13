import assert from 'node:assert/strict'
import test from 'node:test'
import type * as HandsModule from '../src/worker/Hands.ts'
import type * as MoneyModule from '../src/worker/Money.ts'
import type * as StoreModule from '../src/worker/Store.ts'
import { id, rider, world } from './run.ts'

const Hands: typeof HandsModule = await import('../src/worker/Hands.ts')
const Money: typeof MoneyModule = await import('../src/worker/Money.ts')
const Store: typeof StoreModule = await import('../src/worker/Store.ts')

const machine = 'mbp-abc123'

const hands = { credit: false, hands: true }

async function lend(env: Cloudflare.Env, at = Date.now()) {
  await env.DB.prepare('insert into hands (swarm, name, label, contributor, created_at) values (?, ?, ?, ?, ?)').bind(id, machine, 'laptop', rider, at).run()
}

async function refresh(w: ReturnType<typeof world>) {
  const row = await Store.find(w.env, id)
  assert.ok(row)
  await Money.refresh(w.swarm, row, hands)
}

function lines(w: ReturnType<typeof world>) {
  return w.sql.exec("SELECT text FROM feed WHERE kind = 'machine'").toArray().map((row) => String(row['text']))
}

test('a failed hands listing leaves the lent machines as they were', async (t) => {
  let listing = true
  const w = world((_request, url) =>
    url.pathname === '/v1/hands' ? (listing ? Response.json({ hands: [{ connected: true, name: machine }] }) : Response.json({ error: 'down' }, { status: 503 })) : undefined,
  )
  t.after(w.restore)
  await w.seed()
  await refresh(w)
  listing = false
  await refresh(w)
  listing = true
  await refresh(w)
  assert.deepEqual(lines(w), [`Machine ${machine} joined the swarm.`])
  assert.deepEqual(w.swarm.kv.get('hands'), [{ connected: true, name: machine }])
  assert.equal((await Store.find(w.env, id))?.machines, 1)
})

test('a lender is a rider as soon as the swarm sees their machine join', async (t) => {
  const w = world((_request, url) => (url.pathname === '/v1/hands' ? Response.json({ hands: [{ connected: true, name: machine }] }) : undefined))
  t.after(w.restore)
  await w.seed('0')
  await lend(w.env)
  assert.deepEqual(await Store.members(w.env, id), [])
  await refresh(w)
  assert.deepEqual(lines(w), [`A contributor's machine joined the swarm as hand ${machine} (laptop).`])
  assert.deepEqual((await Store.members(w.env, id)).map((member) => [member.address, member.ways]), [[rider, ['machine']]])
})

test('a returned hand frees its slot and keeps its lender among the riders', async (t) => {
  const w = world(() => undefined)
  t.after(w.restore)
  await w.seed('0')
  await lend(w.env)
  await Hands.seen(w.env, id, await Hands.list(w.env, id), [{ connected: true, name: machine }] as never)
  w.pass(2 * Hands.unseenMs)
  const rows = Hands.held(await Hands.list(w.env, id))
  assert.deepEqual(Hands.evictable(rows, [], Date.now()).map((row) => row.name), [machine])
  await Hands.free(w.env, id, machine)
  assert.deepEqual(Hands.held(await Hands.list(w.env, id)), [])
  assert.deepEqual((await Store.members(w.env, id)).map((member) => [member.address, member.ways]), [[rider, ['machine']]])
})

test('without a hands listing no lent machine is evicted', async (t) => {
  const w = world((_request, url) => (url.pathname === '/v1/hands' ? Response.json({ error: 'down' }, { status: 503 }) : undefined))
  t.after(w.restore)
  await w.seed('0')
  await lend(w.env, Date.now() - 2 * Hands.unseenMs)
  const listed = await w.swarm.lent()
  assert.equal(listed, undefined)
  assert.deepEqual(Hands.evictable(Hands.held(await Hands.list(w.env, id)), listed, Date.now()), [])
})
