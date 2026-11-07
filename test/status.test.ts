import assert from 'node:assert/strict'
import test from 'node:test'
import * as Status from '../src/shared/Status.ts'

const swarm = { raised: '2.000000', remaining: '0.500000', status: 'paused', why: null } as const

test('a running swarm is live whatever its money', () => {
  assert.deepEqual(Status.standing({ ...swarm, remaining: '0.000000', status: 'running' }), { action: null, mood: 'live', word: 'Running' })
})

test('a swarm nobody funded asks for its first money, and one with money but no first step is starting', () => {
  assert.deepEqual(Status.standing({ ...swarm, raised: '0.000000', status: 'funding', why: 'unfunded' }), { action: 'Fund $2 to start it', mood: 'new', word: 'Not started' })
  assert.deepEqual(Status.standing({ ...swarm, status: 'funding', why: null }), { action: null, mood: 'live', word: 'Starting' })
  assert.deepEqual(Status.standing({ ...swarm, status: 'funding', why: 'money' }), { action: 'Add $2 to start it', mood: 'money', word: 'Not started' })
})

test('a paused swarm names why it waits', () => {
  assert.equal(Status.word({ ...swarm, why: 'idle' }), 'Resting')
  assert.equal(Status.word({ ...swarm, why: 'rest' }), 'Stopped after errors')
  assert.equal(Status.word({ ...swarm, why: 'money' }), 'Needs money')
  assert.equal(Status.word({ ...swarm, why: 'costly' }), 'Needs money')
  assert.equal(Status.word(swarm), 'Resting')
  assert.deepEqual(Status.standing({ ...swarm, remaining: '0.010000' }), { action: 'Add $2 to wake it', mood: 'money', word: 'Needs money' })
})
