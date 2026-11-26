import { Board } from 'nanocode-ts'
import * as Memo from '../shared/Memo.ts'
import * as Setup from '../shared/Setup.ts'
import type * as Tree from '../shared/Tree.ts'
import { type Thinking, call, clip, gist, named, placed, redact } from '../shared/Trail.ts'
import * as Flow from './Flow.ts'
import * as Follow from './Follow.ts'
import * as Gateway from './Gateway.ts'
import * as Machine from './machines/Tree.ts'
import * as Nodes from './Nodes.ts'
import * as Persona from './Persona.ts'
import * as Phase from './Phase.ts'
import * as Sub from './machines/Sub.ts'
import type { Swarm } from './Swarm.ts'
import * as Triage from './Triage.ts'
import * as Verify from './Verify.ts'
import * as Work from './Work.ts'
import * as Limits from '../shared/Limits.ts'

export const timing: Record<keyof typeof Limits.Runner.timing, number> = { ...Limits.Runner.timing }

export const rotateAfter = Limits.Runner.rotateAfter

export const verifiers = Limits.Runner.verifiers

export const guards = { adopt: true, bound: true, claims: true, folded: true, halt: true, heard: true, kick: true, late: true, needs: true, relay: true, rest: true, rotate: true, stray: true, topped: true }

export const paying: Work.Retry = { backoffMs: Phase.rereadMs, maxAttempts: Limits.Runner.payingAttempts }

const finished = new Set(['completed', 'failed', 'closed', 'interrupted'])

export type Busy = { held: Thinking | undefined; nid: string; sent: number; task: string; timer: ReturnType<typeof setTimeout> | undefined }

export type Runtime = {
  aborts: Map<string, AbortController>
  claims: Set<string>
  doing: Map<string, Busy>
  first: boolean
  follow: { agent: string; stop: AbortController; up: boolean } | undefined
  heard: number
  kicks: Set<() => void>
  lating?: Promise<void> | undefined
  listing: { agent: string; at: number; value: Promise<Gateway.Result<Gateway.Subagent[]>> } | undefined
  pools: { runs?: Board.Pool; verifies?: Board.Pool }
  waiters: Set<() => void>
}

export type Dispatcher = { at: number; id: string; runs: number }

export function runtime(self: Swarm): Runtime {
  return (self.runtime ??= { aborts: new Map(), claims: new Set(), doing: new Map(), first: true, follow: undefined, heard: 0, kicks: new Set(), listing: undefined, pools: {}, waiters: new Set() })
}

export function wake(self: Swarm) {
  const rt = runtime(self)
  const woken = [...rt.waiters]
  rt.waiters.clear()
  for (const waiter of woken) waiter()
}

function wait(ms: number, self: Swarm, signal?: AbortSignal) {
  const rt = runtime(self)
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      rt.waiters.delete(done)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    rt.waiters.add(done)
    signal?.addEventListener('abort', done, { once: true })
  })
}

export const output = {
  additionalProperties: false,
  properties: {
    children: {
      items: {
        additionalProperties: false,
        properties: { needs: { items: { type: 'string' }, type: 'array' }, spec: { type: 'string' }, statement: { type: ['string', 'null'] }, title: { type: 'string' } },
        required: ['title', 'spec', 'statement', 'needs'],
        type: 'object',
      },
      type: 'array',
    },
    commit: { type: ['string', 'null'] },
    outcome: { enum: ['proved', 'refuted', 'split', 'progress', 'stuck'], type: 'string' },
    summary: { type: 'string' },
    theorem: { type: ['string', 'null'] },
    why: { type: ['string', 'null'] },
  },
  required: ['outcome', 'summary', 'commit', 'theorem', 'children', 'why'],
  type: 'object',
}

export function json(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  const tries = [text, text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
  for (const candidate of tries) {
    if (!candidate) continue
    try {
      const value: unknown = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    } catch {}
  }
  return null
}

const outcomes = new Set(['proved', 'refuted', 'split', 'progress', 'stuck'])

function text(value: unknown, most = 4000) {
  return typeof value === 'string' && value.trim() ? clip(value.trim(), most) : null
}

export function result(raw: string | undefined, fallback: string): Nodes.Result {
  const value = json(raw)
  if (!value) return { children: [], commit: null, outcome: raw?.trim() ? 'progress' : 'stuck', summary: clip(raw?.trim() || fallback, 200), theorem: null, why: null }
  const outcome = typeof value['outcome'] === 'string' && outcomes.has(value['outcome']) ? (value['outcome'] as Nodes.Result['outcome']) : 'progress'
  const children = Array.isArray(value['children'])
    ? value['children'].flatMap((child: unknown) => {
        if (!child || typeof child !== 'object') return []
        const one = child as Record<string, unknown>
        const title = text(one['title'], 200)
        if (!title) return []
        return [{ needs: guards.needs && Array.isArray(one['needs']) ? one['needs'].filter((need): need is string => typeof need === 'string').slice(0, 20) : [], spec: text(one['spec']) ?? '', statement: text(one['statement']), title }]
      })
    : []
  const commit = text(value['commit'], 64)?.toLowerCase() ?? null
  return { children, commit, outcome, summary: text(value['summary'], 200) ?? fallback, theorem: text(value['theorem'], 200), why: text(value['why']) }
}

function leased(self: Swarm) {
  return Number((self.env as unknown as Record<string, unknown>)['SWARMS_LEASE_MS']) || timing.leaseMs
}

export function list(self: Swarm, swarm: string, agent: string, fresh = false) {
  const rt = runtime(self)
  const kept = rt.listing
  if (!fresh && kept && kept.agent === agent && Date.now() - kept.at < timing.listMs) return kept.value
  const value = Gateway.subagents(self.env, swarm, agent).catch((error: unknown) => ({ detail: String(error), ok: false as const, status: 503 }))
  rt.listing = { agent, at: Date.now(), value }
  return value
}

function setup(self: Swarm): Setup.Setup | null {
  return self.kv.get<Setup.Setup>('treeSetup') ?? null
}

function worker(self: Swarm) {
  const chosen = setup(self)
  return { harness: chosen?.harness ?? Setup.presets.cheap.harness, model: chosen?.model ?? Setup.presets.cheap.model }
}

function boarded(self: Swarm) {
  return setup(self)?.template === 'board'
}

export async function dispatcher(self: Swarm, swarm: string): Promise<Gateway.Result<string>> {
  const kept = self.kv.get<Dispatcher>('dispatcher')
  if (kept && (kept.runs < rotateAfter || !guards.rotate)) return { ok: true, value: kept.id }
  if (kept && [...runtime(self).aborts.keys()].some((run) => self.kv.get<Nodes.Spawned>('run:' + run)?.agent === kept.id)) return { ok: true, value: kept.id }
  const chosen = setup(self)
  const made = await Gateway.agent(
    self.env,
    swarm,
    chosen?.template === 'board'
      ? { instructions: self.kv.get<string>('dispatcherText') ?? Persona.orchestrator(), name: 'orchestrator', setup: chosen }
      : {
          instructions: self.kv.get<string>('dispatcherText') ?? Persona.dispatcher(),
          name: 'dispatcher',
          setup: { ...(chosen ?? { most: '0', step: '0', steps: {}, template: 'cheap' as const }), harness: 'codex', model: Setup.flash, subagents: { harnesses: [worker(self).harness], models: [worker(self).model] } },
        },
  )
  if (!made.ok) return made
  self.kv.put('dispatcher', { at: Date.now(), id: made.value.id, runs: 0 } satisfies Dispatcher)
  return { ok: true, value: made.value.id }
}

function counted(self: Swarm, agent: string) {
  const kept = self.kv.get<Dispatcher>('dispatcher')
  if (kept?.id === agent) self.kv.put('dispatcher', { ...kept, runs: kept.runs + 1 })
}

async function spawnKey(run: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(run)))
  return 'run-' + [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function spawning(made: { detail: string; status: number }): 'dispatcher' | 'refused' | 'starting' {
  if (made.status === 404 || made.status === 405) return 'dispatcher'
  if (made.status !== 409) return 'refused'
  if (made.detail.includes('no conversation to spawn from')) return 'dispatcher'
  if (made.detail.includes('already starting')) return 'starting'
  return 'refused'
}

async function spawn(self: Swarm, swarm: string, agent: string, args: Gateway.Spawn, run: string, claim: string, signal: AbortSignal): Promise<Gateway.Result<{ sub: number; turn?: string }>> {
  const key = await spawnKey(run)
  const until = Date.now() + timing.spawnMs
  let made = await Gateway.spawn(self.env, swarm, agent, { ...args, key })
  while (!made.ok && spawning(made) === 'starting' && Date.now() < until && !signal.aborted) {
    await wait(timing.listMs, self, signal)
    made = await Gateway.spawn(self.env, swarm, agent, { ...args, key })
  }
  if (made.ok) return { ok: true, value: { sub: made.value.agent_id } }
  if (spawning(made) !== 'dispatcher') return made
  self.kv.put('prompted:' + run, claim)
  const sent = await Gateway.prompt(self.env, swarm, agent, { id: claim, prompt: 'Spawn this subagent:\n' + JSON.stringify(args), steer: false })
  if (!sent.ok && sent.status !== 409) return sent
  follow(self, swarm, agent)
  while (Date.now() < until && !signal.aborted) {
    const listed = await list(self, swarm, agent, true)
    const found = listed.ok ? listed.value.find((sub) => sub.role === args.role && sub.parent_agent_id === null) : undefined
    if (found) return { ok: true, value: { sub: found.agent_id, turn: claim } }
    await wait(timing.listMs, self, signal)
  }
  return { detail: 'The dispatcher did not start the subagent in time.', ok: false, status: 504 }
}

export function picked(answer: string | undefined, models: readonly string[], fallback: string): Omit<Nodes.Pick, 'spent' | 'turn'> {
  const value = json(answer)
  const asked = typeof value?.['model'] === 'string' && models.includes(value['model']) ? value['model'] : undefined
  const model = asked ?? fallback
  const harness = asked && Setup.harnesses.some((one) => one === value?.['harness']) ? String(value?.['harness']) : Setup.harnessOf(model)
  return { harness, model, why: asked ? text(value?.['why'], 200) : null }
}

async function ask(self: Swarm, swarm: string, agent: string, question: string, id: string, signal: AbortSignal): Promise<{ spent: bigint; text: string; turn?: string } | undefined> {
  const side = await Gateway.side(self.env, swarm, agent, question)
  if (side.ok) return { spent: Flow.micro(side.value.usage?.estimated_cost?.total_usd), text: side.value.text }
  if (side.status !== 409) return undefined
  follow(self, swarm, agent)
  const sent = await Gateway.prompt(self.env, swarm, agent, { id, prompt: question, steer: false })
  if (!sent.ok && sent.status !== 409) return undefined
  const until = Date.now() + timing.spawnMs
  while (Date.now() < until && !signal.aborted) {
    const report = await Gateway.turn(self.env, swarm, agent, id)
    if (report.ok && !['queued', 'running'].includes(report.value.status)) return { spent: Flow.micro(report.value.spent_usd), text: report.value.ok?.message ?? '' }
    await wait(timing.listMs, self, signal)
  }
  return { spent: 0n, text: '', turn: id }
}

async function pick(self: Swarm, swarm: string, agent: string, task: Work.Task, input: { budget: bigint; nid: string; notes: string[]; node: Work.Task | undefined }, signal: AbortSignal): Promise<Nodes.Pick> {
  const kept = self.kv.get<Nodes.Pick>('picked:' + task.id)
  if (kept) return kept
  const chosen = setup(self)
  const prices = await Gateway.prices(self.env)
  const models = (chosen?.subagents?.models ?? []).filter((model) => !prices || prices.has(model))
  const parsed = Nodes.parse(input.node?.spec ?? '')
  const question = Persona.pick({
    budget: Memo.decimal(input.budget).replace(/\.?0+$/, ''),
    models: models.map((id) => ({ id, step: chosen?.steps[id] ? Memo.decimal(BigInt(chosen.steps[id])) : undefined })),
    nid: input.nid,
    notes: input.notes,
    spec: parsed.words,
    title: parsed.title,
  })
  const answer = await ask(self, swarm, agent, question, 'pick-' + task.id + '-' + task.attempts, signal)
  const made: Nodes.Pick = { ...picked(answer?.text, models, chosen?.model ?? Setup.fable), spent: Memo.decimal(answer?.spent ?? 0n), ...(answer?.turn ? { turn: answer.turn } : {}) }
  self.kv.put('picked:' + task.id, made)
  return made
}

async function strays(self: Swarm, swarm: string, agent: string) {
  const listed = await list(self, swarm, agent, true)
  if (!listed.ok) return
  const open = new Set((await self.board.tasks()).filter((task) => task.labels['kind'] === 'run' && !Work.terminal(task.phase)).map((task) => 'n:' + (task.labels['node'] ?? '') + '#' + Nodes.kOf(task.id)))
  for (const sub of listed.value) if (guards.stray && sub.parent_agent_id === null && !finished.has(sub.status.state) && !open.has(sub.role)) await Gateway.close(self.env, swarm, agent, sub.agent_id)
}

async function refusal(self: Swarm, task: Work.Task, lease: Board.PoolLease, failure: { detail: string; status: number }): Promise<never> {
  const transient = failure.status === 409 || failure.status >= 500
  if (failure.status !== 402 && !transient) throw new Error(failure.detail)
  const tries = (self.kv.get<number>('paid:' + task.id) ?? 0) + 1
  const wait = transient ? Math.min(Limits.Runner.followBackoffMostMs, Limits.Runner.followBackoffMs * 2 ** Math.min(tries, Limits.Runner.followBackoffDoublings)) : Work.delay(paying, tries)
  const until = Date.now() + (guards.rest ? wait : 0)
  self.kv.put('paid:' + task.id, tries)
  self.kv.put('rest:' + task.id, until)
  await self.board.release(task.id, lease.claim, (transient ? 'The gateway did not take the run yet: ' : 'The gateway refused payment: ') + failure.detail)
  await arm(self, until)
  throw new Board.LeaseLost(task.id)
}

async function arm(self: Swarm, at: number) {
  const pending = await self.ctx.storage.getAlarm()
  if (pending === null || pending > at) await self.ctx.storage.setAlarm(at)
}

function priority(self: Swarm, body: string): 'deferred' | 'urgent' {
  const found = body.match(/\[\$([\d.]+) behind/)
  return found?.[1] && Memo.units(found[1]) >= Nodes.units(self).runStep ? 'urgent' : 'deferred'
}

async function brief(self: Swarm, found: Nodes.State, nid: string, steers: string[]) {
  const node = found.nodes.get(nid)
  const parsed = Nodes.parse(node?.spec ?? '')
  const ancestors: string[] = []
  for (let at = node ? Nodes.parentOf(node) : null; at !== null; ) {
    const up = found.nodes.get(at)
    if (!up) break
    ancestors.unshift(Nodes.parse(up.spec).title)
    at = Nodes.parentOf(up)
  }
  const parent = node ? Nodes.parentOf(node) : null
  const siblings = [...found.nodes.values()]
    .filter((one) => one.id !== node?.id && parent !== null && Nodes.parentOf(one) === parent)
    .slice(0, 30)
    .map((one) => {
      const last = self.ctx.storage.sql.exec<{ text: string }>("SELECT text FROM tree_deltas WHERE node = ? AND event IN ('progress', 'proven', 'ended') ORDER BY seq DESC LIMIT 1", Nodes.nidOf(one.id)).toArray()[0]
      return Nodes.parse(one.spec).title + (last ? ': ' + last.text : '')
    })
  const failures = self.ctx.storage.sql
    .exec<{ text: string }>("SELECT text FROM tree_deltas WHERE node = ? AND event = 'progress' AND text LIKE 'Lean check failed%' ORDER BY seq DESC LIMIT 3", nid)
    .toArray()
    .map((row) => row.text)
  return Persona.node(setup(self), { form: node?.labels['form'] ?? 'idea', nid, spec: node?.spec ?? '', statement: parsed.statement, title: parsed.title }, { ancestors, failures, siblings, steers }, self.kv.get<string>('nodeRules') ?? Persona.rules(setup(self)))
}

async function run(self: Swarm, task: Work.Task, lease: Board.PoolLease): Promise<Board.Outcome> {
  runtime(self).claims.add(lease.claim)
  try {
    return await running(self, task, lease)
  } finally {
    runtime(self).claims.delete(lease.claim)
  }
}

async function running(self: Swarm, task: Work.Task, lease: Board.PoolLease): Promise<Board.Outcome> {
  const swarm = Nodes.swarm(self)
  const nid = task.labels['node'] ?? ''
  const triaging = nid === Nodes.triage
  const k = Nodes.kOf(task.id)
  const role = 'n:' + nid + '#' + k
  const folded = guards.folded ? self.kv.get<string>(Machine.foldedKey(task.id)) : undefined
  if (folded) return { done: folded }
  const found = await Nodes.state(self)
  const budget = found.ledger.runs.get(task.id) ?? 0n
  if (budget <= 0n && !self.kv.get<Nodes.Spawned>('run:' + task.id)) return { failed: 'No money is committed to this run.' }
  const rt = runtime(self)
  const abort = new AbortController()
  rt.aborts.set(task.id, abort)
  lease.signal.addEventListener('abort', () => abort.abort(), { once: true })
  try {
    const agent = await dispatcher(self, swarm)
    if (!agent.ok) return await refusal(self, task, lease, agent)
    follow(self, swarm, agent.value)
    let spawned = self.kv.get<Nodes.Spawned>('run:' + task.id)
    let budgeted = false
    if (!spawned) {
      const listed = await list(self, swarm, agent.value, true)
      const adopted = guards.adopt && listed.ok ? listed.value.find((sub) => sub.role === role && sub.parent_agent_id === null) : undefined
      const prompted = self.kv.get<string>('prompted:' + task.id)
      const kept = self.kv.get<Nodes.Pick>('picked:' + task.id)
      if (adopted) {
        Sub.observe(self.kv, agent.value, adopted)
        spawned = { agent: agent.value, at: Date.now(), sub: adopted.agent_id, ...(prompted ? { turn: prompted } : {}), ...(kept ? { pick: kept } : {}) }
      } else {
        const steers = triaging ? [] : await Nodes.unheeded(self, nid)
        const words = triaging ? await Triage.task(self, found) : await brief(self, found, nid, steers.map((steer) => steer.body))
        const chosen = boarded(self) ? await pick(self, swarm, agent.value, task, { budget, nid, node: found.nodes.get(nid), notes: steers.map((steer) => steer.body) }, abort.signal) : undefined
        const left = budget - Memo.units(chosen?.spent ?? '0')
        if (left <= 0n) return { failed: 'Picking its model spent the money committed to this run.' }
        const args: Gateway.Spawn = { budget_usd: Flow.number(left), ...(chosen ? { harness: chosen.harness, model: chosen.model } : worker(self)), output_schema: triaging ? Triage.output : output, role, task: words }
        const made = await spawn(self, swarm, agent.value, args, task.id, lease.claim, abort.signal)
        if (!made.ok) return await refusal(self, task, lease, made)
        spawned = { agent: agent.value, at: Date.now(), sub: made.value.sub, ...(made.value.turn ? { turn: made.value.turn } : {}), ...(chosen ? { pick: chosen } : {}) }
        budgeted = guards.bound && !made.value.turn
        counted(self, agent.value)
        const last = steers.at(-1)
        if (last) await Nodes.heedNode(self, nid, last.seq)
      }
      track(self, spawned, task)
      Sub.seed(self.kv, spawned.agent, spawned.sub, role)
      self.kv.put('run:' + task.id, spawned)
      if (!budgeted) {
        const set = await Gateway.budget(self.env, swarm, spawned.agent, spawned.sub, Flow.number(budget - Memo.units(spawned.pick?.spent ?? '0')))
        if (!set.ok && set.status === 402) return await refusal(self, task, lease, set)
      }
      await strays(self, swarm, spawned.agent)
      Nodes.emit(self, nid, 'started', 'Run ' + k + ' started' + (spawned.pick ? ' on ' + Setup.name(spawned.pick.model) : ''))
    }
    self.kv.delete('paid:' + task.id)
    self.kv.delete('rest:' + task.id)
    track(self, spawned, task)
    return await watch(self, swarm, task, lease, spawned, abort.signal)
  } finally {
    rt.aborts.delete(task.id)
    idle(self, task.id)
  }
}

function track(self: Swarm, spawned: Nodes.Spawned, task: Work.Task) {
  const key = spawned.agent + ':' + spawned.sub
  const rt = runtime(self)
  if (!rt.doing.has(key)) rt.doing.set(key, { held: undefined, nid: task.labels['node'] ?? '', sent: 0, task: task.id, timer: undefined })
}

function idle(self: Swarm, run: string) {
  const rt = runtime(self)
  for (const [key, held] of rt.doing)
    if (held.task === run) {
      clearTimeout(held.timer)
      rt.doing.delete(key)
    }
  if (self.treeDoing.delete(run)) Nodes.doing(self, Flow.runNode(run))
}

function stepped(self: Swarm, agent: string, block: string) {
  const rt = runtime(self)
  if (!rt.doing.size) return
  const found = Follow.frame(block)
  if (!found) return
  const event = json(found.data) as Gateway.Event | null
  const outer = event?.event
  const update = outer?.source === 'subagent' ? (outer.update as { event?: { payload?: Record<string, unknown>; type?: string }; id?: unknown; type?: string } | undefined) : undefined
  const held = update?.type === 'event' ? rt.doing.get(agent + ':' + String(update.id)) : undefined
  if (!event || !held) return
  const type = update?.event?.type
  const payload = update?.event?.payload ?? {}
  let text: string | undefined
  if (type === 'reasoning.summary.delta') {
    const item = String(payload['item_id'] ?? payload['model_call_index'] ?? '')
    const next = placed(held.held?.item === item ? held.held : undefined, item, typeof payload['offset'] === 'number' ? payload['offset'] : null, String(payload['text'] ?? ''))
    held.held = typeof next === 'object' ? next : undefined
    text = held.held ? gist(held.held.text) : undefined
  } else if (type === 'tool.call') {
    const step = call(payload)
    text = step ? named(step) : undefined
  }
  if (!text) return
  self.treeDoing.set(held.task, { at: event.created_at ?? Date.now(), text: clip(redact(text), 120) })
  const due = held.sent + timing.doingMs - Date.now()
  if (due <= 0) {
    held.sent = Date.now()
    Nodes.doing(self, held.nid)
  } else
    held.timer ??= setTimeout(() => {
      held.timer = undefined
      if (!self.treeDoing.has(held.task)) return
      held.sent = Date.now()
      Nodes.doing(self, held.nid)
    }, Math.min(due, timing.doingMs))
}

async function watch(self: Swarm, swarm: string, task: Work.Task, lease: Board.PoolLease, spawned: Nodes.Spawned, signal: AbortSignal): Promise<Board.Outcome> {
  const nid = task.labels['node'] ?? ''
  follow(self, swarm, spawned.agent)
  let seen = Date.now()
  let spent = -1n
  let sub: Gateway.Subagent | undefined
  let relayed = 0
  let topped: { spent: bigint; version: number } | undefined
  let stalled = false
  while (!stalled) {
    if (signal.aborted) {
      await halt(self, task.id)
      throw new Board.LeaseLost(task.id)
    }
    const heard = runtime(self).heard
    const listed = await list(self, swarm, spawned.agent)
    sub = await observed(self, swarm, spawned, listed, sub)
    if (listed.ok && !sub) break
    if (sub) {
      const now = Flow.micro(sub.spent_usd)
      if (now !== spent) {
        spent = now
        seen = Date.now()
        self.kv.put('live:' + task.id, { budget: Flow.usd(Flow.micro(sub.budget_usd)), spent: Flow.usd(now) } satisfies Nodes.Live)
        Nodes.changed(self)
      }
      if (finished.has(sub.status.state)) break
      if (!guards.topped || topped?.spent !== now || topped.version !== self.treeVersion) {
        const total = await Nodes.topUp(self, task.id, now)
        if (total !== null) await Gateway.budget(self.env, swarm, spawned.agent, spawned.sub, Flow.number(total))
        topped = { spent: now, version: self.treeVersion }
      }
    }
    for (const steer of guards.relay ? (await lease.steers()).filter((one) => one.seq > relayed) : []) {
      const told = await Gateway.tell(self.env, swarm, spawned.agent, spawned.sub, steer.body, priority(self, steer.body))
      if (!told.ok) break
      await lease.heed(steer.seq)
      relayed = steer.seq
    }
    stalled = Date.now() - seen > Math.max(leased(self), timing.leaseMs)
    if (!stalled && runtime(self).heard === heard) await wait(runtime(self).follow?.up ? timing.streamUpMs : timing.streamDownMs, self, signal)
  }
  idle(self, task.id)
  const state = sub?.status.state ?? 'gone'
  const ended = sub ? finished.has(state) : true
  if (!sub || !ended || state === 'completed') {
    const closed = await Gateway.close(self.env, swarm, spawned.agent, spawned.sub)
    if (!closed.ok && closed.status !== 404) throw new Error('Closing run ' + task.id + ' failed, so its budget stays committed: ' + closed.detail)
    sub = await observed(self, swarm, spawned, await list(self, swarm, spawned.agent, true), sub)
  }
  const final = sub?.status.state ?? 'gone'
  const used = (sub ? Flow.micro(sub.spent_usd) : Memo.units(self.kv.get<Nodes.Live>('live:' + task.id)?.spent ?? '0')) + (await dispatched(self, swarm, spawned))
  for (const steer of await lease.steers().catch(() => [])) if (steer.seq > relayed) await self.board.steer(Nodes.nodeId(nid), steer.body, { key: 'relay:' + task.id + ':' + steer.seq })
  const why = !sub ? 'The run is gone from the gateway.' : !ended ? 'The run stalled and was stopped.' : (sub.status.error ?? 'The run ' + final + '.')
  await Nodes.settleRun(self, task.id, used)
  if (sub) charged(self, task.id, spawned, Flow.micro(sub.spent_usd))
  if (nid === Nodes.triage) {
    const actions = Triage.parse(sub?.result)
    const applied = await Triage.apply(self, actions, 'agent:n:triage', task.id, halt)
    const done = JSON.stringify({ actions: applied })
    Machine.settle(self.kv, task.id, done)
    await Nodes.consider(self)
    return { done }
  }
  const outcome = final === 'completed' ? result(sub?.result, why) : { ...result(sub?.result, why), outcome: 'stuck' as const, summary: clip(why, 200) }
  if (final === 'failed' && /over_limit/.test(sub?.status.error ?? '')) self.kv.put('bounded:' + nid, Date.now())
  else self.kv.delete('bounded:' + nid)
  await Nodes.ran(self, task.id, outcome, (node, sha, theorem, refutes) => postVerify(self, node, sha, theorem, refutes))
  Machine.settle(self.kv, task.id, JSON.stringify(outcome))
  await Nodes.consider(self)
  return { done: JSON.stringify(outcome) }
}

async function observed(self: Swarm, swarm: string, spawned: Nodes.Spawned, listed: Gateway.Result<Gateway.Subagent[]>, last: Gateway.Subagent | undefined): Promise<Gateway.Subagent | undefined> {
  if (!listed.ok) return last
  const found = listed.value.find((one) => one.agent_id === spawned.sub)
  if (found) return Sub.view(Sub.observe(self.kv, spawned.agent, found))
  const kept = Sub.get(self.kv, spawned.agent, spawned.sub)
  if (!kept || !Sub.guards.monotonic) return undefined
  if (Sub.done(kept)) return Sub.view(kept)
  for (let tries = 0; tries < 2; tries++) {
    const again = await list(self, swarm, spawned.agent, true)
    const found = again.ok ? again.value.find((one) => one.agent_id === spawned.sub) : undefined
    if (found) return Sub.view(Sub.observe(self.kv, spawned.agent, found))
  }
  return undefined
}

export async function postVerify(self: Swarm, nid: string, sha: string, theorem: string, refutes: boolean) {
  const posted = await self.board.post({
    id: Nodes.verifyId(nid, sha) + (refutes ? ':neg' : ''),
    labels: { kind: 'verify', node: nid, refutes: refutes ? '1' : '0', sha },
    parent: Nodes.nodeId(nid),
    spec: JSON.stringify({ commit: sha, theorem }),
  })
  if (!posted.ok && posted.rejection.kind !== 'Exists') throw new Error('Posting the check of ' + nid + ' was refused: ' + posted.rejection.kind)
  Nodes.changed(self)
  ensure(self)
}

function trusted(check: Tree.Check, sha: string, stmt: string | undefined) {
  return check.commit === sha && check.exitCode === 0 && (stmt === undefined || stmt === 'none' || check.statement === stmt)
}

async function check(self: Swarm, task: Work.Task, lease: Board.PoolLease): Promise<Board.Outcome> {
  runtime(self).claims.add(lease.claim)
  try {
    return await checking(self, task, lease)
  } finally {
    runtime(self).claims.delete(lease.claim)
  }
}

export function checkKey(vid: string) {
  return 'check:' + vid
}

async function checking(self: Swarm, task: Work.Task, lease: Board.PoolLease): Promise<Board.Outcome> {
  const swarm = Nodes.swarm(self)
  const nid = task.labels['node'] ?? ''
  const sha = task.labels['sha'] ?? ''
  const refutes = task.labels['refutes'] === '1'
  const vid = Nodes.verifyId(nid, sha) + (refutes ? ':neg' : '')
  const key = 'verified:' + vid
  const node = await self.board.task(Nodes.nodeId(nid))
  if (!node || Work.terminal(node.phase)) return { failed: 'The node ended before its check.' }
  const statement = Nodes.parse(node.spec).statement
  if (!statement && !self.kv.get(key)) return { failed: 'The node has no Lean statement to check.' }
  const theorem = String((json(task.spec) ?? {})['theorem'] ?? '')
  const waited = await Machine.waitCheck<Tree.Check | { failed: string }>(
    {
      kv: self.kv,
      now: () => Date.now(),
      outcome: () => self.kv.get<Tree.Check | { failed: string }>(key),
      request: async () => {
        let asked: Awaited<ReturnType<typeof Verify.request>> = { detail: 'not asked', ok: false }
        for (let attempt = 1; attempt <= Limits.Nodes.retry.maxAttempts && !asked.ok; attempt++) {
          asked = await Verify.request(self.env, { claim: refutes ? 'refutation' : 'proof', nid, sha, statement: statement ?? '', swarm, theorem })
          if (!asked.ok && attempt < Limits.Nodes.retry.maxAttempts) await wait(Work.delay(Limits.Nodes.retry, attempt), self, lease.signal)
        }
        return asked.ok ? { ok: true } : asked
      },
      wait: async (ms) => {
        if (lease.signal.aborted) throw new Board.LeaseLost(task.id)
        await wait(Math.min(ms, timing.verifyMs), self, lease.signal)
        if (lease.signal.aborted) throw new Board.LeaseLost(task.id)
      },
    },
    checkKey(vid),
    sha,
    { pollMs: timing.verifyMs, waitMs: timing.checkMs },
  )
  if (waited.kind === 'refused') return { failed: 'The verifier did not take the check: ' + waited.detail }
  if (waited.kind === 'expired') {
    await self.board.steer(Nodes.nodeId(nid), 'The Lean check of ' + sha.slice(0, 7) + ' did not come back in time.', { key: 'expired:' + vid })
    Nodes.emit(self, nid, 'progress', 'Lean check expired for ' + sha.slice(0, 7))
    await Nodes.consider(self)
    return { failed: 'The check did not come back in time.' }
  }
  const outcome = waited.outcome
  if ('failed' in outcome || !trusted(outcome, sha, node.labels['stmt'])) {
    const log = 'failed' in outcome ? outcome.failed : 'The check did not match the commit or the frozen statement.'
    await self.board.steer(Nodes.nodeId(nid), 'The Lean check of ' + sha.slice(0, 7) + ' failed:\n' + log.slice(-2000), { key: 'failed:' + vid })
    Nodes.emit(self, nid, 'progress', 'Lean check failed for ' + sha.slice(0, 7))
    await Nodes.consider(self)
    return { failed: log.slice(-4096) }
  }
  if (refutes) await Nodes.end(self, nid, { at: outcome.at, check: outcome, into: null, kind: 'refuted', why: 'Its negation was checked in Lean.' }, halt)
  else await Nodes.proven(self, nid, outcome, halt)
  await Nodes.consider(self)
  return { done: JSON.stringify(outcome) }
}

export async function verified(self: Swarm, nid: string, sha: string, outcome: Tree.Check | { failed: string }, claim: 'proof' | 'refutation' = 'proof') {
  const vid = Nodes.verifyId(nid, sha) + (claim === 'refutation' ? ':neg' : '')
  if (!Machine.came(self.kv, checkKey(vid), sha, !('failed' in outcome), Date.now()).ok) return
  self.kv.put('verified:' + vid, outcome)
  const task = await self.board.task(vid)
  if (task?.claim && !runtime(self).claims.has(task.claim)) await self.board.release(vid, task.claim, 'the check came back')
  wake(self)
  ensure(self)
  await arm(self, Date.now())
}

export async function halt(self: Swarm, run: string) {
  runtime(self).aborts.get(run)?.abort()
  idle(self, run)
  const task = await self.board.task(run)
  if (task && !Work.terminal(task.phase)) await self.board.cancel(run, 'Its node ended.')
  const spawned = self.kv.get<Nodes.Spawned>('run:' + run)
  const spent = await spentOf(self, run, guards.halt)
  if (spent === null) return
  await Nodes.settleRun(self, run, spent)
  if (spawned) charged(self, run, spawned, spent - (await dispatched(self, Nodes.swarm(self), spawned)))
  else {
    const agent = self.kv.get<Dispatcher>('dispatcher')?.id
    if (agent && self.kv.get<string>('prompted:' + run)) charged(self, run, { agent, at: 0, sub: 0 }, 0n)
  }
}

export type Charged = { agent: string; at: number; spent: string; sub: number }

export const lateMs = Limits.Runner.lateMs

function charged(self: Swarm, run: string, spawned: Nodes.Spawned, spent: bigint) {
  self.kv.put('charged:' + run, { agent: spawned.agent, at: Date.now(), spent: Memo.decimal(spent), sub: spawned.sub } satisfies Charged)
  setTimeout(() => void late(self).catch(() => undefined), Limits.Runner.chargeAfterMs)
}

export function late(self: Swarm): Promise<void> {
  const rt = runtime(self)
  rt.lating ??= charge(self).finally(() => {
    rt.lating = undefined
  })
  return rt.lating
}

async function charge(self: Swarm) {
  const swarm = Nodes.swarm(self)
  for (const [key, held] of [...self.kv.list<Charged>({ prefix: 'charged:' })]) {
    const run = key.slice('charged:'.length)
    if (Date.now() - held.at > lateMs) {
      self.kv.delete(key)
      if (held.sub) self.kv.delete(Sub.key(held.agent, held.sub))
      continue
    }
    const listed = await list(self, swarm, held.agent, true)
    const role = 'n:' + Flow.runNode(run) + '#' + Nodes.kOf(run)
    const sub = listed.ok ? listed.value.find((one) => (held.sub ? one.agent_id === held.sub : one.parent_agent_id === null && one.role === role)) : undefined
    if (!sub) continue
    const kept = Sub.observe(self.kv, held.agent, sub)
    if (!held.sub && !Sub.done(kept)) await Gateway.close(self.env, swarm, held.agent, sub.agent_id)
    const now = Sub.spent(kept)
    const extra = now - (guards.late ? Memo.units(held.spent) : 0n)
    if (extra <= 0n) continue
    const nid = Flow.runNode(run)
    await Nodes.budgeting(self, async () => {
      const rows = await Flow.rows(self.env, swarm)
      const funders = new Set(rows.filter((row) => row.run === run && row.kind === 'commit').map((row) => row.contributor))
      const runs = [...new Set(rows.filter((row) => row.node === nid && row.run !== null && row.run !== run).map((row) => row.run as string))]
      const buckets: Flow.Bucket[] = [{ node: nid, run: null }, ...runs.map((other) => ({ node: nid, run: other })), { node: Flow.free, run: null }]
      for (const bucket of buckets) {
        const held = new Map([...Flow.shares(rows, bucket)].filter(([contributor]) => bucket.node !== Flow.free || funders.has(contributor)))
        if (Flow.sum(held.values()) < extra) continue
        await Flow.write(self.env, { from: bucket, id: 'late:' + run + ':' + now, kind: 'spend', parts: Flow.split(held, extra), swarm, to: null })
        break
      }
    })
    self.kv.put(key, { ...held, spent: Memo.decimal(now), sub: sub.agent_id })
    Nodes.changed(self)
  }
}

export async function dispatched(self: Swarm, swarm: string, spawned: Nodes.Spawned) {
  let total = Memo.units(spawned.pick?.spent ?? '0')
  for (const turn of [spawned.turn, spawned.pick?.turn]) {
    if (!turn) continue
    const report = await Gateway.turn(self.env, swarm, spawned.agent, turn)
    if (report.ok) total += Flow.micro(report.value.spent_usd)
  }
  return total
}

export async function spentOf(self: Swarm, run: string, close = false): Promise<bigint | null> {
  const spawned = self.kv.get<Nodes.Spawned>('run:' + run)
  const swarm = Nodes.swarm(self)
  if (!spawned) {
    const prompted = self.kv.get<string>('prompted:' + run)
    const pick = self.kv.get<Nodes.Pick>('picked:' + run)
    const agent = self.kv.get<Dispatcher>('dispatcher')?.id
    const base = (prompted || pick) && agent ? await dispatched(self, swarm, { agent, at: 0, sub: 0, ...(prompted ? { turn: prompted } : {}), ...(pick ? { pick } : {}) }) : 0n
    if (!close || !agent) return base
    const listed = await list(self, swarm, agent, true)
    if (!listed.ok) return null
    const role = 'n:' + Flow.runNode(run) + '#' + Nodes.kOf(run)
    const stray = listed.value.find((one) => one.parent_agent_id === null && one.role === role)
    if (!stray) return base
    if (!finished.has(stray.status.state)) {
      const closed = await Gateway.close(self.env, swarm, agent, stray.agent_id)
      if (!closed.ok) return null
    }
    const again = await list(self, swarm, agent, true)
    const last = (again.ok ? again.value.find((one) => one.agent_id === stray.agent_id) : undefined) ?? stray
    return base + Flow.micro(last.spent_usd)
  }
  const listed = await list(self, swarm, spawned.agent, true)
  if (!listed.ok) return null
  let sub = await observed(self, swarm, spawned, listed, undefined)
  if (close && sub && !finished.has(sub.status.state)) {
    await Gateway.close(self.env, swarm, spawned.agent, spawned.sub)
    sub = await observed(self, swarm, spawned, await list(self, swarm, spawned.agent, true), sub)
  }
  return Flow.micro(sub?.spent_usd) + (await dispatched(self, swarm, spawned))
}

export async function live(self: Swarm) {
  const running = (await self.board.tasks()).filter((task) => task.labels['kind'] === 'run' && !Work.terminal(task.phase))
  const spent = await Promise.all(
    running.map(async (task) => {
      if ((await self.board.task(Nodes.settleId(task.id)))?.phase === 'done') return 0n
      return (await spentOf(self, task.id)) ?? Memo.units(self.kv.get<Nodes.Live>('live:' + task.id)?.spent ?? '0')
    }),
  )
  return spent.reduce((total, each) => total + each, 0n)
}

export function follow(self: Swarm, swarm: string, agent: string) {
  const rt = runtime(self)
  if (rt.follow?.agent === agent && !rt.follow.stop.signal.aborted) return
  rt.follow?.stop.abort()
  const stop = new AbortController()
  const following = { agent, stop, up: false }
  rt.follow = following
  void (async () => {
    let after = 0
    let fails = 0
    let quiet = Date.now()
    while (!stop.signal.aborted) {
      if (rt.aborts.size === 0 && Date.now() - quiet > timing.idleMs) break
      try {
        const response = await Gateway.stream(self.env, swarm, agent, after, stop.signal)
        if (!response.ok || !response.body) throw new Error('The event stream answered ' + response.status)
        following.up = true
        fails = 0
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        while (!stop.signal.aborted) {
          const read = await reader.read()
          if (read.done) break
          buffer += read.value
          const blocks = buffer.split('\n\n')
          buffer = blocks.pop() ?? ''
          for (const block of blocks) {
            for (const found of block.matchAll(/"seq":\s*(\d+)/g)) after = Math.max(after, Number(found[1]))
            if (guards.heard && /"type":\s*"(?:status|completion)"/.test(block)) {
              rt.heard += 1
              rt.listing = undefined
            }
            stepped(self, agent, block)
          }
          quiet = Date.now()
          wake(self)
          if (rt.aborts.size === 0 && Date.now() - quiet > timing.idleMs) break
        }
      } catch {}
      following.up = false
      fails += 1
      await new Promise((resolve) => setTimeout(resolve, Math.min(Limits.Runner.followBackoffMostMs, Limits.Runner.followBackoffMs * 2 ** Math.min(fails, Limits.Runner.followBackoffDoublings))))
    }
    if (rt.follow === following) rt.follow = undefined
  })()
}

function resting(self: Swarm): Work.Board {
  const board = self.board
  return { ...board, ready: async (options) => (await board.ready(options)).filter((task) => (self.kv.get<number>('rest:' + task.id) ?? 0) <= Date.now()) }
}

function woken(rt: Runtime) {
  return (notify: () => void) => {
    rt.kicks.add(notify)
    return () => void rt.kicks.delete(notify)
  }
}

export function ensure(self: Swarm) {
  if (self.kv.get<number>('archivedAt')) return
  const rt = runtime(self)
  const board = resting(self)
  const kicks = [...rt.kicks]
  if (!rt.pools.runs || rt.pools.runs.stats().state !== 'running')
    rt.pools.runs = Board.pool(board, { concurrency: Nodes.units(self).slots, idleMs: timing.idleMs, label: ['kind', 'run'], leaseMs: leased(self), pollMs: timing.pollMs, run: (task, lease) => run(self, task, lease), wake: woken(rt) })
  if (!rt.pools.verifies || rt.pools.verifies.stats().state !== 'running')
    rt.pools.verifies = Board.pool(board, { concurrency: verifiers, idleMs: timing.idleMs, label: ['kind', 'verify'], leaseMs: leased(self), pollMs: timing.pollMs, run: (task, lease) => check(self, task, lease), wake: woken(rt) })
  if (guards.kick) for (const kick of kicks) kick()
}

export async function stop(self: Swarm) {
  const rt = runtime(self)
  rt.follow?.stop.abort()
  for (const abort of rt.aborts.values()) abort.abort()
  await Promise.all([rt.pools.runs?.stop(), rt.pools.verifies?.stop()])
  rt.pools = {}
  rt.follow?.stop.abort()
}

export async function tick(self: Swarm): Promise<number | null> {
  if (self.kv.get<number>('archivedAt')) return null
  const rt = runtime(self)
  if (rt.first) {
    rt.first = false
    for (const task of await self.board.held())
      if (task.claim && (((task.labels['kind'] === 'run' || task.labels['kind'] === 'verify') && !(guards.claims && rt.claims.has(task.claim))) || (task.labels['kind'] === 'settle' && !self.settling.has(task.claim))))
        await self.board.release(task.id, task.claim, 'its worker restarted')
    await Nodes.reconcile(self, (run) => spentOf(self, run, true))
  }
  await late(self).catch((error: unknown) => console.error('Charging late spend failed', error))
  await Nodes.git(self).catch((error: unknown) => console.error('Writing to the proofs repository failed', error))
  await Triage.schedule(self)
  await Nodes.consider(self)
  const tasks = await self.board.tasks()
  const now = Date.now()
  const open = tasks.filter((task) => (task.labels['kind'] === 'run' || task.labels['kind'] === 'verify') && !Work.terminal(task.phase))
  if (open.length) ensure(self)
  const rests = open.map((task) => self.kv.get<number>('rest:' + task.id) ?? 0).filter((at) => at > now)
  const leases = open.flatMap((task) => (task.untilMs && task.untilMs > now ? [task.untilMs + 1000] : []))
  const due = [...rests, ...leases, Triage.due(self, now), open.length || Nodes.gitDue(self) ? now + 60_000 : Infinity]
  const next = Math.min(...due)
  return Number.isFinite(next) ? next : null
}
