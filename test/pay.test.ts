import assert from 'node:assert/strict'
import test from 'node:test'
import * as Pay from '../src/web/pay.ts'

const sent: Pay.Owed = { amount: '5.000000', hash: '0xabc', note: '', swarm: 's1' }

function answering(...answers: (Response | Error)[]) {
  const asked: { body: unknown; url: string }[] = []
  globalThis.fetch = async (url, init) => {
    asked.push({ body: JSON.parse(String(init?.body ?? 'null')), url: String(url) })
    const answer = answers[Math.min(asked.length, answers.length) - 1]!
    if (answer instanceof Error) throw answer
    return answer.clone()
  }
  return asked
}

function problem(status: number, code: string, detail: string) {
  return Response.json({ code, detail, status }, { status })
}

const counted = Response.json({ contribution: { hash: '0xabc' }, swarm: {} })

test('a transfer the server refuses to count is refused with its reason, not kept to try again', async () => {
  const asked = answering(problem(400, 'invalid_request', 'That transaction is not a transfer to the gateway for this swarm: memo names another app'))
  assert.deepEqual(await Pay.count(sent), { at: 'refused', reason: 'That transaction is not a transfer to the gateway for this swarm: memo names another app' })
  assert.equal(asked.length, 1)
  assert.equal(asked[0]?.url, '/swarms/api/swarms/s1/contributions')
})

test('a transfer the server could not count yet stays owed, and one already counted is counted', async () => {
  answering(problem(502, 'upstream_failed', 'The gateway did not credit the transfer: timeout'))
  assert.deepEqual(await Pay.count(sent), { at: 'later' })
  answering(problem(429, 'rate_limited', 'Too many at once.'))
  assert.deepEqual(await Pay.count(sent), { at: 'later' })
  answering(new TypeError('fetch failed'))
  assert.deepEqual(await Pay.count(sent), { at: 'later' })
  answering(problem(409, 'conflict', 'This transaction is already counted.'))
  assert.deepEqual(await Pay.count(sent), { at: 'counted', hash: '0xabc' })
  const asked = answering(counted)
  assert.deepEqual(await Pay.count({ ...sent, note: 'try rust' }), { at: 'counted', hash: '0xabc' })
  assert.deepEqual(asked[0]?.body, { hash: '0xabc', note: 'try rust' })
})
