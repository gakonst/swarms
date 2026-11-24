import assert from 'node:assert/strict'
import test from 'node:test'
import type { Chatter } from '../src/shared/Api.ts'
import * as Credit from '../src/shared/Credit.ts'
import * as Reaction from '../src/shared/Reaction.ts'
import * as Setup from '../src/shared/Setup.ts'
import { github } from './dispatch.ts'
import { id, rider, world } from './run.ts'
import type * as NodesModule from '../src/worker/Nodes.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'

const Nodes: typeof NodesModule = await import('../src/worker/Nodes.ts')
const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')
const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')

const owner = '0x00000000000000000000000000000000000000ee'
const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

function heard(w: ReturnType<typeof world>) {
  const events: Chatter[] = []
  Object.assign(w.swarm.ctx, { getWebSockets: () => [{ send: (data: string) => events.push(JSON.parse(data) as Chatter) }] })
  return events
}

async function named(w: ReturnType<typeof world>, address: string, name: string) {
  await w.env.DB.prepare('insert into names (address, name, updated_at) values (?, ?, 1)').bind(address.toLowerCase(), name).run()
}

async function room(t: { after: (done: () => void | Promise<void>) => void }) {
  const w = world(() => undefined)
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
  t.after(() => w.restore())
  await w.seed()
  await named(w, rider, 'ada')
  await named(w, bo, 'bo')
  return w
}

test('a reply goes in its thread, a reply to a reply in the same one, and the room lists only first messages with their thread', async (t) => {
  const w = await room(t)
  const events = heard(w)
  const first = await Operations.say(w.env, { swarm: id, text: 'what next?' }, rider)
  assert.ok(first.ok, JSON.stringify(first))
  const reply = await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'try the cold cache run' }, rider)
  assert.ok(reply.ok, JSON.stringify(reply))
  assert.equal(reply.value.message.parent, first.value.message.id)
  const deeper = await Operations.say(w.env, { parent: reply.value.message.id, swarm: id, text: 'agreed' }, rider)
  assert.ok(deeper.ok)
  assert.equal(deeper.value.message.parent, first.value.message.id)
  assert.ok((await Operations.say(w.env, { swarm: id, text: 'unrelated' }, rider)).ok)

  const read = await Operations.room(w.env, { swarm: id })
  assert.ok(read.ok)
  assert.deepEqual(read.value.messages.filter((said) => said.author).map((said) => said.text), ['what next?', 'unrelated'])
  assert.deepEqual(read.value.messages.find((said) => said.id === first.value.message.id)?.replies, { at: deeper.value.message.at, count: 2, who: [rider] })

  const thread = await Operations.replies(w.env, { message: deeper.value.message.id, swarm: id })
  assert.ok(thread.ok, JSON.stringify(thread))
  assert.equal(thread.value.parent.id, first.value.message.id)
  assert.deepEqual(thread.value.replies.map((said) => said.text), ['try the cold cache run', 'agreed'])
  assert.equal(thread.value.next, deeper.value.message.id)
  const later = await Operations.replies(w.env, { after: reply.value.message.id, message: first.value.message.id, swarm: id })
  assert.ok(later.ok)
  assert.deepEqual(later.value.replies.map((said) => said.text), ['agreed'])

  const counts = events.flatMap((event) => (event.type === 'replies' ? [[event.id, event.replies.count]] : []))
  assert.deepEqual(counts, [[first.value.message.id, 1], [first.value.message.id, 2]])
  assert.ok(events.some((event) => event.type === 'said' && event.message.parent === first.value.message.id))
})

test('a thread refuses a missing message and an @swarm steer, and replies are redacted and paced with the room', async (t) => {
  const w = await room(t)
  const missing = await Operations.say(w.env, { parent: 999, swarm: id, text: 'hello' }, rider)
  assert.ok(!missing.ok && missing.status === 404)
  assert.ok(!(await Operations.replies(w.env, { message: 999, swarm: id })).ok)
  const first = await Operations.say(w.env, { swarm: id, text: 'start' }, rider)
  assert.ok(first.ok)
  const steer = await Operations.say(w.env, { parent: first.value.message.id, steer: '0.5', swarm: id, text: '@swarm try harder' }, rider)
  assert.ok(!steer.ok && steer.status === 400, JSON.stringify(steer))
  const outsider = await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'hi' }, bo)
  assert.ok(!outsider.ok && outsider.status === 403)
  const secret = await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'git clone https://user:token@code.storage/repo' }, rider)
  assert.ok(secret.ok)
  assert.equal(secret.value.message.text, 'git clone https://***@code.storage/repo')
  for (let n = 0; n < 7; n++) assert.ok((await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'r' + n }, rider)).ok)
  const paced = await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'one too many' }, rider)
  assert.ok(!paced.ok && paced.status === 429)
})

test('reactions toggle idempotently per person and emoji, list who reacted, stream live and need a rider', async (t) => {
  const w = await room(t)
  const events = heard(w)
  const first = await Operations.say(w.env, { swarm: id, text: 'shipped' }, rider)
  assert.ok(first.ok)
  const message = first.value.message.id
  const on = await Operations.react(w.env, { emoji: '🎉', message, swarm: id }, rider)
  assert.ok(on.ok, JSON.stringify(on))
  assert.deepEqual(on.value, { id: message, reactions: [{ emoji: '🎉', who: [rider.toLowerCase()] }] })
  const twice = await Operations.react(w.env, { emoji: '🎉', message, on: true, swarm: id }, rider)
  assert.ok(twice.ok)
  assert.deepEqual(twice.value.reactions, [{ emoji: '🎉', who: [rider.toLowerCase()] }])
  assert.ok((await Operations.react(w.env, { emoji: '👍', message, swarm: id }, rider)).ok)
  const read = await Operations.room(w.env, { swarm: id })
  assert.ok(read.ok)
  assert.deepEqual(read.value.messages.find((said) => said.id === message)?.reactions?.map((reaction) => reaction.emoji), ['🎉', '👍'])
  const off = await Operations.react(w.env, { emoji: '🎉', message, on: false, swarm: id }, rider)
  assert.ok(off.ok)
  assert.deepEqual(off.value.reactions, [{ emoji: '👍', who: [rider.toLowerCase()] }])
  assert.deepEqual(
    events.flatMap((event) => (event.type === 'reacted' ? [event.reactions.map((reaction) => reaction.emoji).join('')] : [])),
    ['🎉', '🎉', '🎉👍', '👍'],
  )

  const reply = await Operations.say(w.env, { parent: message, swarm: id, text: 'nice' }, rider)
  assert.ok(reply.ok)
  assert.ok((await Operations.react(w.env, { emoji: '❤️', message: reply.value.message.id, swarm: id }, rider)).ok)
  const thread = await Operations.replies(w.env, { message, swarm: id })
  assert.ok(thread.ok)
  assert.deepEqual(thread.value.replies[0]?.reactions, [{ emoji: '❤️', who: [rider.toLowerCase()] }])

  const odd = await Operations.react(w.env, { emoji: '🦄', message, swarm: id }, rider)
  assert.ok(!odd.ok && odd.status === 400)
  const gone = await Operations.react(w.env, { emoji: '👍', message: 999, swarm: id }, rider)
  assert.ok(!gone.ok && gone.status === 404)
  const outsider = await Operations.react(w.env, { emoji: '👍', message, swarm: id }, bo)
  assert.ok(!outsider.ok && outsider.status === 403)
  const anonymous = await Operations.react(w.env, { emoji: '👍', message, swarm: id })
  assert.ok(!anonymous.ok && anonymous.status === 401)
})

test('reactions are paced per person', async (t) => {
  const w = await room(t)
  const first = await Operations.say(w.env, { swarm: id, text: 'react to me' }, rider)
  assert.ok(first.ok)
  for (let n = 0; n < Reaction.perMinute; n++) assert.ok((await Operations.react(w.env, { emoji: Reaction.emojis[n % Reaction.emojis.length]!, message: first.value.message.id, on: n % 2 === 0, swarm: id }, rider)).ok)
  const paced = await Operations.react(w.env, { emoji: '👍', message: first.value.message.id, swarm: id }, rider)
  assert.ok(!paced.ok && paced.status === 429)
  w.pass(61_000)
  assert.ok((await Operations.react(w.env, { emoji: '👍', message: first.value.message.id, swarm: id }, rider)).ok)
})

function tree(t: { after: (done: () => void | Promise<void>) => void }) {
  const deposits = new Map<string, { amount: string; from: string; tag: string }>()
  const w = world(async (request, url) => {
    if (url.pathname === '/v1/models') return Response.json({ data: [Setup.flash, Setup.glmFlash, Setup.fable, Setup.sol].map((model) => ({ id: model, kind: 'generate', pricing: { cached: 0.01, input: 0.1, output: 0.4 } })) })
    if (url.pathname === '/api/keys/me') return Response.json({ wallet: owner })
    if (url.pathname === '/api/keys/credit' && request.method === 'POST') {
      const { hash } = (await request.json()) as { hash: string }
      const found = deposits.get(hash)
      if (!found) return Response.json({ error: 'no receipt' }, { status: 404 })
      return Response.json({ created: true, credit: { deposited: found.amount, left: found.amount, spent: '0' }, deposits: [{ ...found, log: 0, token: 'pathusd' }] })
    }
    if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_d' })
    if (url.pathname.startsWith('/v1/agents/agt_d')) return Response.json(url.pathname.endsWith('/subagents') ? { agents: [] } : { request_id: 'x', status: 'queued' })
    return undefined
  })
  ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
  github(w.env)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  return { deposits, w }
}

test('a message to the swarm becomes a board item once paid, and the item posts its run updates in its thread', async (t) => {
  const { deposits, w } = tree(t)
  const made = await Operations.create(w.env, { form: 'tree', goal: 'Settle whether P equals NP, checked in Lean.', seed: [], statement: 'P = NP ∨ P ≠ NP', template: 'cheap', title: 'P vs NP' }, ana)
  assert.ok(made.ok, JSON.stringify(made))
  const swarm = made.value.id
  await named(w, bo, 'bo')
  const said = 'Try restrictions first, @ada'
  const proposed = await Operations.propose(w.env, { parent: 'root', said, spec: said, swarm, title: 'Try restrictions first', token: 'pathusd' }, 'https://swarms.test', bo)
  assert.ok(proposed.ok, JSON.stringify(proposed))
  let read = await Operations.room(w.env, { swarm })
  assert.ok(read.ok)
  assert.equal(read.value.messages.filter((message) => message.author).length, 0)

  const hash = '0x' + '3'.repeat(64)
  deposits.set(hash, { amount: '1', from: bo, tag: Credit.tag(swarm, 'n:' + proposed.value.nid) })
  assert.ok((await Operations.contribute(w.env, { hash, node: proposed.value.nid, swarm })).ok)
  read = await Operations.room(w.env, { swarm })
  assert.ok(read.ok)
  const top = read.value.messages.find((message) => message.author)
  assert.equal(top?.author, bo)
  assert.equal(top?.text, said)
  assert.equal(top?.node, proposed.value.nid)

  Nodes.emit(w.swarm, proposed.value.nid, 'progress', 'Restricted 3 of 5 gates, see https://user:token@code.storage/repo')
  Nodes.emit(w.swarm, proposed.value.nid, 'doing', 'thinking')
  const thread = await Operations.replies(w.env, { message: top!.id, swarm })
  assert.ok(thread.ok, JSON.stringify(thread))
  const updates = thread.value.replies.map((reply) => [reply.author, reply.text])
  assert.ok(updates.every(([author]) => author === null))
  assert.ok(updates.some(([, text]) => String(text).startsWith('@bo rode it with $1')), JSON.stringify(updates))
  assert.ok(updates.some(([, text]) => String(text).startsWith('Restricted 3 of 5 gates')))
  assert.ok(updates.every(([, text]) => !String(text).includes('user:token') && text !== 'thinking'))
  read = await Operations.room(w.env, { swarm })
  assert.ok(read.ok)
  assert.deepEqual(read.value.messages.find((message) => message.id === top!.id)?.replies?.who, [null])
})

test('an unpaid proposal posts nothing to the room', async (t) => {
  const { w } = tree(t)
  const made = await Operations.create(w.env, { form: 'tree', goal: 'Settle whether P equals NP, checked in Lean.', seed: [], statement: 'P = NP ∨ P ≠ NP', template: 'cheap', title: 'P vs NP' }, ana)
  assert.ok(made.ok, JSON.stringify(made))
  const proposed = await Operations.propose(w.env, { parent: 'root', said: 'do this', swarm: made.value.id, title: 'Do this', token: 'pathusd' }, 'https://swarms.test', bo)
  assert.ok(proposed.ok)
  Nodes.emit(w.swarm, 'root', 'progress', 'root moved')
  const read = await Operations.room(w.env, { swarm: made.value.id })
  assert.ok(read.ok)
  assert.ok(read.value.messages.every((message) => !message.node && !message.replies))
})
