import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'

test('a view asked with the version it already has answers null until the swarm changes or its version is not yet quiet', async (t) => {
  const w = world(() => undefined)
  t.after(w.restore)
  await w.seed()
  const shape = { excerpts: true, feed: 0 }
  const first = w.swarm.view(shape)
  assert.notEqual(w.swarm.viewed(shape, first.stamp.version), null)
  w.pass(3_000)
  const quiet = w.swarm.view(shape)
  assert.equal(quiet.stamp.quiet, true)
  assert.equal(w.swarm.viewed(shape, quiet.stamp.version), null)
  assert.notEqual(w.swarm.viewed(shape, 'other'), null)
  w.swarm.log('status', 'something happened')
  w.pass(3_000)
  const logged = w.swarm.viewed(shape, quiet.stamp.version)
  assert.notEqual(logged, null)
  assert.notEqual(logged?.stamp.version, quiet.stamp.version)
  w.swarm.kv.put('failure', { at: 1, code: null, message: 'x', route: '/v1/swarms', status: null })
  w.pass(3_000)
  assert.notEqual(w.swarm.viewed(shape, logged?.stamp.version ?? null), null)
})
