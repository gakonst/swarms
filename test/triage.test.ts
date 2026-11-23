import assert from 'node:assert/strict'
import test from 'node:test'
import { ana, bo, gateway, id, planted, until } from './dispatch.ts'
import type * as NodesModule from '../src/worker/Nodes.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'
import type * as TriageModule from '../src/worker/Triage.ts'
import type * as FlowModule from '../src/worker/Flow.ts'

const Nodes: typeof NodesModule = await import('../src/worker/Nodes.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')
const Triage: typeof TriageModule = await import('../src/worker/Triage.ts')
const Flow: typeof FlowModule = await import('../src/worker/Flow.ts')

test('triage actions parse strictly and drop anything malformed', () => {
  const actions = Triage.parse(JSON.stringify({ actions: [{ kind: 'approve', node: 'abc', weight: 42 }, { kind: 'grant', node: 'abc', amount: '-1' }, { kind: 'explode' }, { into: 'abc', kind: 'merge', node: 'abc' }, { kind: 'restate', node: 'abc', statement: 'True' }] }))
  assert.deepEqual(actions, [{ kind: 'approve', node: 'abc', weight: 10 }, { kind: 'restate', node: 'abc', statement: 'True' }])
  assert.deepEqual(Triage.parse('no json'), [])
})

test('triage runs on its share of the root when there is something new, and its bounded actions apply', async (t) => {
  const g = gateway()
  const w = await planted(g.route, 0.05)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const proposal = await Nodes.post(w.swarm, { by: bo, form: 'lemma', needs: [], parent: 'root', statement: 'True', title: 'A rider idea', words: '' })
  await w.env.DB.prepare("insert into ideas (id, swarm, parent, author, text, created_at) values ('i1', ?, 'root', ?, 'Try the other way', ?)").bind(id, ana, Date.now()).run()
  await w.swarm.treePledge(id, { amount: '100', contributor: ana, hash: '0x' + '1'.repeat(64), nid: null })
  await until(() => g.subs.length === 1)
  const run = g.subs[0]
  assert.equal(run?.role, 'n:triage#1')
  assert.equal(run?.budget_usd, 5)
  assert.match(run?.task ?? '', /A rider idea/)
  assert.match(run?.task ?? '', /Try the other way/)
  run!.spent_usd = 0.2
  run!.status = {
    output: {
      actions: [
        { kind: 'approve', node: proposal.nid, weight: 3 },
        { idea: 'i1', kind: 'adopt', spec: 'From a rider.', statement: null, title: 'Adopted idea' },
        { amount: '30', kind: 'grant', node: proposal.nid },
        { amount: '10', kind: 'grant', node: proposal.nid },
      ],
    },
    state: 'completed',
  }
  Runner.wake(w.swarm)
  await until(() => g.subs.some((sub) => sub.role === 'n:' + proposal.nid + '#1'))
  const done = await w.swarm.board.task('r:triage:1')
  const applied = JSON.parse(done?.outcome && 'done' in done.outcome ? done.outcome.done : '{}') as { actions: { ok: boolean }[] }
  assert.deepEqual(applied.actions.map((one) => one.ok), [true, true, false, true])
  const view = await w.swarm.treeRead(id, { depth: 3, root: 'root', status: undefined })
  assert.ok(view.ok)
  const adopted = view.value.nodes.find((node) => node.title === 'Adopted idea')
  assert.equal(adopted?.by.address, ana)
  const ledger = Flow.fold(await Flow.rows(w.env, id))
  assert.equal(ledger.inherited.get(proposal.nid), 10_000_000n)
  assert.equal(ledger.spent.get('triage'), 200_000n)
})
