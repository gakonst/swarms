import * as assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { after, before, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import * as Local from '../../cli/src/mcp.ts'
import * as Dev from './dev.ts'
import { type Rider, rider } from './rider.ts'

let dev: Dev.Dev
let ana: Rider
let boss: Rider
const used = new Set<string>()
let id = 0

before(async () => {
  dev = await Dev.start()
  ana = await rider(dev, 'ana')
  boss = await rider(dev, 'operator')
})

after(async () => {
  await dev?.stop()
})

type Body = { error?: { code: number; data?: Record<string, unknown>; message: string }; result?: Record<string, unknown> }

async function rpc(method: string, params: unknown, token?: string) {
  id += 1
  const response = await fetch(dev.url + '/mcp', {
    body: JSON.stringify({ id, jsonrpc: '2.0', method, params }),
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    method: 'POST',
  })
  const text = await response.text()
  let body: Body = {}
  try {
    body = JSON.parse(text) as Body
  } catch {}
  return { body, headers: response.headers, status: response.status, text }
}

type Called = Awaited<ReturnType<typeof rpc>> & { error: boolean; value: Record<string, unknown> }

async function call(name: string, args: Record<string, unknown>, token?: string): Promise<Called> {
  used.add(name)
  const sent = await rpc('tools/call', { arguments: args, name }, token)
  const result = sent.body.result as { content?: { text?: string }[]; isError?: boolean } | undefined
  let value: Record<string, unknown> = {}
  try {
    value = JSON.parse(result?.content?.[0]?.text ?? '{}') as Record<string, unknown>
  } catch {}
  return { ...sent, error: result?.isError === true, value }
}

function ok(called: Called, what: string) {
  assert.equal(called.status, 200, what + ': ' + called.text.slice(0, 400))
  assert.equal(called.error, false, what + ': ' + called.text.slice(0, 400))
  return called.value
}

function reached(called: Called, what: string) {
  assert.equal(called.status, 200, what + ': ' + called.text.slice(0, 400))
  assert.ok(!['confirm_required', 'insufficient_scope'].includes(String(called.value['code'])), what + ' reached its operation: ' + called.text.slice(0, 400))
  return called.value
}

function asks(called: Called, phrase: string) {
  assert.equal(called.status, 200, called.text.slice(0, 400))
  assert.equal(called.error, true)
  assert.equal(called.value['code'], 'confirm_required')
  assert.equal(called.value['confirm'], phrase)
}

const encode = (bytes: Buffer) => bytes.toString('base64url')

async function post(path: string, body: Record<string, unknown>, options: { form?: boolean; token?: string } = {}) {
  const response = await fetch(dev.url + path, {
    body: options.form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
    headers: { 'content-type': options.form ? 'application/x-www-form-urlencoded' : 'application/json', ...(options.token ? { authorization: 'Bearer ' + options.token } : {}) },
    method: 'POST',
  })
  return { body: (await response.json().catch(() => ({}))) as Record<string, string>, headers: response.headers, status: response.status }
}

const redirect = 'http://127.0.0.1:9/callback'

async function connect(who: Rider, scope: string) {
  const registered = await post('/oauth/register', { client_name: 'e2e client', grant_types: ['authorization_code', 'refresh_token'], redirect_uris: [redirect], token_endpoint_auth_method: 'none' })
  assert.equal(registered.status, 201, JSON.stringify(registered.body))
  const client = registered.body['client_id']!
  const verifier = encode(randomBytes(32))
  const params = { client_id: client, code_challenge: encode(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', redirect_uri: redirect, resource: dev.url + '/mcp', response_type: 'code', scope, state: 'st4te' }
  const asked = await fetch(dev.url + '/oauth/request?' + new URLSearchParams(params).toString())
  const shown = (await asked.json()) as { client_name: string; scopes: { scope: string }[] }
  assert.equal(asked.status, 200, JSON.stringify(shown))
  assert.equal(shown.client_name, 'e2e client')
  const approved = await post('/oauth/approve', { ...params, allow: true }, { token: who.token })
  assert.equal(approved.status, 200, JSON.stringify(approved.body))
  const back = new URL(approved.body['redirect']!)
  assert.equal(back.origin + back.pathname, redirect)
  assert.equal(back.searchParams.get('state'), 'st4te')
  const code = back.searchParams.get('code')!
  const tokens = await post('/oauth/token', { client_id: client, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect }, { form: true })
  assert.equal(tokens.status, 200, JSON.stringify(tokens.body))
  assert.equal(tokens.body['token_type'], 'Bearer')
  assert.match(tokens.body['access_token']!, /^swa_/)
  return { access: tokens.body['access_token']!, client, code, refresh: tokens.body['refresh_token']!, scope: tokens.body['scope']!, verifier }
}

test('OAuth: metadata, registration, PKCE, consent, tokens, refresh and revocation', { timeout: 120_000 }, async () => {
  const resource = (await (await fetch(dev.url + '/.well-known/oauth-protected-resource/mcp')).json()) as Record<string, unknown>
  assert.equal(resource['resource'], dev.url + '/mcp')
  assert.deepEqual(resource['authorization_servers'], [dev.url])
  assert.deepEqual(resource['scopes_supported'], ['swarms:read', 'swarms:write', 'swarms:money', 'swarms:admin'])
  const origin = new URL(dev.url).origin
  for (const path of ['/swarms/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/swarms', '/.well-known/openid-configuration/swarms']) {
    const server = (await (await fetch(origin + path)).json()) as Record<string, unknown>
    assert.equal(server['issuer'], dev.url, path)
    assert.equal(server['token_endpoint'], dev.url + '/oauth/token')
    assert.deepEqual(server['code_challenge_methods_supported'], ['S256'])
  }
  const page = await fetch(dev.url + '/oauth/authorize?client_id=x', { headers: { accept: 'text/html' } })
  assert.equal(page.status, 200)
  assert.match(page.headers.get('content-type') ?? '', /text\/html/)

  assert.equal((await post('/oauth/register', { redirect_uris: ['http://evil.example/cb'] })).body['error'], 'invalid_redirect_uri')
  assert.equal((await post('/oauth/register', { redirect_uris: ['https://ok.example/cb#frag'] })).body['error'], 'invalid_redirect_uri')

  const granted = await connect(ana, 'swarms:read swarms:write')
  assert.equal(granted.scope, 'swarms:read swarms:write')
  const reused = await post('/oauth/token', { client_id: granted.client, code: granted.code, code_verifier: granted.verifier, grant_type: 'authorization_code', redirect_uri: redirect }, { form: true })
  assert.equal(reused.body['error'], 'invalid_grant')

  const registered = await post('/oauth/register', { client_name: 'pkce', redirect_uris: [redirect] })
  const params = { client_id: registered.body['client_id']!, code_challenge: encode(createHash('sha256').update('right'.repeat(10)).digest()), code_challenge_method: 'S256', redirect_uri: redirect, response_type: 'code' }
  assert.equal((await post('/oauth/approve', { ...params, allow: true })).status, 401)
  assert.equal((await post('/oauth/approve', { ...params, allow: true, code_challenge_method: 'plain' }, { token: ana.token })).body['error'], 'invalid_request')
  const denied = await post('/oauth/approve', { ...params, allow: false }, { token: ana.token })
  assert.equal(new URL(denied.body['redirect']!).searchParams.get('error'), 'access_denied')
  const coded = new URL((await post('/oauth/approve', { ...params, allow: true }, { token: ana.token })).body['redirect']!).searchParams.get('code')!
  const wrong = await post('/oauth/token', { client_id: params.client_id, code: coded, code_verifier: 'wrong'.repeat(10), grant_type: 'authorization_code' }, { form: true })
  assert.equal(wrong.body['error'], 'invalid_grant')

  const refreshed = await post('/oauth/token', { client_id: granted.client, grant_type: 'refresh_token', refresh_token: granted.refresh }, { form: true })
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body))
  assert.notEqual(refreshed.body['access_token'], granted.access)
  assert.equal((await post('/oauth/token', { client_id: granted.client, grant_type: 'refresh_token', refresh_token: granted.refresh }, { form: true })).body['error'], 'invalid_grant')
  ok(await call('swarms_list', {}, refreshed.body['access_token']), 'a refreshed token reads')

  assert.equal((await fetch(dev.url + '/oauth/revoke', { body: new URLSearchParams({ token: refreshed.body['access_token']! }), headers: { 'content-type': 'application/x-www-form-urlencoded' }, method: 'POST' })).status, 200)
  const revoked = await rpc('tools/list', {}, refreshed.body['access_token'])
  assert.equal(revoked.status, 401)
  assert.match(revoked.headers.get('www-authenticate') ?? '', /error="invalid_token"/)
})

test('scopes: anonymous reads, a write asks for OAuth, a narrow token is refused wider tools', { timeout: 120_000 }, async () => {
  const listed = await rpc('tools/list', {})
  const tools = (listed.body.result?.['tools'] ?? []) as { _meta?: Record<string, string>; name: string }[]
  assert.ok(tools.length >= 35, String(tools.length))
  for (const tool of tools) assert.ok(tool._meta?.['swarms/scope'], tool.name + ' names its scope')
  const created = await call('swarm_create', { goal: 'Refused without a token, on mocks.', title: 'Anonymous (e2e)' })
  assert.equal(created.status, 401)
  const challenge = created.headers.get('www-authenticate') ?? ''
  assert.match(challenge, /^Bearer /)
  assert.ok(challenge.includes('resource_metadata="' + dev.url + '/.well-known/oauth-protected-resource/mcp"'), challenge)
  assert.equal(created.body.error?.data?.['scope'], 'swarms:write')
  assert.ok(challenge.includes('scope="swarms:read swarms:write"'), challenge)

  const narrow = await connect(ana, 'swarms:read swarms:write')
  const made = ok(await call('swarm_create', { goal: 'Made with a read and write token, on mocks.', template: 'cheap', title: 'Narrow (e2e)' }, narrow.access), 'write scope creates')
  for (const [name, args, scope] of [
    ['swarm_fund', { amount: 1, branch: 1, confirm: 'x', swarm: made['id'] }, 'swarms:money'],
    ['swarm_archive', { confirm: 'x', swarm: made['id'] }, 'swarms:admin'],
    ['swarm_contribute', { hash: '0x' + '1'.repeat(64), swarm: made['id'] }, 'swarms:money'],
  ] as const) {
    const refused = await call(name, args, narrow.access)
    assert.equal(refused.status, 403, name)
    const header = refused.headers.get('www-authenticate') ?? ''
    assert.match(header, /error="insufficient_scope"/, name)
    assert.ok(header.includes(scope), name + ' asks for ' + scope)
  }
  ok(await call('swarm_contribute', { amount: '1', swarm: made['id'] }), 'anyone prepares a transfer')
  const bogus = await rpc('tools/list', {}, 'swa_not-a-token')
  assert.equal(bogus.status, 401)
})

test('every tool and resource, signed in with OAuth, on mocks', { timeout: 600_000 }, async () => {
  const full = (await connect(ana, 'swarms:read swarms:write swarms:money swarms:admin')).access
  const op = (await connect(boss, 'swarms:read swarms:write swarms:money swarms:admin')).access

  const agent = ok(await call('swarm_create', { goal: 'Answer what an MCP client asks, on mocks.', template: 'cheap', title: 'MCP agent (e2e)' }, full), 'create agent')
  const tree = ok(await call('swarm_create', { form: 'tree', goal: 'A tree swarm for the MCP sweep, on mocks.', title: 'MCP tree (e2e)' }, full), 'create tree')
  const a = String(agent['id'])
  const t = String(tree['id'])

  const prepared = ok(await call('swarm_contribute', { amount: '3', swarm: a }, full), 'prepare')
  assert.ok(String(prepared['memo']).startsWith('0x'))
  const paid = ana.pay(a, '3')
  asks(await call('swarm_contribute', { hash: paid.hash, swarm: a }, full), 'back ' + a + ' ' + paid.hash.slice(0, 10))
  ok(await call('swarm_contribute', { confirm: 'back ' + a + ' ' + paid.hash.slice(0, 10), hash: paid.hash, swarm: a }, full), 'count a ride')
  const rooted = ana.pay(t, '3', 'n:root')
  ok(await call('swarm_contribute', { confirm: 'back ' + t + ' ' + rooted.hash.slice(0, 10), hash: rooted.hash, swarm: t }, full), 'ride a tree')

  const watched = ok(await call('swarm_watch', { after: 0, swarm: a, timeout: 90 }, full), 'watch')
  assert.ok(['updated', 'idle', 'timeout'].includes(String(watched['reason'])))
  assert.ok(Array.isArray(watched['entries']) && (watched['entries'] as unknown[]).length > 0, 'watch returns the feed since after')
  assert.equal(typeof watched['next'], 'number')
  assert.equal((watched['status'] as Record<string, unknown>)['id'], a)

  for (const [name, args] of [
    ['swarms_list', {}],
    ['swarm_get', { swarm: a }],
    ['swarm_status', { swarm: a }],
    ['swarm_answer', { swarm: a }],
    ['swarm_updates', { limit: 5, swarm: a }],
    ['swarm_feed', { limit: 5, swarm: a }],
    ['swarm_logs', { limit: 5, swarm: a }],
    ['swarm_wait', { swarm: a, timeout: 1 }],
    ['problems_list', {}],
    ['swarm_machines', { swarm: a }],
    ['swarm_machines_export', { swarm: a }],
    ['swarm_hands', { swarm: a }],
    ['swarm_backers', { swarm: a }],
    ['swarm_branches', { swarm: a }],
    ['swarm_progress', { swarm: a }],
    ['swarm_artifacts', { swarm: a }],
    ['swarm_chat', { swarm: a }],
    ['swarms_search', { query: 'MCP' }],
    ['swarm_tree', { swarm: t }],
    ['swarm_node', { node: 'root', swarm: t }],
    ['swarm_proofs', { swarm: t }],
  ] as const) {
    ok(await call(name, args), name + ' anonymous')
  }
  const status = ok(await call('swarm_status', { swarm: a }), 'status')
  assert.equal(status['id'], a)
  assert.ok(String(status['page']).endsWith('/s/' + a))
  const logs = ok(await call('swarm_logs', { limit: 3, swarm: a }), 'logs')
  assert.ok((logs['entries'] as unknown[]).length <= 3)

  const machines = ok(await call('swarm_machines', { swarm: a }), 'machines')['machines'] as { name: string }[]
  const machine = machines[0]?.name ?? 'no-such-machine'
  const commands = reached(await call('swarm_machine_commands', { machine, swarm: a }), 'machine commands')
  const seq = (commands['commands'] as { seq: number }[] | undefined)?.[0]?.seq ?? 1
  reached(await call('swarm_machine_command', { machine, seq, swarm: a }), 'machine command')
  reached(await call('swarm_machine_logs', { machine, swarm: a }), 'machine logs')
  reached(await call('swarm_machine_job', { machine, seq, swarm: a }), 'machine job')
  reached(await call('swarm_feedback', { message: 'The MCP e2e files this on a local mock world.', swarm: a }), 'feedback')

  const proposed = ok(await call('swarm_propose', { parent: 'root', spec: 'A lemma for the MCP sweep.', swarm: t, title: 'MCP sweep lemma' }, full), 'propose')
  assert.match(String(proposed['nid']), /^[0-9a-f]{10}$/)
  ok(await call('swarm_suggest', { parent: 'root', swarm: t, text: 'Try the MCP sweep idea.' }, full), 'suggest')
  reached(await call('swarm_steer', { node: 'root', note: 'Steer from MCP.', swarm: t }, full), 'steer')
  reached(await call('swarm_move', { amount: '1', node: 'root', swarm: t, to: '' }, full), 'move')

  const hand = ok(await call('swarm_hand', { label: 'mcp-e2e', swarm: a }, full), 'hand')
  const name = String(hand['name'])
  assert.ok((ok(await call('swarm_hands', { swarm: a }), 'hands')['hands'] as { name: string }[]).some((each) => each.name === name))
  asks(await call('swarm_hand_remove', { hand: name, swarm: a }, full), 'remove hand ' + name + ' from ' + a)
  assert.equal(ok(await call('swarm_hand_remove', { confirm: 'remove hand ' + name + ' from ' + a, hand: name, swarm: a }, full), 'hand rm')['removed'], true)

  assert.equal(ok(await call('swarm_edit', { swarm: a, title: 'MCP agent, renamed (e2e)' }, full), 'edit title')['title'], 'MCP agent, renamed (e2e)')
  asks(await call('swarm_edit', { nickname: 'mcp-edit-e2e', swarm: a }, full), 'rename ' + a + ' to mcp-edit-e2e')
  assert.equal(ok(await call('swarm_edit', { confirm: 'rename ' + a + ' to mcp-edit-e2e', nickname: 'mcp-edit-e2e', swarm: a }, full), 'edit slug')['nickname'], 'mcp-edit-e2e')
  asks(await call('swarm_nickname', { nickname: null, swarm: a }, full), 'rename ' + a + ' to none')
  assert.equal(ok(await call('swarm_nickname', { confirm: 'rename ' + a + ' to none', nickname: null, swarm: a }, full), 'drop slug')['nickname'], null)

  asks(await call('swarm_fund', { amount: 5, branch: 1, swarm: a }, full), 'fund ' + a + '/1 $5')
  reached(await call('swarm_fund', { amount: 5, branch: 1, confirm: 'fund ' + a + '/1 $5', swarm: a }, full), 'fund')

  reached(await call('swarm_byok', { action: 'status' }, full), 'byok status')
  reached(await call('swarm_byok', { action: 'set', key: 'sk-ant-not-a-real-key', provider: 'anthropic' }, full), 'byok set')
  reached(await call('swarm_byok', { action: 'remove', provider: 'anthropic' }, full), 'byok remove')
  reached(await call('swarm_byok', { action: 'use', swarm: a }, full), 'byok use')
  reached(await call('swarm_byok', { action: 'stop', swarm: a }, full), 'byok stop')

  const templates = await rpc('resources/templates/list', {})
  assert.deepEqual(((templates.body.result?.['resourceTemplates'] ?? []) as { uriTemplate: string }[]).map((each) => each.uriTemplate).sort(), ['swarm://{swarm}/status', 'swarm://{swarm}/tree'])
  const resources = ((await rpc('resources/list', {})).body.result?.['resources'] ?? []) as { uri: string }[]
  assert.ok(resources.some((each) => each.uri === 'swarm://' + a + '/status'), JSON.stringify(resources.slice(0, 5)))
  assert.ok(resources.some((each) => each.uri === 'swarm://' + t + '/tree'))
  const read = async (uri: string) => JSON.parse(((await rpc('resources/read', { uri })).body.result?.['contents'] as { text: string }[])[0]!.text) as Record<string, unknown>
  assert.equal((await read('swarm://' + a + '/status'))['id'], a)
  assert.ok(Array.isArray((await read('swarm://' + t + '/tree'))['nodes']))

  asks(await call('swarm_archive', { swarm: a }, full), 'archive ' + a)
  const refused = await call('swarm_archive', { confirm: 'archive ' + a, swarm: a }, full)
  assert.equal(refused.value['code'], 'access_denied', 'only the operator archives')
  const archived = ok(await call('swarm_archive', { confirm: 'archive ' + a, swarm: a }, op), 'archive')
  assert.equal(typeof archived['archivedAt'], 'number')

  const named = ((await rpc('tools/list', {})).body.result?.['tools'] as { name: string }[]).map((each) => each.name)
  assert.deepEqual(named.filter((each) => !used.has(each)), [], 'every tool was driven')
})

test('swarms mcp: the local stdio server proxies every tool and resource with the CLI token', { timeout: 300_000 }, async () => {
  const run = async (token?: string) => {
    const [inside, outside] = InMemoryTransport.createLinkedPair()
    const served = await Local.serve({ token, url: dev.url }, inside)
    const client = new Client({ name: 'e2e', version: '1' })
    await client.connect(outside)
    return { client, close: async () => { await client.close(); await served.close() } }
  }
  const signed = await run(ana.token)
  const remote = ((await rpc('tools/list', {})).body.result?.['tools'] as { name: string }[]).map((each) => each.name).sort()
  assert.deepEqual((await signed.client.listTools()).tools.map((each) => each.name).sort(), remote)
  assert.ok(signed.client.getInstructions()?.includes('Swarms'))
  const made = await signed.client.callTool({ arguments: { goal: 'Started from the local stdio MCP, on mocks.', template: 'cheap', title: 'Stdio (e2e)' }, name: 'swarm_create' })
  assert.equal(made.isError, undefined, JSON.stringify(made))
  const swarm = (JSON.parse((made.content as { text: string }[])[0]!.text) as { id: string }).id
  const paid = ana.pay(swarm, '2')
  const counted = await signed.client.callTool({ arguments: { confirm: 'back ' + swarm + ' ' + paid.hash.slice(0, 10), hash: paid.hash, swarm }, name: 'swarm_contribute' })
  assert.notEqual(counted.isError, true, JSON.stringify(counted))
  const watched = await signed.client.callTool({ arguments: { after: 0, swarm, timeout: 30 }, name: 'swarm_watch' })
  assert.notEqual(watched.isError, true, JSON.stringify(watched))
  assert.equal((JSON.parse((watched.content as { text: string }[])[0]!.text) as { status: { id: string } }).status.id, swarm)
  assert.ok((await signed.client.listResourceTemplates()).resourceTemplates.length === 2)
  const status = await signed.client.readResource({ uri: 'swarm://' + swarm + '/status' })
  assert.equal((JSON.parse((status.contents[0] as { text: string }).text) as { id: string }).id, swarm)
  await signed.close()
  const anonymous = await run()
  const refused = await anonymous.client.callTool({ arguments: { goal: 'Refused without a token, on mocks.', title: 'No token (e2e)' }, name: 'swarm_create' })
  assert.equal(refused.isError, true)
  assert.match((refused.content as { text: string }[])[0]!.text, /Sign in with the swarms CLI/)
  assert.equal((await anonymous.client.callTool({ arguments: {}, name: 'swarms_list' })).isError, undefined)
  await anonymous.close()
})

