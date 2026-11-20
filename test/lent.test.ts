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
  await Hands.seen(w.swarm, id, await Hands.list(w.env, id), [{ connected: true, name: machine }] as never)
  assert.deepEqual(Hands.evictable(w.swarm.slots, [], Date.now()), [])
  w.pass(2 * Hands.unseenMs)
  assert.deepEqual(Hands.evictable(w.swarm.slots, [], Date.now()), [machine])
  await Hands.free(w.swarm, id, machine)
  assert.equal(w.swarm.slots.task(`hand:${machine}`)?.phase, 'done')
  assert.deepEqual(Hands.evictable(w.swarm.slots, [], Date.now()), [])
  assert.deepEqual((await Hands.list(w.env, id)).filter((row) => row.returned_at === null), [])
  assert.deepEqual((await Store.members(w.env, id)).map((member) => [member.address, member.ways]), [[rider, ['machine']]])
})

test('without a hands listing no lent machine is evicted', async (t) => {
  const w = world((_request, url) => (url.pathname === '/v1/hands' ? Response.json({ error: 'down' }, { status: 503 }) : undefined))
  t.after(w.restore)
  await w.seed('0')
  await lend(w.env, Date.now() - 2 * Hands.unseenMs)
  const { listed } = await w.swarm.lent(id)
  assert.equal(listed, undefined)
  assert.deepEqual(Hands.evictable(w.swarm.slots, listed, Date.now()), [])
})

test('a swarm lends at most its cap of hands: the next waits for an idle one to lapse, and a returned name is never issued again', async (t) => {
  const minted: string[] = []
  const w = world((request, url) => {
    if (url.pathname !== '/v1/hands') return undefined
    if (request.method === 'POST') {
      const name = url.searchParams.get('name') ?? ''
      minted.push(name)
      return Response.json({ command: 'connect', short: name, token: 'hand_' + name, url: 'https://gateway.test/v1/hands/attach' })
    }
    return Response.json({ hands: minted.map((name, n) => ({ connected: !(gone && n === 0), name })) })
  })
  let gone = false
  t.after(w.restore)
  await w.seed('0')
  const issued = []
  for (let n = 0; n < Hands.limit; n++) issued.push(await w.swarm.lend(id, 'laptop', rider))
  assert.ok(issued.every((hand) => hand.ok))
  assert.deepEqual(await w.swarm.lend(id, 'laptop', rider), { ok: false, reason: 'full' })
  assert.equal(minted.length, Hands.limit)
  assert.equal(w.swarm.slots.held().length, Hands.limit)

  gone = true
  w.pass(2 * Hands.unseenMs)
  const next = await w.swarm.lend(id, 'laptop', rider)
  assert.ok(next.ok)
  assert.equal(w.swarm.slots.task(`hand:${minted[0]}`)?.phase, 'done')
  assert.equal(w.swarm.slots.held().length, Hands.limit)
  const rows = await Hands.list(w.env, id)
  assert.equal(rows.length, Hands.limit + 1)
  assert.equal(rows.filter((row) => row.returned_at === null).length, Hands.limit)
  assert.equal(new Set(minted).size, minted.length)
})
