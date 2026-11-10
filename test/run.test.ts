import assert from 'node:assert/strict'
import test from 'node:test'
import { id, rider, world } from './run.ts'

const error = () => Response.json({ error: 'upstream hiccup' }, { status: 503 })

const prompts = (calls: string[]) => calls.filter((call) => call === 'POST /v1/agents/agt_1/turns').length

test('a gateway call that throws is retried as an answer that failed: one error row, and the money is checked again before the next prompt', async (t) => {
  let credit = '1'
  const w = world((request, url) => {
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '1', left: credit, spent: '0' })
    if (url.pathname === '/v1/agents/agt_1/turns' && request.method === 'POST') throw new TypeError('Network connection lost.')
    return undefined
  })
  t.after(w.restore)
  await w.seed()
  await w.swarm.wake('money')
  for (let alarm = 0; alarm < 6; alarm++) {
    if (alarm === 2) credit = '0'
    await w.ring()
    w.pass(30_000)
  }
  assert.deepEqual(w.errors(), ['The gateway did not take the next message for the agent.'])
  assert.equal(prompts(w.calls), 2)
  const run = w.swarm.run()
  assert.deepEqual([run.state, run.state === 'paused' && run.pause.why], ['paused', 'money'])
  assert.deepEqual(await w.status(), { status: 'funding', why: 'money' })
})

test('a step that keeps throwing logs one error row in ten minutes and never stays in starting, where the money check is skipped', async (t) => {
  let credit = '1'
  const w = world((_request, url) => (url.pathname === '/api/keys/credit' ? Response.json({ deposited: '1', left: credit, spent: '0' }) : undefined))
  t.after(w.restore)
  await w.seed()
  const prepare = w.env.DB.prepare
  w.env.DB.prepare = (query: string) => {
    if (query.startsWith('update swarms set status')) throw new Error('D1_ERROR: Network connection lost.')
    return prepare(query)
  }
  t.after(() => void (w.env.DB.prepare = prepare))
  await w.swarm.wake('money')
  for (let alarm = 0; alarm < 4; alarm++) {
    await w.ring()
    assert.equal(w.swarm.run().state, 'waiting')
    w.pass(30_000)
  }
  assert.deepEqual(w.errors(), ['The swarm hit an error and will retry.'])
  w.pass(600_000)
  await w.ring()
  assert.equal(w.errors().length, 2)
  credit = '0'
  await w.ring()
  assert.equal(w.swarm.run().state, 'paused')
  assert.equal(w.errors().length, 2)
  assert.equal(prompts(w.calls), 0)
})

test('an agent is abandoned only after fifteen minutes in which the gateway never answered, not after two failures fifteen minutes apart', async (t) => {
  let failing = false
  const w = world((_request, url) => (failing && url.pathname === '/v1/agents/agt_1/turns/agt_1:1' ? error() : undefined))
  t.after(w.restore)
  await w.seed()
  await w.swarm.wake('money')
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
  const check = async (minutes: number, down: boolean) => {
    w.pass(minutes * 60_000)
    w.swarm.checked = 0
    failing = down
    await w.ring()
  }
  await check(1, true)
  assert.notEqual(w.swarm.agent()?.unreachable, null)
  await check(5, false)
  assert.equal(w.swarm.agent()?.unreachable, null)
  await check(11, true)
  assert.deepEqual([w.swarm.run().state, w.swarm.agent()?.id], ['working', 'agt_1'])
  assert.deepEqual(w.errors(), [])

  await check(16, true)
  assert.deepEqual([w.swarm.run().state, w.swarm.agent()], ['waiting', undefined])
  assert.ok(w.calls.includes('POST /v1/agents/agt_1/turns/agt_1:1/cancel'))
  assert.ok(w.errors().some((text) => /stopped answering for 15 minutes/.test(text)))
})

test('a swarm with money whose agent the gateway fails to create is retrying, not out of money', async (t) => {
  let credit = '0.01'
  const w = world((request, url) => {
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: credit, left: credit, spent: '0' })
    if (url.pathname === '/v1/agents' && request.method === 'POST') return error()
    return undefined
  })
  t.after(w.restore)
  await w.seed('10000')
  w.sql.exec("INSERT INTO turns (n, turn, started_at, ended_at, status, spent_before) VALUES (1, 'agt_0:1', 1, 2, 'completed', '0')")
  await w.swarm.wake('money')
  await w.ring()
  assert.deepEqual(await w.status(), { status: 'paused', why: 'money' })

  credit = '10.01'
  await w.give('10000000', '0x' + 'd'.repeat(64))
  await w.swarm.contributed({ amount: '10', contributor: rider, hash: '0x' + 'd'.repeat(64), kind: 'new', note: null, noteId: null, swarm: id, token: 'pathusd' })
  await w.ring()
  w.pass(30_000)
  await w.ring()
  assert.deepEqual(await w.status(), { status: 'running', why: null })
  assert.equal(w.swarm.view({ feed: 0 }).reason, null)
  assert.deepEqual(w.errors(), ['The gateway did not create the agent.'])
})

test('a status write that failed is written again on the next step, so the list never keeps saying running for a paused swarm', async (t) => {
  let credit = '1'
  let report = { request_id: 'agt_1:1', status: 'running' } as Record<string, unknown>
  const w = world((_request, url) => {
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '1', left: credit, spent: '0' })
    if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json(report)
    return undefined
  })
  t.after(w.restore)
  await w.seed()
  await w.swarm.wake('money')
  await w.ring()
  assert.deepEqual(await w.status(), { status: 'running', why: null })

  const prepare = w.env.DB.prepare
  let failures = 1
  w.env.DB.prepare = (query: string) => {
    if (failures && query.startsWith('update swarms set status')) {
      failures -= 1
      throw new Error('D1_ERROR: Network connection lost.')
    }
    return prepare(query)
  }
  credit = '0.01'
  report = { ok: { message: 'done a step' }, request_id: 'agt_1:1', status: 'completed' }
  w.swarm.checked = 0
  await w.ring()
  w.pass(30_000)
  await w.ring()
  assert.equal(w.swarm.run().state, 'paused')
  assert.equal(failures, 0)
  assert.deepEqual(await w.status(), { status: 'running', why: null })

  w.pass(30_000)
  await w.ring()
  assert.deepEqual(await w.status(), { status: 'paused', why: 'money' })
})

test('a pause settles once even when the gateway no longer has the agent or a subagent never stops, instead of asking every minute forever', async (t) => {
  const paused = async (subagents: () => Response) => {
    const w = world((_request, url) => {
      if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '1', left: '0.01', spent: '0.99' })
      if (url.pathname === '/v1/agents/agt_gone/subagents') return subagents()
      return undefined
    })
    t.after(w.restore)
    await w.seed()
    w.swarm.kv.put('agent', { briefed: true, cursor: 0, id: 'agt_gone', instructed: true, unreachable: null, url: 'backers' })
    w.swarm.kv.put('run', { at: Date.now() - 60_000, pause: { left: '10000', needs: '50000', wake: null, why: 'money' }, state: 'paused' })
    let alarms = 0
    for (let next: number | null = Date.now(); next !== null && alarms < 30; next = w.alarm()) {
      await w.ring()
      w.pass(60_000)
      alarms += 1
    }
    const run = w.swarm.run()
    assert.ok(run.state === 'paused' && run.settled !== undefined)
    assert.equal(w.calls.filter((call) => call === 'GET /api/keys/credit').length, 1)
    return alarms
  }

  assert.equal(await paused(() => Response.json({ error: 'No agent has this id.' }, { status: 404 })), 1)
  assert.equal(await paused(() => Response.json({ agents: [{ agent_id: 2, parent_agent_id: null, role: 'r', status: { state: 'running' }, task: 't' }] })), 10)
})

test('money whose wake was lost still starts the swarm: when the transfer is recorded again, and when the swarm is next viewed', async (t) => {
  const recorded = world(() => undefined)
  t.after(recorded.restore)
  await recorded.seed()
  recorded.swarm.kv.delete('id')
  await recorded.viewed()
  assert.deepEqual([recorded.swarm.run().state, recorded.alarm()], ['new', null])
  await recorded.swarm.funded(id)
  await recorded.ring()
  assert.equal(recorded.swarm.run().state, 'working')

  const viewed = world(() => undefined)
  t.after(viewed.restore)
  await viewed.seed()
  await viewed.viewed()
  await viewed.ring()
  assert.equal(viewed.swarm.run().state, 'working')
})

test('a paused swarm looks at its money again when a counted transfer is recorded again or it is viewed ten minutes later, and goes on only when the money is there', async (t) => {
  const paused = async (pause: Record<string, unknown>) => {
    let credit = '0.01'
    const w = world((_request, url) => (url.pathname === '/api/keys/credit' ? Response.json({ deposited: '1', left: credit, spent: '0' }) : undefined))
    t.after(w.restore)
    await w.seed()
    w.swarm.kv.put('run', { at: Date.now() - 3_600_000, pause, settled: Date.now(), state: 'paused' })
    const reads = () => w.calls.filter((call) => call === 'GET /api/keys/credit').length
    return { fund: () => void (credit = '5'), reads, w }
  }
  const money = { left: '10000', needs: '50000', wake: null, why: 'money' }

  const replayed = await paused(money)
  await replayed.w.swarm.funded(id)
  await replayed.w.ring()
  assert.deepEqual([replayed.w.swarm.run().state, replayed.reads(), replayed.w.alarm()], ['paused', 1, null])
  assert.equal(replayed.w.calls.filter((call) => call.startsWith('POST')).length, 0)

  const recorded = await paused(money)
  recorded.fund()
  await recorded.w.viewed()
  assert.equal(recorded.w.alarm(), null)
  await recorded.w.swarm.funded(id)
  await recorded.w.ring()
  assert.equal(recorded.w.swarm.run().state, 'working')

  for (const pause of [money, { why: 'unfunded' }]) {
    const viewed = await paused(pause)
    viewed.fund()
    viewed.w.pass(9 * 60_000)
    await viewed.w.viewed()
    assert.equal(viewed.w.alarm(), null)
    viewed.w.pass(60_000)
    await viewed.w.viewed()
    await viewed.w.ring()
    assert.equal(viewed.w.swarm.run().state, 'working')
  }

  const short = await paused(money)
  short.w.pass(10 * 60_000)
  await short.w.viewed()
  await short.w.ring()
  await short.w.viewed()
  assert.deepEqual([short.w.swarm.run().state, short.reads(), short.w.alarm()], ['paused', 1, null])
})

test('money put in while a turn is failing for lack of it is used: the swarm tries again instead of pausing, and pauses only when a turn fails with nothing new put in', async (t) => {
  let credit = '0.5'
  let report: Record<string, unknown> = { request_id: 'agt_1:1', status: 'running' }
  const w = world((_request, url) => {
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: credit, left: credit, spent: '0' })
    if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json(report)
    return undefined
  })
  t.after(w.restore)
  const broke = { error: "None of this app's backers can pay right now", request_id: 'agt_1:1', status: 'failed' }
  const fail = async () => {
    report = broke
    w.swarm.checked = 0
    w.pass(11_000)
    await w.ring()
    report = { request_id: 'agt_1:1', status: 'running' }
  }
  await w.seed('500000')
  await w.swarm.wake('money')
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')

  credit = '5.5'
  await w.give('5000000', '0x' + 'd'.repeat(64))
  await fail()
  assert.equal(w.swarm.run().state, 'waiting')
  w.pass(15_000)
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')

  await fail()
  const paused = w.swarm.run()
  assert.deepEqual(paused.state === 'paused' && paused.pause, { balance: '5500000', left: '5500000', needs: '50000', wake: null, why: 'money' })
  w.pass(15_000)
  await w.ring()
  assert.deepEqual([w.swarm.run().state, w.alarm()], ['paused', null])

  await w.give('1000000', '0x' + 'e'.repeat(64))
  w.pass(600_000)
  await w.viewed()
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
})

test('a turn whose live stream failed twice is polled, and listens again a minute later instead of never', async (t) => {
  let live: (() => Response) | undefined
  const w = world((_request, url) => (url.pathname === '/v1/agents/agt_1/events' && url.searchParams.get('live') === '1' ? live?.() : undefined))
  t.after(w.restore)
  const listens = () => w.calls.filter((call) => call.includes('live=1')).length
  await w.seed()
  await w.swarm.wake('money')
  for (let alarm = 0; alarm < 6; alarm++) {
    await w.ring()
    w.pass(2_000)
  }
  assert.deepEqual([w.swarm.run().state, listens()], ['working', 2])

  w.pass(60_000)
  await w.ring()
  assert.equal(listens(), 3)
  assert.equal(w.swarm.stream.state, 'polling')

  const thought = { event: { event: { payload: { item_id: 'rs_1', offset: 0, text: 'Weighing two plans.' }, type: 'reasoning.summary.delta' }, source: 'session' }, seq: 1 }
  live = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          if (w.swarm.kv.get('thinking') !== undefined) {
            w.pass(6_000)
            return controller.close()
          }
          controller.enqueue(new TextEncoder().encode('event: live\ndata: ' + JSON.stringify(thought) + '\n\n'))
        },
      }),
    )
  w.pass(60_000)
  await w.ring()
  assert.equal(listens(), 4)
  assert.ok(JSON.stringify(w.swarm.kv.get('thinking')).includes('Weighing two plans.'))
  assert.equal(w.swarm.stream.state, 'streaming')
})
