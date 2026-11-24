import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock, test } from 'node:test'
import './host.ts'

let configured: () => Promise<unknown> = async () => ({ ready: true })

Object.assign(globalThis, {
  __pageConfig: () => configured(),
})

const modules: Record<string, string> = {
  'cloudflare:workers': 'export const waitUntil = () => {}',
  '#ssr': 'export async function render() { return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("server content")); controller.close() } }) }',
  './Artifacts.ts': '',
  './Edge.ts': '',
  './Og.ts': '',
  './Operations.ts': 'export const config = () => globalThis.__pageConfig()',
  './Share.ts': 'export const share = () => ({ title: "Swarms", description: "Research" }); export const listing = () => ({}); export const plain = () => ({}); export const tags = () => ""',
  './Store.ts': '',
}

registerHooks({
  resolve(specifier, context, next) {
    const source = context.parentURL?.endsWith('/src/worker/Page.ts') ? modules[specifier] : undefined
    return source === undefined ? next(specifier, context) : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) }
  },
})

const Page = await import('../src/worker/Page.ts')
const env = { ASSETS: { fetch: async () => new Response('<html><head></head><body><div id="root"></div></body></html>') }, SWARMS_URL: 'https://swarms.test' } as never
const request = () => new Request('https://swarms.test/docs')

test('a slow configuration read cannot hold the server-rendered page past its data budget', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    configured = () => new Promise(() => {})
    const response = await Page.lost(request(), env)
    const content = response.text()
    let done = false
    void content.then(() => (done = true))
    mock.timers.tick(2499)
    await Promise.resolve()
    assert.equal(done, false)
    mock.timers.tick(1)
    const html = await content
    assert.match(html, /server content/)
    assert.match(html, /window\.__SWARMS_BOOT__/)
    assert.doesNotMatch(html, /"config"/)
  } finally {
    mock.timers.reset()
  }
})

test('a configuration failure still delivers the page for the existing client retry', async () => {
  configured = async () => {
    throw new Error('offline')
  }
  const html = await (await Page.lost(request(), env)).text()
  assert.match(html, /server content/)
  assert.doesNotMatch(html, /"config"/)
})

test('a ready configuration remains in the server-rendered bootstrap', async () => {
  configured = async () => ({ ready: true })
  const html = await (await Page.lost(request(), env)).text()
  assert.match(html, /"config":\{"ready":true\}/)
})

test('the server renders the problems rail the way this session left it', async () => {
  configured = async () => ({ ready: true })
  const open = await (await Page.lost(new Request('https://swarms.test/docs', { headers: { cookie: 'swarms_rail=expanded' } }), env)).text()
  assert.match(open, /"rail":"expanded"/)
  const closed = await (await Page.lost(request(), env)).text()
  assert.match(closed, /"rail":"collapsed"/)
})

test('the server tells the page whether this visitor has seen the welcome', async () => {
  configured = async () => ({ ready: true })
  const fresh = await (await Page.lost(new Request('https://swarms.test/docs'), env)).text()
  assert.match(fresh, /"hello":"new"/)
  const back = await (await Page.lost(new Request('https://swarms.test/docs', { headers: { cookie: 'swarms_hello=1' } }), env)).text()
  assert.match(back, /"hello":"seen"/)
})
