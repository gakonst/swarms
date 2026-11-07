import assert from 'node:assert/strict'
import test from 'node:test'
import * as Search from '../src/worker/Search.ts'
import * as Store from '../src/worker/Store.ts'
import { open } from './d1.ts'

type Opened = ReturnType<typeof open>

function swarm(db: Opened, id: string, fields: { hidden?: number; rounds?: number; status?: string; updated?: number } = {}) {
  db.sqlite
    .prepare('insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at) values (?, ?, ?, ?, ?, ?, 1, ?)')
    .run(id, 'Swarm ' + id, 'The goal of swarm ' + id, fields.status ?? 'paused', fields.rounds ?? 0, fields.hidden ?? 0, fields.updated ?? 1)
}

function give(db: Opened, swarm: string, contributor: string, amount: number, note: string | null = null) {
  db.sqlite
    .prepare("insert into contributions (id, swarm, kind, contributor, token, amount, note, note_id, created_at) values (?, ?, 'transfer', ?, 'ousd', ?, ?, ?, ?)")
    .run(crypto.randomUUID(), swarm, contributor, String(amount), note, note ? note.slice(0, 16) : null, Date.now())
}

function report(db: Opened, swarm: string, round: number) {
  db.sqlite.prepare("insert into reports (swarm, round, status, message, started_at, ended_at, spent) values (?, ?, 'completed', 'update', ?, ?, '0')").run(swarm, round, round * 10, round * 10 + 5)
}

function planned(db: Opened, pattern: RegExp) {
  const logged = db.log.findLast((entry) => pattern.test(entry.query))
  assert.ok(logged, String(pattern))
  return db.plan(logged).join('\n')
}

test('the list and a swarm read their totals from the backing index, each contribution once', async () => {
  const db = open()
  swarm(db, 'a', { status: 'running', updated: 3 })
  swarm(db, 'b', { hidden: 1 })
  swarm(db, 'c', { updated: 2 })
  swarm(db, 'd')
  give(db, 'a', '0x01', 100)
  give(db, 'a', '0x01', 50, 'faster parser')
  give(db, 'a', '0x02', 25)
  give(db, 'b', '0x01', 100)
  give(db, 'd', '0x03', 0)

  const listed = await Store.list(db.env)
  assert.deepEqual(listed.map((row) => [row.id, row.raised, row.contributors, row.spent, row.remaining]), [['a', 175, 2, 0, 0]])
  assert.deepEqual((await Store.list(db.env, 'paused')).map((row) => row.id), [])
  assert.match(planned(db, /from swarms s join/), /SCAN contributions USING COVERING INDEX contributions_backing/)

  const found = await Store.find(db.env, 'a')
  assert.deepEqual([found?.raised, found?.contributors], [175, 2])
  assert.match(planned(db, /where s\.id = \?/), /SEARCH contributions USING COVERING INDEX contributions_backing \(swarm=\?\)/)
  const empty = await Store.find(db.env, 'c')
  assert.deepEqual([empty?.raised, empty?.contributors], [0, 0])
  assert.equal(await Store.find(db.env, 'zz'), null)
})

test('a steer spends only backing not yet behind a note, looked up by its author', async () => {
  const db = open()
  swarm(db, 'a')
  give(db, 'a', '0x01', 100)
  give(db, 'a', '0x01', 30, 'behind a note')
  give(db, 'a', '0x02', 500)
  const steer = (id: string, amount: bigint) => Store.steer(db.env, { amount, contributor: '0x01', id, note: 'go faster', note_id: 'n1', swarm: 'a' })

  assert.equal(await steer('s1', 60n), true)
  assert.match(planned(db, /insert into steers/), /SEARCH contributions USING COVERING INDEX contributions_backing \(swarm=\? AND contributor=\?\)/)
  assert.equal(await steer('s2', 41n), false)
  assert.equal(await steer('s3', 40n), true)
  const [member] = (await Store.members(db.env, 'a')).filter((found) => found.address === '0x01')
  assert.deepEqual([member?.backed, member?.steered, member?.available], ['0.000130', '0.000130', '0.000000'])
})
