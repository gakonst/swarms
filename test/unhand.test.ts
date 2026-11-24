import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'
import * as Setup from '../src/shared/Setup.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')

const operator = '0x00000000000000000000000000000000000000ee'
const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

function setup() {
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
