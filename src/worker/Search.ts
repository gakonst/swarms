import type { Hit, Status } from '../shared/Api.ts'

export type Turn = {
  base: string | null
  commits: string[]
  endedAt: number | null
  message: string | null
  n: number
  spent: string
  startedAt: number
  status: string
}

type Stored = 'swarm' | 'report' | 'note'

type Row = { at: number | null; kind: Stored; ref: string; snippet: string; status: Status; swarm: string; title: string }

function stored(kind: Hit['kind']): Stored | undefined {
  return kind === 'update' ? 'report' : kind === 'feed' ? undefined : kind
}

const stop = new Set(
  'a about after all an and any are as at be been by can could did do does for from get got had has have how i if in into is it its me my no not of on or our should so than that the their them then there these they this those to us was we were what when where which who whom why will with would you your'.split(
    ' ',
  ),
)

export function terms(query: string) {
  const words = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
  const kept = words.filter((word) => !stop.has(word))
  return (kept.length ? kept : words).slice(0, 12)
}

export async function query(
  env: Cloudflare.Env,
  input: { kind: Hit['kind'] | undefined; limit: number; swarm: string | undefined; terms: string[] },
): Promise<Hit[]> {
  const kind = input.kind && stored(input.kind)
  const filters = [...(input.swarm ? ['search.swarm = ?'] : ['s.hidden = 0']), ...(kind ? ['search.kind = ?'] : [])]
  const { results } = await env.DB.prepare(
    `select search.swarm as swarm, search.kind as kind, search.ref as ref,
      snippet(search, 4, '«', '»', '…', 40) as snippet, s.title as title, s.status as status, r.ended_at as at
    from search
    join swarms s on s.id = search.swarm
    left join reports r on search.kind = 'report' and r.swarm = search.swarm and r.round = cast(search.ref as integer)
    where search match ? and (exists (select 1 from pledges p where p.swarm = s.id and p.status != 'pending' and cast(p.spent as integer) > 0)
      or exists (select 1 from contributions c where c.swarm = s.id)
      or exists (select 1 from budgets b where b.swarm = s.id and b.token = 'mach' and b.status != 'pending' and cast(b.delivered as integer) > 0))${filters.map((filter) => ' and ' + filter).join('')}
    order by bm25(search, 0, 0, 0, 2, 1) limit ?`,
  )
    .bind(
      input.terms.map((term) => `"${term}"`).join(' OR '),
      ...(input.swarm ? [input.swarm] : []),
      ...(kind ? [kind] : []),
      input.limit,
    )
    .all<Row>()
  return results.map((row) => ({
    at: row.at,
    entry: null,
    kind: row.kind === 'report' ? 'update' : row.kind,
    snippet: row.snippet,
    swarm: { id: row.swarm, status: row.status, title: row.title },
  }))
}

export async function swarm(env: Cloudflare.Env, input: { goal: string; id: string; title: string }) {
  await env.DB.prepare("insert into search (swarm, kind, ref, title, body) values (?, 'swarm', '', ?, ?)")
    .bind(input.id, input.title, input.goal)
    .run()
}

export async function note(env: Cloudflare.Env, swarm: string, id: string, note: string) {
  await env.DB.batch([
    env.DB.prepare("delete from search where swarm = ? and kind = 'note' and ref = ?").bind(swarm, id),
    env.DB.prepare("insert into search (swarm, kind, ref, title, body) values (?, 'note', ?, '', ?)").bind(swarm, id, note),
  ])
}

export async function report(env: Cloudflare.Env, swarm: string, turn: Turn) {
  if (turn.endedAt !== null) await env.DB.batch(statements(env, swarm, turn))
}

export async function sync(env: Cloudflare.Env, swarm: string, turns: readonly Turn[]) {
  const ended = turns.filter((turn) => turn.endedAt !== null)
  if (!ended.length) return

  const { results } = await env.DB.prepare('select round, ended_at from reports where swarm = ?')
    .bind(swarm)
    .all<{ ended_at: number; round: number }>()
  const known = new Map(results.map((row) => [row.round, row.ended_at]))
  const missing = ended.filter((turn) => known.get(turn.n) !== turn.endedAt)
  if (missing.length) await env.DB.batch(missing.flatMap((turn) => statements(env, swarm, turn)))
}

export function lags(turns: readonly { endedAt: number | null; n: number }[], reports: readonly { ended_at: number; round: number }[]) {
  const known = new Map(reports.map((row) => [row.round, row.ended_at]))
  return turns.some((turn) => turn.endedAt !== null && known.get(turn.n) !== turn.endedAt)
}

export async function lagging(env: Cloudflare.Env) {
  const { results } = await env.DB.prepare(
    "select id from swarms s where rounds > (select count(*) from reports r where r.swarm = s.id) + (status = 'running') order by updated_at desc limit 5",
  ).all<{ id: string }>()
  return results.map((row) => row.id)
}

function statements(env: Cloudflare.Env, swarm: string, turn: Turn) {
  return [
    env.DB.prepare(
      'insert into reports (swarm, round, status, message, started_at, ended_at, spent) values (?, ?, ?, ?, ?, ?, ?) on conflict (swarm, round) do update set status = excluded.status, message = excluded.message, started_at = excluded.started_at, ended_at = excluded.ended_at, spent = excluded.spent',
    ).bind(swarm, turn.n, turn.status, turn.message, turn.startedAt, turn.endedAt, turn.spent),
    env.DB.prepare("delete from search where swarm = ? and kind = 'report' and ref = ?").bind(swarm, String(turn.n)),
    ...(turn.message && turn.status === 'completed'
      ? [env.DB.prepare("insert into search (swarm, kind, ref, title, body) values (?, 'report', ?, '', ?)").bind(swarm, String(turn.n), turn.message)]
      : []),
  ]
}
