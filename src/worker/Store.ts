import type { Account, Answer, Contribution, Cover, Currency, Member, Note, Summary, Way } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Setup from '../shared/Setup.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Replica from './Replica.ts'
import * as Search from './Search.ts'

const ways = ['transfer', 'machine'] as const satisfies readonly Way[]

export type Row = {
  ai?: `0x${string}` | null
  ai_name?: string | null
  answer: string | null
  archived_at?: number | null
  form?: 'agent' | 'tree'
  balance: number
  contributors: number
  cover?: string | null
  created_at: number
  creator: `0x${string}` | null
  goal: string
  id: string
  machines: number
  nickname?: string | null
  pool_left: number
  pool_spent: number
  problem: string | null
  remaining: number
  repo: string | null
  rounds: number
  setup: string | null
  spent: number
  sponsor_left: number
  sponsor_spent: number
  status: Summary['status']
  steering: Steering
  team: `0x${string}` | null
  title: string
  updated_at: number
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
  Pick<Row, 'answer' | 'machines' | 'pool_left' | 'pool_spent' | 'repo' | 'rounds' | 'setup' | 'sponsor_left' | 'sponsor_spent' | 'status' | 'steering' | 'why'>
>

export const reserve = 50_000n

export function reserveOf(row: Pick<Row, 'setup'>) {
  return Setup.reserve(setup(row))
}

const totals = `select s.*,
  coalesce((select sum(cast(amount as integer)) from contributions where swarm = s.id), 0) as balance,
  s.pool_spent + s.sponsor_spent + s.spent_before as spent,
  coalesce((select sum(cast(amount as integer)) from contributions where swarm = s.id), 0) - (s.pool_spent + s.sponsor_spent + s.spent_before) as remaining,
  (select count(distinct contributor) from contributions where swarm = s.id) as contributors,
  (select name from swarm_names where swarm = s.id and current = 1) as nickname,
  (select name from names where address = s.ai) as ai_name
  from swarms s`

function answer(text: string | null): Answer | null {
  if (!text) return null
  const parsed = JSON.parse(text) as Answer
  return { at: parsed.at, done: parsed.done, text: parsed.text }
}

export function cover(row: Pick<Row, 'cover'>): Cover | null {
  if (!row.cover) return null
  try {
    const parsed = JSON.parse(row.cover) as Cover
    return typeof parsed.url === 'string' && (parsed.form === 'page' || parsed.form === 'image') ? { form: parsed.form, url: parsed.url } : null
  } catch {
    return null
  }
}

export function setup(row: Pick<Row, 'setup'>): Setup.Setup | null {
  if (!row.setup) return null
  try {
    return JSON.parse(row.setup) as Setup.Setup
  } catch {
    return null
  }
}

export function summary(row: Row): Summary {
  return {
    ai: row.ai ? { address: row.ai, handle: row.ai_name ?? Mention.short(row.ai) } : null,
    answer: answer(row.answer),
    archivedAt: row.archived_at ?? null,
    form: row.form ?? 'agent',
    balance: Memo.decimal(BigInt(row.balance)),
    contributors: row.contributors,
    cover: cover(row),
    createdAt: row.created_at,
    goal: row.goal,
    id: row.id,
    machines: row.machines,
    nickname: row.nickname ?? null,
    pool: Memo.decimal(BigInt(row.pool_left)),
    problem: row.problem ?? null,
    remaining: Memo.decimal(BigInt(row.remaining)),
    setup: setup(row),
    spent: Memo.decimal(BigInt(row.spent)),
    status: row.status,
    steering: row.steering ?? 'open',
    title: row.title,
    updatedAt: row.updated_at,
    why: row.status === 'paused' || row.status === 'funding' ? (row.why ?? null) : row.why === 'stuck' ? 'stuck' : null,
  }
}

export async function list(env: Cloudflare.Env, status?: Summary['status']) {
  const { results } = await env.DB.prepare(
    `select s.*, coalesce(c.balance, 0) as balance, s.pool_spent + s.sponsor_spent + s.spent_before as spent, coalesce(c.balance, 0) - (s.pool_spent + s.sponsor_spent + s.spent_before) as remaining, coalesce(c.contributors, 0) as contributors, (select name from swarm_names where swarm = s.id and current = 1) as nickname, (select name from names where address = s.ai) as ai_name
    from swarms s left join (select swarm, sum(cast(amount as integer)) as balance, count(distinct contributor) as contributors from contributions group by swarm) c on c.swarm = s.id
    where s.hidden = 0 and (c.balance > 0 or s.form = 'tree')${status ? ' and s.status = ?' : ''} order by s.form = 'tree' desc, s.archived_at is not null, s.updated_at desc limit 100`,
  )
    .bind(...(status ? [status] : []))
    .all<Row>()
  return results
}

export async function riding(env: Cloudflare.Env) {
  const [top, count] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `select r.swarm, r.contributor, r.total, r.since, n.name from (select c.swarm, lower(c.contributor) as contributor, sum(cast(c.amount as integer)) as total, min(c.created_at) as since, row_number() over (partition by c.swarm order by sum(cast(c.amount as integer)) desc, min(c.created_at)) as k
      from contributions c join swarms s on s.id = c.swarm where s.hidden = 0 group by c.swarm, lower(c.contributor)) r left join names n on n.address = r.contributor where r.k <= 3 order by r.swarm, r.k`,
    ),
    env.DB.prepare('select count(distinct lower(c.contributor)) as riders from contributions c join swarms s on s.id = c.swarm where s.hidden = 0'),
  ])
  const funders: Record<string, Tree.Funder[]> = {}
  for (const row of (top?.results ?? []) as { contributor: `0x${string}`; name: string | null; since: number; swarm: string; total: number }[])
    (funders[row.swarm] ??= []).push({ amount: Memo.decimal(BigInt(row.total)), since: row.since, who: { address: row.contributor, agent: null, handle: row.name ?? Mention.short(row.contributor) } })
  return { funders, riders: Number((count?.results[0] as { riders?: number } | undefined)?.riders ?? 0) }
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
  input: Pick<Row, 'creator' | 'goal' | 'id' | 'problem' | 'steering' | 'title'> & Partial<Pick<Row, 'setup' | 'form'>> & { nickname?: string | undefined },
) {
  const now = Date.now()
  const swarm = env.DB.prepare(
    'insert into swarms (id, title, goal, problem, creator, steering, created_at, updated_at, setup, form) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) returning *, 0 as balance, pool_spent + sponsor_spent + spent_before as spent, 0 - (pool_spent + sponsor_spent + spent_before) as remaining, 0 as contributors, ? as nickname',
  ).bind(input.id, input.title, input.goal, input.problem, input.creator, input.steering, now, now, input.setup ?? null, input.form ?? 'agent', input.nickname ?? null)
  const named = input.nickname
  const row = await (named ? env.DB.batch<Row>([freeing(env, named), swarm, claiming(env, named, input.id, now)]).then((results) => results[1]?.results[0] ?? null, taken) : swarm.first<Row>()).finally(() => wrote(input.id))
  if (row) known.add(row.id)
  return row
}

export class Taken extends Error {}

function taken(error: unknown): never {
  throw /UNIQUE constraint failed/i.test(String(error instanceof Error ? error.message : error)) ? new Taken('The nickname is taken.') : error
}

function freeing(env: Cloudflare.Env, name: string) {
  return env.DB.prepare('delete from swarm_names where name = ? and current = 0').bind(name)
}

function claiming(env: Cloudflare.Env, name: string, swarm: string, at: number) {
  return env.DB.prepare('insert into swarm_names (name, swarm, current, created_at) values (?, ?, 1, ?)').bind(name, swarm, at)
}

export type Called = { current: string | null; swarm: string }

export async function called(env: Cloudflare.Env, name: string) {
  return fresh(env, (db) => db.prepare('select n.swarm, c.name as current from swarm_names n left join swarm_names c on c.swarm = n.swarm and c.current = 1 where n.name = ?').bind(name).first<Called>())
}

export async function nicknamed(env: Cloudflare.Env, swarm: string) {
  const row = await env.DB.prepare('select name from swarm_names where swarm = ? and current = 1').bind(swarm).first<{ name: string }>()
  return row?.name ?? null
}

export async function nickname(env: Cloudflare.Env, swarm: string, name: string | null) {
  const at = Date.now()
  const letting = env.DB.prepare('update swarm_names set current = 0 where swarm = ? and current = 1').bind(swarm)
  await (name ? env.DB.batch([freeing(env, name), letting, claiming(env, name, swarm, at)]).catch(taken) : letting.run()).finally(() => wrote(swarm))
}

export async function archive(env: Cloudflare.Env, id: string, at: number) {
  const row = await env.DB.prepare('update swarms set archived_at = coalesce(archived_at, ?1), updated_at = ?1 where id = ?2 returning archived_at').bind(at, id).first<{ archived_at: number }>().finally(() => wrote(id))
  return row?.archived_at ?? null
}

export async function update(env: Cloudflare.Env, id: string, fields: Fields) {
  const entries = Object.entries(fields)
  await env.DB.prepare(
    `update swarms set ${entries.map(([name]) => name + ' = ?, ').join('')}updated_at = ? where id = ?`,
  )
    .bind(...entries.map(([, value]) => value), Date.now(), id)
    .run().finally(() => wrote(id))
}

export async function claim(env: Cloudflare.Env, id: string, creator: `0x${string}`) {
  const held = await env.DB.prepare('update swarms set creator = coalesce(creator, ?1), updated_at = ?2 where id = ?3 returning creator')
    .bind(creator.toLowerCase(), Date.now(), id)
    .first<{ creator: `0x${string}` | null }>()
    .finally(() => wrote(id))
  return held?.creator
}

export async function teamed(env: Cloudflare.Env, id: string, team: `0x${string}`) {
  const held = await env.DB.prepare(
    'update swarms set team = coalesce(team, ?1), updated_at = case when team is null then ?2 else updated_at end where id = ?3 returning team',
  )
    .bind(team, Date.now(), id)
    .first<{ team: `0x${string}` }>().finally(() => wrote(id))
  return held?.team ?? null
}

export async function pictured(env: Cloudflare.Env, id: string, cover: string | null) {
  await env.DB.prepare('update swarms set cover = ? where id = ?').bind(cover, id).run().finally(() => wrote(id))
}

export async function give(env: Cloudflare.Env, input: Omit<Gift, 'created_at'>) {
  return env.DB.prepare(
    'insert or ignore into contributions (id, swarm, channel, contributor, token, amount, note, note_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?) returning *',
  )
    .bind(
      input.id.toLowerCase(),
      input.swarm,
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

export async function backings(env: Cloudflare.Env, swarm: string) {
  const found = await env.DB.prepare('select * from contributions where swarm = ? and channel is not null').bind(swarm).all<Gift>()
  return found.results.filter((gift) => gift.id.startsWith('backing:'))
}

export async function lower(env: Cloudflare.Env, swarm: string, id: string, amount: string) {
  const [, taken] = await env.DB.batch<{ agent: string | null; branch: number | null }>([
    env.DB.prepare('update contributions set amount = ? where id = ? and swarm = ?').bind(amount, id.toLowerCase(), swarm),
    env.DB.prepare(
      `with over as (
        select owner.contributor,
          coalesce((select sum(cast(amount as integer)) from steers where swarm = ?1 and contributor = owner.contributor and budget = 0), 0)
          - coalesce((select sum(cast(amount as integer)) from contributions where swarm = ?1 and contributor = owner.contributor and note_id is null), 0) as excess
        from contributions owner where owner.id = ?2 and owner.swarm = ?1
      ), held as (
        select min(s.note) as note, s.note_id, s.branch, s.agent, sum(cast(s.amount as integer)) as net, max(s.created_at) as at
        from steers s, over where s.swarm = ?1 and s.contributor = over.contributor and s.budget = 0 and (s.branch is null or not exists (
          select 1 from branches b where b.swarm = s.swarm and b.agent = s.agent and b.branch = s.branch and b.settled_at is not null
        ))
        group by s.note_id, s.branch, s.agent having net > 0
      ), ranked as (
        select held.*, coalesce(sum(net) over (order by at desc, note_id rows between unbounded preceding and 1 preceding), 0) as before from held
      )
      insert into steers (id, swarm, contributor, note, note_id, amount, created_at, budget, branch, agent)
      select lower(hex(randomblob(6))), ?1, over.contributor, ranked.note, ranked.note_id, -min(ranked.net, over.excess - ranked.before), ?3, 0, ranked.branch, ranked.agent
      from ranked, over where over.excess > ranked.before
      returning agent, branch`,
    ).bind(swarm, id.toLowerCase(), Date.now()),
  ]).finally(() => wrote(swarm))
  return (taken?.results ?? []).flatMap((row) => (row.branch === null ? [] : [{ agent: row.agent ?? '', branch: row.branch }]))
}

export async function gift(env: Cloudflare.Env, id: string) {
  return env.DB.prepare('select * from contributions where id = ?').bind(id.toLowerCase()).first<Gift>()
}

export async function counted(env: Cloudflare.Env, ids: readonly string[]) {
  const found = await env.DB.prepare('select id from contributions where id in (select value from json_each(?))').bind(JSON.stringify(ids.map((id) => id.toLowerCase()))).all<{ id: string }>()
  return new Set(found.results.map((row) => row.id))
}

export async function annotate(env: Cloudflare.Env, swarm: string, id: string, input: { note: string; note_id: string }) {
  return env.DB.prepare(
    `update contributions set note = ?3, note_id = ?4 where id = ?2 and swarm = ?1 and note is null and (
      select coalesce(sum(b.amount), 0) - coalesce(sum(case when b.note_id is not null then b.amount else 0 end), 0) - ${steered}
      from (${backing}) b where b.contributor = (select contributor from contributions where id = ?2)
    ) >= cast(amount as integer) returning *`,
  )
    .bind(swarm, id.toLowerCase(), input.note, input.note_id)
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

type Weighed = { backers: number; id: string; note: string; weight: number }

export async function notes(
  env: Cloudflare.Env,
  swarm: string,
  balance: bigint,
  steered: ReadonlySet<string>,
): Promise<Note[]> {
  const { results } = await weighing(env, swarm).all<Weighed>()
  return weighed(results, balance, steered)
}

function weighed(results: Weighed[], balance: bigint, steered: ReadonlySet<string>): Note[] {
  return results.map((row) => ({
    backers: row.backers,
    id: row.id,
    note: row.note,
    share: balance > 0n ? Number((BigInt(row.weight) * 10_000n) / balance) / 10_000 : 0,
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
    ) group by note_id having sum(weight) > 0 order by weight desc limit 50`,
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
    notes: (steered) => weighed(weights?.results as Weighed[], BigInt(row.balance), steered),
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

export async function host(env: Cloudflare.Env, swarm: string, rider: `0x${string}` | null) {
  await env.DB.prepare('update swarms set ai = ? where id = ?').bind(rider && rider.toLowerCase(), swarm).run()
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
    return { members: membered(listed?.results as Backer[]), notes: (steered: ReadonlySet<string>) => weighed(weights?.results as Weighed[], BigInt(row.balance), steered), row }
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

export async function handles(env: Cloudflare.Env, addresses: readonly `0x${string}`[]) {
  if (!addresses.length) return new Map<string, string>()
  const { results } = await env.DB.prepare(`select address, name from names where address in (${addresses.map(() => '?').join(', ')})`)
    .bind(...addresses.map((address) => address.toLowerCase()))
    .all<{ address: string; name: string }>()
  return new Map(results.map((row) => [row.address, row.name]))
}

export async function named(env: Cloudflare.Env, name: string) {
  const row = await env.DB.prepare('select address from names where name = ?').bind(name.toLowerCase()).first<{ address: `0x${string}` }>()
  return row?.address ?? null
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
    select ?3, ?1, ?2, ?4, ?5, ?6, ?7, 1, ?8, ?9 where (
      select coalesce(sum(cast(amount as integer)), 0) from steers where swarm = ?1 and contributor = ?2 and budget = 1 and created_at > ?11
    ) + cast(?6 as integer) <= coalesce(cast(?10 as integer), (select coalesce(sum(cast(amount as integer)), 0) from contributions where swarm = ?1)) and (?8 is null or ${open})`,
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
    `select agent, branch from branches where swarm = ?1 and agent != ?2 and settled_at is null union
    select agent, branch from steers s where swarm = ?1 and agent != ?2 and branch is not null and not exists (
      select 1 from branches b where b.swarm = s.swarm and b.agent = s.agent and b.branch = s.branch and b.settled_at is not null
    )`,
  )
    .bind(swarm, current)
    .all<{ agent: string; branch: number }>()
  const agents = new Map<string, number[]>()
  for (const row of results) agents.set(row.agent, [...new Set([...(agents.get(row.agent) ?? []), row.branch])])
  return [...agents].map(([agent, branches]) => ({ agent, branches }))
}

export async function unsteer(env: Cloudflare.Env, ids: readonly string[]) {
  if (!ids.length) return
  const placed = ids.map((_, index) => '?' + (index + 1)).join(', ')
  await env.DB.prepare(
    `delete from steers where id in (${placed}) and not exists (
      select 1 from steers s join branches b on b.swarm = s.swarm and b.agent = s.agent and b.branch = s.branch where s.id in (${placed}) and b.settled_at is not null
    )`,
  )
    .bind(...ids)
    .run()
}

export async function shift(env: Cloudflare.Env, input: { agent: string; amount: bigint; contributor: string; from: number; swarm: string; to: number }) {
  const { results } = await env.DB.prepare(
    `with held as (
      select coalesce(sum(case when budget = 0 then cast(amount as integer) end), 0) as own, coalesce(sum(cast(amount as integer)), 0) as total,
        min(case when budget = 1 and amount > 0 then created_at end) as since
      from steers where swarm = ?1 and agent = ?2 and contributor = ?3 and branch = ?4
    ), parts as (
      select 0 as budget, min(max(own, 0), cast(?6 as integer)) as part, ?7 as at from held
      union all
      select 1, cast(?6 as integer) - min(max(own, 0), cast(?6 as integer)), coalesce(since, ?7) from held
    ), legs as (
      select cast(?4 as integer) as branch, -1 as sign union all select cast(?5 as integer), 1
    )
    insert into steers (id, swarm, contributor, note, note_id, amount, created_at, budget, branch, agent)
    select lower(hex(randomblob(6))), ?1, ?3, 'branch ' || legs.branch, 'branch:' || legs.branch, legs.sign * parts.part, parts.at, parts.budget, legs.branch, ?2
    from parts, legs, held
    where parts.part > 0 and held.total >= cast(?6 as integer) and not exists (
      select 1 from branches where swarm = ?1 and agent = ?2 and branch in (?4, ?5) and settled_at is not null
    )
    returning id`,
  )
    .bind(input.swarm, input.agent, input.contributor.toLowerCase(), input.from, input.to, String(input.amount), Date.now())
    .all<{ id: string }>()
    .finally(() => wrote(input.swarm))
  return results.map((row) => row.id)
}

export async function allotted(env: Cloudflare.Env, swarm: string, since: number) {
  const { results } = await env.DB.prepare(
    'select contributor, sum(cast(amount as integer)) as amount from steers where swarm = ? and budget = 1 and created_at > ? group by contributor',
  )
    .bind(swarm, since)
    .all<{ amount: number; contributor: string }>()
  return new Map(results.map((row) => [row.contributor, BigInt(row.amount)]))
}

export async function note(env: Cloudflare.Env, swarm: string, id: string, balance: bigint, steered: ReadonlySet<string>) {
  const row = await env.DB.prepare(
    `select note_id as id, min(note) as note, sum(weight) as weight, count(distinct contributor) as backers from (
      select note_id, note, cast(amount as integer) as weight, contributor from contributions where swarm = ?1 and note_id = ?2
      union all
      select note_id, note, cast(amount as integer) as weight, contributor from steers where swarm = ?1 and branch is null and note_id = ?2
    ) group by note_id having sum(weight) > 0`,
  )
    .bind(swarm, id)
    .first<Weighed>()
  return row ? weighed([row], balance, steered)[0] : undefined
}

export async function noteId(note: string) {
  const normalized = note.trim().toLowerCase().replace(/\s+/g, ' ')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type Settlement = { agent: string; branch: number; left: bigint | null; swarm: string }

export function settling(input: { agent: string; branch: number }) {
  return `settle:${input.agent}:${input.branch}`
}

export async function settle(env: Cloudflare.Env, input: Settlement) {
  const now = Date.now()
  const [returned] = await env.DB.batch<{ amount: string; budget: number; contributor: string }>([
    env.DB.prepare(
      `with held as (
        select contributor, budget, sum(cast(amount as integer)) as amount, min(case when amount > 0 then created_at end) as since
        from steers where swarm = ?1 and agent = ?2 and branch = ?3 group by contributor, budget
      ), nets as (
        select contributor, sum(amount) as net, sum(max(amount, 0)) as positive from held group by contributor
      ), sums as (
        select coalesce(sum(max(net, 0)), 0) as total from nets
      ), shares as (
        select held.contributor, held.budget, held.since,
          cast(min(sums.total, coalesce(cast(?4 as integer), sums.total)) * nets.net / sums.total as integer) * held.amount / nets.positive as amount
        from held join nets on nets.contributor = held.contributor join sums
        where nets.net > 0 and held.amount > 0 and sums.total > 0
      )
      insert into steers (id, swarm, contributor, note, note_id, amount, created_at, budget, branch, agent)
      select ?6 || ':' || contributor || ':' || budget, ?1, contributor, 'branch ' || cast(?3 as integer), 'branch:' || cast(?3 as integer), -amount, case when budget = 1 then coalesce(since, ?5) else ?5 end, budget, ?3, ?2
      from shares
      where amount > 0
      on conflict (id) do nothing
      returning contributor, budget, amount`,
    ).bind(input.swarm, input.agent, input.branch, input.left === null ? null : String(input.left), now, settling(input)),
    env.DB.prepare(
      'insert into branches (swarm, agent, branch, base, created_at, settled_at) values (?, ?, ?, ?, ?, ?) on conflict (swarm, agent, branch) do update set settled_at = excluded.settled_at where branches.settled_at is null',
    ).bind(input.swarm, input.agent, input.branch, '0', now, now),
  ]).finally(() => wrote(input.swarm))
  return (returned?.results ?? []).map((row) => ({ amount: -BigInt(row.amount), budget: row.budget, contributor: row.contributor }))
}

export async function holder(env: Cloudflare.Env, name: string) {
  const row = await env.DB.prepare('select address from names where name = ?').bind(name.toLowerCase()).first<{ address: `0x${string}` }>()
  return row?.address
}

export async function ridden(env: Cloudflare.Env, address: `0x${string}`) {
  const lower = address.toLowerCase()
  const [swarms, nodes] = await env.DB.batch<Record<string, unknown>>([
    env.DB.prepare(
      `select s.id as swarm, coalesce(c.ridden, 0) as ridden, coalesce(c.since, s.created_at) as since, lower(coalesce(s.creator, '')) = ?1 as started
      from swarms s left join (select swarm, sum(cast(amount as integer)) as ridden, min(created_at) as since from contributions where contributor = ?1 group by swarm) c on c.swarm = s.id
      where s.hidden = 0 and (c.swarm is not null or lower(coalesce(s.creator, '')) = ?1 or s.id in (select swarm from ideas where lower(author) = ?1))`,
    ).bind(lower),
    env.DB.prepare("select swarm, node, sum(amount) as ridden from flows where contributor = ?1 and kind = 'pledge' and node != '' group by swarm, node").bind(lower),
  ])
  return {
    nodes: (nodes?.results ?? []) as { node: string; ridden: number; swarm: string }[],
    swarms: (swarms?.results ?? []) as { ridden: number; since: number; started: number; swarm: string }[],
  }
}
