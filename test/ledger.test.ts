import assert from 'node:assert/strict'
import test from 'node:test'
import * as Store from '../src/worker/Store.ts'
import { open } from './d1.ts'

type Opened = ReturnType<typeof open>

const rider = '0x00000000000000000000000000000000000000a1'

function swarm(db: Opened) {
  db.sqlite.prepare("insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at) values ('s', 'Swarm', 'The goal of the swarm', 'paused', 0, 0, 1, 1)").run()
  return db
}

function give(db: Opened, amount: bigint, id = '0xfeed', channel: `0x${string}` | null = null) {
  return Store.give(db.env, { amount: String(amount), channel, contributor: rider, id, note: null, note_id: null, swarm: 's', token: 'ousd' })
}

function fund(db: Opened, branch: number, amount: bigint, id: string) {
  return Store.steer(db.env, { amount, branch: { agent: 'agt', id: branch }, contributor: rider, id, note: `branch ${branch}`, note_id: `branch:${branch}`, swarm: 's' })
}

function allot(db: Opened, branch: number, amount: bigint, id: string) {
  return Store.allot(db.env, { amount, branch: { agent: 'agt', id: branch }, contributor: rider, id, limit: null, note: `branch ${branch}`, note_id: `branch:${branch}`, since: 0, swarm: 's' })
}

async function member(db: Opened) {
  const found = (await Store.members(db.env, 's')).find((each) => each.address === rider)
  return [found?.backed, found?.steered, found?.available]
}

function moved(db: Opened) {
  return db.sqlite.prepare("select branch, budget, amount from steers where swarm = ? and id not in ('f1', 'a1') order by budget, branch").all('s').map((row) => [row['branch'], row['budget'], row['amount']])
}

test("moved money stays what it was: the team's goes back to the team budget and a rider's own to the rider, whoever steers now", async () => {
  const team = swarm(open())
  await give(team, 1_000_000n)
  assert.equal(await allot(team, 1, 5_000_000n, 'a1'), true)
  assert.equal((await Store.shift(team.env, { agent: 'agt', amount: 5_000_000n, contributor: rider, from: 1, swarm: 's', to: 2 })).length, 2)
  assert.deepEqual(await Store.settle(team.env, { agent: 'agt', branch: 2, left: null, swarm: 's' }), [{ amount: 5_000_000n, budget: 1, contributor: rider }])
  assert.deepEqual(await member(team), ['1.000000', '0.000000', '1.000000'])
  assert.equal((await Store.allotted(team.env, 's', 0)).get(rider), 0n)
  assert.equal(await Store.steer(team.env, { amount: 6_000_000n, contributor: rider, id: 'more', note: 'mine', note_id: 'n1', swarm: 's' }), false)

  const own = swarm(open())
  await give(own, 5_000_000n)
  assert.equal(await fund(own, 1, 5_000_000n, 'f1'), true)
  assert.equal((await Store.shift(own.env, { agent: 'agt', amount: 5_000_000n, contributor: rider, from: 1, swarm: 's', to: 2 })).length, 2)
  await Store.settle(own.env, { agent: 'agt', branch: 2, left: null, swarm: 's' })
  await Store.settle(own.env, { agent: 'agt', branch: 1, left: null, swarm: 's' })
  assert.deepEqual(await member(own), ['5.000000', '0.000000', '5.000000'])
  assert.equal((await Store.allotted(own.env, 's', 0)).get(rider), undefined)
})

test('a move takes a rider\'s own money first and the team\'s for the rest, and never more than they put behind the branch', async () => {
  const db = swarm(open())
  await give(db, 3_000_000n)
  await fund(db, 1, 3_000_000n, 'f1')
  await allot(db, 1, 4_000_000n, 'a1')
  assert.deepEqual(await Store.shift(db.env, { agent: 'agt', amount: 7_000_001n, contributor: rider, from: 1, swarm: 's', to: 2 }), [])
  assert.equal((await Store.shift(db.env, { agent: 'agt', amount: 5_000_000n, contributor: rider, from: 1, swarm: 's', to: 2 })).length, 4)
  assert.deepEqual(moved(db), [[1, 0, '-3000000'], [2, 0, '3000000'], [1, 1, '-2000000'], [2, 1, '2000000']])
  const money = await Store.funds(db.env, 's', 'agt')
  assert.deepEqual([money.shares.get(1)?.get(rider), money.shares.get(2)?.get(rider)], [2_000_000n, 5_000_000n])

  await Store.settle(db.env, { agent: 'agt', branch: 2, left: null, swarm: 's' })
  assert.deepEqual(await Store.shift(db.env, { agent: 'agt', amount: 1_000_000n, contributor: rider, from: 1, swarm: 's', to: 2 }), [])
})

test('a note goes on money already counted only while that money is behind nothing else', async () => {
  const db = swarm(open())
  await give(db, 10_000_000n, '0xaa')
  await give(db, 4_000_000n, '0xbb')
  assert.equal(await Store.steer(db.env, { amount: 10_000_000n, contributor: rider, id: 's1', note: 'idea one', note_id: 'n1', swarm: 's' }), true)
  assert.equal(await Store.annotate(db.env, 's', '0xaa', { note: 'idea two', note_id: 'n2' }), null)
  assert.equal((await Store.annotate(db.env, 's', '0xbb', { note: 'idea two', note_id: 'n2' }))?.note, 'idea two')
  assert.match(db.plan(db.log.findLast((entry) => /update contributions set note/.test(entry.query)) as never).join('\n'), /contributions_backing \(swarm=\? AND contributor=\?\)/)
  assert.equal(await Store.annotate(db.env, 'other', '0xaa', { note: 'idea two', note_id: 'n2' }), null)

  const row = await Store.find(db.env, 's')
  const notes = await Store.notes(db.env, 's', BigInt(row?.balance ?? 0), new Set())
  assert.deepEqual(notes.map((note) => [note.id, note.weight, note.share]), [['n1', '10.000000', 0.7142], ['n2', '4.000000', 0.2857]])
  assert.deepEqual(await member(db), ['14.000000', '14.000000', '0.000000'])
})

test('a backing lowered to what it paid takes back what was steered with the rest, the newest first', async () => {
  const db = swarm(open())
  await give(db, 10_000_000n, 'backing:0xkey', '0xkey')
  await give(db, 2_000_000n, '0xaa')
  await db.env.DB.prepare("update contributions set note = 'kept', note_id = 'n0' where id = '0xaa'").run()
  db.sqlite.prepare("insert into branches (swarm, agent, branch, base, created_at, settled_at) values ('s', 'agt', 9, '0', 1, 5)").run()
  db.sqlite.prepare("insert into steers (id, swarm, contributor, note, note_id, amount, created_at, branch, agent) values ('spent', 's', ?, 'branch 9', 'branch:9', '1000000', 1, 9, 'agt')").run(rider)
  db.sqlite.prepare("insert into steers (id, swarm, contributor, note, note_id, amount, created_at) values ('old', 's', ?, 'older idea', 'n1', '3000000', 2)").run(rider)
  assert.equal(await fund(db, 3, 4_000_000n, 'f1'), true)
  assert.equal(await Store.steer(db.env, { amount: 2_000_000n, contributor: rider, id: 'new', note: 'newer idea', note_id: 'n2', swarm: 's' }), true)
  assert.deepEqual(await member(db), ['12.000000', '12.000000', '0.000000'])

  assert.deepEqual(await Store.lower(db.env, 's', 'backing:0xkey', '4000000'), [{ agent: 'agt', branch: 3 }])
  const row = await Store.find(db.env, 's')
  const notes = await Store.notes(db.env, 's', BigInt(row?.balance ?? 0), new Set())
  assert.deepEqual(notes.map((note) => [note.id, note.weight]), [['n1', '3.000000'], ['n0', '2.000000']])
  assert.equal((await Store.funds(db.env, 's', 'agt')).shares.get(3)?.get(rider), 0n)
  assert.deepEqual(await member(db), ['6.000000', '6.000000', '0.000000'])

  assert.deepEqual(await Store.lower(db.env, 's', 'backing:0xkey', '2000000'), [])
  assert.deepEqual(await member(db), ['4.000000', '4.000000', '0.000000'])
  assert.deepEqual(await Store.lower(db.env, 's', 'backing:0xkey', '2000000'), [])
  assert.equal(db.sqlite.prepare('select count(*) as n from steers').get()?.['n'], 7)
})

test('a branch is settled and its unspent money returned in one write, so a failed settle is settled by the next', async () => {
  const db = swarm(open())
  await give(db, 5_000_000n)
  assert.equal(await fund(db, 3, 5_000_000n, 'f1'), true)
  const batch = db.env.DB.batch.bind(db.env.DB)
  let failing = true
  ;(db.env.DB as { batch: unknown }).batch = async (statements: D1PreparedStatement[]) => {
    const refunds = statements.some((each) => /insert into steers/.test((each as unknown as { query: string }).query))
    if (!failing || !refunds) return batch(statements)
    failing = false
    return batch([...statements, db.env.DB.prepare('select * from nothing')])
  }
  await assert.rejects(Store.settle(db.env, { agent: 'agt', branch: 3, left: null, swarm: 's' }))
  assert.deepEqual(await member(db), ['5.000000', '5.000000', '0.000000'])
  assert.deepEqual([...(await Store.funds(db.env, 's', 'agt')).settled], [])

  assert.deepEqual(await Store.settle(db.env, { agent: 'agt', branch: 3, left: null, swarm: 's' }), [{ amount: 5_000_000n, budget: 0, contributor: rider }])
  assert.deepEqual(await member(db), ['5.000000', '0.000000', '5.000000'])
  assert.deepEqual([...(await Store.funds(db.env, 's', 'agt')).settled], [3])
  assert.deepEqual(await Store.settle(db.env, { agent: 'agt', branch: 3, left: null, swarm: 's' }), [])
  assert.equal(await fund(db, 3, 1_000_000n, 'f2'), false)
  assert.deepEqual(await member(db), ['5.000000', '0.000000', '5.000000'])
})

test('what a branch did not spend goes back in proportion to what each put behind it, the team\'s to the 30 days it came from', async () => {
  const db = swarm(open())
  const other = '0x00000000000000000000000000000000000000b2'
  await give(db, 3_000_000n)
  await Store.give(db.env, { amount: '1000000', channel: null, contributor: other, id: '0xbb', note: null, note_id: null, swarm: 's', token: 'ousd' })
  await fund(db, 1, 3_000_000n, 'f1')
  await Store.steer(db.env, { amount: 1_000_000n, branch: { agent: 'agt', id: 1 }, contributor: other, id: 'f2', note: 'branch 1', note_id: 'branch:1', swarm: 's' })
  await allot(db, 1, 4_000_000n, 'a1')
  db.sqlite.prepare("update steers set created_at = 7 where id = 'a1'").run()
  const back = await Store.settle(db.env, { agent: 'agt', branch: 1, left: 4_000_001n, swarm: 's' })
  assert.deepEqual(back.sort((a, b) => Number(b.amount - a.amount)), [
    { amount: 2_000_000n, budget: 1, contributor: rider },
    { amount: 1_500_000n, budget: 0, contributor: rider },
    { amount: 500_000n, budget: 0, contributor: other },
  ])
  assert.equal(db.sqlite.prepare("select created_at from steers where budget = 1 and amount = '-2000000'").get()?.['created_at'], 7)
  assert.equal((await Store.allotted(db.env, 's', 0)).get(rider), 2_000_000n)

  const empty = await Store.settle(db.env, { agent: 'agt', branch: 2, left: 0n, swarm: 's' })
  assert.deepEqual([empty, [...(await Store.funds(db.env, 's', 'agt')).settled].sort()], [[], [1, 2]])
  assert.deepEqual(await Store.replaced(db.env, 's', 'next'), [])
})
