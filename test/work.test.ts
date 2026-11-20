import assert from 'node:assert/strict'
import test from 'node:test'
import * as Work from '../src/worker/Work.ts'
import { Board } from 'nanocode-ts'
import { board, module, sql } from './board.ts'

test('a claim is exclusive until its lease lapses, and a lapsed one is taken over', async () => {
  const host = sql()
  const one = board('swarm:abc', 'swarm:a', host)
  // A board is chartered for the actor that opened it first; let other swarms work on it.
  assert.ok((await one.grant({ can: { '*': ['manage'] }, who: [{ id: 'swarm', kind: 'kind' }] }, { key: 'grant-swarms' })).ok)
  const two = board('swarm:abc', 'swarm:b', host)
  await Work.ensure(one, { id: 't', spec: 'turn' })
  const first = await one.claim('t', { leaseMs: 1_000 })
  assert.equal(first.ok, true)
  await two.refresh()
  const refused = await two.claim('t', { leaseMs: 1_000 })
  assert.equal(!refused.ok && refused.rejection.kind, 'Held')
  const later = await two.claim('t', { atMs: Date.now() + 2_000, leaseMs: 1_000 })
  assert.equal(later.ok && later.tookOver, true)
  await one.refresh()
  assert.equal(first.ok && (await one.renew('t', first.claim, 1_000)).ok, false)
})

test('a renewed lease says when it now runs out', async () => {
  const one = board()
  await Work.ensure(one, { id: 't', spec: 'turn' })
  const claimed = await one.claim('t', { leaseMs: 1_000 })
  assert.ok(claimed.ok)
  const before = Date.now()
  const until = Work.until(await one.renew('t', claimed.claim, 60_000))
  assert.ok(until !== undefined && until >= before + 60_000 && until < before + 61_000)
  assert.equal((await one.task('t'))?.untilMs, until)
  assert.equal(Work.until(await one.renew('t', 'not the claim', 60_000)), undefined)
})

test('a failed task waits out its retry backoff, doubling each time, then fails for good', async () => {
  const one = board()
  await Work.ensure(one, { id: 't', spec: 'turn', terms: { retry: { backoffMs: 100, maxAttempts: 3 } } })
  let at = Date.now()
  for (const wait of [100, 200]) {
    const claimed = await one.claim('t', { atMs: at, leaseMs: 1_000 })
    assert.ok(claimed.ok)
    assert.ok((await one.finish('t', claimed.claim, { failed: 'no' }, at)).ok)
    const found = await one.task('t', at)
    const due = found?.dueAtMs ?? 0
    assert.equal(found?.phase, 'open')
    assert.ok(due - at >= wait && due - at < wait + 50, `due ${due - at}ms after the failure, not ${wait}ms`)
    assert.deepEqual((await one.ready({ atMs: at })).map((each) => each.id), [])
    assert.equal((await one.claim('t', { atMs: at, leaseMs: 1_000 })).ok, false)
    assert.deepEqual((await one.ready({ atMs: due })).map((each) => each.id), ['t'])
    at = due
  }
  const last = await one.claim('t', { atMs: at, leaseMs: 1_000 })
  assert.ok(last.ok)
  assert.ok((await one.finish('t', last.claim, { failed: 'no' }, at)).ok)
  const found = await one.task('t', at)
  assert.deepEqual([found?.phase, found?.attempts], ['failed', 3])
  assert.equal(Work.delay({ backoffMs: 100, maxAttempts: 3 }, 3), 400)
})

test('a steer is kept once per key, and heeding up to one clears it and those before it', async () => {
  const one = board()
  await Work.ensure(one, { id: 'notes', labels: Work.instance, spec: 'notes' })
  assert.ok((await one.steer('notes', 'try the other model', { key: 'n1:5' })).ok)
  assert.ok((await one.steer('notes', 'try the other model', { key: 'n1:5' })).ok)
  assert.ok((await one.steer('notes', 'and write it down', { key: 'n2:1' })).ok)
  assert.ok((await one.steer('notes', 'and then a third', { key: 'n3:1' })).ok)
  const steers = await one.steers('notes')
  assert.deepEqual(steers.map((steer) => steer.body), ['try the other model', 'and write it down', 'and then a third'])
  const held = await Work.lock(one, 'notes', 1_000)
  assert.ok(held.ok)
  assert.ok((await one.heed('notes', held.claim, steers[1]!.seq)).ok)
  assert.deepEqual((await one.steers('notes')).map((steer) => steer.body), ['and then a third'])
  assert.ok((await one.release('notes', held.claim)).ok)
  assert.ok((await one.steer('notes', 'and write it down', { key: 'n2:1' })).ok)
  assert.deepEqual((await one.steers('notes')).map((steer) => steer.body), ['and then a third'])
})

test('a capped claim is refused while the cap is held by others', async () => {
  const one = board()
  for (const id of ['h1', 'h2', 'h3']) await Work.ensure(one, { id, spec: id })
  assert.ok((await one.claim('h1', { cap: 2, leaseMs: 1_000 })).ok)
  assert.ok((await one.claim('h2', { cap: 2, leaseMs: 1_000 })).ok)
  const full = await one.claim('h3', { cap: 2, leaseMs: 1_000 })
  assert.equal(!full.ok && full.rejection.kind, 'Full')
})

test('a once-only step runs once, and again only if it threw', async () => {
  const one = board()
  let runs = 0
  await assert.rejects(Work.once(one, 'settle:1', 1_000, async () => { runs++; throw new Error('down') }))
  assert.deepEqual(await Work.once(one, 'settle:1', 1_000, async () => ++runs), { ran: true, value: 2 })
  assert.deepEqual(await Work.once(one, 'settle:1', 1_000, async () => ++runs), { ran: false })
  assert.equal(runs, 2)
})

test('locks run work one at a time, and a restart lets go of what the last life held', async () => {
  const host = sql()
  const one = board('swarm:abc', 'swarm:abc', host)
  const order: string[] = []
  let release = () => {}
  const first = Work.serial(one, 'budgeting', 1_000, () => new Promise<void>((resolve) => { order.push('first'); release = resolve }), 5)
  const second = Work.serial(one, 'budgeting', 1_000, async () => void order.push('second'), 5)
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(order, ['first'])
  release()
  await Promise.all([first, second])
  assert.deepEqual(order, ['first', 'second'])

  assert.ok((await Work.lock(one, 'stepping', 60_000)).ok)
  assert.ok((await Work.lock(one, 'snapping', 60_000, Work.lasting)).ok)
  const reborn = board('swarm:abc', 'swarm:abc', host)
  await Work.reclaim(reborn)
  assert.ok((await Work.lock(reborn, 'stepping', 60_000)).ok)
  assert.equal((await Work.lock(reborn, 'snapping', 60_000, Work.lasting)).ok, false)
  const skipped = await Work.holding(reborn, 'stepping', 1_000, async () => 1)
  assert.equal('rejection' in skipped && skipped.rejection.kind, 'Held')
})

test('a board that opens on its first call opens once, and again after a failed open', async () => {
  let opens = 0
  const lazy = Work.opening('swarm:abc', 'swarm:abc', async () => {
    if (++opens === 1) throw new Error('not yet')
    return Board.open({ actor: 'swarm:abc', module, scope: 'swarm:abc', sql: sql() })
  })
  assert.equal(lazy.scope, 'swarm:abc')
  await assert.rejects(lazy.tasks(), /not yet/)
  await Work.ensure(lazy, { id: 't', spec: 'turn' })
  assert.deepEqual((await lazy.tasks()).map((each) => each.id), ['t'])
  assert.equal(opens, 2)
})
