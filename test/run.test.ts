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

test('a prompt the gateway did not answer for is sent again word for word under its turn id, so a note that came meanwhile is not recorded as told', async (t) => {
  const bodies: { id: string; prompt: string }[] = []
  const w = world(async (request, url) => {
    if (url.pathname !== '/v1/agents/agt_1/turns' || request.method !== 'POST') return undefined
    bodies.push((await request.json()) as { id: string; prompt: string })
    return bodies.length === 1 ? Response.json({ error: 'session operation failed' }, { status: 503 }) : undefined
  })
  t.after(w.restore)
  await w.seed()
  await w.swarm.wake('money')
  await w.ring()
  const waiting = w.swarm.run()
  assert.equal(waiting.state === 'waiting' && waiting.sent?.prompt, bodies[0]?.prompt)
  await w.give('2000000', '0x' + 'c'.repeat(64), 'Try the other approach')
  w.pass(30_000)
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
  assert.deepEqual([bodies.length, bodies[1]?.id, bodies[1]?.prompt], [2, bodies[0]?.id, bodies[0]?.prompt])
  assert.ok(!bodies[1]?.prompt.includes('Try the other approach'))
  assert.deepEqual(w.sql.exec('SELECT note FROM steered').toArray(), [])
})

test('a swarm no approval pays for stops asking the gateway for its backings after the first listing', async (t) => {
  const w = world(() => undefined)
  t.after(w.restore)
  await w.seed()
  await w.swarm.wake('money')
  await w.ring()
  for (let alarm = 0; alarm < 4; alarm++) {
    w.swarm.checked = 0
    w.pass(61_000)
    await w.ring()
  }
  const asked = (path: string) => w.calls.filter((call) => call === 'GET ' + path).length
  assert.ok(asked('/api/keys/credit') >= 2)
  assert.equal(asked('/api/keys/backings'), 1)
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
  t.mock.method(console, 'error', () => undefined)
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

  t.mock.method(console, 'error', () => undefined)
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
  const broke = { error: 'Boundless was not paid: fetch failed', request_id: 'agt_1:1', status: 'failed' }
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
  const wake = Date.now() + 20 * 60_000
  assert.deepEqual(paused.state === 'paused' && paused.pause, { balance: '5500000', left: '5500000', needs: '50000', wake, why: 'money' })
  w.pass(15_000)
  await w.ring()
  assert.deepEqual([w.swarm.run().state, w.alarm()], ['paused', wake])

  await w.give('1000000', '0x' + 'e'.repeat(64))
  w.pass(600_000)
  await w.viewed()
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
})

test('a swarm the gateway refused to pay for while it lists money tries again by itself, waiting twice as long after each refusal, and never pauses on figures it could not read', async (t) => {
  let report: Record<string, unknown> = { request_id: 'agt_1:1', status: 'running' }
  let down = false
  const w = world((_request, url) => {
    if (down && (url.pathname === '/api/keys/credit' || url.pathname === '/api/keys/backings')) return Response.json({ error: 'rate limited' }, { status: 429 })
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '5', left: '5', spent: '0' })
    if (url.pathname.startsWith('/v1/agents/agt_1/turns/agt_1:')) return Response.json(report)
    return undefined
  })
  t.after(w.restore)
  const fail = async () => {
    report = { error: 'Boundless was not paid: fetch failed', request_id: 'agt_1:1', status: 'failed' }
    w.swarm.checked = 0
    w.pass(11_000)
    await w.ring()
    report = { request_id: 'agt_1:1', status: 'running' }
  }
  await w.seed('5000000')
  await w.swarm.wake('money')
  await w.ring()
  await fail()
  const first = w.swarm.run()
  assert.equal(first.state === 'paused' && first.pause.why === 'money' && first.pause.wake, Date.now() + 10 * 60_000)
  w.pass(15_000)
  await w.ring()
  assert.deepEqual([w.swarm.run().state, w.alarm()], ['paused', Date.now() - 15_000 + 10 * 60_000])
  w.pass(10 * 60_000)
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
  await fail()
  const second = w.swarm.run()
  assert.equal(second.state === 'paused' && second.pause.why === 'money' && second.pause.wake, Date.now() + 20 * 60_000)
  assert.deepEqual(w.sql.exec('SELECT text FROM chat ORDER BY id').toArray().map((row) => row['text']), ['Started working.', 'Its last step could not be paid for, though it has money. It tries again by itself.'])

  down = true
  w.pass(20 * 60_000)
  await w.ring()
  assert.deepEqual([w.swarm.run().state, w.alarm()], ['paused', Date.now() + 60_000])
  down = false
  w.pass(60_000)
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')

  const unread = world((_request, url) => (down && url.pathname === '/api/keys/credit' ? Response.json({ error: 'rate limited' }, { status: 429 }) : undefined))
  t.after(unread.restore)
  down = true
  await unread.seed()
  await unread.swarm.wake('money')
  await unread.ring()
  assert.deepEqual([unread.swarm.run().state, unread.errors()], ['waiting', ['The gateway did not say how much money the swarm has.']])
  down = false
  unread.pass(30_000)
  await unread.ring()
  assert.equal(unread.swarm.run().state, 'working')
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

test('the public API names only the statuses a run can have, and done is not one of them', async () => {
  const OpenApi = await import('../src/worker/OpenApi.ts')
  const Operations = await import('../src/worker/Operations.ts')
  const Phase = await import('../src/worker/Phase.ts')
  const document = OpenApi.document('https://swarms.test') as unknown as { components: { schemas: { Status: { enum: string[] } } } }
  assert.deepEqual(document.components.schemas.Status.enum, ['funding', 'running', 'paused'])
  assert.ok(!Operations.schema.list.safeParse({ status: 'done' }).success)
  const money = { left: '0', wake: null, why: 'money' } as const
  const runs = [
    { state: 'new' },
    { since: null, state: 'waiting', until: 0 },
    { from: money, since: null, state: 'waiting', until: 0 },
    { id: 'a:1', n: 1, since: null, state: 'starting', told: [] },
    { from: 0, n: 1, since: 1, started: 1, state: 'working', turn: 't' },
    { at: 0, pause: money, state: 'paused' },
    { at: 0, pause: { why: 'unfunded' }, state: 'paused' },
  ] as const
  const projected = new Set(runs.flatMap((run) => [0, 3].map((n) => Phase.project(run as never, n).status)))
  assert.deepEqual([...projected].sort(), [...Operations.statuses].sort())
})

test('the branches a swarm last listed are answered when the gateway is slow or failing to list them, instead of making the reader wait or fail', async (t) => {
  let answer: () => Response | Promise<Response> = () => Response.json({ agents: [] })
  const w = world((_request, url) => (url.pathname === '/v1/agents/agt_1/subagents' ? answer() : undefined))
  t.after(w.restore)
  await w.seed()
  w.swarm.kv.put('agent', { briefed: true, cursor: 0, id: 'agt_1', unreachable: null })
  const old = [{ id: 1, role: 'explorer', status: { state: 'running' } }]
  w.swarm.kv.put('subagents', { agent: 'agt_1', at: Date.now() - 3_600_000, list: old })

  let release = () => {}
  answer = () => new Promise<Response>((resolve) => (release = () => resolve(Response.json({ agents: [] }))))
  const started = performance.now()
  const slow = await w.swarm.subagents(id)
  assert.ok(slow.ok && slow.value.list.length === 1 && performance.now() - started < 5_000)
  release()

  answer = () => Response.json({ error: 'down' }, { status: 503 })
  w.swarm.kv.put('subagents', { agent: 'agt_1', at: Date.now() - 3_600_000, list: old })
  w.swarm.listing = undefined
  const failing = await w.swarm.subagents(id)
  assert.ok(failing.ok && failing.value.list.length === 1)

  answer = () => Response.json({ agents: [] })
  w.swarm.listing = undefined
  const fresh = await w.swarm.subagents(id)
  assert.ok(fresh.ok && fresh.value.list.length === 0)
})

test('a turn in which the agent does nothing for thirty minutes is stopped, and the swarm starts another', async (t) => {
  const w = world(() => undefined)
  t.after(w.restore)
  await w.seed()
  await w.swarm.wake('money')
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
  w.swarm.checked = 0
  w.pass(29 * 60_000)
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
  w.swarm.checked = 0
  w.pass(61_000)
  await w.ring()
  assert.equal(w.swarm.run().state, 'waiting')
  assert.ok(w.calls.includes('POST /v1/agents/agt_1/turns/agt_1:1/cancel'))
  assert.ok(w.errors().some((text) => /made no model call or tool call for 30 minutes/.test(text) || /stopped with an error/.test(text)))
  w.pass(15_000)
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
})

test('a pause whose wake was set hours ahead is looked at again when it is viewed an hour after it began, though its alarm is still pending', async (t) => {
  const w = world((_request, url) => (url.pathname === '/api/keys/credit' ? Response.json({ deposited: '5', left: '5', spent: '0' }) : undefined))
  t.after(w.restore)
  await w.seed('5000000')
  const at = Date.now()
  w.swarm.kv.put('run', { at, pause: { balance: '5000000', left: '5000000', needs: '50000', wake: at + 5 * 3_600_000, why: 'money' }, settled: at, state: 'paused' })
  await w.swarm.ctx.storage.setAlarm(at + 5 * 3_600_000)
  w.pass(59 * 60_000)
  await w.viewed()
  await w.ring()
  assert.equal(w.swarm.run().state, 'paused')
  await w.swarm.ctx.storage.setAlarm(at + 5 * 3_600_000)
  w.pass(11 * 60_000)
  await w.viewed()
  assert.equal(w.alarm(), Date.now())
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
})

test('a swarm that ran on a Boundless model is moved off it, whatever the gateway says of that model, and starts a new agent', async (t) => {
  const made: { model?: string }[] = []
  const w = world(async (request, url) => {
    if (url.pathname === '/v1/models')
      return Response.json({ data: ['vercel/anthropic/claude-fable-5.2', 'vercel/anthropic/claude-opus-5.5', 'boundless/anthropic/claude-fable-5.2'].map((model) => ({ capabilities: { tools: true }, id: model, kind: 'generate', metered: true, pricing: { cached: 0.2, input: 4, output: 20 } })) })
    if (url.pathname === '/v1/agents' && request.method === 'POST') {
      made.push((await request.clone().json()) as { model?: string })
      return Response.json({ id: 'agt_1' })
    }
    return undefined
  })
  t.after(w.restore)
  await w.seed('5000000')
  const old = { harness: 'claude', model: 'boundless/anthropic/claude-fable-5.2', most: '440960', step: '65600', steps: {}, subagents: { harnesses: ['claude'], models: ['boundless/anthropic/claude-fable-5.2'] }, template: 'fable' }
  await w.env.DB.prepare('update swarms set setup = ? where id = ?').bind(JSON.stringify(old), id).run()
  w.swarm.kv.put('agent', { briefed: true, cursor: 7, id: 'agt_old', instructed: true, unreachable: null, url: 'backers' })
  w.swarm.kv.put('instructions', 'the old instructions, naming boundless/anthropic/claude-fable-5.2')
  await w.swarm.wake('money')
  await w.ring()
  const row = (await w.env.DB.prepare('select setup from swarms where id = ?').bind(id).first()) as { setup: string }
  const setup = JSON.parse(row.setup) as { model: string; subagents: { models: string[] }; template: string }
  assert.deepEqual([setup.model, setup.subagents.models, setup.template], ['vercel/anthropic/claude-fable-5.2', ['vercel/anthropic/claude-fable-5.2'], 'fable'])
  assert.deepEqual([w.swarm.run().state, w.swarm.agent()?.id, made.map((agent) => agent.model)], ['working', 'agt_1', ['vercel/anthropic/claude-fable-5.2']])
  assert.ok(!String(w.swarm.kv.get('instructions')).includes('boundless/'))
  assert.ok(w.sql.exec("SELECT text FROM feed WHERE kind = 'status'").toArray().some((entry) => /Moved the swarm off Boundless: it runs on Claude Fable 5\.2 now/.test(String(entry['text']))))
})

test('a paused swarm viewed ten minutes later lowers a backing that ended while it was paused to what it paid', async (t) => {
  const key = '0x' + 'e'.repeat(40)
  let backing = { backer: rider, createdAt: 1, ended: false, expiresAt: null, key, left: '10', limit: '10', spent: '0', tag: null, token: 'mach' }
  const w = world((_request, url) => {
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '0', left: '0', spent: '0' })
    if (url.pathname === '/api/keys/backings') return Response.json({ backings: [backing], left: backing.ended ? '0' : backing.left, spent: backing.spent })
    return undefined
  })
  t.after(w.restore)
  await w.seed('0')
  await w.env.DB.prepare("insert into contributions (id, swarm, channel, contributor, token, amount, created_at) values (?, ?, ?, ?, 'mach', '10000000', 1)").bind('backing:' + key, id, key, rider).run()
  w.swarm.kv.put('run', { at: Date.now() - 3_600_000, pause: { left: '0', wake: null, why: 'money' }, settled: Date.now(), state: 'paused' })
  backing = { ...backing, ended: true, left: '0', spent: '1' }
  const amount = async () => (await w.env.DB.prepare('select amount from contributions where id = ?').bind('backing:' + key).first<{ amount: string }>())?.amount
  w.pass(9 * 60_000)
  await w.viewed()
  assert.deepEqual([w.alarm(), await amount()], [null, '10000000'])
  w.pass(60_000)
  await w.viewed()
  await w.ring()
  assert.deepEqual([w.swarm.run().state, await amount()], ['paused', '1000000'])
})
