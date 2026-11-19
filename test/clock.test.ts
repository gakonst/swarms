import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { within } from '../src/worker/Clock.ts'

test('a completed read releases its deadline immediately', async (t) => {
  const cleared = t.mock.method(globalThis, 'clearTimeout')
  assert.equal(await within(Promise.resolve('ready'), 2500), 'ready')
  assert.equal(cleared.mock.callCount(), 1)
  assert.notEqual(cleared.mock.calls[0]?.arguments[0], undefined)
})

test('a rejected read falls back and releases its deadline', async (t) => {
  const cleared = t.mock.method(globalThis, 'clearTimeout')
  assert.equal(await within(Promise.reject(new Error('unavailable')), 2500), undefined)
  assert.equal(cleared.mock.callCount(), 1)
})

test('a stalled read falls back at the deadline and a late failure is handled', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    let reject: (error: Error) => void = () => {}
    const pending = new Promise<never>((_, fail) => (reject = fail))
    const result = within(pending, 2500)
    let finished = false
    void result.then(() => (finished = true))
    mock.timers.tick(2499)
    await Promise.resolve()
    assert.equal(finished, false)
    mock.timers.tick(1)
    assert.equal(await result, undefined)
    reject(new Error('late failure'))
    await Promise.resolve()
  } finally {
    mock.timers.reset()
  }
})
