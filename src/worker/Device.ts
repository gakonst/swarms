import { z } from 'zod'
import * as Site from '../shared/Site.ts'
import { assert } from '../shared/Assert.ts'
import * as Machine from './machines/DeviceCode.ts'
import * as Problem from './Problem.ts'
import * as Replica from './Replica.ts'
import * as Sessions from './Sessions.ts'
import * as Limits from '../shared/Limits.ts'

export const path = `${Sessions.path}/device`

export const page = '/cli/login'

export const lifeSeconds = Limits.Device.lifeSeconds

export const interval = Limits.Device.interval

const letters = 'BCDFGHJKLMNPQRSTVWXZ'

export type Started = { device_code: string; expires_in: number; interval: number; user_code: string; verification_uri: string; verification_uri_complete: string }

export type Polled = { status: 'pending' } | { address: string; status: 'approved'; token: string }

const polling = z.object({ device_code: z.string().regex(Machine.deviceShape, 'device_code is the one POST /v1/auth/device answered.') })

const approving = z.object({ code: z.string().trim().min(1).max(Limits.Device.codeMost) })

function db(env: Cloudflare.Env) {
  return Replica.primary(env).DB
}

export const normal = Machine.normal

function user() {
  const bytes = crypto.getRandomValues(new Uint8Array(Limits.Device.userLetters))
  const shown = normal([...bytes].map((byte) => letters[byte % letters.length]).join(''))
  assert(shown, 'a drawn user code has its full length', bytes.length)
  return shown
}

function device() {
  return [...crypto.getRandomValues(new Uint8Array(Limits.Device.deviceBytes))].map((byte) => byte.toString(Limits.Hex.radix).padStart(2, '0')).join('')
}

async function read(env: Cloudflare.Env, key: string): Promise<Machine.Code> {
  const row = await db(env).prepare('select value, expires_at from sessions where key = ?').bind(key).first<{ expires_at: number | null; value: string }>()
  return Machine.parse(row, Date.now())
}

const expired = (): Problem.Result<never> => Problem.fail(Limits.Http.gone, 'gone', 'This sign-in code expired or was already used. Run swarms login again.')

export async function start(env: Cloudflare.Env, url: string): Promise<Problem.Result<Started>> {
  const [made, shown] = [device(), user()]
  const now = Date.now()
  const code = Machine.issue(shown, now)
  const put = db(env).prepare('insert or replace into sessions (key, value, expires_at) values (?, ?, ?)')
  await db(env).batch([
    db(env).prepare("delete from sessions where key like 'cli:%' and expires_at < ?").bind(now),
    put.bind(`cli:device:${made}`, JSON.stringify(Machine.store(code)), code.until),
    put.bind(`cli:user:${shown}`, JSON.stringify(Machine.storePointer(made)), code.until),
  ])
  const site = Site.url(env, url)
  return Problem.ok({ device_code: made, expires_in: lifeSeconds, interval, user_code: shown, verification_uri: site + page, verification_uri_complete: `${site}${page}?code=${shown}` })
}

export async function poll(env: Cloudflare.Env, input: Record<string, unknown>): Promise<Problem.Result<Polled>> {
  const parsed = polling.safeParse(input)
  if (!parsed.success) return Problem.invalid(parsed.error)
  const key = `cli:device:${parsed.data.device_code}`
  const held = await read(env, key)
  const polled = Machine.step(held, { now: Date.now(), type: 'poll' })
  if (!polled.ok) return expired()
  if (polled.next.at === 'pending') return Problem.ok({ status: 'pending' })
  const taken = Machine.taken(await db(env).prepare('delete from sessions where key = ? returning value').bind(key).first<{ value: string }>())
  if (taken.at !== 'taken') return expired()
  assert(taken.token.length > 0 && taken.address.length > 0, 'a taken code answers its token and address', taken.at)
  return Problem.ok({ address: taken.address, status: 'approved', token: taken.token })
}

export async function approve(env: Cloudflare.Env, input: Record<string, unknown>, request: Request): Promise<Problem.Result<{ address: string; approved: true }>> {
  const parsed = approving.safeParse(input)
  if (!parsed.success) return Problem.invalid(parsed.error)
  const token = Sessions.bearer(request)
  const address = token ? await Sessions.holder(env, token) : undefined
  if (!token || !address) return Problem.fail(Limits.Http.unauthorized, 'unauthorized', 'Sign in with Tempo ID on this page, then approve the code again.')
  const shown = normal(parsed.data.code)
  if (!shown) return Problem.fail(Limits.Http.invalid, 'invalid_request', 'The code is 8 letters, such as BCDF-GHJK, as swarms login shows it.')
  const pointed = Machine.point(await db(env).prepare('delete from sessions where key = ? and expires_at > ? returning value').bind(`cli:user:${shown}`, Date.now()).first<{ value: string }>())
  if (!pointed) return expired()
  const key = `cli:device:${pointed.device}`
  const approved = Machine.step(await read(env, key), { address, now: Date.now(), token, type: 'approve' })
  if (!approved.ok || approved.next.at !== 'approved') return expired()
  const updated = await db(env).prepare('update sessions set value = ? where key = ? and expires_at > ?').bind(JSON.stringify(Machine.store(approved.next)), key, Date.now()).run()
  if (!updated.meta.changes) return expired()
  return Problem.ok({ address, approved: true })
}
