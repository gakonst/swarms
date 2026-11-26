import type { Lent, Terms } from '../shared/Api.ts'
import * as Gateway from './Gateway.ts'
import * as Machine from './machines/Hand.ts'
import type { Swarm } from './Swarm.ts'
import type * as Work from './Work.ts'
import * as Limits from '../shared/Limits.ts'

export type Row = { contributor: string | null; created_at: number; label: string; name: string; returned_at: number | null; seen_at: number | null; swarm: string }

export const limit = Limits.Hands.limit

export const unseenMs = Limits.Hands.unseenMs

const freshMs = Limits.Hands.freshMs

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

// A lent hand is a claim on the swarm's board: the task `hand:<name>`,
// labelled `hands: lent` and claimed with a cap of `limit` on that label, so
// the swarm's own locks and turns never take a hand's slot. It is leased for
// `unseenMs`, renewed each time the swarm sees the machine used. A lease that
// lapses is a stale hand, which no longer takes a slot; so is an open task, a
// hand adopted already stale. Returning a hand finishes its task, so a name is never issued twice.
// The D1 `hands` rows are the read model: written when the claim lands and
// when its task finishes.
export const slot = { hands: 'lent' }

export const cap: Work.Cap = { label: ['hands', slot.hands], max: limit }

function task(name: string) {
  return `hand:${name}`
}

function named(task: Work.Task) {
  return task.id.slice('hand:'.length)
}

// Every hand not yet returned, holding its slot or stale.
async function slots(board: Work.Board) {
  return (await board.tasks()).filter((found) => found.labels['hands'] === slot.hands && (found.phase === 'open' || found.phase === 'claimed'))
}

function holds(found: Work.Task, now: number) {
  return found.phase === 'claimed' && (found.untilMs ?? 0) > now
}

// Rows lent before hands were claims hold their slot as a claim whose lease
// runs from when the swarm last saw them; one already past it is stale.
async function adopt(board: Work.Board, rows: readonly Row[], now: number) {
  for (const row of rows) {
    if (row.returned_at !== null || (await board.task(task(row.name)))) continue
    const posted = await board.post({ id: task(row.name), labels: slot, spec: row.label })
    const left = (row.seen_at ?? row.created_at) + unseenMs - now
    if (posted.ok && left > 0) await board.claim(task(row.name), { leaseMs: left })
  }
}

const lives = new WeakMap<Swarm, string>()

const working = new WeakMap<Swarm, Set<string>>()

function busy(self: Swarm) {
  let names = working.get(self)
  if (!names) working.set(self, (names = new Set()))
  return names
}

async function guarded<T>(self: Swarm, name: string, work: () => Promise<T>) {
  busy(self).add(name)
  try {
    return await work()
  } finally {
    busy(self).delete(name)
  }
}

function life(self: Swarm) {
  let one = lives.get(self)
  if (!one) lives.set(self, (one = crypto.randomUUID()))
  return one
}

function record(self: Swarm, name: string) {
  return Machine.machine.read(self.kv.get(Machine.key(name)))
}

function step(self: Swarm, name: string, event: Machine.HandEvent) {
  const stepped = Machine.machine.step(record(self, name), event)
  if (stepped.ok) self.kv.put(Machine.key(name), stepped.state)
  return stepped
}

function revoke(self: Swarm, name: string, by: 'evicted' | 'failed' | 'owner') {
  if (!record(self, name)) self.kv.put(Machine.key(name), Machine.legacy(life(self), Date.now()))
  return step(self, name, { at: Date.now(), by, kind: 'revoke', life: life(self) })
}

function retired(self: Swarm, name: string, by: 'evicted' | 'failed' | 'owner') {
  const stepped = step(self, name, { at: Date.now(), kind: 'return' })
  if (by !== 'owner') return stepped
  self.kv.put('removed', [...new Set([...(self.kv.get<string[]>('removed') ?? []), name])])
  self.kv.put(
    'hands',
    (self.kv.get<{ name: string }[]>('hands') ?? []).filter((hand) => hand.name !== name),
  )
  return stepped
}

async function retire(self: Swarm, swarm: string, name: string, by: 'evicted' | 'failed' | 'owner', resumed: boolean) {
  const revoked = await Gateway.detach(self.env, swarm, name).catch((error: unknown) => ({ detail: String(error), ok: false as const, status: 503 }))
  if (!revoked.ok && revoked.status !== 404) {
    if (by === 'owner' && !resumed) step(self, name, { at: Date.now(), kind: 'kept' })
    return revoked
  }
  await free(self, swarm, name)
  if (by === 'owner') await self.env.DB.prepare('delete from hands where swarm = ? and name = ? and returned_at is not null').bind(swarm, name).run()
  retired(self, name, by)
  return { ok: true as const }
}

export async function repair(self: Swarm, swarm: string) {
  for (const [key, raw] of [...self.kv.list({ prefix: 'lent:' })]) {
    const at = Machine.machine.read(raw)
    const name = key.slice('lent:'.length)
    if (!at || !Machine.machine.unfinished(at, busy(self).has(name))) continue
    const by = at.state === 'issued' ? 'failed' : (at.by ?? 'failed')
    await guarded(self, name, async () => {
      revoke(self, name, by)
      await retire(self, swarm, name, by, at.state === 'revoking')
    })
  }
}

export type Issued =
  | { minted: Gateway.Minted; name: string; ok: true }
  | { ok: false; reason: 'full' | 'unnamed' }
  | { detail: string; ok: false; reason: 'upstream' }

export async function issue(self: Swarm, swarm: string, label: string, contributor: string | null): Promise<Issued> {
  const board = self.board
  await repair(self, swarm)
  const all = await list(self.env, swarm)
  const rows = all.filter((row) => row.returned_at === null)
  await adopt(board, rows, Date.now())
  const listed = (await slots(board)).length ? await listing(self.env, swarm) : []
  await seen(self, swarm, rows, listed)
  const now = Date.now()
  const evicted = await evictable(board, listed, now)
  const holding = (await slots(board)).filter((found) => holds(found, now))
  if (holding.length - holding.filter((found) => evicted.includes(named(found))).length >= limit) return { ok: false, reason: 'full' }
  for (const name of evicted)
    await guarded(self, name, async () => {
      revoke(self, name, 'evicted')
      await retire(self, swarm, name, 'evicted', false)
    })

  for (let attempt = 0; attempt < Limits.Hands.nameTries; attempt++) {
    if ((await slots(board)).filter((found) => holds(found, Date.now())).length >= limit) return { ok: false, reason: 'full' }
    const name = `${slug(label)}-${suffix()}`
    // A name returned before hands moved onto the swarm's board has no task here, only its row.
    if (all.some((row) => row.name === name)) continue
    const tried = await guarded(self, name, () => mint(self, swarm, name, label, contributor))
    if (tried !== 'again') return tried
  }
  return { ok: false, reason: 'unnamed' }
}

async function mint(self: Swarm, swarm: string, name: string, label: string, contributor: string | null): Promise<Issued | 'again'> {
  const board = self.board
  const posted = await board.post({ id: task(name), labels: slot, spec: label })
  if (!posted.ok) return 'again'
  const claimed = await board.claim(task(name), { cap, leaseMs: unseenMs })
  if (!claimed.ok) return { ok: false, reason: 'full' }
  step(self, name, { at: Date.now(), kind: 'issue', life: life(self) })
  await self.env.DB.prepare('insert or ignore into hands (swarm, name, label, contributor, created_at) values (?, ?, ?, ?, ?)')
    .bind(swarm, name, label, contributor, Date.now())
    .run()
  const minted = await self.hand(swarm, name)
  if (minted.ok) {
    step(self, name, { at: Date.now(), kind: 'mint' })
    return { minted: minted.value, name, ok: true }
  }
  await board.finish(task(name), claimed.claim, { failed: minted.detail })
  await self.env.DB.prepare('delete from hands where swarm = ? and name = ? and seen_at is null and returned_at is null').bind(swarm, name).run()
  retired(self, name, 'failed')
  return minted.status === 409 ? 'again' : { detail: minted.detail, ok: false, reason: 'upstream' }
}

export type Removed = { ok: true } | { ok: false; reason: 'missing' } | { detail: string; ok: false; reason: 'upstream' }

export async function remove(self: Swarm, swarm: string, name: string): Promise<Removed> {
  await repair(self, swarm)
  if (record(self, name)?.state === 'returned' && record(self, name)?.by === 'owner') return { ok: false, reason: 'missing' }
  const [rows, listed] = await Promise.all([list(self.env, swarm), listing(self.env, swarm)])
  if (!rows.some((row) => row.name === name) && !listed?.some((hand) => hand.name === name)) return { ok: false, reason: 'missing' }
  const retired = await guarded(self, name, async () => {
    const resumed = record(self, name)?.state === 'revoking'
    revoke(self, name, 'owner')
    return retire(self, swarm, name, 'owner', resumed)
  })
  return retired.ok ? { ok: true } : { detail: retired.detail, ok: false, reason: 'upstream' }
}

export async function listing(env: Cloudflare.Env, swarm: string) {
  const listed = await Gateway.hands(env, swarm)
  return listed.ok ? listed.value.hands : undefined
}

export async function list(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare('select * from hands where swarm = ? order by created_at desc')
    .bind(swarm)
    .all<Row>()
  return results
}

// Return a hand: its D1 row first, then its task, so a write that fails
// leaves the claim held and the next issue returns it again.
export async function free(self: Swarm, swarm: string, name: string) {
  const board = self.board
  const found = await board.task(task(name))
  await self.env.DB.batch([
    self.env.DB.prepare('delete from hands where swarm = ? and name = ? and seen_at is null').bind(swarm, name),
    self.env.DB.prepare('update hands set returned_at = ? where swarm = ? and name = ? and returned_at is null').bind(Date.now(), swarm, name),
  ])
  const claim = found?.phase === 'open' ? await board.claim(found.id, { leaseMs: unseenMs }) : undefined
  const holder = claim?.ok ? claim.claim : found?.phase === 'claimed' ? found.claim : undefined
  if (found && holder) await board.finish(found.id, holder, { done: 'returned' })
}

export function used(hand: Gateway.Listed | undefined) {
  return !!hand && (hand.connected || (typeof hand['requests'] === 'number' && hand['requests'] > 0))
}

// The swarm saw these hands used: renew their claims and mark their rows.
export async function seen(self: Swarm, swarm: string, rows: readonly Row[], listed: readonly Gateway.Listed[] | undefined) {
  const board = self.board
  const now = Date.now()
  await adopt(board, rows, now)
  for (const row of rows) {
    const at = record(self, row.name)
    const found = row.returned_at === null && (!at || at.state === 'minted') && used(listed?.find((hand) => hand.name === row.name)) ? await board.task(task(row.name)) : null
    if (found?.phase === 'claimed' && found.claim) await board.renew(found.id, found.claim, unseenMs)
    else if (found?.phase === 'open') await board.claim(found.id, { leaseMs: unseenMs })
  }
  const names = rows
    .filter((row) => (row.seen_at === null || row.seen_at < now - freshMs) && used(listed?.find((hand) => hand.name === row.name)))
    .map((row) => row.name)
  if (!names.length) return rows
  await self.env.DB.batch(names.map((name) => self.env.DB.prepare('update hands set seen_at = ? where swarm = ? and name = ? and returned_at is null').bind(now, swarm, name)))
  return rows.map((row) => (names.includes(row.name) ? { ...row, seen_at: now } : row))
}

// Hands to return before issuing one: every idle hand whose lease lapsed, and
// while the claims still fill the cap, the idle ones seen longest ago.
export async function evictable(board: Work.Board, listed: readonly Gateway.Listed[] | undefined, now: number) {
  if (!listed) return []
  const all = await slots(board)
  const idle = all.filter((found) => !listed.find((hand) => hand.name === named(found))?.connected)
  const stale = idle.filter((found) => !holds(found, now))
  const holding = all.filter((found) => holds(found, now)).length
  if (holding < limit) return stale.map(named)
  const spare = idle.filter((found) => !stale.includes(found)).sort((a, b) => (a.untilMs ?? 0) - (b.untilMs ?? 0))
  return [...stale, ...spare.slice(0, holding - limit + 1)].map(named)
}

export const share = 5n

const symbols: Record<string, string> = { ousd: 'OUSD', usdce: 'USDC.e' }

export function terms(listed: Gateway.Listed | undefined): Terms {
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

export function lent(rows: readonly Row[], listed: readonly Gateway.Listed[] | undefined): Lent[] {
  return rows.map((row) => {
    const found = listed?.find((hand) => hand.name === row.name)
    return { at: row.created_at, connected: !!found?.connected, label: row.label, name: row.name, ...terms(found) }
  })
}
