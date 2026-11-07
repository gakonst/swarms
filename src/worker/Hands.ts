import type { Lent, Terms } from '../shared/Api.ts'
import type { Listed } from './Gateway.ts'

export type Row = { contributor: string | null; created_at: number; label: string; name: string; seen_at: number | null; swarm: string }

export const limit = 32

export const unseenMs = 86_400_000

const freshMs = 3_600_000

export function slug(label: string) {
  const cleaned = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return cleaned || 'hand'
}

function suffix() {
  return Array.from(crypto.getRandomValues(new Uint8Array(3)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function issue(env: Cloudflare.Env, swarm: string, label: string, contributor: string | null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const name = `${slug(label)}-${suffix()}`
    const result = await env.DB.prepare('insert or ignore into hands (swarm, name, label, contributor, created_at) values (?, ?, ?, ?, ?)')
      .bind(swarm, name, label, contributor, Date.now())
      .run()
    if (result.meta.changes > 0) return name
  }
  return undefined
}

export async function list(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare('select * from hands where swarm = ? order by created_at desc')
    .bind(swarm)
    .all<Row>()
  return results
}

export async function forget(env: Cloudflare.Env, swarm: string, name: string) {
  await env.DB.prepare('delete from hands where swarm = ? and name = ?').bind(swarm, name).run()
}

export function used(hand: Listed | undefined) {
  return !!hand && (hand.connected || (typeof hand['requests'] === 'number' && hand['requests'] > 0))
}

export async function seen(env: Cloudflare.Env, swarm: string, rows: readonly Row[], listed: readonly Listed[]) {
  const now = Date.now()
  const names = rows
    .filter((row) => (row.seen_at === null || row.seen_at < now - freshMs) && used(listed.find((hand) => hand.name === row.name)))
    .map((row) => row.name)
  if (!names.length) return rows
  await env.DB.batch(names.map((name) => env.DB.prepare('update hands set seen_at = ? where swarm = ? and name = ?').bind(now, swarm, name)))
  return rows.map((row) => (names.includes(row.name) ? { ...row, seen_at: now } : row))
}

export function evictable(rows: readonly Row[], listed: readonly Listed[], now: number) {
  const idle = rows.filter((row) => !listed.find((hand) => hand.name === row.name)?.connected)
  const stale = idle.filter((row) => (row.seen_at ?? row.created_at) < now - unseenMs)
  if (rows.length - stale.length < limit) return stale
  const spare = idle.filter((row) => !stale.includes(row)).sort((a, b) => (a.seen_at ?? 0) - (b.seen_at ?? 0) || a.created_at - b.created_at)
  return [...stale, ...spare.slice(0, rows.length - stale.length - limit + 1)]
}

export const share = 5n

const symbols: Record<string, string> = { ousd: 'OUSD', usdce: 'USDC.e' }

export function terms(listed: Listed | undefined): Terms {
  const pricing = listed?.['pricing'] as { currency?: unknown; describe?: unknown; payee?: unknown } | null | undefined
  const charges = listed?.['charges'] as { count?: unknown; usd?: unknown } | null | undefined
  const channels = Array.isArray(listed?.['channels']) ? (listed['channels'] as { accepted?: unknown; settled?: unknown }[]) : []
  const earned = listed?.['earned']
  const paid = listed?.['paid']
  const count = typeof charges?.count === 'number' ? charges.count : 0
  const sum = (field: 'accepted' | 'settled') => channels.reduce((total, channel) => total + (typeof channel[field] === 'number' ? channel[field] : 0), 0)
  const currency = typeof pricing?.currency === 'string' ? symbols[pricing.currency] : undefined
  return {
    channels: channels.length
      ? `${usd(sum('accepted'))} paid straight to its owner over ${channels.length} channel${channels.length === 1 ? '' : 's'}, ${usd(sum('settled'))} settled on Tempo`
      : null,
    charged: count ? `${usd(charges?.usd)} for ${count} operation${count === 1 ? '' : 's'}` : null,
    earned: typeof earned === 'number' && earned > 0 ? `${usd(earned)}${typeof paid === 'number' ? `, ${usd(paid)} paid out` : ''}` : null,
    price: pricing
      ? `${typeof pricing.describe === 'string' && pricing.describe ? pricing.describe : 'priced by its owner'}${typeof pricing.payee === 'string' ? ` (paid to ${pricing.payee.slice(0, 6)}…${pricing.payee.slice(-4)}${currency ? ` in ${currency}` : ''})` : ''}`
      : null,
    requests: typeof listed?.['requests'] === 'number' ? listed['requests'] : 0,
  }
}

function usd(value: unknown) {
  return '$' + (typeof value === 'number' ? Number(value.toFixed(6)) : 0)
}

export function lent(rows: readonly Row[], listed: readonly Listed[]): Lent[] {
  return rows.map((row) => {
    const found = listed.find((hand) => hand.name === row.name)
    return { at: row.created_at, connected: !!found?.connected, label: row.label, name: row.name, ...terms(found) }
  })
}
