import assert from 'node:assert/strict'
import test from 'node:test'
import type * as PayModule from '../src/web/pay.ts'

const stored = new Map<string, string>()

Object.assign(globalThis, { localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) } })

let loads = 0

function loaded(): Promise<typeof PayModule> {
  return import(`../src/web/pay.ts?load=${loads++}`)
}

const Pay = await loaded()

const sent: PayModule.Owed = { amount: '5.000000', hash: '0xabc', note: '', swarm: 's1' }

function answering(...answers: (Response | Error | Promise<Response>)[]) {
  const asked: { body: unknown; url: string }[] = []
  globalThis.fetch = async (url, init) => {
    asked.push({ body: JSON.parse(String(init?.body ?? 'null')), url: String(url) })
    const answer = await answers[Math.min(asked.length, answers.length) - 1]!
    if (answer instanceof Error) throw answer
    return answer.clone()
  }
  return asked
}

function problem(status: number, code: string, detail: string) {
  return Response.json({ code, detail, status }, { status })
}

const counted = Response.json({ contribution: { hash: '0xabc' }, swarm: {} })

const owed = () => JSON.parse(stored.get('swarms.owed') ?? '[]') as PayModule.Owed[]

test('a transfer the server refuses to count is refused with its reason, not kept to try again', async () => {
  const asked = answering(problem(400, 'invalid_request', 'That transaction is not a transfer to the gateway for this swarm: memo names another app'))
  assert.deepEqual(await Pay.record(sent), { at: 'refused', reason: 'That transaction is not a transfer to the gateway for this swarm: memo names another app' })
  assert.equal(asked.length, 1)
  assert.equal(asked[0]?.url, '/swarms/api/swarms/s1/contributions')
  assert.deepEqual(Pay.flow('s1'), { at: 'failed', error: 'That transaction is not a transfer to the gateway for this swarm: memo names another app', hash: '0xabc' })
  assert.deepEqual(owed(), [])
  Pay.move('s1', Pay.idle)
})

test('a transfer the server could not count yet stays owed, and one already counted is counted', async () => {
  for (const answer of [problem(502, 'upstream_failed', 'The gateway did not credit the transfer: timeout'), problem(429, 'rate_limited', 'Too many at once.'), new TypeError('fetch failed')]) {
    answering(answer)
    assert.deepEqual(await Pay.record(sent), { at: 'later' })
    assert.deepEqual(Pay.flow('s1'), { at: 'unrecorded', owed: sent })
  }
  answering(problem(409, 'conflict', 'This transaction is already counted.'))
  assert.deepEqual(await Pay.record(sent), { at: 'counted' })
  assert.deepEqual(Pay.flow('s1'), { amount: '5.000000', at: 'done' })
  const asked = answering(counted)
  assert.deepEqual(await Pay.record({ ...sent, note: 'try rust' }), { at: 'counted' })
  assert.deepEqual(asked[0]?.body, { hash: '0xabc', note: 'try rust' })
  Pay.move('s1', Pay.idle)
})

test('a sent transfer is kept before it is counted, survives a reload, and locks the swarm until it is counted', async () => {
  let answer = (_: Response) => {}
  answering(new Promise<Response>((resolve) => (answer = resolve)))
  const counting = Pay.record(sent)
  assert.deepEqual(owed(), [sent])
  assert.deepEqual(Pay.flow('s1'), { at: 'busy', step: 'record' })
  answer(problem(502, 'upstream_failed', 'The gateway did not credit the transfer: timeout'))
  assert.deepEqual(await counting, { at: 'later' })
  assert.deepEqual(owed(), [sent])

  const reloaded = await loaded()
  assert.deepEqual(reloaded.flow('s1'), { at: 'unrecorded', owed: sent })
  assert.equal(reloaded.flow('s1'), reloaded.flow('s1'))
  assert.deepEqual(reloaded.flow('s2'), { at: 'idle' })
  assert.ok(!reloaded.can(reloaded.flow('s1'), { at: 'busy', step: 'send' }))
  assert.throws(() => reloaded.move('s1', { at: 'busy', step: 'send' }), /cannot go from unrecorded to busy/)

  const asked = answering(counted)
  assert.deepEqual(await reloaded.record(sent), { at: 'counted' })
  assert.deepEqual(asked.map((each) => each.body), [{ hash: '0xabc' }])
  assert.deepEqual(reloaded.flow('s1'), { amount: '5.000000', at: 'done' })
  assert.deepEqual(owed(), [])
  assert.deepEqual(Pay.flow('s1'), { at: 'idle' })
})

test('money sent from the start page belongs to the swarm it created', async () => {
  const Pay = await loaded()
  let answer = (_: Response) => {}
  answering(new Promise<Response>((resolve) => (answer = resolve)))
  Pay.move('own', { at: 'busy', step: 'create' })
  Pay.move('own', { at: 'busy', step: 'send' })
  const counting = Pay.record(sent, 'own')
  assert.deepEqual(Pay.flow('own'), { at: 'idle' })
  assert.deepEqual(Pay.flow('s1'), { at: 'busy', step: 'record' })
  answer(problem(503, 'unavailable', 'Try again in a moment.'))
  await counting
  assert.deepEqual(Pay.flow('own'), { at: 'idle' })
  assert.deepEqual(Pay.flow('s1'), { at: 'unrecorded', owed: sent })
  answering(counted)
  await Pay.record(sent)
  assert.deepEqual(owed(), [])
})

test('a payment in flight outlives the box that started it, and a settled one is forgotten with it', async () => {
  const Pay = await loaded()
  let told = 0
  const leave = Pay.watch('s1', () => told++)
  Pay.move('s1', { at: 'busy', step: 'send' })
  assert.equal(told, 1)
  leave()
  assert.deepEqual(Pay.flow('s1'), { at: 'busy', step: 'send' })
  Pay.move('s1', { at: 'failed', error: 'You declined the request in Tempo Wallet.' })
  assert.deepEqual(Pay.flow('s1'), { at: 'failed', error: 'You declined the request in Tempo Wallet.' })
  Pay.watch('s1', () => {})()
  assert.deepEqual(Pay.flow('s1'), { at: 'idle' })
  assert.throws(() => Pay.move('s1', { amount: '1', at: 'done' }), /cannot go from idle to done/)
  Pay.move('s1', { at: 'failed', error: 'Your wallet holds less than this.' })
  Pay.move('s1', { at: 'failed', error: 'Your wallet holds less than this.' })
  assert.deepEqual(Pay.flow('s1'), { at: 'failed', error: 'Your wallet holds less than this.' })
  Pay.move('s1', Pay.idle)
})

test('an approval an older page left owed is dropped: approvals are gone, and only a sent transfer is owed', async () => {
  stored.set('swarms.owed', JSON.stringify([{ amount: '2.000000', id: 'backing_1', keyAuthorization: {}, note: '', swarm: 's9', way: 'approved' }, { ...sent, swarm: 's9' }]))
  const Pay = await loaded()
  assert.deepEqual(Pay.flow('s9'), { at: 'unrecorded', owed: { ...sent, swarm: 's9' } })
  answering(counted)
  assert.deepEqual(await Pay.record({ ...sent, swarm: 's9' }), { at: 'counted' })
  assert.deepEqual(owed(), [])
})
