import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { id, world } from './run.ts'
import older from './rpc-older.json' with { type: 'json' }

// A Worker and its objects can be one version apart for minutes after a
// deploy: a busy object keeps running the previous code while the new Worker
// serves, and during a gradual deploy the previous Worker serves too, against
// objects already on the new code. These tests hold both directions.

const site = new URL('../src/shared/Site.ts', import.meta.url).href
registerHooks({
  resolve: (specifier, context, next) => {
    if (specifier === '#ssr') return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export async function render() { return new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("<p>page</p>")); c.close() } }) }') }
    return next(specifier, context)
  },
  load: (url, context, next) => {
    if (/\.(wasm|bin)$/.test(url)) {
      const source = 'import { readFileSync } from "node:fs"; const data = readFileSync(new URL(' + JSON.stringify(url) + ')); export default data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)'
      return { format: 'module', shortCircuit: true, source }
    }
    return next(url, context)
  },
})
void site

const { Swarm } = await import('../src/worker/Swarm.ts')
const worker = (await import('../src/worker/site.ts')).default
const objects = (await import('../src/worker/index.ts')).default

const missing = (name: string) => Promise.reject(new TypeError('The RPC receiver does not implement the method "' + name + '".'))

// An object on the previous version, reached over RPC: only the methods it
// had answer, every call returns a promise, and its view may predate fields
// the Worker reads now (failure, reason).
function previous(swarm: object, methods: readonly string[]) {
  const known = new Set(methods)
  return new Proxy(swarm, {
    get(target, property) {
      if (typeof property !== 'string' || property === 'then') return undefined
      if (!known.has(property)) return () => missing(property)
      const value = Reflect.get(target, property) as unknown
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        const result = await Reflect.apply(value as (...args: unknown[]) => unknown, target, args)
        if (property !== 'view' || !result || typeof result !== 'object') return result
        const { failure: _failure, reason: _reason, ...rest } = result as Record<string, unknown>
        return rest
      }
    },
  })
}

function workerCalls() {
  const dir = new URL('../src/worker/', import.meta.url)
  const called = new Set<string>()
  for (const file of ['Operations.ts', 'Machines.ts', 'Og.ts', 'Page.ts', 'Rest.ts', 'Mcp.ts', 'index.ts', 'site.ts', 'Posters.ts', 'Telegram.ts', 'Watch.ts', 'Lobby.ts']) {
    let source = ''
    try { source = readFileSync(new URL(file, dir), 'utf8') } catch { continue }
    for (const match of source.matchAll(/\bstub\(env, [^)]*\)\.(\w+)\(/g)) called.add(match[1]!)
    for (const named of source.matchAll(/const (\w+) = stub\(/g)) for (const match of source.matchAll(new RegExp('\\b' + named[1] + '\\.(\\w+)\\(', 'g'))) called.add(match[1]!)
  }
  return called
}

test('every swarm object method the Worker calls is on the previous object or listed with its fallback', () => {
  const known = new Set(older.methods)
  const unexplained = [...workerCalls()].filter((name) => !known.has(name) && !(name in older.fallbacks))
  assert.deepEqual(unexplained, [], 'a new object method needs a fallback to the previous one in the Worker and an entry in test/rpc-older.json fallbacks')
})

test('the object still answers every method the previous Worker called', () => {
  const gone = older.methods.filter((name) => typeof (Swarm.prototype as unknown as Record<string, unknown>)[name] !== 'function')
  assert.deepEqual(gone, [], 'keep a removed or renamed object method for one more deploy: the previous Worker still calls it')
})

test('the Worker serves a swarm whose object is one version behind', async (t) => {
  const w = world(() => undefined)
  t.after(w.restore)
  await w.seed()
  // The Worker's own D1 wrappers read raw and withSession, which the test D1 lacks.
  type Statement = Record<string, (...args: unknown[]) => unknown>
  const statement = (prepared: Statement): Statement => ({
    ...prepared,
    bind: (...values: unknown[]) => statement(prepared['bind']!(...values) as Statement),
    raw: async () => ((await prepared['all']!()) as { results: Record<string, unknown>[] }).results.map((row) => Object.values(row)),
  })
  const d1 = w.env.DB as unknown as Statement
  const db: Record<string, unknown> = { ...d1, prepare: (query: string) => statement(d1['prepare']!(query) as Statement) }
  db['withSession'] = () => db
  const env = {
    ...w.env,
    DB: db,
    ASSETS: { fetch: async (request: Request) => (new URL(request.url).pathname === '/index.html' ? new Response('<html><head><title>x</title></head><body><div id="root"></div></body></html>') : new Response(null, { status: 404 })) },
    SWARMS: { get: () => previous(w.swarm, older.methods), idFromName: (name: string) => name },
  } as unknown as Cloudflare.Env
  const context = { passThroughOnException() {}, props: {}, waitUntil() {} } as never
  env.OBJECTS = { fetch: (request: Request) => objects.fetch(request, env) } as unknown as Fetcher
  const base = 'https://swarms.new'
  const get = (path: string, init: RequestInit = {}) => worker.fetch(new Request(base + path, init), env, context)
  const errors: unknown[] = []
  const error = console.error
  console.error = (...args: unknown[]) => void errors.push(args)
  t.after(() => void (console.error = error))

  const detail = await get('/v1/swarms/' + id)
  assert.equal(detail.status, 200, (await detail.clone().text()) + JSON.stringify(errors.map((e) => (e as unknown[]).map((x) => (x instanceof Error ? x.stack : String(x))))))
  const body = (await detail.json()) as { failure?: unknown; reason?: unknown }
  assert.ok('failure' in body, 'the detail always carries failure')
  assert.equal(body.failure, null)
  assert.equal(body.reason ?? null, null)

  for (const path of ['/api/swarms/' + id, '/v1/swarms/' + id + '/answer', '/v1/swarms/' + id + '/backers', '/x/s/' + id, '/tg/s/' + id, '/oembed?url=' + encodeURIComponent(base + '/s/' + id), '/og/s/' + id + '/card.png']) {
    const response = await get(path)
    assert.equal(response.status, 200, path + ': ' + (await response.clone().text()).slice(0, 300))
    await response.body?.cancel()
  }

  const stop = new AbortController()
  const live = await get('/v1/swarms/' + id + '/live', { signal: stop.signal })
  assert.equal(live.status, 200)
  stop.abort()
  await live.body?.cancel().catch(() => undefined)

  for (const name of ['swarm_get', 'swarm_answer', 'swarm_backers']) {
    const response = await get('/mcp', { body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: 'tools/call', params: { arguments: { swarm: id }, name } }), headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, method: 'POST' })
    const text = await response.text()
    assert.equal(response.status, 200, name)
    assert.doesNotMatch(text, /does not implement|"isError":true/, name + ': ' + text.slice(0, 300))
  }
})
