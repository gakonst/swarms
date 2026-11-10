import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'

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
    await w.swarm.alarm()
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
    await w.swarm.alarm()
    assert.equal(w.swarm.run().state, 'waiting')
    w.pass(30_000)
  }
  assert.deepEqual(w.errors(), ['The swarm hit an error and will retry.'])
  w.pass(600_000)
  await w.swarm.alarm()
  assert.equal(w.errors().length, 2)
  credit = '0'
  await w.swarm.alarm()
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
  await w.swarm.alarm()
  assert.equal(w.swarm.run().state, 'working')
  const check = async (minutes: number, down: boolean) => {
    w.pass(minutes * 60_000)
    w.swarm.checked = 0
    failing = down
    await w.swarm.alarm()
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
