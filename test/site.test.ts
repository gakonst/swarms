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

test('swarms.new serves at the root, every other host under the base', () => {
  assert.equal(Site.prefix(new URL('https://swarms.new/faq')), '')
  assert.equal(Site.prefix(new URL('https://www.swarms.new/')), '/swarms')
  assert.equal(Site.prefix(new URL('https://swarms.tempo-dev.workers.dev/swarms/faq')), '/swarms')
  assert.equal(Site.prefix(new URL('http://localhost:5300/swarms')), '/swarms')
  assert.equal(Site.at('/faq', ''), '/faq')
  assert.equal(Site.at('/faq', '/swarms'), '/swarms/faq')
  assert.equal(Site.strip('/swarms/faq', ''), '/swarms/faq')
  assert.ok(Site.under('/faq', '') && Site.under('/', ''))
  const env = { SWARMS_URL: 'https://paradigm.xyz/swarms' }
  assert.equal(Site.url(env, 'https://swarms.new/pequalsnp'), 'https://swarms.new')
  assert.equal(Site.url(env, 'http://swarms.new/'), 'http://swarms.new')
  assert.equal(Site.home(env), 'https://paradigm.xyz/swarms')
  assert.equal(Site.home({ SWARMS_URL: 'https://swarms.new/' }), 'https://swarms.new')
  assert.equal(Site.www(new URL('https://www.swarms.new/faq?x=1')), 'https://swarms.new/faq?x=1')
  assert.equal(Site.www(new URL('https://swarms.new/faq')), undefined)
})

test('a path is placed under its host\'s base, and a page off it is stray', () => {
  const place = (url: string) => Site.place(new URL(url))
  assert.deepEqual(place('https://swarms.new/pequalsnp'), { path: '/pequalsnp', stray: false })
  assert.deepEqual(place('https://swarms.new/'), { path: '/', stray: false })
  assert.deepEqual(place('https://swarms.new/swarms/faq'), { path: '/faq', stray: true })
  assert.deepEqual(place('https://swarms.new/swarms/assets/index.js'), { path: '/assets/index.js', stray: true })
  assert.deepEqual(place('https://swarms.tempo-dev.workers.dev/swarms/faq'), { path: '/faq', stray: false })
  assert.deepEqual(place('https://swarms.tempo-dev.workers.dev/swarms'), { path: '/', stray: false })
  assert.deepEqual(place('https://swarms.tempo-dev.workers.dev/faq'), { path: '/faq', stray: true })
})

test('the base on a page is the one the server booted it with, else its own host\'s', () => {
  const globals = globalThis as Record<string, unknown>
  try {
    assert.equal(Site.root(), '/swarms')
    globals['location'] = { hostname: 'swarms.new' }
    assert.equal(Site.root(), '')
    assert.equal(Site.at('/s/abc'), '/s/abc')
    globals['window'] = {}
    globals['__SWARMS_BOOT__'] = { base: '/swarms' }
    assert.equal(Site.root(), '/swarms')
    assert.equal(Site.at('/s/abc'), '/swarms/s/abc')
  } finally {
    delete globals['location']
    delete globals['window']
    delete globals['__SWARMS_BOOT__']
  }
})

