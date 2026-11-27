import { DatabaseSync } from 'node:sqlite'
import type * as M1 from '../run.ts'
import type * as LobbyModule from '../../src/worker/Lobby.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function general(seed: string): Promise<Outcome> {
  const random = rng('general', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const { world } = await load<typeof M1>('test/run.ts')

  const { Lobby } = await load<typeof LobbyModule>('src/worker/Lobby.ts')
  const Operations = await load<typeof OperationsModule>('src/worker/Operations.ts')

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
      storage: {
        kv: { delete: (key: string) => kv.delete(key), get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value) },
        sql,
      },
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

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      '#general takes a message from anyone with a username and reads it back with their name',
      async (_t) => {
        const room = general()
        await named(room.env, ana, 'ada')
        const signedOut = await Operations.shout(room.env, { text: 'hi' })
        a.equal(signedOut.ok ? 0 : signedOut.status, 401)
        const nameless = await Operations.shout(room.env, { text: 'hi' }, bo)
        a.equal(nameless.ok ? '' : nameless.code, 'username_required')
        const empty = await Operations.shout(room.env, { text: '   ' }, ana)
        a.equal(empty.ok ? 0 : empty.status, 400)
        const first = await Operations.shout(room.env, { text: '  hello, riders  ' }, ana)
        a.ok(first.ok)
        a.equal(first.value.name, 'ada')
        a.equal(first.value.message.author, ana.toLowerCase())
        a.equal(first.value.message.text, 'hello, riders')
        const second = await Operations.shout(room.env, { text: 'my key is sk-tempo-abcdefghijklmnop' }, ana)
        a.ok(second.ok)
        a.equal(second.value.message.text, 'my key is sk-tempo-[redacted]')
        a.deepEqual(new Set(room.names), new Set(['general']))

        const read = await Operations.general(room.env, {})
        a.ok(read.ok)
        a.deepEqual(
          read.value.messages.map((message) => message.text),
          ['hello, riders', 'my key is sk-tempo-[redacted]'],
        )
        a.deepEqual(read.value.names, { [ana.toLowerCase()]: 'ada' })
        a.equal(read.value.next, second.value.message.id)
        const after = await Operations.general(room.env, { after: String(first.value.message.id) })
        a.ok(after.ok)
        a.deepEqual(
          after.value.messages.map((message) => message.id),
          [second.value.message.id],
        )
        const before = await Operations.general(room.env, { before: String(second.value.message.id) })
        a.ok(before.ok)
        a.deepEqual(
          before.value.messages.map((message) => message.id),
          [first.value.message.id],
        )

        const heard = room.sent.map((data) => JSON.parse(data) as { message: { text: string }; name: string; type: string })
        a.deepEqual(
          heard.map((event) => [event.type, event.name, event.message.text]),
          [
            ['said', 'ada', 'hello, riders'],
            ['said', 'ada', 'my key is sk-tempo-[redacted]'],
          ],
        )
      },
    ],
    [
      '#general takes at most ten messages a minute from one rider',
      async (_t) => {
        const room = general()
        await named(room.env, ana, 'ada')
        for (let index = 0; index < 10; index++) a.ok((await Operations.shout(room.env, { text: `message ${index}` }, ana)).ok)
        const eleventh = await Operations.shout(room.env, { text: 'one more' }, ana)
        a.equal(eleventh.ok ? '' : eleventh.code, 'rate_limited')
        const read = await Operations.general(room.env, { limit: '5' })
        a.ok(read.ok)
        a.deepEqual(
          read.value.messages.map((message) => message.text),
          ['message 5', 'message 6', 'message 7', 'message 8', 'message 9'],
        )
      },
    ],
    [
      'a #general message is stored and read back whole, however long',
      async (_t) => {
        const room = general()
        await named(room.env, ana, 'ada')
        const text = Array.from({ length: 4_000 }, () => random.pick(['lemma', 'cache', 'é', '中', '😀', 'the'])).join(' ')
        const posted = await Operations.shout(room.env, { text }, ana)
        a.ok(posted.ok && posted.value.message.text === text, 'the shout answers the whole message')
        const read = await Operations.general(room.env, {})
        a.ok(read.ok && read.value.messages.some((message) => message.text === text), '#general holds the whole message')
      },
    ],
  ]
  for (const [dstName, dstRun] of [...dstCases].sort(() => random.next() - 0.5)) {
    a.as(dstName)
    try {
      await dstRun({ after: (fn) => void afters.push(fn) })
    } catch (error) {
      fail(dstName, String((error as Error)?.stack ?? error).slice(0, 400))
    } finally {
      for (const fn of afters.splice(0).reverse()) await fn()
    }
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { general }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('general.whole', 'src/worker/Lobby.ts', 'const text = redact(input.text)', 'const text = redact(input.text).slice(0, 1000)'),
    invariant: 'a #general message is stored and read back whole, however long',
    name: 'general.whole',
    scenario: 'general',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'general.named',
      'src/worker/Operations.ts',
      "  if (!account.name) return unnamed()\n  const long = Texts.beyond('The message', parsed.value.text",
      "  if (false) return unnamed()\n  const long = Texts.beyond('The message', parsed.value.text",
    ),
    invariant: '#general takes a message from anyone with a username and reads it back with their name',
    name: 'general.named',
    scenario: 'general',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('general.redact', 'src/worker/Lobby.ts', '    const text = redact(input.text)', '    const text = input.text'),
    invariant: '#general takes a message from anyone with a username and reads it back with their name',
    name: 'general.redact',
    scenario: 'general',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'general.rate',
      'src/worker/Lobby.ts',
      '    if (recent.length >= postsPerMinute) return null',
      '    if (recent.length > postsPerMinute) return null',
    ),
    invariant: '#general takes at most ten messages a minute from one rider',
    name: 'general.rate',
    scenario: 'general',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'general.before',
      'src/worker/Lobby.ts',
      '`${columns} WHERE id < ? ORDER BY id DESC LIMIT ?`',
      '`${columns} WHERE id <= ? ORDER BY id DESC LIMIT ?`',
    ),
    invariant: '#general takes a message from anyone with a username and reads it back with their name',
    name: 'general.before',
    scenario: 'general',
    seeds: ['1', '2', '3'],
  },
]
