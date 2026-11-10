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
    .prepare("insert into contributions (id, swarm, contributor, token, amount, note, note_id, created_at) values (?, ?, ?, 'ousd', ?, ?, ?, ?)")
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

  assert.equal(await Store.steering(db.env, 'a'), 'open')
  assert.equal(await Store.steering(db.env, 'zz'), null)
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

test('a contribution comes back from its own insert, and a repeat inserts nothing', async () => {
  const db = open()
  swarm(db, 'a')
  const input = { amount: '1000', channel: null, contributor: '0xAB' as const, id: '0xFEED', note: null, note_id: null, swarm: 'a', token: 'ousd' as const }
  const given = await Store.give(db.env, input)
  assert.deepEqual([given?.id, given?.contributor, given?.amount], ['0xfeed', '0xab', '1000'])
  assert.equal(await Store.give(db.env, input), null)
  const noted = await Store.annotate(db.env, '0xFEED', { note: 'a note', note_id: 'n' })
  assert.equal(noted?.note, 'a note')
  assert.equal(await Store.annotate(db.env, '0xFEED', { note: 'another', note_id: 'm' }), null)
  assert.equal((await Store.gift(db.env, '0xfeed'))?.note, 'a note')

  const inserted = await Store.insert(db.env, { creator: null, goal: 'A goal long enough', id: 'new', problem: null, sealed_wallet: 's', title: 'New', wallet: '0x99' })
  assert.deepEqual([inserted?.id, inserted?.raised, inserted?.contributors, inserted?.spent, inserted?.remaining, inserted?.status], ['new', 0, 0, 0, 0, 'funding'])
  assert.equal(Store.seen('new'), true)
})

test("a branch's money is only what was put behind its own agent's branch", async () => {
  const db = open()
  swarm(db, 'a')
  db.sqlite.prepare("insert into branches (swarm, agent, branch, base, created_at, settled_at) values ('a', 'agt_1', 1, '30000', 1, null), ('a', 'agt_0', 1, '90000', 1, 5)").run()
  db.sqlite.prepare("insert into steers (id, swarm, contributor, note, note_id, amount, created_at, branch, agent) values ('s1', 'a', '0x01', 'branch 1', 'branch:1', '100', 1, 1, 'agt_1'), ('s2', 'a', '0x02', 'branch 1', 'branch:1', '50', 1, 1, 'agt_0'), ('s3', 'a', '0x03', 'branch 1', 'branch:1', '70', 1, 1, null)").run()

  const money = (await Store.ledgers(db.env, 'a', false)).money('agt_1')
  assert.deepEqual([...(money.shares.get(1) ?? [])], [['0x01', 100n]])
  assert.deepEqual([...money.bases], [[1, 30000n]])
  assert.deepEqual([...money.settled], [])
  assert.match(planned(db, /from steers where swarm = \?1 and branch is not null/), /steers_branch/)
})

test('lagging finds swarms whose recent turns have no report, through the reports key', async () => {
  const db = open()
  swarm(db, 'gap', { rounds: 50, updated: 4 })
  for (let round = 1; round <= 50; round++) if (round !== 45) report(db, 'gap', round)
  swarm(db, 'working', { rounds: 51, status: 'running', updated: 3 })
  for (let round = 1; round <= 50; round++) report(db, 'working', round)
  swarm(db, 'between', { rounds: 50, status: 'running', updated: 2 })
  for (let round = 1; round <= 50; round++) report(db, 'between', round)
  swarm(db, 'old', { rounds: 100, updated: 1 })
  for (let round = 1; round <= 100; round++) if (round !== 5) report(db, 'old', round)
  swarm(db, 'young', { rounds: 3 })
  report(db, 'young', 1)

  assert.deepEqual(await Search.lagging(db.env), [{ after: 10, id: 'gap' }, { after: 0, id: 'young' }])
  assert.match(planned(db, /max\(rounds - \?1, 0\)/), /SEARCH r USING COVERING INDEX sqlite_autoindex_reports_1 \(swarm=\? AND round>\?\)/)
  assert.deepEqual(await Search.lagging(db.env, 'gap'), [{ after: 10, id: 'gap' }])
  assert.deepEqual(await Search.lagging(db.env, 'working'), [])
})

test('a sync writes only the missing reports after where it starts', async () => {
  const db = open()
  swarm(db, 'gap', { rounds: 50 })
  for (let round = 1; round <= 50; round++) if (round !== 45 && round !== 5) report(db, 'gap', round)
  const turns = Array.from({ length: 50 }, (_, index): Search.Turn => ({
    base: null,
    commits: [],
    endedAt: (index + 1) * 10 + 5,
    message: 'update ' + (index + 1),
    n: index + 1,
    spent: '0',
    startedAt: (index + 1) * 10,
    status: 'completed',
  }))
  await Search.sync(db.env, 'gap', turns, 10)
  const rounds = (db.sqlite.prepare("select round from reports where swarm = 'gap' and round in (5, 45) order by round").all() as { round: number }[]).map((row) => row.round)
  assert.deepEqual(rounds, [45])
  assert.match(planned(db, /from reports where swarm = \? and round > \?/), /\(swarm=\? AND round>\?\)/)
  assert.deepEqual(await Search.lagging(db.env, 'gap'), [])
})

test('search ranks by the stored weights and stops at the limit instead of sorting every match', async () => {
  const db = open()
  for (const id of ['a', 'b', 'c']) {
    swarm(db, id)
    give(db, id, '0x01', 100)
  }
  await Search.swarm(db.env, { goal: 'a parser for logs', id: 'a', title: 'Parser parser' })
  await Search.swarm(db.env, { goal: 'parser parser parser benchmarks for logs', id: 'b', title: 'Benchmarks' })
  await Search.swarm(db.env, { goal: 'nothing about it', id: 'c', title: 'Parser' })
  await Search.note(db.env, 'a', 'n1', 'try a faster parser')

  const hits = await Search.query(db.env, { kind: undefined, limit: 10, swarm: undefined, terms: ['parser'] })
  const weighed = (db.sqlite.prepare(`select swarm, kind from search where search match '"parser"' order by bm25(search, 0, 0, 0, 2, 1)`).all() as { kind: string; swarm: string }[]).map((row) => row.swarm + ':' + row.kind)
  assert.deepEqual(hits.map((hit) => hit.swarm.id + ':' + hit.kind), weighed)
  const plan = planned(db, /order by search\.rank/)
  assert.match(plan, /SCAN search VIRTUAL TABLE INDEX 32:/)
  assert.doesNotMatch(plan, /TEMP B-TREE/)
})
