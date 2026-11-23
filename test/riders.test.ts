import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'
import { github } from './dispatch.ts'
import * as Credit from '../src/shared/Credit.ts'
import * as Setup from '../src/shared/Setup.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')

Runner.timing.pollMs = 10
Runner.timing.listMs = 0
Runner.timing.streamDownMs = 10

const owner = '0x00000000000000000000000000000000000000ee'
const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

function setup() {
  const deposits = new Map<string, { amount: string; from: string; tag: string }>()
  const w = world(async (request, url) => {
    if (url.pathname === '/v1/models') return Response.json({ data: [Setup.flash, Setup.glmFlash, Setup.fable, Setup.sol, 'vercel/google/gemini-3.8-flash'].map((id) => ({ id, kind: 'generate', pricing: { cached: 0.01, input: 0.1, output: 0.4 } })) })
    if (url.pathname === '/api/keys/me') return Response.json({ wallet: owner })
    if (url.pathname === '/api/keys/credit' && request.method === 'POST') {
      const { hash } = (await request.json()) as { hash: string }
      const found = deposits.get(hash)
      if (!found) return Response.json({ error: 'no receipt' }, { status: 404 })
      return Response.json({ created: true, credit: { deposited: found.amount, left: found.amount, spent: '0' }, deposits: [{ ...found, log: 0, token: 'pathusd' }] })
    }
    if (url.pathname === '/api/keys/credit') {
      const total = [...deposits.values()].reduce((sum, one) => sum + Number(one.amount), 0)
      return Response.json({ deposited: String(total), left: String(total), spent: '0' })
    }
    if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_d' })
    if (url.pathname.startsWith('/v1/agents/agt_d')) return Response.json(url.pathname.endsWith('/subagents') ? { agents: [] } : { request_id: 'x', status: 'queued' })
    return undefined
  })
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
  github(w.env)
  return { deposits, w }
}

async function tree(w: ReturnType<typeof world>, reviewed = false) {
  const made = await Operations.create(
    w.env,
    {
      form: 'tree',
      goal: 'Settle whether P equals NP, checked in Lean.',
      seed: [
        { form: 'program', key: 'lower', title: 'Lower bounds' },
        { form: 'lemma', key: 'switch', parent: 'lower', statement: 'True', title: 'Switching lemma' },
        { form: 'lemma', key: 'parity', needs: ['switch'], parent: 'lower', statement: 'True ∧ True', title: 'Parity is not in AC0' },
      ],
      statement: 'P = NP ∨ P ≠ NP',
      reviewed,
      template: 'cheap',
      title: 'P vs NP',
    },
    ana,
  )
  assert.ok(made.ok, JSON.stringify(made))
  return made.value.id
}

test("a rider's profile lists the swarms they rode with their dollars and the items they created or rode", async (t) => {
  const { deposits, w } = setup()
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const id = await tree(w)
  const shown = await Operations.tree(w.env, { swarm: id })
  assert.ok(shown.ok)
  const lemma = shown.value.nodes.find((node) => node.title === 'Switching lemma')?.id ?? ''
  const pay = async (hash: string, from: string, amount: string, node: string) => {
    deposits.set(hash, { amount, from, tag: Credit.tag(id, 'n:' + node) })
    const counted = await Operations.contribute(w.env, { hash, node, swarm: id })
    assert.ok(counted.ok, JSON.stringify(counted))
  }
  await pay('0x' + '1'.repeat(64), ana, '2', lemma)
  await pay('0x' + '2'.repeat(64), bo, '3', 'root')
  const proposed = await Operations.propose(w.env, { parent: lemma, spec: 'Use restrictions.', swarm: id, title: 'Restrictions', token: 'pathusd' }, 'https://swarms.test', ana)
  assert.ok(proposed.ok, JSON.stringify(proposed))
  await pay('0x' + '3'.repeat(64), ana, '1.5', proposed.value.nid)
  assert.ok((await Operations.rename(w.env, { name: 'ana' }, ana)).ok)

  const named = await Operations.rider(w.env, { who: '@Ana' })
  assert.ok(named.ok, JSON.stringify(named))
  assert.deepEqual([named.value.rider.address, named.value.rider.handle, named.value.ridden], [ana, 'ana', '3.500000'])
  assert.deepEqual(named.value.swarms.map((one) => [one.id, one.title, one.ridden, one.riders, one.started]), [[id, 'P vs NP', '3.500000', 2, true]])
  assert.deepEqual(named.value.items.map((item) => [item.title, item.ridden, item.created]), [['Switching lemma', '2.000000', false], ['Restrictions', '1.500000', true]])

  const by = await Operations.rider(w.env, { who: bo })
  assert.ok(by.ok)
  assert.deepEqual([by.value.ridden, by.value.swarms.map((one) => [one.ridden, one.started]), by.value.items], ['3.000000', [['3.000000', false]], []])

  const nobody = await Operations.rider(w.env, { who: 'nobody' })
  assert.deepEqual([nobody.ok, !nobody.ok && nobody.status], [false, 404])
  const stranger = await Operations.rider(w.env, { who: '0x' + 'c'.repeat(40) })
  assert.ok(stranger.ok)
  assert.deepEqual([stranger.value.ridden, stranger.value.swarms, stranger.value.items], ['0.000000', [], []])
})
