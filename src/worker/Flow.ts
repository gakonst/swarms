import * as Memo from '../shared/Memo.ts'
import * as Limits from '../shared/Limits.ts'

export type Kind = 'pledge' | 'grant' | 'commit' | 'spend' | 'settle' | 'return' | 'move'

export type Bucket = { node: string; run: string | null }

export type Part = readonly [contributor: string, amount: bigint]

export type Row = { amount: bigint; contributor: string; first: number; kind: Kind; last: number; node: string; peer: string | null; run: string | null }

export const free = ''

export const guards = { covered: true }

export async function write(env: Cloudflare.Env, input: { at?: number; from: Bucket | null; id: string; kind: Kind; parts: readonly Part[]; swarm: string; to: Bucket | null }) {
  const merged = new Map<string, bigint>()
  for (const [contributor, amount] of input.parts) if (amount > 0n) merged.set(contributor.toLowerCase(), (merged.get(contributor.toLowerCase()) ?? 0n) + amount)
  const parts = [...merged].map(([contributor, amount]) => [contributor, String(amount)])
  if (!parts.length) return false
  const result = await env.DB.prepare(
    `with parts as (
      select json_extract(value, '$[0]') as contributor, cast(json_extract(value, '$[1]') as integer) as amount from json_each(?1)
    ), legs as (
      select -1 as sign, ?5 as node, ?6 as run, ?7 as peer, 'out' as leg where ?5 is not null
      union all
      select 1, ?7, ?8, ?5, 'in' where ?7 is not null
    ), covered as (
      select count(*) as n from parts p
      where p.amount <= (select coalesce(sum(f.amount), 0) from flows f where f.swarm = ?2 and f.node = ?5 and f.run is ?6 and f.contributor = p.contributor)
    )
    insert into flows (id, swarm, node, run, contributor, amount, kind, peer, created_at)
    select ?2 || ':' || ?3 || ':' || p.contributor || ':' || l.leg, ?2, l.node, l.run, p.contributor, l.sign * p.amount, ?4, l.peer, ?9
    from parts p, legs l
    where ?5 is null or ?10 = 0 or (select n from covered) = (select count(*) from parts)
    on conflict (id) do nothing`,
  )
    .bind(JSON.stringify(parts), input.swarm, input.id, input.kind, input.from?.node ?? null, input.from?.run ?? null, input.to?.node ?? null, input.to?.run ?? null, input.at ?? Date.now(), guards.covered ? 1 : 0)
    .run()
  return result.meta.changes > 0
}

export async function written(env: Cloudflare.Env, swarm: string, id: string) {
  return !!(await env.DB.prepare("select 1 from flows where id > ?1 || ':' and id < ?1 || ';' limit 1").bind(`${swarm}:${id}`).first())
}

export async function rows(env: Cloudflare.Env, swarm: string): Promise<Row[]> {
  const { results } = await env.DB.prepare(
    'select node, run, contributor, kind, peer, sum(amount) as amount, min(created_at) as first, max(created_at) as last from flows where swarm = ? group by node, run, contributor, kind, peer',
  )
    .bind(swarm)
    .all<{ amount: number; contributor: string; first: number; kind: Kind; last: number; node: string; peer: string | null; run: string | null }>()
  return results.map((row) => ({ ...row, amount: BigInt(row.amount) }))
}

export async function spends(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare("select created_at as at, -sum(amount) as amount from flows where swarm = ? and kind = 'spend' group by created_at order by created_at")
    .bind(swarm)
    .all<{ amount: number; at: number }>()
  return results.map((row) => ({ amount: BigInt(row.amount), at: row.at }))
}

export function shares(rows: readonly Row[], bucket: Bucket) {
  const found = new Map<string, bigint>()
  for (const row of rows) if (row.node === bucket.node && row.run === bucket.run) found.set(row.contributor, (found.get(row.contributor) ?? 0n) + row.amount)
  for (const [contributor, amount] of found) if (amount <= 0n) found.delete(contributor)
  return found
}

export function sum(values: Iterable<bigint>) {
  let total = 0n
  for (const value of values) total += value
  return total
}

export function split(held: ReadonlyMap<string, bigint>, amount: bigint): Part[] {
  const positive = [...held].filter(([, value]) => value > 0n).sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : a[0] < b[0] ? -1 : 1))
  const total = sum(positive.map(([, value]) => value))
  const want = amount > total ? total : amount
  if (want <= 0n || total === 0n) return []
  const parts = positive.map(([contributor, value]) => [contributor, (want * value) / total] as [string, bigint])
  let rest = want - sum(parts.map(([, value]) => value))
  for (const part of parts) {
    if (rest === 0n) break
    const room = (held.get(part[0]) ?? 0n) - part[1]
    const add = room < rest ? room : rest
    part[1] += add
    rest -= add
  }
  return parts.filter(([, value]) => value > 0n)
}

export type Ledger = {
  committed: Map<string, bigint>
  funders: Map<string, Map<string, { amount: bigint; since: number }>>
  granted: Map<string, bigint>
  inherited: Map<string, bigint>
  left: Map<string, bigint>
  pledged: Map<string, bigint>
  runs: Map<string, bigint>
  spent: Map<string, bigint>
}

function add(map: Map<string, bigint>, key: string, amount: bigint) {
  map.set(key, (map.get(key) ?? 0n) + amount)
}

export function runNode(run: string) {
  const parts = run.split(':')
  return parts[1] ?? ''
}

export function fold(rows: readonly Row[]): Ledger {
  const ledger: Ledger = { committed: new Map(), funders: new Map(), granted: new Map(), inherited: new Map(), left: new Map(), pledged: new Map(), runs: new Map(), spent: new Map() }
  for (const row of rows) {
    if (row.run !== null) {
      add(ledger.runs, row.run, row.amount)
      if (row.kind === 'spend') add(ledger.spent, row.node, -row.amount)
      continue
    }
    add(ledger.left, row.node, row.amount)
    if (row.kind === 'spend') add(ledger.spent, row.node, -row.amount)
    const own = row.kind === 'pledge' || row.kind === 'move' || (row.kind === 'return' && row.amount < 0n && row.peer === free)
    if (own) {
      add(ledger.pledged, row.node, row.amount)
      const funders = ledger.funders.get(row.node) ?? new Map<string, { amount: bigint; since: number }>()
      const held = funders.get(row.contributor) ?? { amount: 0n, since: row.first }
      funders.set(row.contributor, { amount: held.amount + row.amount, since: Math.min(held.since, row.amount > 0n ? row.first : held.since) })
      ledger.funders.set(row.node, funders)
    }
    if (row.kind === 'grant' && row.amount > 0n) add(ledger.inherited, row.node, row.amount)
    if (row.kind === 'grant' && row.amount < 0n) add(ledger.granted, row.node, -row.amount)
    if (row.kind === 'return' && row.amount < 0n && row.peer !== free) add(ledger.inherited, row.node, row.amount)
    if (row.kind === 'return' && row.amount > 0n && row.node !== free) add(ledger.granted, row.node, -row.amount)
  }
  for (const [run, amount] of ledger.runs) add(ledger.committed, runNode(run), amount)
  for (const funders of ledger.funders.values()) for (const [contributor, held] of funders) if (held.amount <= 0n) funders.delete(contributor)
  return ledger
}

export function usd(amount: bigint) {
  return Memo.decimal(amount)
}

export function number(amount: bigint) {
  return Number(amount) / Limits.SharedSetup.microsPerDollar
}

export function micro(usd: number | undefined) {
  return usd === undefined ? 0n : Memo.units(usd.toFixed(Limits.SharedMemo.decimals))
}

export function totals(rows: readonly Row[]) {
  let pledged = 0n
  let spent = 0n
  let held = 0n
  for (const row of rows) {
    if (row.kind === 'pledge') pledged += row.amount
    if (row.kind === 'spend') spent -= row.amount
    held += row.amount
  }
  return { held, pledged, spent }
}
