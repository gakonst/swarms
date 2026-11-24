import assert from 'node:assert/strict'
import test from 'node:test'
import * as Hello from '../src/shared/Hello.ts'

test('a visitor is new until the exact welcome cookie is set, which lasts a year', () => {
  assert.equal(Hello.parse(undefined), 'new')
  assert.equal(Hello.parse(''), 'new')
  assert.equal(Hello.parse('swarms_hello=1'), 'seen')
  assert.equal(Hello.parse('swarms_tz=UTC; swarms_hello=1; swarms_rail=expanded'), 'seen')
  assert.equal(Hello.parse('swarms_hello=0'), 'new')
  assert.equal(Hello.parse('xswarms_hello=1'), 'new')
  assert.equal(Hello.parse(Hello.written()), 'seen')
  assert.match(Hello.written(), /max-age=31536000/)
})
