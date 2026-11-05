export type Result<value> = { ok: true; value: value } | { detail: string; ok: false; status: number }

export type Report = {
  error?: { message?: string } | string
  ok?: { message?: string }
  request_id: string
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

export type Sponsored = { available: string; channel: `0x${string}`; closing: boolean; deposit: string; endedAt: number | null; settled: string; spent: string; tx?: string }

export type Sponsorship = { least: string; operator: `0x${string}`; signer: `0x${string}` }

type Init = { app?: string; body?: unknown; key?: string; method?: string }

export function app(swarm: string) {
  return `swarm-${swarm}`
}

async function send<value>(env: Cloudflare.Env, path: string, init: Init = {}): Promise<Result<value>> {
  const headers = new Headers({ accept: 'application/json', authorization: 'Bearer ' + (init.key ?? env.SWARMS_GATEWAY_KEY) })
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (init.app) headers.set('gateway-app', init.app)

  const response = await fetch(env.GATEWAY_URL + path, {
    body: init.body === undefined ? null : JSON.stringify(init.body),
    headers,
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
  })
  const text = await response.text()
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

let operator: Promise<string | undefined> | undefined

export function wallet(env: Cloudflare.Env) {
  const known = (operator ??= me(env).then((result) => (result.ok ? result.value.wallet.toLowerCase() : undefined)))
  void known.then((value) => {
    if (!value && operator === known) operator = undefined
  })
  return known
}

let sponsoring: Promise<Sponsorship | undefined> | undefined

export function sponsorship(env: Cloudflare.Env) {
  const known = (sponsoring ??= Promise.all([
    send<{ accessKey: `0x${string}` }>(env, '/api/keys/me'),
    send<{ sponsors?: { least: string; operator: `0x${string}` } }>(env, '/v1/capabilities'),
  ]).then(([me, capabilities]) =>
    me.ok && capabilities.ok && capabilities.value.sponsors ? { least: capabilities.value.sponsors.least, operator: capabilities.value.sponsors.operator, signer: me.value.accessKey } : undefined,
  ))
  void known.then((value) => {
    if (!value && sponsoring === known) sponsoring = undefined
  })
  return known
}

export function sponsor(env: Cloudflare.Env, swarm: string, body: { descriptor: unknown; transaction?: string }) {
  return send<Sponsored>(env, '/api/keys/sponsors', { app: app(swarm), body: { ...body, passThrough: true } })
}

export function sponsors(env: Cloudflare.Env, swarm: string) {
  return send<{ sponsors: Sponsored[] }>(env, '/api/keys/sponsors', { app: app(swarm) })
}

export function unsponsor(env: Cloudflare.Env, swarm: string, channel: string) {
  return send<{ closed: boolean; tx: string | null }>(env, `/api/keys/sponsors/${channel}`, { app: app(swarm), method: 'DELETE' })
}

export function revoke(env: Cloudflare.Env, key: string) {
  return send<unknown>(env, '/api/keys/revoke', { body: {}, key })
}

export function agent(env: Cloudflare.Env, swarm: string, input: { name: string; payer: { secret: string; url: string } }) {
  return send<{ id: string }>(env, '/v1/agents', {
    app: app(swarm),
    body: { name: input.name, payer: input.payer },
  })
}

export function repay(env: Cloudflare.Env, swarm: string, agent: string, payer: { secret: string; url: string }) {
  return send<unknown>(env, `/v1/agents/${agent}`, { app: app(swarm), body: { payer }, method: 'PATCH' })
}

export function prompt(env: Cloudflare.Env, swarm: string, agent: string, input: { prompt: string; steer: boolean }) {
  return send<{ request_id: string; status: string }>(env, `/v1/agents/${agent}/turns`, { app: app(swarm), body: input })
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

export function stream(env: Cloudflare.Env, swarm: string, agent: string, after: number, signal: AbortSignal) {
  return fetch(`${env.GATEWAY_URL}/v1/agents/${agent}/events?after=${after}&live=1`, {
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
  const response = await fetch(`${env.GATEWAY_URL}/p/${owner}/${app(swarm)}/git${path}`, { headers: { accept: 'application/json' } })
  return response.ok ? ((await response.json()) as value) : undefined
}
