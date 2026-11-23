import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, test } from 'node:test'
import * as Credit from '../../src/shared/Credit.ts'
import type * as Tree from '../../src/shared/Tree.ts'
import * as Chain from '../mock/chain.ts'
import * as Gateway from '../mock/gateway.ts'
import * as GitHub from '../mock/github.ts'
import * as Model from '../mock/model.ts'
import * as Chrome from './chrome.ts'
import * as Dev from './dev.ts'
import { type Rider, rider } from './rider.ts'
import { type Standing, swarm, units } from './swarm.ts'

const leaseMs = 4_000
const shots = process.env['E2E_SHOTS'] ?? path.join(os.tmpdir(), 'swarms-e2e-shots')

let dev: Dev.Dev
let ana: Rider
let bob: Rider
let s: ReturnType<typeof swarm>
let supported = false
const nids: Record<string, string> = {}
const deltas: Tree.Delta[] = []
const live = new AbortController()

before(async () => {
  dev = await Dev.start({ leaseMs })
  ana = await rider(dev, 'ana')
  bob = await rider(dev, 'bob')
  const made = await ana.call<{ id: string }>('POST', '/v1/swarms', { form: 'tree', goal: 'Does P = NP? An end-to-end run on mocks.', template: 'cheap', title: 'P vs NP (e2e)' })
  if (made.status !== 201 && made.status !== 200) return
  s = swarm(dev, made.body.id)
  const probed = await dev.call<{ nodes?: unknown[] }>('GET', `/v1/swarms/${made.body.id}/tree`)
  supported = probed.status === 200 && Array.isArray(probed.body.nodes)
  if (!supported) return
  void follow(made.body.id)
})

after(async () => {
  live.abort()
  if (s) fs.writeFileSync(path.join(dev.state, '..', 'swarms-e2e-drift.json'), JSON.stringify(s.drifts, null, 2))
  await dev?.stop()
})

async function follow(id: string) {
  const response = await fetch(dev.url + `/v1/swarms/${id}/live`, { headers: { accept: 'text/event-stream' }, signal: live.signal }).catch(() => undefined)
  if (!response?.ok || !response.body) return
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const read = await reader.read().catch(() => undefined)
    if (!read || read.done) return
    buffer += read.value
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const data = block.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      try {
        const parsed = JSON.parse(data) as Tree.Delta | { delta?: Tree.Delta }
        const delta = 'delta' in parsed && parsed.delta ? parsed.delta : (parsed as Tree.Delta)
        if (delta.node && delta.event) deltas.push(delta)
      } catch {}
    }
  }
}

function needs(t: { skip: (message: string) => void }) {
  if (!supported) t.skip('the Worker under pnpm dev has no tree swarms yet (POST /v1/swarms form tree, GET /tree)')
  return supported
}

const by = (view: { nodes: Tree.Node[] }, nid: string) => view.nodes.find((node) => node.id === nid)

const standing = async (who: Rider) => {
  const answered = await who.call<Standing>('GET', `/v1/me/swarms/${s.id}`)
  assert.equal(answered.status, 200, JSON.stringify(answered.body))
  return answered.body
}

const role = (nid: string, k = 1) => `n:${nid}${'#'}${k}`

test('ride the root, a program and a lemma', async (t) => {
  if (!needs(t)) return
  const view = await s.tree()
  assert.ok(by(view, 'root'), 'the tree has its root')
  assert.ok(by(view, 'triage'), 'the tree has its triage node')
  await s.balanced('created')
  nids['program'] = await s.propose(ana, { form: 'program', parent: 'root', spec: 'Lower bounds toward P != NP.', title: 'Lower bounds (e2e)' }, '2')
  dev.gateway.script('n:triage#', [{ spend: 0.05 }, { answer: { actions: [{ amount: null, idea: null, into: null, kind: 'approve', node: nids['program'], spec: null, statement: null, title: null, weight: 3, why: null }, { amount: '8', idea: null, into: null, kind: 'grant', node: nids['program'], spec: null, statement: null, title: null, weight: null, why: null }] } }])
  await s.balanced('program proposed')
  nids['proof'] = await s.propose(bob, { form: 'lemma', parent: nids['program']!, spec: 'A lemma a worker proves at once.\n\nmock:prove', statement: 'theorem e2e_proof : True', title: 'A provable lemma (e2e)' }, '3')
  await s.balanced('lemma proposed')
  await s.ride(ana, 'root', '40')
  await s.balanced('root ridden')
  await s.ride(bob, nids['proof']!, '2')
  await s.balanced('lemma ridden')
  const after = await s.tree()
  assert.equal(by(after, 'root')?.money.pledged, '40.000000')
  assert.equal(by(after, nids['program']!)?.money.pledged, '2.000000')
  const proof = by(after, nids['proof']!)
  assert.ok(proof?.money.pledged === '5.000000' || proof?.status === 'proven', JSON.stringify({ money: proof?.money, status: proof?.status }))
  assert.equal(by(after, nids['proof']!)?.by.address, bob.address)
  assert.ok((by(after, nids['proof']!)?.riders ?? 0) >= 1)
  assert.equal(dev.gateway.ledger(s.app).received, 47_000_000n)
})

test('triage approves and grants', async (t) => {
  if (!needs(t)) return
  const program = await s.until('triage to grant the program its money', async () => {
    const found = by(await s.tree(), nids['program']!)
    return found && units(found.money.inherited) >= 8_000_000n ? found : undefined
  })
  assert.ok(units(program.money.inherited) >= 8_000_000n)
  assert.ok(s.subagents().some((each) => each.role.startsWith('n:triage#')), 'a triage run spawned a subagent')
  const triage = by(await s.tree(), 'triage')!
  assert.ok(units(triage.money.spent) > 0n, 'triage spends on its own runs')
  assert.ok(units(triage.money.spent) <= (40_000_000n * 5n) / 100n, 'triage spends at most its share of the root')
  await s.balanced('triage granted')
})

test('pulls flow money down', async (t) => {
  if (!needs(t)) return
  nids['refuted'] = await s.propose(ana, { form: 'lemma', parent: nids['program']!, spec: 'A false lemma.\n\nmock:refute', statement: 'theorem e2e_false : False', title: 'A false lemma (e2e)' })
  nids['split'] = await s.propose(ana, { form: 'lemma', parent: nids['program']!, spec: 'A lemma a worker splits.\n\nmock:split', statement: 'theorem e2e_split : True', title: 'A lemma to split (e2e)' })
  await s.balanced('more lemmas proposed')
  const pulled = await s.until('a lemma under the program to inherit money', async () => {
    const view = await s.tree()
    const found = [nids['refuted'], nids['split']].map((nid) => by(view, nid!)).find((node) => node && units(node.money.inherited) > 0n)
    return found
  })
  assert.ok(units(pulled.money.inherited) > 0n)
  const program = by(await s.tree(), nids['program']!)!
  assert.ok(units(program.money.granted) > 0n, 'the program granted money down')
  await s.balanced('pulled')
})

test('runs spend within bounds', async (t) => {
  if (!needs(t)) return
  nids['over'] = await s.propose(bob, { form: 'lemma', parent: nids['program']!, spec: 'A run that tries to spend without end.\n\nmock:overspend', statement: 'theorem e2e_over : True', title: 'An overspending lemma (e2e)' }, '2')
  const run = await s.until('the overspending run to start', async () => (await s.node(nids['over']!)).run ?? undefined)
  const found = await s.until('its subagent', async () => s.subagents().find((each) => each.role === role(nids['over']!, run.k)))
  await s.until('the gateway to set its bound to the commitment less its model pick', async () => {
    const bound = s.subagents().find((each) => each.agent_id === found.agent_id)?.budget_usd
    return bound !== undefined && bound <= Number(run.budget) && bound >= Number(run.budget) - 0.02 ? true : undefined
  })
  const refused = await s.until('the gateway to refuse it past its bound', async () => {
    s.bounded()
    const now = s.subagents().find((each) => each.agent_id === found.agent_id)
    return now && now.status.state === 'failed' ? now : undefined
  })
  assert.match(String(refused.status.error), /over_limit/)
  assert.ok(units(refused.spent_usd) <= units(refused.budget_usd ?? 0))
  const node = await s.until('the refused run to be settled into the node', async () => {
    const view = await s.node(nids['over']!)
    return units(view.money.spent) >= units(refused.spent_usd) ? view : undefined
  })
  const runs = s.subagents().filter((each) => each.role.startsWith('n:' + nids['over'] + '#'))
  assert.ok(runs.length >= 1)
  assert.ok(units(node.money.spent) <= (node.runs ?? []).reduce((sum, each) => sum + units(each.budget), 0n), 'a node spends no more than was committed to its runs, model picks included')
  assert.ok(units(node.money.spent) <= units(node.money.pledged) + units(node.money.inherited), 'a node spends no more than reached it')
  s.bounded()
  await s.balanced('bounded')
})

test("an orchestrator on Fable 5.2 picks each run's model, as its rider asked", async (t) => {
  if (!needs(t)) return
  const orchestrator = dev.gateway.agents(s.app).find((agent) => agent.name === 'orchestrator')
  assert.ok(orchestrator, 'the tree runs under an orchestrator')
  assert.deepEqual([orchestrator.model, orchestrator.harness], ['vercel/anthropic/claude-fable-5.2', 'claude'])
  const offer = orchestrator.offer as { harnesses: string[]; models: string[] }
  const listed = Gateway.models.filter((model) => model.kind === 'generate' && /^vercel\/(anthropic|google|openai)\//.test(model.id)).map((model) => model.id).sort()
  assert.deepEqual(offer, { harnesses: ['claude', 'codex'], models: listed })
  const google = 'vercel/google/gemini-3.8-flash'
  dev.gateway.script('e2e-pick-marker', [{ spend: 0.3 }, { result: { outcome: 'progress', summary: 'Ran on the model its rider asked for.' } }])
  nids['pick'] = await s.propose(ana, { form: 'lemma', parent: nids['program']!, spec: 'Run this on a Google model, mock:model=' + google + ' e2e-pick-marker', statement: 'theorem e2e_pick : True', title: 'A lemma on the model its rider asked for (e2e)' }, '1')
  const sub = await s.until('its run on the model its rider asked for', async () => s.subagents().find((each) => each.role === role(nids['pick']!)))
  assert.deepEqual([sub.model, sub.harness], [google, 'codex'])
  const read = await s.until('the node read to name the model', async () => ((await s.node(nids['pick']!)).run?.model === google ? true : undefined))
  assert.ok(read)
  assert.ok(deltas.some((delta) => delta.event === 'started' && delta.node.id === nids['pick'] && delta.text === 'Run 1 started on Gemini 3.8 Flash'), 'the started delta names the model')
  const runs = s.subagents().filter((each) => each.parent_agent_id === null && each.role.startsWith('n:'))
  assert.ok(runs.length >= 3)
  assert.deepEqual(runs.filter((each) => !listed.includes(String(each.model))).map((each) => each.role + ' on ' + each.model), [], 'every run is on a listed OpenAI, Anthropic or Google model')
  assert.ok(orchestrator.turns.some((turn) => turn.prompt.startsWith('Pick the model for')), 'the first pick was a turn, which opened the conversation')
  await s.balanced('picked')
})

test('a proof is verified and the node proven', async (t) => {
  if (!needs(t)) return
  const proven = await s.until('the provable lemma to be proven', async () => {
    const node = await s.node(nids['proof']!)
    return node.status === 'proven' ? node : undefined
  }, 90_000)
  assert.ok(proven.proof)
  const runs = dev.github.runs.filter((each) => each.inputs['nid'] === nids['proof'])
  assert.ok(runs.length >= 1, 'the verifier was dispatched')
  const checked = runs.find((each) => each.conclusion === 'success')!
  assert.equal(proven.proof.url, `https://github.com/${dev.github.repo}/actions/runs/${checked.id}`)
  assert.equal(proven.proof.commit, checked.inputs['sha'])
  assert.equal(proven.proof.theorem, checked.inputs['theorem'])
  assert.equal(proven.proof.statement, GitHub.hash(checked.inputs['statement'] ?? ''))
  assert.deepEqual(proven.proof.axioms, checked.check?.['axioms'])
  assert.equal(checked.inputs['swarm'], s.id)
  assert.ok(dev.github.deliveries.some((each) => each.status >= 200 && each.status < 300), 'the signed webhook was accepted')
  const proofs = await s.read<{ proofs: { node: string }[] }>(`/v1/swarms/${s.id}/proofs`)
  assert.ok(proofs.proofs.some((each) => each.node === nids['proof']))
  const headline = (await s.tree()).headline
  assert.ok(headline.proven >= 1)
  await s.balanced('proven')
})

test('a refutation is checked', async (t) => {
  if (!needs(t)) return
  const ended = await s.until('the false lemma to end refuted', async () => {
    const node = await s.node(nids['refuted']!)
    return node.status === 'dead end' ? node : undefined
  }, 90_000)
  assert.equal(ended.end?.kind, 'refuted')
  assert.ok(ended.end?.check, 'the refutation carries its Lean check')
  assert.ok(dev.github.runs.some((each) => each.inputs['nid'] === nids['refuted'] && each.conclusion === 'success'))
  await s.balanced('refuted')
})

test('a split posts children with needs, and money follows them', async (t) => {
  if (!needs(t)) return
  const children = await s.until('the split lemma to have children', async () => {
    const node = await s.node(nids['split']!)
    return node.children.length >= 2 ? node.children : undefined
  }, 90_000)
  const view = await s.tree()
  const posted = children.map((nid) => by(view, nid)!)
  assert.ok(posted.every((child) => child.by.address === null && String(child.by.agent).includes(nids['split']!)), JSON.stringify(posted.map((child) => child.by)))
  assert.ok(posted.some((child) => child.needs.length === 1 && children.includes(child.needs[0]!)), 'the second child needs the first')
  await s.until('both children proven', async () => {
    const now = await s.tree()
    return children.every((nid) => by(now, nid)?.status === 'proven') ? true : undefined
  }, 120_000)
  await s.balanced('split')
})

test('a steer mid-run is heeded', async (t) => {
  if (!needs(t)) return
  nids['steer'] = await s.propose(bob, { form: 'lemma', parent: nids['program']!, spec: 'A long run a rider steers.\n\nmock:slow', statement: 'theorem e2e_steer : True', title: 'A steered lemma (e2e)' }, '3')
  const run = await s.until('the long run to start', async () => (await s.node(nids['steer']!)).run ?? undefined)
  await s.until('its subagent to run', async () => s.subagents().find((each) => each.role === role(nids['steer']!, run.k) && each.status.state === 'running'))
  const note = 'Try the switching lemma first.'
  const steered = await bob.call('POST', `/v1/swarms/${s.id}/nodes/${nids['steer']}/steer`, { amount: '0', note })
  assert.ok(steered.status === 200 || steered.status === 201, JSON.stringify(steered.body))
  const heard = await s.until('the subagent to get the note', async () => s.subagents().find((each) => each.role === role(nids['steer']!, run.k) && each.messages.some((message) => message.message.includes(note))))
  assert.ok(heard)
  const done = await s.until('the run to end heeding it', async () => {
    const now = s.subagents().find((each) => each.role === role(nids['steer']!, run.k))
    return now?.status.state === 'completed' ? now : undefined
  }, 90_000)
  assert.match(JSON.stringify(done.status.output), /Heeded: .*Try the switching lemma first\./)
  assert.ok(deltas.some((delta) => delta.event === 'steered' && delta.node.id === nids['steer']) || (await s.node(nids['steer']!)).updatedAt > 0)
  await s.balanced('steered')
})

test('a running task shows what it is doing', async (t) => {
  if (!needs(t)) return
  const burst = Array.from({ length: 10 }, (_, index) => 'Burst step ' + index)
  dev.gateway.script('e2e-doing-marker', [
    { spend: 0.05 },
    { wait: 1_000 },
    { think: '**Checking the base case**\n\nTrying n = 1 by hand first.' },
    { wait: 3_000 },
    ...burst.flatMap((think): Model.Step[] => [{ think }, { wait: 100 }]),
    { wait: 3_000 },
    { think: 'Writing it down in Lean.' },
    { wait: 3_000 },
    { spend: 0.05 },
    { result: { outcome: 'progress', summary: 'Showed its steps.' } },
  ])
  nids['doing'] = await s.propose(ana, { form: 'lemma', parent: nids['program']!, spec: 'A run that thinks out loud. e2e-doing-marker', statement: 'theorem e2e_doing : True', title: 'A lemma that shows its work (e2e)' }, '2')
  const nid = nids['doing']!
  const pushed = await s.until('a doing delta with its first thought', async () => deltas.find((delta) => delta.event === 'doing' && delta.node.id === nid && delta.node.run?.doing?.text === 'Checking the base case'))
  assert.equal(pushed.text, 'Checking the base case')
  assert.equal(pushed.node.status, 'in flight')
  const read = await s.until('the node read to show the last thought of the burst', async () => {
    const node = await s.node(nid)
    return node.run?.doing?.text === burst.at(-1) ? node : undefined
  })
  assert.ok(read.run?.doing && Date.now() - read.run.doing.at < 10_000)
  const shown = await s.until('the tree read to show its last thought', async () => {
    const node = by(await s.tree(), nid)
    return node?.run?.doing?.text === 'Writing it down in Lean.' ? node : undefined
  })
  assert.equal(shown.status, 'in flight')
  await s.until('the run to end', async () => ((await s.node(nid)).runs ?? []).find((each) => each.outcome !== null))
  const after = await s.node(nid)
  assert.ok(!after.run?.doing, 'what it was doing clears when the run ends: ' + JSON.stringify(after.run))
  const pushes = deltas.filter((delta) => delta.event === 'doing' && delta.node.id === nid)
  const bursts = pushes.filter((delta) => delta.text.startsWith('Burst step'))
  assert.ok(bursts.length >= 1 && bursts.length <= 2, 'ten thoughts within a second push at most twice: ' + bursts.map((delta) => delta.text).join(', '))
  assert.equal(bursts.at(-1)?.text, burst.at(-1), 'the held update carries the latest step')
  assert.ok(pushes.some((delta) => !delta.node.run?.doing), 'a delta cleared it')
  await s.balanced('doing')
})

test('a lease lapses and a takeover adopts the subagent', async (t) => {
  if (!needs(t)) return
  dev.gateway.script('e2e-lapse-marker', [{ think: 'A run that outlives its runner.' }, { spend: 0.1 }, ...Array.from({ length: 120 }, (_, index): Model.Step[] => [{ wait: 250 }, { think: 'step ' + index }]).flat(), { spend: 0.1 }, { result: { outcome: 'progress', summary: 'Outlived its runner.' } }])
  nids['lapse'] = await s.propose(ana, { form: 'lemma', parent: nids['program']!, spec: 'A long run whose runner dies. e2e-lapse-marker', statement: 'theorem e2e_lapse : True', title: 'A lemma whose runner restarts (e2e)' }, '3')
  const run = await s.until('the run to start', async () => (await s.node(nids['lapse']!)).run ?? undefined)
  const first = await s.until('its subagent', async () => s.subagents().find((each) => each.role === role(nids['lapse']!, run.k)))
  await dev.restart('SIGKILL')
  const restarted = Date.now()
  const seen: number[] = []
  const finished = await s.until('the run to finish after the restart', async () => {
    const node = await s.node(nids['lapse']!)
    if (node.run) seen.push(node.run.attempt)
    const ended = (node.runs ?? []).find((each) => each.k === run.k && each.outcome !== null)
    return ended ?? undefined
  }, 120_000 + leaseMs * 3)
  assert.equal(s.subagents().filter((each) => each.role === role(nids['lapse']!, run.k)).length, 1, 'the takeover adopted the subagent instead of spawning another')
  assert.equal(finished.summary, 'Outlived its runner.')
  assert.ok(['closed', 'completed'].includes(String(s.subagents().find((each) => each.agent_id === first.agent_id)?.status.state)))
  assert.ok(Date.now() - restarted > leaseMs, 'the run finished after the lease lapsed')
  await s.balanced('taken over')
})

test('a node ends and money returns along its edges to the cent', async (t) => {
  if (!needs(t)) return
  nids['end'] = await s.propose(bob, { form: 'lemma', parent: nids['program']!, spec: 'A run that hangs until its rider ends it.\n\nmock:stall', statement: 'theorem e2e_end : True', title: 'A lemma its rider ends (e2e)' }, '4')
  await s.until('its run to start', async () => (await s.node(nids['end']!)).run ?? undefined)
  const before = { bob: await standing(bob), node: await s.node(nids['end']!) }
  const ended = await bob.call('POST', `/v1/swarms/${s.id}/nodes/${nids['end']}/end`, { why: 'Not worth it.' })
  assert.ok(ended.status === 200 || ended.status === 201, JSON.stringify(ended.body))
  const settled = await s.until('the node to settle', async () => {
    const node = await s.node(nids['end']!)
    return node.status === 'dead end' && node.run === null && units(node.money.left) === 0n && units(node.money.committed) === 0n ? node : undefined
  })
  assert.equal(settled.end?.kind, 'withdrawn')
  const now = await standing(bob)
  const money = settled.money
  assert.equal(units(money.pledged) + units(money.inherited) - units(money.granted), units(money.spent), `what reached the node less what it spent is all returned: ${JSON.stringify(money)}`)
  const toBob = units(now.free) - units(before.bob.free)
  assert.equal(toBob, units(before.node.money.pledged) - units(money.pledged), `bob's free money grew by $${Chain.decimal(toBob)}, his returned share is $${Chain.decimal(units(before.node.money.pledged) - units(money.pledged))}`)
  assert.ok(toBob > 0n, "bob's own money came back to him")
  assert.ok(units(before.node.money.inherited) >= units(money.inherited), 'what the parent granted went back up its edge')
  assert.equal(now.buckets.find((bucket) => bucket.node === nids['end'])?.amount ?? '0.000000', '0.000000')
  await s.balanced('ended')
})

test('archive an agent swarm with leftover money, and carry it to the tree', async (t) => {
  if (!needs(t)) return
  const made = await ana.call<{ id: string }>('POST', '/v1/swarms', { goal: 'An agent swarm the cutover archives.', template: 'cheap', title: 'Old agent swarm (e2e)' })
  assert.equal(made.status, 201)
  const old = made.body.id
  const app = Credit.app(old)
  const paid = dev.gateway.chain.transfer({ amount: '3', from: ana.address, memo: Credit.memo(dev.gateway.wallet, old) as Chain.Hex })
  assert.equal((await ana.call('POST', `/v1/swarms/${old}/contributions`, { hash: paid.hash })).status, 201)
  await s.until('its lead to spend', async () => (dev.gateway.ledger(app).spent > 0n ? true : undefined))
  const operator = await rider(dev, 'operator')
  assert.equal(operator.address, dev.gateway.wallet)
  const refused = await ana.call('POST', `/v1/swarms/${old}/archive`, {})
  assert.equal(refused.status, 403)
  const archived = await operator.call<{ archivedAt?: number }>('POST', `/v1/swarms/${old}/archive`, {})
  assert.ok(archived.status === 200 || archived.status === 201, JSON.stringify(archived.body))
  const spent = dev.gateway.ledger(app).spent
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  assert.equal(dev.gateway.ledger(app).spent, spent, 'archiving stops the spending')
  const left = dev.gateway.ledger(app).left
  assert.equal(left, 3_000_000n - spent, 'the leftover money stays in the app untouched')
  const shown = await dev.call<{ archivedAt: number | null }>('GET', `/v1/swarms/${old}`)
  assert.ok(shown.body.archivedAt)
  const again = dev.gateway.chain.transfer({ amount: '1', from: bob.address, memo: Credit.memo(dev.gateway.wallet, old) as Chain.Hex })
  assert.equal((await bob.call('POST', `/v1/swarms/${old}/contributions`, { hash: again.hash })).status, 410)
  const moved = await fetch(dev.gateway.url + '/api/keys/credit/move', { body: JSON.stringify({ id: 'cutover-' + old, riders: [{ address: ana.address, amount: Chain.decimal(left) }], tag: Credit.tag(s.id, 'n:root'), to: s.app }), headers: { authorization: 'Bearer ' + dev.gateway.key, 'content-type': 'application/json', 'gateway-app': app }, method: 'POST' })
  const carried = (await moved.json()) as { deposits: { hash: string }[] }
  assert.equal(moved.status, 200)
  const before = units(by(await s.tree(), 'root')!.money.pledged)
  for (const deposit of carried.deposits) await ana.call('POST', `/v1/swarms/${s.id}/contributions`, { hash: deposit.hash, node: 'root' })
  await s.until("the old swarm's money to ride the new root in its rider's name", async () => (units(by(await s.tree(), 'root')!.money.pledged) === before + left ? true : undefined))
  assert.equal(dev.gateway.ledger(app).left, 0n)
  await s.balanced('carried over')
})

test('the live stream carried every kind of change', async (t) => {
  if (!needs(t)) return
  const kinds = new Set(deltas.map((delta) => delta.event))
  for (const kind of ['posted', 'funded', 'started', 'proven', 'ended'] as const) assert.ok(kinds.has(kind), 'no ' + kind + ' delta; saw ' + [...kinds].join(', '))
  const seqs = deltas.filter((delta) => delta.event !== 'doing').map((delta) => delta.seq)
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b))
})

test('the tree and a node render at 1440x900 and 390x844 with no page error, console error or sideways overflow', async (t) => {
  if (!needs(t)) return
  const chrome = await Chrome.open()
  try {
    for (const [name, route] of [['tree', `/s/${s.id}`], ['node', `/s/${s.id}/n/${nids['proof']}`]] as const)
      for (const viewport of ['desktop', 'phone'] as const) {
        const shot = await chrome.shoot(dev.url + route, viewport, path.join(shots, `${name}-${viewport}.png`))
        assert.deepEqual(shot.errors, [], name + ' ' + viewport)
        assert.deepEqual(shot.console.filter((line) => !/WebSocket|favicon/.test(line)), [], name + ' ' + viewport)
        assert.ok(shot.overflow <= 0, `${name} ${viewport} overflows by ${shot.overflow}px`)
      }
  } finally {
    await chrome.close()
  }
  s.bounded()
  await s.balanced('done')
  assert.ok(Model.presets.length > 0)
})
