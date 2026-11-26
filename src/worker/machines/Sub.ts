
import * as Memo from '../../shared/Memo.ts'
import * as Flow from '../Flow.ts'
import type * as Gateway from '../Gateway.ts'
import type { Kv } from './Tree.ts'
import * as Assert from '../../shared/Assert.ts'

export const version = 1

export const guards = { monotonic: true }

export type Seen = { spent: string; sub: Gateway.Subagent; v: typeof version }

const ended = new Set(['completed', 'failed', 'closed', 'interrupted', 'stopped'])

export function rank(state: string | undefined) {
  if (state === undefined || state === 'unknown') return 0
  return ended.has(state) ? 2 : 1
}

export function key(agent: string, sub: number) {
  return 'seen:' + agent + ':' + sub
}

export function read(raw: unknown): Seen | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const kept = raw as Partial<Seen>
  if (kept.v !== version || typeof kept.spent !== 'string' || !kept.sub || typeof kept.sub.status?.state !== 'string') return undefined
  return kept as Seen
}

export function step(at: Seen | undefined, read: Gateway.Subagent): Seen {
  const spent = Flow.micro(read.spent_usd)
  if (!at || !guards.monotonic) return { spent: Memo.decimal(spent), sub: read, v: version }
  const was = Memo.units(at.spent)
  const before = rank(at.sub.status.state)
  const now = rank(read.status.state)
  const newer = now > before || (now === before && before < 2 && spent >= was)
  const next: Seen = { spent: Memo.decimal(spent > was ? spent : was), sub: newer ? read : at.sub, v: version }
  Assert.assert(rank(next.sub.status.state) >= before && Memo.units(next.spent) >= was, 'A subagent never goes back.', { at, next })
  return next
}

export function get(kv: Kv, agent: string, sub: number) {
  return read(kv.get(key(agent, sub)))
}

export function observe(kv: Kv, agent: string, read: Gateway.Subagent) {
  const next = step(get(kv, agent, read.agent_id), read)
  kv.put(key(agent, read.agent_id), next)
  return next
}

export function view(seen: Seen): Gateway.Subagent {
  return { ...seen.sub, spent_usd: Flow.number(Memo.units(seen.spent)) }
}

export function spent(seen: Seen | undefined) {
  return seen ? Memo.units(seen.spent) : 0n
}

export function done(seen: Seen | undefined) {
  return rank(seen?.sub.status.state) === 2
}

export function seed(kv: Kv, agent: string, sub: number, role: string) {
  if (get(kv, agent, sub)) return
  kv.put(key(agent, sub), { spent: Memo.decimal(0n), sub: { agent_id: sub, parent_agent_id: null, role, status: { state: 'unknown' }, task: '' }, v: version } satisfies Seen)
}
