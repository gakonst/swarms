import type { Account, Answer, Budget, Contribution, Currency, Member, Note, Pledge, Summary, Way } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Replica from './Replica.ts'

const ways = ['pledge', 'budget', 'transfer', 'machine'] as const satisfies readonly Way[]

export type Row = {
  answer: string | null
  contributors: number
  created_at: number
  creator: `0x${string}` | null
  daily: number
  goal: string
  id: string
  machines: number
  pool_left: number
  pool_spent: number
  problem: string | null
  raised: number
  remaining: number
  repo: string | null
  rounds: number
  sealed_wallet: string | null
  spent: number
  status: Summary['status']
  steering: Steering
  team: `0x${string}` | null
  title: string
  updated_at: number
  wallet: `0x${string}` | null
  why: Summary['why']
}

export type Steering = Summary['steering']

export type Backing = {
  amount: string
  contributor: `0x${string}`
  created_at: number
  id: string
  note: string | null
  note_id: string | null
  request: string
  sealed_key: string | null
  spent: string
  status: 'pending' | Pledge['status']
  swarm: string
  token: Currency
}

export type Gift = {
  amount: string
  budget: string | null
  contributor: `0x${string}`
  created_at: number
  id: `0x${string}`
  kind: Contribution['kind']
  note: string | null
  note_id: string | null
  swarm: string
  token: Contribution['token']
}

export type Allowance = {
  access_key: `0x${string}`
  amount: string
  authorization: string
  contributor: `0x${string}` | null
  created_at: number
  detail: string | null
  expires_at: number
  id: string
  key_authorization: string | null
  left_now: string | null
  next_at: number | null
  note: string | null
  note_id: string | null
  period: number
  period_end: number | null
  published: number
  pulled: string
  pulled_at: number | null
  sealed_key: string
  status: 'pending' | 'active' | 'revoked' | 'expired' | 'ended' | 'spent'
  swarm: string
  token: Currency
  updated_at: number
}

export type Fields = Partial<
  Pick<Row, 'answer' | 'machines' | 'pool_left' | 'pool_spent' | 'repo' | 'rounds' | 'status' | 'steering' | 'team' | 'why'>
>

export type Changes = Partial<
  Pick<
    Allowance,
    'detail' | 'left_now' | 'next_at' | 'period_end' | 'published' | 'pulled' | 'pulled_at' | 'status'
  >
>

export const reserve = 50_000n

export const headroom = 100_000n

export const minPledge = 250_000n

export const minSteer = 100_000n

export const stock = reserve + headroom * 3n

export const perCall = 20_000n

export const budget = { days: 365, max: 100_000_000n, min: minPledge, period: 2_592_000 } as const

const totals = `select s.*,
  coalesce((select sum(cast(amount as integer)) from pledges where swarm = s.id and status != 'pending'), 0)
    + coalesce((select sum(cast(amount as integer)) from budgets where swarm = s.id and period = 0 and status != 'pending'), 0)
    + coalesce((select sum(cast(amount as integer)) from contributions where swarm = s.id and kind != 'pledge'), 0) as raised,
  coalesce((select sum(cast(spent as integer)) from pledges where swarm = s.id and status != 'pending'), 0)
    + coalesce((select sum(cast(pulled as integer)) from budgets where swarm = s.id and token = 'mach' and status != 'pending'), 0) + s.pool_spent as spent,
  coalesce((select sum(max(cast(amount as integer) - cast(spent as integer), 0)) from pledges where swarm = s.id and status = 'active'), 0)
    + coalesce((select sum(max(cast(amount as integer) - cast(pulled as integer), 0)) from budgets where swarm = s.id and period = 0 and status = 'active'), 0) + s.pool_left as remaining,
  (select count(*) from (
    select contributor from pledges where swarm = s.id and status != 'pending'
    union select contributor from contributions where swarm = s.id
    union select contributor from budgets where swarm = s.id and status != 'pending'
  )) as contributors,
  coalesce((select sum(cast(amount as integer) * 86400 / period) from budgets where swarm = s.id and status = 'active' and period > 0), 0) as daily
  from swarms s`

function answer(text: string | null): Answer | null {
  if (!text) return null
  const parsed = JSON.parse(text) as Answer
  return { at: parsed.at, done: parsed.done, text: parsed.text }
}

export function summary(row: Row): Summary {
  return {
    answer: answer(row.answer),
    contributors: row.contributors,
    createdAt: row.created_at,
    daily: Memo.decimal(BigInt(row.daily)),
    goal: row.goal,
    id: row.id,
    machines: row.machines,
    pool: Memo.decimal(BigInt(row.pool_left)),
    problem: row.problem ?? null,
    raised: Memo.decimal(BigInt(row.raised)),
    remaining: Memo.decimal(BigInt(row.remaining)),
    spent: Memo.decimal(BigInt(row.spent)),
    status: row.status,
    steering: row.steering ?? 'open',
    title: row.title,
    updatedAt: row.updated_at,
    wallet: row.wallet,
    why: row.status === 'paused' || row.status === 'funding' ? (row.why ?? null) : null,
  }
}

export async function list(env: Cloudflare.Env, status?: Summary['status']) {
  const { results } = await env.DB.prepare(
    `select * from (${totals}) where hidden = 0 and (raised > 0 or daily > 0)${status ? ' and status = ?' : ''} order by updated_at desc limit 100`,
  )
    .bind(...(status ? [status] : []))
    .all<Row>()
  return results
}

const known = new Set<string>()

let writes = 0

export function epoch() {
  return writes
}

function wrote() {
  writes += 1
}

export function seen(id: string) {
  return known.has(id)
}

export async function exists(env: Cloudflare.Env, id: string) {
  if (known.has(id)) return true
  const found = (await fresh(env, (db) => db.prepare('select 1 from swarms where id = ?').bind(id).first())) !== null
  if (found) known.add(id)
  return found
}

export async function find(env: Cloudflare.Env, id: string) {
  const row = await fresh(env, (db) => db.prepare(totals + ' where s.id = ?').bind(id).first<Row>())
  if (row) known.add(row.id)
  return row
}

async function fresh<T>(env: Cloudflare.Env, read: (db: D1Database) => Promise<T | null>) {
  const value = await read(env.DB)
  return value === null && Replica.replicated(env) ? read(Replica.primary(env).DB) : value
}

const repos = new Map<string, { at: number; repo: string }>()

export async function repo(env: Cloudflare.Env, id: string) {
  const cached = repos.get(id)
  if (cached && Date.now() - cached.at < 60_000) return cached.repo
  const row = await fresh(env, (db) => db.prepare('select repo from swarms where id = ?').bind(id).first<{ repo: string | null }>())
  if (row) known.add(id)
  if (row?.repo) repos.set(id, { at: Date.now(), repo: row.repo })
  return row?.repo ?? null
}

export async function insert(
  env: Cloudflare.Env,
  input: Pick<Row, 'creator' | 'goal' | 'id' | 'problem' | 'title'> & { sealed_wallet: string; wallet: string },
) {
  const now = Date.now()
  await env.DB.prepare(
    'insert into swarms (id, title, goal, problem, wallet, sealed_wallet, creator, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(input.id, input.title, input.goal, input.problem, input.wallet, input.sealed_wallet, input.creator, now, now)
    .run().finally(wrote)
}

export async function provision(env: Cloudflare.Env, id: string, input: { sealed_wallet: string; wallet: string }) {
  await env.DB.prepare('update swarms set wallet = ?, sealed_wallet = ? where id = ? and wallet is null')
    .bind(input.wallet, input.sealed_wallet, id)
    .run().finally(wrote)
}

export async function update(env: Cloudflare.Env, id: string, fields: Fields) {
  const entries = Object.entries(fields)
  await env.DB.prepare(
    `update swarms set ${entries.map(([name]) => name + ' = ?, ').join('')}updated_at = ? where id = ?`,
  )
    .bind(...entries.map(([, value]) => value), Date.now(), id)
    .run().finally(wrote)
}

export async function spend(env: Cloudflare.Env, id: string, spent: bigint, status?: Pledge['status']) {
  await env.DB.prepare(
    'update pledges set spent = ?, status = coalesce(?, status), updated_at = ? where id = ?',
  )
    .bind(String(spent), status ?? null, Date.now(), id)
    .run().finally(wrote)
}

export async function active(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare("select * from pledges where swarm = ? and status = 'active'")
    .bind(swarm)
    .all<Backing>()
  return results
}

function legacyPledges(env: Cloudflare.Env, swarm: string) {
  return env.DB.prepare("select * from pledges where swarm = ? and status != 'pending' order by created_at desc limit 200").bind(swarm)
}

function heldPledges(env: Cloudflare.Env, swarm: string) {
  return env.DB.prepare("select * from budgets where swarm = ? and period = 0 and status != 'pending' order by created_at desc limit 200").bind(swarm)
}

export async function pledges(env: Cloudflare.Env, swarm: string): Promise<Pledge[]> {
  const [legacy, held] = await Promise.all([legacyPledges(env, swarm).all<Backing>(), heldPledges(env, swarm).all<Allowance>()])
  return pledged(legacy.results, held.results)
}

function pledged(legacy: Backing[], held: Allowance[]): Pledge[] {
  return [
    ...held.map((row) => pledge(row)),
    ...legacy.map((row) => ({
      amount: Memo.decimal(BigInt(row.amount)),
      at: row.created_at,
      contributor: row.contributor,
      id: row.id,
      note: row.note,
      spent: Memo.decimal(BigInt(row.spent)),
      status: row.status === 'pending' ? ('active' as const) : row.status,
      token: row.token,
    })),
  ]
}

export function pledge(row: Allowance): Pledge {
  return {
    amount: Memo.decimal(BigInt(row.amount)),
    at: row.created_at,
    contributor: row.contributor ?? '0x',
    id: row.id,
    note: row.note,
    spent: Memo.decimal(BigInt(row.pulled)),
    status: row.status === 'pending' || row.status === 'active' ? 'active' : row.status === 'spent' ? 'spent' : 'ended',
    token: row.token,
  }
}

export async function give(env: Cloudflare.Env, input: Omit<Gift, 'created_at'>) {
  const result = await env.DB.prepare(
    'insert or ignore into contributions (id, swarm, kind, budget, contributor, token, amount, note, note_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      input.id.toLowerCase(),
      input.swarm,
      input.kind,
      input.budget,
      input.contributor.toLowerCase(),
      input.token,
      input.amount,
      input.note,
      input.note_id,
      Date.now(),
    )
    .run().finally(wrote)
  return result.meta.changes > 0
}

export async function gift(env: Cloudflare.Env, id: string) {
  return env.DB.prepare('select * from contributions where id = ?').bind(id.toLowerCase()).first<Gift>()
}

export async function annotate(env: Cloudflare.Env, id: string, input: { note: string; note_id: string }) {
  const result = await env.DB.prepare(
    "update contributions set note = ?, note_id = ? where id = ? and kind = 'transfer' and note is null",
  )
    .bind(input.note, input.note_id, id.toLowerCase())
    .run().finally(wrote)
  return result.meta.changes > 0
}

export function contribution(row: Gift): Contribution {
  return {
    amount: Memo.decimal(BigInt(row.amount)),
    at: row.created_at,
    budget: row.budget,
    contributor: row.contributor,
    hash: row.id,
    kind: row.kind,
    note: row.note,
    token: row.token,
  }
}

function gifts(env: Cloudflare.Env, swarm: string) {
  return env.DB.prepare('select * from contributions where swarm = ? order by created_at desc limit 200').bind(swarm)
}

export async function contributions(env: Cloudflare.Env, swarm: string): Promise<Contribution[]> {
  const { results } = await gifts(env, swarm).all<Gift>()
  return results.map(contribution)
}

export async function shares(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare(
    'select contributor, sum(cast(amount as integer)) as amount from contributions where swarm = ? group by contributor order by amount desc',
  )
    .bind(swarm)
    .all<{ amount: number; contributor: `0x${string}` }>()
  return results.map((row) => ({ amount: BigInt(row.amount), contributor: row.contributor }))
}

export async function allow(
  env: Cloudflare.Env,
  input: Pick<
    Allowance,
    'access_key' | 'amount' | 'authorization' | 'expires_at' | 'id' | 'note' | 'note_id' | 'period' | 'sealed_key' | 'swarm' | 'token'
  >,
) {
  const now = Date.now()
  await env.DB.prepare(
    'insert into budgets (id, swarm, kind, token, amount, period, expires_at, access_key, sealed_key, authorization, note, note_id, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      input.id,
      input.swarm,
      input.period > 0 ? 'budget' : 'pledge',
      input.token,
      input.amount,
      input.period,
      input.expires_at,
      input.access_key,
      input.sealed_key,
      input.authorization,
      input.note,
      input.note_id,
      now,
      now,
    )
    .run().finally(wrote)
}

export async function allowance(env: Cloudflare.Env, swarm: string, id: string) {
  return env.DB.prepare('select * from budgets where swarm = ? and id = ?').bind(swarm, id).first<Allowance>()
}

export async function approve(
  env: Cloudflare.Env,
  id: string,
  input: { amount: string; contributor: string; key_authorization: string; published: boolean },
) {
  const result = await env.DB.prepare(
    "update budgets set amount = ?, contributor = ?, key_authorization = ?, published = ?, left_now = ?, status = 'active', updated_at = ? where id = ? and status = 'pending'",
  )
    .bind(
      input.amount,
      input.contributor.toLowerCase(),
      input.key_authorization,
      input.published ? 1 : 0,
      input.amount,
      Date.now(),
      id,
    )
    .run().finally(wrote)
  return result.meta.changes > 0
}

export async function forget(env: Cloudflare.Env, id: string) {
  await env.DB.prepare("delete from budgets where id = ? and status = 'pending'").bind(id).run().finally(wrote)
}

export async function change(env: Cloudflare.Env, id: string, changes: Changes) {
  const entries = Object.entries(changes)
  await env.DB.prepare(
    `update budgets set ${entries.map(([name]) => name + ' = ?, ').join('')}updated_at = ? where id = ?`,
  )
    .bind(...entries.map(([, value]) => value), Date.now(), id)
    .run().finally(wrote)
}

export async function allowances(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare(
    "select * from budgets where swarm = ? and status = 'active' and token != 'mach' order by coalesce(pulled_at, 0), created_at",
  )
    .bind(swarm)
    .all<Allowance>()
  return results
}

export async function keys(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare(
    "select * from budgets where swarm = ? and status = 'active' and token = 'mach' order by created_at",
  )
    .bind(swarm)
    .all<Allowance>()
  return results
}

export async function drained(env: Cloudflare.Env, swarm: string) {
  const { results } = await env.DB.prepare(
    "select * from budgets where swarm = ? and status = 'spent' and token = 'mach' order by created_at",
  )
    .bind(swarm)
    .all<Allowance>()
  return results
}

export async function end(env: Cloudflare.Env, swarm: string) {
  await env.DB.prepare(
    "update budgets set status = 'ended', next_at = null, updated_at = ? where swarm = ? and status = 'active'",
  )
    .bind(Date.now(), swarm)
    .run().finally(wrote)
}

export function view(row: Allowance, now = Date.now()): Budget {
  return {
    amount: Memo.decimal(BigInt(row.amount)),
    at: row.created_at,
    contributor: row.contributor,
    detail: row.detail,
    expiresAt: row.expires_at,
    id: row.id,
    left: row.left_now === null ? null : Memo.decimal(BigInt(row.left_now)),
    nextAt: row.next_at,
    note: row.note,
    period: row.period,
    pulled: Memo.decimal(BigInt(row.pulled)),
    status:
      row.status === 'pending'
        ? 'active'
        : row.status === 'spent'
          ? 'ended'
          : row.status === 'active' && row.expires_at <= now
            ? 'expired'
            : row.status === 'active' && row.next_at !== null && row.next_at > now
              ? 'waiting'
              : row.status,
    token: row.token as Budget['token'],
  }
}

function periodic(env: Cloudflare.Env, swarm: string) {
  return env.DB.prepare("select * from budgets where swarm = ? and period > 0 and status != 'pending' order by created_at desc limit 200").bind(swarm)
}

export async function budgets(env: Cloudflare.Env, swarm: string): Promise<Budget[]> {
  const { results } = await periodic(env, swarm).all<Allowance>()
  const now = Date.now()
  return results.map((row) => view(row, now))
}

type Weighed = { backers: number; id: string; note: string; weight: number }

export async function notes(
  env: Cloudflare.Env,
  swarm: string,
  raised: bigint,
  steered: ReadonlySet<string>,
): Promise<Note[]> {
  const { results } = await weighing(env, swarm).all<Weighed>()
  return weighed(results, raised, steered)
}

function weighed(results: Weighed[], raised: bigint, steered: ReadonlySet<string>): Note[] {
  return results.map((row) => ({
    backers: row.backers,
    id: row.id,
    note: row.note,
    share: raised > 0n ? Number((BigInt(row.weight) * 10_000n) / raised) / 10_000 : 0,
    steered: steered.has(row.id),
    weight: Memo.decimal(BigInt(row.weight)),
  }))
}

function weighing(env: Cloudflare.Env, swarm: string) {
  return env.DB.prepare(
    `select note_id as id, min(note) as note, sum(weight) as weight, count(distinct contributor) as backers from (
      select note_id, note, cast(amount as integer) as weight, contributor from pledges where swarm = ?1 and status != 'pending' and note_id is not null
      union all
      select note_id, note, cast(amount as integer) as weight, contributor from budgets where swarm = ?1 and period = 0 and status != 'pending' and note_id is not null
      union all
      select note_id, note, cast(amount as integer) as weight, contributor from contributions where swarm = ?1 and kind != 'pledge' and note_id is not null
      union all
      select note_id, note, cast(amount as integer) as weight, contributor from steers where swarm = ?1 and branch is null
    ) group by note_id order by weight desc limit 50`,
  ).bind(swarm)
}

export type Ledger = {
  budgets: Budget[]
  contributions: Contribution[]
  notes: (steered: ReadonlySet<string>) => Note[]
  pledges: Pledge[]
  reports: { ended_at: number; round: number }[]
  row: Row
}

export async function ledger(env: Cloudflare.Env, id: string): Promise<Ledger | undefined> {
  return (await tally(env, id)) ?? (Replica.replicated(env) ? tally(Replica.primary(env), id) : undefined)
}

async function tally(env: Cloudflare.Env, id: string): Promise<Ledger | undefined> {
  const [found, legacy, held, weights, budgeted, given, reports] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(totals + ' where s.id = ?').bind(id),
    legacyPledges(env, id),
    heldPledges(env, id),
    weighing(env, id),
    periodic(env, id),
    gifts(env, id),
    env.DB.prepare('select round, ended_at from reports where swarm = ?').bind(id),
  ])
  const row = found?.results[0] as Row | undefined
  if (!row) return undefined
  known.add(row.id)
  const now = Date.now()
  return {
    budgets: (budgeted?.results as Allowance[]).map((allowance) => view(allowance, now)),
    contributions: (given?.results as Gift[]).map(contribution),
    notes: (steered) => weighed(weights?.results as Weighed[], BigInt(row.raised), steered),
    pledges: pledged(legacy?.results as Backing[], held?.results as Allowance[]),
    reports: reports?.results as { ended_at: number; round: number }[],
    row,
  }
}

const backing = `select contributor, amount, note_id, way, at from (
  select lower(contributor) as contributor, cast(amount as integer) as amount, note_id, 'pledge' as way, created_at as at from pledges where swarm = ?1 and status != 'pending'
  union all
  select contributor, case when period = 0 then cast(amount as integer) else 0 end, case when period = 0 then note_id end, case when period = 0 then 'pledge' else 'budget' end, created_at from budgets where swarm = ?1 and status != 'pending' and contributor is not null
  union all
  select contributor, case when kind = 'pledge' then 0 else cast(amount as integer) end, case when kind != 'pledge' then note_id end, case kind when 'transfer' then 'transfer' when 'pull' then 'budget' else 'pledge' end, created_at from contributions where swarm = ?1
  union all
  select lower(contributor), 0, null, 'machine', created_at from hands where swarm = ?1 and contributor is not null and seen_at is not null
)`

const steered = 'coalesce((select sum(cast(amount as integer)) from steers where swarm = ?1 and contributor = b.contributor and budget = 0), 0)'

export async function members(env: Cloudflare.Env, swarm: string): Promise<Member[]> {
  const { results } = await env.DB.prepare(
    `select b.contributor as address, sum(b.amount) as backed, sum(case when b.note_id is not null then b.amount else 0 end) + ${steered} as steered,
      group_concat(distinct b.way) as ways, min(b.at) as since, (select name from names where address = b.contributor) as name
    from (${backing}) b group by b.contributor order by min(b.at)`,
  )
    .bind(swarm)
    .all<{ address: `0x${string}`; backed: number; name: string | null; since: number; steered: number; ways: string }>()
  return results.map((row) => {
    const backed = BigInt(row.backed)
    const allocated = BigInt(row.steered)
    return {
      address: row.address,
      available: Memo.decimal(backed > allocated ? backed - allocated : 0n),
      backed: Memo.decimal(backed),
      handle: row.name ?? Mention.short(row.address),
      since: row.since,
      steered: Memo.decimal(allocated),
      ways: ways.filter((way) => row.ways.split(',').includes(way)),
    }
  })
}

export async function account(env: Cloudflare.Env, address: `0x${string}`): Promise<Account> {
  const lower = address.toLowerCase() as `0x${string}`
  const row = await env.DB.prepare('select name from names where address = ?').bind(lower).first<{ name: string }>()
  return { address: lower, handle: row?.name ?? Mention.short(lower), name: row?.name ?? null }
}

export async function rename(env: Cloudflare.Env, address: `0x${string}`, name: string | null) {
  const lower = address.toLowerCase()
  if (!name) {
    await env.DB.prepare('delete from names where address = ?').bind(lower).run().finally(wrote)
    return true
  }
  try {
    await env.DB.prepare(
      'insert into names (address, name, updated_at) values (?, ?, ?) on conflict (address) do update set name = excluded.name, updated_at = excluded.updated_at',
    )
      .bind(lower, name, Date.now())
      .run().finally(wrote)
    return true
  } catch (error) {
    if (/unique/i.test(String(error))) return false
    throw error
  }
}

const open = 'not exists (select 1 from branches where swarm = ?1 and agent = ?9 and branch = ?8 and settled_at is not null)'

export async function steer(
  env: Cloudflare.Env,
  input: { amount: bigint; branch?: { agent: string; id: number }; contributor: string; id: string; note: string; note_id: string; swarm: string },
) {
  const result = await env.DB.prepare(
    `insert into steers (id, swarm, contributor, note, note_id, amount, created_at, branch, agent)
    select ?3, ?1, ?2, ?4, ?5, ?6, ?7, ?8, ?9 where (
      select coalesce(sum(b.amount), 0) - coalesce(sum(case when b.note_id is not null then b.amount else 0 end), 0) - ${steered}
      from (${backing}) b where b.contributor = ?2
    ) >= cast(?6 as integer) and (?8 is null or ${open})`,
  )
    .bind(input.swarm, input.contributor.toLowerCase(), input.id, input.note, input.note_id, String(input.amount), Date.now(), input.branch?.id ?? null, input.branch?.agent ?? null)
    .run().finally(wrote)
  return result.meta.changes > 0
}

export async function allot(
  env: Cloudflare.Env,
  input: { amount: bigint; branch?: { agent: string; id: number }; contributor: string; id: string; limit: bigint | null; note: string; note_id: string; since: number; swarm: string },
) {
  const result = await env.DB.prepare(
    `insert into steers (id, swarm, contributor, note, note_id, amount, created_at, budget, branch, agent)
    select ?3, ?1, ?2, ?4, ?5, ?6, ?7, 1, ?8, ?9 where (?10 is null or (
      select coalesce(sum(cast(amount as integer)), 0) from steers where swarm = ?1 and contributor = ?2 and budget = 1 and created_at > ?11
    ) + cast(?6 as integer) <= cast(?10 as integer)) and (?8 is null or ${open})`,
  )
    .bind(
      input.swarm,
      input.contributor.toLowerCase(),
      input.id,
      input.note,
      input.note_id,
      String(input.amount),
      Date.now(),
      input.branch?.id ?? null,
      input.branch?.agent ?? null,
      input.limit === null ? null : String(input.limit),
      input.since,
    )
    .run().finally(wrote)
  return result.meta.changes > 0
}

export async function funds(env: Cloudflare.Env, swarm: string, agent: string) {
  const [funded, based] = await env.DB.batch([
    env.DB.prepare(
      'select branch, contributor, sum(cast(amount as integer)) as amount from steers where swarm = ? and agent = ? and branch is not null group by branch, contributor',
    ).bind(swarm, agent),
    env.DB.prepare('select branch, base, settled_at from branches where swarm = ? and agent = ?').bind(swarm, agent),
  ])
  const rows = based?.results as { base: string; branch: number; settled_at: number | null }[]
  const bases = new Map(rows.map((row) => [row.branch, BigInt(row.base)]))
  const settled = new Set(rows.filter((row) => row.settled_at !== null).map((row) => row.branch))
  const shares = new Map<number, Map<string, bigint>>()
  for (const row of funded?.results as { amount: number; branch: number; contributor: string }[]) {
    const branch = shares.get(row.branch) ?? new Map<string, bigint>()
    branch.set(row.contributor, BigInt(row.amount))
    shares.set(row.branch, branch)
  }
  return { bases, settled, shares }
}

export async function base(env: Cloudflare.Env, swarm: string, agent: string, branch: number, value: bigint) {
  await env.DB.prepare('insert or ignore into branches (swarm, agent, branch, base, created_at) values (?, ?, ?, ?, ?)')
    .bind(swarm, agent, branch, String(value), Date.now())
    .run().finally(wrote)
}

const adopted = new Set<string>()

export async function adopt(env: Cloudflare.Env, swarm: string, agent: string) {
  if (adopted.has(swarm + ':' + agent)) return
  await env.DB.batch([
    env.DB.prepare("update branches set agent = ? where swarm = ? and agent = ''").bind(agent, swarm),
    env.DB.prepare("update steers set agent = ? where swarm = ? and branch is not null and (agent = '' or agent is null)").bind(agent, swarm),
  ]).finally(wrote)
  adopted.add(swarm + ':' + agent)
}

export async function replaced(env: Cloudflare.Env, swarm: string, current: string) {
  const { results } = await env.DB.prepare(
    'select agent, branch from branches where swarm = ? and agent != ? and settled_at is null union select agent, branch from steers where swarm = ? and agent != ? and branch is not null',
  )
    .bind(swarm, current, swarm, current)
    .all<{ agent: string; branch: number }>()
  const agents = new Map<string, number[]>()
  for (const row of results) agents.set(row.agent, [...new Set([...(agents.get(row.agent) ?? []), row.branch])])
  return [...agents].map(([agent, branches]) => ({ agent, branches }))
}

export async function unsteer(env: Cloudflare.Env, ids: readonly string[]) {
  await env.DB.batch(ids.map((id) => env.DB.prepare('delete from steers where id = ?').bind(id))).finally(wrote)
}

export async function shift(
  env: Cloudflare.Env,
  input: { agent: string; amount: bigint; contributor: string; from: number; ids: readonly [string, string]; swarm: string; team: boolean; to: number },
) {
  const contributor = input.contributor.toLowerCase()
  const now = Date.now()
  const [taken] = await env.DB.batch([
    env.DB.prepare(
      `insert into steers (id, swarm, contributor, note, note_id, amount, created_at, budget, branch, agent)
      select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?11 where (
        select coalesce(sum(cast(amount as integer)), 0) from steers where swarm = ?2 and agent = ?11 and contributor = ?3 and branch = ?9
      ) >= cast(?10 as integer) and not exists (
        select 1 from branches where swarm = ?2 and agent = ?11 and branch in (?9, ?12) and settled_at is not null
      )`,
    ).bind(input.ids[0], input.swarm, contributor, `branch ${input.from}`, `branch:${input.from}`, String(-input.amount), now, input.team ? 1 : 0, input.from, String(input.amount), input.agent, input.to),
    env.DB.prepare(
      `insert into steers (id, swarm, contributor, note, note_id, amount, created_at, budget, branch, agent)
      select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?11 where exists (select 1 from steers where id = ?10)`,
    ).bind(input.ids[1], input.swarm, contributor, `branch ${input.to}`, `branch:${input.to}`, String(input.amount), now, input.team ? 1 : 0, input.to, input.ids[0], input.agent),
  ]).finally(wrote)
  return (taken?.meta.changes ?? 0) > 0
}

export async function allotted(env: Cloudflare.Env, swarm: string, since: number) {
  const { results } = await env.DB.prepare(
    'select contributor, sum(cast(amount as integer)) as amount from steers where swarm = ? and budget = 1 and created_at > ? group by contributor',
  )
    .bind(swarm, since)
    .all<{ amount: number; contributor: string }>()
  return new Map(results.map((row) => [row.contributor, BigInt(row.amount)]))
}

export async function noteId(note: string) {
  const normalized = note.trim().toLowerCase().replace(/\s+/g, ' ')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function settle(env: Cloudflare.Env, input: { agent: string; branch: number; left: bigint | null; swarm: string }) {
  const now = Date.now()
  const claimed = await env.DB.prepare(
    'insert into branches (swarm, agent, branch, base, created_at, settled_at) values (?, ?, ?, ?, ?, ?) on conflict (swarm, agent, branch) do update set settled_at = excluded.settled_at where branches.settled_at is null',
  )
    .bind(input.swarm, input.agent, input.branch, '0', now, now)
    .run()
    .finally(wrote)
  if (claimed.meta.changes === 0) return []

  const { results } = await env.DB.prepare(
    'select contributor, budget, sum(cast(amount as integer)) as amount, min(case when amount > 0 then created_at end) as since from steers where swarm = ? and agent = ? and branch = ? group by contributor, budget',
  )
    .bind(input.swarm, input.agent, input.branch)
    .all<{ amount: number; budget: number; contributor: string; since: number | null }>()
  const shares = results.filter((row) => row.amount > 0)
  const total = shares.reduce((sum, row) => sum + BigInt(row.amount), 0n)
  const back = input.left === null || input.left > total ? total : input.left
  if (back <= 0n || total === 0n) return []

  const returned = shares.flatMap((row) => {
    const amount = (back * BigInt(row.amount)) / total
    return amount > 0n ? [{ amount, budget: row.budget, contributor: row.contributor, since: row.since ?? now }] : []
  })
  await env.DB.batch(
    returned.map((row) =>
      env.DB.prepare('insert into steers (id, swarm, contributor, note, note_id, amount, created_at, budget, branch, agent) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(
        crypto.randomUUID().replace(/-/g, '').slice(0, 12),
        input.swarm,
        row.contributor,
        `branch ${input.branch}`,
        `branch:${input.branch}`,
        String(-row.amount),
        row.budget ? row.since : now,
        row.budget,
        input.branch,
        input.agent,
      ),
    ),
  ).finally(wrote)
  return returned.map((row) => ({ amount: row.amount, budget: row.budget, contributor: row.contributor }))
}
