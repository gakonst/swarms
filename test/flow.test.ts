import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as Flow from '../src/worker/Flow.ts'
import { open } from './d1.ts'

const ana = '0x' + 'a'.repeat(40)
const bo = '0x' + 'b'.repeat(40)

function world() {
  const d1 = open()
  d1.sqlite.exec("insert into swarms (id, title, goal, created_at, updated_at, form) values ('s1', 't', 'g', 0, 0, 'tree')")
  return d1
}

test('a movement is two legs, refused whole when one contributor cannot cover it, and written once per id', async () => {
  const { env } = world()
  assert.equal(await Flow.write(env, { from: null, id: '0xh1', kind: 'pledge', parts: [[ana, 5_000_000n]], swarm: 's1', to: { node: 'root', run: null } }), true)
  assert.equal(await Flow.write(env, { from: null, id: '0xh1', kind: 'pledge', parts: [[ana, 5_000_000n]], swarm: 's1', to: { node: 'root', run: null } }), false)
  assert.equal(await Flow.write(env, { from: null, id: '0xh2', kind: 'pledge', parts: [[bo, 1_000_000n]], swarm: 's1', to: { node: 'root', run: null } }), true)
  const over = await Flow.write(env, { from: { node: 'root', run: null }, id: 'grant:x', kind: 'grant', parts: [[ana, 1_000_000n], [bo, 2_000_000n]], swarm: 's1', to: { node: 'a', run: null } })
  assert.equal(over, false)
  assert.equal(await Flow.write(env, { from: { node: 'root', run: null }, id: 'grant:y', kind: 'grant', parts: [[ana, 2_000_000n], [bo, 1_000_000n]], swarm: 's1', to: { node: 'a', run: null } }), true)
  const rows = await Flow.rows(env, 's1')
  const ledger = Flow.fold(rows)
  assert.equal(ledger.left.get('root'), 3_000_000n)
  assert.equal(ledger.left.get('a'), 3_000_000n)
  assert.equal(ledger.inherited.get('a'), 3_000_000n)
  assert.equal(ledger.granted.get('root'), 3_000_000n)
  assert.equal(ledger.pledged.get('root'), 6_000_000n)
  assert.deepEqual(Flow.totals(rows), { held: 6_000_000n, pledged: 6_000_000n, spent: 0n })
})

test('pro rata splits keep every micro-dollar, the remainder to the largest share', () => {
  const held = new Map([[ana, 2n], [bo, 1n]])
  assert.deepEqual(Flow.split(held, 2n), [[ana, 2n]])
  assert.deepEqual(Flow.split(held, 3n), [[ana, 2n], [bo, 1n]])
  assert.deepEqual(Flow.split(held, 9n), [[ana, 2n], [bo, 1n]])
  assert.deepEqual(Flow.split(new Map([[ana, 1n], [bo, 1n]]), 1n), [[ana, 1n]])
  assert.equal(Flow.sum(Flow.split(new Map([[ana, 3333333n], [bo, 6666667n], ['0x' + 'c'.repeat(40), 1n]]), 5_000_000n).map(([, v]) => v)), 5_000_000n)
})

test('a run commits, spends and settles back; the ledger always equals pledges less spend', async () => {
  const { env } = world()
  await Flow.write(env, { from: null, id: '0xh1', kind: 'pledge', parts: [[ana, 4_000_000n], [bo, 0n]], swarm: 's1', to: { node: 'a', run: null } })
  await Flow.write(env, { from: null, id: '0xh2', kind: 'pledge', parts: [[bo, 4_000_000n]], swarm: 's1', to: { node: 'a', run: null } })
  const bucket = { node: 'a', run: 'r:a:1' }
  assert.ok(await Flow.write(env, { from: { node: 'a', run: null }, id: 'commit:a:1', kind: 'commit', parts: Flow.split(Flow.shares(await Flow.rows(env, 's1'), { node: 'a', run: null }), 5_000_000n), swarm: 's1', to: bucket }))
  let rows = await Flow.rows(env, 's1')
  assert.equal(Flow.fold(rows).committed.get('a'), 5_000_000n)
  assert.ok(await Flow.write(env, { from: bucket, id: 'settle:r:a:1:spend', kind: 'spend', parts: Flow.split(Flow.shares(rows, bucket), 1_000_000n), swarm: 's1', to: null }))
  rows = await Flow.rows(env, 's1')
  assert.ok(await Flow.write(env, { from: bucket, id: 'settle:r:a:1:settle', kind: 'settle', parts: [...Flow.shares(rows, bucket)], swarm: 's1', to: { node: 'a', run: null } }))
  rows = await Flow.rows(env, 's1')
  const ledger = Flow.fold(rows)
  assert.equal(ledger.spent.get('a'), 1_000_000n)
  assert.equal(ledger.committed.get('a') ?? 0n, 0n)
  assert.equal(ledger.left.get('a'), 7_000_000n)
  const totals = Flow.totals(rows)
  assert.equal(totals.held, totals.pledged - totals.spent)
  assert.deepEqual([...(ledger.funders.get('a') ?? new Map()).keys()].sort(), [ana, bo])
})
