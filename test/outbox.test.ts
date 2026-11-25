import assert from 'node:assert/strict'
import test from 'node:test'
import type { Said } from '../src/shared/Api.ts'
import * as Outbox from '../src/web/outbox.ts'

const me = '0x00000000000000000000000000000000000000aa'
const them = '0x00000000000000000000000000000000000000bb'
const place = 'room:abcdef012345'

function said(id: number, text: string, author: string | null = me, parent?: number): Said {
  return { artifact: null, at: id, author: author as Said['author'], id, mentions: [], steer: null, text, ...(parent !== undefined ? { parent } : {}) }
}

function gate<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const view = (messages: Said[]) => Outbox.shown(place, messages, Outbox.list(place))

test('a message shows at once as sending, and the echo takes its place under the same key without a second copy', async () => {
  Outbox.reset()
  const answer = gate<Said>()
  Outbox.define('room', () => answer.promise)
  const client = Outbox.send(place, { after: 2, author: me, text: ' hello ' })
  const room = [said(1, 'first', them), said(2, 'hello')]
  const pending = view(room)
  assert.deepEqual(pending.shown.map((each) => each.sending), [undefined, undefined, 'sending'])
  assert.equal(Outbox.key(pending.shown[2]!), `c${client}`)
  assert.equal(pending.shown[2]!.text, 'hello')
  assert.deepEqual(pending.landed, [], 'an older message with the same words is not the echo')

  const echoed = [...room, said(3, 'hello')]
  const after = view(echoed)
  assert.equal(after.shown.length, 3, 'no duplicate')
  assert.equal(after.shown[2]!.id, 3)
  assert.equal(after.shown[2]!.sending, undefined)
  assert.equal(Outbox.key(after.shown[2]!), `c${client}`, 'the echo keeps the key, so the node stays')
  assert.deepEqual(after.landed, [client])
  Outbox.forget(client)
  answer.resolve(said(3, 'hello'))
  await tick()
  assert.equal(Outbox.draft(client), undefined, 'a late answer for a forgotten draft changes nothing')
  assert.equal(Outbox.key(view(echoed).shown[2]!), `c${client}`, 'the key outlives the draft')
})

test('the answer can arrive before the echo: it sits by its id, pending ones after everything, and the echo lands without moving it', async () => {
  Outbox.reset()
  Outbox.define('room', async () => said(5, 'yo'))
  const first = Outbox.send(place, { after: 3, author: me, text: 'yo' })
  Outbox.define('room', () => new Promise<Said>(() => {}))
  Outbox.send(place, { after: 3, author: me, text: 'later' })
  await tick()
  assert.equal(Outbox.draft(first)?.state, 'sent')
  const before = view([said(3, 'old', them), said(6, 'from them', them)])
  assert.deepEqual(before.shown.map((each) => [each.text, each.sending]), [['old', undefined], ['yo', undefined], ['from them', undefined], ['later', 'sending']])
  assert.deepEqual(before.landed, [])
  const echoed = view([said(3, 'old', them), said(5, 'yo'), said(6, 'from them', them)])
  assert.deepEqual(echoed.shown.map((each) => each.text), ['old', 'yo', 'from them', 'later'])
  assert.deepEqual(echoed.landed, [first])
  assert.equal(Outbox.key(echoed.shown[1]!), `c${first}`)
})

test('two drafts with the same words claim two echoes in order, a redacted echo still matches, and others never do', () => {
  Outbox.reset()
  Outbox.define('room', () => new Promise<Said>(() => {}))
  const a = Outbox.send(place, { after: 0, author: me, text: 'same' })
  const b = Outbox.send(place, { after: 0, author: me, text: 'same' })
  const key = Outbox.send(place, { after: 0, author: me, text: 'my key sk-tempo-abcdefghijkl' })
  const all = view([said(1, 'same'), said(2, 'same'), said(3, 'my key sk-tempo-[redacted]')])
  assert.equal(all.shown.length, 3)
  assert.deepEqual(all.landed, [a, b, key])
  assert.deepEqual(all.shown.map(Outbox.key), [`c${a}`, `c${b}`, `c${key}`])
  assert.deepEqual(view([said(4, 'same', them)]).landed, [], 'someone else saying the same is not my echo')
  assert.deepEqual(view([said(4, 'same', me, 9)]).landed, [], 'a reply in a thread is not my room message')
  assert.deepEqual(view([said(4, 'same', me.toUpperCase().replace('0X', '0x'))]).landed.length, 1, 'addresses match in any case')
})

test('a refusal shows inline and retries; an offline send waits and goes on resume', async () => {
  Outbox.reset()
  let calls = 0
  Outbox.define('room', async () => {
    calls++
    if (calls === 1) throw new Error('At most 10 messages a minute in a room; wait a moment.')
    if (calls === 2) throw new TypeError('Failed to fetch')
    return said(7, 'retry me')
  })
  const client = Outbox.send(place, { after: 0, author: me, text: 'retry me' })
  await tick()
  assert.equal(Outbox.draft(client)?.state, 'failed')
  const failed = view([]).shown[0]!
  assert.equal(failed.sending, 'failed')
  assert.match(failed.error ?? '', /10 messages/)
  Outbox.retry(client)
  assert.equal(Outbox.draft(client)?.state, 'sending')
  assert.equal(Outbox.draft(client)?.error, undefined)
  await tick()
  assert.equal(Outbox.draft(client)?.state, 'queued')
  Outbox.resume()
  await tick()
  assert.equal(Outbox.draft(client)?.state, 'sent')
  assert.equal(calls, 3)
  assert.equal(view([]).shown[0]!.id, 7)
  Outbox.forget(client)
  assert.deepEqual(Outbox.list(place), [])
})

test('a reaction in flight survives an older answer or echo, and the latest toggle wins', () => {
  Outbox.reset()
  const swarm = 'abcdef012345'
  const land = Outbox.fly(swarm, 4, '👍', me, true)
  assert.deepEqual(Outbox.held(swarm, 4, [{ emoji: '👍', who: [them] }]), [{ emoji: '👍', who: [them, me] }])
  assert.deepEqual(Outbox.held(swarm, 4, [{ emoji: '👍', who: [them, me] }]), [{ emoji: '👍', who: [them, me] }])
  const off = Outbox.fly(swarm, 4, '👍', me, false)
  land()
  assert.deepEqual(Outbox.held(swarm, 4, [{ emoji: '👍', who: [them, me] }]), [{ emoji: '👍', who: [them] }])
  off()
  assert.deepEqual(Outbox.held(swarm, 4, [{ emoji: '👍', who: [them, me] }]), [{ emoji: '👍', who: [them, me] }])
  assert.deepEqual(Outbox.held(swarm, 5, []), [])
})
