import assert from 'node:assert/strict'
import test from 'node:test'
import * as Status from '../src/shared/Status.ts'

const swarm = { balance: '2.000000', remaining: '0.500000', status: 'paused', why: null } as const

test('a running swarm is live whatever its money', () => {
  assert.deepEqual(Status.standing({ ...swarm, remaining: '0.000000', status: 'running' }), { action: null, mood: 'live', word: 'Running' })
})

test('a swarm nobody backed is new, and one with money but no first step is starting', () => {
  assert.deepEqual(Status.standing({ ...swarm, balance: '0.000000', status: 'funding', why: 'unfunded' }), { action: 'Back it to start it', mood: 'new', word: 'Not started' })
  assert.deepEqual(Status.standing({ ...swarm, status: 'funding', why: null }), { action: null, mood: 'live', word: 'Starting' })
})

test('a swarm only stops for money: out of money needs money, anything else with money left is starting again', () => {
  assert.equal(Status.word({ ...swarm, why: 'money' }), 'Needs money')
  assert.equal(Status.word({ ...swarm, status: 'funding', why: 'money' }), 'Needs money')
  assert.equal(Status.word({ ...swarm, why: 'idle' }), 'Starting')
  assert.equal(Status.word({ ...swarm, why: 'rest' }), 'Starting')
  assert.equal(Status.word(swarm), 'Starting')
  assert.deepEqual(Status.standing({ ...swarm, remaining: '0.010000' }), { action: 'Back it to keep it going', mood: 'money', word: 'Needs money' })
})
