import assert from 'node:assert/strict'
import test from 'node:test'
import * as Work from '../src/worker/Work.ts'
import { memorySql } from './sql.ts'

function board(actor = 'a', sql = memorySql()) {
  return { board: Work.local(sql, 'swarm:abc', actor), sql }
}

test('a claim is exclusive until its lease lapses, and a lapsed one is taken over', async () => {
  const { board: one, sql } = board('a')
  const two = Work.local(sql, 'swarm:abc', 'b')
  await Work.ensure(one, { id: 't', spec: 'turn' })
  const first = await one.claim('t', { leaseMs: 1_000 })
  assert.equal(first.ok, true)
  const refused = await two.claim('t', { leaseMs: 1_000 })
  assert.equal(!refused.ok && refused.rejection.kind, 'Held')
  const later = await two.claim('t', { atMs: Date.now() + 2_000, leaseMs: 1_000 })
  assert.equal(later.ok && later.tookOver, true)
  assert.equal(first.ok && (await one.renew('t', first.claim, 1_000)).ok, false)
})

test('a claim key is the claim id, so the gateway sees the same id on every try', async () => {
  const { board: one } = board()
  await Work.ensure(one, { id: 'turn:1', spec: 'turn 1' })
  const claimed = await one.claim('turn:1', { key: 'agt:1', leaseMs: 1_000 })
  assert.deepEqual(claimed.ok && claimed.claim, 'agt:1')
})

test('a failed task waits out its retry backoff, doubling each time, then fails for good', async () => {
  const { board: one } = board()
  await Work.ensure(one, { id: 't', spec: 'turn', terms: { retry: { backoffMs: 100, maxAttempts: 3 } } })
  let at = Date.now()
  for (const wait of [100, 200]) {
    const claimed = await one.claim('t', { atMs: at, leaseMs: 1_000 })
    assert.ok(claimed.ok)
    const before = Date.now()
    assert.ok((await one.finish('t', claimed.claim, { failed: 'no' })).ok)
    const due = (await one.task('t'))?.dueAtMs ?? 0
    assert.equal((await one.task('t'))?.phase, 'open')
    assert.ok(due - before >= wait && due - before < wait + 50)
    assert.deepEqual((await one.ready()).map((found) => found.id), [])
    const early = await one.claim('t', { leaseMs: 1_000 })
    assert.equal(!early.ok && early.rejection.kind, 'Waiting')
    assert.deepEqual((await one.ready({ atMs: due })).map((found) => found.id), ['t'])
    at = due
  }
  const last = await one.claim('t', { atMs: at, leaseMs: 1_000 })
  assert.ok(last.ok)
  assert.ok((await one.finish('t', last.claim, { failed: 'no' })).ok)
  assert.deepEqual([(await one.task('t'))?.phase, (await one.task('t'))?.attempts], ['failed', 3])
  assert.equal(Work.delay({ backoffMs: 100, maxAttempts: 3 }, 3), 400)
})

test('steers wait for the holder to heed them before it may finish', async () => {
  const { board: one } = board()
  await Work.ensure(one, { id: 'notes', spec: 'notes' })
  assert.ok((await one.steer('notes', 'try the other model', { key: 'n1:5' })).ok)
  assert.ok((await one.steer('notes', 'try the other model', { key: 'n1:5' })).ok)
  assert.ok((await one.steer('notes', 'and write it down', { key: 'n2:1' })).ok)
  const steers = await one.steers('notes')
  assert.deepEqual(steers.map((steer) => steer.key), ['n1:5', 'n2:1'])
  const claimed = await one.claim('notes', { leaseMs: 1_000 })
  assert.ok(claimed.ok)
  const early = await one.finish('notes', claimed.claim, { done: '' })
  assert.equal(!early.ok && early.rejection.kind, 'Unheeded')
  assert.ok((await one.heed('notes', claimed.claim, steers.map((steer) => steer.id))).ok)
  assert.deepEqual((await one.steers('notes')), [])
  assert.ok((await one.finish('notes', claimed.claim, { done: '' })).ok)
  assert.equal(!(await one.steer('notes', 'late')).ok, true)
})

test('a capped claim is refused while the cap is held by others', async () => {
  const { board: one } = board()
  for (const id of ['h1', 'h2', 'h3']) await Work.ensure(one, { id, spec: id })
  assert.ok((await one.claim('h1', { cap: 2, leaseMs: 1_000 })).ok)
  assert.ok((await one.claim('h2', { cap: 2, leaseMs: 1_000 })).ok)
  const full = await one.claim('h3', { cap: 2, leaseMs: 1_000 })
  assert.deepEqual(!full.ok && full.rejection, { cap: 2, kind: 'Full' })
})

test('a once-only step runs once, and again only if it threw', async () => {
  const { board: one } = board()
  let runs = 0
  await assert.rejects(Work.once(one, 'settle:1', 1_000, async () => { runs++; throw new Error('down') }))
  assert.deepEqual(await Work.once(one, 'settle:1', 1_000, async () => ++runs), { ran: true, value: 2 })
  assert.deepEqual(await Work.once(one, 'settle:1', 1_000, async () => ++runs), { ran: false })
  assert.equal(runs, 2)
})

test('locks run work one at a time, and a restart lets go of what the last life held', async () => {
  const { board: one, sql } = board('boot1')
  const order: string[] = []
  let release = () => {}
  const first = Work.serial(one, 'budgeting', 1_000, () => new Promise<void>((resolve) => { order.push('first'); release = resolve }), 5)
  const second = Work.serial(one, 'budgeting', 1_000, async () => void order.push('second'), 5)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(order, ['first'])
  release()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first', 'second'])

  assert.ok((await Work.lock(one, 'stepping', 60_000)).ok)
  assert.ok((await Work.lock(one, 'snapping', 60_000, Work.lasting)).ok)
  const reborn = Work.local(sql, 'swarm:abc', 'boot2')
  await Work.reclaim(reborn, 'boot2')
  assert.ok((await Work.lock(reborn, 'stepping', 60_000)).ok)
  assert.equal((await Work.lock(reborn, 'snapping', 60_000, Work.lasting)).ok, false)
  const skipped = await Work.holding(reborn, 'stepping', 1_000, async () => 1)
  assert.equal('rejection' in skipped && skipped.rejection.kind, 'Held')
})
