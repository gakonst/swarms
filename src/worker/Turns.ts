import * as Feed from './Feed.ts'
import type { Hand, Note } from '../shared/Api.ts'
import { redact } from '../shared/Trail.ts'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Setup from '../shared/Setup.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Persona from './Persona.ts'
import * as Phase from './Phase.ts'
import * as Search from './Search.ts'
import * as Store from './Store.ts'
import * as Words from './Words.ts'
import * as Relay from './Relay.ts'
import * as Clock from './Clock.ts'
import * as Paying from './Paying.ts'
import * as Money from './Money.ts'
import * as Follow from './Follow.ts'
import * as Repo from './Repo.ts'
import * as Branching from './Branching.ts'
import * as Chat from './Chat.ts'
import type { Lead, Swarm, Turning } from './Swarm.ts'

function brief(row: Store.Row, notes: Note[]) {
  const setup = Store.setup(row)
  return [row.title, row.goal, setup ? Setup.told(setup) : '', ...notes.map(weighed)].filter(Boolean).join('\n\n')
}

function next(notes: Note[]) {
  return ['Keep going.', ...notes.map(weighed)].join('\n\n')
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

export async function step(self: Swarm) {
  const id = self.kv.get<string>('id')
  const row = id ? await self.found(id) : null
  if (!row) return null

  initialize(self)
  const run = self.run()
  if (run.state === 'paused') {
    if (!Phase.due(run, Date.now())) return run.pause.why === 'money' ? run.pause.wake : null
    self.set({ from: run.pause, since: null, state: 'waiting', until: Date.now() })
  }
  if (run.state === 'working') return Follow.follow(self, row, run)
  return advance(self, row)
}

export function initialize(self: Swarm) {
  if (self.kv.get<string>('secret')) return
  const run = self.run()
  if (run.state === 'working') self.ctx.storage.sql.exec("UPDATE turns SET status = 'cancelled', ended_at = ? WHERE n = ? AND status = 'running'", Date.now(), run.n)
  if (run.state === 'working' || run.state === 'starting') self.set({ since: null, state: 'waiting', until: Date.now() })
  self.kv.delete('agent')
  self.kv.put('secret', Words.hex(crypto.getRandomValues(new Uint8Array(32))))
}

export async function advance(self: Swarm, row: Store.Row) {
  const run = self.run()
  const worked = self.turned()
  await Money.fund(self, row)
  const money = await Money.refresh(self, row, { chain: true, hands: Follow.handsDue(self, Date.now()), sponsors: true })
  if (run.state !== 'starting' && money.left < Store.reserveOf(money.row)) {
    const wake = Paying.rested(self)
    await pause(self, money.row, worked || money.row.contributors ? { left: String(money.left), needs: String(Store.reserveOf(money.row)), wake, why: 'money' } : { why: 'unfunded' })
    return wake
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
  const text = agent.briefed ? next(self.tell(included)) : brief(money.row, self.tell(notes))
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
  const last = run.state === 'waiting' ? run.retry : undefined
  const repeat = last?.error === error
  const logged = last && repeat && now - last.logged < Clock.quietMs ? last.logged : now
  if (logged === now) self.log('error', error, detail)
  await self.move(row, {
    ...(run.state === 'waiting' && run.from ? { from: run.from } : {}),
    retry: { count: (last && repeat ? last.count : 0) + 1, error, logged },
    since: Phase.since(run),
    state: 'waiting',
    until: now + Clock.retryMs,
  })
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

export async function lead(self: Swarm, row: Store.Row): Promise<Lead | { detail: string; error: string }> {
  const payer = { secret: self.kv.get<string>('secret') ?? '', url: `${self.env.SWARMS_URL}/api/swarms/${row.id}/pay` }
  const known = self.agent()
  if (known) {
    if (known.url === payer.url) return restyled(self, row, known)
    const patched = await Gateway.repay(self.env, row.id, known.id, payer)
    if (patched.ok) {
      const moved = { ...known, url: payer.url }
      self.kv.put('agent', moved)
      return restyled(self, row, moved)
    }
    if (patched.status !== 404) return { detail: patched.detail, error: "The gateway did not move the agent's payer." }
    self.kv.delete('agent')
  }

  const styled = await Persona.ensure(self.env, self.kv)
  const named = { name: row.title.slice(0, 60), payer, setup: Store.setup(row) }
  let created = await Gateway.agent(self.env, row.id, styled ? { ...named, persona: Persona.name } : named)
  const persona = styled && created.ok
  if (!created.ok && styled && created.status === 409) created = await Gateway.agent(self.env, row.id, named)
  if (!created.ok) return { detail: created.detail, error: 'The gateway did not create the agent.' }
  const agent: Lead = { briefed: false, cursor: 0, id: created.value.id, persona, unreachable: null, url: payer.url }
  self.kv.put('agent', agent)
  self.log('status', "Created the swarm's agent on the gateway. Every model call, machine and tool it pays for is paid from the contributions, one at a time.", created.value.id)
  await Branching.release(self, row.id, created.value.id).catch((error: unknown) => console.error('Releasing the old agent\'s branches failed', error))
  return agent
}

export async function restyled(self: Swarm, row: Store.Row, agent: Lead): Promise<Lead> {
  if (!(await Persona.ensure(self.env, self.kv)) || agent.persona) return agent
  const patched = await Gateway.restyle(self.env, row.id, agent.id, Persona.name)
  if (!patched.ok && patched.status !== 409) {
    console.error('Giving the agent the swarm persona failed', patched.status, patched.detail)
    return agent
  }
  const styled = { ...agent, persona: true }
  self.kv.put('agent', styled)
  if (patched.ok) self.log('status', "Gave the agent the swarm's instructions on artifacts, appended to its system prompt.")
  return styled
}

export async function finish(self: Swarm, row: Store.Row, run: Turning, report: Gateway.Report) {
  Relay.ended(self)
  const n = run.n
  const error = typeof report.error === 'string' ? report.error : report.error?.message
  const message = report.ok?.message ?? error ?? null
  const status = report.status === 'completed' ? 'completed' : report.status === 'cancelled' ? 'cancelled' : 'failed'
  Follow.flush(self)
  await new Promise((resolve) => setTimeout(resolve, 3_000))
  for (const source of await Paying.sources(self, row)) await Paying.probe(self, row, source).catch(() => undefined)
  const money = await Money.refresh(self, row, { chain: true, hands: Follow.handsDue(self, Date.now()), sponsors: true })
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
  const spent = BigInt(money.row.spent) - BigInt(found?.spent_before ?? '0')
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
  const latest = self.run()
  const wanted = BigInt(latest.state === 'working' ? (latest.wanted ?? '0') : '0')
  if (status !== 'completed' && (money.left < Store.reserveOf(money.row) || wanted > money.biggest)) {
    const wake = Paying.rested(self)
    await pause(self, money.row, wanted > money.biggest ? { wanted: String(wanted), why: 'costly' } : { left: String(money.left), needs: String(Store.reserveOf(money.row)), wake, why: 'money' })
    return wanted > money.biggest ? null : wake
  }
  if (status === 'completed') {
    self.kv.delete('squeezes')
    self.kv.delete('squeezedTurns')
  } else if ((self.kv.get<number>('squeezed') ?? 0) >= run.started) return squeeze(self, money.row, run)
  const failures = status === 'completed' ? 0 : failing(self, run.since)
  if (failures >= maxFailures) {
    await pause(self, money.row, { failures, why: 'rest' })
    return null
  }
  if (status === 'completed' && message && waiting(message) && (await quiet(self, row))) {
    await pause(self, money.row, { why: 'idle' })
    return null
  }
  const until = status === 'completed' ? Math.max(Date.now(), run.started + quickMs) : Date.now() + settleMs
  await self.move(money.row, { since: run.since, state: 'waiting', until })
  return until
}

export function waiting(message: string) {
  return /(?:^|\n)[\s*_]*Waiting for backers\.?[\s*_]*$/.test(message.trim())
}

async function quiet(self: Swarm, row: Store.Row) {
  const agent = self.agent()?.id
  if (!agent) return true
  const listed = await Gateway.subagents(self.env, row.id, agent)
  return listed.ok && listed.value.every((subagent) => !['pending', 'queued', 'running'].includes(subagent.status.state))
}

export function failing(self: Swarm, since: number) {
  const squeezed = new Set(self.kv.get<number[]>('squeezedTurns') ?? [])
  let count = 0
  for (const row of self.ctx.storage.sql.exec<{ n: number; status: string }>('SELECT n, status FROM turns WHERE started_at >= ? ORDER BY n DESC LIMIT ?', since, maxFailures + squeezed.size).toArray()) {
    if (row.status === 'completed') break
    if (!squeezed.has(row.n)) count += 1
  }
  return count
}

export function squeezing(count: number): { wait: number } | 'sweep' | 'rest' {
  if (count >= 2 * maxFailures) return 'rest'
  if (count === maxFailures) return 'sweep'
  return { wait: count < maxFailures ? Clock.minuteMs * 2 ** (count - 1) : settleMs }
}

async function squeeze(self: Swarm, row: Store.Row, run: Turning) {
  const count = (self.kv.get<number>('squeezes') ?? 0) + 1
  self.kv.put('squeezes', count)
  self.kv.put('squeezedTurns', [...(self.kv.get<number[]>('squeezedTurns') ?? []), run.n])
  const step = squeezing(count)
  if (step === 'rest') {
    await pause(self, row, { failures: count, why: 'rest' })
    return null
  }
  if (step === 'sweep') {
    await sweep(self, row, ` to return its prepaid time: the gateway found no room on the swarm's contributions for the agent's next model call ${count} times in a row`)
    const money = await Money.refresh(self, row)
    if (money.left < Store.reserveOf(money.row)) {
      const wake = Paying.rested(self)
      await pause(self, money.row, { left: String(money.left), needs: String(Store.reserveOf(money.row)), wake, why: 'money' })
      return wake
    }
  }
  const until = Date.now() + (step === 'sweep' ? settleMs : step.wait)
  await self.move(row, { since: run.since, state: 'waiting', until })
  return until
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
}
