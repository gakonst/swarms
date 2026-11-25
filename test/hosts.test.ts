import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { open } from './d1.ts'
import './host.ts'

const site = new URL('../src/shared/Site.ts', import.meta.url).href

const modules: Record<string, string> = {
  'cloudflare:workers': 'export const waitUntil = () => {}; export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }',
  '#ssr': `import * as Site from ${JSON.stringify(site)}; export async function render() { return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('<a href="' + Site.at('/faq') + '">faq</a>')); controller.close() } }) }`,
}

registerHooks({
  resolve: (specifier, context, next) => {
    const source = modules[specifier] ?? (context.parentURL?.endsWith('/src/worker/Og.ts') && /\.(wasm|bin)$/.test(specifier) ? 'export default new ArrayBuffer(0)' : undefined)
    return source === undefined ? next(specifier, context) : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) }
  },
})

Object.assign(globalThis, { WebSocketRequestResponsePair: class {}, caches: { default: { match: async () => undefined, put: async () => undefined } } })

const worker = (await import('../src/worker/site.ts')).default
const assets: string[] = []
const env = {
  ...open().env,
  ASSETS: {
    fetch: async (request: Request) => {
      const url = new URL(request.url)
      assets.push(url.host + url.pathname)
      return url.pathname === '/index.html' ? new Response('<html><head><title>x</title></head><body><div id="root"></div></body></html>') : url.pathname.startsWith('/assets/') ? new Response('asset') : new Response(null, { status: 404 })
    },
  },
  GATEWAY: { fetch: async () => Response.json({ code: 'not_found' }, { status: 404 }) },
  GATEWAY_URL: 'https://gateway.test',
  SWARMS_URL: 'https://paradigm.xyz/swarms',
} as never
const context = { passThroughOnException() {}, props: {}, waitUntil() {} } as never
const get = (url: string, headers: Record<string, string> = {}) => worker.fetch(new Request(url, { headers: { accept: 'text/html', ...headers } }), env, context)

test('swarms.new serves pages at its root, and the Worker host and paradigm.xyz keep the base', async () => {
  const root = await get('https://swarms.new/faq')
  assert.equal(root.status, 200)
  const html = await root.text()
  assert.match(html, /<a href="\/faq">faq<\/a>/)
  assert.match(html, /"base":""/)
  assert.match(html, /"site":"https:\/\/swarms\.new"/)
  assert.match(html, /"socket":"wss:\/\/swarms\.new"/)
  assert.match(html, /<link rel="canonical" href="https:\/\/swarms\.new\/faq">/)

  const proxied = await get('https://swarms.tempo-dev.workers.dev/swarms/faq', { 'cf-worker': 'paradigm.xyz' })
  assert.equal(proxied.status, 200)
  const under = await proxied.text()
  assert.match(under, /<a href="\/swarms\/faq">faq<\/a>/)
  assert.match(under, /"base":"\/swarms"/)
  assert.match(under, /"site":"https:\/\/paradigm\.xyz\/swarms"/)
  assert.match(under, /<link rel="canonical" href="https:\/\/paradigm\.xyz\/swarms\/faq">/)
})

test('each host moves a stray page to its own address and serves the assets with or without the base', async () => {
  const moved = async (url: string, headers?: Record<string, string>) => {
    const response = await get(url, headers)
    return [response.status, response.headers.get('location')]
  }
  assert.deepEqual(await moved('https://www.swarms.new/faq?x=1'), [301, 'https://swarms.new/faq?x=1'])
  assert.deepEqual(await moved('https://swarms.new/swarms/pequalsnp/chat?x=1'), [301, '/pequalsnp/chat?x=1'])
  assert.deepEqual(await moved('https://swarms.new/swarms'), [301, '/'])
  assert.deepEqual(await moved('https://swarms.tempo-dev.workers.dev/faq'), [301, 'https://paradigm.xyz/swarms/faq'])
  assert.deepEqual(await moved('https://swarms.tempo-dev.workers.dev/faq', { 'cf-worker': 'paradigm.xyz' }), [301, '/swarms/faq'])
  assets.length = 0
  for (const url of ['https://swarms.new/swarms/assets/a.js', 'https://swarms.new/assets/a.js', 'https://swarms.tempo-dev.workers.dev/swarms/assets/a.js']) {
    const response = await get(url, { accept: '*/*' })
    assert.equal(await response.text(), 'asset', url)
  }
  assert.deepEqual(assets, ['swarms.new/assets/a.js', 'swarms.new/assets/a.js', 'swarms.tempo-dev.workers.dev/assets/a.js'])
})
