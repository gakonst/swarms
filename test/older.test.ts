import assert from 'node:assert/strict'
import test from 'node:test'
import { id, world } from './run.ts'
import * as Store from '../src/worker/Store.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')

test('a swarm object without the conditional view is asked once, then read whole until the memo lapses', async (t) => {
  const w = world(() => undefined)
  t.after(w.restore)
  await w.seed()
  const calls: string[] = []
  const object = new Proxy(w.swarm, {
    get(target, name, receiver) {
      if (name === 'viewed') {
        return () => {
          calls.push('viewed')
          throw new Error('The RPC receiver does not implement the method "viewed".')
        }
      }
      if (name === 'view') return (shape: object) => (calls.push('view'), target.view(shape))
      return Reflect.get(target, name, receiver)
    },
  })
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => object, idFromName: (name: string) => name }
  const error = console.error
  console.error = () => undefined
  t.after(() => {
    console.error = error
  })
  for (let read = 0; read < 3; read++) assert.ok((await Operations.get(w.env, { swarm: id })).ok)
  assert.deepEqual(calls, ['viewed', 'view', 'view', 'view'])
  w.pass(Operations.unconditionalMs + 1)
  calls.length = 0
  assert.ok((await Operations.get(w.env, { swarm: id })).ok)
  assert.deepEqual(calls, ['viewed', 'view'])
})

test('lent hands are listed from the gateway without a call to the swarm object, which only hears about used ones', async (t) => {
  let listed: unknown[] = [{ connected: false, name: 'idle-aaaaaa' }]
  const w = world((_request, url) => (url.pathname === '/v1/hands' ? Response.json({ hands: listed }) : undefined))
  t.after(w.restore)
  await w.seed()
  let lent = 0
  const object = new Proxy(w.swarm, {
    get(target, name, receiver) {
      if (name === 'lent') return (swarm: string) => (lent++, target.lent(swarm))
      return Reflect.get(target, name, receiver)
    },
  })
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => object, idFromName: (name: string) => name }
  await w.env.DB.prepare('insert into hands (swarm, name, label, created_at) values (?, ?, ?, ?)').bind(id, 'idle-aaaaaa', 'idle', 1).run()
  const first = await Operations.hands(w.env, { swarm: id })
  assert.deepEqual(first.ok && first.value.hands.map((hand) => [hand.name, hand.connected]), [['idle-aaaaaa', false]])
  assert.equal(lent, 0)
  listed = [{ connected: true, name: 'idle-aaaaaa' }]
  w.pass(60_000)
  const second = await Operations.hands(w.env, { swarm: id })
  assert.deepEqual(second.ok && second.value.hands.map((hand) => [hand.name, hand.connected]), [['idle-aaaaaa', true]])
  assert.equal(lent, 1)
})

test('a swarm id that neither the replica nor the primary holds is remembered as missing for a while, until it is created', async (t) => {
  const w = world(() => undefined)
  t.after(w.restore)
  const ghost = 'f00dfeedbeef'
  const reads: string[] = []
  const db = w.env.DB
  ;(w.env as unknown as Record<string, unknown>)['DB'] = new Proxy(db, {
    get(target, name) {
      if (name === 'prepare') return (sql: string) => (reads.push(sql), target.prepare(sql))
      const value = Reflect.get(target, name)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  assert.equal(await Store.find(w.env, ghost), null)
  assert.equal(await Store.exists(w.env, ghost), false)
  assert.equal(await Store.find(w.env, ghost), null)
  assert.equal(reads.length, 1)
  w.pass(Store.absentMs + 1)
  assert.equal(await Store.exists(w.env, ghost), false)
  assert.equal(reads.length, 2)
  await Store.insert(w.env, { creator: null, goal: 'g', id: ghost, problem: null, steering: 'open', title: 'Now it exists' })
  assert.equal((await Store.find(w.env, ghost))?.title, 'Now it exists')
})
