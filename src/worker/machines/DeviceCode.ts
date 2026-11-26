import { z } from 'zod'
import { assert, never } from '../../shared/Assert.ts'
import * as Limits from '../../shared/Limits.ts'

export const version = 1

export type Live = { at: 'pending'; until: number; user: string } | { address: string; at: 'approved'; token: string; until: number; user: string }

export type Code = Live | { address: string; at: 'taken'; token: string } | { at: 'expired' }

export type Event = { address: string; now: number; token: string; type: 'approve' } | { now: number; type: 'poll' } | { now: number; type: 'take' }

export type Refusal = 'expired' | 'unapproved'

export type Step = { next: Code; ok: true } | { ok: false; refusal: Refusal }

export type Pointer = { device: string }

export type Stored = { address?: string; token?: string; user: string; v: typeof version }

export type StoredPointer = { device: string; v: typeof version }

type Row = { expires_at: number | null; value: string }

const half = Limits.Device.userLetters / 2

export const deviceShape = new RegExp(`^[0-9a-f]{${Limits.Device.deviceBytes * 2}}$`)

const userShape = new RegExp(`^[A-Z]{${half}}-[A-Z]{${half}}$`)

const record = z
  .object({ address: z.string().min(1).optional(), token: z.string().min(1).optional(), user: z.string().regex(userShape), v: z.literal(version).optional() })
  .loose()
  .refine((value) => (value.address === undefined) === (value.token === undefined), 'an approved code holds both its token and its address')

const pointer = z.object({ device: z.string().regex(deviceShape), v: z.literal(version).optional() }).loose()

function decode(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function held(value: string) {
  const parsed = record.safeParse(decode(value))
  if (parsed.success) return parsed.data
  console.error('Unreadable device code record, treated as expired', parsed.error.issues)
  return undefined
}

export function normal(code: string) {
  const plain = code.toUpperCase().replace(/[^A-Z]/g, '')
  return plain.length === Limits.Device.userLetters ? `${plain.slice(0, half)}-${plain.slice(half)}` : undefined
}

export function parse(row: Row | null, now: number): Code {
  if (!row || row.expires_at === null || row.expires_at <= now) return { at: 'expired' }
  const data = held(row.value)
  if (!data) return { at: 'expired' }
  const { address, token, user } = data
  return address !== undefined && token !== undefined ? { address, at: 'approved', token, until: row.expires_at, user } : { at: 'pending', until: row.expires_at, user }
}

export function taken(row: { value: string } | null): Code {
  const data = row ? held(row.value) : undefined
  return data?.address !== undefined && data.token !== undefined ? { address: data.address, at: 'taken', token: data.token } : { at: 'expired' }
}

export function point(row: { value: string } | null): Pointer | undefined {
  if (!row) return undefined
  const parsed = pointer.safeParse(decode(row.value))
  if (parsed.success) return { device: parsed.data.device }
  console.error('Unreadable device code pointer, treated as expired', parsed.error.issues)
  return undefined
}

export function issue(user: string, now: number): Live {
  assert(userShape.test(user), 'a user code is its letters in two halves', user)
  const until = now + Limits.Device.lifeSeconds * 1000
  assert(until > now, 'a device code expires after it is issued', { now, until })
  return { at: 'pending', until, user }
}

export function store(code: Live): Stored {
  switch (code.at) {
    case 'pending':
      return { user: code.user, v: version }
    case 'approved':
      return { address: code.address, token: code.token, user: code.user, v: version }
    default:
      return never(code, 'device code state')
  }
}

export function storePointer(device: string): StoredPointer {
  assert(deviceShape.test(device), 'a user code points at a device code', device)
  return { device, v: version }
}

function live(code: Code, now: number): Code {
  switch (code.at) {
    case 'pending':
    case 'approved':
      return code.until > now ? code : { at: 'expired' }
    case 'taken':
    case 'expired':
      return code
    default:
      return never(code, 'device code state')
  }
}

export function step(state: Code, event: Event): Step {
  const code = live(state, event.now)
  switch (event.type) {
    case 'approve':
      if (code.at !== 'pending') return { ok: false, refusal: 'expired' }
      assert(event.token.length > 0 && event.address.length > 0, 'approving needs a token and an address', event)
      return { next: { address: event.address, at: 'approved', token: event.token, until: code.until, user: code.user }, ok: true }
    case 'poll':
      return code.at === 'pending' || code.at === 'approved' ? { next: code, ok: true } : { ok: false, refusal: 'expired' }
    case 'take':
      if (code.at === 'approved') return { next: { address: code.address, at: 'taken', token: code.token }, ok: true }
      return { ok: false, refusal: code.at === 'pending' ? 'unapproved' : 'expired' }
    default:
      return never(event, 'device code event')
  }
}
