import assert from 'node:assert/strict'
import test from 'node:test'
import * as Door from '../src/shared/Door.ts'

test('an open swarm is steered and talked in by its riders alone, so a seat who never rode it does neither', () => {
  assert.deepEqual(Door.of('open', { rider: false, seat: true }), { posts: false, steers: null })
  assert.deepEqual(Door.of('open', { rider: true, seat: true }), { posts: true, steers: 'backing' })
  assert.deepEqual(Door.of('open', { rider: true, seat: false }), { posts: true, steers: 'backing' })
  assert.deepEqual(Door.of('open', { rider: false, seat: false }), { posts: false, steers: null })
})

test("a team-steered swarm is steered by its seats with the swarm's money, and its other riders only talk", () => {
  assert.deepEqual(Door.of('team', { rider: false, seat: true }), { posts: true, steers: 'team' })
  assert.deepEqual(Door.of('team', { rider: true, seat: true }), { posts: true, steers: 'team' })
  assert.deepEqual(Door.of('team', { rider: true, seat: false }), { posts: true, steers: null })
  assert.deepEqual(Door.of('team', { rider: false, seat: false }), { posts: false, steers: null })
})
