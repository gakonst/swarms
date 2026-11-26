import type { Store } from 'accounts'
import type { Address } from 'viem'
import { z } from 'zod'
import { assert } from '../shared/Assert.ts'
import { Held, limits } from './Held.ts'
import * as Replica from './Replica.ts'
import * as Limits from '../shared/Limits.ts'

export const path = '/v1/auth'

export const days = Limits.Sessions.days

type Stored = { expires_at: number | null; value: string }

export type Session = { address: Address; expiresAt: number; method: 'siwe' }

const session = z
  .object({ address: z.string().min(1), expiresAt: z.number(), method: z.literal('siwe') })
  .loose()
  .transform((value): Session => ({ address: value.address.toLowerCase() as Address, expiresAt: value.expiresAt, method: value.method }))

const tokenShape = new RegExp(`^[\\w-]{1,${Limits.Sessions.tokenMost}}$`)

function decode(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    console.error('Unreadable session record, treated as absent')
    return undefined
  }
}

function live(row: Stored | null): unknown {
  return row && (row.expires_at === null || row.expires_at > Date.now()) ? decode(row.value) : undefined
}

const held = new Held<Stored>(limits.sessions)

function hold(key: string, row: Stored | null) {
  if (!row) return row
  return held.set(key, row)
}

export function store(db: D1Database): Store.Store {
  const read = (from: D1Database | D1DatabaseSession, key: string) => from.prepare('select value, expires_at from sessions where key = ?').bind(key).first<Stored>()
  return {
    getItem: async (key) => {
      const kept = held.get(key)
      if (kept) return live(kept)
      return live(hold(key, (await read(db.withSession('first-unconstrained'), key)) ?? (await read(db, key))))
    },
    removeItem: async (key) => {
      held.delete(key)
      await db.prepare('delete from sessions where key = ?').bind(key).run()
    },
    setItem: async (key, value, options) => {
      held.delete(key)
      const now = Date.now()
      await db.batch([
        db.prepare('delete from sessions where expires_at < ?').bind(now),
        db.prepare('insert or replace into sessions (key, value, expires_at) values (?, ?, ?)').bind(key, JSON.stringify(value), options?.expiresAt ?? null),
      ])
    },
    takeItem: async (key) => {
      held.delete(key)
      return live(await db.prepare('delete from sessions where key = ? returning value, expires_at').bind(key).first<Stored>())
    },
  }
}

export function bearer(request: Request) {
  return /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
}

export function parse(value: unknown, now: number): Session | undefined {
  if (value === null || value === undefined) return undefined
  const parsed = session.safeParse(value)
  if (!parsed.success) {
    console.error('Unreadable Tempo ID session, treated as absent', parsed.error.issues)
    return undefined
  }
  return parsed.data.expiresAt > now ? parsed.data : undefined
}

export async function holder(env: Cloudflare.Env, token: string): Promise<Address | undefined> {
  if (!tokenShape.test(token)) return undefined
  const now = Date.now()
  const found = parse(await store(Replica.primary(env).DB).getItem('tempo-id:session:' + token), now)
  if (!found) return undefined
  assert(found.expiresAt > now, 'a held session has not expired', found.expiresAt)
  return found.address
}

export async function who(env: Cloudflare.Env, request: Request) {
  const token = bearer(request)
  return token ? holder(env, token) : undefined
}
