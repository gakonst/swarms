import type { Address } from 'viem'
import { z } from 'zod'
import * as Operations from './Operations.ts'
import * as Replica from './Replica.ts'
import * as Sessions from './Sessions.ts'
import * as Limits from '../shared/Limits.ts'

export const scopes = ['swarms:read', 'swarms:write', 'swarms:money', 'swarms:admin'] as const

export type Scope = (typeof scopes)[number]

export const meanings: Record<Scope, string> = {
  'swarms:admin': 'Rename and archive swarms you run, and remove hands from them.',
  'swarms:money': 'Count your rides and move your money between branches and nodes.',
  'swarms:read': 'Read every swarm, its feed, tree, machines and room.',
  'swarms:write': 'Start swarms, suggest and propose ideas, lend machines and set your own AI keys.',
}

export const fallback: Scope[] = ['swarms:read', 'swarms:write']

export const accessSeconds = Limits.OAuth.accessSeconds

const refreshMs = Limits.OAuth.refreshMs

const codeMs = Limits.OAuth.codeMs

const clientMs = Limits.OAuth.clientMs

export type Caller = { address?: Address | undefined; bearer: 'invalid' | 'none' | 'oauth' | 'operator' | 'session'; operated: boolean; scopes: ReadonlySet<Scope> }

type Client = { client_id: string; client_id_issued_at: number; client_name: string; redirect_uris: string[] }

type Grant = { address: Address; client_id: string; scopes: Scope[] }

type Code = Grant & { challenge: string; redirect_uri: string; resource: string | null }

type Failure = { error: string; error_description: string }

export type Outcome<value> = { ok: true; value: value } | { failure: Failure; ok: false; status: number }

function fail(status: number, error: string, error_description: string): Outcome<never> {
  return { failure: { error, error_description }, ok: false, status }
}

export function resource(site: string) {
  return `${site}/mcp`
}

export function metadata(site: string) {
  return `${site}/.well-known/oauth-protected-resource/mcp`
}

export function protectedResource(site: string) {
  return {
    authorization_servers: [site],
    bearer_methods_supported: ['header'],
    resource: resource(site),
    resource_documentation: `${site}/docs#mcp`,
    resource_name: 'Swarms',
    scopes_supported: scopes,
  }
}

export function server(site: string) {
  return {
    authorization_endpoint: `${site}/oauth/authorize`,
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    issuer: site,
    registration_endpoint: `${site}/oauth/register`,
    response_modes_supported: ['query'],
    response_types_supported: ['code'],
    revocation_endpoint: `${site}/oauth/revoke`,
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: scopes,
    service_documentation: `${site}/docs#mcp`,
    token_endpoint: `${site}/oauth/token`,
    token_endpoint_auth_methods_supported: ['none'],
  }
}

export function challenge(site: string, options: { error?: { code: 'insufficient_scope' | 'invalid_token'; description: string }; scope?: string } = {}) {
  const parts = [`resource_metadata="${metadata(site)}"`]
  if (options.error) parts.push(`error="${options.error.code}"`, `error_description="${options.error.description.replace(/"/g, "'")}"`)
  parts.push(`scope="${options.scope ?? fallback.join(' ')}"`)
  return `Bearer ${parts.join(', ')}`
}

function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function random(size: number) {
  return encode(crypto.getRandomValues(new Uint8Array(size)))
}

export async function digest(value: string) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}

function db(env: Cloudflare.Env) {
  return Replica.primary(env).DB
}

async function put(env: Cloudflare.Env, key: string, value: unknown, ms: number) {
  await db(env).prepare('insert or replace into sessions (key, value, expires_at) values (?, ?, ?)').bind(key, JSON.stringify(value), Date.now() + ms).run()
}

type Row = { expires_at: number | null; value: string }

function live<value>(row: Row | null) {
  return row && (row.expires_at === null || row.expires_at > Date.now()) ? (JSON.parse(row.value) as value) : undefined
}

async function read<value>(env: Cloudflare.Env, key: string) {
  return live<value>(await db(env).prepare('select value, expires_at from sessions where key = ?').bind(key).first<Row>())
}

async function take<value>(env: Cloudflare.Env, key: string) {
  return live<value>(await db(env).prepare('delete from sessions where key = ? returning value, expires_at').bind(key).first<Row>())
}

const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/

function redirectable(uri: string) {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password) return false
  if (['javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:'].includes(url.protocol)) return false
  if (url.protocol === 'http:') return loopback.test(url.hostname)
  return true
}

function matches(registered: string[], given: string) {
  if (registered.includes(given)) return true
  let asked: URL
  try {
    asked = new URL(given)
  } catch {
    return false
  }
  if (!loopback.test(asked.hostname)) return false
  return registered.some((each) => {
    const known = new URL(each)
    return known.protocol === asked.protocol && known.hostname === asked.hostname && known.pathname === asked.pathname && known.search === asked.search
  })
}

export function parse(scope: unknown): Scope[] {
  if (typeof scope !== 'string' || !scope.trim()) return [...fallback]
  const asked = new Set(scope.trim().split(/\s+/))
  const known = scopes.filter((each) => asked.has(each))
  if (!known.length) return [...fallback]
  return known.includes('swarms:read') ? known : ['swarms:read', ...known]
}

const registration = z
  .object({
    client_name: z.string().trim().max(100).optional(),
    redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  })
  .loose()

export async function register(env: Cloudflare.Env, input: Record<string, unknown>): Promise<Outcome<Client & Record<string, unknown>>> {
  const parsed = registration.safeParse(input)
  if (!parsed.success) return fail(400, 'invalid_client_metadata', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  const refused = parsed.data.redirect_uris.find((uri) => !redirectable(uri))
  if (refused) return fail(400, 'invalid_redirect_uri', `${refused} is not a redirect URI Swarms sends codes to: use https, a loopback http address or an app's own scheme, without a fragment.`)
  const client: Client = { client_id: `swc_${random(16)}`, client_id_issued_at: Math.floor(Date.now() / 1000), client_name: parsed.data.client_name || 'An MCP client', redirect_uris: parsed.data.redirect_uris }
  await put(env, `oauth:client:${client.client_id}`, client, clientMs)
  return { ok: true, value: { ...client, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: scopes.join(' '), token_endpoint_auth_method: 'none' } }
}

export type Asked = { client_id: string; client_name: string; code_challenge: string; redirect_host: string; redirect_uri: string; resource: string | null; scopes: { meaning: string; scope: Scope }[]; state: string | null }

export async function request(env: Cloudflare.Env, params: Record<string, unknown>, site: string): Promise<Outcome<Asked>> {
  const text = (key: string) => (typeof params[key] === 'string' ? (params[key] as string) : undefined)
  const id = text('client_id')
  const client = id && id.startsWith('swc_') ? await read<Client>(env, `oauth:client:${id}`) : undefined
  if (!client) return fail(400, 'invalid_client', 'This app is not registered with Swarms. Add the server to it again so it registers.')
  const redirect = text('redirect_uri') ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : undefined)
  if (!redirect || !matches(client.redirect_uris, redirect)) return fail(400, 'invalid_request', 'The redirect URI is not one this app registered.')
  if (text('response_type') !== 'code') return fail(400, 'unsupported_response_type', 'Swarms answers response_type=code only.')
  const challenged = text('code_challenge')
  if (!challenged || !/^[A-Za-z0-9_-]{43,128}$/.test(challenged) || text('code_challenge_method') !== 'S256') return fail(400, 'invalid_request', 'Send a PKCE code_challenge with code_challenge_method=S256.')
  const asked = text('resource') ?? null
  const target = asked?.replace(/\/+$/, '')
  if (target !== undefined && target !== resource(site) && target !== site) return fail(400, 'invalid_target', `Swarms grants tokens for ${resource(site)} only.`)
  const url = new URL(redirect)
  return {
    ok: true,
    value: {
      client_id: client.client_id,
      client_name: client.client_name,
      code_challenge: challenged,
      redirect_host: url.host || url.protocol,
      redirect_uri: redirect,
      resource: asked,
      scopes: parse(text('scope')).map((scope) => ({ meaning: meanings[scope], scope })),
      state: text('state') ?? null,
    },
  }
}

function back(redirect: string, params: Record<string, string | null>) {
  const url = new URL(redirect)
  for (const [key, value] of Object.entries(params)) if (value !== null) url.searchParams.set(key, value)
  return url.href
}

export async function approve(env: Cloudflare.Env, input: Record<string, unknown>, token: string | undefined, site: string): Promise<Outcome<{ redirect: string }>> {
  const address = token ? await Sessions.holder(env, token).catch(() => undefined) : undefined
  if (!address) return fail(401, 'login_required', 'Sign in with Tempo ID to connect an app.')
  const asked = await request(env, input, site)
  if (!asked.ok) return asked
  if (input['allow'] !== true) return { ok: true, value: { redirect: back(asked.value.redirect_uri, { error: 'access_denied', error_description: 'You did not allow it.', iss: site, state: asked.value.state }) } }
  const offered = new Set(asked.value.scopes.map((each) => each.scope))
  const chosen = typeof input['granted'] === 'string' ? parse(input['granted']).filter((scope) => offered.has(scope)) : [...offered]
  const code = `swk_${random(32)}`
  const kept: Code = { address, challenge: asked.value.code_challenge, client_id: asked.value.client_id, redirect_uri: asked.value.redirect_uri, resource: asked.value.resource, scopes: chosen.includes('swarms:read') ? chosen : ['swarms:read', ...chosen] }
  await put(env, `oauth:code:${await digest(code)}`, kept, codeMs)
  return { ok: true, value: { redirect: back(asked.value.redirect_uri, { code, iss: site, state: asked.value.state }) } }
}

export type Tokens = { access_token: string; expires_in: number; refresh_token: string; scope: string; token_type: 'Bearer' }

async function issue(env: Cloudflare.Env, grant: Grant): Promise<Tokens> {
  const access = `swa_${random(32)}`
  const refresh = `swr_${random(32)}`
  const kept: Grant = { address: grant.address, client_id: grant.client_id, scopes: grant.scopes }
  await Promise.all([put(env, `oauth:access:${await digest(access)}`, kept, accessSeconds * 1000), put(env, `oauth:refresh:${await digest(refresh)}`, kept, refreshMs)])
  return { access_token: access, expires_in: accessSeconds, refresh_token: refresh, scope: grant.scopes.join(' '), token_type: 'Bearer' }
}

export async function token(env: Cloudflare.Env, input: Record<string, unknown>): Promise<Outcome<Tokens>> {
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : undefined)
  const grant = text('grant_type')
  const client = text('client_id')
  if (grant === 'authorization_code') {
    const code = text('code')
    const verifier = text('code_verifier')
    if (!code || !verifier) return fail(400, 'invalid_request', 'Send code and code_verifier.')
    const kept = await take<Code>(env, `oauth:code:${await digest(code)}`)
    if (!kept) return fail(400, 'invalid_grant', 'This code expired or was already used.')
    if (client && client !== kept.client_id) return fail(400, 'invalid_grant', 'This code was issued to another app.')
    if (text('redirect_uri') && text('redirect_uri') !== kept.redirect_uri) return fail(400, 'invalid_grant', 'The redirect URI differs from the one the code was issued for.')
    if ((await digest(verifier)) !== kept.challenge) return fail(400, 'invalid_grant', 'The code_verifier does not match the code_challenge.')
    return { ok: true, value: await issue(env, kept) }
  }
  if (grant === 'refresh_token') {
    const refresh = text('refresh_token')
    if (!refresh) return fail(400, 'invalid_request', 'Send refresh_token.')
    const kept = await take<Grant>(env, `oauth:refresh:${await digest(refresh)}`)
    if (!kept) return fail(400, 'invalid_grant', 'This refresh token expired, was revoked or was already used.')
    if (client && client !== kept.client_id) return fail(400, 'invalid_grant', 'This refresh token was issued to another app.')
    const narrowed = text('scope') ? parse(text('scope')).filter((scope) => kept.scopes.includes(scope)) : kept.scopes
    return { ok: true, value: await issue(env, { ...kept, scopes: narrowed }) }
  }
  return fail(400, 'unsupported_grant_type', 'Swarms answers authorization_code and refresh_token grants.')
}

export async function revoke(env: Cloudflare.Env, input: Record<string, unknown>) {
  const given = typeof input['token'] === 'string' ? input['token'] : undefined
  if (!given) return
  const hashed = await digest(given)
  await db(env).batch([db(env).prepare('delete from sessions where key = ?').bind(`oauth:access:${hashed}`), db(env).prepare('delete from sessions where key = ?').bind(`oauth:refresh:${hashed}`)])
}

const anonymous: Caller = { bearer: 'none', operated: false, scopes: new Set<Scope>(['swarms:read']) }

export async function caller(env: Cloudflare.Env, request: Request): Promise<Caller> {
  const given = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!given) return anonymous
  if (given.startsWith('swa_')) {
    const grant = await read<Grant>(env, `oauth:access:${await digest(given)}`)
    return grant ? { address: grant.address, bearer: 'oauth', operated: false, scopes: new Set(grant.scopes) } : { ...anonymous, bearer: 'invalid' }
  }
  const [address, operated] = await Promise.all([Sessions.holder(env, given).catch(() => undefined), Operations.keyed(env, given)])
  if (!address && !operated) return anonymous
  return { address, bearer: operated ? 'operator' : 'session', operated, scopes: new Set(scopes) }
}

export async function form(request: Request): Promise<Record<string, unknown>> {
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    const parsed: unknown = await request.json().catch(() => ({}))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  }
  return Object.fromEntries(new URLSearchParams(await request.text().catch(() => '')))
}

export function respond<value>(outcome: Outcome<value>, status = 200) {
  const headers = { 'cache-control': 'no-store', pragma: 'no-cache' }
  return outcome.ok ? Response.json(outcome.value, { headers, status }) : Response.json(outcome.failure, { headers, status: outcome.status })
}
