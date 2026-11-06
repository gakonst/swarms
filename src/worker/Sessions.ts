import { Handler, Kv } from 'accounts/server'
import type { Address } from 'viem'
import { createClient, http } from 'viem'
import { tempo } from 'viem/tempo/chains'
import * as Replica from './Replica.ts'

export const path = '/v1/auth'

export const days = 30

type Stored = { expires_at: number | null; value: string }

function live<value>(row: Stored | null): value | undefined {
  return row && (row.expires_at === null || row.expires_at > Date.now()) ? (JSON.parse(row.value) as value) : undefined
}

const held = new Map<string, { at: number; row: Stored }>()

const heldMs = 30_000

function hold(key: string, row: Stored | null) {
  if (!row) return row
  held.delete(key)
  held.set(key, { at: Date.now(), row })
  for (const old of held.keys()) {
    if (held.size <= 500) break
    held.delete(old)
  }
  return row
}

export function store(env: Cloudflare.Env) {
  const db = Replica.primary(env).DB
  const read = (from: D1Database | D1DatabaseSession, key: string) => from.prepare('select value, expires_at from sessions where key = ?').bind(key).first<Stored>()
  return Kv.from({
    delete: async (key: string) => {
      held.delete(key)
      await db.prepare('delete from sessions where key = ?').bind(key).run()
    },
    get: async <value>(key: string) => {
      const kept = held.get(key)
      if (kept && Date.now() - kept.at < heldMs) return live<value>(kept.row)
      return live<value>(hold(key, (await read(db.withSession('first-unconstrained'), key)) ?? (await read(db, key))))
    },
    set: async (key: string, value: unknown, options?: { ttl?: number | undefined }) => {
      held.delete(key)
      const now = Date.now()
      await db.batch([
        db.prepare('delete from sessions where expires_at < ?').bind(now),
        db.prepare('insert or replace into sessions (key, value, expires_at) values (?, ?, ?)').bind(
          key,
          JSON.stringify(value),
          options?.ttl ? now + options.ttl * 1000 : null,
        ),
      ])
    },
    take: async <value>(key: string) => {
      held.delete(key)
      return live<value>(await db.prepare('delete from sessions where key = ? returning value, expires_at').bind(key).first<Stored>())
    },
  })
}

const keyed = { ...tempo, verifyHash: (client: Parameters<typeof tempo.verifyHash>[0], parameters: Parameters<typeof tempo.verifyHash>[1]) => tempo.verifyHash(client, { ...parameters, mode: 'allowAccessKey' }) }

export function auth(env: Cloudflare.Env) {
  return Handler.auth({
    cookie: false,
    getClient: () => createClient({ chain: keyed, transport: http(env.TEMPO_RPC) }),
    origin: env.SWARMS_URL,
    path,
    statement: 'Sign in to Swarms to chat in the rooms of the swarms you back.',
    store: store(env),
    transport: http(env.TEMPO_RPC),
    ttl: { session: days * 86_400 },
  })
}

export async function who(env: Cloudflare.Env, request: Request): Promise<Address | undefined> {
  if (!request.headers.get('authorization')) return undefined
  const session = await auth(env).getSession(request)
  return session ? (session.address.toLowerCase() as Address) : undefined
}

export function holder(env: Cloudflare.Env, token: string) {
  return who(env, new Request(env.SWARMS_URL, { headers: { authorization: `Bearer ${token}` } }))
}
