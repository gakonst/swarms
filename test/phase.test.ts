import assert from 'node:assert/strict'
import test from 'node:test'
import * as Phase from '../src/worker/Phase.ts'

const keys = (values: Record<string, unknown>) => ({ get: <T>(key: string) => values[key] as T | undefined })

const money: Phase.Pause = { left: '21000', wake: null, why: 'money' }

test('a run moves only along its allowed transitions', () => {
  assert.ok(Phase.can('new', 'starting'))
  assert.ok(Phase.can('waiting', 'starting'))
  assert.ok(Phase.can('starting', 'working'))
  assert.ok(Phase.can('starting', 'waiting'))
  assert.ok(Phase.can('working', 'waiting'))
  assert.ok(Phase.can('working', 'paused'))
  assert.ok(Phase.can('paused', 'waiting'))
  assert.ok(!Phase.can('paused', 'starting'))
  assert.ok(!Phase.can('paused', 'working'))
  assert.ok(!Phase.can('starting', 'paused'))
  assert.ok(!Phase.can('waiting', 'working'))
  assert.throws(() => Phase.check('paused', 'working'), /cannot go from paused to working/)
})

test('each pause says which wakes it', () => {
  assert.ok(Phase.wakes(money, 'money'))
  assert.ok(!Phase.wakes(money, 'note'))
  assert.ok(!Phase.wakes({ why: 'unfunded' }, 'note'))
  assert.ok(Phase.wakes({ failures: 3, why: 'rest' }, 'note'))
  assert.ok(Phase.wakes({ wanted: '400000', why: 'costly' }, 'note'))
  assert.ok(Phase.wakes({ wanted: '400000', why: 'costly' }, 'money'))
  assert.ok(Phase.wakes({ why: 'idle' }, 'note'))
  assert.ok(Phase.wakes({ why: 'idle' }, 'money'))
  assert.equal(Phase.reason({ why: 'idle' }), 'Waiting for backers: new money, a steer or a message in its room wakes it.')
  assert.ok(!Phase.due({ at: 0, pause: money, state: 'paused' }, 10))
  assert.ok(Phase.due({ at: 0, pause: { ...money, wake: 5 }, state: 'paused' }, 10))
  assert.ok(!Phase.due({ at: 0, pause: { failures: 3, why: 'rest' }, state: 'paused' }, 10))
})

test('D1 status and why come from one projection', () => {
  assert.deepEqual(Phase.project({ state: 'new' }, 0), { status: 'funding', why: null })
  assert.deepEqual(Phase.project({ at: 0, pause: { why: 'unfunded' }, state: 'paused' }, 0), { status: 'funding', why: 'unfunded' })
  assert.deepEqual(Phase.project({ at: 0, pause: money, state: 'paused' }, 0), { status: 'funding', why: 'money' })
  assert.deepEqual(Phase.project({ at: 0, pause: money, state: 'paused' }, 4), { status: 'paused', why: 'money' })
  assert.deepEqual(Phase.project({ from: money, since: null, state: 'waiting', until: 0 }, 4), { status: 'paused', why: 'money' })
  assert.deepEqual(Phase.project({ since: 5, state: 'waiting', until: 0 }, 4), { status: 'running', why: null })
  assert.deepEqual(Phase.project({ since: null, state: 'waiting', until: 0 }, 0), { status: 'funding', why: null })
  assert.deepEqual(Phase.project({ id: 'a:1', n: 1, since: null, state: 'starting', told: [] }, 1), { status: 'running', why: null })
  assert.deepEqual(Phase.project({ from: 0, n: 2, since: 1, started: 1, state: 'working', turn: 't' }, 2), { status: 'running', why: null })
})

test('a pause is stored as data and its sentence rendered when read', () => {
  assert.equal(Phase.reason(money), 'Out of money: $0.021 left, and one step can cost up to $0.05. Fund it to keep going.')
  assert.equal(Phase.reason({ failures: 3, why: 'rest' }), 'Stopped after 3 errors in a row. New money or a note restarts it.')
  assert.match(Phase.reason({ wanted: '400000', why: 'costly' }), /about \$0\.40 at once/)
  assert.ok(Phase.same(money, { ...money, wake: 7 }))
  assert.ok(!Phase.same(money, { ...money, left: '1' }))
})

test('old storage becomes one run', () => {
  assert.deepEqual(Phase.migrated(keys({}), 0, 9), { state: 'new' })
  assert.deepEqual(Phase.migrated(keys({ n: 3, since: 2, started: 4, turn: 'r3', wanted: '5' }), 3, 9), { from: 0, n: 3, since: 2, started: 4, state: 'working', turn: 'r3', wanted: '5' })
  assert.deepEqual(Phase.migrated(keys({ agent: 'agt', since: 2 }), 3, 9), { since: 2, state: 'waiting', until: 9 })
  assert.deepEqual(Phase.migrated(keys({ left: '0.021000', paused: 'Out of money: $0.021 left', why: 'money' }), 3, 9), { from: money, since: null, state: 'waiting', until: 9 })
  assert.deepEqual(Phase.migrated(keys({ paused: 'Stopped after 3 errors in a row.', why: 'rest' }), 3, 9), { at: 9, pause: { failures: 3, why: 'rest' }, state: 'paused' })
  assert.deepEqual(Phase.migrated(keys({ paused: 'Paused: its next step needs about $0.40 at once', why: 'costly' }), 3, 9), { at: 9, pause: { wanted: '400000', why: 'costly' }, state: 'paused' })
  assert.deepEqual(Phase.migrated(keys({ paused: 'Resting', why: 'idle' }), 3, 9).state, 'waiting')
  assert.deepEqual(Phase.migrated(keys({ refundAt: 1 }), 3, 9).state, 'waiting')
})
