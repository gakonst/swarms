import assert from 'node:assert/strict'
import test from 'node:test'
import * as Showing from '../src/web/showing.ts'

test('a storyboard frame queues when it nears the screen and loads once a slot is granted', () => {
  const queued = Showing.seen('away', true)
  assert.equal(queued, 'queued')
  assert.equal(Showing.framed(queued), false)
  const loading = Showing.granted(queued)
  assert.equal(loading, 'loading')
  assert.equal(Showing.holds(loading), true)
  const shown = Showing.loaded(loading)
  assert.equal(shown, 'shown')
  assert.equal(Showing.holds(shown), false)
  assert.equal(Showing.framed(shown), true)
})

test('a frame that leaves the screen gives up its place in every state', () => {
  for (const now of ['away', 'queued', 'loading', 'shown'] as const) assert.equal(Showing.seen(now, false), 'away')
  assert.equal(Showing.seen('loading', true), 'loading')
  assert.equal(Showing.seen('shown', true), 'shown')
})

test('a slot granted late or a reload of a shown frame changes nothing', () => {
  assert.equal(Showing.granted('away'), 'away')
  assert.equal(Showing.granted('shown'), 'shown')
  assert.equal(Showing.loaded('shown'), 'shown')
  assert.equal(Showing.loaded('away'), 'away')
})
