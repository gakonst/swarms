import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'
import * as Setup from '../src/shared/Setup.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')

const operator = '0x00000000000000000000000000000000000000ee'
const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

function setup(revoking: (name: string) => Response | undefined = () => undefined) {
  const minted: string[] = []
  const revoked: string[] = []
  const listed = new Set<string>()
  const w = world(async (request, url) => {
    if (url.pathname === '/v1/models') return Response.json({ data: [Setup.flash, Setup.glmFlash].map((id) => ({ id, kind: 'generate', pricing: { cached: 0.01, input: 0.1, output: 0.4 } })) })
    if (url.pathname === '/api/keys/me') return Response.json({ wallet: operator })
    if (url.pathname === '/v1/hands' && request.method === 'POST') {
      const name = url.searchParams.get('name') ?? ''
      minted.push(name)
      listed.add(name)
      return Response.json({ command: 'nc hand', short: 'nc', token: 'hand_' + name, url: 'wss://gateway.test/v1/hands/' + name })
    }
    if (url.pathname === '/v1/hands') return Response.json({ hands: [...listed].map((name) => ({ connected: true, name, requests: 1 })) })
    const named = /^\/v1\/hands\/([^/]+)$/.exec(url.pathname)
    if (named && request.method === 'DELETE') {
      const name = decodeURIComponent(named[1] ?? '')
      const answered = revoking(name)
      if (answered) return answered
      revoked.push(name)
      listed.delete(name)
      return Response.json({ disconnected: true })
    }
    return undefined
  })
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
  return { minted, revoked, w }
}

function status<T>(result: { ok: true; value: T } | { ok: false; status: number }) {
  return result.ok ? 200 : result.status
}

const goal = 'Find out whether lending a machine holds up end to end.'

test('issuing a hand needs a signed-in rider or the operator: anonymous answers 401 and mints nothing', async () => {
  const { minted, w } = setup()
  const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Lend' }, ana)
  assert.ok(made.ok)
  const swarm = made.value.id

  const anonymous = await Operations.hand(w.env, { label: 'laptop', swarm })
  assert.deepEqual(anonymous.ok ? undefined : [anonymous.status, anonymous.code], [401, 'unauthorized'])
  assert.deepEqual(await Operations.hand(w.env, { label: 'bad label!', swarm }).then(status), 401)
  assert.deepEqual(minted, [])

  const rider = await Operations.hand(w.env, { label: 'laptop', swarm }, bo)
  assert.ok(rider.ok, JSON.stringify(rider))
  assert.match(rider.value.name, /^laptop-[0-9a-f]{6}$/)
  const byOperator = await Operations.hand(w.env, { label: 'box', swarm }, undefined, true)
  assert.ok(byOperator.ok)
  assert.equal(minted.length, 2)
})

test("the swarm's admins and the operator remove a hand: the gateway revokes it and it leaves the hands and the machines", async () => {
  const { revoked, w } = setup()
  const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Lend' }, ana)
  assert.ok(made.ok)
  const swarm = made.value.id
  const one = await Operations.hand(w.env, { label: 'laptop', swarm }, bo)
  const two = await Operations.hand(w.env, { label: 'box', swarm }, bo)
  assert.ok(one.ok && two.ok)
  w.swarm.kv.put('hands', [{ connected: true, name: one.value.name }, { connected: true, name: two.value.name }])
  const before = await Operations.hands(w.env, { swarm })
  assert.ok(before.ok)
  assert.deepEqual(before.value.hands.map((hand) => hand.name).sort(), [one.value.name, two.value.name].sort())

  assert.equal(status(await Operations.unhand(w.env, { hand: one.value.name, swarm })), 401)
  assert.equal(status(await Operations.unhand(w.env, { hand: one.value.name, swarm }, bo)), 403)
  assert.equal(status(await Operations.unhand(w.env, { hand: 'NOT A NAME', swarm }, ana)), 400)
  assert.equal(status(await Operations.unhand(w.env, { hand: 'never-issued', swarm }, ana)), 404)
  assert.equal(status(await Operations.unhand(w.env, { hand: one.value.name, swarm: 'nonexistent0' }, ana)), 404)
  assert.deepEqual(revoked, [])

  const removed = await Operations.unhand(w.env, { hand: one.value.name, swarm }, ana)
  assert.deepEqual(removed, { ok: true, value: { hand: one.value.name, removed: true, swarm } })
  assert.deepEqual(revoked, [one.value.name])
  const after = await Operations.hands(w.env, { swarm })
  assert.ok(after.ok)
  assert.deepEqual(after.value.hands.map((hand) => hand.name), [two.value.name])
  const machines = await Operations.machines(w.env, { swarm })
  assert.ok(machines.ok)
  assert.deepEqual(machines.value.machines.map((machine) => machine.name), [two.value.name])
  assert.equal(status(await Operations.unhand(w.env, { hand: one.value.name, swarm }, ana)), 404)

  const byOperator = await Operations.unhand(w.env, { hand: two.value.name, swarm }, undefined, true)
  assert.ok(byOperator.ok)
  assert.deepEqual(revoked, [one.value.name, two.value.name])
  const none = await Operations.hands(w.env, { swarm })
  assert.ok(none.ok && none.value.hands.length === 0)
})

test('a hand the gateway fails to revoke stays listed, and one the gateway no longer holds is removed', async () => {
  const { w } = setup((name) => (name.startsWith('down-') ? Response.json({ detail: 'boom' }, { status: 500 }) : name.startsWith('gone-') ? Response.json({ detail: 'No such hand' }, { status: 404 }) : undefined))
  const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Lend' }, ana)
  assert.ok(made.ok)
  const swarm = made.value.id
  const down = await Operations.hand(w.env, { label: 'down', swarm }, bo)
  const gone = await Operations.hand(w.env, { label: 'gone', swarm }, bo)
  assert.ok(down.ok && gone.ok)
  const failed = await Operations.unhand(w.env, { hand: down.value.name, swarm }, ana)
  assert.deepEqual(failed.ok ? undefined : [failed.status, failed.code], [502, 'upstream_failed'])
  assert.deepEqual(await Operations.unhand(w.env, { hand: gone.value.name, swarm }, ana).then(status), 200)
  const left = await Operations.hands(w.env, { swarm })
  assert.ok(left.ok)
  assert.deepEqual(left.value.hands.map((hand) => hand.name), [down.value.name])
})
