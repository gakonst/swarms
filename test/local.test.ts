import assert from 'node:assert/strict'
import test from 'node:test'
import type * as Tree from '../src/shared/Tree.ts'
import * as Local from '../src/web/local.ts'

const swarm = 'abcdef012345'

function fresh() {
  Local.reset()
  void Local.start({ data: { [swarm]: { title: 'seeded' } }, now: 1, persist: false })
}

function delta(seq: number, event: Tree.Delta['event'], id = 'n1'): Tree.Delta {
  return { at: seq, event, node: { id, parent: 'root', title: `t${seq}` } as unknown as Tree.Node, seq, text: `d${seq}` }
}

test('boot data is fresh, and a load for a key already flying is the same request', async () => {
  fresh()
  assert.ok(Local.fresh(swarm))
  assert.equal(Local.scope(`node:${swarm}:n1`), swarm)
  assert.equal(Local.scope('rider:0xabc'), undefined)
  assert.equal(Local.table(`updates:${swarm}:n1`), 'runs')
  assert.equal(Local.table(`updates:${swarm}`), 'views')
  let calls = 0
  const loader = () => new Promise<number>((resolve) => setTimeout(() => resolve(++calls), 5))
  const [a, b] = await Promise.all([Local.load('k', loader), Local.load('k', loader)])
  assert.equal(calls, 1)
  assert.equal(a, b)
  assert.ok(Local.fresh('k'))
})

test('a welcome at the version the store holds keeps every row; a moved one marks them stale', () => {
  fresh()
  assert.equal(Local.welcome(swarm, 'v1'), 'moved')
  assert.equal(Local.row(swarm)?.state, 'stale')
  Local.put(swarm, { title: 'loaded' })
  Local.put(`node:${swarm}:n1`, { funders: [], id: 'n1', runs: [], title: 'a' })
  Local.put(`artifacts:${swarm}`, { artifacts: [] })
  assert.equal(Local.welcome(swarm, 'v1'), 'same')
  assert.ok(Local.fresh(`node:${swarm}:n1`))
  assert.ok(Local.fresh(swarm))
  assert.equal(Local.row(`artifacts:${swarm}`)?.state, 'stale')
  assert.equal(Local.welcome(swarm, 'v2'), 'moved')
  assert.equal(Local.row(`node:${swarm}:n1`)?.state, 'stale')
  assert.equal(Local.row(swarm)?.state, 'stale')
})

test('deltas keep node rows current, so a moved welcome with a cursor leaves them to the catch-up', () => {
  fresh()
  Local.welcome(swarm, 'v1')
  Local.put(`node:${swarm}:n1`, { funders: ['f'], id: 'n1', runs: ['r'], title: 'a' })
  Local.put(`updates:${swarm}:n1`, { deltas: [], next: 0 })
  Local.delta(swarm, delta(7, 'progress'))
  assert.deepEqual(Local.value(`node:${swarm}:n1`), { funders: ['f'], id: 'n1', parent: 'root', runs: ['r'], title: 't7' })
  assert.deepEqual((Local.value(`updates:${swarm}:n1`) as { next: number }).next, 7)
  assert.equal(Local.cursor(swarm), 7)
  Local.delta(swarm, delta(8, 'doing'))
  assert.equal(Local.cursor(swarm), 7)
  assert.equal(Local.welcome(swarm, 'v2'), 'moved')
  assert.ok(Local.fresh(`node:${swarm}:n1`))
  assert.equal(Local.row(swarm)?.state, 'stale')
  Local.delta(swarm, delta(9, 'funded'))
  assert.equal(Local.row(`node:${swarm}:n1`)?.state, 'stale')
  Local.caught(swarm, 9)
  assert.equal(Local.cursor(swarm), 9)
  Local.lost(swarm)
  assert.equal(Local.cursor(swarm), undefined)
})

test('a change to a part nobody shows makes its row load again on the next visit', () => {
  fresh()
  Local.welcome(swarm, 'v1')
  Local.put(swarm, { title: 'loaded' })
  Local.put(`artifacts:${swarm}`, { artifacts: [] })
  const stop = Local.subscribe(swarm, () => {})
  Local.advance(swarm, 'v2', true)
  assert.ok(!Local.fresh(`artifacts:${swarm}`))
  assert.ok(Local.fresh(swarm))
  assert.equal(Local.row(swarm)?.version, 'v2')
  stop()
})

test('a mutation confirms, rolls back on rejection, and waits offline for a replay that checks it landed first', async () => {
  fresh()
  const sent: string[] = []
  let landed = false
  let mode: 'ok' | 'down' | 'no' = 'ok'
  const confirmed: unknown[] = []
  Local.define('say', {
    confirm: (_mutation, result) => confirmed.push(result),
    landed: async () => landed,
    run: async (mutation) => {
      sent.push(mutation.input as string)
      if (mode === 'down') throw new TypeError('fetch failed')
      if (mode === 'no') throw new Error('Not a member.')
      return { id: sent.length }
    },
  })
  assert.deepEqual(await Local.mutate('say', swarm, 'one'), { id: 1 })
  assert.equal(Local.pending(swarm, 'say').length, 0)
  mode = 'no'
  await assert.rejects(Local.mutate('say', swarm, 'two'), /Not a member/)
  assert.equal(Local.pending(swarm, 'say').length, 0)
  mode = 'down'
  const later = Local.mutate('say', swarm, 'three')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(Local.pending(swarm, 'say')[0]?.state, 'queued')
  landed = true
  await Local.replay()
  assert.equal(await later, undefined)
  assert.deepEqual(sent, ['one', 'two', 'three'])
  assert.equal(Local.pending(swarm, 'say').length, 0)
  mode = 'down'
  landed = false
  const again = Local.mutate('say', swarm, 'four')
  await new Promise((resolve) => setTimeout(resolve, 0))
  mode = 'ok'
  await Local.replay()
  assert.deepEqual(await again, { id: 5 })
  assert.deepEqual(confirmed, [{ id: 1 }, undefined, { id: 5 }])
})
