import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, openSync, closeSync } from 'node:fs'
import * as Http from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as Endpoints from './e2e/endpoints.ts'

const entry = fileURLToPath(new URL('./e2e/endpoints.ts', import.meta.url))
const swarm = 'abc123abc123'

/** A local base that lists one swarm and answers every other request with the same empty lists, so most routes fail their expectations. */
async function stub() {
  const server = Http.createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://stub').pathname
    const body = path === '/openapi.json' ? { paths: {} } : path === '/v1/swarms' ? { funders: {}, swarms: [{ form: 'agent', id: swarm, nickname: null, status: 'paused' }] } : { artifacts: [], branches: [], commands: [], machines: [], messages: [], nodes: [] }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  server.on('upgrade', (_, socket) => socket.destroy())
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return { root: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }
}

/** Runs the sweep's entry as its own process, the way `pnpm endpoints <base>` does. */
function sweep(root: string, stdout: 'pipe' | number = 'pipe') {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', entry, root], { env: { ...process.env, SWARMS_SAMPLES: '1', SWARMS_TOKEN: '' }, stdio: ['ignore', stdout, 'pipe'] })
  let out = ''
  let err = ''
  child.stdout?.on('data', (chunk) => (out += chunk))
  child.stderr?.on('data', (chunk) => (err += chunk))
  return new Promise<{ code: number | null; err: string; out: string }>((done) => child.on('close', (code) => done({ code, err, out })))
}

test('the sweep run as a command prints its summary line and exits 1 when a route fails', { timeout: 120_000 }, async () => {
  const { root, server } = await stub()
  try {
    const done = await sweep(root)
    assert.match(done.out, new RegExp(`^# ${root.replace(/[.]/g, '\\.')} \\(${swarm}\\)`, 'm'))
    const line = /^(\d+) routes, (\d+) failed, \d+ over 300 ms\. Wall p50 \d+ ms/m.exec(done.out)
    assert.ok(line, `no summary line in ${JSON.stringify(done.out.slice(-300))} ${done.err.slice(-300)}`)
    assert.ok(Number(line[2]) > 0 && Number(line[2]) <= Number(line[1]))
    assert.equal(done.code, 1)
  } finally {
    server.close()
  }
})

test('a sweep whose report cannot be written exits 1 instead of 0 with nothing printed', { skip: !existsSync('/dev/full') && 'no /dev/full', timeout: 120_000 }, async () => {
  const { root, server } = await stub()
  const full = openSync('/dev/full', 'w')
  try {
    const done = await sweep(root, full)
    assert.equal(done.code, 1)
    assert.match(done.err, /could not write the report: ENOSPC/)
  } finally {
    closeSync(full)
    server.close()
  }
})

test('the entry runs on a node without import.meta.main only when it is argv[1]', () => {
  const url = new URL('./e2e/endpoints.ts', import.meta.url).href
  assert.equal(Endpoints.entry({ main: true, url }, []), true)
  assert.equal(Endpoints.entry({ main: false, url }, ['node', entry]), false)
  assert.equal(Endpoints.entry({ url }, ['node', entry]), true)
  assert.equal(Endpoints.entry({ url }, ['node', fileURLToPath(import.meta.url)]), false)
  assert.equal(Endpoints.entry({ url }, ['node']), false)
})

test('on production the sweep also reads the two-Worker layout at each Worker, and only reads', () => {
  assert.equal(Endpoints.production('https://swarms.new'), true)
  assert.equal(Endpoints.production('https://paradigm.xyz/swarms'), true)
  assert.equal(Endpoints.production('http://127.0.0.1:5620'), false)
  const probes = Endpoints.layout('https://swarms.new', { swarm })
  assert.deepEqual(probes.filter((each) => Endpoints.mutating.has(each.probe.method)), [])
  const seen = probes.map((each) => `${each.root} ${each.probe.method} ${each.probe.path}`)
  for (const want of [
    'https://swarms.new HEAD /og/about/card.png',
    'https://swarms.new GET /v1/auth/challenge',
    `${Endpoints.hosts.objects} GET /og/about/card.png`,
    `${Endpoints.hosts.objects} GET /v1/swarms/${swarm}`,
    `${Endpoints.hosts.objects} GET /docs`,
    `${Endpoints.hosts.proxy} GET /docs`,
    `${Endpoints.hosts.site} GET /og/about/card.png`,
    `${Endpoints.hosts.site} GET /v1/auth/challenge`,
  ])
    assert.ok(seen.includes(want), want)
})

