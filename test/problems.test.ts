import assert from 'node:assert/strict'
import test from 'node:test'
import { open, problems } from '../src/shared/ResearchBrief.ts'

test('the idea bank hides problems that have a swarm on them, which is never done', () => {
  const first = problems[0]!
  const second = problems[1]!
  const free = open([{ problem: first.id }, { problem: null }])
  assert.equal(free.includes(first), false)
  assert.equal(free.includes(second), true)
  assert.equal(free.length, problems.length - 1)
  assert.equal(new Set(problems.map((problem) => problem.id)).size, problems.length)
})
