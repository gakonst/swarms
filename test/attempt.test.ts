import assert from 'node:assert/strict'
import test from 'node:test'
import * as Attempt from '../src/web/attempt.ts'

test('an attempt starts only when nothing is running, so a second submit is refused', () => {
  const busy = Attempt.start(Attempt.idle)
  assert.deepEqual(busy, { at: 'busy' })
  assert.equal(Attempt.start(busy!), undefined)
  assert.deepEqual(Attempt.start({ at: 'failed', error: 'no' }), { at: 'busy' })
})

test('an attempt settles or fails only while it runs', () => {
  const busy: Attempt.Attempt = { at: 'busy' }
  assert.deepEqual(Attempt.settle(busy), Attempt.idle)
  assert.deepEqual(Attempt.fail(busy, 'taken'), { at: 'failed', error: 'taken' })
  assert.deepEqual(Attempt.settle(Attempt.idle), Attempt.idle)
  assert.deepEqual(Attempt.fail(Attempt.idle, 'late'), Attempt.idle)
  assert.deepEqual(Attempt.settle({ at: 'failed', error: 'kept' }), { at: 'failed', error: 'kept' })
})

test('a running attempt shows no error, and a failed one shows only its own', () => {
  assert.equal(Attempt.busy({ at: 'busy' }), true)
  assert.equal(Attempt.error({ at: 'busy' }), undefined)
  assert.equal(Attempt.busy({ at: 'failed', error: 'no' }), false)
  assert.equal(Attempt.error({ at: 'failed', error: 'no' }), 'no')
})
