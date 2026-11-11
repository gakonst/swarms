import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type { Roster } from '../src/shared/Api.ts'
import * as Credit from '../src/shared/Credit.ts'
import * as Chain from '../src/worker/Chain.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import type * as StoreModule from '../src/worker/Store.ts'
import type * as TeamModule from '../src/worker/Team.ts'
import { open } from './d1.ts'

const waited: Promise<unknown>[] = []

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers'
      ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = (task) => globalThis.__teamWaited.push(task); export class DurableObject {}' }
      : next(specifier, context),
})
Object.assign(globalThis, { __teamWaited: waited })

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')
const Store: typeof StoreModule = await import('../src/worker/Store.ts')
const Team: typeof TeamModule = await import('../src/worker/Team.ts')

const operator = '0x' + '0f'.repeat(20)
const ada = ('0x' + 'a1'.repeat(20)) as `0x${string}`
const bob = ('0x' + 'b2'.repeat(20)) as `0x${string}`
const cyd = ('0x' + 'c3'.repeat(20)) as `0x${string}`

type Mate = { limit: number | null; role: 'admin' | 'member' }

function world(swarm: { creator?: string | null; steering?: 'open' | 'team' } = {}) {
  const db = open()
  const teams = new Map<string, { budget: number | null; members: Map<string, Mate> }>()
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
    if (path === '/api/keys/backings')
      return Response.json({ backings: [...approvals.values()].map((each) => ({ backer: (each as { wallet: string }).wallet, ended: false, key: (each as { accessKey: string }).accessKey, left: '5', limit: '5', spent: '0', tag: null })), left: '5', spent: '0' })
    const body = (await request.json()) as { budget?: number | null; hash?: string; id?: string; member?: string; memberBudget?: number | null; role?: Mate['role']; team?: string }
    if (path === '/api/keys/credit') return Response.json({ created: true, credit: { deposited: '0', left: '0', spent: '0' }, deposits: deposits.get(String(body.hash)) ?? [] })
    if (path === '/v1/teams/create') {
      const address = '0x' + String(++made).padStart(40, '0')
      teams.set(address, { budget: null, members: new Map([[operator, { limit: null, role: 'admin' }]]) })
      return Response.json({ address })
    }
    const team = teams.get(String(body.team).toLowerCase())
    if (!team) return Response.json({ detail: 'No such team.' }, { status: 404 })
    const member = String(body.member).toLowerCase()
    if (path === '/v1/teams/members')
      return Response.json({ memberBudget: team.budget, members: [...team.members].map(([address, mate]) => ({ budget: mate.limit, limit: mate.limit ?? team.budget, member: address, role: mate.role })) })
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
    .prepare("insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at, steering, creator) values ('s', 'Title', 'Goal', 'running', 0, 0, 1, 1, ?, ?)")
    .run(swarm.steering ?? 'team', swarm.creator === undefined ? ada : swarm.creator)
  const seated = (team: string) => [...(teams.get(team)?.members ?? [])].filter(([address]) => address !== operator).map(([address, mate]) => `${address === ada ? 'ada' : address === bob ? 'bob' : address === cyd ? 'cyd' : address}:${mate.role}`)
  const name = (address: string, called: string) => db.sqlite.prepare('insert into names (address, name, updated_at) values (?, ?, 1)').run(address, called)
  const settled = async () => {
    while (waited.length) await Promise.all(waited.splice(0))
    return told
  }
  return { calls, db, deposits, down, env, name, seated, settled, teams, told }
}

async function value<T>(result: Promise<{ ok: true; value: T } | { detail: string; ok: false; status: number }>) {
  const settled = await result
  assert.ok(settled.ok, settled.ok ? '' : `${settled.status} ${settled.detail}`)
  return settled.value
}

async function refused(result: Promise<{ ok: boolean; status?: number }>) {
  const settled = await result
  assert.ok(!settled.ok)
  return settled.status
}

test("a roster is not read until the gateway says which wallet holds the swarm's team, and that wallet is never a seat to add or remove", async () => {
  const { calls, db, down, env, seated, teams } = world()
  const team = '0x' + '7e'.repeat(20)
  down.add('/api/keys/me')
  assert.equal(await refused(Operations.seat(env, { member: bob, swarm: 's' }, ada)), 502)
  assert.ok(!calls.includes('/v1/teams/create'))
  teams.set(team, { budget: null, members: new Map([[operator, { limit: null, role: 'admin' }], [ada, { limit: null, role: 'admin' }], [bob, { limit: null, role: 'member' }]]) })
  db.sqlite.prepare("update swarms set team = ? where id = 's'").run(team)
  Team.forget('s')
  assert.equal(await refused(Operations.team(env, { swarm: 's' })), 502)

  down.clear()
  assert.deepEqual((await value(Operations.team(env, { swarm: 's' }))).seats.map((seat) => seat.address), [ada, bob])
  calls.length = 0
  assert.equal(await refused(Operations.unseat(env, { member: operator, swarm: 's' }, ada)), 404)
  assert.equal(await refused(Operations.seat(env, { member: operator, swarm: 's' }, ada)), 400)
  assert.equal(await refused(Operations.unseat(env, { member: cyd, swarm: 's' }, ada)), 404)
  assert.ok(!calls.includes('/v1/teams/remove') && !calls.includes('/v1/teams/add'))
  assert.ok(teams.get(team)?.members.has(operator))
  assert.deepEqual(seated(team), ['ada:admin', 'bob:member'])
})

test('an admin removed on another isolate is refused on this one, whatever roster it holds', async () => {
  const { db, env, name, seated, teams } = world()
  name(bob, 'bob')
  const roster = await value(Operations.seat(env, { member: bob, role: 'admin', swarm: 's' }, ada))
  const team = roster.team as string
  assert.deepEqual(roster.admins, [ada, bob])
  assert.deepEqual(Team.cached('s')?.admins, [ada, bob])

  teams.get(team)?.members.delete(bob)
  assert.equal(await refused(Operations.unseat(env, { member: ada, swarm: 's' }, bob)), 403)
  assert.equal(await refused(Operations.seat(env, { member: bob, role: 'admin', swarm: 's' }, bob)), 403)
  assert.equal(await refused(Operations.steer(env, { steering: 'open', swarm: 's' }, bob)), 403)
  assert.equal(await refused(Operations.say(env, { steer: '1', swarm: 's', text: '@swarm try lattices' }, bob)), 403)
  assert.equal(db.sqlite.prepare('select count(*) as steers from steers').get()?.['steers'], 0)
  assert.deepEqual(seated(team), ['ada:admin'])
  assert.equal(await refused(Operations.unseat(env, { member: ada, swarm: 's' }, ada)), 409)
})

test('two admins who leave at once still leave the swarm led by whoever started it', async () => {
  const { env, seated } = world()
  const team = (await value(Operations.seat(env, { member: bob, role: 'admin', swarm: 's' }, ada))).team as string
  await Promise.all([Operations.unseat(env, { member: ada, swarm: 's' }, ada), Operations.unseat(env, { member: bob, swarm: 's' }, bob)])
  assert.deepEqual(seated(team), [])
  Team.forget('s')

  const left = await value(Operations.team(env, { swarm: 's' }))
  assert.deepEqual(left.admins, [ada])
  assert.deepEqual(left.seats.map((seat) => [seat.address, seat.role]), [[ada, 'admin']])
  await value(Operations.seat(env, { member: cyd, swarm: 's' }, ada))
  assert.deepEqual(seated(team).sort(), ['ada:admin', 'cyd:member'])
})

test('a gateway team left with no admin is led by whoever started the swarm, who is its admin again once they add someone', async () => {
  const { env, seated, teams } = world()
  const team = (await value(Operations.seat(env, { member: bob, role: 'admin', swarm: 's' }, ada))).team as string
  teams.get(team)?.members.delete(ada)
  teams.get(team)?.members.delete(bob)

  const row = await Store.find(env, 's')
  assert.ok(row)
  const adrift = await Team.roster(env, row)
  assert.deepEqual(adrift.admins, [ada])
  assert.deepEqual(adrift.seats.map((seat) => [seat.address, seat.role, seat.limit]), [[ada, 'admin', null]])
  assert.equal(await refused(Operations.seat(env, { member: cyd, swarm: 's' }, bob)), 403)
  assert.equal(await refused(Operations.unseat(env, { member: ada, swarm: 's' }, ada)), 409)

  const mended = await value(Operations.seat(env, { member: cyd, swarm: 's' }, ada))
  assert.deepEqual(mended.admins, [ada])
  assert.deepEqual(seated(team).sort(), ['ada:admin', 'cyd:member'])
})

test('with no admin on the gateway team and nobody who started the swarm, its biggest rider leads it, and a member who leads becomes its admin by adding someone', async () => {
  const { db, env, seated, teams } = world({ creator: null })
  db.sqlite.prepare("insert into contributions (id, swarm, contributor, token, amount, note, note_id, created_at) values ('g1', 's', ?, 'ousd', '5000000', null, null, 1), ('g2', 's', ?, 'ousd', '1000000', null, null, 1)").run(bob, cyd)
  const team = (await value(Operations.seat(env, { budget: 3, member: cyd, swarm: 's' }, bob))).team as string
  teams.get(team)?.members.delete(bob)

  const row = await Store.find(env, 's')
  assert.ok(row)
  assert.deepEqual((await Team.roster(env, row)).admins, [bob])
  db.sqlite.prepare("update contributions set amount = '9000000' where id = 'g2'").run()
  const led = await Team.roster(env, row)
  assert.deepEqual(led.admins, [cyd])
  assert.deepEqual(led.seats.map((seat) => [seat.address, seat.role, seat.limit]), [[cyd, 'admin', '3.000000']])

  await value(Operations.seat(env, { member: bob, swarm: 's' }, cyd))
  assert.deepEqual(seated(team).sort(), ['bob:member', 'cyd:admin'])
})

test('two first seats at once land on one gateway team, and the team made by the one that lost is deleted', async () => {
  const { calls, env, seated, teams } = world()
  const [first, second] = await Promise.all([Operations.seat(env, { member: bob, swarm: 's' }, ada), Operations.seat(env, { member: cyd, swarm: 's' }, ada)])
  assert.ok(first.ok && second.ok)
  assert.equal(calls.filter((path) => path === '/v1/teams/create').length, 2)

  const team = (await Store.find(env, 's'))?.team as string
  assert.deepEqual([...teams.keys()], [team])
  assert.deepEqual(seated(team).sort(), ['ada:admin', 'bob:member', 'cyd:member'])
})

test("a team whose admin the gateway did not add is kept, and the next try adds them to it", async () => {
  const { calls, down, env, seated } = world()
  down.add('/v1/teams/add')
  assert.equal(await refused(Operations.seat(env, { member: bob, swarm: 's' }, ada)), 502)
  const team = (await Store.find(env, 's'))?.team as string
  assert.ok(team)

  down.clear()
  const roster = await value(Operations.seat(env, { member: bob, swarm: 's' }, ada))
  assert.equal(roster.team, team)
  assert.equal(calls.filter((path) => path === '/v1/teams/create').length, 1)
  assert.deepEqual(seated(team).sort(), ['ada:admin', 'bob:member'])
})

test("while the gateway cannot list a swarm's team, its seats are told to try again rather than that they are not on it, and their notes wait with their money", async () => {
  const { db, deposits, down, env, name } = world()
  name(bob, 'bob')
  await value(Operations.seat(env, { member: bob, swarm: 's' }, ada))
  const hash = '0x' + '11'.repeat(32)
  deposits.set(hash, [{ amount: '2', from: bob, log: 0, tag: Credit.tag('s', 'try lattices'), token: 'ousd' }])
  const counted = () => db.sqlite.prepare('select id, note from contributions order by created_at, id').all().map((row) => ({ ...row }))

  down.add('/v1/teams/members')
  assert.equal(await refused(Operations.say(env, { steer: '1', swarm: 's', text: '@swarm try codes' }, bob)), 502)
  assert.equal(await refused(Operations.btw(env, { question: 'Why lattices?', swarm: 's' }, bob)), 502)
  assert.equal(await refused(Operations.fund(env, { amount: '1', branch: 1, swarm: 's' }, bob)), 502)
  assert.equal(await refused(Operations.steer(env, { steering: 'open', swarm: 's' }, ada)), 502)
  assert.equal(await refused(Operations.contribute(env, { hash, note: 'try lattices', swarm: 's' })), 502)
  assert.deepEqual(counted(), [])

  down.clear()
  assert.equal((await value(Operations.contribute(env, { hash, note: 'try lattices', swarm: 's' }))).contributed.contribution.note, 'try lattices')
  assert.deepEqual(counted().map((row) => row.note), ['try lattices'])
})

test("a seat's steer tells the room the roster, with what is left of their budget", async () => {
  const { env, name, settled, told } = world()
  name(bob, 'bob')
  await value(Operations.seat(env, { budget: 10, member: bob, swarm: 's' }, ada))
  await settled()
  told.length = 0

  await value(Operations.say(env, { steer: '1', swarm: 's', text: '@swarm try lattices' }, bob))
  assert.deepEqual((await settled()).map((roster) => roster.seats.find((seat) => seat.address === bob)?.left), ['9.000000'])
})

test('money that makes someone else the biggest rider of a swarm nobody started tells the room who leads it now', async () => {
  const { deposits, env, settled } = world({ creator: null, steering: 'open' })
  const hashes = ['0x' + '44'.repeat(32), '0x' + '55'.repeat(32)] as const
  deposits.set(hashes[0], [{ amount: '5', from: bob, log: 0, tag: Credit.tag('s'), token: 'ousd' }])
  deposits.set(hashes[1], [{ amount: '9', from: cyd, log: 0, tag: Credit.tag('s'), token: 'ousd' }])

  await value(Operations.contribute(env, { hash: hashes[0], swarm: 's' }))
  await value(Operations.contribute(env, { hash: hashes[1], swarm: 's' }))
  assert.deepEqual((await settled()).map((roster) => roster.admins), [[bob], [cyd]])
})
test("a swarm's team is named with only what the gateway takes in a team name, whatever its title holds", () => {
  const allowed = /^[\p{L}\p{M}\p{N} ._&'-]+$/u
  for (const title of ['Solve P = NP.', 'Port zlib (C) to Rust: fast, safe?', 'Qué es /esto/ & aquello', '  ', '???', 'x'.repeat(80) + ': tail']) {
    const name = Team.named({ id: 'abc123abc123', title })
    assert.ok(allowed.test(name) && name.length >= 1 && name.length <= 64 && name === name.trim(), name)
  }
  assert.equal(Team.named({ id: 'abc123abc123', title: 'Solve P = NP.' }), 'Solve P NP.')
  assert.equal(Team.named({ id: 'abc123abc123', title: '???' }), 'Swarm abc123abc123')
})
