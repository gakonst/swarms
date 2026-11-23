import * as assert from 'node:assert/strict'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, test } from 'node:test'
import * as Chrome from './chrome.ts'
import * as Dev from './dev.ts'
import { type Rider, rider } from './rider.ts'

const shots = process.env['E2E_SHOTS'] ?? path.join(os.tmpdir(), 'swarms-e2e-shots')
const goal = 'Find out whether nicknamed swarm pages hold up end to end, on mocks.'

let dev: Dev.Dev
let ana: Rider
let bob: Rider

before(async () => {
  dev = await Dev.start()
  ana = await rider(dev, 'ana')
  bob = await rider(dev, 'bob')
})

after(async () => {
  await dev?.stop()
})

async function page(route: string) {
  const response = await fetch(dev.url + route, { headers: { accept: 'text/html' }, redirect: 'manual' })
  return { html: await response.text(), location: response.headers.get('location'), status: response.status }
}

test('a nickname is set, renamed and claimed through the API, and every old address moves to the page it names', async () => {
  const made = await ana.call<{ id: string; nickname: string | null }>('POST', '/v1/swarms', { goal, nickname: 'first-name', template: 'cheap', title: 'Nicknamed (e2e)' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  assert.equal(made.body.nickname, 'first-name')
  const id = made.body.id
  const twin = await bob.call('POST', '/v1/swarms', { goal, nickname: 'first-name', template: 'cheap', title: 'Twin (e2e)' })
  assert.equal(twin.status, 409)
  const reserved = await bob.call('POST', '/v1/swarms', { goal, nickname: 'docs', template: 'cheap', title: 'Reserved (e2e)' })
  assert.equal(reserved.status, 400)

  const shown = await page('/first-name')
  assert.equal(shown.status, 200)
  assert.match(shown.html, new RegExp(`<link rel="canonical" href="${dev.url}/first-name">`))
  assert.match(shown.html, /<title>Nicknamed \(e2e\) · Swarms<\/title>/)
  assert.match(shown.html, new RegExp(`"name:first-name":\{"name":"first-name","nickname":"first-name","swarm":"${id}"\}`))
  const old = await page(`/s/${id}/chat?x=1`)
  assert.deepEqual([old.status, old.location], [301, '/swarms/first-name/chat?x=1'])
  const named = await dev.call('GET', '/v1/names/first-name')
  assert.deepEqual(named.body, { name: 'first-name', nickname: 'first-name', swarm: id })

  assert.equal((await dev.call('PATCH', `/v1/swarms/${id}`, { nickname: 'second-name' })).status, 401)
  assert.equal((await bob.call('PATCH', `/v1/swarms/${id}`, { nickname: 'second-name' })).status, 403)
  const renamed = await ana.call<{ nickname: string }>('PATCH', `/v1/swarms/${id}`, { nickname: 'second-name' })
  assert.deepEqual([renamed.status, renamed.body.nickname], [200, 'second-name'])
  const moved = await page('/first-name/results?r=chart')
  assert.deepEqual([moved.status, moved.location], [301, '/swarms/second-name/results?r=chart'])
  assert.equal((await page('/second-name')).status, 200)

  const operated = await dev.call<{ nickname: string }>('PATCH', `/v1/swarms/${id}`, { nickname: 'pequalsnp' }, dev.env['SWARMS_GATEWAY_KEY'])
  assert.deepEqual([operated.status, operated.body.nickname], [200, 'pequalsnp'])
  assert.deepEqual([(await page('/second-name')).location, (await page('/first-name')).location], ['/swarms/pequalsnp', '/swarms/pequalsnp'])

  const theirs = await bob.call<{ id: string }>('POST', '/v1/swarms', { goal, template: 'cheap', title: 'Claims a freed name (e2e)' })
  const claimed = await bob.call<{ nickname: string }>('PATCH', `/v1/swarms/${theirs.body.id}`, { nickname: 'first-name' })
  assert.deepEqual([claimed.status, claimed.body.nickname], [200, 'first-name'])
  const now = await page('/first-name')
  assert.equal(now.status, 200)
  assert.match(now.html, /<title>Claims a freed name \(e2e\) · Swarms<\/title>/)
  assert.equal((await bob.call('PATCH', `/v1/swarms/${theirs.body.id}`, { nickname: 'pequalsnp' })).status, 409)

  const embedded = await dev.call<{ title: string }>('GET', '/oembed?url=' + encodeURIComponent(dev.url + '/pequalsnp'))
  assert.deepEqual([embedded.status, embedded.body.title], [200, 'Nicknamed (e2e) · Swarms'])
  const openapi = await dev.call<{ paths: Record<string, Record<string, unknown>> }>('GET', '/openapi.json')
  assert.ok(openapi.body.paths['/v1/swarms/{id}']?.['patch'] && openapi.body.paths['/v1/names/{name}']?.['get'])
})

test('a free name shows the new-swarm page in place, an idea name prefills the idea, and routes and ids never do', async () => {
  const idea = await page('/pq-signatures')
  assert.equal(idea.status, 200)
  assert.match(idea.html, /Better post-quantum signatures/)
  assert.match(idea.html, /"name:pq-signatures":null/)
  assert.match(idea.html, new RegExp(`<link rel="canonical" href="${dev.url}/pq-signatures">`))
  const topic = await page('/faster-json-parsing')
  assert.equal(topic.status, 200)
  assert.match(topic.html, /faster json parsing<\/textarea>/)
  assert.match(topic.html, /<b>faster-json-parsing<\/b>/)
  assert.equal((await page('/faster-json-parsing/chat')).status, 404)
  assert.equal((await page('/0123456789ab')).status, 404)
  assert.equal((await page('/ab')).status, 404)
  const docs = await page('/docs')
  assert.equal(docs.status, 200)
  assert.doesNotMatch(docs.html, /"name:docs"/)
  const asked = await page('/new?q=pq-signatures&template=cheap')
  assert.deepEqual([asked.status, asked.location], [301, '/swarms/pq-signatures?template=cheap'])
  const plain = await page('/new')
  assert.equal(plain.status, 200)
})

test('starting a swarm at a free name keeps the address and turns the page into the swarm without a spinner', async () => {
  const chrome = await Chrome.open()
  const evaluate = async <value>(expression: string) => ((await chrome.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })) as { result?: { value?: value } }).result?.value
  try {
    await chrome.shoot(dev.url + '/pq-signatures?fixture&scene=in', 'desktop', path.join(shots, 'fixture-create-at-name.png'))
    assert.equal(await evaluate<string>('document.querySelector("h1")?.textContent'), 'Better post-quantum signatures')
    await evaluate(`(() => { window.__flashed = []; new MutationObserver(() => { if (document.querySelector('.lost-orbit, .page.lost')) window.__flashed.push(location.pathname) }).observe(document.body, { childList: true, subtree: true }) })()`)
    for (let tries = 0; tries < 2; tries++) {
      await evaluate('document.querySelector(".box .fuel-go")?.click()')
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    const until = Date.now() + 30_000
    while (!(await evaluate<boolean>('!!document.querySelector(".idea-tab")')) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(await evaluate<boolean>('!!document.querySelector(".idea-tab")'), true, 'the page did not become the swarm')
    assert.equal(await evaluate<string>('location.pathname'), '/swarms/pq-signatures')
    assert.deepEqual(await evaluate<string[]>('window.__flashed'), [])
    assert.equal(await evaluate<string>('document.querySelector("h1")?.textContent'), 'Better post-quantum signatures')
  } finally {
    await chrome.close()
  }
})

test('the create-at-name page and a nicknamed swarm render at 1440x900 and 390x844 with no page error or sideways overflow', async () => {
  const chrome = await Chrome.open()
  try {
    for (const [name, route] of [['create-at-name', '/faster-json-parsing'], ['create-at-idea', '/pq-signatures'], ['nicknamed', '/pequalsnp']] as const)
      for (const viewport of ['desktop', 'phone'] as const) {
        const shot = await chrome.shoot(dev.url + route, viewport, path.join(shots, `${name}-${viewport}.png`))
        assert.deepEqual(shot.errors, [], name + ' ' + viewport)
        assert.deepEqual(shot.console.filter((line) => !/WebSocket|favicon|Hydration/.test(line)), [], name + ' ' + viewport)
        assert.ok(shot.overflow <= 0, `${name} ${viewport} overflows by ${shot.overflow}px`)
      }
  } finally {
    await chrome.close()
  }
})
