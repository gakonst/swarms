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
import * as Work from './Work.ts'
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
  return !!message && (message.includes("This app's credit has $") || message.includes(' was not paid: '))
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

export const leaseMs = 30 * 60_000

const sendingMs = 5 * 60_000

export const retry: Work.Retry = { backoffMs: 15_000, maxAttempts: 8 }

export const paying: Work.Retry = { backoffMs: Phase.rereadMs, maxAttempts: retry.maxAttempts }

export const noteboard = 'notes'

const resetsToRenew = 2

const quickMs = 60_000

const settleMs = 15_000

const calmMs = 10 * 60_000

export async function step(self: Swarm) {
  const id = self.kv.get<string>('id')
  const row = id ? await self.found(id) : null
  if (!row) return null

  if (await self.project(row)) self.beacon(row)
  const run = self.run()
  if (run.state === 'paused') {
    const settling = await settle(self, row, run)
    if (self.run().state === 'paused') return settling
  }
  if (run.state === 'working') return Follow.follow(self, row, await adopted(self, run))
  return advance(self, row)
}

async function posted(self: Swarm, n: number) {
  const live = (await self.board.tasks()).find((found) => found.labels['kind'] === 'turn' && !Work.terminal(found.phase))
  if (live) return live.id
  for (let k = 0; ; k++) {
    const id = k ? `turn:${n}.${k}` : `turn:${n}`
    const found = await self.board.task(id)
    if (found && Work.terminal(found.phase)) continue
    if (!found) await Work.ensure(self.board, { id, labels: { kind: 'turn' }, spec: `turn ${n}`, terms: { retry } })
    return id
  }
}

async function adopted(self: Swarm, run: Turning): Promise<Turning> {
  if (run.task && run.claim) return run
  const task = await posted(self, run.n)
  const claimed = await self.board.claim(task, { leaseMs })
  if (!claimed.ok) return run
  leased(self, task, claimed.untilMs)
  const next = { ...run, claim: claimed.claim, task }
  self.set(next)
  return next
}

type Taken = { claim: string; task: string } | { untilMs: number }

async function take(self: Swarm, run: Phase.Run): Promise<Taken> {
  const board = self.board
  const now = Date.now()
  const task = await posted(self, self.turned() + 1)
  const found = await board.task(task)
  if (found?.phase === 'claimed' && found.claim) {
    const ours = found.claim === Phase.sent(run)?.id
    if (ours && (await board.renew(task, found.claim, sendingMs)).ok) return { claim: found.claim, task }
    if (!ours) await board.release(task, found.claim, 'its holder restarted')
  }
  const claimed = await board.claim(task, { leaseMs: sendingMs })
  if (claimed.ok) return { claim: claimed.claim, task }
  if (claimed.rejection.kind === 'Terminal' || claimed.rejection.kind === 'UnknownTask') {
    const next = await posted(self, self.turned() + 1)
    const again = await board.claim(next, { leaseMs: sendingMs })
    if (again.ok) return { claim: again.claim, task: next }
  }
  const rejection = claimed.rejection
  return { untilMs: rejection.untilMs ?? (await board.task(task))?.dueAtMs ?? now + Clock.retryMs }
}

async function attempted(self: Swarm, task: string, claim: string, outcome: Work.Outcome, blamed = true) {
  const verdict = await self.board.finish(task, claim, outcome)
  const left = await self.board.task(task)
  if (verdict.ok && blamed && left?.phase === 'failed') exhausted(self, left.attempts, 'failed' in outcome ? outcome.failed : '')
  return { attempts: left?.attempts ?? 1, due: left?.phase === 'open' ? (left.dueAtMs ?? Date.now()) : undefined, finished: verdict.ok }
}

function exhausted(self: Swarm, attempts: number, detail: string) {
  const agent = self.agent()
  if (!agent) return
  self.kv.delete('agent')
  self.log('error', `The agent's turn failed ${attempts} tries in a row, so the swarm starts a new agent with its goal, notes and updates; the old agent's workspace stays behind.`, `${agent.id}: ${detail}`)
}

export async function lease(self: Swarm, run: Turning) {
  return run.task ? (await self.board.task(run.task))?.untilMs : undefined
}

function leased(self: Swarm, task: string, untilMs: number) {
  self.kv.put('lease', { task, untilMs })
}

export function progress(self: Swarm, run: Turning) {
  const lease = self.kv.get<{ task: string; untilMs: number }>('lease')
  const until = lease && lease.task === run.task ? lease.untilMs : undefined
  return { progressed: Math.max(until === undefined ? 0 : until - leaseMs, run.started), stalled: until !== undefined && until - Date.now() <= leaseMs / 3 }
}

export const failsToStick = 2

export function stuck(self: Swarm) {
  const run = self.run()
  if (run.state === 'new' || run.state === 'paused') return false
  if (run.state === 'working') {
    if (progress(self, run).stalled) return true
    if ((self.kv.get<number>('advanced') ?? 0) >= run.started) return false
  }
  const ended = self.ctx.storage.sql.exec<{ spent: string; status: string }>('SELECT status, spent FROM turns WHERE ended_at IS NOT NULL ORDER BY n DESC LIMIT ?', failsToStick).toArray()
  return ended.length === failsToStick && ended.every((turn) => turn.status !== 'completed' && BigInt(turn.spent) === 0n)
}

export async function progressed(self: Swarm) {
  const run = self.run()
  const at = self.kv.get<number>('advanced') ?? 0
  if (run.state !== 'working' || !run.task || !run.claim || at <= progress(self, run).progressed) return
  const until = Work.until(await self.board.renew(run.task, run.claim, leaseMs))
  if (until !== undefined) leased(self, run.task, until)
}

export function heard(self: Swarm, run: Turning): Phase.Told[] {
  const found = self.kv.get<{ told: Phase.Told[]; turn: string }>('heard')
  return found?.turn === run.turn ? found.told : []
}

export function hear(self: Swarm, run: Turning, told: Phase.Told) {
  self.kv.put('heard', { told: [...heard(self, run), told], turn: run.turn })
}

function said(steer: Work.Steer): Phase.Told {
  const { note, weight } = JSON.parse(steer.body) as { note: string; weight: string }
  return [note, weight]
}

export async function pending(self: Swarm) {
  return new Set((await self.board.steers(noteboard)).map((steer) => said(steer)[0]))
}

export async function steer(self: Swarm, told: readonly Phase.Told[]) {
  await Work.ensure(self.board, { id: noteboard, labels: Work.instance, spec: "backers' notes" })
  for (const [note, weight] of told) await self.board.steer(noteboard, JSON.stringify({ note, weight }), { key: `${note}:${weight}` })
}

export async function heed(self: Swarm, told: readonly Phase.Told[]) {
  if (!told.length) return
  await steer(self, told)
  const board = self.board
  const wanted = new Set(told.map(([note, weight]) => `${note}:${weight}`))
  const upto = (await board.steers(noteboard)).filter((found) => wanted.has(said(found).join(':'))).at(-1)
  const held = upto && (await Work.lock(board, noteboard, Clock.minuteMs))
  if (upto && held?.ok) {
    await board.heed(noteboard, held.claim, upto.seq)
    await board.release(noteboard, held.claim)
  }
  const at = Date.now()
  for (const [note, weight] of told) {
    self.ctx.storage.sql.exec('INSERT OR REPLACE INTO steered (note, at, weight) VALUES (?, ?, ?)', note, at, weight)
    self.kv.delete('collapse:' + note)
  }
}

export async function remodel(self: Swarm, row: Store.Row): Promise<Store.Row | { detail: string; error: string }> {
  const setup = Store.setup(row)
  if (!setup || ![setup.model, ...(setup.subagents?.models ?? [])].some(Setup.direct)) return row
  const prices = await Gateway.prices(self.env)
  if (!prices) return row
  const next = Setup.moved(setup, prices)
  if (!next) return row
  const priced = Setup.priced(next, prices)
  if (typeof priced === 'string') return { detail: priced, error: 'The swarm could not be moved to models the gateway meters.' }
  await Store.update(self.env, row.id, { setup: JSON.stringify(priced) })
  const moved = { ...row, setup: JSON.stringify(priced) }
  self.remember(moved)
  self.kv.delete('agent')
  self.kv.delete('instructions')
  self.log('status', `Moved the swarm off Boundless: it runs on ${Setup.name(priced.model)} now, which the gateway charges for by what each call uses. It starts a new agent, which keeps the repository, the results and the notes.`, `${setup.model} -> ${priced.model}`)
  self.changed('detail')
  return moved
}

function held(self: Swarm, run: Phase.Run, taken: Taken) {
  if (!('untilMs' in taken)) return undefined
  if (run.state === 'starting') self.set({ since: run.since, state: 'waiting', until: taken.untilMs })
  return taken.untilMs
}

async function stumble(self: Swarm, row: Store.Row, run: Phase.Run, error: string, detail: string) {
  const taken = await take(self, run)
  return held(self, run, taken) ?? ('claim' in taken ? fail(self, row, taken.task, taken.claim, error, detail) : null)
}

export async function advance(self: Swarm, found: Store.Row) {
  const run = self.run()
  const remodeled = await remodel(self, found)
  if ('error' in remodeled) return stumble(self, found, run, remodeled.error, remodeled.detail)
  const row = remodeled
  const worked = self.turned()
  const money = await Money.refresh(self, row, { credit: true, hands: Follow.handsDue(self, Date.now()) })
  if (run.state !== 'starting' && money.left < Store.reserveOf(money.row)) {
    if (!money.known) return stumble(self, money.row, run, 'The gateway did not say how much money the swarm has.', 'Reading its credit and backings failed, so the last figures were not taken as the answer.')
    await pause(self, money.row, worked || money.row.contributors ? { balance: String(money.row.balance), left: String(money.left), needs: String(Store.reserveOf(money.row)), wake: null, why: 'money' } : { why: 'unfunded' })
    return null
  }
  const taken = await take(self, run)
  const later = held(self, run, taken)
  if (later !== undefined || !('claim' in taken)) return later ?? null
  const { claim, task } = taken
  const repo = await Repo.located(self, row)

  const agent = await lead(self, row)
  if ('error' in agent) return fail(self, money.row, task, claim, agent.error, agent.detail)

  const n = run.state === 'starting' ? run.n : worked + 1
  const since = Phase.since(run)
  const notes = await self.notes(money.row)
  const seen = self.kv.get<string>('seen')
  const base = repo.state !== 'ready' ? null : seen && !Follow.cued(self, 'git', self.kv.get<number>('seenAt') ?? 0) ? seen : await Repo.head(self, row.id, repo.name)
  if (base) Repo.saw(self, base)
  else self.kv.delete('seen')
  const told = self.told()
  const waiting = await pending(self)
  const included = agent.briefed ? notes.filter((note) => waiting.has(note.id) || grown(told.get(note.id), Memo.units(note.weight))) : notes
  const repoLine = repoed(repo, money.left)
  const room = roomed(Site.home(self.env), row.id)
  const text = agent.briefed
    ? next(self.tell(included), repo.state === 'ready' ? '' : repoLine, Persona.frozen(self.kv, Store.setup(row)).includes(Persona.roomless) ? room : '')
    : brief(money.row, self.tell(notes), repoLine, room)
  const tried = Phase.sent(run)
  const again = tried?.id === claim ? tried : undefined
  const start: Extract<Phase.Run, { state: 'starting' }> =
    run.state === 'starting' && run.id === claim
      ? run
      : { ...(Phase.again(run) ? { again: true } : {}), balance: String(money.row.balance), id: claim, n, prompt: again?.prompt ?? text, since, state: 'starting', told: again?.told ?? included.map((note) => [note.id, String(Memo.units(note.weight))]) }
  const prompt = start.prompt ?? text
  await self.move(money.row, start)
  const credentials = money.row.ai ? Gateway.subject(money.row.ai) : undefined
  const sent = await Gateway.prompt(self.env, row.id, agent.id, { ...(credentials ? { credentials } : {}), id: claim, prompt, steer: false })
  if (!sent.ok && credentials && sent.status === 400) {
    await Store.host(self.env, row.id, null)
    self.hosted(row.id)
    return Date.now()
  }
  if (!sent.ok && sent.status !== 409) {
    if (sent.status === 404) self.kv.delete('agent')
    if (sent.status < 500) return fail(self, money.row, task, claim, 'The gateway did not take the next message for the agent.', sent.detail)
    failed(self, 'The gateway did not take the next message for the agent.', sent.detail)
    const until = Date.now() + Clock.retryMs
    await self.move(money.row, { sent: { id: claim, prompt, told: start.told }, since, state: 'waiting', until })
    return until
  }

  const now = Date.now()
  const turn = sent.ok ? sent.value.request_id : claim
  const until = Work.until(await self.board.renew(task, claim, leaseMs))
  if (until !== undefined) leased(self, task, until)
  await Money.cap(self, row, money.left / Hands.share, money.listed)
  self.kv.put('agent', { ...(self.agent() ?? agent), briefed: true })
  self.ctx.storage.sql.exec(
    "INSERT OR REPLACE INTO turns (n, turn, started_at, status, spent_before, base) VALUES (?, ?, ?, 'running', ?, ?)",
    n,
    turn,
    now,
    String(money.row.spent),
    base,
  )
  await heed(self, start.told)
  for (const note of notes.filter((found) => told.get(found.id) === null)) self.ctx.storage.sql.exec('UPDATE steered SET weight = ? WHERE note = ? AND weight IS NULL', String(Memo.units(note.weight)), note.id)
  self.touch()
  await self.move(money.row, { ...(start.again ? { again: true } : {}), balance: start.balance, from: self.last(), n, since: start.since ?? now, started: now, state: 'working', task, turn, claim }, { rounds: n })
  Relay.begin(self)
  self.log('status', start.since === null ? `${worked ? 'Back at work' : 'Started working'}.` : 'Told the agent to keep going.', prompt)
  if (start.since === null && !start.again) Chat.announce(self, `${worked ? 'Back at work' : 'Started working'}.`)
  return now + Clock.followMs
}

async function fail(self: Swarm, row: Store.Row, task: string, claim: string, error: string, detail: string) {
  const run = self.run()
  failed(self, error, detail)
  const until = (await attempted(self, task, claim, { failed: `${error} ${detail}` })).due ?? Date.now()
  await self.move(row, { since: Phase.since(run), state: 'waiting', until })
  return until
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
  const sent = Phase.sent(run)
  if (run.state === 'starting') self.set({ ...(sent ? { sent } : {}), since: run.since, state: 'waiting', until: now + Clock.retryMs })
  return now + Clock.retryMs
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
  const agent: Lead = { briefed: false, cursor: 0, id: created.value.id, instructed: true, url: credited }
  self.kv.put('agent', agent)
  self.log('status', "Created the swarm's agent on the gateway. Every model call, machine and tool it uses is paid from the money the swarm's riders sent, which the gateway holds as its credit.", created.value.id)
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
  const money = await Money.refresh(self, (await self.found(row.id)) ?? row, { credit: true, hands: Follow.handsDue(self, Date.now()) })
  const found = self.ctx.storage.sql
    .exec<{ base: string | null; spent_before: string }>('SELECT spent_before, base FROM turns WHERE n = ?', n)
    .toArray()[0]
  if (Math.max(self.branched, self.born) > (self.kv.get<number>('settledAt') ?? 0))
    await Branching.settled(self, money.row).catch((error: unknown) => console.error('Settling closed branches failed', error))
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
  const ended = Feed.rows(self, 'WHERE n = ?', n)[0]
  const task = run.task
  await heed(self, heard(self, run))
  self.kv.delete('heard')
  const grew = run.balance !== undefined && BigInt(money.row.balance) > BigInt(run.balance)
  const short = money.known && money.left < Store.reserveOf(money.row)
  const refused = status !== 'completed' && (short || (broke(message) && !grew))
  const attempt = task && run.claim ? await attempted(self, task, run.claim, status === 'completed' ? { done: message ?? '' } : { failed: message ?? status }, !refused) : { attempts: 1, due: undefined, finished: true }
  await Work.once(self.board, `d1:${task ?? `turn:${n}`}#${n}`, Clock.minuteMs, () => projected(self, row.id, answer, ended))
  const pushed = commits.length ? ` and pushed ${commits.length} commit${commits.length === 1 ? '' : 's'} to ${repo.name}` : ''
  self.log(
    status === 'completed' ? 'status' : 'error',
    status === 'completed' ? `Posted an update after spending ${Words.dollars(spent > 0n ? spent : 0n)}${pushed}.` : `The agent stopped with an error after spending ${Words.dollars(spent > 0n ? spent : 0n)}${pushed}.`,
    status === 'completed' ? (commits.length ? commits.map((commit) => `${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0]}`).join('\n') : null) : message,
  )
  if (attempt.finished && Follow.cued(self, 'artifacts', self.kv.get<number>('shelvedAt') ?? 0)) await self.publish(row.id)
  self.changed('detail')
  if (answer?.text) Chat.announce(self, `Update: ${Answer.brief(answer.text, 280)}`)

  const stored = self.ctx.storage.sql
    .exec<{ bucket: number; git: number; kv: number }>(
      "SELECT COALESCE(SUM((text || coalesce(detail, '')) LIKE '%kv_set%'), 0) AS kv, COALESCE(SUM((text || coalesce(detail, '')) LIKE '%bucket_put%'), 0) AS bucket, COALESCE(SUM((text || coalesce(detail, '')) LIKE '%git_create%'), 0) AS git FROM feed WHERE seq > ? AND kind = 'tool'",
      run.from,
    )
    .one()
  const kinds = new Set((['kv', 'bucket', 'git'] as const).filter((kind) => stored[kind] > 0 || !self.kv.get<number>('published')))
  if (kinds.size) await expose(self, row, kinds).catch((error: unknown) => console.error('Making the swarm data public failed', error))
  if (refused) {
    await pause(self, money.row, { balance: String(money.row.balance), left: String(money.left), needs: String(Store.reserveOf(money.row)), wake: short ? null : Date.now() + Work.delay(paying, attempt.attempts), why: 'money' })
    return null
  }
  const renewed = status !== 'completed' && resets(self) >= resetsToRenew && renew(self, message)
  const until = status === 'completed' ? Math.max(Date.now(), run.started + quickMs) : renewed ? Date.now() : (attempt.due ?? Date.now())
  await self.move(money.row, { since: run.since, state: 'waiting', until })
  return until
}

async function projected(self: Swarm, swarm: string, answer: ReturnType<typeof Answer.parse> | undefined, ended: Search.Turn | undefined) {
  if (answer?.text) await Store.update(self.env, swarm, { answer: JSON.stringify(answer) })
  if (ended) await Search.report(self.env, swarm, ended).catch((error: unknown) => console.error('Indexing the update failed', error))
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

async function quiet(self: Swarm, row: Store.Row) {
  const agent = self.agent()?.id
  if (!agent) return true
  const listed = await Gateway.subagents(self.env, row.id, agent)
  if (!listed.ok) return listed.status < 500
  return listed.value.every((subagent) => !['pending', 'queued', 'running'].includes(subagent.status.state))
}

export function reset(message: string | null) {
  return !!message && /session was reset/i.test(message)
}

export function resets(self: Swarm) {
  const since = self.kv.get<number>('renewedAt') ?? 0
  let count = 0
  for (const row of self.ctx.storage.sql.exec<{ message: string | null; status: string }>('SELECT status, message FROM turns WHERE started_at >= ? ORDER BY n DESC LIMIT ?', since, resetsToRenew).toArray()) {
    if (row.status === 'completed' || !reset(row.message)) break
    count += 1
  }
  return count
}

function renew(self: Swarm, message: string | null) {
  const agent = self.agent()
  if (!agent) return false
  self.kv.delete('agent')
  self.kv.put('renewedAt', Date.now())
  self.log('error', `The agent's session was reset and could not recover ${resetsToRenew} turns in a row, so the swarm starts a new agent with its goal, notes and updates; the repository stays, the old conversation does not.`, `${agent.id}: ${message === null ? '' : redact(message)}`)
  return true
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
    if (self.turned() && !(Phase.again(run) && Phase.refused(pause))) Chat.announce(self, text)
  }
  const shown = Phase.paused(run)
  const at = Date.now()
  await self.move(row, { at, pause, ...(pause.why === 'unfunded' ? { settled: at } : {}), state: 'paused' })
  if (shown?.why !== pause.why) self.log('status', text)
  const alarm = await self.ctx.storage.getAlarm()
  if (alarm === null || alarm > Date.now() + settleMs) await self.ctx.storage.setAlarm(Date.now() + settleMs)
}

export async function settle(self: Swarm, row: Store.Row, run: Phase.Paused) {
  const now = Date.now()
  if (!Phase.unread(run, now)) return Phase.waking(run, now)
  if (now < run.at + settleMs) return run.at + settleMs
  if (run.settled === undefined && now < run.at + calmMs && !(await quiet(self, row))) return now + Clock.minuteMs
  const money = await Money.refresh(self, row, { credit: true, hands: run.settled === undefined })
  const paused = self.run()
  if (paused.state !== 'paused' || paused.at !== run.at) return null
  if (!money.known) return Date.now() + Clock.minuteMs
  if (Phase.resumes(run.pause, { balance: BigInt(money.row.balance), due: Phase.due(run, Date.now()), left: money.left, reserve: Store.reserveOf(money.row) })) {
    self.set({ from: run.pause, since: null, state: 'waiting', until: Date.now() })
    return null
  }
  self.set({ ...paused, settled: Date.now() })
  return Phase.waking(run, Date.now())
}
