import assert from 'node:assert/strict'
import test from 'node:test'
import type { Overview } from '../src/shared/Api.ts'
import * as XFrames from '../src/worker/XFrames.ts'

const overview: Overview = {
  answer: null,
  code: null,
  contributions: [],
  contributors: 3,
  createdAt: 1,
  goal: 'Test <script> without placing markup in the player page.',
  hands: [],
  id: 'abc123',
  machines: 0,
  notes: [],
  pool: '0.000000',
  raised: '1.250000',
  reason: null,
  remaining: '0.750000',
  spent: '0.500000',
  status: 'running',
  title: 'Safer <signatures>',
  updatedAt: 2,
  updates: [],
  wallet: null,
  working: null,
}

test('start frame publishes an X player card that sends people to the swarm page to pay', async () => {
  const response = XFrames.start('https://swarms.example')
  const html = await response.text()

  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
  assert.match(html, /name="twitter:card" content="player"/)
  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x"/)
  assert.match(html, /Open the swarm to pay/)
  assert.match(html, /Launch/)
  assert.match(html, /Quantum-safe signatures/)
})

test('card scripts parse', async () => {
  const pages = [
    await XFrames.start('https://swarms.example', [], new URL('https://swarms.example/x?xframes-content=')).text(),
    await XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?xframes-content=')).text(),
  ]

  for (const html of pages) for (const found of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(found[1] ?? ''))
})

test('swarm frame escapes research text and points the player at its own route', async () => {
  const response = XFrames.swarm('https://swarms.example', overview)
  const html = await response.text()

  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123"/)
  assert.match(html, /Safer &lt;signatures&gt;/)
  assert.match(html, /Test &lt;script&gt;/)
  assert.doesNotMatch(html, /<script> without placing/)
  assert.match(html, />Fund</)
})

test('a working swarm frame streams the agent live from when it started', async () => {
  const working: Overview = { ...overview, updates: [{ at: 9, base: null, commits: [], done: false, excerpt: 'zstd <wins>', spent: '0.1' }], working: { since: 10 } }
  const html = await XFrames.swarm('https://swarms.example', working).text()

  assert.match(html, /<title>Live: Safer &lt;signatures&gt;<\/title>/)
  assert.match(html, /\/live\?after='\+seen/)
  assert.match(html, /href="https:\/\/swarms\.example\/s\/abc123"/)
  assert.match(html, /"live":\{"since":10\}/)
  assert.match(html, /zstd &lt;wins&gt;/)
  assert.doesNotMatch(html, /\b[Rr]ound \d|ROUND|[Ee]xplorer|[Rr]esearcher/)
  assert.match(html, />Fund</)
})

test('a swarm frame that is not working shows the latest update', async () => {
  const html = await XFrames.swarm('https://swarms.example', { ...overview, status: 'paused', updates: [{ at: 9, base: null, commits: [], done: false, excerpt: 'zstd wins on cost', spent: '0.1' }] }).text()

  assert.match(html, /<title>Fund Safer/)
  assert.match(html, /zstd wins on cost/)
  assert.match(html, /"live":null/)
})

test('card image escapes its title', async () => {
  const response = XFrames.card('Explore <science>')
  const svg = await response.text()

  assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
  assert.match(svg, /Explore &lt;science&gt;/)
  assert.doesNotMatch(svg, /Explore <science>/)
})

test('a frame is served as a trusted player around its sandboxed card, as xframes does', async () => {
  const outer = XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?view=fund'))
  const html = await outer.text()
  assert.doesNotMatch(outer.headers.get('content-security-policy') ?? '', /sandbox/)
  assert.match(html, /name="twitter:player" content="https:\/\/swarms\.example\/x\/s\/abc123"/)
  assert.match(html, /<iframe id="xframe-player"[^>]*sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"/)
  assert.match(html, /xframes-content/)
  assert.doesNotMatch(html, />Fund</)

  const inner = XFrames.swarm('https://swarms.example', overview, new URL('https://swarms.example/x/s/abc123?view=fund&xframes-content='))
  assert.match(inner.headers.get('content-security-policy') ?? '', /^sandbox /)
  const card = await inner.text()
  assert.match(card, /"hosted":true/)
  assert.match(card, />Fund</)
})
