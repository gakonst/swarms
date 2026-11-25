import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'
import * as Pictures from '../src/shared/Picture.ts'
import * as Setup from '../src/shared/Setup.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import * as Store from '../src/worker/Store.ts'

const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')

const operator = '0x00000000000000000000000000000000000000ee'
const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

const goal = 'Find out whether editing a swarm holds up end to end.'

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])

function setup() {
  const w = world(async (_request, url) => {
    if (url.pathname === '/v1/models') return Response.json({ data: [Setup.flash, Setup.glmFlash].map((id) => ({ id, kind: 'generate', pricing: { cached: 0.01, input: 0.1, output: 0.4 } })) })
    if (url.pathname === '/api/keys/me') return Response.json({ wallet: operator })
    return undefined
  })
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
  return w
}

function status<T>(result: { ok: true; value: T } | { ok: false; status: number }) {
  return result.ok ? 200 : result.status
}

test('a picture is one emoji or a small PNG, JPEG, WebP or GIF', () => {
  for (const emoji of ['🧪', '🇬🇷', '👩🏽‍🔬', '❤️']) assert.equal(Pictures.emoji(emoji), true, emoji)
  for (const emoji of ['', 'a', '🧪🧪', 'ab', '1', '🧪 x']) assert.equal(Pictures.emoji(emoji), false, emoji)
  assert.equal(Pictures.sniff(png), 'image/png')
  assert.equal(Pictures.sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(Pictures.sniff(new TextEncoder().encode('GIF89a')), 'image/gif')
  assert.equal(Pictures.sniff(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
  assert.equal(Pictures.sniff(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), undefined)
})

test("only the swarm's admins and the operator edit its title, nickname and picture, in one write", async () => {
  const w = setup()
  const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Mine' }, ana)
  const other = await Operations.create(w.env, { goal, nickname: 'theirs', template: 'cheap', title: 'Theirs' }, bo)
  assert.ok(made.ok && other.ok)
  const swarm = made.value.id
  assert.equal(made.value.picture, null)

  assert.equal(status(await Operations.edit(w.env, { swarm, title: 'Yours' })), 401)
  assert.equal(status(await Operations.edit(w.env, { swarm, title: 'Yours' }, bo)), 403)
  assert.equal(status(await Operations.edit(w.env, { swarm: 'nope', title: 'Yours' }, ana)), 404)
  assert.equal(status(await Operations.edit(w.env, { swarm }, ana)), 400)
  assert.equal(status(await Operations.edit(w.env, { swarm, title: '   ' }, ana)), 400)
  assert.equal(status(await Operations.edit(w.env, { swarm, title: 'x'.repeat(81) }, ana)), 400)
  assert.equal(status(await Operations.edit(w.env, { picture: { color: 'green', emoji: 'ab' }, swarm }, ana)), 400)
  assert.equal(status(await Operations.edit(w.env, { picture: { color: 'plaid', emoji: '🧪' }, swarm }, ana)), 400)

  const both = await Operations.edit(w.env, { nickname: 'pequalsnp', picture: { color: 'violet', emoji: '🧪' }, swarm, title: ' Does P = NP? ' }, ana)
  assert.ok(both.ok, JSON.stringify(both))
  assert.equal(both.value.title, 'Does P = NP?')
  assert.equal(both.value.nickname, 'pequalsnp')
  assert.deepEqual(both.value.picture, { color: 'violet', emoji: '🧪' })
  const indexed = await w.env.DB.prepare("select title from search where swarm = ? and kind = 'swarm'").bind(swarm).all<{ title: string }>()
  assert.deepEqual(indexed.results.map((row) => row.title), ['Does P = NP?'])

  const clash = await Operations.edit(w.env, { nickname: 'theirs', swarm, title: 'Should not stick' }, ana)
  assert.deepEqual(clash.ok ? undefined : [clash.status, clash.code], [409, 'conflict'])
  const kept = await Store.find(w.env, swarm)
  assert.equal(kept?.title, 'Does P = NP?')
  assert.equal(kept?.nickname, 'pequalsnp')

  const byOperator = await Operations.edit(w.env, { swarm, title: 'P versus NP' }, undefined, true)
  assert.ok(byOperator.ok && byOperator.value.title === 'P versus NP' && byOperator.value.nickname === 'pequalsnp')
  const cleared = await Operations.edit(w.env, { picture: null, swarm }, ana)
  assert.ok(cleared.ok && cleared.value.picture === null)
  const listed = await Store.list(w.env)
  assert.ok(listed.every((row) => 'picture' in row))

  await Operations.archive(w.env, { swarm }, undefined, true)
  assert.equal(status(await Operations.edit(w.env, { swarm, title: 'Again' }, ana)), 410)
})

test('an uploaded picture is checked by its bytes, capped at 64 KB, served by version and dropped with null', async () => {
  const w = setup()
  const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Mine' }, ana)
  assert.ok(made.ok)
  const swarm = made.value.id
  assert.equal(status(await Operations.picture(w.env, { swarm })), 404)
  assert.equal(status(await Operations.paint(w.env, { data: png, swarm }, bo)), 403)
  assert.equal(status(await Operations.paint(w.env, { data: new TextEncoder().encode('<svg onload="alert(1)"/>'), swarm }, ana)), 400)
  const big = new Uint8Array(Pictures.most + 1)
  big.set(png)
  assert.equal(status(await Operations.paint(w.env, { data: big, swarm }, ana)), 400)

  const painted = await Operations.paint(w.env, { data: png, swarm }, ana)
  assert.ok(painted.ok && painted.value.picture && 'url' in painted.value.picture, JSON.stringify(painted))
  const url = painted.value.picture.url
  assert.match(url, new RegExp(`^/v1/swarms/${swarm}/picture\\?v=[0-9a-z]+$`))
  const served = await Operations.picture(w.env, { swarm })
  assert.ok(served.ok)
  assert.equal(served.value.type, 'image/png')
  assert.deepEqual([...served.value.bytes], [...png])
  assert.equal(url, Pictures.path(swarm, served.value.at))

  const emoji = await Operations.edit(w.env, { picture: { color: 'teal', emoji: '🛰️' }, swarm }, ana)
  assert.ok(emoji.ok && emoji.value.picture && 'emoji' in emoji.value.picture)
  assert.equal(status(await Operations.picture(w.env, { swarm })), 404)
})

test("the swarm's admins and the operator archive it, and nobody else", async () => {
  const w = setup()
  const made = await Operations.create(w.env, { goal, template: 'cheap', title: 'Mine' }, ana)
  const other = await Operations.create(w.env, { goal, template: 'cheap', title: 'Theirs' }, bo)
  assert.ok(made.ok && other.ok)
  assert.equal(status(await Operations.archive(w.env, { swarm: made.value.id })), 401)
  assert.equal(status(await Operations.archive(w.env, { swarm: made.value.id }, bo)), 403)
  assert.equal(status(await Operations.archive(w.env, { swarm: 'nope' }, ana)), 404)
  const archived = await Operations.archive(w.env, { swarm: made.value.id }, ana)
  assert.ok(archived.ok && archived.value.archivedAt !== null)
  const again = await Operations.archive(w.env, { swarm: made.value.id }, ana)
  assert.ok(again.ok && again.value.archivedAt === archived.value.archivedAt)
  const byOperator = await Operations.archive(w.env, { swarm: other.value.id }, operator as `0x${string}`)
  assert.ok(byOperator.ok && byOperator.value.archivedAt !== null)
})
