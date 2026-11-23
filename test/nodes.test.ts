import assert from 'node:assert/strict'
import test from 'node:test'
import { ana, bo, gateway, id, planted, until } from './dispatch.ts'
import type * as NodesModule from '../src/worker/Nodes.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'
import type * as FlowModule from '../src/worker/Flow.ts'

const Nodes: typeof NodesModule = await import('../src/worker/Nodes.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')
const Flow: typeof FlowModule = await import('../src/worker/Flow.ts')

async function program(w: Awaited<ReturnType<typeof planted>>) {
  const made = await Nodes.post(w.swarm, { by: 'seed', form: 'program', needs: [], parent: 'root', statement: null, title: 'Lower bounds', words: '' })
  Nodes.weigh(w.swarm, made.nid, 1)
  return made.nid
}

test('money on a program flows evenly to its runnable lemmas; a bare proposal never inherits', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const p = await program(w)
  const a = await Nodes.post(w.swarm, { by: 'agent:n:' + p, form: 'lemma', needs: [], parent: p, statement: 'True', title: 'A', words: '' })
  const b = await Nodes.post(w.swarm, { by: 'agent:n:' + p, form: 'lemma', needs: [], parent: p, statement: 'True', title: 'B', words: '' })
  const c = await Nodes.post(w.swarm, { by: bo, form: 'lemma', needs: [], parent: p, statement: 'True', title: 'C', words: '' })
  const d = await Nodes.post(w.swarm, { by: 'agent:n:' + p, form: 'lemma', needs: [a.nid], parent: p, statement: 'True', title: 'D', words: '' })
  await w.swarm.treePledge(id, { amount: '10', contributor: ana, hash: '0x' + '1'.repeat(64), nid: p })
  await until(() => g.subs.length === 2)
  assert.deepEqual(g.subs.map((sub) => [sub.role, sub.budget_usd]).sort(), [['n:' + a.nid + '#1', 5], ['n:' + b.nid + '#1', 5]].sort())
  const ledger = Flow.fold(await Flow.rows(w.env, id))
  assert.equal(ledger.inherited.get(c.nid) ?? 0n, 0n)
  assert.equal(ledger.inherited.get(d.nid) ?? 0n, 0n)
  assert.equal(ledger.left.get(p) ?? 0n, 0n)
})

test('reconcile posts a committed run that has no task, cancels a run with no money, and settles an ended node', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const p = await program(w)
  await Flow.write(w.env, { from: null, id: '0x' + '2'.repeat(64), kind: 'pledge', parts: [[ana, 3_000_000n]], swarm: id, to: { node: p, run: null } })
  await Flow.write(w.env, { from: { node: p, run: null }, id: 'commit:' + p + ':1', kind: 'commit', parts: [[ana, 2_000_000n]], swarm: id, to: { node: p, run: 'r:' + p + ':1' } })
  await w.swarm.board.post({ id: 'r:root:7', labels: { kind: 'run', node: 'root' }, parent: 'n:root', spec: 'run 7 of root' })
  const ended = await Nodes.post(w.swarm, { by: bo, form: 'idea', needs: [], parent: 'root', statement: null, title: 'Gone', words: '' })
  await Flow.write(w.env, { from: null, id: '0x' + '3'.repeat(64), kind: 'pledge', parts: [[bo, 1_000_000n]], swarm: id, to: { node: ended.nid, run: null } })
  await w.swarm.board.cancel('n:' + ended.nid, JSON.stringify({ at: 1, check: null, into: null, kind: 'withdrawn', why: 'x' }))
  await w.ring()
  assert.equal((await w.swarm.board.task('r:root:7'))?.reason, 'orphan')
  await until(() => g.subs.some((sub) => sub.role === 'n:' + p + '#1'))
  const ledger = Flow.fold(await Flow.rows(w.env, id))
  assert.equal(ledger.left.get(ended.nid) ?? 0n, 0n)
  assert.equal(ledger.left.get(''), 1_000_000n)
})

test('a payment refusal releases the run and rests it, then it runs once paid; a takeover adopts its subagent by role', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  g.state.refuse = true
  await w.swarm.treePledge(id, { amount: '1', contributor: ana, hash: '0x' + '4'.repeat(64), nid: null })
  await until(() => w.swarm.kv.get<number>('rest:r:root:1') !== undefined)
  const task = await w.swarm.board.task('r:root:1')
  assert.equal(task?.phase, 'open')
  assert.equal(task?.attempts, 1)
  assert.equal(g.subs.length, 0)
  g.state.refuse = false
  g.make({ budget_usd: 9, role: 'n:root#1', task: 'adopted' })
  w.swarm.kv.delete('rest:r:root:1')
  Runner.ensure(w.swarm)
  await until(() => g.budgets.length === 1)
  assert.equal(g.subs.length, 1)
  assert.deepEqual(g.budgets[0], [1, 1])
  assert.equal(g.prompts.length, 0)
})

test('strays are closed, top-ups raise the bound a step at a time, and the API spawn path sends the output schema', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  ;(w.env as unknown as Record<string, unknown>)['SWARMS_SPAWN'] = 'api'
  const stray = g.make({ budget_usd: 1, role: 'n:abcdefabcd#4', task: 'nobody asked' })
  await w.swarm.treePledge(id, { amount: '12', contributor: ana, hash: '0x' + '5'.repeat(64), nid: null })
  await until(() => g.spawned.length === 1)
  assert.ok((g.spawned[0]?.['output_schema'] as { required?: string[] }).required?.includes('outcome'))
  await until(() => stray.status.state === 'closed')
  const run = g.subs.find((sub) => sub.role === 'n:root#1')
  assert.ok(run)
  run.spent_usd = 3
  Runner.wake(w.swarm)
  await until(() => run.budget_usd === 10)
  const view = await w.swarm.treeRead(id, { depth: 0, root: 'root', status: undefined })
  assert.ok(view.ok)
  assert.equal(view.value.nodes[0]?.money.left, '2.000000')
  assert.equal(view.value.nodes[0]?.money.committed, '7.000000')
})

test('the dispatcher is replaced after 200 runs', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  w.swarm.kv.put('dispatcher', { at: 0, id: 'agt_d0', runs: Runner.rotateAfter })
  await w.swarm.treePledge(id, { amount: '1', contributor: ana, hash: '0x' + '6'.repeat(64), nid: null })
  await until(() => g.subs.length === 1)
  assert.equal(w.swarm.kv.get<{ id: string; runs: number }>('dispatcher')?.id, 'agt_d1')
  assert.equal(w.swarm.kv.get<{ id: string; runs: number }>('dispatcher')?.runs, 1)
})
