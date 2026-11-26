import type { Address } from 'viem'
import { z } from 'zod'
import { assert, never } from '../../shared/Assert.ts'
import * as Limits from '../../shared/Limits.ts'

export const version = 1

export const scopes = ['swarms:read', 'swarms:write', 'swarms:money', 'swarms:admin'] as const

export type Scope = (typeof scopes)[number]

export type Client = { client_id: string; client_id_issued_at: number; client_name: string; redirect_uris: string[] }

export type Grant = { address: Address; client_id: string; scopes: Scope[] }

export type Code = Grant & { challenge: string; redirect_uri: string; resource: string | null }

export type Kind = 'access' | 'client' | 'code' | 'refresh'

export type Record = { client: Client; kind: 'client' } | { code: Code; kind: 'code' } | { grant: Grant; kind: 'access' } | { grant: Grant; kind: 'refresh' }

export type State = { at: 'issued'; code: Code } | { at: 'rotating'; grant: Grant } | { at: 'spent' }

export type Event = { client: string | undefined; redirect: string | undefined; type: 'exchange'; verified: string } | { client: string | undefined; narrowed: Scope[] | undefined; type: 'refresh' }

export type Refusal = 'code_spent' | 'code_client' | 'code_redirect' | 'code_verifier' | 'refresh_spent' | 'refresh_client'

export type Step = { grant: Grant; ok: true } | { ok: false; refusal: Refusal }

export const prefixes: { [kind in Kind]: string } = { access: 'oauth:access:', client: 'oauth:client:', code: 'oauth:code:', refresh: 'oauth:refresh:' }

const known = z.array(z.string()).transform((each) => scopes.filter((scope) => each.includes(scope)))

const address = z
  .string()
  .regex(new RegExp(`^0x[0-9a-fA-F]{${Limits.OAuth.addressDigits}}$`))
  .transform((value) => value as Address)

const granted = z.object({ address, client_id: z.string().min(1), scopes: known, v: z.literal(version).optional() }).loose()

const shapes = {
  access: granted,
  client: z.object({ client_id: z.string().startsWith('swc_'), client_id_issued_at: z.number(), client_name: z.string(), redirect_uris: z.array(z.string()).min(1), v: z.literal(version).optional() }).loose(),
  code: granted.extend({ challenge: z.string().min(1), redirect_uri: z.string().min(1), resource: z.string().nullable() }),
  refresh: granted,
} as const

export function kind(key: string): Kind | undefined {
  return (Object.keys(prefixes) as Kind[]).find((each) => key.startsWith(prefixes[each]))
}

function checked<value>(shape: z.ZodType<value>, value: unknown, at: Kind): value | undefined {
  const parsed = shape.safeParse(value)
  if (parsed.success) return parsed.data
  console.error('Unreadable OAuth record, treated as absent', { issues: parsed.error.issues, kind: at })
  return undefined
}

export function parse(key: string, value: unknown): Record | undefined {
  const at = kind(key)
  if (!at || value === undefined || value === null) return undefined
  switch (at) {
    case 'client': {
      const data = checked(shapes.client, value, at)
      return data && { client: { client_id: data.client_id, client_id_issued_at: data.client_id_issued_at, client_name: data.client_name, redirect_uris: data.redirect_uris }, kind: at }
    }
    case 'code': {
      const data = checked(shapes.code, value, at)
      return data && { code: { address: data.address, challenge: data.challenge, client_id: data.client_id, redirect_uri: data.redirect_uri, resource: data.resource, scopes: data.scopes }, kind: at }
    }
    case 'access':
    case 'refresh': {
      const data = checked(granted, value, at)
      return data && { grant: { address: data.address, client_id: data.client_id, scopes: data.scopes }, kind: at }
    }
    default:
      return never(at, 'OAuth record kind')
  }
}

export function store(record: Record) {
  switch (record.kind) {
    case 'client':
      assert(record.client.redirect_uris.length > 0, 'a client registers a redirect URI', record.client.client_id)
      return { ...record.client, v: version }
    case 'code':
      assert(record.code.scopes.includes('swarms:read'), 'a code grants swarms:read', record.code.scopes)
      return { address: record.code.address, challenge: record.code.challenge, client_id: record.code.client_id, redirect_uri: record.code.redirect_uri, resource: record.code.resource, scopes: record.code.scopes, v: version }
    case 'access':
    case 'refresh':
      return { address: record.grant.address, client_id: record.grant.client_id, scopes: record.grant.scopes, v: version }
    default:
      return never(record, 'OAuth record')
  }
}

export function step(state: State, event: Event): Step {
  switch (event.type) {
    case 'exchange': {
      if (state.at !== 'issued') return { ok: false, refusal: 'code_spent' }
      const { code } = state
      if (event.client && event.client !== code.client_id) return { ok: false, refusal: 'code_client' }
      if (event.redirect && event.redirect !== code.redirect_uri) return { ok: false, refusal: 'code_redirect' }
      if (event.verified !== code.challenge) return { ok: false, refusal: 'code_verifier' }
      return { grant: { address: code.address, client_id: code.client_id, scopes: code.scopes }, ok: true }
    }
    case 'refresh': {
      if (state.at !== 'rotating') return { ok: false, refusal: 'refresh_spent' }
      const { grant } = state
      if (event.client && event.client !== grant.client_id) return { ok: false, refusal: 'refresh_client' }
      const narrowed = event.narrowed ? event.narrowed.filter((scope) => grant.scopes.includes(scope)) : grant.scopes
      return { grant: { ...grant, scopes: narrowed }, ok: true }
    }
    default:
      return never(event, 'OAuth grant event')
  }
}
