export type Kind = 'fund' | 'move' | 'pledge' | 'steer'

export type Payment =
  | { at: 'owed'; id: string; tries: number }
  | { at: 'paying'; id: string; resumed: boolean; tries: number; until: number }
  | { at: 'paid'; id: string; landed: boolean }
  | { at: 'refused'; id: string; why: string }

export type Event =
  | { now: number; type: 'pay' }
  | { type: 'landed' }
  | { type: 'found' }
  | { type: 'short'; why: string }
  | { type: 'lost' }
  | { now: number; type: 'expired' }

export type Transfer =
  | { at: 'seen'; hash: string }
  | { amount: bigint; at: 'credited'; from: string; hash: string }
  | { amount: bigint; at: 'counted'; first: boolean; from: string; hash: string }
  | { at: 'announced'; hash: string }
  | { at: 'refused'; hash: string; why: string }

export type Delivery =
  | { amount: bigint; from: string; type: 'credited' }
  | { type: 'uncredited'; why: string }
  | { type: 'gave' }
  | { type: 'held' }
  | { type: 'told' }

export type Kv = { delete(key: string): unknown; get<T>(key: string): T | undefined; put(key: string, value: unknown): void }

export const version = 1

export const limits = { payingMs: 30_000 }

export const guards = { closed: true, fenced: true, keyed: true, told: true }

export class Busy extends Error {
  override name = 'Busy'
}

export function step(payment: Payment, event: Event): Payment | null {
  switch (event.type) {
    case 'pay':
      if (payment.at === 'owed') return { at: 'paying', id: payment.id, resumed: payment.tries > 0, tries: payment.tries + 1, until: event.now + limits.payingMs }
      if (payment.at === 'paying') return { at: 'paying', id: payment.id, resumed: true, tries: payment.tries + 1, until: event.now + limits.payingMs }
      return null
    case 'landed':
      return payment.at === 'paying' ? { at: 'paid', id: payment.id, landed: true } : null
    case 'found':
      return payment.at === 'paying' ? { at: 'paid', id: payment.id, landed: false } : null
    case 'short':
      return payment.at === 'paying' ? { at: 'refused', id: payment.id, why: event.why } : null
    case 'lost':
      return payment.at === 'paying' ? { at: 'owed', id: payment.id, tries: payment.tries } : null
    case 'expired':
      return payment.at === 'paying' && event.now >= payment.until ? { at: 'owed', id: payment.id, tries: payment.tries } : null
  }
}

export function transfer(state: Transfer, delivery: Delivery): Transfer | null {
  switch (delivery.type) {
    case 'credited':
      return state.at === 'seen' ? { amount: delivery.amount, at: 'credited', from: delivery.from.toLowerCase(), hash: state.hash } : null
    case 'uncredited':
      return state.at === 'seen' ? { at: 'refused', hash: state.hash, why: delivery.why } : null
    case 'gave':
      return state.at === 'credited' ? { ...state, at: 'counted', first: true } : null
    case 'held':
      return state.at === 'credited' ? { ...state, at: 'counted', first: false } : null
    case 'told':
      return state.at === 'counted' ? { at: 'announced', hash: state.hash } : null
  }
}

export function id(kind: Kind, scope: string, contributor: string, key: string | null | undefined) {
  const suffix = guards.keyed && key ? 'k' + key : crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  return kind + ':' + scope + ':' + contributor.toLowerCase() + ':' + suffix
}

type Record = { at: 'owed' | 'paying'; tries: number; until: number; v: number }

function slot(payment: string) {
  return 'pay:' + payment
}

function read(kv: Kv, payment: string): Payment | null {
  const held = kv.get<Record>(slot(payment))
  if (!held || typeof held !== 'object') return null
  const tries = typeof held.tries === 'number' ? held.tries : 1
  return { at: 'paying', id: payment, resumed: true, tries, until: typeof held.until === 'number' ? held.until : 0 }
}

function keep(kv: Kv, payment: Payment) {
  if (payment.at === 'owed' || payment.at === 'paying') kv.put(slot(payment.id), { at: payment.at, tries: payment.tries, until: payment.at === 'paying' ? payment.until : 0, v: version } satisfies Record)
  else kv.delete(slot(payment.id))
}

export function open(kv: Kv, payment: string) {
  return read(kv, payment) !== null
}

export function close(kv: Kv, payment: string) {
  kv.delete(slot(payment))
  const done = 'paid:' + payment
  if (guards.closed && kv.get(done) !== undefined) return false
  kv.put(done, { v: version })
  return true
}

export async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Busy(what + ' took longer than ' + ms + ' ms')), ms)))])
  } finally {
    clearTimeout(timer)
  }
}

export type Io = { write: () => Promise<boolean>; written: () => Promise<boolean> }

export async function settle(kv: Kv, payment: string, io: Io, effects: () => void, now = Date.now()): Promise<Payment & { at: 'paid' | 'refused' }> {
  const paying = step(read(kv, payment) ?? { at: 'owed', id: payment, tries: 0 }, { now, type: 'pay' })
  if (paying?.at !== 'paying') return { at: 'refused', id: payment, why: 'not owed' }
  keep(kv, paying)
  let wrote: boolean
  try {
    wrote = await within(io.write(), limits.payingMs, 'A ledger write')
  } catch (error) {
    const owed = step(paying, { type: 'lost' })
    if (owed && kv.get(slot(payment)) !== undefined) keep(kv, owed)
    throw error
  }
  const found = wrote ? false : await within(io.written(), limits.payingMs, 'A ledger read')
  const done = step(paying, wrote ? { type: 'landed' } : found ? { type: 'found' } : { type: 'short', why: 'not covered' }) as Payment & { at: 'paid' | 'refused' }
  if (done.at === 'refused') {
    kv.delete(slot(payment))
    return done
  }
  if (close(kv, payment)) effects()
  return done
}

export function once(kv: Kv, key: string, effects: () => void) {
  if (guards.told && kv.get(key) !== undefined) return false
  effects()
  kv.put(key, { at: Date.now(), v: version })
  return true
}

export type Audit = { held: bigint; negative: { contributor: string; node: string; run: string | null }[]; pledged: bigint; spent: bigint }

export function audit(rows: readonly { amount: bigint; contributor: string; kind: string; node: string; run: string | null }[]): Audit {
  const buckets = new Map<string, { amount: bigint; contributor: string; node: string; run: string | null }>()
  let held = 0n
  let pledged = 0n
  let spent = 0n
  for (const row of rows) {
    held += row.amount
    if (row.kind === 'pledge') pledged += row.amount
    if (row.kind === 'spend') spent -= row.amount
    const key = row.node + '\u0000' + (row.run ?? '') + '\u0000' + row.contributor
    const bucket = buckets.get(key) ?? { amount: 0n, contributor: row.contributor, node: row.node, run: row.run }
    bucket.amount += row.amount
    buckets.set(key, bucket)
  }
  const negative = [...buckets.values()].filter((bucket) => bucket.amount < 0n).map(({ contributor, node, run }) => ({ contributor, node, run }))
  return { held, negative, pledged, spent }
}

export function balanced(found: Audit) {
  return found.negative.length === 0 && found.held === found.pledged - found.spent
}
