import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { open } from './d1.ts'
import './host.ts'

const modules: Record<string, string> = {
  'cloudflare:workers': 'export const waitUntil = () => {}; export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }',
  '#ssr': 'export async function render() { return new ReadableStream({ start(controller) { controller.close() } }) }',
}

registerHooks({
  resolve: (specifier, context, next) => {
    const source = modules[specifier] ?? (context.parentURL?.endsWith('/src/worker/Og.ts') && /\.(wasm|bin)$/.test(specifier) ? 'export default new ArrayBuffer(0)' : undefined)
    return source === undefined ? next(specifier, context) : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) }
  },
})

Object.assign(globalThis, { WebSocketRequestResponsePair: class {}, caches: { default: { match: async () => undefined, put: async () => undefined } } })

const worker = (await import('../src/worker/site.ts')).default
const d1 = open()
d1.sqlite.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, 1, 1)').run('abc123abc123', 'P vs NP', 'Settle it.')
const db = d1.env.DB as unknown as Record<string, unknown>
db['withSession'] = () => db
const opened: { at: string; url: string }[] = []
const answer = (at: string) => ({ fetch: async (request: Request) => (opened.push({ at, url: request.url }), { at, upgraded: true }) })
const env = {
  ...d1.env,
  LOBBY: { getByName: (name: string) => answer(name) },
  SWARMS: { get: (id: string) => answer(id), idFromName: (name: string) => 'room:' + name },
  SWARMS_URL: 'https://paradigm.xyz/swarms',
} as never
const context = { passThroughOnException() {}, props: {}, waitUntil() {} } as never
const upgrade = (url: string) => worker.fetch(new Request(url, { headers: { upgrade: 'websocket' } }), env, context) as unknown as Promise<unknown>

test('a socket upgrade answers with the object own 101 response, untouched by the middleware', async () => {
  assert.deepEqual(await upgrade('https://swarms.new/v1/swarms/live'), { at: 'lobby', upgraded: true })
  assert.deepEqual(await upgrade('https://swarms.tempo-dev.workers.dev/swarms/api/swarms/live'), { at: 'lobby', upgraded: true })
  assert.deepEqual(await upgrade('https://swarms.new/api/general/chat/live'), { at: 'general', upgraded: true })
  assert.deepEqual(await upgrade('https://swarms.new/v1/swarms/abc123abc123/chat/live?listen=1'), { at: 'room:abc123abc123', upgraded: true })
  assert.equal(opened.at(-1)?.url, 'https://swarm/chat?swarm=abc123abc123&listen=1')
})

test('a socket upgrade to a swarm that does not exist answers 404 without opening a room', async () => {
  const before = opened.length
  const response = (await upgrade('https://swarms.new/v1/swarms/nope00000000/chat/live')) as Response
  assert.equal(response.status, 404)
  assert.equal(opened.length, before)
})

test('a plain GET of a socket route still goes through the app', async () => {
  const response = await worker.fetch(new Request('https://swarms.new/v1/swarms/live'), env, context)
  assert.equal(response.status, 400)
})

