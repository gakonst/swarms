import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'
import type * as StoreModule from '../src/worker/Store.ts'
import type * as NodesModule from '../src/worker/Nodes.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'
import type * as FlowModule from '../src/worker/Flow.ts'

const Store: typeof StoreModule = await import('../src/worker/Store.ts')
const Nodes: typeof NodesModule = await import('../src/worker/Nodes.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')
const Flow: typeof FlowModule = await import('../src/worker/Flow.ts')

Runner.timing.pollMs = 10
Runner.timing.listMs = 0
Runner.timing.streamDownMs = 10
Runner.timing.idleMs = 100_000
Runner.timing.verifyMs = 10

const id = 'abc123abc123'
const ana = '0x' + 'a'.repeat(40)
const bo = '0x' + 'b'.repeat(40)

type Sub = { agent_id: number; budget_usd?: number; messages: string[]; parent_agent_id: null; role: string; spent_usd: number; status: { output?: unknown; state: string }; task: string }

function gateway() {
  const subs: Sub[] = []
  const prompts: string[] = []
  const budgets: [number, number][] = []
  let agents = 0
  const route = async (request: Request, url: URL) => {
    if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_d' + ++agents })
    const turn = url.pathname.match(/^\/v1\/agents\/(agt_d\d+)\/turns$/)
    if (turn && request.method === 'POST') {
      const body = (await request.json()) as { prompt: string }
      prompts.push(body.prompt)
      const args = JSON.parse(body.prompt.slice(body.prompt.indexOf('{'))) as { budget_usd: number; role: string; task: string }
      subs.push({ agent_id: subs.length + 1, budget_usd: args.budget_usd, messages: [], parent_agent_id: null, role: args.role, spent_usd: 0, status: { state: 'running' }, task: args.task })
      return Response.json({ request_id: 'x', status: 'queued' })
    }
    if (/^\/v1\/agents\/agt_d\d+\/subagents$/.test(url.pathname)) return Response.json({ agents: subs })
    const sub = url.pathname.match(/^\/v1\/agents\/agt_d\d+\/subagents\/(\d+)\/(budget|close|messages)$/)
    if (sub) {
      const found = subs.find((one) => one.agent_id === Number(sub[1]))
      if (!found) return Response.json({ error: 'no' }, { status: 404 })
      const body = request.method === 'POST' && sub[2] !== 'close' ? ((await request.json()) as Record<string, unknown>) : {}
      if (sub[2] === 'budget') {
        found.budget_usd = Number(body['budget_usd'])
        budgets.push([found.agent_id, found.budget_usd])
        return Response.json({ agent: found })
      }
      if (sub[2] === 'messages') {
        found.messages.push(String(body['message']))
        return Response.json({ disposition: 'queued' })
      }
      if (!['completed', 'failed'].includes(found.status.state)) found.status = { ...found.status, state: 'closed' }
      return Response.json({ agents: subs })
    }
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '10', left: '10', spent: '0' })
    return undefined
  }
  return { budgets, prompts, route, subs }
}

async function until(check: () => boolean | Promise<boolean>, ms = 5000) {
  const end = performance.now() + ms
  while (performance.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('timed out')
}

async function planted(route: Parameters<typeof world>[0], triageShare = 0, statement: string | null = null) {
  const w = world(route)
  await Store.insert(w.env, { creator: null, form: 'tree', goal: 'g', id, problem: null, setup: null, steering: 'open', title: 'Tree' })
  await w.swarm.plant({
    dispatcher: 'spawn',
    root: { statement, title: 'Does P = NP?', words: 'The question.' },
    seed: [],
    settings: { ...Nodes.defaults, triageShare },
    setup: null,
    swarm: id,
  })
  return w
}

const proof = (sha: string, statement = 'none') => ({ at: 1, axioms: ['propext'], checker: 'lean4checker', command: 'lake build', commit: sha, contentHash: 'h', durationMs: 1, exitCode: 0, mathlib: 'm', repo: 'r', run: '1', statement, theorem: 'Pnp.N', toolchain: 't', url: 'https://example.test/run/1' })

test('a ride commits a run, the dispatcher spawns it with the commitment as its bound, and its result splits the node', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  await w.swarm.treePledge(id, { amount: '12', contributor: ana, hash: '0x' + '1'.repeat(64), nid: null })
  await until(() => g.subs.length === 1)
  assert.equal(g.subs[0]?.role, 'n:root#1')
  assert.equal(g.subs[0]?.budget_usd, 5)
  assert.deepEqual(g.budgets[0], [1, 5])
  let view = await w.swarm.treeRead(id, { depth: 3, root: 'root', status: undefined })
  assert.ok(view.ok)
  const root = view.value.nodes.find((node) => node.id === 'root')
  assert.equal(root?.status, 'in flight')
  assert.equal(root?.money.left, '7.000000')
  assert.equal(root?.money.committed, '5.000000')
  const sub = g.subs[0] as Sub
  sub.spent_usd = 1.25
  sub.status = { output: { children: [{ needs: [], spec: 'First.', statement: 'True', title: 'Lemma A' }, { needs: ['Lemma A'], spec: 'Second.', statement: 'False -> False', title: 'Lemma B' }], commit: null, outcome: 'split', summary: 'Split in two', theorem: null, why: null }, state: 'completed' }
  Runner.wake(w.swarm)
  await until(async () => {
    const shown = await w.swarm.treeRead(id, { depth: 3, root: 'root', status: undefined })
    return shown.ok && shown.value.nodes.length === 4
  })
  view = await w.swarm.treeRead(id, { depth: 3, root: 'root', status: undefined })
  assert.ok(view.ok)
  const spentRoot = view.value.nodes.find((node) => node.id === 'root')
  assert.equal(spentRoot?.money.spent, '1.250000')
  const a = view.value.nodes.find((node) => node.title === 'Lemma A')
  const b = view.value.nodes.find((node) => node.title === 'Lemma B')
  assert.equal(a?.by.agent, 'n:root')
  assert.deepEqual(b?.needs, [a?.id])
  await until(() => g.subs.length === 2)
  assert.equal(g.subs[1]?.role, 'n:' + a?.id + '#1')
  const totals = Flow.totals(await Flow.rows(w.env, id))
  assert.equal(totals.held, totals.pledged - totals.spent)
  assert.equal(totals.spent, 1_250_000n)
})

test('a proved run is checked by Lean; the check proves the node and returns its money up the tree', async (t) => {
  const g = gateway()
  const w = await planted(g.route, 0, 'P = NP ∨ P ≠ NP')
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const sha = 'c'.repeat(40)
  await w.swarm.treePledge(id, { amount: '3', contributor: ana, hash: '0x' + '2'.repeat(64), nid: null })
  await until(() => g.subs.length === 1)
  const sub = g.subs[0] as Sub
  sub.spent_usd = 0.5
  sub.status = { output: JSON.stringify({ children: [], commit: sha, outcome: 'proved', summary: 'Done', theorem: 'Pnp.Nroot', why: null }), state: 'completed' }
  Runner.wake(w.swarm)
  await until(async () => (await w.swarm.board.tasks()).some((task) => task.id === Nodes.verifyId('root', sha)))
  let view = await w.swarm.treeRead(id, { depth: 1, root: 'root', status: undefined })
  assert.ok(view.ok && view.value.nodes[0]?.status === 'in flight' && view.value.nodes[0]?.run?.checking)
  await w.swarm.treeVerified(id, 'root', sha, proof(sha, await Nodes.stmt('P = NP ∨ P ≠ NP')))
  await until(async () => (await w.swarm.board.task('n:root'))?.phase === 'done')
  view = await w.swarm.treeRead(id, { depth: 1, root: 'root', status: undefined })
  assert.ok(view.ok)
  assert.equal(view.value.nodes[0]?.status, 'proven')
  assert.equal(view.value.nodes[0]?.proof?.commit, sha)
  assert.equal(view.value.headline.proven, 1)
  const standing = await w.swarm.treeStanding(id, ana)
  assert.equal(standing.free, '2.500000')
  assert.equal(standing.spent, '0.500000')
  const proofs = await w.swarm.treeProofs(id)
  assert.equal(proofs.proofs[0]?.node, 'root')
})

test('a rider steers the node in flight; the note reaches its subagent and is heeded', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  await w.swarm.treePledge(id, { amount: '5', contributor: bo, hash: '0x' + '3'.repeat(64), nid: null })
  await until(() => g.subs.length === 1)
  const steered = await w.swarm.treeSteer(id, { amount: '0', contributor: bo, nid: 'root', note: 'Try circuits first' })
  assert.ok(steered.ok, JSON.stringify(steered))
  await until(() => (g.subs[0]?.messages.length ?? 0) === 1)
  assert.match(g.subs[0]?.messages[0] ?? '', /behind this, from @.*\] Try circuits first/)
  const refused = await w.swarm.treeSteer(id, { amount: '0', contributor: ana, nid: 'root', note: 'Mine' })
  assert.deepEqual([refused.ok, !refused.ok && refused.status], [false, 403])
})

test('ending a node cascades to its children, closes their runs and returns money the way it came', async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const program = await Nodes.post(w.swarm, { by: 'seed', form: 'program', needs: [], parent: 'root', statement: null, title: 'Lower bounds', words: '' })
  const lemma = await Nodes.post(w.swarm, { by: 'agent:n:' + program.nid, form: 'lemma', needs: [], parent: program.nid, statement: 'True', title: 'Switching lemma', words: '' })
  await w.swarm.treePledge(id, { amount: '4', contributor: ana, hash: '0x' + '4'.repeat(64), nid: program.nid })
  await until(() => g.subs.length === 1)
  assert.equal(g.subs[0]?.role, 'n:' + lemma.nid + '#1')
  let rows = await Flow.rows(w.env, id)
  assert.equal(Flow.fold(rows).inherited.get(lemma.nid), 4_000_000n)
  ;(g.subs[0] as Sub).spent_usd = 1
  const ended = await w.swarm.treeEnd(id, { admin: false, contributor: ana, nid: program.nid, why: 'Barrier' })
  assert.ok(ended.ok, JSON.stringify(ended))
  assert.equal(ended.value.status, 'dead end')
  assert.equal(g.subs[0]?.status.state, 'closed')
  rows = await Flow.rows(w.env, id)
  const ledger = Flow.fold(rows)
  assert.equal(ledger.left.get(lemma.nid) ?? 0n, 0n)
  assert.equal(ledger.left.get(program.nid) ?? 0n, 0n)
  assert.equal(ledger.left.get(''), 3_000_000n)
  const node = await w.swarm.nodeRead(id, lemma.nid)
  assert.ok(node.ok)
  assert.equal(node.value.end?.kind, 'withdrawn')
  assert.equal(node.value.runs[0]?.spent, '1.000000')
})
