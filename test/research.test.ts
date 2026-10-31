import assert from 'node:assert/strict'
import test from 'node:test'
import { advance, researchId } from '../src/shared/Research.ts'
import { brief, questions } from '../src/web/research.ts'

const context = { scope: 'session-a', round: 3, at: 1000, sequence: 1 }
const added = { type: 'added', agent: { id: 7, role: 'baseline', task: 'Measure the reference implementation.', parent: 2 } }

test('subagent identity, assignment and parent come from the runtime', () => {
  const member = advance(undefined, added, context)!
  assert.equal(member.id, 'session-a:7')
  assert.equal(member.name, 'baseline')
  assert.equal(member.parent, 'session-a:2')
  assert.equal(member.state, 'pending')
  assert.notEqual(researchId(added, 'session-b'), member.id)
})

test('only confirmed tool completions count, and replay is idempotent', () => {
  let member = advance(undefined, added, context)!
  member = advance(member, { type: 'event', id: 7, event: { type: 'tool.call', payload: { tool: 'exec_command' } } }, { ...context, sequence: 2 })!
  assert.equal(member.state, 'running')
  assert.equal(member.toolsCompleted, 0)
  member = advance(member, { type: 'event', id: 7, event: { type: 'tool.result', payload: { status: 'completed' } } }, { ...context, sequence: 3 })!
  assert.equal(member.toolsCompleted, 1)
  assert.equal(advance(member, { type: 'event', id: 7, event: { type: 'tool.result', payload: { status: 'completed' } } }, { ...context, sequence: 3 }), member)
})

test('a finished model run is not a completed research assignment', () => {
  let member = advance(undefined, added, context)!
  member = advance(member, { type: 'event', id: 7, event: { type: 'run.completed' } }, { ...context, sequence: 2 })!
  assert.notEqual(member.state, 'completed')
  member = advance(member, { type: 'completion', id: 7, status: { state: 'completed', output: { result: 42 } } }, { ...context, sequence: 3 })!
  assert.equal(member.state, 'completed')
  assert.match(member.output!, /42/)
})

test('late updates retain the original round, failure and interruption', () => {
  let member = advance(undefined, added, context)!
  member = advance(member, { type: 'status', id: 7, status: { state: 'failed', error: 'No capacity' } }, { ...context, round: 4, sequence: 2 })!
  assert.equal(member.round, 3)
  assert.equal(member.state, 'failed')
  assert.equal(member.action, 'No capacity')
  member = advance(member, { type: 'status', id: 7, status: { state: 'interrupted' } }, { ...context, sequence: 3 })!
  assert.equal(member.state, 'interrupted')
})

test('reasoning deltas and malformed updates do not become public progress', () => {
  const member = advance(undefined, added, context)!
  assert.equal(advance(member, { type: 'event', id: 7, event: { type: 'reasoning.summary.delta', payload: { text: 'private' } } }, { ...context, sequence: 2 }), member)
  assert.equal(advance(member, { type: 'status', id: 7, status: { state: 'nonsense' } }, { ...context, sequence: 3 }), member)
  assert.equal(advance(undefined, { type: 'message' }, context), undefined)
})

test('an observed new run carries a reused researcher into the new round without mutating history', () => {
  const previous = advance(undefined, added, context)!
  const next = advance(previous, { type: 'event', id: 7, event: { type: 'run.started' } }, { ...context, round: 4, sequence: 2 })!
  assert.equal(next.round, 4)
  assert.equal(previous.round, 3)
  assert.equal(next.id, previous.id)
  assert.equal(next.state, 'running')
})

test('custom questions and starter quests fit the existing API', () => {
  for (const item of [...questions, brief('A'.repeat(1000))]) {
    assert(item.title.length >= 3 && item.title.length <= 80)
    assert(item.goal.length >= 10 && item.goal.length <= 2000)
  }
})
