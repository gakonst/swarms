import * as assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, test } from 'node:test'
import * as Chrome from './chrome.ts'
import * as Dev from './dev.ts'
import { type Rider, rider } from './rider.ts'

const shots = process.env['E2E_SHOTS'] ?? path.join(os.tmpdir(), 'swarms-e2e-shots')
const grove = '/s/p-vs-np'
const lemma = grove + '/n/1583a1546a'

let dev: Dev.Dev
let ana: Rider

before(async () => {
  dev = await Dev.start()
  ana = await rider(dev, 'ana')
})

after(async () => {
  await dev?.stop()
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const watch = `(() => {
  window.__cheers = 0
  window.__trace = []
  let shown = false
  new MutationObserver(() => {
    const now = !!document.querySelector('.cheer')
    if (now && !shown) window.__cheers++
    shown = now
    const said = (document.querySelector('.fuel-go')?.textContent ?? '') + ' | ' + (document.querySelector('.fuel-told')?.textContent ?? '')
    if (window.__trace.at(-1) !== said) window.__trace.push(said)
  }).observe(document.body, { characterData: true, childList: true, subtree: true })
})()`

async function browse(viewport: keyof typeof Chrome.viewports) {
  const chrome = await Chrome.open()
  const size = Chrome.viewports[viewport]
  const errors: string[] = []
  await chrome.send('Network.enable')
  await chrome.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: size.height, mobile: size.mobile, width: size.width })
  await chrome.send('Emulation.setTouchEmulationEnabled', size.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
  const evaluate = async <value>(expression: string) => {
    const done = (await chrome.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })) as { exceptionDetails?: { text?: string }; result?: { value?: value } }
    if (done.exceptionDetails) errors.push(expression + ': ' + JSON.stringify(done.exceptionDetails).slice(0, 300))
    return done.result?.value as value
  }
  const until = async (expression: string, ms = 15_000) => {
    const end = Date.now() + ms
    for (;;) {
      if (await evaluate<boolean>(expression)) return true
      if (Date.now() > end) return false
      await sleep(100)
    }
  }
  const open = async (route: string, watched = true) => {
    await chrome.send('Page.navigate', { url: dev.url + route })
    await sleep(300)
    await until('document.readyState === "complete"', 20_000)
    await sleep(1200)
    if (watched) await evaluate(watch)
  }
  const tap = async (selector: string) => {
    const at = await evaluate<{ x: number; y: number } | null>(`(() => { const found = document.querySelector(${JSON.stringify(selector)}); if (!found) return null; found.scrollIntoView({ block: 'nearest' }); const box = found.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 } })()`)
    assert.ok(at, 'nothing to tap at ' + selector)
    if (size.mobile) {
      await chrome.send('Input.dispatchTouchEvent', { touchPoints: [{ x: at.x, y: at.y }], type: 'touchStart' })
      await chrome.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' })
    } else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await chrome.send('Input.dispatchMouseEvent', { button: 'left', clickCount: 1, type, x: at.x, y: at.y })
    await sleep(250)
  }
  const type = async (selector: string, text: string) => {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`)
    await chrome.send('Input.insertText', { text })
    await sleep(150)
  }
  const read = (selector: string) => evaluate<string | null>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`)
  const shoot = async (name: string) => {
    const shot = (await chrome.send('Page.captureScreenshot', { format: 'png' })) as { data: string }
    fs.mkdirSync(shots, { recursive: true })
    fs.writeFileSync(path.join(shots, `fund-${name}-${viewport}.png`), Buffer.from(shot.data, 'base64'))
    assert.ok((await evaluate<number>('document.documentElement.scrollWidth - innerWidth')) <= 0, name + ' overflows sideways on ' + viewport)
  }
  const raised = async () => Number((await read('.strip-stats'))?.match(/\$([\d.,]+)\s*raised/)?.[1]?.replace(/,/g, ''))
  return { chrome, errors, evaluate, open, raised, read, shoot, tap, type, until, close: () => chrome.close() }
}

for (const viewport of ['desktop', 'phone'] as const) {
  test(`signed out, ride the whole swarm from the strip on a ${viewport}: one charge, one success sheet, and the money shows at once`, async () => {
    const page = await browse(viewport)
    try {
      await page.open(grove + '?fixture')
      assert.equal(await page.read('.wallet'), 'Sign in')
      const before = await page.raised()
      await page.tap('.strip-ride')
      assert.ok(await page.until('!!document.querySelector(".overlay .ride .fuel-go")'), 'the ride sheet opens')
      assert.equal(await page.evaluate('document.activeElement?.id === "amount"'), viewport === 'desktop', 'the amount takes focus on a desktop, and no keyboard pops up on a phone')
      assert.equal(await page.read('.ride .fuel-go'), 'Ride it · $5')
      await page.shoot('strip-open')
      await page.tap('.ride .fuel-go')
      await page.tap('.ride .fuel-go').catch(() => {})
      assert.ok(await page.until('!!document.querySelector(".cheer")'), 'the success sheet shows')
      await sleep(1500)
      assert.equal(await page.evaluate('window.__cheers'), 1)
      assert.equal(await page.evaluate('!!document.querySelector(".overlay")'), false, 'the ride sheet closed under the success sheet')
      assert.ok((await page.evaluate<string[]>('window.__trace')).some((said) => said.startsWith('Confirm in Tempo ID')))
      assert.equal(await page.raised(), before + 5, 'a double tap charges once')
      assert.match((await page.read('.cheer')) ?? '', /You're riding · \$5/)
      assert.match((await page.read('.wallet')) ?? '', /@ada/)
      await page.shoot('strip-cheer')
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  })
}

test('a ride on a board item survives a cancel, an empty wallet, a ride sent but not counted at first, and a refusal', async () => {
  for (const viewport of ['desktop', 'phone'] as const) {
    const page = await browse(viewport)
    const go = '.node-ride .fuel-go'
    const told = () => page.read('.node-ride .fuel-told')
    try {
      await page.open(lemma + '?fixture&scene=in,deny')
      await page.tap(go)
      assert.ok(await page.until('/Cancelled/.test(document.querySelector(".node-ride .fuel-told")?.textContent ?? "")'), 'a cancel says so')
      assert.match((await told()) ?? '', /Nothing was charged/)
      assert.equal(await page.evaluate('document.querySelector(".node-ride .fuel-go").disabled'), false, 'a cancel can be tried again')

      await page.open(lemma + '?fixture&scene=in,broke')
      const before = await page.raised()
      await page.tap(go)
      assert.ok(await page.until('/Not enough in your wallet/.test(document.querySelector(".node-ride .fuel-told")?.textContent ?? "")'))
      await page.shoot('item-broke')
      await page.tap('.node-ride .alert-go')
      assert.equal(await page.read(go), 'Adding funds…')
      assert.ok(await page.until('/Funds added/.test(document.querySelector(".node-ride .fuel-told")?.textContent ?? "")'), 'adding funds says it worked')
      assert.match((await told()) ?? '', /Your wallet has \$25\.00/)
      await page.tap(go)
      assert.ok(await page.until('!!document.querySelector(".cheer")'))
      assert.equal(await page.raised(), before + 5)

      await page.open(lemma + '?fixture&scene=in,uncounted')
      const owed = await page.raised()
      await page.tap(go)
      assert.ok(await page.until('/Sent, but not counted yet/.test(document.querySelector(".node-ride .fuel-told")?.textContent ?? "")'), 'an uncounted ride says it was sent')
      assert.match((await told()) ?? '', /Trying again by itself\. Nothing is paid twice\./)
      await page.shoot('item-owed')
      assert.ok(await page.until('!!document.querySelector(".cheer")', 20_000), 'the owed ride is counted by itself')
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1)
      assert.equal(await page.raised(), owed + 5)

      await page.open(lemma + '?fixture&scene=in,reject')
      await page.tap(go)
      assert.ok(await page.until('/cannot be counted/.test(document.querySelector(".node-ride .fuel-told")?.textContent ?? "")'))
      await page.shoot('item-refused')
      assert.equal(await page.evaluate('window.__cheers'), 0)
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  }
})

test('an ended item offers no ride, and the strip still rides the whole swarm', async () => {
  const page = await browse('desktop')
  try {
    await page.open(grove + '/n/397998eb13?fixture&scene=in')
    assert.match((await page.read('h1, h2, .node-title')) ?? '', /\S/)
    assert.equal(await page.evaluate('!!document.querySelector(".node-ride .fuel-go:not(:disabled)")'), false, 'an ended item offers no ride')
    await page.tap('.strip-ride')
    assert.equal(await page.read('.overlay .ride h3'), 'Ride the whole swarm')
  } finally {
    await page.close()
  }
})

test('Back closes the ride sheet without leaving the page, and a ride sent before Back still lands once', async () => {
  const page = await browse('phone')
  try {
    await page.open(grove + '/board?fixture&scene=in')
    const where = await page.evaluate<string>('location.href')
    await page.tap('.strip-ride')
    assert.ok(await page.until('!!document.querySelector(".overlay")'))
    await page.evaluate('history.back()')
    assert.ok(await page.until('!document.querySelector(".overlay")', 3000), 'Back closes the sheet')
    assert.equal(await page.evaluate('location.href'), where)
    await page.tap('.strip-ride')
    await page.tap('.overlay .sheet-close')
    assert.ok(await page.until('!document.querySelector(".overlay")', 3000))
    await sleep(500)
    assert.equal(await page.evaluate('location.href'), where, 'closing the sheet leaves no history behind')
    const before = await page.raised()
    await page.tap('.strip-ride')
    await page.tap('.ride .fuel-go')
    await page.evaluate('history.back()')
    assert.ok(await page.until('!!document.querySelector(".cheer")'), 'the ride lands after Back')
    await sleep(1000)
    assert.equal(await page.evaluate('window.__cheers'), 1)
    assert.equal(await page.raised(), before + 5)
    assert.equal(await page.evaluate('location.href'), where)
    assert.deepEqual(page.errors, [])
  } finally {
    await page.close()
  }
})

test('a sub-item and a new swarm say what they still need, then start in one go', async () => {
  for (const viewport of ['desktop', 'phone'] as const) {
    const page = await browse(viewport)
    try {
      await page.open(lemma + '?fixture&scene=in')
      await page.tap('.node-add')
      assert.ok(await page.until('!!document.querySelector(".compose .fuel-go")'))
      assert.equal(await page.read('.compose .fuel-go'), 'Give it a title first')
      await page.type('.compose-title', 'A lemma from the fund test')
      assert.equal(await page.read('.compose .fuel-go'), 'Add it · $1')
      await page.tap('.compose .fuel-go')
      assert.ok(await page.until('!!document.querySelector(".cheer")'))
      assert.match((await page.read('.cheer')) ?? '', /A lemma from the fund test/)
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1)

      await page.open('/new?fixture')
      assert.equal(await page.read('.fuel-go'), "Say what you're after first")
      await page.type('#question', 'Find the cheapest way to desalinate water for a village')
      assert.equal(await page.read('.fuel-go'), 'Sign in and start it · $5')
      await page.shoot('new')
      await page.tap('.fuel-go')
      assert.ok(await page.until('!!document.querySelector(".cheer")', 20_000))
      assert.match(await page.evaluate<string>('location.pathname'), /\/s\/[0-9a-f]+$/)
      assert.match((await page.read('.cheer')) ?? '', /1 rider · \$5\.00 raised/)
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  }
})

test('on the mock gateway, an owed ride waits out a network drop and resumes after a reload, counted once', async () => {
  const made = await ana.call<{ id: string }>('POST', '/v1/swarms', { form: 'tree', goal: 'Check that owed rides resume, on mocks.', template: 'cheap', title: 'Owed rides (e2e)' })
  assert.ok(made.status === 201 || made.status === 200, JSON.stringify(made.body))
  const id = made.body.id
  const pledged = async () => (await dev.call<{ nodes: { id: string; money: { pledged: string } }[] }>('GET', `/v1/swarms/${id}/tree`)).body.nodes.find((node) => node.id === 'root')?.money.pledged
  const owe = (amount: string) => {
    const paid = ana.pay(id, amount, 'n:root')
    return { amount: amount + '.000000', hash: paid.hash, node: 'root', note: '', swarm: id }
  }
  const remember = (page: Awaited<ReturnType<typeof browse>>, owed: unknown) =>
    page.evaluate(`localStorage.setItem('swarms.session', ${JSON.stringify(JSON.stringify({ address: ana.address, token: ana.token }))}); localStorage.setItem('swarms.owed', ${JSON.stringify(JSON.stringify([owed]))})`)

  const desk = await browse('desktop')
  try {
    await desk.chrome.send('Network.setBlockedURLs', { urls: ['*/contributions*'] })
    await desk.open('/docs', false)
    await remember(desk, owe('3'))
    await desk.open(`/s/${id}`)
    assert.ok(await desk.until('/Sent, but not counted yet/.test(document.body.textContent)'), 'a dropped network leaves the ride owed and says so')
    assert.equal(await pledged(), '0.000000')
    await desk.shoot('owed-offline')
    await desk.chrome.send('Network.setBlockedURLs', { urls: [] })
    assert.ok(await desk.until('!!document.querySelector(".cheer")', 40_000), 'the owed ride is counted once the network is back')
    await sleep(1500)
    assert.equal(await pledged(), '3.000000')
    assert.equal(await desk.evaluate('window.__cheers'), 1)
    assert.equal(await desk.evaluate('localStorage.getItem("swarms.owed")'), '[]')
    assert.deepEqual(desk.errors, [])
  } finally {
    await desk.close()
  }

  const phone = await browse('phone')
  try {
    await phone.chrome.send('Network.setBlockedURLs', { urls: ['*/contributions*'] })
    await phone.open('/docs', false)
    await remember(phone, owe('2'))
    await phone.chrome.send('Network.setBlockedURLs', { urls: [] })
    await phone.open(`/s/${id}`)
    assert.ok(await phone.until('!!document.querySelector(".cheer")', 20_000), 'a reload resumes the owed ride on a phone, where no ride sheet is open')
    await sleep(1500)
    assert.equal(await pledged(), '5.000000')
    assert.equal(await phone.evaluate('window.__cheers'), 1)
    assert.equal(await phone.evaluate('localStorage.getItem("swarms.owed")'), '[]')
    await phone.evaluate('location.reload()')
    await sleep(3000)
    assert.equal(await pledged(), '5.000000', 'a second reload counts nothing twice')
  } finally {
    await phone.close()
  }
})
