import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { world } from './run.ts'
import { open } from './d1.ts'
import * as Nickname from '../src/shared/Nickname.ts'
import * as Setup from '../src/shared/Setup.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import * as Store from '../src/worker/Store.ts'

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')

const operator = '0x00000000000000000000000000000000000000ee'
const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

function swarm(db: ReturnType<typeof open>, id: string) {
  db.sqlite.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, 1, 1)').run(id, 'Swarm ' + id, 'The goal of swarm ' + id)
}

test('a nickname is 3 to 40 lowercase letters, digits and inner hyphens, and never a route or a hex id', () => {
  for (const name of ['pequalsnp', 'pq-signatures', 'p-vs-np', 'abc', 'a1b', '2x4', 'x'.repeat(40)]) assert.equal(Nickname.invalid(name), undefined, name)
  for (const name of ['ab', 'x'.repeat(41), 'PQ', 'Pq-signatures', '-abc', 'abc-', 'a_b', 'a.b', 'a b', 'añb', 'new', 'ideas', 'docs', 'api', 'v1', 'board', 'about', 'faq', 'join', 'feedback', 'telegram', 'oembed', 'openapi', 'assets', 'fonts', 'favicon', 'favicon-96x96', 'deadbeef', '0123456789ab', 'abcdef012345678'])
    assert.notEqual(Nickname.invalid(name), undefined, name)
  assert.equal(Nickname.usable('abcdef0'), true)
  assert.equal(Nickname.usable('abcdefg1'), true)
})

test('every top-level route the Worker or its assets answer is reserved', () => {
  const config = readFileSync('wrangler.jsonc', 'utf8')
  const first = JSON.parse(/"run_worker_first":\s*(\[[^\]]*\])/.exec(config)?.[1] ?? '[]') as string[]
  const segments = new Set(first.map((path) => path.split('/')[1] ?? '').filter(Boolean))
  for (const name of ['board', 'new', 'ideas', 'about', 'docs', 'faq']) segments.add(name)
  for (const file of readdirSync('public')) segments.add(file.replace(/\.[^.]+$/, ''))
  segments.add('assets')
  for (const segment of segments) assert.ok(!Nickname.usable(segment), segment)
})

test('a topic slugs to a nickname with its hyphens, and pages parse back to their nickname', () => {
  assert.equal(Nickname.slug('pq-signatures'), 'pq-signatures')
  assert.equal(Nickname.slug('Quantum-safe signatures'), 'quantum-safe-signatures')
  assert.equal(Nickname.slug('  Héllo, Wörld!  '), 'hello-world')
  assert.equal(Nickname.slug('a'.repeat(39) + ' bcd'), 'a'.repeat(39))
  assert.equal(Nickname.topic('faster-json--parser'), 'faster json parser')
  assert.deepEqual(Nickname.parse('/pequalsnp'), { name: 'pequalsnp', tail: '' })
  assert.deepEqual(Nickname.parse('/pequalsnp/n/0123456789/'), { name: 'pequalsnp', tail: '/n/0123456789' })
  assert.deepEqual(Nickname.parse('/pequalsnp/chat'), { name: 'pequalsnp', tail: '/chat' })
  for (const path of ['/new', '/s/abc', '/v1/swarms', '/pequalsnp/other', '/favicon.ico', '/', '/0123456789ab']) assert.equal(Nickname.parse(path), undefined, path)
  assert.equal(Nickname.path({ id: 'abc123abc123', nickname: 'pequalsnp' }), '/pequalsnp')
  assert.equal(Nickname.path({ id: 'abc123abc123', nickname: null }), '/s/abc123abc123')
})

test('a nickname is unique, a rename frees the old one, which keeps naming the swarm until another swarm takes it', async () => {
  const db = open()
  swarm(db, 'one')
  swarm(db, 'two')
  await Store.nickname(db.env, 'one', 'first')
  assert.equal(await Store.nicknamed(db.env, 'one'), 'first')
  assert.equal((await Store.find(db.env, 'one'))?.nickname, 'first')
  assert.equal(Store.summary((await Store.find(db.env, 'two'))!).nickname, null)
  await assert.rejects(Store.nickname(db.env, 'two', 'first'), Store.Taken)
  assert.equal(await Store.nicknamed(db.env, 'two'), null)

  await Store.nickname(db.env, 'one', 'second')
  assert.deepEqual(await Store.called(db.env, 'first'), { current: 'second', swarm: 'one' })
  assert.deepEqual(await Store.called(db.env, 'second'), { current: 'second', swarm: 'one' })
  assert.equal(await Store.called(db.env, 'third'), null)

  await assert.rejects(Store.nickname(db.env, 'two', 'second'), Store.Taken)
  await Store.nickname(db.env, 'two', 'first')
  assert.deepEqual(await Store.called(db.env, 'first'), { current: 'first', swarm: 'two' })
  assert.equal(await Store.nicknamed(db.env, 'one'), 'second')

  await Store.nickname(db.env, 'one', null)
  assert.equal(await Store.nicknamed(db.env, 'one'), null)
  assert.deepEqual(await Store.called(db.env, 'second'), { current: null, swarm: 'one' })
  await Store.nickname(db.env, 'one', 'second')
  assert.equal(await Store.nicknamed(db.env, 'one'), 'second')
  assert.deepEqual(db.sqlite.prepare('select name, swarm, current from swarm_names order by name').all().map((row) => ({ ...row })), [
    { current: 1, name: 'first', swarm: 'two' },
    { current: 1, name: 'second', swarm: 'one' },
  ])
  assert.throws(() => db.sqlite.prepare("insert into swarm_names (name, swarm, current, created_at) values ('third', 'one', 1, 1)").run(), /UNIQUE/)
})

test('a swarm created with a taken nickname is not created at all', async () => {
  const db = open()
  swarm(db, 'one')
  await Store.nickname(db.env, 'one', 'taken')
  const input = { creator: null, goal: 'A goal of ten words or so.', id: 'two', problem: null, steering: 'open' as const, title: 'Two' }
  await assert.rejects(Store.insert(db.env, { ...input, nickname: 'taken' }), Store.Taken)
  assert.equal(await Store.find(db.env, 'two'), null)
  const made = await Store.insert(db.env, { ...input, nickname: 'fresh' })
  assert.equal(made?.nickname, 'fresh')
  assert.equal((await Store.find(db.env, 'two'))?.nickname, 'fresh')
})

function setup() {
  const w = world(async (_request, url) => {
    if (url.pathname === '/v1/models') return Response.json({ data: [Setup.flash, Setup.glmFlash].map((id) => ({ id, kind: 'generate', pricing: { cached: 0.01, input: 0.1, output: 0.4 } })) })
    if (url.pathname === '/api/keys/me') return Response.json({ wallet: operator })
    return undefined
  })
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
  return w
}

const goal = 'Find out whether the new nickname flow holds up end to end.'

test('POST /v1/swarms takes a nickname, normalized and checked, and refuses one another swarm has', async () => {
  const w = setup()
  const made = await Operations.create(w.env, { goal, nickname: ' PQ-Signatures ', template: 'cheap', title: 'Signatures' }, ana)
  assert.ok(made.ok, JSON.stringify(made))
  assert.equal(made.value.nickname, 'pq-signatures')
  const again = await Operations.create(w.env, { goal, nickname: 'pq-signatures', template: 'cheap', title: 'Again' }, bo)
  assert.deepEqual(again.ok ? undefined : [again.status, again.code], [409, 'conflict'])
  for (const nickname of ['docs', 'ab', 'a_b', '0123456789ab']) {
    const refused = await Operations.create(w.env, { goal, nickname, template: 'cheap', title: 'Refused' }, bo)
    assert.equal(refused.ok ? 200 : refused.status, 400, nickname)
  }
  const plain = await Operations.create(w.env, { goal, template: 'cheap', title: 'Plain' }, bo)
  assert.ok(plain.ok && plain.value.nickname === null)
  const named = await Operations.named(w.env, { name: 'PQ-signatures' })
  assert.deepEqual(named, { ok: true, value: { name: 'pq-signatures', nickname: 'pq-signatures', swarm: made.value.id } })
  for (const name of ['nobody-here', 'docs', 'x']) {
    const missing = await Operations.named(w.env, { name })
    assert.equal(missing.ok ? 200 : missing.status, 404, name)
  }
})

test("only the swarm's admins and the operator set its nickname, and a rename keeps the old name pointing at it", async () => {
  const w = setup()
  const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Mine' }, ana)
  const other = await Operations.create(w.env, { goal, nickname: 'theirs', template: 'cheap', title: 'Theirs' }, bo)
  assert.ok(made.ok && other.ok)
  const swarm = made.value.id
  const unsigned = await Operations.nickname(w.env, { nickname: 'mine', swarm })
  assert.equal(unsigned.ok ? 200 : unsigned.status, 401)
  const stranger = await Operations.nickname(w.env, { nickname: 'mine', swarm }, bo)
  assert.equal(stranger.ok ? 200 : stranger.status, 403)
  const missing = await Operations.nickname(w.env, { nickname: 'mine', swarm: 'nope' }, ana)
  assert.equal(missing.ok ? 200 : missing.status, 404)
  const bad = await Operations.nickname(w.env, { nickname: 'v1', swarm }, ana)
  assert.equal(bad.ok ? 200 : bad.status, 400)
  const absent = await Operations.nickname(w.env, { swarm }, ana)
  assert.equal(absent.ok ? 200 : absent.status, 400)

  const set = await Operations.nickname(w.env, { nickname: 'mine', swarm }, ana)
  assert.ok(set.ok && set.value.nickname === 'mine')
  const same = await Operations.nickname(w.env, { nickname: 'mine', swarm }, ana)
  assert.ok(same.ok && same.value.nickname === 'mine')
  const taken = await Operations.nickname(w.env, { nickname: 'theirs', swarm }, ana)
  assert.deepEqual(taken.ok ? undefined : [taken.status, taken.code], [409, 'conflict'])

  const renamed = await Operations.nickname(w.env, { nickname: 'pequalsnp', swarm }, operator)
  assert.ok(renamed.ok && renamed.value.nickname === 'pequalsnp')
  assert.deepEqual(await Operations.named(w.env, { name: 'mine' }), { ok: true, value: { name: 'mine', nickname: 'pequalsnp', swarm } })
  const claimed = await Operations.nickname(w.env, { nickname: 'mine', swarm: other.value.id }, undefined, true)
  assert.ok(claimed.ok && claimed.value.nickname === 'mine')
  assert.deepEqual(await Operations.named(w.env, { name: 'mine' }), { ok: true, value: { name: 'mine', nickname: 'mine', swarm: other.value.id } })
  assert.deepEqual(await Operations.named(w.env, { name: 'theirs' }), { ok: true, value: { name: 'theirs', nickname: 'mine', swarm: other.value.id } })

  const dropped = await Operations.nickname(w.env, { nickname: null, swarm }, ana)
  assert.ok(dropped.ok && dropped.value.nickname === null)
  assert.deepEqual(await Operations.named(w.env, { name: 'pequalsnp' }), { ok: true, value: { name: 'pequalsnp', nickname: null, swarm } })
  const read = await Operations.get(w.env, { swarm: other.value.id })
  assert.ok(read.ok && read.value.nickname === 'mine')
  const listed = await Store.list(w.env)
  assert.ok(listed.every((row) => 'nickname' in row))

  await Operations.archive(w.env, { swarm }, undefined, true)
  const archived = await Operations.nickname(w.env, { nickname: 'again', swarm }, ana)
  assert.equal(archived.ok ? 200 : archived.status, 410)
})
