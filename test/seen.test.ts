import assert from 'node:assert/strict'
import test from 'node:test'
import type * as Gateway from '../src/worker/Gateway.ts'
import * as Sub from '../src/worker/machines/Sub.ts'

function read(state: string, spent: number, result?: string): Gateway.Subagent {
  return { agent_id: 7, parent_agent_id: null, role: 'n:a#1', spent_usd: spent, status: { state }, task: 't', ...(result ? { result } : {}) }
}

function kv() {
  const map = new Map<string, unknown>()
  return { delete: (key: string) => map.delete(key), get: <T>(key: string) => map.get(key) as T | undefined, put: (key: string, value: unknown) => void map.set(key, value) }
}

test('a subagent state only rises and an ended state never changes', () => {
  const store = kv()
  Sub.seed(store, 'agt', 7, 'n:a#1')
  Sub.observe(store, 'agt', read('running', 0.5))
  Sub.observe(store, 'agt', read('completed', 1.25, 'done'))
  let seen = Sub.observe(store, 'agt', read('running', 0.75))
  assert.equal(seen.sub.status.state, 'completed')
  assert.equal(seen.sub.result, 'done')
  assert.equal(seen.spent, '1.250000')
  seen = Sub.observe(store, 'agt', read('closed', 1.25))
  assert.equal(seen.sub.status.state, 'completed')
  assert.equal(Sub.view(seen).spent_usd, 1.25)
})

test('an older running read never lowers the spend or replaces a newer one', () => {
  const store = kv()
  Sub.observe(store, 'agt', read('running', 0.9))
  const seen = Sub.observe(store, 'agt', read('running', 0.4))
  assert.equal(seen.spent, '0.900000')
  assert.equal(seen.sub.spent_usd, 0.9)
  assert.equal(Sub.observe(store, 'agt', read('running', 1.1)).spent, '1.100000')
})

test('an ended read with less spend keeps the most spend seen', () => {
  const store = kv()
  Sub.observe(store, 'agt', read('running', 2))
  const seen = Sub.observe(store, 'agt', read('failed', 1.5))
  assert.equal(seen.sub.status.state, 'failed')
  assert.equal(Sub.spent(seen), 2_000_000n)
})

test('a record of another version is ignored, so the previous object and the next one read only their own', () => {
  const store = kv()
  store.put(Sub.key('agt', 7), { spent: '9.000000', sub: read('completed', 9), v: 2 })
  assert.equal(Sub.get(store, 'agt', 7), undefined)
  assert.equal(Sub.observe(store, 'agt', read('running', 0.1)).spent, '0.100000')
})

test('mutant: without the monotonic guard an older list regresses the record', () => {
  const store = kv()
  Sub.guards.monotonic = false
  try {
    Sub.observe(store, 'agt', read('completed', 1, 'done'))
    const seen = Sub.observe(store, 'agt', read('running', 0.5))
    assert.equal(seen.sub.status.state, 'running')
    assert.equal(seen.spent, '0.500000')
  } finally {
    Sub.guards.monotonic = true
  }
})
