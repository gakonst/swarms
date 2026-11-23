import assert from 'node:assert/strict'
import test from 'node:test'
import { ana, gateway, id, planted, until } from './dispatch.ts'
import type * as AboutModule from '../src/worker/About.ts'
import type * as FlowModule from '../src/worker/Flow.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'

const About: typeof AboutModule = await import('../src/worker/About.ts')
const Flow: typeof FlowModule = await import('../src/worker/Flow.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')

test("a tree swarm's about is asked of its orchestrator once, stored, and paid from the swarm's money", async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  await About.ensure(w.swarm)
  assert.equal(g.sides.length, 0)
  assert.equal(w.swarm.view({ feed: 0 }).about, null)
  await w.swarm.treePledge(id, { amount: '12', contributor: ana, hash: '0x' + '1'.repeat(64), nid: null })
  await until(() => w.swarm.kv.get('dispatcher') !== undefined)
  await About.ensure(w.swarm)
  assert.equal(g.sides.length, 1)
  assert.match(g.sides[0] ?? '', /^Not a model pick\./)
  assert.equal(w.swarm.kv.get('about'), undefined)
  await About.ensure(w.swarm)
  assert.equal(g.sides.length, 1)
  w.swarm.kv.delete('aboutTried')
  g.state.side = '  A swarm   on whether P = NP.\n'
  await About.ensure(w.swarm)
  assert.equal(g.sides.length, 2)
  assert.equal(w.swarm.view({ feed: 0 }).about, 'A swarm on whether P = NP.')
  const rows = await Flow.rows(w.env, id)
  assert.equal(Flow.totals(rows).spent, 2_000n)
  assert.equal(w.swarm.kv.get('aboutOwed'), undefined)
  w.swarm.kv.delete('aboutTried')
  await About.ensure(w.swarm)
  assert.equal(g.sides.length, 2)
})

test('an about answer that is empty or JSON is not kept', () => {
  assert.equal(About.clean('  '), null)
  assert.equal(About.clean('{"model": "x"}'), null)
  assert.equal(About.clean('See https://user:secret@example.com now'), 'See https://***@example.com now')
  assert.equal(About.clean('x'.repeat(800))?.length, About.most)
})
