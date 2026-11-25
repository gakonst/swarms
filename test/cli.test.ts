import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'
import { world } from './run.ts'
import { completion } from '../cli/src/commands/completion.ts'
import { context, Failure, host, swarm } from '../cli/src/context.ts'
import { aliases, commands, parse, usage } from '../cli/src/run.ts'
import { version } from '../cli/src/version.ts'
import { asked } from '../cli/src/commands/fund.ts'
import { type Overview, said, state } from '../cli/src/commands/swarms.ts'
import * as Status from '../src/shared/Status.ts'
import * as Device from '../src/worker/Device.ts'

test('the CLI parses flags, aliases and its host the way its help says', () => {
  assert.deepEqual(parse(['fund', 'p-vs-np', '5', '--yes', '--note=more lemmas', '--json', '-y']), { args: ['fund', 'p-vs-np', '5'], flags: { json: true, note: 'more lemmas', yes: true } })
  assert.deepEqual(parse(['new', 'x', '--goal', 'find it', '--', '--not-a-flag']), { args: ['new', 'x', '--not-a-flag'], flags: { goal: 'find it' } })
  assert.equal(host({}, {}), 'https://swarms.new')
  assert.equal(host({}, { SWARMS_HOST: 'http://127.0.0.1:8787/swarms/' }), 'http://127.0.0.1:8787/swarms')
  assert.equal(host({ host: 'paradigm.xyz/swarms' }, { SWARMS_HOST: 'ignored.example' }), 'https://paradigm.xyz/swarms')
  assert.throws(() => host({ host: 'http://' }, {}), Failure)
  for (const name of Object.keys(usage)) assert.ok(commands[name], name)
  for (const target of Object.values(aliases)) assert.ok(usage[target], target)
})

test('the CLI version is the package version', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'cli', 'package.json'), 'utf8')) as { bin: Record<string, string>; name: string; version: string }
  assert.equal(manifest.version, version)
  assert.deepEqual(manifest.bin, { swarms: 'dist/cli/src/main.js' })
})

test('a swarm is named by its nickname, its id, or its address on either site', async () => {
  const asked: string[] = []
  const ctx = { ...context({ args: [], flags: {} }, {}), api: async <T>(_method: string, route: string) => (asked.push(route), { swarm: 'abcdef012345' }) as T }
  assert.equal(await swarm(ctx, 'abcdef012345'), 'abcdef012345')
  assert.equal(await swarm(ctx, 'https://swarms.new/s/0123456789ab'), '0123456789ab')
  assert.equal(await swarm(ctx, 'https://www.paradigm.xyz/swarms/s/0123456789ab/chat'), '0123456789ab')
  assert.equal(await swarm(ctx, 'https://swarms.new/P-vs-NP'), 'abcdef012345')
  assert.equal(await swarm(ctx, '@riemann'), 'abcdef012345')
  assert.deepEqual(asked, ['/v1/names/p-vs-np', '/v1/names/riemann'])
})

test('completion scripts name every command for bash, zsh and fish', async () => {
  for (const shell of ['bash', 'zsh', 'fish']) {
    let script = ''
    const ctx = { ...context({ args: ['completion', shell], flags: { json: true } }, {}), out: (value: unknown) => void (script = (value as { script: string }).script) }
    await completion(ctx)
    for (const name of Object.keys(usage)) assert.ok(script.includes(name), `${shell} ${name}`)
    assert.ok(script.includes('swarms __names'), shell)
  }
  await assert.rejects(completion(context({ args: ['completion', 'tcsh'], flags: {} }, {})), (error: Failure) => error.exit === 2 && /bash\|zsh\|fish/.test(error.next ?? ''))
})

test('the token file is private to its owner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarms-cli-'))
  const kept = { ...process.env }
  Object.assign(process.env, { SWARMS_CONFIG_DIR: path.join(dir, 'swarms'), SWARMS_KEYCHAIN: '0' })
  delete process.env['SWARMS_TOKEN']
  try {
    const Auth = await import('../cli/src/auth.ts')
    assert.equal(await Auth.load('https://swarms.new'), undefined)
    assert.equal(await Auth.save('https://swarms.new', { address: '0xabc', token: 'secret-token-1' }), 'file')
    assert.equal(fs.statSync(Auth.file()).mode & 0o777, 0o600)
    assert.equal(fs.statSync(Auth.dir()).mode & 0o777, 0o700)
    assert.deepEqual(await Auth.load('https://swarms.new'), { address: '0xabc', token: 'secret-token-1', where: 'file' })
    assert.equal(await Auth.load('http://127.0.0.1:1'), undefined)
    process.env['SWARMS_TOKEN'] = 'from-env-token'
    assert.deepEqual(await Auth.load('https://swarms.new'), { token: 'from-env-token', where: 'env' })
    delete process.env['SWARMS_TOKEN']
    assert.equal(await Auth.remove('https://swarms.new'), true)
    assert.equal(await Auth.load('https://swarms.new'), undefined)
  } finally {
    process.env = kept
    fs.rmSync(dir, { force: true, recursive: true })
  }
})

test('a device sign-in code is used once, expires, and waits for a signed-in approval', async () => {
  const w = world(async () => undefined)
  const started = await Device.start(w.env, 'https://swarms.new/v1/auth/device')
  assert.ok(started.ok)
  assert.match(started.value.user_code, /^[A-Z]{4}-[A-Z]{4}$/)
  assert.equal(started.value.verification_uri_complete, `https://swarms.new/cli/login?code=${started.value.user_code}`)
  assert.equal(Device.normal(started.value.user_code.toLowerCase().replace('-', ' ')), started.value.user_code)
  assert.deepEqual(await Device.poll(w.env, { device_code: started.value.device_code }), { ok: true, value: { status: 'pending' } })
  const unsigned = await Device.approve(w.env, { code: started.value.user_code }, new Request('https://swarms.new/v1/auth/device/approve', { method: 'POST' }))
  assert.equal(unsigned.ok ? 200 : unsigned.status, 401)
  const malformed = await Device.poll(w.env, { device_code: 'nope' })
  assert.equal(malformed.ok ? 200 : malformed.status, 400)
  const unknown = await Device.poll(w.env, { device_code: '0'.repeat(64) })
  assert.equal(unknown.ok ? 200 : unknown.status, 410)
  await w.env.DB.prepare('update sessions set expires_at = 1 where key = ?').bind(`cli:device:${started.value.device_code}`).run()
  const expired = await Device.poll(w.env, { device_code: started.value.device_code })
  assert.equal(expired.ok ? 200 : expired.status, 410)
})


const base: Overview = { archivedAt: null, balance: '56.710051', contributors: 7, form: 'agent', goal: 'Solve it', id: '06cf5d7c8f92', machines: 0, nickname: null, reason: null, remaining: '27.973444', spent: '28.736607', status: 'running', title: 'Solve P = NP.', updatedAt: 0, updates: [], why: null, working: null }

test("swarms status and swarms ls say what the page's pill says, from src/shared/Status.ts", () => {
  const now = 1_000_000_000
  const waiting: Overview = { ...base, failure: { at: 0, code: 'api_error', message: "Tempo Agents cannot pay the network fee to open your key's channel right now: its fee sponsor is out of funds.", route: 'Messages', status: 503 }, reason: Status.reasons.sponsor, waiting: 'tempo', why: 'stuck', working: { since: now - 240_000, stalled: false } }
  assert.deepEqual(said(waiting, now), { status: 'Waiting on Tempo', why: Status.reasons.sponsor })
  assert.equal(said(waiting, now).status, Status.badge(waiting))
  assert.equal(state(waiting), 'Waiting on Tempo')
  const stuck: Overview = { ...waiting, failure: null, reason: Status.reasons.stalled, waiting: null }
  assert.deepEqual(said(stuck, now), { status: 'Retrying', why: Status.reasons.stalled })
  const broke: Overview = { ...base, reason: Status.reasons.broke, remaining: '0.010000', status: 'paused', why: 'money' }
  assert.deepEqual(said(broke, now), { status: 'Needs money', why: Status.reasons.broke })
  assert.equal(state(broke), 'Needs money')
  const working: Overview = { ...base, working: { since: now - 240_000 } }
  assert.deepEqual(said(working, now), { status: 'Working now · working for 4m', why: null })
  assert.equal(said({ ...working, working: { since: now - 240_000, stalled: true } }, now).status, 'Working now · working for 4m (stalled)')
  assert.equal(state({ ...base, archivedAt: 1 }), 'Archived')
  assert.equal(state({ ...base, balance: '0', remaining: '0', status: 'funding', why: 'unfunded' }), 'No riders yet')
  assert.equal(state({ ...base, status: 'paused', why: 'idle' }, { inFlight: 2 }), 'Working now')
})

test("the ride prompt asks one question even when the title ends in punctuation", () => {
  assert.equal(asked('Solve P = NP.'), 'Solve P = NP')
  assert.equal(asked('Is it prime?  '), 'Is it prime')
  assert.equal(asked('Megakernel for Muse Spark Open (Frontier Mix)'), 'Megakernel for Muse Spark Open (Frontier Mix)')
  assert.equal(asked('...'), '...')
})
