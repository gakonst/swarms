import type { Currency, Device } from '../shared/Api.ts'

export type Result<value> = { ok: true; value: value } | { detail: string; ok: false; status: number }

export type Requested = { authorizeAccessKey: unknown; device?: Device; id: string }

export type Completed = { key: string; status: 'completed' } | { status: 'pending' }

export type Me = {
  wallet: `0x${string}`
  usage: {
    channel: { available: string; deposit: string; id: string; spent: string } | null
    limit: { remaining: string | null; total: string }
    wallet: { balance: string | null }
  }
}

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
  request_id?: string
  seq: number
}

export type Page = { events: Event[]; has_more: boolean; next_cursor: number }

export type Hands = { hands: { connected: boolean; name: string }[] }

export type Minted = { command: string; short: string; tab?: string; token: string; url: string }

type Init = { body?: unknown; key?: string; method?: string }

async function send<value>(env: Cloudflare.Env, path: string, init: Init = {}): Promise<Result<value>> {
  const headers = new Headers({ accept: 'application/json' })
  if (init.body !== undefined) headers.set('content-type', 'application/json')
  if (init.key) headers.set('authorization', 'Bearer ' + init.key)

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

export function request(
  env: Cloudflare.Env,
  input: { days: number; deposit: number; device?: boolean; limit: number; search?: number; token?: Currency; topUp: number },
) {
  return send<Requested>(env, '/api/keys/request', { body: input })
}

export async function topUp(env: Cloudflare.Env, key: string, amount: number) {
  const topped = await send<Me | undefined>(env, '/api/keys/topup', { body: { amount }, key })
  return topped.ok && !topped.value?.usage ? me(env, key) : (topped as Result<Me>)
}

export function complete(
  env: Cloudflare.Env,
  input: { id: string; keyAuthorization?: unknown; name: string; transaction?: string },
) {
  return send<Completed>(env, '/api/keys/complete', { body: input })
}

export function me(env: Cloudflare.Env, key: string) {
  return send<Me>(env, '/api/keys/me', { key })
}

export function revoke(env: Cloudflare.Env, key: string) {
  return send<unknown>(env, '/api/keys/revoke', { body: {}, key })
}

export function agent(env: Cloudflare.Env, key: string, input: { name: string }) {
  return send<{ id: string }>(env, '/v1/agents', {
    body: { harness: 'codex', name: input.name, thinking: 'low' },
    key,
  })
}

export function prompt(
  env: Cloudflare.Env,
  key: string,
  agent: string,
  input: { prompt: string; steer: boolean },
) {
  return send<{ request_id: string; status: string }>(env, `/v1/agents/${agent}/turns`, {
    body: input,
    key,
  })
}

export function turn(env: Cloudflare.Env, key: string, agent: string, turn: string) {
  return send<Report>(env, `/v1/agents/${agent}/turns/${turn}`, { key })
}

export function cancel(env: Cloudflare.Env, key: string, agent: string, turn: string) {
  return send<unknown>(env, `/v1/agents/${agent}/turns/${turn}/cancel`, { body: {}, key })
}

export function events(env: Cloudflare.Env, key: string, agent: string, after: number) {
  return send<Page>(env, `/v1/agents/${agent}/events?after=${after}&limit=128`, { key })
}

export function sandboxes(env: Cloudflare.Env, key: string) {
  return send<{ sandboxes: { hand?: string | null; sandboxId: string; status: string }[] }>(
    env,
    '/v1/compute/list',
    { body: {}, key },
  )
}

export function terminate(env: Cloudflare.Env, key: string, sandboxId: string) {
  return send<unknown>(env, '/v1/compute/terminate', { body: { sandboxId }, key })
}

export function stream(env: Cloudflare.Env, key: string, agent: string, after: number, signal: AbortSignal) {
  return fetch(`${env.GATEWAY_URL}/v1/agents/${agent}/events?after=${after}&live=1`, {
    headers: { accept: 'text/event-stream', authorization: 'Bearer ' + key },
    signal,
  })
}

export function hands(env: Cloudflare.Env, key: string) {
  return send<Hands>(env, '/v1/hands', { key })
}

export function hand(env: Cloudflare.Env, key: string, name: string) {
  return send<Minted>(env, `/v1/hands?name=${encodeURIComponent(name)}`, { key, method: 'POST' })
}

export function detach(env: Cloudflare.Env, key: string, name: string) {
  return send<{ disconnected: boolean }>(env, `/v1/hands/${encodeURIComponent(name)}`, { key, method: 'DELETE' })
}
