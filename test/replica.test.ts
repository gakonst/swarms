import assert from 'node:assert/strict'
import test from 'node:test'
import * as Replica from '../src/worker/Replica.ts'

function db(log: string[], name: string): D1Database {
  const session = (constraint?: string) => {
    let asked = false
    return {
      batch: async () => [],
      getBookmark: () => (asked ? `${name}-bookmark` : null),
      prepare: (query: string) => {
        asked = true
        log.push(`${name}:${constraint}:${query}`)
        return { first: async () => null } as unknown as D1PreparedStatement
      },
    }
  }
  return {
    batch: async () => [],
    dump: async () => new ArrayBuffer(0),
    exec: async () => ({ count: 0, duration: 0 }),
    prepare: (query: string) => {
      log.push(`${name}:primary:${query}`)
      return { first: async () => null } as unknown as D1PreparedStatement
    },
    withSession: (constraint?: string) => session(constraint) as unknown as D1DatabaseSession,
  }
}

test('only reads go to a replica, and money and sign-in stay on the primary', () => {
  for (const path of ['/', '/join', '/s/abc', '/s/abc/code', '/x', '/x/s/abc', '/api/swarms', '/api/swarms/abc', '/api/swarms/abc/feed', '/api/swarms/abc/git/log', '/api/swarms/abc/chat', '/v1/swarms/abc/updates', '/v1/search', '/v1/me'])
    assert.ok(Replica.readable('GET', path), path)
  for (const path of ['/v1/auth/challenge', '/api/config', '/a/abc/slug/index.html', '/mcp'])
    assert.ok(!Replica.readable('GET', path), path)
  assert.ok(!Replica.readable('POST', '/api/swarms'))
  assert.ok(Replica.writes('POST', '/api/swarms/abc/contributions'))
  assert.ok(!Replica.writes('POST', '/api/swarms/abc/pay'))
  assert.ok(!Replica.writes('POST', '/v1/auth'))
  assert.ok(!Replica.writes('GET', '/api/swarms/abc'))
})

test('a visitor reads from their own bookmark, and a bad one is ignored', () => {
  const log: string[] = []
  const env = { DB: db(log, 'db') } as unknown as Cloudflare.Env
  const given = new Request('https://swarms.test/api/swarms', { headers: { cookie: 'swarms_tz=UTC; swarms_d1=00000001-0000000a-00004f8f-c3a1b2c3d4e5f60718293a4b5c6d7e8f' } })
  const replica = Replica.read(env, given)
  replica.DB.prepare('select 1')
  assert.deepEqual(log, ['db:00000001-0000000a-00004f8f-c3a1b2c3d4e5f60718293a4b5c6d7e8f:select 1'])
  assert.ok(Replica.replicated(replica))
  assert.equal(Replica.primary(replica), env)
  assert.equal(Replica.primary(env), env)
  assert.equal(Replica.bookmark(new Request('https://swarms.test', { headers: { cookie: 'swarms_d1=zzzz-not-a-bookmark' } })), undefined)
  Replica.read(env, new Request('https://swarms.test', { headers: { [Replica.header]: 'x;y' } })).DB.prepare('select 2')
  assert.equal(log.at(-1), 'db:first-unconstrained:select 2')
})

test("a write hands back its own session's bookmark in a header and a cookie, with no query of its own", async () => {
  const log: string[] = []
  const env = { DB: db(log, 'db') } as unknown as Cloudflare.Env
  const written = Replica.write(env)
  assert.equal(Replica.primary(written), env)
  const untouched = Response.json({ ok: true })
  assert.equal(Replica.mark(written, untouched), untouched)
  assert.equal(Replica.mark(env, untouched), untouched)

  written.DB.prepare("insert into names (address, name, updated_at) values ('0x1', 'ada', 1)")
  const marked = Replica.mark(written, Response.json({ ok: true }, { status: 201 }))
  assert.equal(marked.status, 201)
  assert.equal(marked.headers.get(Replica.header), 'db-bookmark')
  assert.match(marked.headers.get('set-cookie') ?? '', /^swarms_d1=db-bookmark; Path=\/; Max-Age=300/)
  assert.deepEqual(await marked.json(), { ok: true })
  assert.deepEqual(log, ["db:first-primary:insert into names (address, name, updated_at) values ('0x1', 'ada', 1)"])
})
