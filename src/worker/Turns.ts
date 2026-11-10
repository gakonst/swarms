import * as Feed from './Feed.ts'
import type { Hand, Note } from '../shared/Api.ts'
import { redact } from '../shared/Trail.ts'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Setup from '../shared/Setup.ts'
import * as Site from '../shared/Site.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Persona from './Persona.ts'
import * as Phase from './Phase.ts'
import * as Search from './Search.ts'
import * as Store from './Store.ts'
import * as Words from './Words.ts'
import * as Relay from './Relay.ts'
import * as Clock from './Clock.ts'
import * as Money from './Money.ts'
import * as Follow from './Follow.ts'
import * as Repo from './Repo.ts'
import * as Branching from './Branching.ts'
import * as Chat from './Chat.ts'
import type { Lead, Swarm, Turning } from './Swarm.ts'

const repoCost = 1_100_000n

export function repoed(repo: { name: string; state: 'none' | 'ready' }, left: bigint) {
  if (repo.state === 'ready') return `The swarm's git repository is ${repo.name}.`
  if (left < repoCost) return ''
  return `Before anything else, create the swarm's git repository: git_create({ name: "${repo.name}", public: true }). Keep the swarm's work in it: main is the best version so far, every branch of work is a git branch of it, and a branch that beats main is merged into main.`
}

function brief(row: Store.Row, notes: Note[], repo: string, room: string) {
  const setup = Store.setup(row)
  return [row.title, row.goal, setup ? Setup.told(setup) : '', repo, room, ...notes.map(weighed)].filter(Boolean).join('\n\n')
}

function next(notes: Note[], repo: string, room: string) {
  return ['Keep going. Never stop to wait for backers: pick the next most useful step toward the goal.', repo, room, ...notes.map(weighed)].filter(Boolean).join('\n\n')
}

export function roomed(origin: string, swarm: string) {
  return `Your room, where backers talk and answer your Wishlist, is ${origin.replace(/\/+$/, '')}/v1/swarms/${swarm}/chat (public, free to read).`
}

export function broke(message: string | null) {
  return !!message && (message.includes("This app's credit has $") || message.includes("None of this app's backers can pay") || message.includes(' was not paid: '))
}

function grown(told: bigint | null | undefined, weight: bigint) {
  if (told === undefined) return true
  if (told === null) return false
  return weight >= told + (told / 4n > 100_000n ? told / 4n : 100_000n)
}

export function weighed(note: Note) {
  const backers = note.backers === 1 ? '1 backer' : `${note.backers} backers`
  return `[${Words.dollars(Memo.units(note.weight))} behind this, from ${backers}] ${Mention.claimed(note.note)}`
}

const unreachableMs = 15 * 60_000

const maxFailures = 3

const quickMs = 60_000

const settleMs = 15_000

const maxBackoffMs = 30 * 60_000

export async function step(self: Swarm) {
  const id = self.kv.get<string>('id')
  const row = id ? await self.found(id) : null
  if (!row) return null

  const run = self.run()
  if (run.state === 'paused') {
    const settling = await settle(self, row, run)
    if (self.run().state === 'paused') return settling
  }
  if (run.state === 'working') return Follow.follow(self, row, run)
  return advance(self, row)
}

export async function advance(self: Swarm, row: Store.Row) {
  const run = self.run()
  const worked = self.turned()
  const money = await Money.refresh(self, row, { credit: true, hands: Follow.handsDue(self, Date.now()) })
  if (run.state !== 'starting' && money.left < Store.reserveOf(money.row)) {
    await pause(self, money.row, worked || money.row.contributors ? { left: String(money.left), needs: String(Store.reserveOf(money.row)), wake: null, why: 'money' } : { why: 'unfunded' })
    return null
  }
  const repo = await Repo.located(self, row)

  const agent = await lead(self, row)
  if ('error' in agent) return retry(self, money.row, agent.error, agent.detail)

  const n = run.state === 'starting' ? run.n : worked + 1
  const since = Phase.since(run)
  const notes = await self.notes(money.row)
  const seen = self.kv.get<string>('seen')
  const base = repo.state !== 'ready' ? null : seen && !Follow.cued(self, 'git', self.kv.get<number>('seenAt') ?? 0) ? seen : await Repo.head(self, row.id, repo.name)
  if (base) Repo.saw(self, base)
  else self.kv.delete('seen')
  const told = self.told()
  const included = agent.briefed ? notes.filter((note) => grown(told.get(note.id), Memo.units(note.weight))) : notes
  const repoLine = repoed(repo, money.left)
  const room = roomed(Site.home(self.env), row.id)
  const text = agent.briefed
    ? next(self.tell(included), repo.state === 'ready' ? '' : repoLine, Persona.frozen(self.kv, Store.setup(row)).includes(Persona.roomless) ? room : '')
    : brief(money.row, self.tell(notes), repoLine, room)
  const id = `${agent.id}:${n}`
  const start: Phase.Run =
    run.state === 'starting' && run.id === id ? run : { id, n, since, state: 'starting', told: included.map((note) => [note.id, String(Memo.units(note.weight))]) }
  await self.move(money.row, start)
  const sent = await Gateway.prompt(self.env, row.id, agent.id, { id: start.id, prompt: text, steer: false })
  if (!sent.ok && sent.status !== 409) {
    if (sent.status === 404) self.kv.delete('agent')
    if (sent.status >= 500 && unreachable(self, Date.now())) abandon(self, agent.id, sent.detail)
    return retry(self, money.row, 'The gateway did not take the next message for the agent.', sent.detail)
  }

  const now = Date.now()
  const turn = sent.ok ? sent.value.request_id : start.id
  await Money.cap(self, row, money.left / Hands.share, money.listed)
  self.kv.put('agent', { ...(self.agent() ?? agent), briefed: true, unreachable: null })
  self.ctx.storage.sql.exec(
    "INSERT OR REPLACE INTO turns (n, turn, started_at, status, spent_before, base) VALUES (?, ?, ?, 'running', ?, ?)",
    n,
    turn,
    now,
    String(money.row.spent),
    base,
  )
  for (const [note, weight] of start.told) {
    self.ctx.storage.sql.exec('INSERT OR REPLACE INTO steered (note, at, weight) VALUES (?, ?, ?)', note, now, weight)
    self.kv.delete('collapse:' + note)
  }
  for (const note of notes.filter((found) => told.get(found.id) === null)) self.ctx.storage.sql.exec('UPDATE steered SET weight = ? WHERE note = ? AND weight IS NULL', String(Memo.units(note.weight)), note.id)
  self.touch()
  await self.move(money.row, { from: self.last(), n, since: start.since ?? now, started: now, state: 'working', turn }, { rounds: n })
  Relay.begin(self)
  self.log('status', start.since === null ? `${worked ? 'Back at work' : 'Started working'}.` : 'Told the agent to keep going.', text)
  if (start.since === null) Chat.announce(self, `${worked ? 'Back at work' : 'Started working'}.`)
  return now + Clock.followMs
}

export async function retry(self: Swarm, row: Store.Row, error: string, detail: string) {
  const run = self.run()
  const now = Date.now()
  failed(self, error, detail)
  await self.move(row, {
    ...(run.state === 'waiting' && run.from ? { from: run.from } : {}),
    since: Phase.since(run),
    state: 'waiting',
    until: now + Clock.retryMs,
  })
  return now + Clock.retryMs
}

function failed(self: Swarm, error: string, detail: string) {
  const last = self.ctx.storage.sql
    .exec<{ at: number | null }>("SELECT MAX(at) AS at FROM (SELECT at, kind, text FROM feed ORDER BY seq DESC LIMIT 200) WHERE kind = 'error' AND text = ?", error)
    .one().at
  if (last === null || Date.now() - Number(last) >= Clock.quietMs) self.log('error', error, detail)
}

export function threw(self: Swarm, error: unknown) {
  const now = Date.now()
  console.error('A step of the swarm threw', String(error))
  failed(self, 'The swarm hit an error and will retry.', String(error))
  const run = self.run()
  if (run.state === 'starting') self.set({ since: run.since, state: 'waiting', until: now + Clock.retryMs })
  return now + Clock.retryMs
}

export function unreachable(self: Swarm, now: number) {
  const agent = self.agent()
  if (!agent) return false
  if (agent.unreachable === null) self.kv.put('agent', { ...agent, unreachable: now })
  return agent.unreachable !== null && now - agent.unreachable >= unreachableMs
}

export function reached(self: Swarm) {
  const agent = self.agent()
  if (agent && agent.unreachable !== null) self.kv.put('agent', { ...agent, unreachable: null })
}

export function abandon(self: Swarm, agent: string, detail: string) {
  self.kv.delete('agent')
  self.log('error', "The agent's session stopped answering for 15 minutes, so the swarm starts a new agent with its goal, notes and updates; the old agent's workspace stays behind.", `${agent}: ${detail}`)
}

export const credited = 'backers'

export async function lead(self: Swarm, row: Store.Row): Promise<Lead | { detail: string; error: string }> {
  const known = self.agent()
  if (known) {
    if (known.url === credited) return instructed(self, row, known)
    const patched = await Gateway.fund(self.env, row.id, known.id)
    if (patched.ok) {
      const moved = { ...known, url: credited }
      self.kv.put('agent', moved)
      return instructed(self, row, moved)
    }
    if (patched.status !== 404) return { detail: patched.detail, error: "The gateway did not move the agent to the swarm's backers." }
    self.kv.delete('agent')
  }

  const setup = Store.setup(row)
  const instructions = Persona.frozen(self.kv, setup)
  const created = await Gateway.agent(self.env, row.id, { instructions, name: row.title.slice(0, 60), setup })
  if (!created.ok) return { detail: created.detail, error: 'The gateway did not create the agent.' }
  Persona.keep(self.kv, instructions)
  const agent: Lead = { briefed: false, cursor: 0, id: created.value.id, instructed: true, unreachable: null, url: credited }
  self.kv.put('agent', agent)
  self.log('status', "Created the swarm's agent on the gateway. Every model call, machine and tool it uses is paid by the swarm's backers: from the keys they approved, as it spends, and from the money they sent.", created.value.id)
  await Branching.release(self, row.id, created.value.id).catch((error: unknown) => console.error('Releasing the old agent\'s branches failed', error))
  return agent
}

export async function instructed(self: Swarm, row: Store.Row, agent: Lead): Promise<Lead> {
  if (agent.instructed) return agent
  const instructions = Persona.frozen(self.kv, Store.setup(row))
  const patched = await Gateway.instruct(self.env, row.id, agent.id, instructions)
  if (!patched.ok && patched.status !== 409) {
    console.error("Giving the agent the swarm's own instructions failed", patched.status, patched.detail)
    return agent
  }
  Persona.keep(self.kv, instructions)
  const given = { ...agent, instructed: true }
  self.kv.put('agent', given)
  if (patched.ok) self.log('status', "Gave the agent this swarm's own instructions, appended to its system prompt and fixed for the swarm's life, in place of the shared swarm persona.")
  return given
}

export async function finish(self: Swarm, row: Store.Row, run: Turning, report: Gateway.Report) {
  Relay.ended(self)
  self.kv.delete('unpaid')
  const n = run.n
  const error = typeof report.error === 'string' ? report.error : report.error?.message
  const message = report.ok?.message ?? error ?? null
  const status = report.status === 'completed' ? 'completed' : report.status === 'cancelled' ? 'cancelled' : 'failed'
  Follow.flush(self)
  await new Promise((resolve) => setTimeout(resolve, 3_000))
  const money = await Money.refresh(self, row, { credit: true, hands: Follow.handsDue(self, Date.now()) })
  const found = self.ctx.storage.sql
    .exec<{ base: string | null; spent_before: string }>('SELECT spent_before, base FROM turns WHERE n = ?', n)
    .toArray()[0]
  if (self.branched > (self.kv.get<number>('settledAt') ?? 0) || self.born > run.started) {
    self.kv.put('settledAt', Date.now())
    await Branching.settled(self, money.row).catch((error: unknown) => console.error('Settling closed branches failed', error))
  }
  const repo = await Repo.located(self, money.row)
  const commits = repo.state === 'ready' && Follow.cued(self, 'git', run.started) ? await Repo.pushed(self, row.id, repo.name, found?.base ?? null) : []
  if (commits[0]) Repo.saw(self, commits[0].sha)
  const spent = (await charged(self, row, run)) ?? BigInt(money.row.spent) - BigInt(found?.spent_before ?? '0')
  self.ctx.storage.sql.exec(
    'UPDATE turns SET ended_at = ?, status = ?, message = ?, spent = ?, commits = ? WHERE n = ?',
    Date.now(),
    status,
    message === null ? null : redact(message),
    String(spent > 0n ? spent : 0n),
    JSON.stringify(commits.map((commit) => commit.sha)),
    n,
  )
  self.touch()
  const answer = status === 'completed' && message ? Answer.parse(redact(message), Date.now()) : undefined
  if (answer?.text) await Store.update(self.env, row.id, { answer: JSON.stringify(answer) })
  const ended = Feed.rows(self, 'WHERE n = ?', n)[0]
  if (ended) await Search.report(self.env, row.id, ended).catch((error: unknown) => console.error('Indexing the update failed', error))
  const pushed = commits.length ? ` and pushed ${commits.length} commit${commits.length === 1 ? '' : 's'} to ${repo.name}` : ''
  self.log(
    status === 'completed' ? 'status' : 'error',
    status === 'completed' ? `Posted an update after spending ${Words.dollars(spent > 0n ? spent : 0n)}${pushed}.` : `The agent stopped with an error after spending ${Words.dollars(spent > 0n ? spent : 0n)}${pushed}.`,
    status === 'completed' ? (commits.length ? commits.map((commit) => `${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0]}`).join('\n') : null) : message,
  )
  if (Follow.cued(self, 'artifacts', self.kv.get<number>('shelvedAt') ?? 0)) await self.publish(row.id)
  self.changed('detail')
  if (answer?.text) Chat.announce(self, `Update: ${Answer.excerpt(answer.text, 280)}`)

  const stored = self.ctx.storage.sql
    .exec<{ bucket: number; git: number; kv: number }>(
      "SELECT COALESCE(SUM((text || coalesce(detail, '')) LIKE '%kv_set%'), 0) AS kv, COALESCE(SUM((text || coalesce(detail, '')) LIKE '%bucket_put%'), 0) AS bucket, COALESCE(SUM((text || coalesce(detail, '')) LIKE '%git_create%'), 0) AS git FROM feed WHERE seq > ? AND kind = 'tool'",
      run.from,
    )
    .one()
  const kinds = new Set((['kv', 'bucket', 'git'] as const).filter((kind) => stored[kind] > 0 || !self.kv.get<number>('published')))
  if (kinds.size) await expose(self, row, kinds).catch((error: unknown) => console.error('Making the swarm data public failed', error))
  if (status !== 'completed' && (money.left < Store.reserveOf(money.row) || broke(message))) {
    await pause(self, money.row, { left: String(money.left), needs: String(Store.reserveOf(money.row)), wake: null, why: 'money' })
    return null
  }
  const failures = status === 'completed' ? 0 : failing(self, run.since)
  const until = status === 'completed' ? Math.max(Date.now(), run.started + quickMs) : Date.now() + backoff(failures)
  await self.move(money.row, { since: run.since, state: 'waiting', until })
  return until
}

export function settledUsd(report: Gateway.Report | undefined) {
  const usd = report?.spent_usd
  return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? Memo.units(usd.toFixed(6)) : undefined
}

async function charged(self: Swarm, row: Store.Row, run: Turning) {
  const agent = self.agent()?.id
  if (!agent) return undefined
  const report = await Gateway.turn(self.env, row.id, agent, run.turn).catch(() => undefined)
  return report?.ok ? settledUsd(report.value) : undefined
}

export function backoff(failures: number) {
  return failures < maxFailures ? settleMs : Math.min(maxBackoffMs, Clock.minuteMs * 2 ** (failures - maxFailures))
}

async function quiet(self: Swarm, row: Store.Row) {
  const agent = self.agent()?.id
  if (!agent) return true
  const listed = await Gateway.subagents(self.env, row.id, agent)
  return listed.ok && listed.value.every((subagent) => !['pending', 'queued', 'running'].includes(subagent.status.state))
}

export function failing(self: Swarm, since: number) {
  let count = 0
  for (const row of self.ctx.storage.sql.exec<{ status: string }>('SELECT status FROM turns WHERE started_at >= ? ORDER BY n DESC LIMIT ?', since, maxFailures).toArray()) {
    if (row.status === 'completed') break
    count += 1
  }
  return count
}

export async function expose(self: Swarm, row: Store.Row, kinds: ReadonlySet<'bucket' | 'git' | 'kv'> = new Set(['bucket', 'git', 'kv'])) {
  const hidden: ['bucket' | 'git' | 'kv', string][] = []
  for (const [kind, page] of [['kv', (cursor: string | null) => Gateway.values(self.env, row.id, cursor).then((found) => found.ok ? { cursor: found.value.cursor, items: found.value.entries } : undefined)], ['bucket', (cursor: string | null) => Gateway.objects(self.env, row.id, cursor).then((found) => found.ok ? { cursor: found.value.cursor, items: found.value.objects } : undefined)]] as const) {
    if (!kinds.has(kind)) continue
    let cursor: string | null = null
    for (let pages = 0; pages < 20; pages++) {
      const found: { cursor: string | null; items: { key: string; public: boolean }[] } | undefined = await page(cursor)
      if (!found) break
      for (const item of found.items) if (!item.public) hidden.push([kind, item.key])
      cursor = found.cursor
      if (!cursor) break
    }
  }
  const listed = kinds.has('git') ? await Gateway.repos(self.env, row.id) : undefined
  if (listed?.ok) for (const repo of listed.value.repos) if (!repo.public) hidden.push(['git', repo.name])
  let shown = 0
  for (const [kind, name] of hidden) if ((await Gateway.reveal(self.env, row.id, kind, name)).ok) shown++
  self.kv.put('published', Date.now())
  console.log(JSON.stringify({ expose: row.id, hidden: hidden.length, shown }))
  if (shown) self.log('status', `Made ${shown} private item${shown === 1 ? '' : 's'} the agent stored public, so everything the swarm produces can be read by anyone.`, hidden.map(([kind, name]) => `${kind} ${name}`).join('\n'))
}

export async function sweep(self: Swarm, row: Store.Row, why = ', which was still running when the swarm stopped') {
  const started = self.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM feed WHERE seq > ? AND kind = 'machine' AND text LIKE 'Starting machine%'", self.kv.get<number>('sweptSeq') ?? 0).one().n
  if (!started && !(self.kv.get<Hand[]>('hands') ?? []).length) return
  const listed = await Gateway.sandboxes(self.env, row.id)
  if (!listed.ok) return
  self.kv.put('sweptSeq', self.last())
  for (const sandbox of listed.value.sandboxes.filter((found) => found.status !== 'terminated')) {
    const ended = await Gateway.terminate(self.env, row.id, sandbox.sandboxId)
    if (ended.ok) self.log('machine', `Shut down ${sandbox.hand ?? sandbox.sandboxId}${why}.`)
  }
}

export async function pause(self: Swarm, row: Store.Row, pause: Phase.Pause) {
  const run = self.run()
  if (run.state === 'paused' && Phase.same(run.pause, pause)) return
  const text = Phase.reason(pause)
  if (Phase.since(run) !== null) {
    if (pause.why === 'rest' || pause.why === 'idle') await sweep(self, row)
    if (self.turned()) Chat.announce(self, text)
  }
  const shown = Phase.paused(run)
  await self.move(row, { at: Date.now(), pause, state: 'paused' })
  if (shown?.why !== pause.why) self.log('status', text)
  const alarm = await self.ctx.storage.getAlarm()
  if (alarm === null || alarm > Date.now() + settleMs) await self.ctx.storage.setAlarm(Date.now() + settleMs)
}

export async function settle(self: Swarm, row: Store.Row, run: { at: number; pause: Phase.Pause }) {
  if (run.pause.why === 'unfunded' || (self.kv.get<number>('settled') ?? 0) >= run.at) return null
  if (Date.now() < run.at + settleMs) return run.at + settleMs
  if (!(await quiet(self, row))) return Date.now() + Clock.minuteMs
  const money = await Money.refresh(self, row)
  self.kv.put('settled', Date.now())
  const refused = run.pause.why === 'money' && run.pause.needs !== undefined && BigInt(run.pause.left) >= BigInt(run.pause.needs)
  if (!refused && money.left >= Store.reserveOf(money.row)) self.set({ from: run.pause, since: null, state: 'waiting', until: Date.now() })
  return null
}
