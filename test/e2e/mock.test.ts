import * as assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'node:http'
import * as Chain from '../mock/chain.ts'
import * as Mock from '../mock/gateway.ts'
import * as GitHub from '../mock/github.ts'
import { Credit, Gateway, env, eventually, frames } from './worker.ts'

let gateway: Mock.Gateway
let world: Cloudflare.Env
const rider = Chain.address('ana')
const other = Chain.address('ben')

before(async () => {
  gateway = await Mock.start()
  world = env(gateway)
})

after(() => gateway.close())

async function ride(swarm: string, amount: string, from = rider, note?: string) {
  const memo = Credit.memo(gateway.wallet, swarm, note) as Chain.Hex
  return gateway.chain.transfer({ amount, from, memo })
}

function invariant(swarm: string) {
  const ledger = gateway.ledger(Gateway.app(swarm))
  assert.equal(ledger.left, ledger.received - ledger.refunded - ledger.movedOut - ledger.spent)
  assert.ok(ledger.left >= 0n)
  return ledger
}

async function subagent(swarm: string, agent: string, role: string) {
  return eventually(async () => {
    const listed = await Gateway.subagents(world, swarm, agent)
    return listed.ok ? listed.value.find((each) => each.role === role) : undefined
  })
}

async function ended(swarm: string, agent: string, role: string) {
  return eventually(async () => {
    const listed = await Gateway.subagents(world, swarm, agent)
    const found = listed.ok ? listed.value.find((each) => each.role === role) : undefined
    return found && ['completed', 'failed', 'closed', 'interrupted'].includes(found.status.state) ? found : undefined
  })
}

test('a transfer counts once by hash, to the app its memo names, with the tag that names the node', async () => {
  const transfer = await ride('s1', '10', rider, 'n:abc')
  const counted = await Gateway.credited(world, 's1', transfer.hash)
  assert.ok(counted.ok)
  assert.equal(counted.value.created, true)
  assert.equal(counted.value.deposits[0]?.tag, Credit.tag('s1', 'n:abc'))
  assert.deepEqual(counted.value.credit, { deposited: '10.000000', left: '10.000000', spent: '0.000000' })
  const again = await Gateway.credited(world, 's1', transfer.hash)
  assert.ok(again.ok && again.value.created === false)
  const elsewhere = await Gateway.credited(world, 's2', transfer.hash)
  assert.deepEqual([elsewhere.ok, !elsewhere.ok && elsewhere.status], [false, 400])
  const missing = await Gateway.credited(world, 's1', '0x' + 'f'.repeat(64))
  assert.deepEqual([missing.ok, !missing.ok && missing.status], [false, 404])
  const listed = await Gateway.deposits(world, 's1')
  assert.ok(listed.ok)
  assert.deepEqual(listed.value.deposits.map((each) => [each.hash, each.amount, each.from]), [[transfer.hash, '10.000000', rider]])
  invariant('s1')
})

test('the dispatcher spawns exactly the subagent its prompt gives, streams its events and reports the turn', async () => {
  await Gateway.credited(world, 'd1', (await ride('d1', '20')).hash)
  const made = await Gateway.agent(world, 'd1', { instructions: 'Call spawn_agent once with exactly the arguments given, then end the turn.', name: 'dispatcher' })
  assert.ok(made.ok)
  const agent = made.value.id
  const stream = await Gateway.stream(world, 'd1', agent, 0, AbortSignal.timeout(10_000))
  const prompt = 'spawn_agent ' + JSON.stringify({ budget_usd: 5, role: 'n:aaaa000001#1', task: 'Prove the lemma. mock:prove' })
  const turned = await Gateway.prompt(world, 'd1', agent, { id: 'claim-1', prompt, steer: false })
  assert.deepEqual(turned, { ok: true, value: { request_id: 'claim-1', status: 'queued' } })
  const again = await Gateway.prompt(world, 'd1', agent, { id: 'claim-1', prompt, steer: false })
  assert.ok(again.ok && again.value.request_id === 'claim-1')
  const seen = await frames(stream, (frame) => {
    const update = (frame.data['event'] as { update?: { type?: string } } | undefined)?.update
    return update?.type === 'completion'
  })
  const types = seen.filter((frame) => !frame.live).map((frame) => (frame.data['event'] as { update?: { type?: string }; type?: string; source?: string }).update?.type ?? (frame.data['event'] as { type?: string }).type ?? 'session')
  assert.ok(types.includes('added') && types.includes('completion') && types.includes('result'))
  assert.ok(seen.some((frame) => frame.live))
  const seqs = seen.filter((frame) => !frame.live).map((frame) => Number(frame.data['seq']))
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b))
  const found = await ended('d1', agent, 'n:aaaa000001#1')
  assert.equal(found.status.state, 'completed')
  assert.equal(found.budget_usd, 5)
  assert.ok(found.spent_usd! > 0 && found.spent_usd! <= 5)
  assert.equal(JSON.parse(found.result!).outcome, 'proved')
  const listed = await Gateway.subagents(world, 'd1', agent)
  assert.ok(listed.ok)
  assert.equal(listed.value.filter((each) => each.role === 'n:aaaa000001#1').length, 1)
  const report = await Gateway.turn(world, 'd1', agent, 'claim-1')
  assert.ok(report.ok && report.value.status === 'completed')
  const page = await Gateway.events(world, 'd1', agent, 0)
  assert.ok(page.ok && page.value.events.length === seqs.length)
  invariant('d1')
})

test('a subagent spawned by API spends within its bound: past it the gateway answers over_limit, and the bound is the nearest tight ancestor', async () => {
  await Gateway.credited(world, 'b1', (await ride('b1', '50')).hash)
  const made = await Gateway.agent(world, 'b1', { instructions: 'x', name: 'dispatcher' })
  assert.ok(made.ok)
  const agent = made.value.id
  const spawn = (body: Record<string, unknown>) =>
    fetch(gateway.url + '/v1/agents/' + agent + '/subagents', { body: JSON.stringify(body), headers: { authorization: 'Bearer ' + gateway.key, 'content-type': 'application/json', 'gateway-app': 'swarm-b1' }, method: 'POST' }).then((response) => response.json() as Promise<{ agent: { agent_id: number }; created: boolean }>)
  const first = await spawn({ budget_usd: 2, role: 'n:over#1', task: 'Spend it all. mock:overspend' })
  assert.equal(first.created, true)
  const repeat = await spawn({ budget_usd: 2, role: 'n:over#1', task: 'Spend it all. mock:overspend' })
  assert.deepEqual([repeat.created, repeat.agent.agent_id], [false, first.agent.agent_id])
  const over = await ended('b1', agent, 'n:over#1')
  assert.equal(over.status.state, 'failed')
  assert.match(over.status.error ?? '', /over_limit/)
  assert.equal(over.spent_usd, 2)

  gateway.script('n:nest#1', [{ join: true, spawn: { budget_usd: 5, role: 'n:nest#1/helper', steps: [{ overspend: 0.25 }], task: 'Help.' } }, { result: { outcome: 'progress', summary: 'Helped.' } }])
  await spawn({ budget_usd: 1, role: 'n:nest#1', task: 'Use a helper.' })
  const helper = await ended('b1', agent, 'n:nest#1/helper')
  assert.match(helper.status.error ?? '', /subagent \d+'s budget of \$1\.000000/)
  assert.equal(helper.spent_usd, 1)
  assert.equal(helper.parent_agent_id, (await subagent('b1', agent, 'n:nest#1')).agent_id)
  const parent = await ended('b1', agent, 'n:nest#1')
  assert.equal(parent.spent_usd, 1)

  gateway.script('n:held#1', [
    { spawn: { role: 'n:held#1/a', steps: [{ calls: 1, ms: 400, spend: 0.2 }, { result: { outcome: 'progress', summary: 'a' } }], task: 'a' } },
    { wait: 50 },
    { join: true, spawn: { role: 'n:held#1/b', steps: [{ calls: 1, ms: 10, spend: 0.2 }, { result: { outcome: 'progress', summary: 'b' } }], task: 'b' } },
    { result: { outcome: 'progress', summary: 'held' } },
  ])
  const held = await spawn({ budget_usd: 0.3, role: 'n:held#1', task: 'Two at once.' })
  const b = await ended('b1', agent, 'n:held#1/b')
  assert.equal(b.status.state, 'failed')
  const events: { event?: { update?: unknown } }[] = []
  for (let after = 0; ; ) {
    const page = await Gateway.events(world, 'b1', agent, after)
    assert.ok(page.ok)
    events.push(...page.value.events)
    after = page.value.next_cursor
    if (!page.value.has_more) break
  }
  const failures = events.flatMap((event) => {
    const update = event.event?.update as { event?: { payload?: { error?: string }; type?: string }; id?: number } | undefined
    return update?.event?.type === 'model.call.failed' && update.id === b.agent_id ? [update.event.payload?.error ?? ''] : []
  })
  assert.ok(failures.some((error) => /held by requests in flight/.test(error)), JSON.stringify(failures))
  assert.match(failures.at(-1) ?? '', /has \$0\.200000 spent/)
  const top = await ended('b1', agent, 'n:held#1')
  assert.ok(top.spent_usd! <= 0.3)
  assert.equal(top.agent_id, held.agent.agent_id)

  const raised = await Gateway.budget(world, 'b1', agent, first.agent.agent_id, 3)
  assert.ok(raised.ok && raised.value.agent.budget_usd === 3)
  const bad = await Gateway.budget(world, 'b1', agent, first.agent.agent_id, -1)
  assert.deepEqual([bad.ok, !bad.ok && bad.status], [false, 400])
  const ledger = invariant('b1')
  assert.equal(ledger.spent, [...Object.values(gateway.view('swarm-b1').bySubagent)].reduce((sum, each) => sum + Chain.units(each), 0n))
})

test('an app with no credit left refuses the call with the words Swarms reads as unpaid', async () => {
  const made = await Gateway.agent(world, 'poor', { instructions: 'x', name: 'dispatcher' })
  assert.ok(made.ok)
  const turned = await Gateway.prompt(world, 'poor', made.value.id, { prompt: 'hello', steer: false })
  assert.ok(turned.ok)
  const report = await eventually(async () => {
    const found = await Gateway.turn(world, 'poor', made.value.id, turned.value.request_id)
    return found.ok && found.value.status === 'failed' ? found.value : undefined
  })
  assert.match(String((report.error as { message: string }).message), /This app's credit has \$0\.000000 left/)
})

test('a message reaches a running subagent and its result says it heeded it; close, side questions and interrupt answer', async () => {
  await Gateway.credited(world, 'm1', (await ride('m1', '20')).hash)
  const made = await Gateway.agent(world, 'm1', { instructions: 'x', name: 'dispatcher' })
  assert.ok(made.ok)
  const agent = made.value.id
  gateway.script('n:steer#1', [{ think: 'start' }, { wait: 300 }, { spend: 0.1 }, { result: { outcome: 'progress', summary: 'Worked.' } }])
  await Gateway.prompt(world, 'm1', agent, { prompt: JSON.stringify({ role: 'n:steer#1', task: 'Work.' }), steer: false })
  const running = await subagent('m1', agent, 'n:steer#1')
  const told = await Gateway.tell(world, 'm1', agent, running.agent_id, '[$4 behind this, from @ana] Try the switching lemma first.', 'urgent')
  assert.ok(told.ok)
  const done = await ended('m1', agent, 'n:steer#1')
  assert.match(JSON.parse(done.result!).summary, /Heeded: \[\$4 behind this, from @ana\] Try the switching lemma first\./)
  const late = await Gateway.tell(world, 'm1', agent, running.agent_id, 'too late')
  assert.deepEqual([late.ok, !late.ok && late.status], [false, 409])
  gateway.script('n:long#1', [{ stall: 60_000 }])
  await Gateway.prompt(world, 'm1', agent, { prompt: JSON.stringify({ role: 'n:long#1', task: 'Wait.' }), steer: false })
  const long = await subagent('m1', agent, 'n:long#1')
  const asked = await Gateway.ask(world, 'm1', agent, long.agent_id, 'where are you?')
  assert.ok(asked.ok && asked.value.text.includes('where are you?'))
  const closed = await Gateway.close(world, 'm1', agent, long.agent_id)
  assert.ok(closed.ok)
  assert.equal((await ended('m1', agent, 'n:long#1')).status.state, 'closed')
  const side = await Gateway.side(world, 'm1', agent, 'status?')
  assert.ok(side.ok)
  invariant('m1')
})

test('a refund pays the rider back from the recipient wallet at most what they put in, once per id, and a move carries riders to another app', async () => {
  await Gateway.credited(world, 'r1', (await ride('r1', '6', rider)).hash)
  await Gateway.credited(world, 'r1', (await ride('r1', '4', other)).hash)
  const call = (path: string, body: unknown, app: string) =>
    fetch(gateway.url + path, { body: JSON.stringify(body), headers: { authorization: 'Bearer ' + gateway.key, 'content-type': 'application/json', 'gateway-app': app }, method: 'POST' }).then(async (response) => ({ body: (await response.json()) as Record<string, unknown>, status: response.status }))
  const before = gateway.chain.count()
  const refunded = await call('/api/keys/credit/refund', { amount: '2.5', app: 'swarm-r1', id: 'refund-1', to: rider }, 'swarm-r1')
  assert.equal(refunded.status, 200)
  const repeated = await call('/api/keys/credit/refund', { amount: '2.5', app: 'swarm-r1', id: 'refund-1', to: rider }, 'swarm-r1')
  assert.deepEqual(repeated.body, refunded.body)
  assert.equal(gateway.chain.count(), before + 1)
  assert.equal(gateway.chain.total({ from: Chain.recipient, to: rider }), 2_500_000n)
  const greedy = await call('/api/keys/credit/refund', { amount: '4', app: 'swarm-r1', id: 'refund-2', to: rider }, 'swarm-r1')
  assert.equal(greedy.status, 409)
  assert.equal(invariant('r1').left, 7_500_000n)
  const moved = await call('/api/keys/credit/move', { id: 'move-1', riders: [{ address: rider, amount: '3.5' }, { address: other, amount: '4' }], tag: Credit.tag('r2'), to: 'swarm-r2' }, 'swarm-r1')
  assert.equal(moved.status, 200)
  const twice = await call('/api/keys/credit/move', { id: 'move-1', riders: [{ address: rider, amount: '3.5' }, { address: other, amount: '4' }], to: 'swarm-r2' }, 'swarm-r1')
  assert.deepEqual(twice.body, moved.body)
  assert.equal(invariant('r1').left, 0n)
  assert.equal(invariant('r2').left, 7_500_000n)
  const deposits = await Gateway.deposits(world, 'r2')
  assert.ok(deposits.ok)
  assert.deepEqual(deposits.value.deposits.map((each) => [each.from, each.amount, each.tag]), [[rider, '3.500000', Credit.tag('r2')], [other, '4.000000', Credit.tag('r2')]])
  const short = await call('/api/keys/credit/move', { id: 'move-2', riders: [{ address: rider, amount: '1' }], to: 'swarm-r2' }, 'swarm-r1')
  assert.equal(short.status, 402)
})

test('the rest of the surface Swarms reads answers: models, key, backings, stores, compute, hands, teams', async () => {
  const prices = await Gateway.prices(world)
  assert.ok(prices?.has('vercel/deepseek/deepseek-v4.1-flash-1017'))
  assert.ok(!prices?.has('boundless/z-ai/glm-5.3-flash'))
  assert.ok((await Gateway.me(world)).ok)
  assert.deepEqual(await Gateway.backings(world, 'x1'), { ok: true, value: { backings: [], left: '0.000000', spent: '0.000000' } })
  for (const [kind, key] of [['kv', 'artifacts/a'], ['bucket', 'artifacts/b'], ['git', 'proofs']] as const)
    await fetch(gateway.url + '/mock/store', { body: JSON.stringify({ app: 'swarm-x1', key, kind }), method: 'POST' })
  await fetch(gateway.url + '/mock/store', { body: JSON.stringify({ app: 'swarm-x1', key: 'sbx_1', kind: 'sandbox', text: 'lake build ok' }), method: 'POST' })
  const values = await Gateway.values(world, 'x1', null)
  assert.ok(values.ok && values.value.entries[0]?.key === 'artifacts/a' && values.value.entries[0].public === false)
  assert.ok((await Gateway.reveal(world, 'x1', 'kv', 'artifacts/a')).ok)
  assert.ok((await Gateway.reveal(world, 'x1', 'git', 'proofs')).ok)
  const repos = await Gateway.repos(world, 'x1')
  assert.ok(repos.ok && repos.value.repos[0]?.public === true)
  assert.ok((await Gateway.objects(world, 'x1', null)).ok)
  const boxes = await Gateway.sandboxes(world, 'x1')
  assert.ok(boxes.ok && boxes.value.sandboxes[0]?.sandboxId === 'sbx_1')
  const logged = await Gateway.output(world, 'x1', 'sbx_1', { limit: 10 })
  assert.ok(logged.ok && logged.value.entries[0]?.text === 'lake build ok')
  assert.ok((await Gateway.terminate(world, 'x1', 'sbx_1')).ok)
  assert.ok((await Gateway.hands(world, 'x1')).ok)
  assert.ok((await Gateway.hand(world, 'x1', 'h1')).ok)
  assert.ok((await Gateway.team(world, 't')).ok)
  const denied = await Gateway.me({ ...world, SWARMS_GATEWAY_KEY: 'wrong' } as Cloudflare.Env)
  assert.deepEqual([denied.ok, !denied.ok && denied.status], [false, 401])
})

test('the mock GitHub runs the verify workflow, signs its webhook and serves check.json, and fails a proof that uses sorry', async () => {
  const heard: { body: string; signature: string }[] = []
  const hook = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      heard.push({ body, signature: String(request.headers['x-hub-signature-256']) })
      response.end('ok')
    })
  })
  await new Promise<void>((resolve) => hook.listen(0, '127.0.0.1', resolve))
  const address = hook.address()
  const github = await GitHub.start({ delayMs: 50, hook: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1/hooks/github` })
  try {
    const call = (method: string, path: string, body?: unknown) =>
      fetch(github.url + path, { ...(body ? { body: JSON.stringify(body) } : {}), headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + github.token }, method })
    const sha = 'a'.repeat(40)
    assert.equal((await call('POST', '/repos/gakonst/swarms-proofs/git/refs', { ref: 'refs/heads/verify/abc/' + sha, sha })).status, 201)
    const inputs = { claim: 'proof', nid: 'abc', problem: 'pnp', sha, source: 'gateway', statement: 'theorem x : 1 + 1 = 2', swarm: 's1', theorem: 'Pnp.Nabc' }
    assert.equal((await call('POST', '/repos/gakonst/swarms-proofs/actions/workflows/verify.yml/dispatches', { inputs, ref: 'main' })).status, 204)
    assert.equal((await call('POST', '/repos/gakonst/swarms-proofs/actions/workflows/verify.yml/dispatches', { inputs: { ...inputs, nid: 'bad', theorem: 'Pnp.Nbad', statement: 'sorry' }, ref: 'main' })).status, 204)
    await eventually(() => (heard.length === 2 ? true : undefined))
    const [good, bad] = heard.map((each) => ({ ...each, parsed: JSON.parse(each.body) as { workflow_run: { conclusion: string; display_title: string; id: number; path: string } } }))
    for (const each of [good!, bad!]) assert.equal(each.signature, GitHub.sign(github.secret, each.body))
    assert.equal(good!.parsed.workflow_run.conclusion, 'success')
    assert.equal(good!.parsed.workflow_run.display_title, 'verify s1 abc ' + sha)
    assert.equal(good!.parsed.workflow_run.path, '.github/workflows/verify.yml')
    assert.equal(bad!.parsed.workflow_run.conclusion, 'failure')
    const listed = (await (await call('GET', `/repos/gakonst/swarms-proofs/actions/runs/${good!.parsed.workflow_run.id}/artifacts`)).json()) as { artifacts: { archive_download_url: string; name: string }[] }
    assert.equal(listed.artifacts[0]?.name, 'check')
    const archive = Buffer.from(await (await fetch(listed.artifacts[0]!.archive_download_url, { headers: { authorization: 'Bearer ' + github.token } })).arrayBuffer())
    const check = JSON.parse(GitHub.unzip(archive)['check.json']!) as Record<string, unknown>
    assert.deepEqual([check['version'], check['ok'], check['swarm'], check['commit'], check['theorem'], check['statement'], check['exitCode'], check['axioms'], check['error']], [1, true, 's1', sha, 'Pnp.Nabc', GitHub.hash(inputs.statement), 0, GitHub.axioms, null])
    const failed = (await (await call('GET', `/repos/gakonst/swarms-proofs/actions/runs/${bad!.parsed.workflow_run.id}/artifacts`)).json()) as { artifacts: { archive_download_url: string }[] }
    const files = GitHub.unzip(Buffer.from(await (await fetch(failed.artifacts[0]!.archive_download_url, { headers: { authorization: 'Bearer ' + github.token } })).arrayBuffer()))
    const refused = JSON.parse(files['check.json']!) as Record<string, unknown>
    assert.deepEqual([refused['ok'], refused['exitCode'], refused['error']], [false, 5, 'axioms outside the allowlist: [sorryAx]'])
    assert.match(files['check.tail']!, /sorryAx/)
    assert.match(await (await call('GET', `/repos/gakonst/swarms-proofs/actions/runs/${bad!.parsed.workflow_run.id}/logs`)).text(), /sorryAx/)
    assert.equal((await fetch(github.url + '/repos/gakonst/swarms-proofs/actions/runs/1')).status, 401)
  } finally {
    await github.close()
    hook.close()
  }
})
