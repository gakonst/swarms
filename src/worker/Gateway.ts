import type * as Setup from '../shared/Setup.ts'
import { redact } from '../shared/Trail.ts'
import * as Edge from './Edge.ts'
import * as Timing from './Timing.ts'

export type Result<value> = { ok: true; value: value } | { detail: string; ok: false; status: number }

export type Report = {
  error?: { message?: string } | string
  ok?: { message?: string }
  request_id: string
  spent_usd?: number
  status: string
}

export type Event = {
  event?: {
    event?: { payload?: Record<string, unknown>; type?: string }
    source?: string
    type?: string
    root_session_id?: string
    update?: unknown
  }
  created_at?: number
  request_id?: string
  seq: number
}

export type Page = { events: Event[]; has_more: boolean; next_cursor: number }

export type Listed = { connected: boolean; name: string } & Record<string, unknown>

export type Hands = { hands: Listed[] }

export type Minted = { command: string; short: string; tab?: string; token: string; url: string }

export type Commit = { date?: string | null; message: string; parents?: string[]; sha: string }

export type Sponsored = { available: string; channel: `0x${string}`; closing: boolean; deposit: string; endedAt: number | null; payer: `0x${string}`; settled: string; spent: string; tx?: string }

export type Sponsorship = { escrow: `0x${string}`; least: string; operator: `0x${string}`; recipient: `0x${string}`; signer: `0x${string}` }

export type Subagent = {
  agent_id: number
  budget_usd?: number
  parent_agent_id: number | null
  result?: string
  role: string
  spent_usd?: number
  status: { error?: string; state: string }
  task: string
}

type Raw = {
  agent_id: number
  budget_usd?: number
  last_output?: unknown
  parent_agent_id: number | null
  role: string
  spent_usd?: number
  status: { error?: string; output?: unknown; state: string }
  task: string
}

type Init = { app?: string; body?: unknown; key?: string; method?: string }

export function call(env: Cloudflare.Env, path: string, init: RequestInit = {}) {
  const request = new Request(env.GATEWAY_URL + path, init)
  return 'GATEWAY' in env && env.GATEWAY ? env.GATEWAY.fetch(request) : fetch(request)
}

export function app(swarm: string) {
  return `swarm-${swarm}`
}

async function send<value>(env: Cloudflare.Env, path: string, init: Init = {}): Promise<Result<value>> {
  const headers = new Headers({ accept: 'application/json', authorization: 'Bearer ' + (init.key ?? env.SWARMS_GATEWAY_KEY) })
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (init.app) headers.set('gateway-app', init.app)

  const [response, text] = await Timing.span(
    'gw.' + Timing.label(path),
    call(env, path, {
      body: init.body === undefined ? null : JSON.stringify(init.body),
      headers,
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    }).then(async (response) => [response, await response.text()] as const),
  )
  const parsed = (() => {
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return undefined
    }
  })()
  if (!response.ok)
    return {
      detail: String(parsed?.['detail'] ?? parsed?.['error'] ?? text.slice(0, 300)),
      ok: false,
      status: response.status,
    }

  return { ok: true, value: parsed as value }
}

export function me(env: Cloudflare.Env) {
  return send<{ wallet: `0x${string}` }>(env, '/api/keys/me')
}

let operator: string | undefined

const operatorSeconds = 86_400

async function fingerprint(secret: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
  return Array.from(digest.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function wallet(env: Cloudflare.Env) {
  if (operator) return operator
  const known = await fingerprint(env.SWARMS_GATEWAY_KEY)
    .then((key) =>
      Edge.cached(
        env,
        `operator/${key}`,
        operatorSeconds,
        async () => {
          const result = await me(env)
          if (!result.ok) throw new Error(result.detail)
          return result.value.wallet.toLowerCase()
        },
        operatorSeconds * 30,
      ),
    )
    .catch(() => me(env).then((result) => (result.ok ? result.value.wallet.toLowerCase() : undefined)))
  if (known) operator = known
  return known
}

let sponsoring: { at: number; value: Sponsorship } | undefined

export async function sponsorship(env: Cloudflare.Env) {
  if (sponsoring && Date.now() - sponsoring.at < 600_000) return sponsoring.value
  const value = await Promise.race([
    Promise.all([
      send<{ accessKey: `0x${string}` }>(env, '/api/keys/me'),
      send<{ sponsors?: Omit<Sponsorship, 'signer'> }>(env, '/v1/capabilities'),
    ]).then(([me, capabilities]) => (me.ok && capabilities.ok && capabilities.value.sponsors ? { ...capabilities.value.sponsors, signer: me.value.accessKey } : undefined)),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
  ]).catch(() => undefined)
  if (value) sponsoring = { at: Date.now(), value }
  return value
}

let pricing: { at: number; value: Map<string, Setup.Price> } | undefined

export async function prices(env: Cloudflare.Env) {
  if (pricing && Date.now() - pricing.at < 600_000) return pricing.value
  const value = await Promise.race([
    call(env, '/v1/models')
      .then((response) => (response.ok ? (response.json() as Promise<{ data?: { capabilities?: { tools?: boolean }; id: string; kind?: string; pricing?: { cached?: number; input?: number; output?: number } }[] }>) : undefined))
      .then((listed) => {
        const found = new Map<string, Setup.Price>()
        for (const model of listed?.data ?? []) {
          const price = model.pricing
          if (model.kind !== 'generate' || model.capabilities?.tools === false || price?.input === undefined || price.output === undefined) continue
          found.set(model.id, { cached: price.cached ?? price.input, id: model.id, input: price.input, output: price.output })
        }
        return found.size ? found : undefined
      }),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 3000)),
  ]).catch(() => undefined)
  if (value) pricing = { at: Date.now(), value }
  return value ?? pricing?.value
}

export function sponsor(env: Cloudflare.Env, swarm: string, body: { descriptor: unknown; transaction?: string }) {
  return send<Sponsored>(env, '/api/keys/sponsors', { app: app(swarm), body: { ...body, passThrough: false } })
}

export function sponsors(env: Cloudflare.Env, swarm: string) {
  return send<{ sponsors: Sponsored[] }>(env, '/api/keys/sponsors', { app: app(swarm) })
}

export type Teammate = { budget: number | string | null; limit: number | string | null; member: `0x${string}`; role: 'admin' | 'member' }

export function team(env: Cloudflare.Env, name: string) {
  return send<{ address: `0x${string}` }>(env, '/v1/teams/create', { body: { name } })
}

export function teammates(env: Cloudflare.Env, team: string) {
  return send<{ memberBudget: number | string | null; members: Teammate[] }>(env, '/v1/teams/members', { body: { team } })
}

export function enlist(env: Cloudflare.Env, team: string, input: { budget?: number | null; member: string; role: 'admin' | 'member' }) {
  return send<unknown>(env, '/v1/teams/add', { body: { ...input, team } })
}

export function dismiss(env: Cloudflare.Env, team: string, member: string) {
  return send<{ removed: boolean }>(env, '/v1/teams/remove', { body: { member, team } })
}

export function allowance(env: Cloudflare.Env, team: string, memberBudget: number | null) {
  return send<unknown>(env, '/v1/teams/update', { body: { memberBudget, team } })
}

export function agent(env: Cloudflare.Env, swarm: string, input: { name: string; payer: { secret: string; url: string }; persona?: string; setup?: Setup.Setup | null }) {
  const setup = input.setup
  return send<{ id: string }>(env, '/v1/agents', {
    app: app(swarm),
    body: {
      name: input.name,
      payer: input.payer,
      ...(input.persona ? { persona: input.persona } : {}),
      ...(setup ? { harness: setup.harness, model: setup.model, ...(setup.subagents ? { subagents: setup.subagents } : {}) } : {}),
    },
  })
}

export function persona(env: Cloudflare.Env, input: { description: string; instructions: string; name: string }) {
  return send<unknown>(env, '/v1/personas/set', { body: input })
}

export function restyle(env: Cloudflare.Env, swarm: string, agent: string, persona: string) {
  return send<unknown>(env, `/v1/agents/${agent}`, { app: app(swarm), body: { persona }, method: 'PATCH' })
}

export function repay(env: Cloudflare.Env, swarm: string, agent: string, payer: { secret: string; url: string }) {
  return send<unknown>(env, `/v1/agents/${agent}`, { app: app(swarm), body: { payer }, method: 'PATCH' })
}

export function prompt(env: Cloudflare.Env, swarm: string, agent: string, input: { id?: string; prompt: string; steer: boolean }) {
  return send<{ request_id: string; status: string }>(env, `/v1/agents/${agent}/turns`, { app: app(swarm), body: input })
}

export function side(env: Cloudflare.Env, swarm: string, agent: string, question: string) {
  return send<{ text: string; usage?: { estimated_cost?: { total_usd?: number } } }>(env, `/v1/agents/${agent}/side_question`, { app: app(swarm), body: { question } })
}

export async function subagents(env: Cloudflare.Env, swarm: string, agent: string): Promise<Result<Subagent[]>> {
  const listed = await send<{ agents: Raw[] }>(env, `/v1/agents/${agent}/subagents`, { app: app(swarm) })
  if (!listed.ok) return listed
  return { ok: true, value: listed.value.agents.map(subagent) }
}

export function subagent(raw: Raw): Subagent {
  const output = rendered(raw.status.output ?? raw.last_output)
  const result = output === undefined ? undefined : redact(output)
  return {
    agent_id: raw.agent_id,
    ...(raw.budget_usd === undefined ? {} : { budget_usd: raw.budget_usd }),
    parent_agent_id: raw.parent_agent_id,
    ...(result ? { result } : {}),
    role: raw.role,
    ...(raw.spent_usd === undefined ? {} : { spent_usd: raw.spent_usd }),
    status: { ...(raw.status.error ? { error: raw.status.error } : {}), state: raw.status.state },
    task: redact(raw.task),
  }
}

function rendered(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'object' && !Array.isArray(value)) {
    const texts = Object.values(value).filter((item): item is string => typeof item === 'string')
    if (texts.length && texts.length === Object.keys(value).length) return texts.join('\n\n')
  }
  return JSON.stringify(value, null, 2)
}

export function budget(env: Cloudflare.Env, swarm: string, agent: string, subagent: number, usd: number | null) {
  return send<{ agent: Raw }>(env, `/v1/agents/${agent}/subagents/${subagent}/budget`, { app: app(swarm), body: { budget_usd: usd } })
}

export function tell(env: Cloudflare.Env, swarm: string, agent: string, subagent: number, message: string, priority: 'deferred' | 'urgent' = 'deferred') {
  return send<{ disposition: string }>(env, `/v1/agents/${agent}/subagents/${subagent}/messages`, { app: app(swarm), body: { message, priority } })
}

export function close(env: Cloudflare.Env, swarm: string, agent: string, subagent: number) {
  return send<{ agents: Raw[] }>(env, `/v1/agents/${agent}/subagents/${subagent}/close`, { app: app(swarm), method: 'POST' })
}

export function ask(env: Cloudflare.Env, swarm: string, agent: string, subagent: number, question: string) {
  return send<{ text: string }>(env, `/v1/agents/${agent}/subagents/${subagent}/side_question`, { app: app(swarm), body: { question } })
}

export function cancel(env: Cloudflare.Env, swarm: string, agent: string, turn: string) {
  return send<Report>(env, `/v1/agents/${agent}/turns/${turn}/cancel`, { app: app(swarm), method: 'POST' })
}

export function turn(env: Cloudflare.Env, swarm: string, agent: string, turn: string) {
  return send<Report>(env, `/v1/agents/${agent}/turns/${turn}`, { app: app(swarm) })
}

export function events(env: Cloudflare.Env, swarm: string, agent: string, after: number) {
  return send<Page>(env, `/v1/agents/${agent}/events?after=${after}&limit=128`, { app: app(swarm) })
}

type Stored = { key: string; public: boolean }

export function values(env: Cloudflare.Env, swarm: string, cursor: string | null) {
  return send<{ cursor: string | null; entries: Stored[] }>(env, '/v1/kv/list', { app: app(swarm), body: { limit: 100, prefix: '', ...(cursor ? { cursor } : {}) } })
}

export function objects(env: Cloudflare.Env, swarm: string, cursor: string | null) {
  return send<{ cursor: string | null; objects: Stored[] }>(env, '/v1/bucket/list', { app: app(swarm), body: { limit: 100, prefix: '', ...(cursor ? { cursor } : {}) } })
}

export function repos(env: Cloudflare.Env, swarm: string) {
  return send<{ repos: { name: string; public: boolean }[] }>(env, '/v1/git/list', { app: app(swarm), body: {} })
}

export function reveal(env: Cloudflare.Env, swarm: string, kind: 'bucket' | 'git' | 'kv', name: string) {
  return send<unknown>(env, `/v1/${kind}/visibility`, { app: app(swarm), body: kind === 'git' ? { name, public: true } : { key: name, public: true } })
}

export function sandboxes(env: Cloudflare.Env, swarm: string) {
  return send<{ sandboxes: { hand?: string | null; sandboxId: string; status: string }[] }>(env, '/v1/compute/list', {
    app: app(swarm),
    body: {},
  })
}

export function terminate(env: Cloudflare.Env, swarm: string, sandboxId: string) {
  return send<unknown>(env, '/v1/compute/terminate', { app: app(swarm), body: { sandboxId } })
}

export function stream(env: Cloudflare.Env, swarm: string, agent: string, after: number, signal: AbortSignal, live: boolean) {
  return call(env, `/v1/agents/${agent}/events?after=${after}&live=${live ? 1 : 0}`, {
    headers: { accept: 'text/event-stream', authorization: 'Bearer ' + env.SWARMS_GATEWAY_KEY, 'gateway-app': app(swarm) },
    signal,
  })
}

export function hands(env: Cloudflare.Env, swarm: string) {
  return send<Hands>(env, '/v1/hands', { app: app(swarm) })
}

export function hand(env: Cloudflare.Env, swarm: string, name: string) {
  return send<Minted>(env, `/v1/hands?name=${encodeURIComponent(name)}`, { app: app(swarm), method: 'POST' })
}

export function cap(env: Cloudflare.Env, swarm: string, name: string, usd: number) {
  return send<unknown>(env, `/v1/hands/${encodeURIComponent(name)}/cap`, { app: app(swarm), body: { usd } })
}

export function detach(env: Cloudflare.Env, swarm: string, name: string) {
  return send<{ disconnected: boolean }>(env, `/v1/hands/${encodeURIComponent(name)}`, { app: app(swarm), method: 'DELETE' })
}

export async function code<value>(env: Cloudflare.Env, owner: string, swarm: string, path: string) {
  return Timing.span(
    'gw.p.git',
    call(env, `/p/${owner}/${app(swarm)}/git${path}`, { headers: { accept: 'application/json' } }).then((response) =>
      response.ok ? (response.json() as Promise<value>) : undefined,
    ),
  )
}
