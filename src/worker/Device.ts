import { z } from 'zod'
import * as Site from '../shared/Site.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'
import * as Sessions from './Sessions.ts'

export const path = `${Sessions.path}/device`

export const page = '/cli/login'

export const lifeSeconds = 600

export const interval = 2

const letters = 'BCDFGHJKLMNPQRSTVWXZ'

type Held = { address?: string; device?: string; token?: string; user?: string }

export type Started = { device_code: string; expires_in: number; interval: number; user_code: string; verification_uri: string; verification_uri_complete: string }

export type Polled = { status: 'pending' } | { address: string; status: 'approved'; token: string }

const polling = z.object({ device_code: z.string().regex(/^[0-9a-f]{64}$/, 'device_code is the one POST /v1/auth/device answered.') })

const approving = z.object({ code: z.string().trim().min(1).max(32) })

function db(env: Cloudflare.Env) {
  return Replica.primary(env).DB
}

export function normal(code: string) {
  const plain = code.toUpperCase().replace(/[^A-Z]/g, '')
  return plain.length === 8 ? `${plain.slice(0, 4)}-${plain.slice(4)}` : undefined
}

function user() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return normal([...bytes].map((byte) => letters[byte % letters.length]).join(''))!
}

function device() {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function read(env: Cloudflare.Env, key: string): Promise<Held | undefined> {
  const row = await db(env).prepare('select value, expires_at from sessions where key = ?').bind(key).first<{ expires_at: number | null; value: string }>()
  return row && (row.expires_at ?? 0) > Date.now() ? (JSON.parse(row.value) as Held) : undefined
}

const expired = (): Problem.Result<never> => Problem.fail(410, 'gone', 'This sign-in code expired or was already used. Run swarms login again.')

export async function start(env: Cloudflare.Env, url: string): Promise<Problem.Result<Started>> {
  const [made, shown] = [device(), user()]
  const now = Date.now()
  const until = now + lifeSeconds * 1000
  const put = db(env).prepare('insert or replace into sessions (key, value, expires_at) values (?, ?, ?)')
  await db(env).batch([
    db(env).prepare("delete from sessions where key like 'cli:%' and expires_at < ?").bind(now),
    put.bind(`cli:device:${made}`, JSON.stringify({ user: shown } satisfies Held), until),
    put.bind(`cli:user:${shown}`, JSON.stringify({ device: made } satisfies Held), until),
  ])
  const site = Site.url(env, url)
  return Problem.ok({ device_code: made, expires_in: lifeSeconds, interval, user_code: shown, verification_uri: site + page, verification_uri_complete: `${site}${page}?code=${shown}` })
}

export async function poll(env: Cloudflare.Env, input: Record<string, unknown>): Promise<Problem.Result<Polled>> {
  const parsed = polling.safeParse(input)
  if (!parsed.success) return Problem.invalid(parsed.error)
  const key = `cli:device:${parsed.data.device_code}`
  const held = await read(env, key)
  if (!held) return expired()
  if (!held.token || !held.address) return Problem.ok({ status: 'pending' })
  const taken = await db(env).prepare('delete from sessions where key = ? returning value').bind(key).first<{ value: string }>()
  if (!taken) return expired()
  return Problem.ok({ address: held.address, status: 'approved', token: held.token })
}

export async function approve(env: Cloudflare.Env, input: Record<string, unknown>, request: Request): Promise<Problem.Result<{ address: string; approved: true }>> {
  const parsed = approving.safeParse(input)
  if (!parsed.success) return Problem.invalid(parsed.error)
  const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  const address = token ? await Sessions.holder(env, token) : undefined
  if (!token || !address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID on this page, then approve the code again.')
  const shown = normal(parsed.data.code)
  if (!shown) return Problem.fail(400, 'invalid_request', 'The code is 8 letters, such as BCDF-GHJK, as swarms login shows it.')
  const taken = await db(env).prepare('delete from sessions where key = ? and expires_at > ? returning value').bind(`cli:user:${shown}`, Date.now()).first<{ value: string }>()
  const made = taken ? (JSON.parse(taken.value) as Held).device : undefined
  if (!made) return expired()
  const key = `cli:device:${made}`
  const updated = await db(env)
    .prepare('update sessions set value = ? where key = ? and expires_at > ?')
    .bind(JSON.stringify({ address, token, user: shown } satisfies Held), key, Date.now())
    .run()
  if (!updated.meta.changes) return expired()
  return Problem.ok({ address, approved: true })
}
