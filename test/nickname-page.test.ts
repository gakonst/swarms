import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type { Summary } from '../src/shared/Api.ts'
import * as Share from '../src/worker/Share.ts'
import * as Store from '../src/worker/Store.ts'
import { open } from './d1.ts'

const modules: Record<string, string> = {
  'cloudflare:workers': 'export const waitUntil = () => {}',
  '#ssr': 'export async function render() { return new ReadableStream() }',
  './Artifacts.ts': '',
  './Edge.ts': '',
  './Og.ts': '',
  './Operations.ts': '',
  './Share.ts': '',
}

registerHooks({
  resolve(specifier, context, next) {
    const source = context.parentURL?.endsWith('/src/worker/Page.ts') ? modules[specifier] : undefined
    return source === undefined ? next(specifier, context) : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) }
  },
})

const Page = await import('../src/worker/Page.ts')

const url = (path: string) => new Request(new URL(path, 'https://swarms.test'))

test('nickname pages render, and reserved or hex names stay off them', () => {
  for (const path of ['/pequalsnp', '/pequalsnp/', '/pequalsnp/chat', '/pequalsnp/code', '/pequalsnp/results', '/pequalsnp/n/0123456789', '/s/abc123abc123', '/new', '/board']) assert.ok(Page.rendered(path), path)
  for (const path of ['/v1', '/api', '/assets', '/fonts', '/favicon.ico', '/0123456789ab', '/ab', '/pequalsnp/other', '/Pequalsnp']) assert.ok(!Page.rendered(path), path)
})

test('/s/<id> and a former nickname move to the nickname with the rest of the path, and /new?q moves to the name it slugs to', async () => {
  const db = open()
  db.sqlite.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, 1, 1)').run('abc123abc123', 'P vs NP', 'Settle it.')
  db.sqlite.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, 1, 1)').run('def456def456', 'Plain', 'No name.')
  await Store.nickname(db.env, 'abc123abc123', 'p-vs-np')
  await Store.nickname(db.env, 'abc123abc123', 'pequalsnp')
  const env = db.env
  assert.equal(await Page.renamed(env, url('/s/abc123abc123')), '/pequalsnp')
  assert.equal(await Page.renamed(env, url('/s/abc123abc123/n/0123456789?ride')), '/pequalsnp/n/0123456789?ride')
  assert.equal(await Page.renamed(env, url('/s/abc123abc123/chat/')), '/pequalsnp/chat')
  assert.equal(await Page.renamed(env, url('/s/def456def456')), undefined)
  assert.equal(await Page.renamed(env, url('/p-vs-np/results?r=chart')), '/pequalsnp/results?r=chart')
  assert.equal(await Page.renamed(env, url('/pequalsnp')), undefined)
  assert.equal(await Page.renamed(env, url('/nobody-has-this')), undefined)
  assert.equal(await Page.renamed(env, url('/new?q=pq-signatures')), '/pq-signatures')
  assert.equal(await Page.renamed(env, url('/new/?q=Faster%20JSON%20parsing&template=cheap')), '/faster-json-parsing?template=cheap')
  assert.equal(await Page.renamed(env, url('/new?q=docs')), undefined)
  assert.equal(await Page.renamed(env, url('/new?q=ab')), undefined)
  assert.equal(await Page.renamed(env, url('/new')), undefined)
  assert.equal(await Page.renamed(env, url('/new?fixture&q=pq-signatures')), undefined)
  assert.equal(await Page.renamed(env, url('/docs')), undefined)
  await Store.nickname(db.env, 'abc123abc123', null)
  assert.equal(await Page.renamed(env, url('/pequalsnp/chat')), '/s/abc123abc123/chat')
  assert.equal(await Page.renamed(env, url('/s/abc123abc123')), undefined)
})

test('a nicknamed swarm shares, embeds and is canonical at its nickname', () => {
  const swarm = { answer: null, archivedAt: null, balance: '0', contributors: 0, cover: null, createdAt: 1, form: 'agent', goal: 'Settle it.', id: 'abc123abc123', machines: 0, nickname: 'pequalsnp', pool: '0', problem: null, remaining: '0', setup: null, spent: '0', status: 'funding', steering: 'open', title: 'P vs NP', updatedAt: 1, why: null } satisfies Summary
  const shared = Share.share('https://paradigm.xyz/swarms', Share.swarm(swarm))
  assert.equal(shared.url, 'https://paradigm.xyz/swarms/pequalsnp')
  assert.equal(shared.oembed, 'https://paradigm.xyz/swarms/oembed?url=' + encodeURIComponent('https://paradigm.xyz/swarms/pequalsnp'))
  assert.match(Share.tags(shared), /<link rel="canonical" href="https:\/\/paradigm\.xyz\/swarms\/pequalsnp">/)
  assert.equal(Share.share('https://paradigm.xyz/swarms', Share.swarm({ ...swarm, nickname: null })).url, 'https://paradigm.xyz/swarms/s/abc123abc123')
  assert.equal(Share.path({ ...Share.tree('abc123abc123', { headline: { deadEnds: 0, frontier: 0, inFlight: 0, perProven: null, proven: 0, ridden: 0, spent: 0 } as never, nodes: [] }), name: 'pequalsnp' } as Share.Subject), '/pequalsnp')
  const idea = Share.share('https://paradigm.xyz/swarms', Share.idea(Share.problem('pq-signatures')!))
  assert.equal(idea.url, 'https://paradigm.xyz/swarms/pq-signatures')
  assert.equal(Share.share('https://paradigm.xyz/swarms', Share.listing('new', []), { path: '/faster-json' }).url, 'https://paradigm.xyz/swarms/faster-json')
})
