import assert from 'node:assert/strict'
import test from 'node:test'
import { gateway, planted } from './dispatch.ts'
import type * as NodesModule from '../src/worker/Nodes.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'

const Nodes: typeof NodesModule = await import('../src/worker/Nodes.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')

test('a run result delivered again after a restart or a lease handoff applies once', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const run = Nodes.runId('root', 1)
  const result: NodesModule.Result = { children: [{ needs: [], spec: 'First.', statement: 'True', title: 'Lemma A' }], commit: null, outcome: 'split', summary: 'Split once', theorem: null, why: null }
  const verify = async () => undefined
  const progress = () => w.swarm.ctx.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM tree_deltas WHERE node = 'root' AND event = 'progress' AND text = 'Split once'").one().n
  const nodes = async () => (await w.swarm.board.tasks()).filter((task) => task.labels['kind'] === 'node').length
  const before = await nodes()
  assert.equal(await Nodes.deliver(w.swarm, run, result, verify), true)
  const after = await nodes()
  assert.equal(after, before + 1)
  assert.equal(await Nodes.deliver(w.swarm, run, { ...result, children: [{ needs: [], spec: 'Second.', statement: 'False', title: 'Lemma B' }], outcome: 'stuck' }, verify), false)
  assert.equal(progress(), 1)
  assert.equal(w.swarm.kv.get('stuck:root'), undefined)
  assert.equal((await w.swarm.board.task(Nodes.ranId(run)))?.phase, 'done')
  assert.equal(await nodes(), after)
})
