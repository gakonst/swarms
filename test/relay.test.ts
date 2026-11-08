import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import * as Relay from '../src/worker/Relay.ts'

function object(instance: () => string | undefined) {
  const writes: string[] = []
  let closed = false
  const writer = { close: () => ((closed = true), Promise.resolve()), desiredSize: 1, write: (bytes: Uint8Array) => (writes.push(new TextDecoder().decode(bytes)), Promise.resolve()) }
  const watcher: Relay.Watcher = { follow: true, relaying: false, until: Date.now() + Relay.followForMs, writer: writer as never }
  const self = { beating: undefined, boot: 'b1', ctx: { storage: { kv: { get: instance } } }, watchers: new Set([watcher]) }
  return { closed: () => closed, self: self as never as Parameters<typeof Relay.beat>[0], watcher, writes }
}

test('the live heartbeat keeps watchers of the current instance and closes those an instance after a deploy took over', () => {
  mock.timers.enable({ apis: ['setInterval'] })
  try {
    const current = object(() => 'b1')
    Relay.beat(current.self)
    mock.timers.tick(25_000)
    assert.deepEqual(current.writes, [': keepalive\n\n'])
    assert.equal(current.closed(), false)
    Relay.unwatch(current.self, current.watcher)

    const replaced = object(() => 'b2')
    Relay.beat(replaced.self)
    mock.timers.tick(25_000)
    assert.deepEqual(replaced.writes, [])
    assert.equal(replaced.closed(), true)
    assert.equal(replaced.self.watchers.size, 0)
    assert.equal(replaced.self.beating, undefined)

    const reset = object(() => {
      throw new Error('Durable Object reset because its code was updated.')
    })
    Relay.beat(reset.self)
    mock.timers.tick(25_000)
    assert.equal(reset.closed(), true)
  } finally {
    mock.timers.reset()
  }
})
