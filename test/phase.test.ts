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
  assert.equal(Phase.reason({ why: 'idle' }), 'Out of money. Ride it to keep it going.')
  assert.equal(Phase.reason({ why: 'unfunded' }), 'Nobody is riding it yet.')
  assert.ok(Phase.stale('idle') && Phase.stale('rest') && Phase.stale('costly') && !Phase.stale('money') && !Phase.stale(null))
  assert.ok(!Phase.due({ at: 0, pause: money, state: 'paused' }, 10))
  assert.ok(Phase.due({ at: 0, pause: { ...money, wake: 5 }, state: 'paused' }, 10))
  assert.ok(!Phase.due({ at: 0, pause: { failures: 3, why: 'rest' }, state: 'paused' }, 10))
})

test('a pause goes on when the money is there, and one the gateway refused with money on paper only once more was put in', () => {
  const enough = { balance: 5_000_000n, left: 400_000n, reserve: 50_000n }
  const refused: Phase.Pause = { balance: '5000000', left: '9760000', needs: '440960', wake: null, why: 'money' }
  assert.ok(!Phase.resumes(money, { ...enough, left: 49_999n }))
  assert.ok(Phase.resumes(money, enough))
  assert.ok(Phase.resumes({ ...money, needs: '50000' }, enough))
  assert.ok(Phase.resumes({ why: 'unfunded' }, enough))
  assert.ok(!Phase.resumes(refused, enough))
  assert.ok(!Phase.resumes({ ...refused, balance: undefined }, { ...enough, balance: 9_000_000n }))
  assert.ok(Phase.resumes(refused, { ...enough, balance: 5_000_001n }))
  assert.ok(!Phase.resumes(refused, { ...enough, balance: 5_000_001n, left: 0n }))
  assert.ok(Phase.resumes(refused, { ...enough, due: true }))
  assert.ok(!Phase.resumes(refused, { ...enough, due: true, left: 0n }))
  assert.ok(!Phase.due({ at: 0, pause: { ...refused, wake: 600 }, state: 'paused' }, 599))
  assert.ok(Phase.due({ at: 0, pause: { ...refused, wake: 600 }, state: 'paused' }, 600))
  assert.ok(Phase.due({ at: 0, pause: { ...refused, wake: 9 * Phase.maxPatienceMs }, state: 'paused' }, Phase.maxPatienceMs))
  assert.equal(Phase.reason(refused), 'Its last step could not be paid for, though it has money. It tries again by itself.')
  assert.ok(Phase.again({ from: refused, since: null, state: 'waiting', until: 0 }) && !Phase.again({ from: money, since: null, state: 'waiting', until: 0 }) && !Phase.again({ since: null, state: 'waiting', until: 0 }))
  assert.ok(!Phase.due({ at: 0, pause: refused, state: 'paused' }, Phase.rereadMs - 1))
  assert.ok(Phase.due({ at: 0, pause: refused, state: 'paused' }, Phase.rereadMs))
  assert.deepEqual([1, 2, 3, 9].map(Phase.patience), [Phase.rereadMs, 2 * Phase.rereadMs, 4 * Phase.rereadMs, Phase.maxPatienceMs])
  assert.equal(Phase.waking({ at: 0, pause: { ...refused, wake: 600 }, state: 'paused' }, 599), 600)
  assert.equal(Phase.waking({ at: 0, pause: { ...refused, wake: 600 }, state: 'paused' }, 600), null)
  assert.equal(Phase.waking({ at: 0, pause: refused, state: 'paused' }, 0), Phase.rereadMs)
  assert.equal(Phase.waking({ at: 0, pause: money, state: 'paused' }, 0), null)
  assert.ok(Phase.unread({ at: 0, pause: { ...refused, wake: 600 }, settled: 5, state: 'paused' }, 600))
  assert.ok(!Phase.unread({ at: 0, pause: { ...refused, wake: 600 }, settled: 601, state: 'paused' }, 700))
})

test('a pause reads its money again ten minutes after it last did', () => {
  assert.ok(Phase.unread({ at: 0, pause: money, state: 'paused' }, 1))
  assert.ok(!Phase.unread({ at: 0, pause: money, settled: 5, state: 'paused' }, 5 + Phase.rereadMs - 1))
  assert.ok(Phase.unread({ at: 0, pause: money, settled: 5, state: 'paused' }, 5 + Phase.rereadMs))
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
  assert.equal(Phase.reason(money), 'Out of money. Ride it to keep it going.')
  assert.ok(Phase.same(money, { ...money, wake: 7 }))
  assert.ok(Phase.same(money, { ...money, left: '1' }))
  assert.ok(!Phase.same(money, { why: 'unfunded' }))
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
