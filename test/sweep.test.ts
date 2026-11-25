import assert from 'node:assert/strict'
import test from 'node:test'
import * as Endpoints from './e2e/endpoints.ts'

const swarm = 'abc123abc123'
const tree = 'tree12345678'
const thrown = 'made12345678'
const me = '0x00000000000000000000000000000000000000aa'

type Sent = { method: string; path: string; rpc?: { method: string; tool?: string } }

const tools = [
  { annotations: { readOnlyHint: true }, inputSchema: { properties: { swarm: {} }, required: ['swarm'] }, name: 'swarm_get' },
  { annotations: { readOnlyHint: false }, inputSchema: { properties: { swarm: {} }, required: ['swarm'] }, name: 'swarm_hand_remove' },
  { annotations: { readOnlyHint: false }, inputSchema: { properties: {} }, name: 'swarm_create' },
]

function answer(path: string, method: string): unknown {
  if (path === '/openapi.json') return { paths: {} }
  if (path === '/v1/me') return { address: me }
  if (path === '/v1/swarms' && method === 'POST') return { id: thrown }
  if (path === '/v1/swarms') return { funders: {}, swarms: [{ form: 'agent', id: swarm, nickname: 'sweep', status: 'paused' }, { form: 'tree', id: tree, nickname: null, status: 'paused' }] }
  if (path.endsWith('/machines')) return { machines: [{ kind: 'sandbox', name: 'box', runs: { count: 1 } }] }
  if (path.includes('/commands')) return { commands: [{ log: 'log', seq: 1 }] }
  if (path.endsWith('/chat')) return { messages: [{ id: 1 }] }
  if (path.endsWith('/branches')) return { branches: [{ id: 'b1' }] }
  if (path.endsWith('/artifacts')) return { artifacts: [] }
  if (path.endsWith('/tree')) return { nodes: [{ id: 'n1' }] }
  return {}
}

/** Runs the whole sweep against root with fetch and WebSocket stubbed, and answers every request it sent. */
async function sweep(root: string, options: { live?: string; made?: string; operator?: string; token?: string; writes?: string } = {}) {
  const sent: Sent[] = []
  const fetched = globalThis.fetch
  const socket = globalThis.WebSocket
  const writes = process.env['SWARMS_SWEEP_WRITES']
  const live = process.env['SWARMS_SWEEP_LIVE_WRITES']
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname.replace(/^\/swarms/, '') + url.search
    if (url.pathname.endsWith('/mcp')) {
      const body = JSON.parse(String(init?.body)) as { id: number; method: string; params?: { name?: string } }
      sent.push({ method, path: url.pathname, rpc: { method: body.method, ...(body.params?.name ? { tool: body.params.name } : {}) } })
      const result = body.method === 'initialize' ? { serverInfo: { name: 'swarms' } } : body.method === 'tools/list' ? { tools } : { content: [{ text: 'ok' }], isError: false }
      return Response.json({ id: body.id, jsonrpc: '2.0', result }, { headers: { 'mcp-session-id': 'session' } })
    }
    sent.push({ method, path })
    return new Response(JSON.stringify(answer(url.pathname.replace(/^\/swarms/, ''), method)), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  globalThis.WebSocket = class {
    listeners = new Map<string, () => void>()
    constructor() {
      setTimeout(() => this.listeners.get('error')?.(), 0)
    }
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener)
    }
    close() {}
  } as unknown as typeof WebSocket
  if (options.writes === undefined) delete process.env['SWARMS_SWEEP_WRITES']
  else process.env['SWARMS_SWEEP_WRITES'] = options.writes
  if (options.live === undefined) delete process.env['SWARMS_SWEEP_LIVE_WRITES']
  else process.env['SWARMS_SWEEP_LIVE_WRITES'] = options.live
  try {
    const report = await Endpoints.run({ made: options.made, operator: options.operator, root, samples: 1, token: options.token })
    return { report, sent }
  } finally {
    globalThis.fetch = fetched
    globalThis.WebSocket = socket
    if (writes === undefined) delete process.env['SWARMS_SWEEP_WRITES']
    else process.env['SWARMS_SWEEP_WRITES'] = writes
    if (live === undefined) delete process.env['SWARMS_SWEEP_LIVE_WRITES']
    else process.env['SWARMS_SWEEP_LIVE_WRITES'] = live
  }
}

const reads = new Set(['initialize', 'tools/list'])
const readOnly = new Set(tools.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name))

/** Every request that would write: a mutating method, except MCP's reads (initialize, tools/list and read-only tools). */
function written(sent: Sent[]) {
  return sent.filter((each) => Endpoints.mutating.has(each.method) && !(each.rpc && (reads.has(each.rpc.method) || readOnly.has(each.rpc.tool ?? ''))))
}

test('only this machine is a local base', () => {
  for (const root of ['http://localhost:5620/swarms', 'http://127.0.0.1:5620', 'http://[::1]:8787', 'http://swarms.localhost']) assert.equal(Endpoints.local(root), true, root)
  for (const root of ['https://swarms.new', 'https://paradigm.xyz/swarms', 'http://127.0.0.1.example.com', 'https://localhost.example.com', 'not a url']) assert.equal(Endpoints.local(root), false, root)
})

test('a live base takes a write only with SWARMS_SWEEP_WRITES=1 and only on the throwaway swarm the sweep made', () => {
  assert.equal(Endpoints.unwritable('http://127.0.0.1:5620', '/v1/swarms', undefined, undefined), undefined)
  assert.equal(Endpoints.unwritable('https://swarms.new', `/v1/swarms/${swarm}/hands`, swarm, undefined), 'skipped (write)')
  assert.equal(Endpoints.unwritable('https://swarms.new', `/v1/swarms/${swarm}/hands`, undefined, '1'), 'skipped (write)')
  assert.equal(Endpoints.unwritable('https://swarms.new', '/v1/swarms', swarm, '1'), 'skipped (write)')
  assert.equal(Endpoints.unwritable('https://swarms.new', `/v1/swarms/${swarm}0/hands`, swarm, '1'), 'skipped (write)')
  assert.equal(Endpoints.unwritable('https://swarms.new', '/mcp', swarm, '1'), 'skipped (write)')
  assert.equal(Endpoints.unwritable('https://swarms.new', `/v1/swarms/${swarm}/hands`, swarm, '1'), undefined)
  assert.equal(Endpoints.unwritable('https://swarms.new', `/api/swarms/${swarm}`, swarm, '1'), undefined)
})

test('the route sweep sends no mutating request to a live site, signed in or out, even with SWARMS_SWEEP_WRITES=1 and no swarm of its own', { timeout: 60_000 }, async () => {
  for (const root of ['https://swarms.new', 'https://paradigm.xyz/swarms']) {
    for (const options of [{}, { token: 'session' }, { token: 'session', writes: '1' }, { operator: 'key', token: 'session', writes: '1' }, { live: '1', operator: 'key', token: 'session' }]) {
      const { report, sent } = await sweep(root, options)
      assert.deepEqual(written(sent), [], `${root} ${JSON.stringify(options)}`)
      const skipped = report.rows.filter((row) => row.note === 'skipped (write)')
      assert.ok(skipped.some((row) => row.method === 'POST' && row.route === '/v1/swarms/:id/hands'))
      assert.ok(skipped.some((row) => row.method === 'DELETE' && row.route === '/v1/swarms/:id/hands/:hand'))
      assert.ok(skipped.some((row) => row.route === '/mcp swarm_hand_remove'))
      assert.ok(sent.some((each) => each.method === 'GET'), 'the sweep still reads')
    }
  }
})

test('with SWARMS_SWEEP_WRITES=1 a live site gets writes only on the swarm the sweep made', { timeout: 60_000 }, async () => {
  const { sent } = await sweep('https://swarms.new', { made: swarm, token: 'session', writes: '1' })
  const writes = written(sent)
  assert.ok(writes.length > 0)
  assert.deepEqual(writes.filter((each) => !new RegExp(`^/(v1|api)/swarms/${swarm}(/|\\?|$)`).test(each.path)), [])
})

test('a local base still gets every write', { timeout: 60_000 }, async () => {
  const { sent } = await sweep('http://127.0.0.1:5620/swarms', { token: 'session' })
  const writes = written(sent)
  assert.ok(writes.some((each) => each.method === 'POST' && each.path === '/v1/swarms'))
  assert.ok(writes.some((each) => each.method === 'DELETE' && each.path === `/v1/swarms/${swarm}/hands/no-such-hand`))
  assert.ok(writes.some((each) => each.rpc?.tool === 'swarm_hand_remove'))
})

test('a throwaway swarm is made only with writes on, a session and the operator key, and on a live site only when allowed', () => {
  const on = { SWARMS_SWEEP_WRITES: '1' }
  assert.equal(Endpoints.throwaway('http://127.0.0.1:5620', 'session', 'key', on), true)
  assert.equal(Endpoints.throwaway('http://127.0.0.1:5620', undefined, 'key', on), false)
  assert.equal(Endpoints.throwaway('http://127.0.0.1:5620', 'session', undefined, on), false)
  assert.equal(Endpoints.throwaway('http://127.0.0.1:5620', 'session', 'key', {}), false)
  assert.equal(Endpoints.throwaway('https://swarms.new', 'session', 'key', on), false)
  assert.equal(Endpoints.throwaway('https://swarms.new', 'session', 'key', { SWARMS_SWEEP_LIVE_WRITES: '1' }), false)
  assert.equal(Endpoints.throwaway('https://swarms.new', 'session', 'key', { ...on, SWARMS_SWEEP_LIVE_WRITES: '1' }), true)
})

test('writes aimed at the swarm under test go to the throwaway swarm instead, and reads stay', () => {
  const list: Endpoints.Probe[] = [
    { kind: 'json', method: 'GET', path: `/v1/swarms/${swarm}/chat`, status: [200] },
    { body: {}, kind: 'json', method: 'POST', path: `/v1/swarms/${swarm}/chat`, status: [400] },
    { kind: 'json', method: 'DELETE', path: `/api/swarms/${swarm}/hands/x`, status: [401] },
    { body: {}, kind: 'json', method: 'PATCH', path: `/v1/swarms/${swarm}`, status: [400] },
    { body: {}, kind: 'json', method: 'POST', path: `/v1/swarms/${swarm}0/chat`, status: [400] },
  ]
  assert.deepEqual(Endpoints.retarget(list, swarm, thrown).map((probe) => probe.path), [`/v1/swarms/${swarm}/chat`, `/v1/swarms/${thrown}/chat`, `/api/swarms/${thrown}/hands/x`, `/v1/swarms/${thrown}`, `/v1/swarms/${swarm}0/chat`])
  assert.equal(Endpoints.retarget(list, swarm, undefined), list)
})

test('allowed on a live site, the sweep makes one swarm, writes only there, and archives it last', { timeout: 60_000 }, async () => {
  const { report, sent } = await sweep('https://swarms.new', { live: '1', operator: 'key', token: 'session', writes: '1' })
  const writes = written(sent)
  assert.deepEqual(writes[0], { method: 'POST', path: '/v1/swarms' })
  assert.deepEqual(writes.slice(1).filter((each) => !new RegExp(`^/(v1|api)/swarms/${thrown}(/|\\?|$)`).test(each.path)), [])
  assert.ok(writes.some((each) => each.method === 'POST' && each.path === `/v1/swarms/${thrown}/hands`))
  assert.deepEqual(writes.at(-2), { method: 'POST', path: `/v1/swarms/${thrown}/archive` })
  assert.equal(report.world.made, thrown)
  assert.equal(report.world.swarm, swarm, 'reads still go to the swarm it found')
})

test('a token that is not a live session fails its row and adds no signed-in probes', { timeout: 60_000 }, async () => {
  const fetched = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input))
    if (url.pathname === '/v1/me') return Response.json({ detail: 'Sign in with Tempo ID to read your account.' }, { status: 401 })
    return Response.json({ address: me })
  }) as typeof fetch
  try {
    const found = await Endpoints.whoami('https://swarms.new', 'stale')
    assert.equal(found.address, undefined)
    assert.equal(found.row.ok, false)
    assert.match(found.row.note, /^not a live session/)
  } finally {
    globalThis.fetch = fetched
  }
})
