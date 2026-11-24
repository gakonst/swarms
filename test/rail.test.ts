import assert from 'node:assert/strict'
import test from 'node:test'
import * as Rail from '../src/shared/Rail.ts'

test('the problems rail starts collapsed and reads only an exact expanded cookie', () => {
  assert.equal(Rail.parse(undefined), 'collapsed')
  assert.equal(Rail.parse(''), 'collapsed')
  assert.equal(Rail.parse('swarms_rail=expanded'), 'expanded')
  assert.equal(Rail.parse('swarms_tz=UTC; swarms_rail=expanded; swarms_face=x'), 'expanded')
  assert.equal(Rail.parse('swarms_rail=collapsed'), 'collapsed')
  assert.equal(Rail.parse('swarms_rail=expandedx'), 'collapsed')
  assert.equal(Rail.parse('xswarms_rail=expanded'), 'collapsed')
})

test('toggling the rail flips it, and its cookie lasts the session', () => {
  assert.equal(Rail.toggle('collapsed'), 'expanded')
  assert.equal(Rail.toggle('expanded'), 'collapsed')
  assert.equal(Rail.written('expanded'), 'swarms_rail=expanded; path=/; samesite=lax')
  assert.doesNotMatch(Rail.written('expanded'), /max-age|expires/)
  assert.equal(Rail.parse(Rail.written(Rail.toggle('collapsed'))), 'expanded')
})
