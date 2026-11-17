import { Accounts, Store } from 'accounts'
import { backend, siwe, viem } from 'accounts/plugins'
import type { Address } from 'viem'
import { http } from 'viem'
import { z } from 'zod'
import * as Site from '../shared/Site.ts'
import * as Chain from './Chain.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'

export const path = '/v1/auth'

export const days = 30

type Stored = { expires_at: number | null; value: string }

function live(row: Stored | null): unknown {
  return row && (row.expires_at === null || row.expires_at > Date.now()) ? JSON.parse(row.value) : undefined
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

function store(db: D1Database) {
  const read = (from: D1Database | D1DatabaseSession, key: string) => from.prepare('select value, expires_at from sessions where key = ?').bind(key).first<Stored>()
  return Store.from({
    getItem: async (key) => {
      const kept = held.get(key)
      if (kept && Date.now() - kept.at < heldMs) return live(kept.row)
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
  })
}

function create(env: Cloudflare.Env, origin: string) {
  return Accounts.create({
    chain: Chain.chain.id,
    clientId: origin,
    plugins: [
      backend({ store: store(Replica.primary(env).DB) }),
      siwe({ lifetime: days * 86_400_000, origin, statement: 'Sign in to Swarms to chat in the rooms of the swarms you back.' }),
      viem({ transport: http(env.TEMPO_RPC) }),
    ],
  })
}

const instances = new Map<string, ReturnType<typeof create>>()

// Sign-in is for the site the Worker serves: SWARMS_URL, or the local host a dev server answers on
// (Site.url), so a page on localhost signs in without a tunnel. A challenge's stored message names
// its origin, so completing and reading sessions works with any instance.
function accounts(env: Cloudflare.Env, origin = new URL(env.SWARMS_URL).origin) {
  let instance = instances.get(origin)
  if (!instance) {
    instance = create(env, origin)
    instances.set(origin, instance)
  }
  return instance
}

const verifying = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  id: z.string().min(1).max(128),
  message: z.string().min(1).max(4096),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
})

function refused(error: unknown): Problem.Result<never> {
  if (error instanceof Error && error.name === 'Plugins.siwe.InvalidError') return Problem.fail(401, 'unauthorized', error.message)
  return Problem.fail(502, 'upstream_failed', `Tempo did not answer while checking the signature: ${error instanceof Error ? error.message : String(error)}`)
}

export async function challenge(env: Cloudflare.Env, request: Request): Promise<Problem.Result<{ id: string; message: string }>> {
  try {
    const site = Site.url(env, request.url)
    return Problem.ok(await accounts(env, new URL(site).origin).siwe.start({ request: request.headers.has('origin') ? request : new Request(site) }))
  } catch (error) {
    return refused(error)
  }
}

export async function verify(env: Cloudflare.Env, input: Record<string, unknown>): Promise<Problem.Result<{ token: string }>> {
  const parsed = verifying.safeParse(input)
  if (!parsed.success) return Problem.invalid(parsed.error)

  try {
    const session = await accounts(env).siwe.complete({ ...parsed.data, address: parsed.data.address as Address, signature: parsed.data.signature as `0x${string}` })
    return Problem.ok({ token: session.id })
  } catch (error) {
    return refused(error)
  }
}

function bearer(request: Request) {
  return /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
}

export async function logout(env: Cloudflare.Env, request: Request): Promise<Problem.Result<{ ended: boolean }>> {
  const token = bearer(request)
  if (!token) return Problem.ok({ ended: false })
  await accounts(env).backend.end({ id: token }).catch(() => {})
  return Problem.ok({ ended: true })
}

export async function holder(env: Cloudflare.Env, token: string): Promise<Address | undefined> {
  const session = await accounts(env).backend.get({ id: token })
  return session?.method === 'siwe' ? (session.address.toLowerCase() as Address) : undefined
}

export async function who(env: Cloudflare.Env, request: Request) {
  const token = bearer(request)
  return token ? holder(env, token) : undefined
}
