import type { Roster } from '../../src/shared/Api.ts'
import type * as CreditModule from '../../src/shared/Credit.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as StoreModule from '../../src/worker/Store.ts'
import type * as TeamModule from '../../src/worker/Team.ts'
import type * as D1Module from '../d1.ts'
import type * as RunModule from '../run.ts'
import { applied, load, mutant, pin, recorder, rng, type Canary, type Outcome, type Rng } from './mh-kit.ts'

export const limits = {
  budget: { least: 3, most: 20 },
  extras: { least: 0, most: 3 },
  leavers: { least: 2, most: 3 },
  racers: { least: 2, most: 4 },
  rides: { least: 1, most: 9 },
  steerMost: 100,
  ticks: 20,
  titles: { least: 4, most: 8 },
  unit: 1_000_000,
}

type Address = `0x${string}`

type Mate = { limit: number | null; role: 'admin' | 'member' }

type Team = { budget: number | null; members: Map<string, Mate> }

type Kit = { Credit: typeof CreditModule; D1: typeof D1Module; Operations: typeof OperationsModule; Store: typeof StoreModule; Team: typeof TeamModule }

type Checks = ReturnType<typeof recorder>

class Stop extends Error {}

type Result<T> = { ok: true; value: T } | { detail: string; ok: false; status: number }

function address(random: Rng) {
  return ('0x' + Array.from({ length: 40 }, () => random.int(0, 15).toString(16)).join('')) as Address
}

function units(dollars: number) {
  return String(dollars * limits.unit)
}

function decimal(dollars: number) {
  return dollars + '.000000'
}

function world(kit: Kit, operator: string, swarm: string, options: { creator: Address | null; steering?: 'open' | 'team' }) {
  const db = kit.D1.open()
  const teams = new Map<string, Team>()
  const calls: string[] = []
  const down = new Set<string>()
  const told: Roster[] = []
  const deposits = new Map<string, unknown[]>()
  let made = 0
  const gateway = async (request: Request) => {
    const path = new URL(request.url).pathname
    calls.push(path)
    if (down.has(path)) return Response.json({ detail: 'down' }, { status: 503 })
    if (path === '/api/keys/me') return Response.json({ wallet: operator })
    if (path === '/api/keys/backings') return Response.json({ backings: [], left: '5', spent: '0' })
    const body = (await request.json()) as {
      budget?: number | null
      hash?: string
      member?: string
      memberBudget?: number | null
      role?: Mate['role']
      team?: string
    }
    if (path === '/api/keys/credit')
      return Response.json({ created: true, credit: { deposited: '0', left: '0', spent: '0' }, deposits: deposits.get(String(body.hash)) ?? [] })
    if (path === '/v1/teams/create') {
      const address = '0x' + String(++made).padStart(40, '0')
      teams.set(address, { budget: null, members: new Map([[operator, { limit: null, role: 'admin' }]]) })
      return Response.json({ address })
    }
    const team = teams.get(String(body.team).toLowerCase())
    if (!team) return Response.json({ detail: 'No such team.' }, { status: 404 })
    const member = String(body.member).toLowerCase()
    if (path === '/v1/teams/members')
      return Response.json({
        memberBudget: team.budget,
        members: [...team.members].map(([one, mate]) => ({ budget: mate.limit, limit: mate.limit ?? team.budget, member: one, role: mate.role })),
      })
    if (path === '/v1/teams/add') {
      if (team.members.has(member)) return Response.json({ detail: 'Already on the team.' }, { status: 409 })
      team.members.set(member, { limit: body.budget ?? null, role: body.role ?? 'member' })
      return Response.json({})
    }
    if (path === '/v1/teams/remove') return Response.json({ removed: team.members.delete(member) })
    if (path === '/v1/teams/delete') return Response.json({ deleted: teams.delete(String(body.team).toLowerCase()) })
    if (path === '/v1/teams/update') {
      team.budget = body.memberBudget ?? null
      return Response.json({})
    }
    return Response.json({ detail: 'No such route.' }, { status: 404 })
  }
  const room = {
    contributed: async () => undefined,
    paced: async () => true,
    rostered: async (roster: Roster) => void told.push(roster),
    say: async (input: { author: string; text: string }) => ({ author: input.author, text: input.text }),
  }
  const env = {
    ...db.env,
    GATEWAY: { fetch: gateway },
    GATEWAY_URL: 'https://gateway.test',
    SWARMS: { get: () => room, idFromName: (name: string) => name },
    SWARMS_GATEWAY_KEY: 'test',
    SWARMS_URL: 'https://swarms.test',
  } as unknown as Cloudflare.Env
  db.sqlite
    .prepare(
      "insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at, steering, creator) values (?, 'Title', 'Goal', 'running', 0, 0, 1, 1, ?, ?)",
    )
    .run(swarm, options.steering ?? 'team', options.creator)
  kit.Team.forget(swarm)
  const seated = (team: string) =>
    [...(teams.get(team)?.members ?? [])]
      .filter(([one]) => one !== operator)
      .map(([one, mate]) => one + ':' + mate.role)
      .toSorted()
  const name = (one: string, called: string) => db.sqlite.prepare('insert into names (address, name, updated_at) values (?, ?, 1)').run(one, called)
  const give = (id: string, from: string, dollars: number) =>
    db.sqlite
      .prepare("insert into contributions (id, swarm, contributor, token, amount, note, note_id, created_at) values (?, ?, ?, 'ousd', ?, null, null, 1)")
      .run(id, swarm, from, units(dollars))
  const settled = async () => {
    for (let i = 0; i < limits.ticks; i++) await new Promise((done) => setImmediate(done))
    return told
  }
  const creates = () => calls.filter((path) => path === '/v1/teams/create').length
  return { calls, creates, db, deposits, down, env, give, name, room, seated, settled, teams, told }
}

function expect(checks: Checks) {
  const value = async <T>(invariant: string, what: string, result: Promise<Result<T>>) => {
    const settled = await result
    if (settled.ok) return settled.value
    checks.fail(invariant, what + ' failed: ' + settled.status + ' ' + settled.detail)
    throw new Stop()
  }
  const status = async (invariant: string, what: string, result: Promise<{ ok: boolean; status?: number }>, want: number) => {
    const settled = await result
    checks.same(invariant, what, settled.ok ? 200 : settled.status, want)
  }
  return { status, value }
}

async function team(seed: string): Promise<Outcome> {
  const random = rng(seed, 'world-team')
  const checks = recorder()
  const { fail, same, violations } = checks
  const unpin = pin(random)
  let steps = 0
  try {
    await load<typeof RunModule>('test/run.ts')
    const kit: Kit = {
      Credit: await load<typeof CreditModule>('src/shared/Credit.ts'),
      D1: await load<typeof D1Module>('test/d1.ts'),
      Operations: await load<typeof OperationsModule>('src/worker/Operations.ts'),
      Store: await load<typeof StoreModule>('src/worker/Store.ts'),
      Team: await load<typeof TeamModule>('src/worker/Team.ts'),
    }
    applied()
    const { Credit, Operations, Store, Team } = kit
    const { status, value } = expect(checks)
    const operator = address(random)
    const [ada, bob, cyd] = [address(random), address(random), address(random)] as [Address, Address, Address]
    const label = (one: string) => (one === ada ? 'ada' : one === bob ? 'bob' : one === cyd ? 'cyd' : one)
    const fixtures: [string, string, (swarm: string) => Promise<void>][] = [
      [
        'wallet',
        'operator never seated',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          const team = '0x' + '7e'.repeat(20)
          const extras = Array.from({ length: random.int(limits.extras.least, limits.extras.most) }, () => address(random))
          w.down.add('/api/keys/me')
          await status('wallet first', 'seating while the gateway hides its wallet', Operations.seat(w.env, { member: bob, swarm }, ada), 502)
          if (w.creates()) fail('wallet first', 'a team was created before the gateway named its wallet')
          w.teams.set(team, {
            budget: null,
            members: new Map<string, Mate>([
              [operator, { limit: null, role: 'admin' }],
              [ada, { limit: null, role: 'admin' }],
              [bob, { limit: null, role: 'member' }],
              ...extras.map((one): [string, Mate] => [one, { limit: null, role: 'member' }]),
            ]),
          })
          w.db.sqlite.prepare('update swarms set team = ? where id = ?').run(team, swarm)
          Team.forget(swarm)
          await status('wallet first', 'reading the roster while the gateway hides its wallet', Operations.team(w.env, { swarm }), 502)
          w.down.clear()
          same(
            'operator never seated',
            'seats',
            (await value('operator never seated', 'reading the roster', Operations.team(w.env, { swarm }))).seats.map((seat) => seat.address),
            [ada, bob, ...extras],
          )
          w.calls.length = 0
          for (const [what, call, want] of random.shuffle([
            ['unseating the operator', () => Operations.unseat(w.env, { member: operator, swarm }, ada), 404],
            ['seating the operator', () => Operations.seat(w.env, { member: operator, swarm }, ada), 400],
            ['unseating someone not on the team', () => Operations.unseat(w.env, { member: cyd, swarm }, ada), 404],
          ] as const))
            await status('operator never seated', what, call(), want)
          if (w.calls.includes('/v1/teams/remove') || w.calls.includes('/v1/teams/add'))
            fail('operator never seated', 'a refused seat change reached the gateway')
          if (!w.teams.get(team)?.members.has(operator)) fail('operator never seated', 'the operator left the gateway team')
          same('operator never seated', 'gateway team', w.seated(team), [ada + ':admin', bob + ':member', ...extras.map((one) => one + ':member')].toSorted())
        },
      ],
      [
        'stale',
        'removed admin refused',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          w.name(bob, 'bob')
          const roster = await value('removed admin refused', 'seating bob as admin', Operations.seat(w.env, { member: bob, role: 'admin', swarm }, ada))
          const team = roster.team as string
          same('removed admin refused', 'admins', roster.admins, [ada, bob])
          same('removed admin refused', 'cached admins', Team.cached(swarm)?.admins, [ada, bob])
          w.teams.get(team)?.members.delete(bob)
          const steer = String(random.int(1, limits.rides.most))
          for (const [what, call] of random.shuffle([
            ['unseat ada', () => Operations.unseat(w.env, { member: ada, swarm }, bob)],
            ['seat bob', () => Operations.seat(w.env, { member: bob, role: 'admin', swarm }, bob)],
            ['steer open', () => Operations.steer(w.env, { steering: 'open', swarm }, bob)],
            ['say', () => Operations.say(w.env, { steer, swarm, text: '@swarm try lattices' }, bob)],
          ] as const))
            await status('removed admin refused', 'a removed admin trying to ' + what, call() as Promise<{ ok: boolean; status?: number }>, 403)
          same('removed admin refused', 'steers', w.db.sqlite.prepare('select count(*) as steers from steers').get()?.['steers'], 0)
          same('removed admin refused', 'gateway team', w.seated(team), [ada + ':admin'])
          await status('last admin stays', 'the last admin leaving', Operations.unseat(w.env, { member: ada, swarm }, ada), 409)
        },
      ],
      [
        'leave',
        'creator leads',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          const others = [bob, ...Array.from({ length: random.int(limits.leavers.least, limits.leavers.most) - 2 }, () => address(random))]
          let team = ''
          for (const one of others)
            team = (await value('creator leads', 'seating an admin', Operations.seat(w.env, { member: one, role: 'admin', swarm }, ada))).team as string
          await Promise.all(random.shuffle([ada, ...others]).map((one) => Operations.unseat(w.env, { member: one, swarm }, one)))
          same('creator leads', 'gateway team after every admin left', w.seated(team), [])
          Team.forget(swarm)
          const left = await value('creator leads', 'reading the roster', Operations.team(w.env, { swarm }))
          same('creator leads', 'admins', left.admins, [ada])
          same(
            'creator leads',
            'seats',
            left.seats.map((seat) => [seat.address, seat.role]),
            [[ada, 'admin']],
          )
          await value('creator leads', 'seating cyd', Operations.seat(w.env, { member: cyd, swarm }, ada))
          same('creator leads', 'gateway team', w.seated(team), [ada + ':admin', cyd + ':member'].toSorted())
        },
      ],
      [
        'adrift',
        'creator leads',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          const team = (await value('creator leads', 'seating bob as admin', Operations.seat(w.env, { member: bob, role: 'admin', swarm }, ada))).team as string
          w.teams.get(team)?.members.delete(ada)
          w.teams.get(team)?.members.delete(bob)
          const row = await Store.find(w.env, swarm)
          if (!row) return fail('creator leads', 'the swarm is gone')
          const adrift = await Team.roster(w.env, row)
          same('creator leads', 'admins of a team with none', adrift.admins, [ada])
          same(
            'creator leads',
            'seats of a team with none',
            adrift.seats.map((seat) => [seat.address, seat.role, seat.limit]),
            [[ada, 'admin', null]],
          )
          await status('creator leads', 'bob seating cyd', Operations.seat(w.env, { member: cyd, swarm }, bob), 403)
          await status('last admin stays', 'the creator leaving', Operations.unseat(w.env, { member: ada, swarm }, ada), 409)
          const mended = await value('leader seated', 'the creator seating cyd', Operations.seat(w.env, { member: cyd, swarm }, ada))
          same('leader seated', 'admins once mended', mended.admins, [ada])
          same('leader seated', 'gateway team once mended', w.seated(team), [ada + ':admin', cyd + ':member'].toSorted())
        },
      ],
      [
        'biggest',
        'biggest rider leads',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: null })
          const small = random.int(limits.rides.least, limits.rides.most - 1)
          const big = random.int(small + 1, limits.rides.most)
          const budget = random.int(limits.budget.least, limits.budget.most)
          w.give('g1', bob, big)
          w.give('g2', cyd, small)
          const team = (await value('biggest rider leads', 'bob seating cyd', Operations.seat(w.env, { budget, member: cyd, swarm }, bob))).team as string
          w.teams.get(team)?.members.delete(bob)
          const row = await Store.find(w.env, swarm)
          if (!row) return fail('biggest rider leads', 'the swarm is gone')
          same('biggest rider leads', 'admins', (await Team.roster(w.env, row)).admins, [bob])
          w.db.sqlite.prepare("update contributions set amount = ? where id = 'g2'").run(units(big + random.int(1, limits.rides.most)))
          const led = await Team.roster(w.env, row)
          same('biggest rider leads', 'admins once cyd sent more', led.admins, [cyd])
          same(
            'biggest rider leads',
            'seats once cyd sent more',
            led.seats.map((seat) => [seat.address, seat.role, seat.limit]),
            [[cyd, 'admin', decimal(budget)]],
          )
          await value('leader seated', 'cyd seating bob', Operations.seat(w.env, { member: bob, swarm }, cyd))
          same('leader seated', 'gateway team', w.seated(team), [bob + ':member', cyd + ':admin'].toSorted())
        },
      ],
      [
        'race',
        'one team',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          const members = [bob, cyd, ...Array.from({ length: random.int(limits.racers.least, limits.racers.most) - 2 }, () => address(random))]
          const seated = await Promise.all(random.shuffle(members).map((one) => Operations.seat(w.env, { member: one, swarm }, ada)))
          const refused = seated.filter((one) => !one.ok)
          if (refused.length) fail('one team', refused.length + ' of ' + members.length + ' first seats at once failed')
          same('one team', 'teams created', w.creates(), members.length)
          const team = (await Store.find(w.env, swarm))?.team as string
          same('one team', 'gateway teams', [...w.teams.keys()], [team])
          same('one team', 'gateway team', w.seated(team), [ada + ':admin', ...members.map((one) => one + ':member')].toSorted())
        },
      ],
      [
        'kept',
        'team kept',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          w.down.add('/v1/teams/add')
          await status('team kept', 'seating while the gateway adds no one', Operations.seat(w.env, { member: bob, swarm }, ada), 502)
          const team = (await Store.find(w.env, swarm))?.team
          if (!team) return fail('team kept', 'the team made before the failed add was dropped')
          w.down.clear()
          const roster = await value('team kept', 'seating again', Operations.seat(w.env, { member: bob, swarm }, ada))
          same('team kept', 'team', roster.team, team)
          same('team kept', 'teams created', w.creates(), 1)
          same('team kept', 'gateway team', w.seated(team), [ada + ':admin', bob + ':member'].toSorted())
        },
      ],
      [
        'unlisted',
        'unlisted is 502',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          w.name(bob, 'bob')
          await value('unlisted is 502', 'seating bob', Operations.seat(w.env, { member: bob, swarm }, ada))
          const hash = '0x' + '11'.repeat(32)
          const dollars = random.int(limits.rides.least, limits.rides.most)
          w.deposits.set(hash, [{ amount: String(dollars), from: bob, log: 0, tag: Credit.tag(swarm, 'try lattices'), token: 'ousd' }])
          const counted = () =>
            w.db.sqlite
              .prepare('select id, note from contributions order by created_at, id')
              .all()
              .map((row) => ({ ...row }))
          w.down.add('/v1/teams/members')
          for (const [what, call] of random.shuffle([
            ['steering', () => Operations.say(w.env, { steer: '1', swarm, text: '@swarm try codes' }, bob)],
            ['asking', () => Operations.btw(w.env, { question: 'Why lattices?', swarm }, bob)],
            ['funding', () => Operations.fund(w.env, { amount: '1', branch: 1, swarm }, bob)],
            ['opening', () => Operations.steer(w.env, { steering: 'open', swarm }, ada)],
            ['contributing', () => Operations.contribute(w.env, { hash, note: 'try lattices', swarm })],
          ] as const))
            await status('unlisted is 502', what + ' while the team is unlisted', call() as Promise<{ ok: boolean; status?: number }>, 502)
          same('unlisted is 502', 'contributions while unlisted', counted(), [])
          w.down.clear()
          const given = await value('unlisted is 502', 'contributing once listed', Operations.contribute(w.env, { hash, note: 'try lattices', swarm }))
          same('unlisted is 502', 'note', given.contributed.contribution.note, 'try lattices')
          same(
            'unlisted is 502',
            'notes',
            counted().map((row) => row['note']),
            ['try lattices'],
          )
        },
      ],
      [
        'stop',
        'unlisted is 502',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          w.name(ada, 'ada')
          w.name(bob, 'bob')
          await value('unlisted is 502', 'seating bob', Operations.seat(w.env, { member: bob, swarm }, ada))
          const branch = { agent_id: 1, budget_usd: 5, parent_agent_id: null, role: 'tester', spent_usd: 1, status: { state: 'running' }, task: 'Test it' }
          const halts: unknown[] = []
          Object.assign(w.room, {
            halt: async (...args: unknown[]) => (halts.push(args), { ok: true, value: [{ ...branch, status: { state: 'closed' } }] }),
            settle: (input: Parameters<typeof Store.settle>[1]) => Store.settle(w.env, input),
            subagents: async () => ({ ok: true, value: { agent: 'agt', list: [branch] } }),
            voice: async () => ({ ok: true, value: null }),
          })
          w.down.add('/v1/teams/members')
          await status('unlisted is 502', 'an admin stopping a branch while unlisted', Operations.stop(w.env, { branch: 1, swarm }, ada), 502)
          same('unlisted is 502', 'halts while unlisted', halts.length, 0)
          w.down.clear()
          await status('unlisted is 502', 'a member stopping a branch', Operations.stop(w.env, { branch: 1, swarm }, bob), 403)
          same(
            'unlisted is 502',
            'stopped',
            (await value('unlisted is 502', 'an admin stopping a branch', Operations.stop(w.env, { branch: 1, swarm }, ada))).id,
            1,
          )
          same('unlisted is 502', 'halts', halts.length, 1)
        },
      ],
      [
        'told',
        'roster left',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          w.name(bob, 'bob')
          const budget = random.int(limits.budget.least, limits.budget.most)
          const steer = random.int(1, budget - 1)
          await value('roster left', 'seating bob', Operations.seat(w.env, { budget, member: bob, swarm }, ada))
          await w.settled()
          w.told.length = 0
          await value('roster left', 'bob steering', Operations.say(w.env, { steer: String(steer), swarm, text: '@swarm try lattices' }, bob))
          same(
            'roster left',
            'left told to the room',
            (await w.settled()).map((roster) => roster.seats.find((seat) => seat.address === bob)?.left),
            [decimal(budget - steer)],
          )
        },
      ],
      [
        'richer',
        'room told leader',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: null, steering: 'open' })
          const small = random.int(limits.rides.least, limits.rides.most - 1)
          const hashes = ['0x' + '44'.repeat(32), '0x' + '55'.repeat(32)] as const
          w.deposits.set(hashes[0], [{ amount: String(small), from: bob, log: 0, tag: Credit.tag(swarm), token: 'ousd' }])
          w.deposits.set(hashes[1], [{ amount: String(random.int(small + 1, limits.rides.most)), from: cyd, log: 0, tag: Credit.tag(swarm), token: 'ousd' }])
          await value('room told leader', 'bob riding', Operations.contribute(w.env, { hash: hashes[0], swarm }))
          await value('room told leader', 'cyd riding', Operations.contribute(w.env, { hash: hashes[1], swarm }))
          same(
            'room told leader',
            'admins told',
            (await w.settled()).map((roster) => roster.admins),
            [[bob], [cyd]],
          )
        },
      ],
      [
        'first',
        'first ride owns',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: null })
          const small = random.int(limits.rides.least, limits.rides.most - 1)
          const hashes = ['0x' + '66'.repeat(32), '0x' + '77'.repeat(32)] as const
          w.deposits.set(hashes[0], [{ amount: String(small), from: bob, log: 0, tag: Credit.tag(swarm), token: 'ousd' }])
          w.deposits.set(hashes[1], [{ amount: String(random.int(small + 1, limits.rides.most)), from: cyd, log: 0, tag: Credit.tag(swarm), token: 'ousd' }])
          await value('first ride owns', 'bob riding', Operations.contribute(w.env, { hash: hashes[0], swarm }))
          await value('first ride owns', 'cyd riding', Operations.contribute(w.env, { hash: hashes[1], swarm }))
          same(
            'first ride owns',
            'admins told',
            (await w.settled()).map((roster) => roster.admins),
            [[bob]],
          )
          same('first ride owns', 'creator', w.db.sqlite.prepare('select creator from swarms where id = ?').get(swarm)?.['creator'], bob)
        },
      ],
      [
        'balance',
        'admin budget',
        async (swarm) => {
          const w = world(kit, operator, swarm, { creator: ada })
          w.name(ada, 'ada')
          const balance = random.int(limits.budget.least, limits.budget.most)
          const over = random.int(balance + 1, limits.steerMost)
          w.db.sqlite
            .prepare("insert into contributions (id, swarm, contributor, token, amount, created_at) values ('0xfeed', ?, ?, 'ousd', ?, 1)")
            .run(swarm, cyd, units(balance))
          same(
            'roster left',
            'seats',
            (await value('roster left', 'reading the roster', Operations.team(w.env, { swarm }))).seats.map((seat) => [seat.address, seat.limit, seat.left]),
            [[ada, null, decimal(balance)]],
          )
          const refused = await Operations.say(w.env, { steer: String(over), swarm, text: '@swarm try lattices' }, ada)
          same(
            'admin budget',
            'steering more than the balance',
            [refused.ok, refused.ok ? null : refused.detail],
            [false, 'Your team budget has $' + balance + ' left in these 30 days, less than $' + over + '.'],
          )
          const steer = random.int(1, balance)
          await value('admin budget', 'steering within the balance', Operations.say(w.env, { steer: String(steer), swarm, text: '@swarm try lattices' }, ada))
          same(
            'admin budget',
            'allotted',
            [...(await Store.allotted(w.env, swarm, 0))].map(([one, amount]) => [one, String(amount)]),
            [[ada, units(steer)]],
          )
        },
      ],
    ]
    for (const [n, [name, invariant, run]] of fixtures.entries()) {
      steps++
      try {
        await run('s' + n)
      } catch (error) {
        if (!(error instanceof Stop)) fail(invariant, name + ' threw ' + String(error instanceof Error ? error.message : error).slice(0, 300))
      }
    }
    const allowed = /^[\p{L}\p{M}\p{N} ._&'-]+$/u
    const alphabet = ['a', 'Z', 'é', '7', ' ', '.', '=', '?', '/', '(', ')', ':', '&', "'", '-', '_', '!', '💸', 'ß', ',']
    const titles = [
      'Solve P = NP.',
      'Port zlib (C) to Rust: fast, safe?',
      'Qué es /esto/ & aquello',
      '  ',
      '???',
      'x'.repeat(80) + ': tail',
      ...Array.from({ length: random.int(limits.titles.least, limits.titles.most) }, () =>
        Array.from({ length: random.int(1, 90) }, () => random.pick(alphabet)).join(''),
      ),
    ]
    for (const title of titles) {
      steps++
      const name = Team.named({ id: 'abc123abc123', title })
      if (!(allowed.test(name) && name.length >= 1 && name.length <= 64 && name === name.trim()))
        fail('team name allowed', JSON.stringify(title) + ' named the team ' + JSON.stringify(name))
    }
    same('team name allowed', 'name of Solve P = NP.', Team.named({ id: 'abc123abc123', title: 'Solve P = NP.' }), 'Solve P NP.')
    same('team name allowed', 'name of ???', Team.named({ id: 'abc123abc123', title: '???' }), 'Swarm abc123abc123')
    if (violations.length) violations.forEach((one) => (one.detail = one.detail.replace(/0x[0-9a-f]{40}/g, label)))
    return { steps, violations }
  } finally {
    unpin()
  }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { world_team: team }

const all = ['1', '2', '3']

function canary(name: string, file: string, from: string, to: string, invariant: string): Canary {
  return { flip: mutant(name, file, from, to), invariant, name, scenario: 'world_team', seeds: all }
}

export const canaries: Canary[] = [
  canary(
    'world.team.wallet',
    'src/worker/Operations.ts',
    "if (!operator) return Problem.fail(Limits.Http.upstream, 'unavailable'",
    "if (!operator && false) return Problem.fail(Limits.Http.upstream, 'unavailable'",
    'wallet first',
  ),
  canary(
    'world.team.operator',
    'src/worker/Team.ts',
    '.filter((mate) => mate.member.toLowerCase() !== operator)',
    '.filter((mate) => mate.member.toLowerCase() !== operator || !!mate)',
    'operator never seated',
  ),
  canary(
    'world.team.stale',
    'src/worker/Team.ts',
    'return (await roster(env, row)).admins.includes(',
    'return (cached(row.id) ?? (await roster(env, row))).admins.includes(',
    'removed admin refused',
  ),
  canary(
    'world.team.last',
    'src/worker/Operations.ts',
    'if (roster.admins.length === 1 && roster.admins[0] === request.member)',
    'if (roster.admins.length === 0 && roster.admins[0] === request.member)',
    'last admin stays',
  ),
  canary('world.team.creator', 'src/worker/Team.ts', '? null : (row.creator ?? biggest(', '? null : (null ?? biggest(', 'creator leads'),
  canary(
    'world.team.led',
    'src/worker/Team.ts',
    'if (chair) await Gateway.dismiss(env, team, address)',
    'if (!chair) await Gateway.dismiss(env, team, address)',
    'leader seated',
  ),
  canary(
    'world.team.biggest',
    'src/worker/Team.ts',
    'Memo.units(member.backed) > Memo.units(top.backed) ? member : top',
    'Memo.units(member.backed) < Memo.units(top.backed) ? member : top',
    'biggest rider leads',
  ),
  canary(
    'world.team.richer',
    'src/worker/Team.ts',
    'Memo.units(member.backed) > Memo.units(top.backed) ? member : top',
    'Memo.units(member.backed) < Memo.units(top.backed) ? member : top',
    'room told leader',
  ),
  canary(
    'world.team.race',
    'src/worker/Team.ts',
    'if (held !== mine) await Gateway.disband(env, mine)',
    'if (held !== held) await Gateway.disband(env, mine)',
    'one team',
  ),
  canary(
    'world.team.kept',
    'src/worker/Team.ts',
    'const team = row.team ? Problem.ok(row.team) : await founded(env, row)',
    'const team = await founded(env, row)',
    'team kept',
  ),
  canary(
    'world.team.unlisted',
    'src/worker/Team.ts',
    "return Problem.fail(Limits.Http.upstream, 'upstream_failed', error instanceof Error",
    "return Problem.fail(Limits.Http.forbidden, 'access_denied', error instanceof Error",
    'unlisted is 502',
  ),
  canary('world.team.left', 'src/worker/Team.ts', 'left: Memo.decimal(most > spent ? most - spent : 0n),', 'left: Memo.decimal(most),', 'roster left'),
  canary(
    'world.team.balance',
    'src/worker/Team.ts',
    'const most = chair.limit ?? BigInt(row.balance)',
    'const most = chair.limit ?? BigInt(row.balance) * 2n',
    'admin budget',
  ),
  canary(
    'world.team.first',
    'src/worker/Operations.ts',
    "retold(env, row.steering === 'team' && !existing ?",
    "retold(env, row.steering === 'open' && !existing ?",
    'first ride owns',
  ),
  canary(
    'world.team.named',
    'src/worker/Team.ts',
    "row.title.replace(/[^\\p{L}\\p{M}\\p{N} ._&'-]+/gu, ' ')",
    "row.title.replace(/[^\\p{L}\\p{M}\\p{N} ._&'=-]+/gu, ' ')",
    'team name allowed',
  ),
]
