import type { Account, Answer, Contribution, Currency, Member, Note, Summary, Way } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Replica from './Replica.ts'
import * as Search from './Search.ts'

const ways = ['transfer', 'machine'] as const satisfies readonly Way[]

export type Row = {
  answer: string | null
  contributors: number
  created_at: number
  creator: `0x${string}` | null
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
  sponsor_left: number
  sponsor_spent: number
  status: Summary['status']
  steering: Steering
  team: `0x${string}` | null
  title: string
  updated_at: number
  wallet: `0x${string}` | null
  why: Summary['why']
}

export type Steering = Summary['steering']

export type Gift = {
  amount: string
  channel: `0x${string}` | null
  contributor: `0x${string}`
  created_at: number
  id: string
  note: string | null
  note_id: string | null
  swarm: string
  token: Currency
}

export type Fields = Partial<
  Pick<Row, 'answer' | 'machines' | 'pool_left' | 'pool_spent' | 'repo' | 'rounds' | 'sponsor_left' | 'sponsor_spent' | 'status' | 'steering' | 'team' | 'why'>
>

export const reserve = 50_000n

export const headroom = 100_000n

export const perCall = 20_000n

const totals = `select s.*,
  coalesce((select sum(cast(amount as integer)) from contributions where swarm = s.id), 0) as raised,
  s.pool_spent + s.sponsor_spent + s.spent_before as spent,
  s.pool_left + s.sponsor_left as remaining,
  (select count(distinct contributor) from contributions where swarm = s.id) as contributors
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
    `select s.*, c.raised, s.pool_spent + s.sponsor_spent + s.spent_before as spent, s.pool_left + s.sponsor_left as remaining, c.contributors
    from swarms s join (select swarm, sum(cast(amount as integer)) as raised, count(distinct contributor) as contributors from contributions group by swarm) c on c.swarm = s.id
    where s.hidden = 0 and c.raised > 0${status ? ' and s.status = ?' : ''} order by s.updated_at desc limit 100`,
  )
    .bind(...(status ? [status] : []))
    .all<Row>()
  return results
}

const known = new Set<string>()

const writes = new Map<string, number>()

export function epoch(swarm: string) {
  return writes.get(swarm) ?? 0
}

function wrote(swarm: string) {
  writes.set(swarm, epoch(swarm) + 1)
}

export function seen(id: string) {
  return known.has(id)
}

export function know(ids: readonly string[]) {
  for (const id of ids) known.add(id)
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

export async function steering(env: Cloudflare.Env, id: string) {
  const row = await fresh(env, (db) => db.prepare('select steering from swarms where id = ?').bind(id).first<{ steering: Steering }>())
  if (row) known.add(id)
  return row?.steering ?? null
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
  const row = await env.DB.prepare(
    'insert into swarms (id, title, goal, problem, wallet, sealed_wallet, creator, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning *, 0 as raised, pool_spent + sponsor_spent + spent_before as spent, pool_left + sponsor_left as remaining, 0 as contributors',
  )
    .bind(input.id, input.title, input.goal, input.problem, input.wallet, input.sealed_wallet, input.creator, now, now)
    .first<Row>().finally(() => wrote(input.id))
  if (row) known.add(row.id)
  return row
}

export async function provision(env: Cloudflare.Env, id: string, input: { sealed_wallet: string; wallet: string }) {
  await env.DB.prepare('update swarms set wallet = ?, sealed_wallet = ? where id = ? and wallet is null')
    .bind(input.wallet, input.sealed_wallet, id)
    .run().finally(() => wrote(id))
}

export async function update(env: Cloudflare.Env, id: string, fields: Fields) {
  const entries = Object.entries(fields)
  await env.DB.prepare(
    `update swarms set ${entries.map(([name]) => name + ' = ?, ').join('')}updated_at = ? where id = ?`,
  )
    .bind(...entries.map(([, value]) => value), Date.now(), id)
    .run().finally(() => wrote(id))
}

export async function give(env: Cloudflare.Env, input: Omit<Gift, 'created_at'>) {
  return env.DB.prepare(
    "insert or ignore into contributions (id, swarm, kind, budget, channel, contributor, token, amount, note, note_id, created_at) values (?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?) returning *",
  )
    .bind(
      input.id.toLowerCase(),
      input.swarm,
      input.channel ? 'channel' : 'transfer',
      input.channel?.toLowerCase() ?? null,
      input.contributor.toLowerCase(),
      input.token,
      input.amount,
      input.note,
      input.note_id,
      Date.now(),
    )
    .first<Gift>().finally(() => wrote(input.swarm))
}

export async function gift(env: Cloudflare.Env, id: string) {
  return env.DB.prepare('select * from contributions where id = ?').bind(id.toLowerCase()).first<Gift>()
}

export async function channel(env: Cloudflare.Env, id: string) {
  return env.DB.prepare('select * from contributions where channel = ?').bind(id.toLowerCase()).first<Gift>()
}

export async function delivered(env: Cloudflare.Env, channel: string, amount: bigint) {
  await env.DB.prepare('update contributions set amount = ? where channel = ? and amount != ?')
    .bind(String(amount), channel.toLowerCase(), String(amount))
    .run()
}

export async function annotate(env: Cloudflare.Env, id: string, input: { note: string; note_id: string }) {
  return env.DB.prepare('update contributions set note = ?, note_id = ? where id = ? and note is null returning *')
    .bind(input.note, input.note_id, id.toLowerCase())
    .first<Gift>()
}

export function contribution(row: Gift): Contribution {
  return {
    amount: Memo.decimal(BigInt(row.amount)),
    at: row.created_at,
    contributor: row.contributor,
    hash: row.id.startsWith('0x') ? (row.id as `0x${string}`) : null,
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
      select note_id, note, cast(amount as integer) as weight, contributor from contributions where swarm = ?1 and note_id is not null
      union all
      select note_id, note, cast(amount as integer) as weight, contributor from steers where swarm = ?1 and branch is null
    ) group by note_id order by weight desc limit 50`,
  ).bind(swarm)
}

export type Ledger = {
  contributions: Contribution[]
  notes: (steered: ReadonlySet<string>) => Note[]
  reports: { ended_at: number; round: number }[]
  row: Row
}

export async function ledger(env: Cloudflare.Env, id: string): Promise<Ledger | undefined> {
  return settled(env, (from) => tally(from, id))
}

async function settled<T>(env: Cloudflare.Env, read: (from: Cloudflare.Env) => Promise<T | undefined>) {
  return (await read(env)) ?? (Replica.replicated(env) ? read(Replica.primary(env)) : undefined)
}

async function tally(env: Cloudflare.Env, id: string): Promise<Ledger | undefined> {
  const [found, weights, given, reports] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(totals + ' where s.id = ?').bind(id),
    weighing(env, id),
    gifts(env, id),
    env.DB.prepare('select round, ended_at from reports where swarm = ? order by round desc limit ?').bind(id, Search.recent),
  ])
  const row = found?.results[0] as Row | undefined
  if (!row) return undefined
  known.add(row.id)
  return {
    contributions: (given?.results as Gift[]).map(contribution),
    notes: (steered) => weighed(weights?.results as Weighed[], BigInt(row.raised), steered),
    reports: reports?.results as { ended_at: number; round: number }[],
    row,
  }
}

const backing = `select contributor, amount, note_id, way, at from (
  select contributor, cast(amount as integer) as amount, note_id, 'transfer' as way, created_at as at from contributions where swarm = ?1
  union all
  select lower(contributor), 0, null, 'machine', created_at from hands where swarm = ?1 and contributor is not null and seen_at is not null
)`

const steered = 'coalesce((select sum(cast(amount as integer)) from steers where swarm = ?1 and contributor = b.contributor and budget = 0), 0)'

type Backer = { address: `0x${string}`; backed: number; name: string | null; since: number; steered: number; ways: string }

function backers(env: Cloudflare.Env, swarm: string) {
  return env.DB.prepare(
    `select b.contributor as address, sum(b.amount) as backed, sum(case when b.note_id is not null then b.amount else 0 end) + ${steered} as steered,
      group_concat(distinct b.way) as ways, min(b.at) as since, (select name from names where address = b.contributor) as name
    from (${backing}) b group by b.contributor order by min(b.at)`,
  ).bind(swarm)
}

export async function members(env: Cloudflare.Env, swarm: string): Promise<Member[]> {
  const { results } = await backers(env, swarm).all<Backer>()
  return membered(results)
}

export async function backed(env: Cloudflare.Env, id: string) {
  return settled(env, async (from) => {
    const [found, listed, weights] = await from.DB.batch<Record<string, unknown>>([from.DB.prepare(totals + ' where s.id = ?').bind(id), backers(from, id), weighing(from, id)])
    const row = found?.results[0] as Row | undefined
    if (!row) return undefined
    known.add(row.id)
    return { members: membered(listed?.results as Backer[]), notes: (steered: ReadonlySet<string>) => weighed(weights?.results as Weighed[], BigInt(row.raised), steered), row }
  })
}

export async function rostered(env: Cloudflare.Env, id: string) {
  return settled(env, async (from) => {
    const [found, listed] = await from.DB.batch<Record<string, unknown>>([from.DB.prepare(totals + ' where s.id = ?').bind(id), backers(from, id)])
    const row = found?.results[0] as Row | undefined
    if (!row) return undefined
    known.add(row.id)
    return { members: membered(listed?.results as Backer[]), row }
  })
}

function membered(results: readonly Backer[]): Member[] {
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
    await env.DB.prepare('delete from names where address = ?').bind(lower).run()
    return true
  }
  try {
    await env.DB.prepare(
      'insert into names (address, name, updated_at) values (?, ?, ?) on conflict (address) do update set name = excluded.name, updated_at = excluded.updated_at',
    )
      .bind(lower, name, Date.now())
      .run()
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
    .run().finally(() => wrote(input.swarm))
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
    .run().finally(() => wrote(input.swarm))
  return result.meta.changes > 0
}

export async function funds(env: Cloudflare.Env, swarm: string, agent: string) {
  return (await directing(env, swarm, agent, false)).money
}

export async function directing(env: Cloudflare.Env, swarm: string, agent: string, listing = true) {
  const found = await ledgers(env, swarm, listing)
  return { members: found.members, money: found.money(agent) }
}

export async function ledgers(env: Cloudflare.Env, swarm: string, listing = true) {
  const [funded, based, listed] = await env.DB.batch([
    env.DB.prepare(
      'select agent, branch, contributor, sum(cast(amount as integer)) as amount from steers where swarm = ?1 and branch is not null group by agent, branch, contributor',
    ).bind(swarm),
    env.DB.prepare('select agent, branch, base, settled_at from branches where swarm = ?1').bind(swarm),
    ...(listing ? [backers(env, swarm)] : []),
  ])
  const members = listed ? membered(listed.results as Backer[]) : []
  const money = (agent: string) => {
    const mine = (row: { agent: string | null }) => row.agent === agent
    const rows = (based?.results as { agent: string; base: string; branch: number; settled_at: number | null }[]).filter(mine)
    const bases = new Map(rows.map((row) => [row.branch, BigInt(row.base)]))
    const settled = new Set(rows.filter((row) => row.settled_at !== null).map((row) => row.branch))
    const shares = new Map<number, Map<string, bigint>>()
    for (const row of (funded?.results as { agent: string | null; amount: number; branch: number; contributor: string }[]).filter(mine)) {
      const branch = shares.get(row.branch) ?? new Map<string, bigint>()
      branch.set(row.contributor, (branch.get(row.contributor) ?? 0n) + BigInt(row.amount))
      shares.set(row.branch, branch)
    }
    return { bases, settled, shares }
  }
  return { members, money }
}

export async function base(env: Cloudflare.Env, swarm: string, agent: string, branch: number, value: bigint) {
  await env.DB.prepare('insert or ignore into branches (swarm, agent, branch, base, created_at) values (?, ?, ?, ?, ?)')
    .bind(swarm, agent, branch, String(value), Date.now())
    .run().finally(() => wrote(swarm))
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
  await env.DB.batch(ids.map((id) => env.DB.prepare('delete from steers where id = ?').bind(id)))
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
  ]).finally(() => wrote(input.swarm))
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

export async function note(env: Cloudflare.Env, swarm: string, id: string, raised: bigint, steered: ReadonlySet<string>) {
  const row = await env.DB.prepare(
    `select note_id as id, min(note) as note, sum(weight) as weight, count(distinct contributor) as backers from (
      select note_id, note, cast(amount as integer) as weight, contributor from contributions where swarm = ?1 and note_id = ?2
      union all
      select note_id, note, cast(amount as integer) as weight, contributor from steers where swarm = ?1 and branch is null and note_id = ?2
    ) group by note_id`,
  )
    .bind(swarm, id)
    .first<Weighed>()
  return row ? weighed([row], raised, steered)[0] : undefined
}

export async function noteId(note: string) {
  const normalized = note.trim().toLowerCase().replace(/\s+/g, ' ')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function claim(env: Cloudflare.Env, swarm: string, agent: string, branches: readonly number[]) {
  if (!branches.length) return new Set<number>()
  const now = Date.now()
  const claimed = await env.DB.batch(
    branches.map((branch) =>
      env.DB.prepare(
        'insert into branches (swarm, agent, branch, base, created_at, settled_at) values (?, ?, ?, ?, ?, ?) on conflict (swarm, agent, branch) do update set settled_at = excluded.settled_at where branches.settled_at is null',
      ).bind(swarm, agent, branch, '0', now, now),
    ),
  ).finally(() => wrote(swarm))
  return new Set(branches.filter((_, index) => (claimed[index]?.meta.changes ?? 0) > 0))
}

export async function settle(env: Cloudflare.Env, input: { agent: string; branch: number; claimed?: boolean; left: bigint | null; swarm: string }) {
  const now = Date.now()
  if (!input.claimed && !(await claim(env, input.swarm, input.agent, [input.branch])).has(input.branch)) return []

  const { results } = await env.DB.prepare(
    'select contributor, budget, sum(cast(amount as integer)) as amount, min(case when amount > 0 then created_at end) as since from steers where swarm = ? and agent = ? and branch = ? group by contributor, budget',
  )
    .bind(input.swarm, input.agent, input.branch)
    .all<{ amount: number; budget: number; contributor: string; since: number | null }>()
  const nets = new Map<string, bigint>()
  for (const row of results) nets.set(row.contributor, (nets.get(row.contributor) ?? 0n) + BigInt(row.amount))
  const total = [...nets.values()].reduce((sum, net) => sum + (net > 0n ? net : 0n), 0n)
  const back = input.left === null || input.left > total ? total : input.left
  if (back <= 0n || total === 0n) return []

  const returned = results.flatMap((row) => {
    const net = nets.get(row.contributor) ?? 0n
    if (net <= 0n || row.amount <= 0) return []
    const positive = results.filter((other) => other.contributor === row.contributor && other.amount > 0).reduce((sum, other) => sum + BigInt(other.amount), 0n)
    const amount = (back * net * BigInt(row.amount)) / (total * positive)
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
  ).finally(() => wrote(input.swarm))
  return returned.map((row) => ({ amount: row.amount, budget: row.budget, contributor: row.contributor }))
}
