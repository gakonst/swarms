import * as assert from 'node:assert/strict'
import * as child from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, test } from 'node:test'
import * as Dev from './dev.ts'
import { type Rider, rider } from './rider.ts'

const main = path.join(import.meta.dirname, '..', '..', 'cli', 'src', 'main.ts')
const config = fs.mkdtempSync(path.join(os.tmpdir(), 'swarms-cli-e2e-'))

let dev: Dev.Dev
let ana: Rider
let bob: Rider
let tree = ''
let agent = ''
const name = `cli-${Date.now().toString(36)}`
const branch = `${name}-a`

type Ran = { code: number; json: <T = Record<string, unknown>>() => T; stderr: string; stdout: string }

function spawn(args: string[], env: Record<string, string> = {}) {
  const started = child.spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', main, ...args], {
    env: { ...process.env, SWARMS_BROWSER: 'none', SWARMS_CONFIG_DIR: config, SWARMS_HOST: dev.url, SWARMS_KEYCHAIN: '0', SWARMS_POLL_MS: '300', SWARMS_TOKEN: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const waiters: { match: RegExp; resolve: (found: RegExpExecArray) => void }[] = []
  started.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
  started.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
    for (const waiter of [...waiters]) {
      const found = waiter.match.exec(stderr)
      if (found) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(found)
      }
    }
  })
  const done = new Promise<Ran>((resolve) =>
    started.once('close', (code) => resolve({ code: code ?? -1, json: <T>() => JSON.parse(stdout) as T, stderr, stdout })),
  )
  const said = (match: RegExp, ms = 20_000) =>
    new Promise<RegExpExecArray>((resolve, reject) => {
      const found = match.exec(stderr)
      if (found) return resolve(found)
      const timer = setTimeout(() => reject(new Error(`no ${match} in: ${stderr}`)), ms)
      waiters.push({ match, resolve: (value) => (clearTimeout(timer), resolve(value)) })
    })
  return { done, said }
}

const cli = (...args: string[]) => spawn(args).done

function failed(ran: Ran, code: string, exit = 1) {
  assert.equal(ran.code, exit, ran.stdout + ran.stderr)
  const body = ran.json<{ error: { code: string; message: string; next: string | null } }>()
  assert.equal(body.error.code, code, ran.stdout)
  assert.ok(body.error.message.length > 0)
  assert.ok(body.error.next && body.error.next.length > 0, `${code} says what to do next: ${ran.stdout}`)
  return body.error
}

function ok<T = Record<string, unknown>>(ran: Ran): T {
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  return ran.json<T>()
}

before(async () => {
  dev = await Dev.start()
  ana = await rider(dev, 'ana')
  bob = await rider(dev, 'bob')
  await ana.call('POST', '/v1/me', { name: 'ana' })
})

after(async () => {
  await dev?.stop()
  fs.rmSync(config, { force: true, recursive: true })
})

test('version, help and errors need no account', async () => {
  const version = await cli('--version')
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/)
  const help = ok<{ commands: { command: string }[] }>(await cli('help', '--json'))
  for (const command of ['login', 'logout', 'whoami', 'ls', 'new', 'open', 'status', 'watch', 'logs', 'ideas', 'tree', 'fund', 'hands', 'machines', 'edit', 'archive', 'byok', 'completion']) assert.ok(help.commands.some((each) => each.command === command), command)
  assert.equal(ok<{ usage: string }>(await cli('fund', '--help', '--json')).usage.startsWith('swarms fund'), true)
  failed(await cli('lss', '--json'), 'usage', 2)
  failed(await cli('ls', '--json', '--host', 'http://127.0.0.1:9'), 'unreachable')
  failed(await cli('whoami', '--json'), 'unauthorized')
  failed(await cli('status', 'no-such-swarm-zz', '--json'), 'not_found')
  failed(await cli('status', '--json'), 'usage', 2)
  const human = await cli('whoami')
  assert.equal(human.code, 1)
  assert.match(human.stderr, /error: Not signed in[\s\S]*swarms login/)
})

test('login signs in through the browser page with a device code, kept in a private file', async () => {
  const login = spawn(['login', '--json'])
  const [, url = '', code = ''] = await login.said(/Open (\S+)\nCode: ([A-Z]{4}-[A-Z]{4})/)
  assert.equal(url, `${dev.url}/cli/login?code=${code}`)
  const page = await fetch(url)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /Sign in to the CLI/)
  assert.equal((await dev.call('POST', '/v1/auth/device/approve', { code })).status, 401)
  const fresh = await rider(dev, 'ana')
  const approved = await dev.call<{ address: string }>('POST', '/v1/auth/device/approve', { code: code.toLowerCase() }, fresh.token)
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  assert.equal((await dev.call('POST', '/v1/auth/device/approve', { code }, fresh.token)).status, 410)
  const signed = ok<{ address: string; handle: string; host: string; stored: string }>(await login.done)
  assert.deepEqual([signed.address, signed.host, signed.stored], [ana.address, dev.url, 'file'])
  const file = path.join(config, 'auth.json')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal((JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { token: string }>)[dev.url]?.token, fresh.token)
  assert.equal(ok<{ address: string }>(await cli('whoami', '--json')).address, ana.address)
  assert.match((await cli('whoami')).stdout, /ana/)
})

test('new, ls, status, open, logs, tree and watch read and make swarms', async () => {
  failed(await spawn(['new', name, '--json']).done, 'usage', 2)
  const made = ok<{ swarm: { id: string; nickname: string; title: string }; url: string; funded: null }>(await cli('new', name, '--goal', 'Settle a small lemma end to end on mocks.', '--form', 'tree', '--template', 'cheap', '--json'))
  tree = made.swarm.id
  assert.deepEqual([made.swarm.nickname, made.url, made.funded], [name, `${dev.url}/${name}`, null])
  const second = ok<{ swarm: { id: string } }>(await cli('new', branch, '--goal', 'A second swarm for edits and hands.', '--title', 'Second', '--template', 'cheap', '--json'))
  agent = second.swarm.id
  failed(await cli('new', name, '--goal', 'Taken names are refused, said plainly.', '--json'), 'conflict')

  const listed = ok<{ swarms: { id: string }[] }>(await cli('ls', '--json'))
  assert.ok(listed.swarms.some((each) => each.id === tree))
  assert.match((await cli('ls')).stdout, new RegExp(name))
  assert.ok(ok<string[]>(await cli('__names', '--json')).includes(name))

  const status = ok<{ id: string; title: string; balance: string }>(await cli('status', name, '--json'))
  assert.equal(status.id, tree)
  assert.equal(ok<{ id: string }>(await cli('status', `${dev.url}/s/${tree}`, '--json')).id, tree)
  assert.match((await cli('status', name)).stdout, /money\s+\$/)

  assert.deepEqual(ok(await cli('open', name, '--json')), { opened: false, url: `${dev.url}/${name}` })
  assert.deepEqual(ok(await cli('open', '--json')), { opened: false, url: dev.url })

  const logs = ok<{ entries: unknown[]; next: number }>(await cli('logs', agent, '--limit', '5', '--json'))
  assert.ok(Array.isArray(logs.entries))

  const read = ok<{ headline: { proven: number }; nodes: { id: string }[] }>(await cli('tree', name, '--json'))
  assert.ok(read.nodes.some((node) => node.id === 'root'))
  assert.match((await cli('tree', name)).stdout, /proven · .* spent\n\[/)

  const watched = await cli('watch', name, '--json', '--limit', '1', '--timeout', '8')
  assert.equal(watched.code, 0, watched.stderr)
  for (const each of watched.stdout.split('\n').filter(Boolean)) assert.ok('data' in (JSON.parse(each) as object))
  failed(await cli('watch', 'no-such-swarm-zz', '--json'), 'not_found')
})

test('ideas, machines and hands', async () => {
  const idea = ok<Record<string, unknown>>(await cli('ideas', 'add', name, 'Try', 'the', 'switching', 'lemma', 'first', '--json'))
  assert.ok(idea)
  failed(await cli('ideas', 'add', name, '--json'), 'usage', 2)
  failed(await cli('ideas', 'rm', name, '--json'), 'usage', 2)

  assert.ok(Array.isArray(ok<{ machines: unknown[] }>(await cli('machines', branch, '--json')).machines))

  assert.deepEqual(ok<{ hands: unknown[] }>(await cli('hands', 'ls', branch, '--json')).hands, [])
  const issued = ok<{ command: string; name: string }>(await cli('hands', 'add', branch, '--label', 'laptop', '--json'))
  assert.match(issued.name, /^laptop/)
  assert.ok(ok<{ hands: { name: string }[] }>(await cli('hands', 'ls', branch, '--json')).hands.some((hand) => hand.name === issued.name))
  failed(await cli('hands', 'rm', branch, issued.name, '--json'), 'confirmation_required')
  assert.equal(ok<{ removed: boolean }>(await cli('hands', 'rm', branch, issued.name, '--yes', '--json')).removed, true)
})

test('fund asks first, waits for the Tempo Wallet transfer and counts it, with mock money', async () => {
  failed(await cli('fund', name, '1', '--json'), 'confirmation_required')
  failed(await cli('back', name, 'lots', '--yes', '--json'), 'usage', 2)
  const funding = spawn(['fund', name, '1', '--yes', '--json'])
  const [, link = ''] = await funding.said(/Open (\S+)\n/)
  assert.ok(link.startsWith(`${dev.url}/${name}?fund`), link)
  const { hash } = await ana.pay(tree, '1')
  assert.ok([200, 201].includes((await ana.call('POST', `/v1/swarms/${tree}/contributions`, { hash })).status))
  const counted = ok<{ amount: string; counted: boolean; swarm: { id: string } }>(await funding.done)
  assert.deepEqual([counted.amount, counted.counted, counted.swarm.id], ['1', true, tree])

  const { hash: sent } = await ana.pay(tree, '0.5')
  const byHash = ok<{ counted: boolean; hash: string }>(await cli('back', name, '0.5', '--hash', sent, '--json'))
  assert.deepEqual([byHash.counted, byHash.hash], [true, sent])
  const byHash2 = ok<{ balance: string; counted: boolean }>(await cli('fund', name, '0.5', '--hash', sent, '--json'))
  assert.deepEqual([byHash2.counted, byHash2.balance], [true, (byHash as unknown as { balance: string }).balance])
})

test('edit changes the title, the slug and the picture, as an admin', async () => {
  assert.equal(ok<{ title: string }>(await cli('edit', branch, 'title', 'Renamed', 'swarm', '--json')).title, 'Renamed swarm')
  const moved = `${branch}-b`
  assert.equal(ok<{ nickname: string }>(await cli('edit', branch, 'slug', moved, '--json')).nickname, moved)
  const png = path.join(config, 'pfp.png')
  fs.writeFileSync(png, Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]))
  assert.ok(ok<{ picture: unknown }>(await cli('edit', moved, 'pfp', png, '--json')).picture)
  assert.equal(ok<{ picture: unknown }>(await cli('edit', moved, 'pfp', 'none', '--json')).picture, null)
  failed(await cli('edit', moved, 'color', 'red', '--json'), 'usage', 2)
  failed(await cli('edit', moved, 'pfp', path.join(config, 'missing.png'), '--json'), 'usage', 2)
  const theirs = await bob.call<{ id: string }>('POST', '/v1/swarms', { goal: 'Someone else owns this one.', template: 'cheap', title: 'Theirs' })
  failed(await cli('edit', theirs.body.id, 'title', 'Mine now', '--json'), 'access_denied')
  failed(await cli('archive', theirs.body.id, '--yes', '--json'), 'access_denied')
})

test('byok says plainly whether your own AI is offered', async () => {
  const offered = (await dev.call<{ ownAi: boolean }>('GET', '/v1/config')).body.ownAi
  const read = ok<{ available: boolean; keys?: unknown[] }>(await cli('byok', '--json'))
  assert.equal(read.available, offered)
  if (!offered) {
    assert.match((await cli('env')).stdout, /not available yet/)
    failed(await cli('byok', 'set', 'anthropic', '--key', 'sk-test', '--json'), 'unavailable')
  } else assert.ok(Array.isArray(read.keys))
  failed(await cli('byok', 'nope', '--json'), 'usage', 2)
})

test('archive asks first, then stops the swarm and refuses new rides', async () => {
  failed(await cli('archive', name, '--json'), 'confirmation_required')
  const archived = ok<{ archivedAt: number | null }>(await cli('archive', name, '--yes', '--json'))
  assert.ok(archived.archivedAt)
  failed(await cli('fund', name, '1', '--yes', '--json'), 'gone')
  assert.doesNotMatch((await cli('ls')).stdout, new RegExp(`^${name} `, 'm'))
})

test('completion prints a script for each shell', async () => {
  assert.match((await cli('completion', 'zsh')).stdout, /compdef _swarms swarms/)
  assert.match((await cli('completion', 'bash')).stdout, /complete -F _swarms swarms/)
  assert.match((await cli('completion', 'fish')).stdout, /complete -c swarms/)
  assert.equal(ok<{ shell: string }>(await cli('completion', 'fish', '--json')).shell, 'fish')
  failed(await cli('completion', '--json'), 'usage', 2)
})

test('logout ends the session and forgets the token', async () => {
  const token = (JSON.parse(fs.readFileSync(path.join(config, 'auth.json'), 'utf8')) as Record<string, { token: string }>)[dev.url]!.token
  assert.deepEqual(ok(await cli('logout', '--json')), { ended: true, host: dev.url, removed: true })
  assert.equal((await dev.call('GET', '/v1/me', undefined, token)).status, 401)
  failed(await cli('whoami', '--json'), 'unauthorized')
  assert.deepEqual(ok(await cli('logout', '--json')), { ended: false, host: dev.url, removed: false })
  const expired = spawn(['login', '--json'])
  const [, , code = ''] = await expired.said(/Open (\S+)\nCode: ([A-Z]{4}-[A-Z]{4})/)
  assert.ok(code)
  const keyed = await cli('login', '--token', ana.token, '--json')
  assert.equal(ok<{ address: string }>(keyed).address, ana.address)
  failed(await cli('login', '--token', 'not-a-session-token', '--json'), 'unauthorized')
})
