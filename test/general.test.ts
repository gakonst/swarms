import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { world } from './run.ts'
import type * as LobbyModule from '../src/worker/Lobby.ts'
import type * as OperationsModule from '../src/worker/Operations.ts'

const { Lobby }: typeof LobbyModule = await import('../src/worker/Lobby.ts')
const Operations: typeof OperationsModule = await import('../src/worker/Operations.ts')

const ana = ('0x' + 'A'.repeat(40)) as `0x${string}`
const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

function general() {
  const db = new DatabaseSync(':memory:')
  const kv = new Map<string, unknown>()
  const sent: string[] = []
  const sql = {
    exec(query: string, ...values: unknown[]) {
      const statement = db.prepare(query)
      const rows = statement.columns().length ? statement.all(...(values as never[])).map((row) => ({ ...row })) : (statement.run(...(values as never[])), [])
      return { one: () => rows[0], toArray: () => rows }
    },
  }
  const ctx = {
    getWebSockets: () => [{ send: (data: string) => void sent.push(data) }],
    setWebSocketAutoResponse: () => undefined,
    storage: { kv: { delete: (key: string) => kv.delete(key), get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value) }, sql },
  }
  const w = world(async () => undefined)
  const lobby = new Lobby(ctx as never, w.env)
  const names: string[] = []
  ;(w.env as unknown as Record<string, unknown>)['LOBBY'] = {
    getByName: (name: string) => {
      names.push(name)
      return lobby
    },
  }
  return { env: w.env, names, sent }
}

async function named(env: Cloudflare.Env, address: string, name: string) {
  await env.DB.prepare('insert into names (address, name, updated_at) values (?, ?, 1)').bind(address.toLowerCase(), name).run()
}

test('#general takes a message from anyone with a username and reads it back with their name', async () => {
  const room = general()
  await named(room.env, ana, 'ada')
  const signedOut = await Operations.shout(room.env, { text: 'hi' })
  assert.equal(signedOut.ok ? 0 : signedOut.status, 401)
  const nameless = await Operations.shout(room.env, { text: 'hi' }, bo)
  assert.equal(nameless.ok ? '' : nameless.code, 'username_required')
  const empty = await Operations.shout(room.env, { text: '   ' }, ana)
  assert.equal(empty.ok ? 0 : empty.status, 400)
  const first = await Operations.shout(room.env, { text: '  hello, riders  ' }, ana)
  assert.ok(first.ok)
  assert.equal(first.value.name, 'ada')
  assert.equal(first.value.message.author, ana.toLowerCase())
  assert.equal(first.value.message.text, 'hello, riders')
  const second = await Operations.shout(room.env, { text: 'my key is sk-tempo-abcdefghijklmnop' }, ana)
  assert.ok(second.ok)
  assert.equal(second.value.message.text, 'my key is sk-tempo-[redacted]')
  assert.deepEqual(new Set(room.names), new Set(['general']))

  const read = await Operations.general(room.env, {})
  assert.ok(read.ok)
  assert.deepEqual(read.value.messages.map((message) => message.text), ['hello, riders', 'my key is sk-tempo-[redacted]'])
  assert.deepEqual(read.value.names, { [ana.toLowerCase()]: 'ada' })
  assert.equal(read.value.next, second.value.message.id)
  const after = await Operations.general(room.env, { after: String(first.value.message.id) })
  assert.ok(after.ok)
  assert.deepEqual(after.value.messages.map((message) => message.id), [second.value.message.id])
  const before = await Operations.general(room.env, { before: String(second.value.message.id) })
  assert.ok(before.ok)
  assert.deepEqual(before.value.messages.map((message) => message.id), [first.value.message.id])

  const heard = room.sent.map((data) => JSON.parse(data) as { message: { text: string }; name: string; type: string })
  assert.deepEqual(heard.map((event) => [event.type, event.name, event.message.text]), [['said', 'ada', 'hello, riders'], ['said', 'ada', 'my key is sk-tempo-[redacted]']])
})

test('#general takes at most ten messages a minute from one rider', async () => {
  const room = general()
  await named(room.env, ana, 'ada')
  for (let index = 0; index < 10; index++) assert.ok((await Operations.shout(room.env, { text: `message ${index}` }, ana)).ok)
  const eleventh = await Operations.shout(room.env, { text: 'one more' }, ana)
  assert.equal(eleventh.ok ? '' : eleventh.code, 'rate_limited')
  const read = await Operations.general(room.env, { limit: '5' })
  assert.ok(read.ok)
  assert.deepEqual(read.value.messages.map((message) => message.text), ['message 5', 'message 6', 'message 7', 'message 8', 'message 9'])
})
