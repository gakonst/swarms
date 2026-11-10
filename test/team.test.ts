import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type { Roster } from '../src/shared/Api.ts'
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
  const gateway = async (request: Request) => {
    const path = new URL(request.url).pathname
    calls.push(path)
    if (down.has(path)) return Response.json({ detail: 'down' }, { status: 503 })
    if (path === '/api/keys/me') return Response.json({ wallet: operator })
    const body = (await request.json()) as { budget?: number | null; member?: string; memberBudget?: number | null; role?: Mate['role']; team?: string }
    if (path === '/v1/teams/create') {
      const address = '0x' + String(teams.size + 1).padStart(40, '0')
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
    if (path === '/v1/teams/update') {
      team.budget = body.memberBudget ?? null
      return Response.json({})
    }
    return Response.json({ detail: 'No such route.' }, { status: 404 })
  }
  const room = { rostered: async (roster: Roster) => void told.push(roster) }
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
  return { calls, db, down, env, seated, teams, told }
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

test('an admin removed on another isolate is refused on this one, whatever roster it holds', async () => {
  const { env, seated, teams } = world()
  const roster = await value(Operations.seat(env, { member: bob, role: 'admin', swarm: 's' }, ada))
  const team = roster.team as string
  assert.deepEqual(roster.admins, [ada, bob])
  assert.deepEqual(Team.cached('s')?.admins, [ada, bob])

  teams.get(team)?.members.delete(bob)
  assert.equal(await refused(Operations.unseat(env, { member: ada, swarm: 's' }, bob)), 403)
  assert.equal(await refused(Operations.seat(env, { member: bob, role: 'admin', swarm: 's' }, bob)), 403)
  assert.equal(await refused(Operations.steer(env, { steering: 'open', swarm: 's' }, bob)), 403)
  assert.deepEqual(seated(team), ['ada:admin'])
  assert.equal(await refused(Operations.unseat(env, { member: ada, swarm: 's' }, ada)), 409)
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
