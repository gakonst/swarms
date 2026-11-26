import * as Http from 'node:http'
import * as Https from 'node:https'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type Kind = 'json' | 'html' | 'sse' | 'socket' | 'bytes' | 'download' | 'mcp' | 'redirect'

export type Probe = {
  accept?: string
  body?: unknown
  check?: (body: unknown, response: Response) => string | undefined
  kind: Kind
  method: string
  path: string
  route?: string
  schema?: string
  signed?: 'in' | 'out'
  patient?: boolean
  skip?: string
  status: number[]
}

export type Row = { method: string; ms: number; note: string; ok: boolean; patient?: boolean; route: string; samples: number[]; server: number | undefined; signed: 'in' | 'out'; status: number | string }

export type World = {
  artifact?: string
  branch?: string
  command?: number
  job?: number
  machine?: string
  /** The address SWARMS_TOKEN signs in as. */
  me?: string
  /** A throwaway swarm this sweep created itself: with SWARMS_SWEEP_WRITES=1, the only swarm a live site takes writes on. */
  made?: string
  message?: number
  name?: string
  node?: string
  rider?: string
  socket?: string
  swarm: string
  tree?: string
}

type Schema = Record<string, unknown>

type Spec = { components?: { schemas?: Record<string, Schema> }; paths: Record<string, Record<string, { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }>> }

export const target = 300

export function base(given = process.env['SWARMS_BASE']) {
  return (given ?? 'https://swarms.new').replace(/\/+$/, '')
}

const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0'])

/** Whether root is this machine: the only base every write goes to. */
export function local(root: string) {
  try {
    const host = new URL(root).hostname
    return loopback.has(host) || host.endsWith('.localhost')
  } catch {
    return false
  }
}

export const mutating = new Set(['DELETE', 'PATCH', 'POST', 'PUT'])

export const skippedWrite = 'skipped (write)'

/**
 * Why a write to path must not be sent to root, or undefined when it may be. A local base takes every write. A live site
 * takes none, unless SWARMS_SWEEP_WRITES=1 and the write targets a throwaway swarm this sweep created itself (made).
 */
/**
 * Whether this sweep makes a throwaway swarm of its own on root, writes to it and archives it: SWARMS_SWEEP_WRITES=1,
 * a signed-in token to make it with, the operator's gateway key to archive it with, and a local base or, for a live
 * site, SWARMS_SWEEP_LIVE_WRITES=1 as well.
 */
export function throwaway(root: string, token: string | undefined, operator: string | undefined, env: Record<string, string | undefined> = process.env) {
  return env['SWARMS_SWEEP_WRITES'] === '1' && !!token && !!operator && (local(root) || env['SWARMS_SWEEP_LIVE_WRITES'] === '1')
}

export function unwritable(root: string, path: string, made: string | undefined, writes = process.env['SWARMS_SWEEP_WRITES']) {
  if (local(root)) return undefined
  if (writes === '1' && made && /^[0-9a-z]+$/.test(made) && new RegExp(`^/(v1|api)/swarms/${made}(/|\\?|$)`).test(path)) return undefined
  return skippedWrite
}

function now() {
  return performance.now()
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0
}

export function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0
}

function served(response: Response) {
  const timing = response.headers.get('server-timing') ?? ''
  const total = /(?:^|,\s*)total;dur=([0-9.]+)/.exec(timing)
  return total ? Number(total[1]) : undefined
}

type Sent = { body: Record<string, unknown> | undefined; ms: number; server: number | undefined; status: number }

async function send(root: string, method: string, path: string, bearer: string, body?: unknown): Promise<Sent> {
  const started = now()
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${bearer}` }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(root + path, { body: body === undefined ? null : JSON.stringify(body), headers, method })
  const parsed = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined
  return { body: parsed, ms: now() - started, server: served(response), status: response.status }
}

function written(route: string, method: string, sent: Sent, ok: boolean, note: string): Row {
  return { method, ms: Math.round(sent.ms), note, ok, route, samples: [sent.ms], server: sent.server, signed: 'in', status: sent.status }
}

function said(sent: Sent) {
  return String(sent.body?.['detail'] ?? '').slice(0, 70)
}

/** Makes the throwaway swarm, signed in. A failure is a row and no swarm. */
export async function make(root: string, token: string): Promise<{ id?: string; row: Row }> {
  const sent = await send(root, 'POST', '/v1/swarms', token, { goal: 'A throwaway swarm the route sweep makes, writes to and archives.', template: 'cheap', title: 'Route sweep (throwaway)' })
  const id = typeof sent.body?.['id'] === 'string' ? sent.body['id'] : undefined
  return { ...(id ? { id } : {}), row: written('/v1/swarms (throwaway)', 'POST', sent, sent.status === 201 && !!id, id ? `made ${id}` : said(sent)) }
}

/** Real writes on the throwaway swarm made: a message, a reply in its thread, a reaction, a rename, and a hand issued then removed. */
export async function exercise(root: string, token: string, made: string): Promise<Row[]> {
  const rows: Row[] = []
  const v = `/v1/swarms/${made}`
  const posted = await send(root, 'POST', `${v}/chat`, token, { text: 'hello from the route sweep' })
  const message = Number(posted.body?.['id'] ?? (posted.body?.['message'] as { id?: unknown } | undefined)?.id)
  rows.push(written('/v1/swarms/:made/chat', 'POST', posted, posted.status === 201 && message > 0, message > 0 ? `message ${message}` : said(posted)))
  if (message > 0) {
    const replied = await send(root, 'POST', `${v}/chat`, token, { parent: message, text: 'a reply from the route sweep' })
    rows.push(written('/v1/swarms/:made/chat (reply)', 'POST', replied, replied.status === 201, said(replied)))
    const reacted = await send(root, 'POST', `${v}/chat/${message}/reactions`, token, { emoji: '👍' })
    rows.push(written('/v1/swarms/:made/chat/:message/reactions', 'POST', reacted, reacted.status === 200, said(reacted)))
    const thread = await send(root, 'GET', `${v}/chat/${message}`, token)
    const replies = (thread.body?.['replies'] ?? thread.body?.['messages']) as unknown[] | undefined
    rows.push(written('/v1/swarms/:made/chat/:message (after writes)', 'GET', thread, thread.status === 200 && (replies?.length ?? 0) > 0, `${replies?.length ?? 0} in the thread`))
  }
  const renamed = await send(root, 'PATCH', v, token, { title: 'Route sweep (renamed)' })
  rows.push(written('/v1/swarms/:made', 'PATCH', renamed, renamed.status === 200 && renamed.body?.['title'] === 'Route sweep (renamed)', said(renamed)))
  const handed = await send(root, 'POST', `${v}/hands`, token, { label: 'sweep' })
  const hand = typeof handed.body?.['name'] === 'string' ? handed.body['name'] : undefined
  rows.push(written('/v1/swarms/:made/hands', 'POST', handed, handed.status === 201 && !!hand, hand ?? said(handed)))
  if (hand) {
    const removed = await send(root, 'DELETE', `${v}/hands/${hand}`, token)
    rows.push(written('/v1/swarms/:made/hands/:hand', 'DELETE', removed, removed.status === 200, said(removed)))
  }
  return rows
}

/** Archives the throwaway swarm with the operator's key, then checks it took no more writes. */
export async function archive(root: string, operator: string, made: string): Promise<Row[]> {
  const archived = await send(root, 'POST', `/v1/swarms/${made}/archive`, operator, {})
  const after = await send(root, 'PATCH', `/v1/swarms/${made}`, operator, { title: 'Route sweep (after archive)' })
  return [
    written('/v1/swarms/:made/archive', 'POST', archived, archived.status === 200, said(archived)),
    written('/v1/swarms/:made (archived)', 'PATCH', after, after.status === 410, said(after)),
  ]
}

function resolve(spec: Spec, schema: Schema): Schema {
  const ref = schema['$ref']
  if (typeof ref !== 'string') return schema
  const name = ref.replace('#/components/schemas/', '')
  const found = spec.components?.schemas?.[name]
  if (!found) throw new Error('unknown schema ' + ref)
  return resolve(spec, found)
}

function typed(value: unknown, type: string) {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  return typeof value === type
}

export function validate(spec: Spec, given: Schema, value: unknown, at = '$', errors: string[] = []): string[] {
  if (errors.length > 4) return errors
  const schema = resolve(spec, given)
  const any = schema['anyOf'] ?? schema['oneOf']
  if (Array.isArray(any)) {
    const tried = (any as Schema[]).map((option) => validate(spec, option, value, at, []))
    if (tried.some((each) => each.length === 0)) return errors
    const closest = tried.filter((each) => !each.every((error) => /expected (null|object|array|string|number|integer|boolean)/.test(error)))[0] ?? tried[0] ?? []
    errors.push(...closest.slice(0, 2))
    return errors
  }
  if (Array.isArray(schema['allOf'])) for (const part of schema['allOf'] as Schema[]) validate(spec, part, value, at, errors)
  if ('const' in schema && value !== schema['const']) errors.push(`${at}: expected ${JSON.stringify(schema['const'])}`)
  if (Array.isArray(schema['enum']) && !(schema['enum'] as unknown[]).includes(value)) errors.push(`${at}: ${JSON.stringify(value)} not in enum`)
  const type = schema['type']
  if (type !== undefined) {
    const types = Array.isArray(type) ? (type as string[]) : [type as string]
    const nullable = schema['nullable'] === true && value === null
    if (!nullable && !types.some((each) => typed(value, each))) {
      errors.push(`${at}: expected ${types.join('|')}, got ${value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value}`)
      return errors
    }
  }
  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < (schema['minimum'] as number)) errors.push(`${at}: below minimum`)
    if (typeof schema['maximum'] === 'number' && value > (schema['maximum'] as number)) errors.push(`${at}: above maximum`)
  }
  if (typeof value === 'string' && typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern'] as string).test(value)) errors.push(`${at}: ${JSON.stringify(value.slice(0, 40))} fails ${schema['pattern']}`)
  if (Array.isArray(value) && schema['items']) value.slice(0, 50).forEach((item, index) => validate(spec, schema['items'] as Schema, item, `${at}[${index}]`, errors))
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const properties = (schema['properties'] ?? {}) as Record<string, Schema>
    for (const key of (schema['required'] ?? []) as string[]) if (!(key in record)) errors.push(`${at}.${key}: missing`)
    for (const [key, child] of Object.entries(record)) {
      const property = properties[key]
      if (property) validate(spec, property, child, `${at}.${key}`, errors)
      else if (schema['additionalProperties'] === false) errors.push(`${at}.${key}: not in the schema`)
      else if (typeof schema['additionalProperties'] === 'object') validate(spec, schema['additionalProperties'] as Schema, child, `${at}.${key}`, errors)
    }
  }
  return errors
}

function shaped(spec: Spec | undefined, probe: Probe, status: number, body: unknown) {
  if (!spec || !probe.schema) return undefined
  const [method, path] = probe.schema.split(' ') as [string, string]
  const operation = spec.paths[path]?.[method.toLowerCase()]
  if (!operation) return `OpenAPI has no ${probe.schema}`
  const response = operation.responses?.[String(status)]
  const schema = response?.content?.['application/json']?.schema
  if (!schema) return status >= 400 ? undefined : `OpenAPI has no ${status} body for ${probe.schema}`
  const errors = validate(spec, schema, body)
  return errors.length ? errors.slice(0, 3).join('; ') : undefined
}

function problem(body: unknown) {
  const record = body as { code?: unknown; detail?: unknown } | null
  return record && typeof record.code === 'string' && typeof record.detail === 'string' ? undefined : 'error body is not a Problem'
}

async function sse(url: string, headers: Record<string, string>, accept: string) {
  const controller = new AbortController()
  const started = now()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(url, { headers: { ...headers, accept }, signal: controller.signal })
    const ms = now() - started
    const type = response.headers.get('content-type') ?? ''
    let first = ''
    if (response.ok && response.body) {
      const reader = response.body.getReader()
      const read = await Promise.race([reader.read(), new Promise<undefined>((done) => setTimeout(done, 3000))])
      if (read && !read.done) first = new TextDecoder().decode(read.value).slice(0, 80)
    }
    controller.abort()
    const streaming = accept === 'text/event-stream'
    return { ms, note: response.ok && streaming && !type.startsWith('text/event-stream') ? `content-type ${type}` : !streaming ? `${type}, first byte` : first ? `first: ${first.replace(/\s+/g, ' ').trim()}` : 'no event in 3 s', server: served(response), status: response.status }
  } catch (error) {
    return { ms: now() - started, note: String(error), server: undefined, status: 'error' as const }
  } finally {
    clearTimeout(timer)
  }
}

async function socket(url: string) {
  const started = now()
  return new Promise<{ ms: number; note: string; status: number | 'error' }>((done) => {
    const ws = new WebSocket(url.replace(/^http/, 'ws'))
    let opened = 0
    ws.addEventListener('open', () => {
      opened = now() - started
    })
    const timer = setTimeout(() => {
      ws.close()
      done({ ms: now() - started, note: 'no message in 6 s', status: 'error' })
    }, 6000)
    ws.addEventListener('message', (event) => {
      clearTimeout(timer)
      const text = String(event.data)
      let type = ''
      try {
        type = String((JSON.parse(text) as { type?: unknown }).type ?? '')
      } catch {}
      ws.close()
      done({ ms: now() - started, note: `open in ${Math.round(opened)} ms, then ${type ? `first: ${type}` : `first: ${text.slice(0, 40)}`}`, status: type === 'welcome' ? 101 : 'error' })
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      done({ ms: now() - started, note: 'socket error', status: 'error' })
    })
  })
}

/** Why the answer is a known state outside Swarms, or undefined: the gateway's treasury cannot pay storage, said by Swarms' degraded answer (its x-swarms-unavailable header or {state: 'unavailable', reason: 'treasury'} body) or by the gateway's own 503 passed through. A degraded answer served from a snapshot is real data, not external. */
export function external(status: number, header: string | null, body: unknown) {
  const whole = (typeof body === 'object' && body ? body : {}) as { unavailable?: unknown }
  const told = (typeof whole.unavailable === 'object' && whole.unavailable ? whole.unavailable : whole) as { detail?: unknown; message?: unknown; reason?: unknown; state?: unknown }
  if (header === 'treasury' || (told.state === 'unavailable' && told.reason === 'treasury')) return typeof told.message === 'string' ? told.message : 'the gateway cannot pay storage now'
  if (status === 503 && typeof told.detail === 'string' && /treasury cannot cover/i.test(told.detail)) return told.detail
  return undefined
}

export async function call(root: string, probe: Probe, token: string | undefined, spec: Spec | undefined, samples: number, sockets = root, made?: string): Promise<Row> {
  const signed = probe.signed ?? 'out'
  const route = probe.route ?? probe.path
  if (mutating.has(probe.method.toUpperCase()) && unwritable(root, probe.path, made))
    return { method: probe.method, ms: 0, note: skippedWrite, ok: true, route, samples: [], server: undefined, signed, status: 'skip' }
  const headers: Record<string, string> = { accept: probe.accept ?? (probe.kind === 'html' ? 'text/html' : 'application/json') }
  if (signed === 'in' && token) headers['authorization'] = `Bearer ${token}`
  const url = root + probe.path
  if (probe.kind === 'socket') {
    const opened = await socket(sockets + probe.path)
    return { method: 'WS', ms: Math.round(opened.ms), note: opened.note, ok: opened.status === 101, route, samples: [opened.ms], server: undefined, signed, status: opened.status }
  }
  if (probe.skip) return { method: probe.method, ms: 0, note: `skipped: ${probe.skip}`, ok: true, route, samples: [], server: undefined, signed, status: 'skip' }
  if (probe.kind === 'sse' || probe.kind === 'download') {
    const opened = await sse(url, headers, probe.kind === 'download' ? (probe.accept ?? '*/*') : 'text/event-stream')
    return { method: probe.method, ms: Math.round(opened.ms), note: opened.note, ok: probe.status.includes(opened.status as number) && (probe.kind === 'download' || !opened.note.startsWith('content-type')), route, samples: [opened.ms], server: opened.server, signed, status: opened.status }
  }
  const repeat = probe.method === 'GET' ? samples : 1
  const times: number[] = []
  const servers: number[] = []
  let last: Response | undefined
  let text = ''
  for (let index = 0; index < repeat; index += 1) {
    const started = now()
    try {
      const init: RequestInit = { headers: { ...headers }, method: probe.method, redirect: 'manual' }
      if (probe.body !== undefined) {
        init.body = JSON.stringify(probe.body)
        ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
      }
      last = await fetch(url, init)
      text = probe.kind === 'bytes' ? String((await last.arrayBuffer()).byteLength) : await last.text()
    } catch (error) {
      return { method: probe.method, ms: Math.round(now() - started), note: String(error), ok: false, route, samples: [], server: undefined, signed, status: 'error' }
    }
    times.push(now() - started)
    const server = served(last)
    if (server !== undefined) servers.push(server)
  }
  const response = last as Response
  const notes: string[] = []
  const type = response.headers.get('content-type') ?? ''
  let body: unknown = text
  if (!probe.status.includes(response.status)) notes.push(`expected ${probe.status.join('|')}`)
  if (probe.kind === 'json' || probe.kind === 'mcp' || (response.status >= 400 && type.includes('json'))) {
    try {
      body = JSON.parse(text)
    } catch {
      notes.push(`not JSON (${type}): ${text.slice(0, 60)}`)
    }
  }
  if (probe.kind === 'json' && response.status >= 400 && typeof body === 'object') {
    const bad = problem(body)
    if (bad) notes.push(bad)
    else notes.push(String((body as { detail: string }).detail).slice(0, 70))
  }
  if (probe.kind === 'html' && response.status < 300 && !type.startsWith('text/html')) notes.push(`content-type ${type}`)
  if (probe.kind === 'redirect' || (probe.kind === 'html' && response.status === 301)) notes.push(`→ ${response.headers.get('location') ?? 'nowhere'}`)
  if (probe.kind === 'json' && response.status < 300) {
    const bad = shaped(spec, probe, response.status, body)
    if (bad) notes.push(bad)
  }
  if (probe.check && probe.status.includes(response.status)) {
    const bad = probe.check(body, response)
    if (bad) notes.push(bad)
  }
  const outside = external(response.status, response.headers.get('x-swarms-unavailable'), body)
  if (outside) return { method: probe.method, ms: Math.round(median(times)), note: `external: ${outside.slice(0, 90)}`, ok: true, route, samples: times, server: servers.length ? Math.round(median(servers)) : undefined, signed, status: 'ext' }
  const failed = notes.some((note) => /^(expected|not JSON|content-type|error body|OpenAPI|\$|bad:)/.test(note))
  return { ...(probe.patient ? { patient: true } : {}), method: probe.method, ms: Math.round(median(times)), note: notes.join('; '), ok: !failed, route, samples: times, server: servers.length ? Math.round(median(servers)) : undefined, signed, status: response.status }
}

async function json<T>(root: string, path: string): Promise<T | undefined> {
  const response = await fetch(root + path, { headers: { accept: 'application/json' } }).catch(() => undefined)
  if (!response?.ok) return undefined
  return (await response.json().catch(() => undefined)) as T | undefined
}

export async function discover(root: string): Promise<World> {
  const listed = await json<{ funders: Record<string, { who: { address: string } }[]>; swarms: { form: string; id: string; nickname: string | null; status: string }[] }>(root, '/v1/swarms')
  const swarms = listed?.swarms ?? []
  if (!swarms.length) throw new Error(`${root}/v1/swarms listed no swarms`)
  const agents = swarms.filter((each) => each.form !== 'tree')
  const tree = swarms.find((each) => each.form === 'tree')?.id
  const named = swarms.find((each) => each.nickname)?.nickname ?? undefined
  let swarm = agents[0]?.id ?? swarms[0]!.id
  let machine: string | undefined
  for (const candidate of agents.slice(0, 12)) {
    const found = await json<{ machines: { kind: string; name: string; runs: { count: number } | null }[] }>(root, `/v1/swarms/${candidate.id}/machines`)
    const busy = found?.machines.find((each) => each.kind === 'sandbox' && (each.runs?.count ?? 0) > 0)
    if (busy) {
      swarm = candidate.id
      machine = busy.name
      break
    }
  }
  const page = await fetch(root + '/', { headers: { accept: 'text/html' } }).then((response) => response.text(), () => '')
  const socketed = /"socket":"(wss?:\/\/[^"]+)"/.exec(page)?.[1]
  const [commands, chat, branches, artifacts, nodes] = await Promise.all([
    machine ? json<{ commands: { log: string | null; seq: number }[] }>(root, `/v1/swarms/${swarm}/machines/${encodeURIComponent(machine)}/commands?limit=100`) : undefined,
    json<{ messages: { id: number }[] }>(root, `/v1/swarms/${swarm}/chat`),
    json<{ branches: { id: string }[] }>(root, `/v1/swarms/${swarm}/branches`),
    json<{ artifacts: { url: string }[] }>(root, `/v1/swarms/${swarm}/artifacts`),
    tree ? json<{ nodes: { id: string }[] }>(root, `/v1/swarms/${tree}/tree`) : undefined,
  ])
  const artifact = artifacts?.artifacts.map((each) => new URL(each.url).pathname.replace(/^\/swarms/, '')).find((path) => path.startsWith('/a/'))
  return {
    swarm,
    ...(artifact ? { artifact } : {}),
    ...(branches?.branches[0] ? { branch: branches.branches[0].id } : {}),
    ...(commands?.commands[0] ? { command: commands.commands[0].seq } : {}),
    ...(commands?.commands.find((each) => each.log) ? { job: commands.commands.find((each) => each.log)!.seq } : {}),
    ...(machine ? { machine } : {}),
    ...(chat?.messages.length ? { message: chat.messages[chat.messages.length - 1]!.id } : {}),
    ...(named ? { name: named } : {}),
    ...(nodes?.nodes[0] ? { node: nodes.nodes[0].id } : {}),
    ...(listed?.funders[swarm]?.[0] ? { rider: listed.funders[swarm]![0]!.who.address } : {}),
    ...(socketed ? { socket: socketed.replace(/^ws/, 'http') } : {}),
    ...(tree ? { tree } : {}),
  }
}

const read = [200]
const refused = [400, 401]

function treeless(body: unknown) {
  return /tree/.test(String((body as { detail?: unknown })?.detail)) ? undefined : 'bad: not the tree-swarm refusal'
}

function listed(key: string) {
  return (body: unknown) => (Array.isArray((body as Record<string, unknown>)?.[key]) ? undefined : `bad: no ${key} list`)
}

export function probes(world: World): Probe[] {
  const s = world.swarm
  const m = world.machine ? encodeURIComponent(world.machine) : undefined
  const t = world.tree
  const v = `/v1/swarms/${s}`
  const a = `/api/swarms/${s}`
  const pages: Probe[] = [
    ...['/', '/ideas', '/new', '/about', '/docs', '/faq', '/board', `/s/${s}`, `/s/${s}/chat`, `/s/${s}/code`, `/s/${s}/results`, `/s/${s}/board`, `/s/${s}/about`, '/me', '/me/ai'].map((path) => ({ kind: 'html' as const, method: 'GET', path, route: path.replace(s, ':id'), status: path.startsWith('/s/') ? [200, 301] : read })),
    ...(world.rider ? [{ kind: 'html' as const, method: 'GET', path: `/u/${world.rider}`, route: '/u/:who', status: read }] : []),
    ...(world.name ? [{ kind: 'html' as const, method: 'GET', path: `/${world.name}`, route: '/:nickname', status: read }] : []),
    { kind: 'redirect', method: 'GET', path: '/join', status: [301] },
    { kind: 'html', method: 'GET', path: '/zz/no-such-page', route: '/<unknown>', status: [404] },
    { kind: 'html', method: 'GET', path: '/unclaimed-name-zz', route: '/:nickname (unclaimed)', status: read },
    { kind: 'html', method: 'GET', path: '/x', status: read },
    { kind: 'html', method: 'GET', path: `/x/s/${s}`, route: '/x/s/:id', status: read },
    { kind: 'bytes', method: 'GET', path: '/x/card.svg', status: read },
    { kind: 'html', method: 'GET', path: '/tg', status: read },
    { kind: 'html', method: 'GET', path: `/tg/s/${s}`, route: '/tg/s/:id', status: read },
    { kind: 'json', method: 'GET', path: `/oembed?url=${encodeURIComponent('https://swarms.new/s/' + s)}`, route: '/oembed', status: read },
    { kind: 'bytes', method: 'GET', path: '/og/about/card.png', route: '/og/about/card.png', status: read },
    { kind: 'bytes', method: 'GET', path: `/og/s/${s}/card.png`, route: '/og/s/:id/card.png', status: read },
    { kind: 'bytes', method: 'GET', path: '/favicon.ico', status: read },
    { kind: 'json', method: 'GET', path: '/feedback', status: read },
    ...(world.artifact
      ? [
          { kind: 'bytes' as const, method: 'GET', path: world.artifact, route: '/a/:id/:slug/*', status: read },
          { kind: 'bytes' as const, method: 'HEAD', path: world.artifact, route: '/a/:id/:slug/*', status: read },
          { kind: 'redirect' as const, method: 'GET', path: world.artifact.split('/').slice(0, 4).join('/'), route: '/a/:id/:slug', status: [301] },
        ]
      : []),
  ]
  const api: Probe[] = [
    { kind: 'json', method: 'GET', path: '/api/config', status: read },
    { check: listed('swarms'), kind: 'json', method: 'GET', path: '/api/swarms', status: read },
    { kind: 'json', method: 'GET', path: a, route: '/api/swarms/:id', status: read },
    { kind: 'json', method: 'GET', path: `${a}?feed=0`, route: '/api/swarms/:id?feed=0', status: read },
    { check: listed('entries'), kind: 'json', method: 'GET', path: `${a}/feed?limit=20`, route: '/api/swarms/:id/feed', status: read },
    { kind: 'sse', method: 'GET', path: `${a}/live?after=999999999`, route: '/api/swarms/:id/live', status: read },
    { kind: 'json', method: 'GET', path: `${a}/code`, route: '/api/swarms/:id/code', status: read },
    { kind: 'json', method: 'GET', path: `${a}/git/log?ref=main&limit=20`, route: '/api/swarms/:id/git/log', status: [200, 404] },
    { kind: 'json', method: 'GET', path: `${a}/git/files?ref=main`, route: '/api/swarms/:id/git/files', status: [200, 404] },
    { kind: 'json', method: 'GET', path: `${a}/git/nope`, route: '/api/swarms/:id/git/:unknown', status: [404] },
    { kind: 'json', method: 'GET', path: `${a}/progress`, route: '/api/swarms/:id/progress', status: read },
    { check: listed('artifacts'), kind: 'json', method: 'GET', path: `${a}/artifacts`, route: '/api/swarms/:id/artifacts', status: read },
    { kind: 'json', method: 'GET', path: `${a}/chat`, route: '/api/swarms/:id/chat', status: read },
    ...(world.message ? [{ kind: 'json' as const, method: 'GET', path: `${a}/chat/${world.message}`, route: '/api/swarms/:id/chat/:message', status: read }] : []),
    { kind: 'json', method: 'GET', path: `${a}/team`, route: '/api/swarms/:id/team', status: read },
    { check: listed('branches'), kind: 'json', method: 'GET', path: `${a}/branches`, route: '/api/swarms/:id/branches', status: read },
    { check: listed('hands'), kind: 'json', method: 'GET', path: `${a}/hands`, route: '/api/swarms/:id/hands', status: read },
    { check: treeless, kind: 'json', method: 'GET', path: `${a}/tree`, route: '/api/swarms/:id/tree (agent swarm)', status: [404] },
    { check: treeless, kind: 'json', method: 'GET', path: `${a}/proofs`, route: '/api/swarms/:id/proofs (agent swarm)', status: [404] },
    ...(world.rider ? [{ kind: 'json' as const, method: 'GET', path: `/api/riders/${world.rider}`, route: '/api/riders/:who', status: read }] : []),
    { kind: 'json', method: 'GET', path: '/api/names/no-such-name-zz', route: '/api/names/:name (unknown)', status: [404] },
    { kind: 'json', method: 'GET', path: '/api/general/chat', status: read },
    { kind: 'json', method: 'GET', path: '/api/me', status: [401] },
    { kind: 'json', method: 'GET', path: '/api/me/ai', status: [401] },
    { kind: 'json', method: 'GET', path: `/api/me/swarms/${s}`, route: '/api/me/swarms/:id', status: [401] },
    { kind: 'json', method: 'GET', path: '/api/no-such-route', status: [404] },
    { kind: 'socket', method: 'GET', path: '/api/swarms/live', status: [101] },
    { kind: 'socket', method: 'GET', path: '/api/general/chat/live', status: [101] },
    { kind: 'socket', method: 'GET', path: `${a}/chat/live`, route: '/api/swarms/:id/chat/live', status: [101] },
    { body: {}, kind: 'json', method: 'POST', path: '/api/swarms', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: '/api/me', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: '/api/general/chat', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/contributions`, route: '/api/swarms/:id/contributions', status: [400] },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/transfer`, route: '/api/swarms/:id/transfer', schema: 'POST /v1/swarms/{id}/transfer', status: read },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/chat`, route: '/api/swarms/:id/chat', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/team`, route: '/api/swarms/:id/team', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/btw`, route: '/api/swarms/:id/btw', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/ai`, route: '/api/swarms/:id/ai', status: refused },
    { body: {}, kind: 'json', method: 'PATCH', path: a, route: '/api/swarms/:id', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/archive`, route: '/api/swarms/:id/archive', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: '/api/me/ai/claude', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: '/api/me/ai/claude/complete', status: refused },
    { kind: 'json', method: 'DELETE', path: '/api/me/ai/claude', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: '/api/me/ai/keys/anthropic', route: '/api/me/ai/keys/:provider', status: refused },
    { kind: 'json', method: 'DELETE', path: '/api/me/ai/keys/anthropic', route: '/api/me/ai/keys/:provider', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/team/members`, route: '/api/swarms/:id/team/members', status: refused },
    { kind: 'json', method: 'DELETE', path: `${a}/team/members/0x0000000000000000000000000000000000000001`, route: '/api/swarms/:id/team/members/:member', status: [401] },
    { body: {}, kind: 'json', method: 'PUT', path: `${a}/picture`, route: '/api/swarms/:id/picture', status: refused },
    { kind: 'json', method: 'DELETE', path: `${a}/picture`, route: '/api/swarms/:id/picture', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/triage`, route: '/api/swarms/:id/triage', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/nodes`, route: '/api/swarms/:id/nodes', status: [400, 401, 410] },
    { body: {}, kind: 'json', method: 'POST', path: `${a}/ideas`, route: '/api/swarms/:id/ideas', status: [400, 401, 410] },
    ...(world.message ? [{ body: {}, kind: 'json' as const, method: 'POST', path: `${a}/chat/${world.message}/reactions`, route: '/api/swarms/:id/chat/:message/reactions', status: refused }] : []),
    ...(world.branch ? ['fund', 'move', 'stop'].map((verb) => ({ body: {}, kind: 'json' as const, method: 'POST', path: `${a}/branches/${world.branch}/${verb}`, route: `/api/swarms/:id/branches/:branch/${verb}`, status: refused })) : []),
    ...(t
      ? [
          { kind: 'json' as const, method: 'GET', path: `/api/swarms/${t}/tree`, route: '/api/swarms/:tree/tree', status: read },
          { kind: 'json' as const, method: 'GET', path: `/api/swarms/${t}/proofs`, route: '/api/swarms/:tree/proofs', status: read },
          ...(world.node
            ? [
                { kind: 'json' as const, method: 'GET', path: `/api/swarms/${t}/nodes/${world.node}`, route: '/api/swarms/:tree/nodes/:nid', status: read },
                { kind: 'json' as const, method: 'GET', path: `/api/swarms/${t}/nodes/${world.node}/updates?after=0`, route: '/api/swarms/:tree/nodes/:nid/updates', status: read },
                ...['steer', 'move', 'end', 'review'].map((verb) => ({ body: {}, kind: 'json' as const, method: 'POST', path: `/api/swarms/${t}/nodes/${world.node}/${verb}`, route: `/api/swarms/:tree/nodes/:nid/${verb}`, status: refused })),
                { kind: 'html' as const, method: 'GET', path: `/s/${t}/n/${world.node}`, route: '/s/:tree/n/:nid', status: [200, 301] },
                { kind: 'html' as const, method: 'GET', path: `/x/s/${t}/n/${world.node}`, route: '/x/s/:tree/n/:nid', status: read },
                { kind: 'html' as const, method: 'GET', path: `/tg/s/${t}/n/${world.node}`, route: '/tg/s/:tree/n/:nid', status: read },
              ]
            : []),
        ]
      : []),
  ]
  const v1: Probe[] = [
    { kind: 'json', method: 'GET', path: '/v1/config', schema: 'GET /v1/config', status: read },
    { kind: 'json', method: 'GET', path: '/v1/health', schema: 'GET /v1/health', status: read },
    { kind: 'json', method: 'GET', path: '/v1/problems', schema: 'GET /v1/problems', status: read },
    { kind: 'json', method: 'GET', path: '/v1/swarms', schema: 'GET /v1/swarms', status: read },
    { kind: 'json', method: 'GET', path: '/v1/swarms?status=paused', route: '/v1/swarms?status=', schema: 'GET /v1/swarms', status: read },
    { kind: 'json', method: 'GET', path: '/v1/search?q=proof', route: '/v1/search', schema: 'GET /v1/search', status: read },
    { kind: 'json', method: 'GET', path: v, route: '/v1/swarms/:id', schema: 'GET /v1/swarms/{id}', status: read },
    { kind: 'json', method: 'GET', path: '/v1/swarms/nonexistent00', route: '/v1/swarms/:id (unknown)', status: [404] },
    { kind: 'json', method: 'GET', path: `${v}/answer`, route: '/v1/swarms/:id/answer', schema: 'GET /v1/swarms/{id}/answer', status: read },
    { kind: 'json', method: 'GET', path: `${v}/updates?limit=5`, route: '/v1/swarms/:id/updates', schema: 'GET /v1/swarms/{id}/updates', status: read },
    { kind: 'json', method: 'GET', path: `${v}/feed?limit=20`, route: '/v1/swarms/:id/feed', schema: 'GET /v1/swarms/{id}/feed', status: read },
    { kind: 'json', method: 'GET', path: `${v}/search?q=the`, route: '/v1/swarms/:id/search', schema: 'GET /v1/swarms/{id}/search', status: read },
    { kind: 'sse', method: 'GET', path: `${v}/live?after=999999999`, route: '/v1/swarms/:id/live', status: read },
    { kind: 'sse', method: 'GET', path: v, route: '/v1/swarms/:id (Accept: text/event-stream)', status: read },
    { kind: 'json', method: 'GET', patient: true, path: `${v}/wait?timeout=1`, route: '/v1/swarms/:id/wait (1 s long poll)', schema: 'GET /v1/swarms/{id}/wait', status: read },
    { kind: 'json', method: 'GET', path: `${v}/hands`, route: '/v1/swarms/:id/hands', schema: 'GET /v1/swarms/{id}/hands', status: read },
    { kind: 'json', method: 'GET', path: `${v}/machines`, route: '/v1/swarms/:id/machines', schema: 'GET /v1/swarms/{id}/machines', status: read },
    { kind: 'download', method: 'GET', path: `${v}/machines/export`, route: '/v1/swarms/:id/machines/export', status: read },
    ...(m
      ? [
          { kind: 'json' as const, method: 'GET', path: `${v}/machines/${m}/commands?limit=5`, route: '/v1/swarms/:id/machines/:machine/commands', schema: 'GET /v1/swarms/{id}/machines/{machine}/commands', status: read },
          { kind: 'json' as const, method: 'GET', path: `${v}/machines/${m}/logs`, route: '/v1/swarms/:id/machines/:machine/logs', schema: 'GET /v1/swarms/{id}/machines/{machine}/logs', status: read },
          { kind: 'download' as const, method: 'GET', path: `${v}/machines/${m}/export`, route: '/v1/swarms/:id/machines/:machine/export', status: read },
          ...(world.command !== undefined
            ? [
                { kind: 'json' as const, method: 'GET', path: `${v}/machines/${m}/commands/${world.command}`, route: '/v1/swarms/:id/machines/:machine/commands/:seq', schema: 'GET /v1/swarms/{id}/machines/{machine}/commands/{seq}', status: read },
                world.job !== undefined
                  ? { kind: 'json' as const, method: 'GET', path: `${v}/machines/${m}/commands/${world.job}/log`, route: '/v1/swarms/:id/machines/:machine/commands/:seq/log', schema: 'GET /v1/swarms/{id}/machines/{machine}/commands/{seq}/log', status: read }
                  : { kind: 'json' as const, method: 'GET', path: `${v}/machines/${m}/commands/${world.command}/log`, route: '/v1/swarms/:id/machines/:machine/commands/:seq/log (not a job)', status: [404] },
              ]
            : []),
        ]
      : []),
    { kind: 'json', method: 'GET', path: `${v}/backers`, route: '/v1/swarms/:id/backers', schema: 'GET /v1/swarms/{id}/backers', status: read },
    { kind: 'json', method: 'GET', path: `${v}/progress`, route: '/v1/swarms/:id/progress', schema: 'GET /v1/swarms/{id}/progress', status: read },
    { kind: 'json', method: 'GET', path: `${v}/artifacts`, route: '/v1/swarms/:id/artifacts', schema: 'GET /v1/swarms/{id}/artifacts', status: read },
    { kind: 'json', method: 'GET', path: `${v}/chat`, route: '/v1/swarms/:id/chat', schema: 'GET /v1/swarms/{id}/chat', status: read },
    ...(world.message ? [{ kind: 'json' as const, method: 'GET', path: `${v}/chat/${world.message}`, route: '/v1/swarms/:id/chat/:message', status: read }] : []),
    { kind: 'json', method: 'GET', path: `${v}/team`, route: '/v1/swarms/:id/team', schema: 'GET /v1/swarms/{id}/team', status: read },
    { kind: 'json', method: 'GET', path: `${v}/branches`, route: '/v1/swarms/:id/branches', schema: 'GET /v1/swarms/{id}/branches', status: read },
    { kind: 'json', method: 'GET', path: `${v}/code`, route: '/v1/swarms/:id/code', schema: 'GET /v1/swarms/{id}/code', status: read },
    ...['ledger', 'deltas?after=0&limit=5', 'proofs', 'tree'].map((tail) => ({ check: treeless, kind: 'json' as const, method: 'GET', path: `${v}/${tail}`, route: `/v1/swarms/:id/${tail.split('?')[0]} (agent swarm)`, status: [404] })),
    ...(t ? [{ kind: 'json' as const, method: 'GET', path: `/v1/swarms/${t}/ledger`, route: '/v1/swarms/:tree/ledger', schema: 'GET /v1/swarms/{id}/ledger', status: read }, { kind: 'json' as const, method: 'GET', path: `/v1/swarms/${t}/deltas?after=0&limit=5`, route: '/v1/swarms/:tree/deltas', schema: 'GET /v1/swarms/{id}/deltas', status: read }, { kind: 'json' as const, method: 'GET', path: `/v1/swarms/${t}/proofs`, route: '/v1/swarms/:tree/proofs', schema: 'GET /v1/swarms/{id}/proofs', status: read }] : []),
    ...(t
      ? [
          { kind: 'json' as const, method: 'GET', path: `/v1/swarms/${t}/tree`, route: '/v1/swarms/:tree/tree', schema: 'GET /v1/swarms/{id}/tree', status: read },
          ...(world.node
            ? [
                { kind: 'json' as const, method: 'GET', path: `/v1/swarms/${t}/nodes/${world.node}`, route: '/v1/swarms/:tree/nodes/:nid', schema: 'GET /v1/swarms/{id}/nodes/{nid}', status: read },
                { kind: 'json' as const, method: 'GET', path: `/v1/swarms/${t}/nodes/${world.node}/updates?after=0`, route: '/v1/swarms/:tree/nodes/:nid/updates', schema: 'GET /v1/swarms/{id}/nodes/{nid}/updates', status: read },
              ]
            : []),
        ]
      : []),
    ...(world.rider ? [{ kind: 'json' as const, method: 'GET', path: `/v1/riders/${world.rider}`, route: '/v1/riders/:who', schema: 'GET /v1/riders/{who}', status: read }] : []),
    ...(world.name ? [{ kind: 'json' as const, method: 'GET', path: `/v1/names/${world.name}`, route: '/v1/names/:name', schema: 'GET /v1/names/{name}', status: read }] : []),
    { kind: 'json', method: 'GET', path: '/v1/names/no-such-name-zz', route: '/v1/names/:name (unknown)', status: [404] },
    { kind: 'json', method: 'GET', path: '/v1/general/chat', schema: 'GET /v1/general/chat', status: read },
    { kind: 'json', method: 'GET', path: '/v1/me', status: [401] },
    { kind: 'json', method: 'GET', path: '/v1/me/ai', status: [401] },
    { kind: 'json', method: 'GET', path: `/v1/me/swarms/${s}`, route: '/v1/me/swarms/:id', status: [401] },
    { kind: 'json', method: 'GET', path: '/v1/no-such-route', status: [404] },
    { kind: 'json', method: 'GET', path: '/openapi.json', status: read, check: (body) => ((body as Spec)?.paths ? undefined : 'bad: no paths') },
    { kind: 'socket', method: 'GET', path: '/v1/swarms/live', status: [101] },
    { kind: 'socket', method: 'GET', path: '/v1/general/chat/live', status: [101] },
    { kind: 'socket', method: 'GET', path: `${v}/chat/live`, route: '/v1/swarms/:id/chat/live', status: [101] },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/swarms', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/me', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/feedback', status: [400] },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/auth', status: [400] },
    { body: { chainId: 4217 }, check: (body) => (typeof (body as { message?: unknown }).message === 'string' ? undefined : 'bad: no message to sign'), kind: 'json', method: 'POST', path: '/v1/auth/challenge', status: read },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/auth/logout', status: [200, 401] },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/general/chat', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/contributions`, route: '/v1/swarms/:id/contributions', status: [400] },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/transfer`, route: '/v1/swarms/:id/transfer', schema: 'POST /v1/swarms/{id}/transfer', status: read },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/hands`, route: '/v1/swarms/:id/hands', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: `/api/swarms/${s}/hands`, route: '/api/swarms/:id/hands', status: [401] },
    { kind: 'json', method: 'DELETE', path: `${v}/hands/no-such-hand`, route: '/v1/swarms/:id/hands/:hand', status: [401] },
    { kind: 'json', method: 'DELETE', path: `/api/swarms/${s}/hands/no-such-hand`, route: '/api/swarms/:id/hands/:hand', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/chat`, route: '/v1/swarms/:id/chat', status: refused },
    ...(world.message ? [{ body: {}, kind: 'json' as const, method: 'POST', path: `${v}/chat/${world.message}/reactions`, route: '/v1/swarms/:id/chat/:message/reactions', status: refused }] : []),
    { body: {}, kind: 'json', method: 'POST', path: `${v}/team`, route: '/v1/swarms/:id/team', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/team/members`, route: '/v1/swarms/:id/team/members', status: refused },
    { kind: 'json', method: 'DELETE', path: `${v}/team/members/0x0000000000000000000000000000000000000001`, route: '/v1/swarms/:id/team/members/:member', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/btw`, route: '/v1/swarms/:id/btw', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/ai`, route: '/v1/swarms/:id/ai', status: refused },
    { body: {}, kind: 'json', method: 'PATCH', path: v, route: '/v1/swarms/:id', status: refused },
    { kind: 'bytes', method: 'GET', path: `${v}/picture`, route: '/v1/swarms/:id/picture', status: [200, 404] },
    { body: {}, kind: 'json', method: 'PUT', path: `${v}/picture`, route: '/v1/swarms/:id/picture', status: refused },
    { kind: 'json', method: 'DELETE', path: `${v}/picture`, route: '/v1/swarms/:id/picture', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/archive`, route: '/v1/swarms/:id/archive', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/triage`, route: '/v1/swarms/:id/triage', status: refused },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/nodes`, route: '/v1/swarms/:id/nodes', status: [400, 401, 410] },
    { body: {}, kind: 'json', method: 'POST', path: `${v}/ideas`, route: '/v1/swarms/:id/ideas', status: [400, 401, 410] },
    ...(world.branch
      ? ['fund', 'move', 'stop'].map((verb) => ({ body: {}, kind: 'json' as const, method: 'POST', path: `${v}/branches/${world.branch}/${verb}`, route: `/v1/swarms/:id/branches/:branch/${verb}`, status: refused }))
      : []),
    ...(t && world.node
      ? ['steer', 'move', 'end', 'review'].map((verb) => ({ body: {}, kind: 'json' as const, method: 'POST', path: `/v1/swarms/${t}/nodes/${world.node}/${verb}`, route: `/v1/swarms/:tree/nodes/:nid/${verb}`, status: refused }))
      : []),
    { body: {}, kind: 'json', method: 'PUT', path: '/v1/me/ai/keys/anthropic', route: '/v1/me/ai/keys/:provider', status: refused },
    { kind: 'json', method: 'DELETE', path: '/v1/me/ai/keys/anthropic', route: '/v1/me/ai/keys/:provider', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/me/ai/claude', status: [401] },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/me/ai/claude/complete', status: refused },
    { kind: 'json', method: 'DELETE', path: '/v1/me/ai/claude', status: [401] },
    { body: {}, check: (body) => ((body as { counted?: unknown }).counted === false ? undefined : 'bad: an unsigned hook was counted'), kind: 'json', method: 'POST', path: '/v1/hooks/github', status: read },
    { body: {}, kind: 'bytes', method: 'POST', path: '/telegram', status: [401, 403] },
  ]
  return [...pages, ...api, ...v1]
}

export function signedIn(world: World): Probe[] {
  const s = world.swarm
  return [
    { kind: 'json', method: 'GET', path: '/v1/me', schema: 'GET /v1/me', signed: 'in', status: read },
    { kind: 'json', method: 'GET', path: '/api/me', signed: 'in', status: read },
    { kind: 'json', method: 'GET', path: '/v1/me/ai', schema: 'GET /v1/me/ai', signed: 'in', status: read },
    { kind: 'json', method: 'GET', path: '/api/me/ai', signed: 'in', status: read },
    { check: treeless, kind: 'json', method: 'GET', path: `/v1/me/swarms/${s}`, route: '/v1/me/swarms/:id (agent swarm)', signed: 'in', status: [404] },
    ...(world.tree
      ? [
          { kind: 'json' as const, method: 'GET', path: `/v1/me/swarms/${world.tree}`, route: '/v1/me/swarms/:tree', schema: 'GET /v1/me/swarms/{id}', signed: 'in' as const, status: read },
          { kind: 'json' as const, method: 'GET', path: `/api/me/swarms/${world.tree}`, route: '/api/me/swarms/:tree', signed: 'in' as const, status: read },
        ]
      : []),
    { kind: 'json', method: 'GET', path: `/v1/swarms/${s}/chat`, route: '/v1/swarms/:id/chat', schema: 'GET /v1/swarms/{id}/chat', signed: 'in', status: read },
    { kind: 'html', method: 'GET', path: '/me/ai', signed: 'in', status: read },
    ...(world.me
      ? [
          { kind: 'json' as const, method: 'GET', path: `/v1/riders/${world.me}`, route: '/v1/riders/:me', signed: 'in' as const, status: read },
          { kind: 'html' as const, method: 'GET', path: `/u/${world.me}`, route: '/u/:me', signed: 'in' as const, status: read },
        ]
      : []),
    ...(world.message
      ? [
          { kind: 'json' as const, method: 'GET', path: `/v1/swarms/${s}/chat/${world.message}`, route: '/v1/swarms/:id/chat/:message', signed: 'in' as const, status: read },
          { body: {}, kind: 'json' as const, method: 'POST', path: `/v1/swarms/${s}/chat/${world.message}/reactions`, route: '/v1/swarms/:id/chat/:message/reactions', signed: 'in' as const, status: [400] },
        ]
      : []),
    { body: { name: 5 }, kind: 'json', method: 'POST', path: '/v1/me', signed: 'in', status: [400] },
    { body: {}, kind: 'json', method: 'PUT', path: '/v1/me/ai/keys/anthropic', route: '/v1/me/ai/keys/:provider', signed: 'in', status: [400] },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/me/ai/claude/complete', signed: 'in', status: [400] },
    { body: {}, kind: 'json', method: 'POST', path: `/v1/swarms/${s}/chat`, route: '/v1/swarms/:id/chat', signed: 'in', status: [400] },
    { body: {}, kind: 'json', method: 'POST', path: `/v1/swarms/${s}/btw`, route: '/v1/swarms/:id/btw', signed: 'in', status: [400] },
    { body: {}, kind: 'json', method: 'POST', path: '/v1/general/chat', signed: 'in', status: [400] },
    { body: { nickname: 5 }, kind: 'json', method: 'PATCH', path: `/v1/swarms/${s}`, route: '/v1/swarms/:id', signed: 'in', status: [400] },
    { body: { label: 'bad label!' }, kind: 'json', method: 'POST', path: `/v1/swarms/${s}/hands`, route: '/v1/swarms/:id/hands', signed: 'in', status: [400] },
    { kind: 'json', method: 'DELETE', path: `/v1/swarms/${s}/hands/no-such-hand`, route: '/v1/swarms/:id/hands/:hand', signed: 'in', status: [403, 404] },
  ]
}

const trees = new Set(['swarm_tree', 'swarm_node', 'swarm_proofs', 'swarm_propose', 'swarm_suggest', 'swarm_steer', 'swarm_move'])

type Tool = { annotations?: { readOnlyHint?: boolean }; inputSchema?: { properties?: Record<string, unknown>; required?: string[] }; name: string }

async function rpc(root: string, session: string | undefined, id: number, method: string, params: unknown) {
  const started = now()
  const response = await fetch(root + '/mcp', {
    body: JSON.stringify({ id, jsonrpc: '2.0', method, params }),
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-06-18', ...(session ? { 'mcp-session-id': session } : {}) },
    method: 'POST',
  })
  const text = await response.text()
  const ms = now() - started
  const data = text.trim().startsWith('{') ? text : (text.split('\n').filter((line) => line.startsWith('data:')).pop() ?? '').slice(5)
  let body: { error?: { message: string }; result?: Record<string, unknown> } = {}
  try {
    body = JSON.parse(data) as typeof body
  } catch {}
  return { body, challenge: response.headers.get('www-authenticate'), ms, server: served(response), session: response.headers.get('mcp-session-id') ?? session, status: response.status, text }
}

function argued(tool: Tool, world: World) {
  const properties = Object.keys(tool.inputSchema?.properties ?? {})
  const tree = trees.has(tool.name)
  const values: Record<string, unknown> = {
    limit: 5,
    machine: world.machine,
    message: world.message,
    name: world.name ?? 'no-such-name-zz',
    node: world.node,
    q: 'proof',
    query: 'proof',
    seq: tool.name === 'swarm_machine_job' ? world.job : world.command,
    swarm: tree && world.tree ? world.tree : world.swarm,
    timeout: 1,
    who: world.rider,
  }
  const args: Record<string, unknown> = {}
  for (const key of tool.inputSchema?.required ?? []) if (values[key] !== undefined) args[key] = values[key]
  for (const key of ['swarm', 'limit', 'timeout']) if (properties.includes(key) && values[key] !== undefined) args[key] = values[key]
  const missing = (tool.inputSchema?.required ?? []).filter((key) => args[key] === undefined)
  return { args, missing, tree }
}

export async function mcp(root: string, world: World): Promise<Row[]> {
  const rows: Row[] = []
  const row = (route: string, result: { ms: number; server: number | undefined; status: number }, ok: boolean, note: string) =>
    rows.push({ method: 'POST', ms: Math.round(result.ms), note, ok, route, samples: [result.ms], server: result.server, signed: 'out', status: result.status })
  const skip = (route: string, note: string) => rows.push({ method: 'POST', ms: 0, note, ok: true, route, samples: [], server: undefined, signed: 'out', status: 'skip' })
  const opened = await rpc(root, undefined, 1, 'initialize', { capabilities: {}, clientInfo: { name: 'swarms-endpoints', version: '1' }, protocolVersion: '2025-06-18' })
  row('/mcp initialize', opened, opened.status === 200 && !!opened.body.result, opened.body.error?.message ?? String((opened.body.result?.['serverInfo'] as { name?: string } | undefined)?.name ?? opened.text.slice(0, 60)))
  const listing = await rpc(root, opened.session, 2, 'tools/list', {})
  const tools = (listing.body.result?.['tools'] ?? []) as Tool[]
  row('/mcp tools/list', listing, listing.status === 200 && tools.length > 0, `${tools.length} tools`)
  let id = 3
  for (const tool of tools) {
    const reading = tool.annotations?.readOnlyHint === true
    const { args, missing, tree } = argued(tool, world)
    if (reading && (missing.length || (tree && !world.tree))) {
      skip(`/mcp ${tool.name}`, `skipped: no ${missing.join(', ') || 'tree swarm'} to pass`)
      continue
    }
    if (!reading && !(tool.inputSchema?.required ?? []).length) {
      skip(`/mcp ${tool.name}`, 'skipped: a write with no required input')
      continue
    }
    if (!reading && unwritable(root, '/mcp', world.made)) {
      skip(`/mcp ${tool.name}`, skippedWrite)
      continue
    }
    id += 1
    const called = await rpc(root, opened.session, id, 'tools/call', { arguments: reading ? args : {}, name: tool.name })
    const result = called.body.result as { content?: { text?: string }[]; isError?: boolean } | undefined
    const text = result?.content?.[0]?.text ?? called.body.error?.message ?? ''
    const asked = (called.status === 401 || called.status === 403) && !!called.challenge?.includes('resource_metadata=')
    const ok = reading ? called.status === 200 && !!result && !result.isError : asked || (called.status === 200 && (result?.isError === true || !!called.body.error))
    row(`/mcp ${tool.name}${reading ? '' : asked ? ' (asks for OAuth)' : ' (invalid input)'}`, called, ok, text.replace(/\s+/g, ' ').slice(0, 70))
    if (tool.name === 'swarm_wait' || tool.name === 'swarm_watch') rows[rows.length - 1]!.patient = true
  }
  const templates = await rpc(root, opened.session, ++id, 'resources/templates/list', {})
  const listed = ((templates.body.result?.['resourceTemplates'] ?? []) as { uriTemplate?: string }[]).map((each) => each.uriTemplate).sort()
  row('/mcp resources/templates/list', templates, templates.status === 200 && listed.join(' ') === 'swarm://{swarm}/status swarm://{swarm}/tree', listed.join(' ') || templates.text.slice(0, 60))
  const resources = await rpc(root, opened.session, ++id, 'resources/list', {})
  const count = ((resources.body.result?.['resources'] ?? []) as unknown[]).length
  row('/mcp resources/list', resources, resources.status === 200 && Array.isArray(resources.body.result?.['resources']), `${count} resources`)
  for (const [uri, form] of [[`swarm://${world.swarm}/status`, 'status'], ...(world.tree ? [[`swarm://${world.tree}/tree`, 'tree']] : [])] as const) {
    const answered = await rpc(root, opened.session, ++id, 'resources/read', { uri })
    const contents = (answered.body.result?.['contents'] ?? []) as { text?: string }[]
    row(`/mcp resources/read swarm://:id/${form}`, answered, answered.status === 200 && !!contents[0]?.text, answered.body.error?.message ?? `${contents[0]?.text?.length ?? 0} bytes`)
  }
  for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) {
    const started = now()
    const response = await fetch(root + path).catch(() => undefined)
    const body = (await response?.json().catch(() => undefined)) as Record<string, unknown> | undefined
    const ms = now() - started
    const ok = response?.status === 200 && (path.includes('protected') ? body?.['resource'] === `${root}/mcp` : body?.['issuer'] === root)
    rows.push({ method: 'GET', ms: Math.round(ms), note: ok ? 'OAuth metadata names this site' : JSON.stringify(body ?? null).slice(0, 70), ok, route: path, samples: [ms], server: response ? served(response) : undefined, signed: 'out', status: response?.status ?? 'error' })
  }
  return rows
}

const cliMain = new URL('../../cli/src/main.ts', import.meta.url).pathname

/** The CLI's read-only commands against root, each a row: exit 0 and JSON on stdout, with the time a cold start takes. */
export async function cli(root: string, world: World): Promise<Row[]> {
  const { spawn } = await import('node:child_process')
  const swarm = world.swarm
  const commands: string[][] = [
    ['--version'],
    ['help'],
    ['ls'],
    ['__names'],
    ['status', swarm],
    ['open', swarm],
    ['logs', swarm, '--limit', '5'],
    ['machines', swarm],
    ['hands', 'ls', swarm],
    ['byok'],
    ...(world.tree ? [['tree', world.tree, '--depth', '1']] : []),
  ]
  const rows: Row[] = []
  for (const args of commands) {
    const started = performance.now()
    const done = await new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve) => {
      const ran = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', cliMain, ...args, ...(args[0] === '--version' ? [] : ['--json', '--host', root])], { env: { ...process.env, SWARMS_BROWSER: 'none', SWARMS_KEYCHAIN: '0', SWARMS_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      ran.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
      ran.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
      ran.once('close', (code) => resolve({ code, stderr, stdout }))
    })
    const ms = performance.now() - started
    let parsed = args[0] === '--version'
    let refused = false
    if (!parsed) {
      try {
        const read = JSON.parse(done.stdout) as { error?: { code?: unknown } }
        parsed = true
        refused = args[0] === 'byok' && done.code === 1 && read.error?.code === 'unauthorized'
      } catch {}
    }
    const ok = (done.code === 0 && parsed) || refused
    rows.push({ method: 'CLI', ms: Math.round(ms), note: ok ? done.stdout.replace(/\s+/g, ' ').slice(0, 70) : (done.stdout + done.stderr).replace(/\s+/g, ' ').slice(0, 120), ok, patient: true, route: `swarms ${args.map((arg) => (arg === swarm ? '<swarm>' : arg === world.tree ? '<tree>' : arg)).join(' ')}`, samples: [ms], server: undefined, signed: 'out', status: done.code ?? 'killed' })
  }
  return rows
}

/** Points every write at the swarm under the throwaway swarm made, so a live site's writes land only there. */
export function retarget(list: Probe[], swarm: string, made: string | undefined): Probe[] {
  if (!made) return list
  const from = new RegExp(`^/(v1|api)/swarms/${swarm}(?=/|\\?|$)`)
  return list.map((probe) => (mutating.has(probe.method.toUpperCase()) && from.test(probe.path) ? { ...probe, path: probe.path.replace(from, (_, prefix: string) => `/${prefix}/swarms/${made}`) } : probe))
}

/** Who the token signs in as: a row for GET /v1/me, and the address when it is a live session. */
export async function whoami(root: string, token: string): Promise<{ address?: string; row: Row }> {
  const sent = await send(root, 'GET', '/v1/me', token)
  const address = typeof sent.body?.['address'] === 'string' ? sent.body['address'] : undefined
  return { ...(address ? { address } : {}), row: written('/v1/me (SWARMS_TOKEN)', 'GET', sent, sent.status === 200 && !!address, address ? `signed in as ${address}` : `not a live session: ${said(sent)}`) }
}

export async function run(options: { made?: string | undefined; operator?: string | undefined; root?: string | undefined; samples?: number; token?: string | undefined; writes?: boolean } = {}) {
  const root = base(options.root)
  const samples = options.samples ?? Number(process.env['SWARMS_SAMPLES'] ?? 3)
  const token = options.token ?? process.env['SWARMS_TOKEN']
  const operator = options.operator ?? process.env['SWARMS_OPERATOR_KEY']
  const env = options.writes === undefined ? process.env : { ...process.env, SWARMS_SWEEP_WRITES: options.writes ? '1' : '0' }
  const spec = await json<Spec>(root, '/openapi.json')
  const found = await discover(root)
  const rows: Row[] = []
  const me = token ? await whoami(root, token) : undefined
  if (me) rows.push(me.row)
  const signed = !!me?.address
  const created = !options.made && signed && throwaway(root, token, operator, env) ? await make(root, token!) : undefined
  if (created) rows.push(created.row)
  const made = options.made ?? created?.id
  const world: World = { ...found, ...(made ? { made } : {}), ...(me?.address ? { me: me.address } : {}) }
  try {
    const list = retarget([...probes(world), ...(signed ? signedIn(world) : [])], world.swarm, made)
    for (const probe of list) rows.push(await call(root, probe, token, spec, samples, world.socket, made))
    rows.push(...(await mcp(root, world)))
    rows.push(...(await cli(root, world)))
    if (production(root)) for (const each of layout(root, world)) rows.push(await call(each.root, each.probe, undefined, spec, 1))
    if (made && signed && !unwritable(root, `/v1/swarms/${made}`, made, env['SWARMS_SWEEP_WRITES'])) rows.push(...(await exercise(root, token!, made)))
  } finally {
    if (created?.id) rows.push(...(await archive(root, operator!, created.id)))
  }
  return { root, rows, spec: !!spec, world }
}

/** The production hosts of the two Workers: `swarms` (the objects: `/og`, the three `/v1/auth` writes, every other request handed to `SITE`) at its workers.dev address, the paradigm.xyz proxy in front of it, and `swarms-site` at its own. */
export const hosts = {
  objects: 'https://swarms.tempo-dev.workers.dev/swarms',
  proxy: 'https://paradigm.xyz/swarms',
  site: 'https://swarms-site.tempo-dev.workers.dev/swarms',
} as const

const productionHosts = new Set(['swarms.new', 'www.swarms.new', 'paradigm.xyz', 'swarms.tempo-dev.workers.dev', 'swarms-site.tempo-dev.workers.dev'])

/** Whether root is production, whose two-Worker layout the sweep also reads at each Worker's own host. */
export function production(root: string) {
  try {
    return productionHosts.has(new URL(root).hostname)
  } catch {
    return false
  }
}

function png(_: unknown, response: Response) {
  const type = response.headers.get('content-type') ?? ''
  return type.startsWith('image/png') ? undefined : `bad: content-type ${type || 'none'}, not image/png`
}

function movedTo(location: string) {
  return (_: unknown, response: Response) => (response.headers.get('location') === location ? undefined : `bad: moved to ${response.headers.get('location') ?? 'nowhere'}, not ${location}`)
}

/**
 * Reads, never writes, that pin the two-Worker layout, each a probe on the host it names (patient: another host's latency stays out of the stats):
 * `/og` drawn by `swarms` (GET and HEAD) whether asked of it or of `swarms-site` through `OBJECTS`,
 * a GET under `/v1/auth` passing through `swarms` to the site's API (only the three POSTs are `Signin`'s; the sweep sends those to a local base),
 * and `swarms.tempo-dev.workers.dev` serving the site: the API through `SITE`, pages moved to paradigm.xyz/swarms, which serves them.
 */
export function layout(root: string, world: World): { probe: Probe; root: string }[] {
  const at = (host: string, probe: Probe) => ({ probe: { ...probe, patient: true, route: `${new URL(host).host} ${probe.route ?? probe.path}` }, root: host })
  const v = `/v1/swarms/${world.swarm}`
  const og = (method: string): Probe => ({ check: png, kind: 'bytes', method, path: '/og/about/card.png', status: [200] })
  const auth: Probe = { kind: 'json', method: 'GET', path: '/v1/auth/challenge', status: [404, 405] }
  return [
    { probe: { ...og('HEAD'), route: '/og/about/card.png (HEAD)' }, root },
    { probe: { ...auth, route: '/v1/auth/challenge (GET)' }, root },
    at(hosts.objects, { kind: 'json', method: 'GET', path: '/v1/health', status: [200] }),
    at(hosts.objects, { kind: 'json', method: 'GET', path: v, route: '/v1/swarms/:id', status: [200] }),
    at(hosts.objects, { check: (body) => ((body as Spec)?.paths ? undefined : 'bad: no paths'), kind: 'json', method: 'GET', path: '/openapi.json', status: [200] }),
    at(hosts.objects, og('GET')),
    at(hosts.objects, { ...og('HEAD'), route: '/og/about/card.png (HEAD)' }),
    at(hosts.objects, { ...auth, route: '/v1/auth/challenge (GET)' }),
    at(hosts.objects, { accept: 'text/html', check: movedTo('https://paradigm.xyz/swarms/docs'), kind: 'redirect', method: 'GET', path: '/docs', status: [301] }),
    at(hosts.proxy, { kind: 'html', method: 'GET', path: '/docs', status: [200] }),
    at(hosts.proxy, { kind: 'json', method: 'GET', path: v, route: '/v1/swarms/:id', status: [200] }),
    at(hosts.site, { kind: 'json', method: 'GET', path: '/v1/health', status: [200] }),
    at(hosts.site, og('GET')),
    at(hosts.site, { ...auth, route: '/v1/auth/challenge (GET)' }),
  ]
}

export function stats(rows: Row[]) {
  const timed = rows.filter((row) => row.status !== 'skip' && !row.patient)
  const times = timed.filter((row) => row.method !== 'WS').flatMap((row) => row.samples)
  const servers = timed.flatMap((row) => (row.server === undefined ? [] : [row.server]))
  return {
    external: rows.filter((row) => row.status === 'ext').map((row) => `${row.method} ${row.route}`),
    failed: rows.filter((row) => !row.ok).length,
    p50: Math.round(percentile(times, 50)),
    p95: Math.round(percentile(times, 95)),
    server50: Math.round(percentile(servers, 50)),
    server95: Math.round(percentile(servers, 95)),
    slow: timed.filter((row) => row.ms > target).length,
    total: rows.length,
  }
}

export function table(rows: Row[]) {
  const escape = (text: string) => text.replace(/\|/g, '\\|')
  const lines = ['| route | method | as | status | ms | server ms | ok | note |', '|---|---|---|---|---|---|---|---|']
  for (const row of rows) lines.push(`| ${escape(row.route)} | ${row.method} | ${row.signed} | ${row.status} | ${row.ms}${row.ms > target ? ' ⚠' : ''} | ${row.server ?? ''} | ${row.ok ? '✓' : '✗'} | ${escape(row.note)} |`)
  return lines.join('\n')
}

export function summary(report: { root: string; rows: Row[]; world: World }) {
  const counted = stats(report.rows)
  return [
    `# ${report.root} (${report.world.swarm}${report.world.tree ? `, tree ${report.world.tree}` : ''})`,
    '',
    table(report.rows),
    '',
    `${counted.total} routes, ${counted.failed} failed, ${counted.slow} over ${target} ms. Wall p50 ${counted.p50} ms, p95 ${counted.p95} ms; server p50 ${counted.server50} ms, p95 ${counted.server95} ms.`,
    ...(counted.external.length ? ['', `External (the gateway's treasury cannot pay storage now, so these answer an empty state, not a failure): ${counted.external.join(', ')}.`] : []),
  ].join('\n')
}

export type Phases = { connect: number; dns: number; ray: string; server: number | undefined; status: number; timing: string; tls: number; total: number; ttfb: number }

/** One GET on a connection of its own (no keep-alive agent): its own DNS lookup, TCP connect and TLS handshake. Each phase is ms from the start, as curl's -w times are. */
export function fresh(url: string, headers: Record<string, string> = {}): Promise<Phases> {
  const client = url.startsWith('https:') ? Https : Http
  return new Promise((resolve, reject) => {
    const started = now()
    const at = { connect: 0, dns: 0, tls: 0, ttfb: 0 }
    const request = client.request(url, { agent: false, headers: { accept: '*/*', connection: 'close', ...headers }, method: 'GET' }, (response) => {
      at.ttfb = now() - started
      response.on('data', () => {})
      response.on('error', reject)
      response.on('end', () => {
        const timing = String(response.headers['server-timing'] ?? '')
        const total = /(?:^|,\s*)total;dur=([0-9.]+)/.exec(timing)
        resolve({ ...at, ray: String(response.headers['cf-ray'] ?? ''), server: total ? Number(total[1]) : undefined, status: response.statusCode ?? 0, timing, total: now() - started })
      })
    })
    request.on('socket', (socket) => {
      socket.on('lookup', () => (at.dns = now() - started))
      socket.on('connect', () => (at.connect = now() - started))
      socket.on('secureConnect', () => (at.tls = now() - started))
    })
    request.setTimeout(30_000, () => request.destroy(new Error('timeout')))
    request.on('error', reject)
    request.end()
  })
}

export type Cold = { first: boolean; mode: 'fresh' | 'idle'; phases: Phases; route: string }

export function coldRoutes(swarm: string) {
  return ['/', `/s/${swarm}`, '/v1/health', `/v1/swarms/${swarm}`, '/v1/swarms', '/api/config', '/x/card.svg']
}

/**
 * Cold-connection timings on root. fresh: samples GETs of each route back to back, each on a new connection. idle: rounds
 * rounds, each after idle seconds with no request, that GET every route once on new connections, starting each round at
 * the next route so each route is the first request after the pause in turn (first).
 */
export async function cold(root: string, options: { idle?: number; pause?: (ms: number) => Promise<void>; rounds?: number; routes?: string[]; samples?: number } = {}) {
  const env = process.env
  const samples = options.samples ?? Number(env['SWARMS_COLD_SAMPLES'] ?? 10)
  const rounds = options.rounds ?? Number(env['SWARMS_COLD_ROUNDS'] ?? 10)
  const idle = options.idle ?? Number(env['SWARMS_COLD_IDLE'] ?? 60)
  const pause = options.pause ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const routes = options.routes ?? coldRoutes((await discover(root)).swarm)
  const runs: Cold[] = []
  const take = async (mode: Cold['mode'], route: string, first: boolean) => {
    const phases = await fresh(root + route).catch((error: unknown) => ({ connect: 0, dns: 0, ray: String(error), server: undefined, status: 0, timing: '', tls: 0, total: 0, ttfb: 0 }))
    runs.push({ first, mode, phases, route })
  }
  for (let round = 0; round < rounds; round += 1) {
    await pause(idle * 1000)
    const order = routes.map((_, index) => routes[(index + round) % routes.length]!)
    for (const [index, route] of order.entries()) await take('idle', route, index === 0)
  }
  for (const route of routes) for (let index = 0; index < samples; index += 1) await take('fresh', route, false)
  return { idle, root, routes, runs }
}

const phases = ['dns', 'connect', 'tls', 'ttfb', 'server', 'total'] as const

export function coldStats(runs: Cold[]) {
  const pick = (key: (typeof phases)[number]) => runs.flatMap((run) => (key === 'server' ? (run.phases.server === undefined ? [] : [run.phases.server]) : [run.phases[key]]))
  return Object.fromEntries(phases.map((key) => [key, { p50: Math.round(percentile(pick(key), 50)), p95: Math.round(percentile(pick(key), 95)) }])) as Record<(typeof phases)[number], { p50: number; p95: number }>
}

export function coldTable(report: { idle: number; root: string; routes: string[]; runs: Cold[] }) {
  const lines = [`# ${report.root} cold (ms from the start, p50 / p95; idle = after ${report.idle} s with no request)`, '', '| route | mode | n | dns | connect | tls | ttfb | server | total |', '|---|---|---|---|---|---|---|---|---|']
  const row = (route: string, mode: string, runs: Cold[]) => {
    if (!runs.length) return
    const counted = coldStats(runs)
    lines.push(`| ${route} | ${mode} | ${runs.length} | ${phases.map((key) => `${counted[key].p50} / ${counted[key].p95}`).join(' | ')} |`)
  }
  for (const route of report.routes) {
    row(route, 'fresh', report.runs.filter((run) => run.route === route && run.mode === 'fresh'))
    row(route, 'idle', report.runs.filter((run) => run.route === route && run.mode === 'idle'))
  }
  row('any (first after idle)', 'idle', report.runs.filter((run) => run.first))
  const failed = report.runs.filter((run) => !run.phases.status || run.phases.status >= 500)
  if (failed.length) lines.push('', `${failed.length} failed: ${failed.map((run) => `${run.route} ${run.phases.status || run.phases.ray}`).join(', ')}`)
  lines.push('', 'server-timing of each idle request:', ...report.runs.filter((run) => run.mode === 'idle').map((run) => `- ${run.first ? 'first ' : ''}${run.route} ${run.phases.status} ttfb ${Math.round(run.phases.ttfb)} ms, ray ${run.phases.ray || '-'}: ${run.phases.timing || '-'}`))
  return lines.join('\n')
}

/** Writes the report to stdout; a report that cannot be written (a full disk, a closed pipe) fails the run instead of exiting 0 with nothing printed. */
export function report(text: string, failed: boolean, out: NodeJS.WritableStream = process.stdout) {
  process.exitCode = failed ? 1 : 0
  let told = false
  const lost = (error: Error) => {
    process.exitCode = 1
    if (told) return
    told = true
    process.stderr.write(`endpoints: could not write the report: ${error.message}\n`)
  }
  out.once('error', lost)
  out.write(text + '\n', (error) => {
    if (error) lost(error)
  })
}

/** Whether this file is the process's entry: import.meta.main, or argv[1] on a node that lacks it (before 22.18 and 24.2), which would otherwise run nothing and exit 0. */
export function entry(meta: { main?: boolean; url: string }, argv = process.argv) {
  if (typeof meta.main === 'boolean') return meta.main
  if (!argv[1]) return false
  try {
    return realpathSync(argv[1]) === realpathSync(fileURLToPath(meta.url))
  } catch {
    return false
  }
}

if (entry(import.meta)) {
  const given = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))[0]
  if (process.argv.includes('--cold') || process.env['SWARMS_COLD'] === '1') {
    const cooled = await cold(base(given))
    report(coldTable(cooled), cooled.runs.some((run) => !run.phases.status || run.phases.status >= 500))
  } else {
    const swept = await run({ root: given })
    report(summary(swept), stats(swept.rows).failed > 0)
  }
}
