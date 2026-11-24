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
const agent = '/s/bench-coders'

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

type Name = RegExp | string

type Role = 'alert' | 'button' | 'checkbox' | 'dialog' | 'heading' | 'link' | 'menuitem' | 'region' | 'status' | 'textbox'

type Spec = { name?: Name; role: Role }

const cheered = '[role=dialog][aria-label="You\'re riding"]'

const finder = `(specs) => {
  const roles = {
    alert: '[role=alert]',
    button: 'button:not([role]),[role=button],input[type=button],input[type=submit]',
    checkbox: 'input[type=checkbox],[role=checkbox]',
    dialog: '[role=dialog]',
    heading: 'h1,h2,h3,h4,[role=heading]',
    link: 'a[href]',
    menuitem: '[role=menuitem],[role=menu] a[href]',
    region: '[aria-label]:not(button):not(a):not(input)',
    status: '[role=status]',
    textbox: 'input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea',
  }
  const tidy = (text) => (text ?? '').replace(/\\s+/g, ' ').trim()
  const spoken = (element) => {
    const copy = element.cloneNode(true)
    for (const hidden of copy.querySelectorAll('[aria-hidden=true]')) hidden.remove()
    return copy.textContent
  }
  const named = (element) => {
    const aria = element.getAttribute('aria-label')
    if (aria) return tidy(aria)
    if (element.labels && element.labels.length) return tidy([...element.labels].map((label) => label.textContent).join(' '))
    if (element.placeholder) return tidy(element.placeholder)
    return tidy(spoken(element))
  }
  const shown = (element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert],[hidden]')
  const fits = (element, name) => !name || (name.source !== undefined ? new RegExp(name.source, name.flags).test(named(element)) : named(element) === name.text)
  let roots = [document]
  for (const spec of specs) roots = roots.flatMap((root) => [...root.querySelectorAll(roles[spec.role])].filter((element) => shown(element) && fits(element, spec.name)))
  return roots
}`

const wire = (specs: Spec[]) => JSON.stringify(specs.map((spec) => ({ role: spec.role, ...(spec.name === undefined ? {} : { name: typeof spec.name === 'string' ? { text: spec.name } : { flags: spec.name.flags, source: spec.name.source } }) })))

const watch = `(() => {
  const find = ${finder}
  let shown = !!document.querySelector(${JSON.stringify(cheered)})
  window.__cheers = shown ? 1 : 0
  window.__trace = []
  new MutationObserver(() => {
    const now = !!document.querySelector(${JSON.stringify(cheered)})
    if (now && !shown) window.__cheers++
    shown = now
    const said = find([{ role: 'dialog' }]).map((dialog) => [...dialog.querySelectorAll('button,[role=alert],[role=status]')].map((each) => each.textContent.trim()).filter(Boolean).join(' | ')).join(' || ')
    if (said && window.__trace.at(-1) !== said) window.__trace.push(said)
  }).observe(document.body, { characterData: true, childList: true, subtree: true })
})()`

async function browse(viewport: keyof typeof Chrome.viewports) {
  const chrome = await Chrome.open()
  const size = Chrome.viewports[viewport]
  const errors: string[] = []
  const dialogs: string[] = []
  const leaving = { ok: false }
  await chrome.send('Network.enable')
  await chrome.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: size.height, mobile: size.mobile, width: size.width })
  await chrome.send('Emulation.setTouchEmulationEnabled', size.mobile ? { enabled: true, maxTouchPoints: 5 } : { enabled: false })
  chrome.on('Page.javascriptDialogOpening', (params: { type: string }) => {
    dialogs.push(params.type)
    void chrome.send('Page.handleJavaScriptDialog', { accept: leaving.ok })
  })
  const evaluate = async <value>(expression: string) => {
    const done = (await chrome.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })) as { exceptionDetails?: { text?: string }; result?: { value?: value } }
    if (done.exceptionDetails) errors.push(expression.slice(0, 200) + ': ' + JSON.stringify(done.exceptionDetails).slice(0, 300))
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
  const all = (...specs: Spec[]) => `(${finder})(${wire(specs)})`
  const has = (...specs: Spec[]) => `(${all(...specs)}).length > 0`
  const open = async (route: string, watched = true) => {
    await chrome.send('Page.navigate', { url: dev.url + route })
    await sleep(300)
    await until('document.readyState === "complete"', 20_000)
    await sleep(1200)
    if (watched) await evaluate(watch)
  }
  const point = async (specs: Spec[]) => {
    const at = await evaluate<{ x: number; y: number } | null>(`(() => { const found = (${all(...specs)})[0]; if (!found) return null; found.scrollIntoView({ block: 'nearest' }); const box = found.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 } })()`)
    assert.ok(at, 'nothing to tap at ' + wire(specs))
    return at
  }
  const press = async (at: { x: number; y: number }) => {
    if (size.mobile) {
      await chrome.send('Input.dispatchTouchEvent', { touchPoints: [{ x: at.x, y: at.y }], type: 'touchStart' })
      await chrome.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' })
    } else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await chrome.send('Input.dispatchMouseEvent', { button: 'left', clickCount: 1, type, x: at.x, y: at.y })
  }
  const tap = async (...specs: Spec[]) => {
    await press(await point(specs))
    await sleep(250)
  }
  const twice = async (...specs: Spec[]) => {
    const at = await point(specs)
    await press(at)
    await press(at)
    await sleep(250)
  }
  const type = async (text: string, ...specs: Spec[]) => {
    await evaluate(`(${all(...specs)})[0]?.focus()`)
    await chrome.send('Input.insertText', { text })
    await sleep(150)
  }
  const read = (...specs: Spec[]) => evaluate<string | null>(`(${all(...specs)}).map((each) => each.textContent.replace(/\\s+/g, ' ').trim()).join(' ') || null`)
  const label = (...specs: Spec[]) => evaluate<string | null>(`(${all(...specs)})[0]?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)
  const shoot = async (name: string) => {
    const shot = (await chrome.send('Page.captureScreenshot', { format: 'png' })) as { data: string }
    fs.mkdirSync(shots, { recursive: true })
    fs.writeFileSync(path.join(shots, `fund-${name}-${viewport}.png`), Buffer.from(shot.data, 'base64'))
    assert.ok((await evaluate<number>('document.documentElement.scrollWidth - innerWidth')) <= 0, name + ' overflows sideways on ' + viewport)
  }
  const raised = async () => Number((await read(channel))?.match(/\$([\d.,]+)\s*raised/)?.[1]?.replace(/,/g, ''))
  const told = (...within: Spec[]) => evaluate<string>(`[...(${all(...within)})].flatMap((each) => [...each.querySelectorAll('[role=alert],[role=status]')]).map((each) => each.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')`)
  return { all, chrome, dialogs, leaving, errors, evaluate, has, label, open, raised, read, shoot, tap, told, twice, type, until, close: () => chrome.close() }
}

const channel: Spec = { name: 'The channel', role: 'region' }
const thread: Spec = { name: 'Thread', role: 'region' }
const riding: Spec = { name: /^Ride/, role: 'dialog' }
const adding: Spec = { name: 'Add a sub-item', role: 'dialog' }
const rideIt: Spec = { name: /^Ride it$/, role: 'button' }
const go = (name: Name): Spec => ({ name, role: 'button' })
const cheer: Spec = { name: "You're riding", role: 'dialog' }
const signIn: Spec = { name: 'Sign in', role: 'button' }

for (const viewport of ['desktop', 'phone'] as const) {
  test(`signed out, ride the whole swarm from the strip on a ${viewport}: one charge, one success sheet, and the money shows at once`, async () => {
    const page = await browse(viewport)
    try {
      await page.open(grove + '?fixture')
      assert.ok(await page.evaluate(page.has(signIn)), 'signed out')
      const before = await page.raised()
      await page.tap(channel, rideIt)
      assert.ok(await page.until(page.has(riding, go(/^Ride it · \$5$/))), 'the ride sheet opens on Ride it · $5')
      assert.equal(await page.evaluate('document.activeElement?.getAttribute("aria-label") === "Amount in dollars"'), viewport === 'desktop', 'the amount takes focus on a desktop, and no keyboard pops up on a phone')
      await page.shoot('strip-open')
      await page.twice(riding, go(/^Ride it · \$5$/))
      assert.ok(await page.until(page.has(cheer)), 'the success sheet shows')
      await sleep(1500)
      assert.equal(await page.evaluate('window.__cheers'), 1)
      assert.equal(await page.evaluate(page.has(riding)), false, 'the ride sheet closed under the success sheet')
      assert.ok((await page.evaluate<string[]>('window.__trace')).some((said) => said.includes('Confirm in Tempo ID')))
      assert.equal(await page.raised(), before + 5, 'a double tap charges once')
      assert.match((await page.read(cheer)) ?? '', /You're riding · \$5/)
      assert.ok(await page.evaluate(page.has(go(/@ada/))), 'the ride signed the rider in')
      await page.shoot('strip-cheer')
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  })
}

for (const viewport of ['desktop', 'phone'] as const) {
  test(`an agent swarm rides in the shared overlay on a ${viewport}, then one success sheet whose total matches the header and the side`, async () => {
    const page = await browse(viewport)
    try {
      await page.open(agent + '?fixture&scene=in,open')
      const before = await page.raised()
      await page.tap(channel, rideIt)
      assert.ok(await page.until(page.has(riding, go(/^Ride it · /))), 'the ride opens in the shared overlay')
      assert.equal(await page.evaluate(`(${page.all({ role: 'dialog' })}).length`), 1)
      if (viewport === 'desktop') assert.ok((await page.evaluate<number>(`(${page.all(riding)})[0].getBoundingClientRect().width`)) <= 400, 'a popover, not a full-width sheet')
      await page.shoot('agent-open')
      await page.tap(riding, go(/^Ride it · /))
      assert.ok(await page.until(page.has(cheer)), 'the success sheet shows')
      await sleep(1500)
      assert.equal(await page.evaluate('window.__cheers'), 1)
      assert.equal(await page.evaluate(`(${page.all({ role: 'dialog' })}).length`), 1, 'the success sheet replaced the ride sheet')
      const total = '$' + (before + 5).toFixed(2)
      assert.equal(await page.raised(), before + 5)
      assert.ok(((await page.read(cheer)) ?? '').includes(total), 'the success sheet says ' + total)
      assert.ok(await page.evaluate(`document.body.innerText.split(${JSON.stringify(total)}).length > 2`), 'the side says ' + total + ' too')
      await page.shoot('agent-cheer')
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  })
}

test('a ride on a board item survives a double tap, a cancel, an empty wallet, a ride sent but not counted at first, and a refusal', async () => {
  for (const viewport of ['desktop', 'phone'] as const) {
    const page = await browse(viewport)
    const pay = go(/^Ride it · /)
    const told = () => page.told(riding)
    try {
      await page.open(lemma + '?fixture&scene=in,deny')
      await page.tap(thread, rideIt)
      assert.ok(await page.until(page.has(riding, pay)), 'the thread rides its item')
      await page.twice(riding, pay)
      assert.ok(await page.until(`(${page.all(riding, { name: /^Cancelled/, role: 'status' })}).length > 0`), 'a cancel says so')
      assert.match(await told(), /Cancelled\..*Nothing was charged/)
      assert.ok(await page.evaluate(`!(${page.all(riding, pay)})[0].disabled`), 'a cancel can be tried again')

      await page.open(lemma + '?fixture&scene=in,broke')
      await page.tap(thread, rideIt)
      const before = await page.raised()
      await page.tap(riding, pay)
      assert.ok(await page.until(`(${page.all(riding, { name: /Not enough in your wallet/, role: 'alert' })}).length > 0`))
      await page.shoot('item-broke')
      await page.tap(riding, go(/^Add funds/))
      assert.ok(await page.evaluate(page.has(riding, go('Adding funds…'))) || /Funds added/.test(await told()), 'adding funds says it is working')
      assert.ok(await page.until(`(${page.all(riding, { name: /Funds added/, role: 'status' })}).length > 0`), 'adding funds says it worked')
      assert.match(await told(), /Your wallet has \$25\.00/)
      await page.tap(riding, pay)
      assert.ok(await page.until(page.has(cheer)))
      assert.equal(await page.raised(), before + 5)

      await page.open(lemma + '?fixture&scene=in,uncounted')
      await page.tap(thread, rideIt)
      const owed = await page.raised()
      await page.tap(riding, pay)
      assert.ok(await page.until(`(${page.all(riding, { name: /^Sent, but not counted yet/, role: 'status' })}).length > 0`), 'an uncounted ride says it was sent')
      assert.match(await told(), /Trying again by itself\. Nothing is paid twice\./)
      await page.shoot('item-owed')
      assert.ok(await page.until(page.has(cheer), 20_000), 'the owed ride is counted by itself')
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1)
      assert.equal(await page.raised(), owed + 5)

      await page.open(lemma + '?fixture&scene=in,reject')
      await page.tap(thread, rideIt)
      await page.tap(riding, pay)
      assert.ok(await page.until(`(${page.all(riding, { name: /cannot be counted/, role: 'alert' })}).length > 0`))
      assert.ok(await page.evaluate(page.has(riding, { name: /^0x/, role: 'link' })), 'a refusal links the transaction')
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
    assert.ok(await page.evaluate(page.has(thread)), 'the thread opens')
    assert.equal(await page.evaluate(page.has(thread, rideIt)), false, 'an ended item offers no ride')
    await page.open(grove + '?fixture&scene=in')
    await page.tap(channel, rideIt)
    assert.ok(await page.until(page.has({ name: 'Ride the whole swarm', role: 'dialog' })))
    assert.equal(await page.label({ name: 'Ride the whole swarm', role: 'dialog' }, { role: 'heading' }), 'Ride the whole swarm')
  } finally {
    await page.close()
  }
})

test('Back closes the ride sheet without leaving the page, and a ride sent before Back still lands once', async () => {
  const page = await browse('phone')
  try {
    await page.open(grove + '/board?fixture&scene=in')
    const where = await page.evaluate<string>('location.href')
    await page.tap(channel, rideIt)
    assert.ok(await page.until(page.has(riding)))
    await page.evaluate('history.back()')
    assert.ok(await page.until(`!(${page.has(riding)})`, 3000), 'Back closes the sheet')
    assert.equal(await page.evaluate('location.href'), where)
    await page.tap(channel, rideIt)
    await page.tap(riding, go('Close'))
    assert.ok(await page.until(`!(${page.has(riding)})`, 3000))
    await sleep(500)
    assert.equal(await page.evaluate('location.href'), where, 'closing the sheet leaves no history behind')
    const before = await page.raised()
    await page.tap(channel, rideIt)
    await page.tap(riding, go(/^Ride it · /))
    await page.evaluate('history.back()')
    assert.ok(await page.until(page.has(cheer)), 'the ride lands after Back')
    await sleep(1000)
    assert.equal(await page.evaluate('window.__cheers'), 1)
    assert.equal(await page.raised(), before + 5)
    assert.equal(await page.evaluate('location.href'), where)
    assert.deepEqual(page.errors, [])
  } finally {
    await page.close()
  }
})

test('leaving the page while Tempo ID is open asks first, and not once nothing is in flight', async () => {
  const page = await browse('desktop')
  try {
    await page.open(lemma + '?fixture&scene=in,hang')
    await page.tap(thread, rideIt)
    await page.tap(riding, go(/^Ride it · /))
    assert.ok(await page.until(page.has(riding, go('Confirm in Tempo ID…'))), 'the ride waits on Tempo ID')
    await page.chrome.send('Page.reload', {})
    await sleep(1500)
    assert.deepEqual(page.dialogs, ['beforeunload'], 'a reload mid-payment asks first')
    assert.ok(await page.evaluate(page.has(riding, go('Confirm in Tempo ID…'))), 'staying keeps the ride waiting')
    page.leaving.ok = true
    await page.open(lemma + '?fixture&scene=in')
    await page.tap(thread, rideIt)
    await page.chrome.send('Page.reload', {})
    await sleep(1500)
    assert.deepEqual(page.dialogs, ['beforeunload', 'beforeunload'], 'nothing in flight leaves without asking')
    assert.match(await page.evaluate<string>('location.search'), /scene=in$/)
  } finally {
    await page.close()
  }
})

for (const viewport of ['desktop', 'phone'] as const) {
  test(`Add funds from the account menu on a ${viewport} says it is adding, then what the wallet holds`, async () => {
    const page = await browse(viewport)
    try {
      await page.open(grove + '?fixture&scene=in,broke')
      const account = go(/^@ada/)
      await page.tap(account)
      assert.ok(await page.until(page.has({ name: 'Add funds', role: 'menuitem' })), 'the account menu opens')
      const menu = () => page.evaluate<string>(`(${page.all({ name: 'Add funds', role: 'menuitem' })})[0]?.closest('[role=menu]')?.textContent ?? ''`)
      assert.match(await menu(), /\$0\.00 in your wallet/)
      await page.tap({ name: 'Add funds', role: 'menuitem' })
      assert.ok(await page.until(`(${page.all({ name: 'Funds added.', role: 'status' })}).length > 0`), 'the menu says the funds were added')
      assert.match(await menu(), /\$25\.00 in your wallet/)
      await page.shoot('menu-funded')
      await page.tap(channel, { role: 'heading' })
      assert.ok(await page.until(`!(${page.has({ name: 'Add funds', role: 'menuitem' })})`, 3000), 'a tap elsewhere closes the menu')
      await page.tap(channel, rideIt)
      await page.tap(riding, go(/^Ride it · /))
      assert.ok(await page.until(page.has(cheer)), 'the added funds ride')
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  })
}

test('a sub-item and a new swarm say what they still need, then start in one go, signed in or not', async () => {
  for (const viewport of ['desktop', 'phone'] as const) {
    const page = await browse(viewport)
    try {
      await page.open(lemma + '?fixture&scene=in')
      await page.tap(thread, go(/^Add a sub-item/))
      assert.ok(await page.until(page.has(adding, go('Give it a title first'))), 'a sub-item needs a title first')
      await page.type('A lemma from the fund test', adding, { name: 'Title', role: 'textbox' })
      assert.ok(await page.evaluate(page.has(adding, go('Add it · $1'))))
      await page.twice(adding, go('Add it · $1'))
      assert.ok(await page.until(page.has(cheer)))
      assert.match((await page.read(cheer)) ?? '', /A lemma from the fund test/)
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1, 'a double tap adds one item')

      await page.open(lemma + '?fixture')
      await page.tap(thread, go(/^Add a sub-item/))
      await page.type('A signed-out lemma', adding, { name: 'Title', role: 'textbox' })
      assert.ok(await page.until(page.has(adding, go('Sign in and add it · $1'))), 'signed out, it says it signs in')
      await page.tap(adding, go('Sign in and add it · $1'))
      assert.ok(await page.until(page.has(cheer), 20_000))
      assert.ok(await page.evaluate(page.has(go(/@ada/))), 'adding signed the rider in')

      await page.open('/new?fixture')
      assert.ok(await page.evaluate(page.has(go("Say what you're after first"))))
      await page.type('Find the cheapest way to desalinate water for a village', { name: 'Your problem', role: 'textbox' })
      assert.ok(await page.evaluate(page.has(go('Sign in and start it · $5'))))
      await page.shoot('new')
      await page.twice(go('Sign in and start it · $5'))
      assert.ok(await page.until(page.has(cheer), 20_000))
      assert.match(await page.evaluate<string>('location.pathname'), /\/s\/[0-9a-f]+$/)
      assert.match((await page.read(cheer)) ?? '', /1 rider · \$5\.00 raised/)
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1, 'a double tap starts one swarm')
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  }
})

test('a sub-item and a new swarm survive a cancel, an empty wallet, a ride sent but not counted at first, and a refusal', async () => {
  for (const viewport of ['desktop', 'phone'] as const) {
    const page = await browse(viewport)
    const title: Spec = { name: 'Title', role: 'textbox' }
    const add = go('Add it · $1')
    const start = go('Start it · $5')
    const problem: Spec = { name: 'Your problem', role: 'textbox' }
    const shows = (role: 'alert' | 'status', name: RegExp, ...within: Spec[]) => page.until(`(${page.all(...within, { name, role })}).length > 0`, 20_000)
    const draft = async (scene: string, name: string) => {
      await page.open(lemma + '?fixture&scene=in,' + scene)
      await page.tap(thread, go(/^Add a sub-item/))
      await page.type(name, adding, title)
      assert.ok(await page.until(page.has(adding, add)), 'the sub-item is ready to add')
    }
    const ask = async (scene: string) => {
      await page.open('/new?fixture&scene=in,' + scene)
      await page.type('Find the cheapest way to desalinate water for a village', problem)
      assert.ok(await page.until(page.has(start)), 'signed in, it starts without signing in again')
    }
    try {
      await draft('deny', 'A cancelled lemma')
      await page.twice(adding, add)
      assert.ok(await shows('status', /^Cancelled/, adding), 'a cancelled sub-item says so')
      assert.match(await page.told(adding), /Cancelled\..*Nothing was charged/)
      assert.ok(await page.evaluate(`!(${page.all(adding, add)})[0].disabled`), 'a cancelled sub-item can be tried again')
      assert.equal(await page.evaluate('window.__cheers'), 0)

      await draft('broke', 'A lemma paid after adding funds')
      await page.tap(adding, add)
      assert.ok(await shows('alert', /Not enough in your wallet/, adding), 'an empty wallet refuses before Tempo ID opens')
      await page.shoot('sub-broke')
      await page.tap(adding, go(/^Add funds/))
      assert.ok(await shows('status', /Funds added/, adding), 'adding funds says it worked')
      await page.tap(adding, add)
      assert.ok(await page.until(page.has(cheer), 20_000), 'the added funds pay for the sub-item')
      assert.match((await page.read(cheer)) ?? '', /A lemma paid after adding funds/)
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1)

      await draft('uncounted', 'A lemma counted late')
      await page.tap(adding, add)
      assert.ok(await page.until(`/A lemma counted late · \\$1 ?Sent, not counted yet\\. Trying again/.test([...document.querySelectorAll('[role=alert],[role=status]')].map((each) => each.textContent).join(' | '))`), 'the thread keeps the uncounted sub-item and says it is trying again: ' + (await page.told()))
      await page.shoot('sub-owed')
      assert.ok(await page.until(page.has(cheer), 20_000), 'the uncounted sub-item is counted by itself, with its sheet closed')
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1)

      await draft('reject', 'A refused lemma')
      await page.tap(adding, add)
      assert.ok(await shows('alert', /cannot be counted/, adding), 'a refused sub-item says so')
      assert.ok(await page.evaluate(page.has(adding, { name: /^0x/, role: 'link' })), 'a refusal links the transaction')
      assert.equal(await page.evaluate('window.__cheers'), 0)

      await ask('deny')
      await page.twice(start)
      assert.ok(await shows('status', /^Cancelled/), 'a cancelled new swarm says so')
      assert.match(await page.told(), /Cancelled\..*Nothing was charged/)
      assert.equal(await page.evaluate('location.pathname'), '/swarms/new', 'a cancel stays on the form')
      assert.ok(await page.evaluate(`!(${page.all(start)})[0].disabled`), 'a cancelled new swarm can be tried again')

      await ask('broke')
      await page.tap(start)
      assert.ok(await shows('alert', /Not enough in your wallet/), 'an empty wallet refuses the start')
      await page.shoot('new-broke')
      await page.tap(go(/^Add funds/))
      assert.ok(await shows('status', /Funds added/), 'adding funds says it worked')
      await page.tap(start)
      assert.ok(await page.until(page.has(cheer), 20_000), 'the added funds start the swarm')
      assert.match(await page.evaluate<string>('location.pathname'), /\/s\/[0-9a-f]+$/)
      assert.match((await page.read(cheer)) ?? '', /1 rider · \$5\.00 raised/, 'a start after a refusal makes one swarm with one ride')
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1)

      await ask('uncounted')
      await page.tap(start)
      assert.ok(await shows('status', /^Sent, but not counted yet/), 'an uncounted start says it was sent')
      assert.ok(await page.until(page.has(cheer), 20_000), 'the uncounted start is counted by itself')
      assert.match(await page.evaluate<string>('location.pathname'), /\/s\/[0-9a-f]+$/)
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1)

      await ask('reject')
      await page.tap(start)
      assert.ok(await shows('alert', /cannot be counted/), 'a refused start says so')
      assert.ok(await page.evaluate(page.has({ name: /^0x/, role: 'link' })), 'a refusal links the transaction')
      await page.shoot('new-refused')
      assert.equal(await page.evaluate('window.__cheers'), 0)
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  }
})

test('a declined Add funds from the account menu says so and changes nothing', async () => {
  for (const viewport of ['desktop', 'phone'] as const) {
    const page = await browse(viewport)
    try {
      await page.open(grove + '?fixture&scene=in,broke,deny')
      await page.tap(go(/^@ada/))
      const item: Spec = { name: 'Add funds', role: 'menuitem' }
      assert.ok(await page.until(page.has(item)), 'the account menu opens')
      await page.tap(item)
      assert.ok(await page.until(`(${page.all({ name: 'Cancelled.', role: 'status' })}).length > 0`), 'a declined top-up says it was cancelled')
      assert.match(await page.evaluate<string>(`(${page.all(item)})[0]?.closest('[role=menu]')?.textContent ?? ''`), /\$0\.00 in your wallet/, 'and the wallet holds what it held')
      assert.ok(await page.evaluate(`!(${page.all(item)})[0].disabled`), 'Add funds can be tried again')
      await page.shoot('fund-declined')
      await page.tap(channel, { role: 'heading' })
      assert.ok(await page.until(`!(${page.has(item)})`, 3000), 'a tap elsewhere closes the menu')
      assert.equal(await page.evaluate('window.__cheers'), 0)
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  }
})

test('an agent swarm ride says when it was cancelled, short or refused, and charges nothing', async () => {
  for (const viewport of ['desktop', 'phone'] as const) {
    const page = await browse(viewport)
    const pay = go(/^Ride it · /)
    try {
      await page.open(agent + '?fixture&scene=in,open,deny')
      const before = await page.raised()
      await page.tap(channel, rideIt)
      await page.twice(riding, pay)
      assert.ok(await page.until(`(${page.all(riding, { name: /^Cancelled/, role: 'status' })}).length > 0`), 'a cancel says so')
      assert.ok(await page.evaluate(`!(${page.all(riding, pay)})[0].disabled`))
      assert.equal(await page.raised(), before, 'a cancel adds nothing')

      await page.open(agent + '?fixture&scene=in,open,broke')
      await page.tap(channel, rideIt)
      await page.tap(riding, pay)
      assert.ok(await page.until(`(${page.all(riding, { name: /Not enough in your wallet/, role: 'alert' })}).length > 0`))
      await page.tap(riding, go(/^Add funds/))
      assert.ok(await page.until(`(${page.all(riding, { name: /Funds added/, role: 'status' })}).length > 0`))
      await page.tap(riding, pay)
      assert.ok(await page.until(page.has(cheer)), 'the added funds ride the agent swarm')

      await page.open(agent + '?fixture&scene=in,open,reject')
      const held = await page.raised()
      await page.tap(channel, rideIt)
      await page.tap(riding, pay)
      assert.ok(await page.until(`(${page.all(riding, { name: /cannot be counted/, role: 'alert' })}).length > 0`))
      assert.ok(await page.evaluate(page.has(riding, { name: /^0x/, role: 'link' })), 'a refusal links the transaction')
      assert.equal(await page.raised(), held, 'a refusal adds nothing')
      await page.shoot('agent-refused')
      assert.equal(await page.evaluate('window.__cheers'), 0)
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  }
})

test('a free nickname page starts its swarm in one go and stays at its address', async () => {
  for (const viewport of ['desktop', 'phone'] as const) {
    const page = await browse(viewport)
    try {
      await page.open('/clean-water-for-villages?fixture&scene=in')
      assert.match(await page.evaluate<string>('document.body.innerText'), /clean-water-for-villages/)
      const start = go(/^Start it · \$5$/)
      assert.ok(await page.until(page.has(start)), 'the name is the question, so it can start at once')
      await page.shoot('nickname')
      await page.tap(start)
      assert.ok(await page.until(page.has(cheer), 20_000))
      assert.equal(await page.evaluate('location.pathname'), '/swarms/clean-water-for-villages')
      await sleep(1000)
      assert.equal(await page.evaluate('window.__cheers'), 1)
      assert.deepEqual(page.errors, [])
    } finally {
      await page.close()
    }
  }
})

async function remember(page: Awaited<ReturnType<typeof browse>>, owed?: unknown) {
  await page.evaluate(`localStorage.setItem('swarms.session', ${JSON.stringify(JSON.stringify({ address: ana.address, token: ana.token }))})${owed ? `; localStorage.setItem('swarms.owed', ${JSON.stringify(JSON.stringify([owed]))})` : ''}`)
}

test('on the mock gateway, an owed ride waits out a network drop and resumes after a reload, counted once', async () => {
  const made = await ana.call<{ id: string }>('POST', '/v1/swarms', { form: 'tree', goal: 'Check that owed rides resume, on mocks.', template: 'cheap', title: 'Owed rides (e2e)' })
  assert.ok(made.status === 201 || made.status === 200, JSON.stringify(made.body))
  const id = made.body.id
  const pledged = async () => (await dev.call<{ nodes: { id: string; money: { pledged: string } }[] }>('GET', `/v1/swarms/${id}/tree`)).body.nodes.find((node) => node.id === 'root')?.money.pledged
  const owe = (amount: string) => {
    const paid = ana.pay(id, amount, 'n:root')
    return { amount: amount + '.000000', hash: paid.hash, node: 'root', note: '', swarm: id }
  }

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
    assert.ok(await desk.until(desk.has(cheer), 40_000), 'the owed ride is counted once the network is back')
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
    assert.ok(await phone.until(phone.has(cheer), 20_000), 'a reload resumes the owed ride on a phone, where no ride sheet is open')
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

test('on the mock gateway, a rider attaches a key under Use your own AI and runs a swarm they ride on it', async () => {
  const made = await ana.call<{ id: string }>('POST', '/v1/swarms', { goal: 'Check that a rider runs a swarm on their own AI, on mocks.', template: 'cheap', title: 'Own AI (e2e)' })
  assert.ok(made.status === 201 || made.status === 200, JSON.stringify(made.body))
  const id = made.body.id
  const page = await browse('desktop')
  try {
    await page.open('/docs', false)
    await remember(page)
    await page.open('/me/ai')
    assert.ok(await page.until(page.has({ name: 'Anthropic API key', role: 'textbox' })), 'the page lists the keys to attach')
    await page.type('bad-key', { name: 'Anthropic API key', role: 'textbox' })
    await page.tap(go('Add'))
    assert.ok(await page.until(page.has({ name: /refused/, role: 'alert' })), 'a refused key says so')
    await page.evaluate(`(${page.all({ name: 'Anthropic API key', role: 'textbox' })})[0].select()`)
    await page.type('sk-ant-mock-1234', { name: 'Anthropic API key', role: 'textbox' })
    await page.tap(go('Add'))
    assert.ok(await page.until('/••••1234/.test(document.body.innerText)'), 'the key shows by its last four')
    assert.equal(await page.evaluate('document.body.innerHTML.includes("sk-ant-mock")'), false, 'the key itself is never shown again')
    await page.shoot('own-ai')

    await page.open(`/s/${id}`)
    await page.tap(channel, rideIt)
    const own = { name: /^Run on my own AI/, role: 'checkbox' } as const
    assert.ok(await page.until(page.has(riding, own)), 'the ride box offers the rider their own AI')
    await page.tap(riding, own)
    assert.ok(await page.until(page.has(riding, { name: /runs on Codex: connect an OpenAI key/, role: 'alert' })), 'a Codex swarm asks for an OpenAI key, not the Anthropic one')
    assert.ok(await page.evaluate(page.has(riding, { name: /Use your own AI/, role: 'link' })), 'and links to where it is attached')
    assert.equal(await page.evaluate(`(${page.all(riding, own)})[0]?.checked`), false)
    await page.shoot('own-ai-codex')
    await page.open('/me/ai')
    assert.ok(await page.until(page.has({ name: 'OpenAI API key', role: 'textbox' })))
    await page.type('sk-proj-mock-5678', { name: 'OpenAI API key', role: 'textbox' })
    await page.tap({ name: 'OpenAI API key', role: 'textbox' })
    await page.evaluate(`(${page.all({ name: 'OpenAI API key', role: 'textbox' })})[0].form.requestSubmit()`)
    assert.ok(await page.until('/••••5678/.test(document.body.innerText)'), 'the OpenAI key shows by its last four')
    await page.open(`/s/${id}`)
    await page.tap(channel, rideIt)
    assert.ok(await page.until(page.has(riding, own)))
    await page.tap(riding, own)
    assert.ok(await page.until(`(${page.all(riding, own)})[0]?.checked === true`), 'a rider runs it on their AI: ' + (await page.told(riding)))
    assert.ok(await page.until(`/own AI/.test((${page.all(channel)})[0]?.textContent ?? '')`), 'the strip says whose AI it runs on')
    await page.shoot('own-ai-on')
    const shown = await dev.call<{ ai: { address: string } | null }>('GET', `/v1/swarms/${id}`)
    assert.equal(shown.body.ai?.address.toLowerCase(), ana.address)
    await page.tap(riding, own)
    assert.ok(await page.until(`(${page.all(riding, own)})[0]?.checked === false`), 'the rider hands it back')
    assert.equal((await dev.call<{ ai: unknown }>('GET', `/v1/swarms/${id}`)).body.ai ?? null, null)
    const tree = await ana.call<{ id: string }>('POST', '/v1/swarms', { form: 'tree', goal: 'A tree swarm, whose items run on its own money.', template: 'cheap', title: 'Own AI tree (e2e)' })
    const refused = await ana.call<{ detail: string }>('POST', `/v1/swarms/${tree.body.id}/ai`, { on: true })
    assert.equal(refused.status, 409, 'a tree swarm cannot claim to run on a rider\'s AI, since its items never take credentials')
    assert.deepEqual(page.errors, [])
  } finally {
    await page.close()
  }
})
