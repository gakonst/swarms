import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, test } from 'node:test'
import * as Credit from '../../src/shared/Credit.ts'
import type * as Chain from '../mock/chain.ts'
import * as Chrome from './chrome.ts'
import * as Dev from './dev.ts'
import { type Rider, rider } from './rider.ts'

const latency = Number(process.env['E2E_LATENCY'] ?? 300)
const measuring = process.env['E2E_MEASURE'] === '1'
const report = process.env['E2E_REPORT']
const shots = process.env['E2E_SHOTS'] ?? path.join(os.tmpdir(), 'swarms-e2e-shots')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Marks = { appear?: number; cleared?: number; height?: number; same?: boolean; sent?: number; shift?: number }

let dev: Dev.Dev
let ana: Rider
let first = ''
let second = ''
let seedId = 0
const rows: Record<string, unknown>[] = []

before(async () => {
  dev = await Dev.start()
  ana = await rider(dev, 'ana')
  assert.equal((await ana.call('POST', '/v1/me', { name: 'ana' })).status, 200)
  for (const title of ['Instant first (e2e)', 'Instant second (e2e)']) {
    const made = await ana.call<{ id: string }>('POST', '/v1/swarms', { goal: 'Check that every action shows at once, on mocks.', template: 'cheap', title })
    assert.equal(made.status, 201, JSON.stringify(made.body))
    const paid = dev.gateway.chain.transfer({ amount: '3', from: ana.address, memo: Credit.memo(dev.gateway.wallet, made.body.id, null) as Chain.Hex })
    assert.equal((await ana.call('POST', '/v1/swarms/' + made.body.id + '/contributions', { hash: paid.hash })).status, 201)
    const said = await ana.call<{ message: { id: number } }>('POST', '/v1/swarms/' + made.body.id + '/chat', { text: 'seed message in ' + title })
    assert.equal(said.status, 201)
    if (!first) {
      first = made.body.id
      seedId = said.body.message.id
    } else second = made.body.id
  }
  const bob = await rider(dev, 'bob')
  assert.equal((await bob.call('POST', '/v1/me', { name: 'bob' })).status, 200)
  const paid = dev.gateway.chain.transfer({ amount: '1', from: bob.address, memo: Credit.memo(dev.gateway.wallet, first, null) as Chain.Hex })
  assert.equal((await bob.call('POST', '/v1/swarms/' + first + '/contributions', { hash: paid.hash })).status, 201)
  assert.equal((await bob.call('POST', '/v1/swarms/' + first + '/chat/' + seedId + '/reactions', { emoji: '👍', on: true })).status, 200)
})

after(async () => {
  if (report) fs.writeFileSync(report, JSON.stringify(rows, null, 2))
  await dev?.stop()
})

const probe = String.raw`(spec) => new Promise((resolve) => {
  const marks = {}
  let start
  let node
  const area = () => document.querySelector(spec.area)
  const tick = () => {
    const now = performance.now() - start
    const found = [...document.querySelectorAll(spec.node)].find((each) => each.textContent.includes(spec.text) && (!spec.attr || each.getAttribute(spec.attr) === spec.value))
    if (found && marks.appear === undefined) {
      marks.appear = now
      node = found
      marks.height = found.getBoundingClientRect().height
    }
    if (found && marks.sent === undefined && !found.closest('[data-sending]')) {
      marks.sent = now
      marks.same = found === node || node?.isConnected === true
      marks.shift = Math.round((found.getBoundingClientRect().height - marks.height) * 10) / 10
    }
    if (spec.area && marks.cleared === undefined && area() && !area().value) marks.cleared = now
    if ((marks.sent !== undefined && (!spec.area || marks.cleared !== undefined)) || now > 15000) return resolve(marks)
    requestAnimationFrame(tick)
  }
  const begin = () => {
    if (start !== undefined) return
    start = performance.now()
    requestAnimationFrame(tick)
  }
  for (const type of ['keydown', 'click']) addEventListener(type, begin, { capture: true, once: true })
  window.__probe = { begin }
})`

async function browse(viewport: keyof typeof Chrome.viewports) {
  const chrome = await Chrome.open()
  const size = Chrome.viewports[viewport]
  await chrome.send('Network.enable')
  await chrome.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: size.height, mobile: size.mobile, width: size.width })
  await chrome.send('Emulation.setTouchEmulationEnabled', size.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
  const evaluate = async <value>(expression: string) => ((await chrome.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })) as { result?: { value?: value } }).result?.value as value
  const until = async (expression: string, ms = 20_000) => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      if (await evaluate<boolean>(expression)) return true
      await sleep(100)
    }
    return false
  }
  const delay = { ms: 0, refuse: false }
  chrome.on('Fetch.requestPaused', (params: { request: { method: string; url: string }; requestId: string }) => {
    if (delay.refuse && params.request.method === 'POST' && /\/chat$/.test(params.request.url)) {
      delay.refuse = false
      const body = Buffer.from(JSON.stringify({ code: 'rate_limited', detail: 'At most 10 messages a minute in a room; wait a moment.' })).toString('base64')
      return void chrome.send('Fetch.fulfillRequest', { body, requestId: params.requestId, responseCode: 429, responseHeaders: [{ name: 'content-type', value: 'application/json' }] }).catch(() => {})
    }
    setTimeout(() => void chrome.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {}), delay.ms)
  })
  await chrome.send('Fetch.enable', { patterns: [{ requestStage: 'Request', resourceType: 'Fetch', urlPattern: '*' }, { requestStage: 'Request', resourceType: 'XHR', urlPattern: '*' }] })
  const open = async (route: string) => {
    delay.ms = 0
    await chrome.send('Page.navigate', { url: dev.url + route })
    await until('document.readyState === "complete"')
    await sleep(1500)
  }
  const slow = async () => {
    delay.ms = latency
  }
  const center = async (selector: string) => {
    const at = await evaluate<{ x: number; y: number } | null>('(() => { const found = document.querySelector(' + JSON.stringify(selector) + '); if (!found) return null; found.scrollIntoView({ block: "nearest" }); const box = found.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 } })()')
    assert.ok(at, 'nothing at ' + selector)
    return at
  }
  const press = async (selector: string) => {
    const at = await center(selector)
    if (size.mobile) {
      await chrome.send('Input.dispatchTouchEvent', { touchPoints: [{ x: at.x, y: at.y }], type: 'touchStart' })
      await chrome.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' })
    } else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await chrome.send('Input.dispatchMouseEvent', { button: 'left', clickCount: 1, type, x: at.x, y: at.y })
  }
  const measure = async (spec: { area?: string; attr?: string; node: string; text: string; value?: string }, act: () => Promise<void>) => {
    await evaluate('window.__marks = (' + probe + ')(' + JSON.stringify(spec) + '); 0')
    await act()
    return evaluate<Marks>('window.__marks')
  }
  const send = async (area: string, button: string, text: string) => {
    await evaluate('document.querySelector(' + JSON.stringify(area) + ')?.focus()')
    await chrome.send('Input.insertText', { text })
    await sleep(100)
    if (size.mobile) await press(button)
    else await chrome.send('Input.dispatchKeyEvent', { code: 'Enter', key: 'Enter', type: 'rawKeyDown', windowsVirtualKeyCode: 13 }), await chrome.send('Input.dispatchKeyEvent', { code: 'Enter', key: 'Enter', type: 'keyUp', windowsVirtualKeyCode: 13 })
  }
  const signIn = async () => {
    await open('/faq')
    await evaluate('localStorage.setItem("swarms.session", JSON.stringify({ address: ' + JSON.stringify(ana.address) + ', token: ' + JSON.stringify(ana.token) + ' }))')
  }
  const shoot = async (name: string) => {
    const shot = (await chrome.send('Page.captureScreenshot', { format: 'png' })) as { data: string }
    fs.mkdirSync(shots, { recursive: true })
    fs.writeFileSync(path.join(shots, 'instant-' + name + '-' + viewport + '.png'), Buffer.from(shot.data, 'base64'))
  }
  return { delay, shoot, chrome, close: () => chrome.close(), evaluate, measure, open, press, send, signIn, slow, until }
}

function note(viewport: string, action: string, marks: Marks) {
  const row = { action, viewport, latency, ...Object.fromEntries(Object.entries(marks).map(([key, value]) => [key, typeof value === 'number' ? Math.round(value) : value])) }
  rows.push(row)
  console.log(JSON.stringify(row))
  return marks
}

function instant(marks: Marks, what: string) {
  if (measuring) return
  assert.ok(marks.appear !== undefined && marks.appear < 150, what + ' showed after ' + marks.appear + ' ms')
}

for (const viewport of ['desktop', 'phone'] as const) {
  test('on a ' + viewport + ' a message, a reply, a reaction and #general show before the server answers, then settle in place', { timeout: 240_000 }, async () => {
    const page = await browse(viewport)
    try {
      await page.signIn()
      await page.open('/s/' + first)
      assert.ok(await page.until('!!document.querySelector(".chat textarea[aria-label=Message]")'), 'the room composer shows')
      await page.slow()
      const text = 'instant ' + viewport + ' ' + Date.now()
      const said = note(viewport, 'room message', await page.measure({ area: '.chat textarea[aria-label=Message]', node: '.chat-list .msg', text }, () => page.send('.chat textarea[aria-label=Message]', '.chat .chat-send', text)))
      await page.shoot('room')
      instant(said, 'the room message')
      if (!measuring) {
        assert.ok(said.cleared !== undefined && said.cleared < 150, 'the composer cleared after ' + said.cleared + ' ms')
        assert.ok(said.sent !== undefined && said.sent >= latency, 'it settled when the server answered')
        assert.equal(said.same, true, 'the server copy kept the node')
        assert.equal(said.shift, 0, 'the server copy did not move anything')
      }
      await sleep(1000)
      assert.equal(await page.evaluate<number>('[...document.querySelectorAll(".chat-list .msg")].filter((each) => each.textContent.includes(' + JSON.stringify(text) + ')).length'), 1, 'one copy after the echo')

      if (!measuring && viewport === 'desktop') {
        const conditions = { downloadThroughput: -1, latency: 0, uploadThroughput: -1 }
        await page.chrome.send('Network.emulateNetworkConditions', { ...conditions, offline: true })
        const away = 'offline ' + Date.now()
        await page.send('.chat textarea[aria-label=Message]', '.chat .chat-send', away)
        assert.ok(await page.until('[...document.querySelectorAll(".chat-list .msg[data-sending]")].some((each) => each.textContent.includes(' + JSON.stringify(away) + '))', 5000), 'an offline message shows as waiting')
        await sleep(1000)
        await page.chrome.send('Network.emulateNetworkConditions', { ...conditions, offline: false })
        assert.ok(await page.until('[...document.querySelectorAll(".chat-list .msg")].filter((each) => each.textContent.includes(' + JSON.stringify(away) + ') && !each.closest("[data-sending]")).length === 1', 30_000), 'it sends once, back online')
        await sleep(1000)
        assert.equal(await page.evaluate<number>('[...document.querySelectorAll(".chat-list .msg")].filter((each) => each.textContent.includes(' + JSON.stringify(away) + ')).length'), 1)

        page.delay.refuse = true
        const refused = 'refused ' + Date.now()
        await page.send('.chat textarea[aria-label=Message]', '.chat .chat-send', refused)
        const failed = '[...document.querySelectorAll(".chat-list .msg[data-sending=failed]")].find((each) => each.textContent.includes(' + JSON.stringify(refused) + '))'
        assert.ok(await page.until('!!' + failed, 5000), 'a refused message stays, marked not sent')
        assert.match(await page.evaluate<string>(failed + '.querySelector(".msg-unsent").textContent'), /Not sent: At most 10 messages.*Retry/)
        await page.shoot('refused')
        await page.evaluate(failed + '.querySelector(".msg-unsent button").click()')
        assert.ok(await page.until('[...document.querySelectorAll(".chat-list .msg")].filter((each) => each.textContent.includes(' + JSON.stringify(refused) + ') && !each.closest("[data-sending]")).length === 1', 10_000), 'Retry sends it once')
      }

      const chip = '.chat-list .msg .reacts .react[aria-label^="👍"]'
      const pressed = await page.evaluate<string>('document.querySelector(' + JSON.stringify(chip) + ')?.getAttribute("aria-pressed")')
      const reacted = note(viewport, 'reaction', await page.measure({ attr: 'aria-pressed', node: chip, text: '👍', value: pressed === 'true' ? 'false' : 'true' }, () => page.press(chip)))
      instant(reacted, 'the reaction')
      await sleep(800)

      await page.evaluate('document.querySelector(".chat-list .msg button[aria-label=\\"Reply in thread\\"]")?.click()')
      assert.ok(await page.until('!!document.querySelector("textarea[aria-label=\\"Reply in thread\\"]")'), 'the thread opens')
      assert.ok(await page.until('!!document.querySelector(".chat-thread .chat-thread-rule")'), 'the thread loads')
      await page.slow()
      const reply = 'reply ' + viewport + ' ' + Date.now()
      const replied = note(viewport, 'thread reply', await page.measure({ area: 'textarea[aria-label="Reply in thread"]', node: '.chat-thread .msg', text: reply }, () => page.send('textarea[aria-label="Reply in thread"]', '.chat-thread .chat-send', reply)))
      instant(replied, 'the reply')

      await page.open('/')
      assert.ok(await page.until('!!document.querySelector("textarea[aria-label=\\"Message #general\\"]")'), 'the #general composer shows')
      await page.slow()
      const shout = 'general ' + viewport + ' ' + Date.now()
      const shouted = note(viewport, '#general message', await page.measure({ area: 'textarea[aria-label="Message #general"]', node: '.general-row', text: shout }, () => page.send('textarea[aria-label="Message #general"]', '.general .chat-send', shout)))
      instant(shouted, 'the #general message')
    } finally {
      await page.close()
    }
  })

  test('on a ' + viewport + ' switching swarms and tabs renders from the store', { timeout: 240_000 }, async () => {
    const page = await browse(viewport)
    try {
      await page.signIn()
      await page.open('/s/' + first)
      await page.open('/s/' + second)
      await page.open('/s/' + first)
      assert.ok(await page.until('!!document.querySelector(".chat-list .msg")'), 'the room shows')
      await page.slow()
      for (const [action, target] of [['switch swarm (visited)', second], ['switch back (visited)', first]] as const) {
        const title = target === first ? 'Instant first (e2e)' : 'Instant second (e2e)'
        const link = 'a.server[title^="' + title + '"]'
        if (viewport === 'phone') await page.evaluate('document.querySelector(' + JSON.stringify(link) + ')?.scrollIntoView()')
        const marks = await page.measure({ node: '.chat-list .msg', text: 'seed message in ' + title }, async () => {
          await page.evaluate('window.__probe.begin()')
          await page.evaluate('document.querySelector(' + JSON.stringify(link) + ')?.click()')
        })
        note(viewport, action, marks)
        instant(marks, action)
      }
      const about = await page.measure({ node: '.tabs .tab[aria-current=page]', text: 'About' }, async () => {
        await page.evaluate('window.__probe.begin()')
        await page.evaluate('[...document.querySelectorAll(".tabs .tab")].find((each) => each.textContent.trim() === "About")?.click()')
      })
      note(viewport, 'tab to About', about)
      instant(about, 'the About tab')

      await page.evaluate('document.querySelector(".strip-edit")?.click()')
      assert.ok(await page.until('!!document.querySelector("form[aria-label=\\"Edit this swarm\\"] .edit-field input")'), 'the edit card opens')
      await page.evaluate('(() => { const input = document.querySelector("form[aria-label=\\"Edit this swarm\\"] .edit-field input"); input.focus(); input.select() })()')
      const renamed = 'Instant first (e2e) ' + viewport
      await page.chrome.send('Input.insertText', { text: renamed })
      const saved = await page.measure({ node: '.strip-title', text: renamed }, () => page.evaluate('document.querySelector("form[aria-label=\\"Edit this swarm\\"] button[type=submit]")?.click()'))
      note(viewport, 'admin rename', saved)
      instant(saved, 'the rename')
    } finally {
      await page.close()
    }
  })
}

