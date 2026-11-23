import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'
import { github } from './dispatch.ts'
import * as Credit from '../src/shared/Credit.ts'
import * as Setup from '../src/shared/Setup.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'
import type * as StoreModule from '../src/worker/Store.ts'

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')
const Store: typeof StoreModule = await import('../src/worker/Store.ts')

Runner.timing.pollMs = 10
Runner.timing.listMs = 0
Runner.timing.streamDownMs = 10

const owner = '0x00000000000000000000000000000000000000ee'
const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

function setup() {
  const deposits = new Map<string, { amount: string; from: string; tag: string }>()
  const w = world(async (request, url) => {
    if (url.pathname === '/v1/models') return Response.json({ data: [Setup.flash, Setup.glmFlash].map((id) => ({ id, kind: 'generate', pricing: { cached: 0.01, input: 0.1, output: 0.4 } })) })
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

test('a tree swarm is created with its root, triage and reviewed seed, and lists first', async (t) => {
  const { w } = setup()
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const id = await tree(w)
  const shown = await Operations.tree(w.env, { swarm: id })
  assert.ok(shown.ok, JSON.stringify(shown))
  const titles = shown.value.nodes.map((node) => node.title)
  assert.deepEqual(titles.sort(), ['Lower bounds', 'P vs NP', 'Parity is not in AC0', 'Switching lemma', 'Triage'].sort())
  const parity = shown.value.nodes.find((node) => node.title === 'Parity is not in AC0')
  const lemma = shown.value.nodes.find((node) => node.title === 'Switching lemma')
  assert.deepEqual(parity?.needs, [lemma?.id])
  assert.equal(shown.value.headline.frontier, 1)
  const detail = await Operations.node(w.env, { node: lemma?.id, swarm: id })
  assert.ok(detail.ok)
  assert.equal(detail.value.review, true)
  assert.deepEqual([lemma?.review, shown.value.nodes.find((node) => node.title === 'Lower bounds')?.review], [true, false])
  assert.equal(detail.value.statement, 'True')
  const listed = await Store.list(w.env)
  assert.deepEqual(listed.map((row) => [row.id, row.form]), [[id, 'tree']])
  const branches = await Operations.branches(w.env, { swarm: id })
  assert.deepEqual([branches.ok, !branches.ok && branches.status], [false, 410])
})

test('a seed created as reviewed shows no statement under review', async (t) => {
  const { w } = setup()
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const id = await tree(w, true)
  const shown = await Operations.tree(w.env, { swarm: id })
  assert.ok(shown.ok, JSON.stringify(shown))
  assert.deepEqual(shown.value.nodes.filter((node) => node.review), [])
})

test('a ride names its node by the memo tag; a wrong tag counts to the root; a proposal becomes a node once ridden', async (t) => {
  const { deposits, w } = setup()
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const id = await tree(w)
  const shown = await Operations.tree(w.env, { swarm: id })
  assert.ok(shown.ok)
  const lemma = shown.value.nodes.find((node) => node.title === 'Switching lemma')?.id ?? ''
  const prepared = await Operations.transfer(w.env, { amount: '2', node: lemma, swarm: id, token: 'pathusd' }, 'https://swarms.test')
  assert.ok(prepared.ok)
  assert.equal(prepared.value.memo, Credit.memo(owner, id, 'n:' + lemma))
  const hash = '0x' + '1'.repeat(64)
  deposits.set(hash, { amount: '2', from: ana, tag: Credit.tag(id, 'n:' + lemma) })
  const counted = await Operations.contribute(w.env, { hash, node: lemma, swarm: id })
  assert.ok(counted.ok, JSON.stringify(counted))
  assert.equal(counted.value.created, true)
  const wrong = '0x' + '2'.repeat(64)
  deposits.set(wrong, { amount: '1', from: bo, tag: Credit.tag(id, 'n:ffffffffff') })
  assert.ok((await Operations.contribute(w.env, { hash: wrong, node: lemma, swarm: id })).ok)
  const again = await Operations.contribute(w.env, { hash, node: lemma, swarm: id })
  assert.ok(again.ok && !again.value.created)
  const node = await Operations.node(w.env, { node: lemma, swarm: id })
  assert.ok(node.ok)
  assert.deepEqual(node.value.funders.map((funder) => [funder.who.address, funder.amount]), [[ana, '2.000000']])
  const root = await Operations.node(w.env, { node: 'root', swarm: id })
  assert.ok(root.ok)
  assert.equal(root.value.money.pledged, '1.000000')

  const proposed = await Operations.propose(w.env, { parent: lemma, spec: 'Use the Håstad switching lemma.', swarm: id, title: 'Restrictions', token: 'pathusd' }, 'https://swarms.test', bo)
  assert.ok(proposed.ok, JSON.stringify(proposed))
  assert.equal(proposed.value.transfer.amount, '1.000000')
  const ride = '0x' + '3'.repeat(64)
  deposits.set(ride, { amount: '1', from: bo, tag: Credit.tag(id, 'n:' + proposed.value.nid) })
  assert.ok((await Operations.contribute(w.env, { hash: ride, node: proposed.value.nid, swarm: id })).ok)
  const made = await Operations.node(w.env, { node: proposed.value.nid, swarm: id })
  assert.ok(made.ok, JSON.stringify(made))
  assert.equal(made.value.by.address, bo)
  assert.equal(made.value.parent, lemma)
  const mine = await Operations.standing(w.env, { swarm: id }, bo)
  assert.ok(mine.ok)
  assert.equal(mine.value.committed, '2.000000')
})

test('suggestions are rate-limited, moves keep money with its rider, and the operator alone archives', async (t) => {
  const { deposits, w } = setup()
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const id = await tree(w)
  for (let n = 0; n < 5; n++) assert.ok((await Operations.suggest(w.env, { swarm: id, text: 'Idea number ' + n }, ana)).ok)
  const limited = await Operations.suggest(w.env, { swarm: id, text: 'One too many' }, ana)
  assert.deepEqual([limited.ok, !limited.ok && limited.status], [false, 429])
  const root = await Operations.node(w.env, { node: 'root', swarm: id })
  assert.ok(root.ok && root.value.suggestions.length === 5)

  const hash = '0x' + '4'.repeat(64)
  deposits.set(hash, { amount: '0.2', from: ana, tag: Credit.tag(id, 'n:ffffffffff') })
  assert.ok((await Operations.contribute(w.env, { hash, swarm: id })).ok)
  const moved = await Operations.nodeMove(w.env, { amount: '0.2', node: 'root', swarm: id, to: '' }, ana)
  assert.ok(moved.ok, JSON.stringify(moved))
  const stolen = await Operations.nodeMove(w.env, { amount: '0.1', node: '', swarm: id, to: 'root' }, bo)
  assert.deepEqual([stolen.ok, !stolen.ok && stolen.status], [false, 409])
  const mine = await Operations.standing(w.env, { swarm: id }, ana)
  assert.ok(mine.ok && mine.value.free === '0.200000')

  const refused = await Operations.archive(w.env, { swarm: id }, ana)
  assert.deepEqual([refused.ok, !refused.ok && refused.status], [false, 403])
  const archived = await Operations.archive(w.env, { swarm: id }, owner)
  assert.ok(archived.ok && archived.value.archivedAt !== null)
  const ride = await Operations.transfer(w.env, { amount: '1', swarm: id, token: 'pathusd' }, 'https://swarms.test')
  assert.deepEqual([ride.ok, !ride.ok && ride.status], [false, 410])
  assert.ok((await Operations.tree(w.env, { swarm: id })).ok)
})

test('the ledger equals the gateway credit, as /v1/health reports it', async (t) => {
  const { deposits, w } = setup()
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const id = await tree(w)
  const hash = '0x' + '5'.repeat(64)
  deposits.set(hash, { amount: '0.3', from: ana, tag: Credit.tag(id, null) })
  assert.ok((await Operations.contribute(w.env, { hash, swarm: id })).ok)
  const health = await Operations.health(w.env)
  assert.ok(health.ok)
  const book = health.value.ledgers.find((one) => one.swarm === id)
  assert.deepEqual([book?.ok, book?.held, book?.pledged, book?.drift], [true, '0.300000', '0.300000', '0.000000'])
})
