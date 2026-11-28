import { readFileSync } from 'node:fs'
import type * as Search from '../../src/worker/Search.ts'
import type * as M1 from '../../src/worker/Search.ts'
import type * as Store from '../../src/worker/Store.ts'
import type * as M2 from '../../src/worker/Store.ts'
import type * as M3 from '../d1.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function store(seed: string): Promise<Outcome> {
  const random = rng('store', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const Search = await load<typeof M1>('src/worker/Search.ts')
  const Store = await load<typeof M2>('src/worker/Store.ts')
  const { open } = await load<typeof M3>('test/d1.ts')

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
    db.sqlite
      .prepare("insert into reports (swarm, round, status, message, started_at, ended_at, spent) values (?, ?, 'completed', 'update', ?, ?, '0')")
      .run(swarm, round, round * 10, round * 10 + 5)
  }

  function planned(db: Opened, pattern: RegExp) {
    const logged = db.log.findLast((entry) => pattern.test(entry.query))
    a.ok(logged, String(pattern))
    return db.plan(logged).join('\n')
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'the list and a swarm read their totals from the backing index, each contribution once',
      async (_t) => {
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
        a.deepEqual(
          listed.map((row) => [row.id, row.balance, row.contributors, row.spent, row.remaining]),
          [['a', 175, 2, 0, 175]],
        )
        a.deepEqual(
          (await Store.list(db.env, 'paused')).map((row) => row.id),
          [],
        )
        a.match(planned(db, /from swarms s left join/), /SCAN contributions USING COVERING INDEX contributions_backing/)

        const found = await Store.find(db.env, 'a')
        a.deepEqual([found?.balance, found?.contributors], [175, 2])
        a.match(planned(db, /where s\.id = \?/), /SEARCH contributions USING COVERING INDEX contributions_backing \(swarm=\?\)/)
        const empty = await Store.find(db.env, 'c')
        a.deepEqual([empty?.balance, empty?.contributors], [0, 0])
        a.equal(await Store.find(db.env, 'zz'), null)

        a.equal(await Store.steering(db.env, 'a'), 'open')
        a.equal(await Store.steering(db.env, 'zz'), null)
      },
    ],
    [
      'archived swarms stay out of the public active list and keep their direct links',
      async (_t) => {
        const db = open()
        swarm(db, 'active')
        swarm(db, 'closed')
        give(db, 'active', '0x01', 100)
        give(db, 'closed', '0x02', 100)
        a.equal(await Store.archive(db.env, 'closed', 42), 42)
        a.deepEqual(
          (await Store.list(db.env)).map((row) => row.id),
          ['active'],
        )
        a.deepEqual(
          (await Store.list(db.env, 'paused')).map((row) => row.id),
          ['active'],
        )
        a.deepEqual(
          (await Store.list(db.env, 'archived')).map((row) => row.id),
          ['closed'],
        )
        a.equal((await Store.find(db.env, 'closed'))?.archived_at, 42)
      },
    ],
    [
      "the listing counts each rider once and names each swarm's top three riders by what they put in",
      async (_t) => {
        const db = open()
        swarm(db, 'a')
        swarm(db, 'b')
        swarm(db, 'h', { hidden: 1 })
        give(db, 'a', '0x0A', 10)
        give(db, 'a', '0x0a', 30)
        give(db, 'a', '0x0b', 25)
        give(db, 'a', '0x0c', 5)
        give(db, 'a', '0x0d', 1)
        give(db, 'b', '0x0b', 2)
        give(db, 'h', '0x0e', 100)
        db.sqlite.prepare('insert into names (address, name, updated_at) values (?, ?, 1)').run('0x0b', 'mira')

        const riding = await Store.riding(db.env)
        a.equal(riding.riders, 4)
        a.deepEqual(
          riding.funders['a']?.map((funder) => [funder.who.address, funder.who.handle, funder.amount]),
          [
            ['0x0a', '0x0a…0x0a', '0.000040'],
            ['0x0b', 'mira', '0.000025'],
            ['0x0c', '0x0c…0x0c', '0.000005'],
          ],
        )
        a.deepEqual(
          riding.funders['b']?.map((funder) => funder.who.handle),
          ['mira'],
        )
        a.equal(riding.funders['h'], undefined)
      },
    ],
    [
      'what is left is the balance less what was spent, once 0030 counts what the old wallets and channels used as spent',
      async (_t) => {
        const db = open()
        const cutover = 1794273600000
        const gift = (swarm: string, id: string, amount: number, at: number, channel: string | null = null) =>
          db.sqlite
            .prepare("insert into contributions (id, swarm, contributor, token, amount, channel, created_at) values (?, ?, '0x01', 'mach', ?, ?, ?)")
            .run(id, swarm, String(amount), channel, at)
        const money = (swarm: string, fields: Record<string, number>) =>
          db.sqlite
            .prepare(
              `update swarms set ${Object.keys(fields)
                .map((name) => name + ' = ?')
                .join(', ')} where id = ?`,
            )
            .run(...Object.values(fields), swarm)
        const totals = async (id: string) => {
          const row = await Store.find(db.env, id)
          return [row?.balance, row?.spent, row?.remaining]
        }

        swarm(db, 'channels')
        gift('channels', '0xc1', 84_685_281, cutover - 1, '0xk1')
        money('channels', { sponsor_spent: 84_685_281 })
        swarm(db, 'wallet')
        gift('wallet', '0xw1', 3_200_000, cutover - 1)
        money('wallet', { spent_before: 2_571_806 })
        swarm(db, 'mixed')
        gift('mixed', '0xm1', 50_813, cutover - 1, '0xk2')
        gift('mixed', '0xm2', 1_600, cutover - 1)
        gift('mixed', '0xm3', 60_000, cutover + 1)
        money('mixed', { pool_left: 30_980, pool_spent: 29_020, sponsor_spent: 50_813 })
        swarm(db, 'backed')
        gift('backed', 'backing:0xb1', 27_000_000, cutover + 1, '0xb1')
        money('backed', { sponsor_left: 9_762_555, sponsor_spent: 17_237_445 })
        swarm(db, 'lagging')
        gift('lagging', '0xl1', 1_000_000, cutover - 1)
        gift('lagging', '0xl2', 5_000_000, cutover + 1)
        money('lagging', { spent_before: 1_000_000 })

        a.deepEqual(await totals('wallet'), [3_200_000, 2_571_806, 628_194])
        db.sqlite.exec(readFileSync('migrations/0030_balance.sql', 'utf8'))

        a.deepEqual(await totals('channels'), [84_685_281, 84_685_281, 0])
        await Store.update(db.env, 'channels', { sponsor_spent: 0 })
        a.deepEqual(await totals('channels'), [84_685_281, 84_685_281, 0])
        a.deepEqual(await totals('wallet'), [3_200_000, 3_200_000, 0])
        a.deepEqual(await totals('mixed'), [112_413, 81_433, 30_980])
        a.deepEqual(await totals('backed'), [27_000_000, 17_237_445, 9_762_555])
        a.deepEqual(await totals('lagging'), [6_000_000, 1_000_000, 5_000_000])
        a.deepEqual((await Store.list(db.env)).map((row) => [row.id, row.remaining]).sort(), [
          ['backed', 9_762_555],
          ['channels', 0],
          ['lagging', 5_000_000],
          ['mixed', 30_980],
          ['wallet', 0],
        ])
      },
    ],
    [
      'a steer spends only backing not yet behind a note, looked up by its author',
      async (_t) => {
        const db = open()
        swarm(db, 'a')
        give(db, 'a', '0x01', 100)
        give(db, 'a', '0x01', 30, 'behind a note')
        give(db, 'a', '0x02', 500)
        const steer = (id: string, amount: bigint) => Store.steer(db.env, { amount, contributor: '0x01', id, note: 'go faster', note_id: 'n1', swarm: 'a' })

        a.equal(await steer('s1', 60n), true)
        a.match(planned(db, /insert into steers/), /SEARCH contributions USING COVERING INDEX contributions_backing \(swarm=\? AND contributor=\?\)/)
        a.equal(await steer('s2', 41n), false)
        a.equal(await steer('s3', 40n), true)
        const [member] = (await Store.members(db.env, 'a')).filter((found) => found.address === '0x01')
        a.deepEqual([member?.backed, member?.steered, member?.available], ['0.000130', '0.000130', '0.000000'])
      },
    ],
    [
      'a contribution comes back from its own insert, and a repeat inserts nothing',
      async (_t) => {
        const db = open()
        swarm(db, 'a')
        const input = {
          amount: '1000',
          channel: null,
          contributor: '0xAB' as const,
          id: '0xFEED',
          note: null,
          note_id: null,
          swarm: 'a',
          token: 'ousd' as const,
        }
        const given = await Store.give(db.env, input)
        a.deepEqual([given?.id, given?.contributor, given?.amount], ['0xfeed', '0xab', '1000'])
        a.equal(await Store.give(db.env, input), null)
        const noted = await Store.annotate(db.env, 'a', '0xFEED', { note: 'a note', note_id: 'n' })
        a.equal(noted?.note, 'a note')
        a.equal(await Store.annotate(db.env, 'a', '0xFEED', { note: 'another', note_id: 'm' }), null)
        a.equal((await Store.gift(db.env, '0xfeed'))?.note, 'a note')

        const inserted = await Store.insert(db.env, {
          creator: null,
          goal: 'A goal long enough',
          id: 'new',
          problem: null,
          steering: 'team',
          title: 'New',
        })
        a.deepEqual(
          [inserted?.id, inserted?.balance, inserted?.contributors, inserted?.spent, inserted?.remaining, inserted?.status, inserted?.steering],
          ['new', 0, 0, 0, 0, 'funding', 'team'],
        )
        a.equal(Store.seen('new'), true)
      },
    ],
    [
      "a branch's money is only what was put behind its own agent's branch",
      async (_t) => {
        const db = open()
        swarm(db, 'a')
        db.sqlite
          .prepare(
            "insert into branches (swarm, agent, branch, base, created_at, settled_at) values ('a', 'agt_1', 1, '30000', 1, null), ('a', 'agt_0', 1, '90000', 1, 5)",
          )
          .run()
        db.sqlite
          .prepare(
            "insert into steers (id, swarm, contributor, note, note_id, amount, created_at, branch, agent) values ('s1', 'a', '0x01', 'branch 1', 'branch:1', '100', 1, 1, 'agt_1'), ('s2', 'a', '0x02', 'branch 1', 'branch:1', '50', 1, 1, 'agt_0'), ('s3', 'a', '0x03', 'branch 1', 'branch:1', '70', 1, 1, null)",
          )
          .run()

        const money = (await Store.ledgers(db.env, 'a', false)).money('agt_1')
        a.deepEqual([...(money.shares.get(1) ?? [])], [['0x01', 100n]])
        a.deepEqual([...money.bases], [[1, 30000n]])
        a.deepEqual([...money.settled], [])
        a.match(planned(db, /from steers where swarm = \?1 and branch is not null/), /steers_branch/)
      },
    ],
    [
      'lagging finds swarms whose recent turns have no report, through the reports key',
      async (_t) => {
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

        a.deepEqual(await Search.lagging(db.env), [
          { after: 10, id: 'gap' },
          { after: 0, id: 'young' },
        ])
        a.match(planned(db, /max\(rounds - \?1, 0\)/), /SEARCH r USING COVERING INDEX sqlite_autoindex_reports_1 \(swarm=\? AND round>\?\)/)
        a.deepEqual(await Search.lagging(db.env, 'gap'), [{ after: 10, id: 'gap' }])
        a.deepEqual(await Search.lagging(db.env, 'working'), [])
      },
    ],
    [
      'a sync writes only the missing reports after where it starts',
      async (_t) => {
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
        const rounds = (
          db.sqlite.prepare("select round from reports where swarm = 'gap' and round in (5, 45) order by round").all() as { round: number }[]
        ).map((row) => row.round)
        a.deepEqual(rounds, [45])
        a.match(planned(db, /from reports where swarm = \? and round > \?/), /\(swarm=\? AND round>\?\)/)
        a.deepEqual(await Search.lagging(db.env, 'gap'), [])
      },
    ],
    [
      'search ranks by the stored weights and stops at the limit instead of sorting every match',
      async (_t) => {
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
        const weighed = (
          db.sqlite.prepare(`select swarm, kind from search where search match '"parser"' order by bm25(search, 0, 0, 0, 2, 1)`).all() as {
            kind: string
            swarm: string
          }[]
        ).map((row) => row.swarm + ':' + row.kind)
        a.deepEqual(
          hits.map((hit) => hit.swarm.id + ':' + hit.kind),
          weighed,
        )
        const plan = planned(db, /order by search\.rank/)
        a.match(plan, /SCAN search VIRTUAL TABLE INDEX 32:/)
        a.doesNotMatch(plan, /TEMP B-TREE/)
      },
    ],
  ]
  for (const [dstName, dstRun] of [...dstCases].sort(() => random.next() - 0.5)) {
    a.as(dstName)
    try {
      await dstRun({ after: (fn) => void afters.push(fn) })
    } catch (error) {
      fail(dstName, String((error as Error)?.stack ?? error).slice(0, 400))
    } finally {
      for (const fn of afters.splice(0).reverse()) await fn()
    }
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { store }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'store.store',
      'src/worker/Store.ts',
      "const filter = status === 'archived' ? ' and s.archived_at is not null' : status ? ' and s.status = ? and s.archived_at is null' : ' and s.archived_at is null'",
      "const filter = status !== 'archived' ? ' and s.archived_at is not null' : status ? ' and s.status = ? and s.archived_at is null' : ' and s.archived_at is null'",
    ),
    invariant: 'what is left is the balance less what was spent, once 0030 counts what the old wallets and channels used as spent',
    name: 'store.store',
    scenario: 'store',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'store.active-archive-filter',
      'src/worker/Store.ts',
      "const filter = status === 'archived' ? ' and s.archived_at is not null' : status ? ' and s.status = ? and s.archived_at is null' : ' and s.archived_at is null'",
      "const filter = status === 'archived' ? ' and s.archived_at is not null' : status ? ' and s.status = ? and s.archived_at is null' : ''",
    ),
    invariant: 'archived swarms stay out of the public active list and keep their direct links',
    name: 'store.active-archive-filter',
    scenario: 'store',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'store.search',
      'src/worker/Search.ts',
      'const ended = turns.filter((turn) => turn.endedAt !== null && turn.n > after)',
      'const ended = turns.filter((turn) => turn.endedAt === null && turn.n > after)',
    ),
    invariant: 'a sync writes only the missing reports after where it starts',
    name: 'store.search',
    scenario: 'store',
    seeds: ['1', '2', '3'],
  },
]
