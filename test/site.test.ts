import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Site from '../src/shared/Site.ts'

test('paths go under the base once and come back out of it', () => {
  assert.equal(Site.at('/'), '/swarms/')
  assert.equal(Site.at('/s/abc?r=x'), '/swarms/s/abc?r=x')
  assert.equal(Site.at('/swarms/s/abc'), '/swarms/s/abc')
  assert.equal(Site.at('https://example.com/a'), 'https://example.com/a')
  assert.equal(Site.strip('/swarms'), '/')
  assert.equal(Site.strip('/swarms/'), '/')
  assert.equal(Site.strip('/swarms/v1/swarms/abc'), '/v1/swarms/abc')
  assert.equal(Site.strip('/swarmsx/ideas'), '/swarmsx/ideas')
  assert.equal(Site.strip('/ideas'), '/ideas')
  assert.ok(Site.under('/swarms') && Site.under('/swarms/ideas') && !Site.under('/swarmsx') && !Site.under('/'))
})

test('the site is the public address with the base, and a local request keeps its own origin', () => {
  const env = { SWARMS_URL: 'https://paradigm.xyz/swarms' }
  assert.equal(Site.home(env), 'https://paradigm.xyz/swarms')
  assert.equal(Site.home({ SWARMS_URL: 'https://paradigm.xyz/swarms/' }), 'https://paradigm.xyz/swarms')
  assert.equal(Site.home({ SWARMS_URL: 'https://tunnel.example' }), 'https://tunnel.example/swarms')
  assert.equal(Site.url(env, 'https://swarms.tempo-dev.workers.dev/s/abc'), 'https://paradigm.xyz/swarms')
  assert.equal(Site.url(env, new URL('http://localhost:5199/ideas')), 'http://localhost:5199/swarms')
})
