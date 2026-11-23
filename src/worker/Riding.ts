import type { Address } from 'viem'
import type { Bucket, Ledgered, NodeRun, NodeSteer, NodeUpdates, NodeView, ProofsView, Standing, Suggestion, TreeView } from '../shared/Api.ts'
import * as Memo from '../shared/Memo.ts'
import * as Setup from '../shared/Setup.ts'
import * as Tree from '../shared/Tree.ts'
import { clip, redact } from '../shared/Trail.ts'
import * as Flow from './Flow.ts'
import * as Gateway from './Gateway.ts'
import * as Nodes from './Nodes.ts'
import * as Runner from './Runner.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'
import * as Triage from './Triage.ts'
import * as Verify from './Verify.ts'
import * as Work from './Work.ts'

export type Plant = {
  dispatcher: string
  rules: string
  root: { statement: string | null; title: string; words: string }
  seed: Nodes.Posting[]
  settings: Nodes.Settings
  setup: Setup.Setup | null
  swarm: string
}

export type Proposal = { by: string; form: Tree.Form; parent: string; statement: string | null; title: string; words: string }

export type Fault = { detail: string; status: 400 | 403 | 404 | 409 | 410 }

export type Answer<T> = { ok: true; value: T } | ({ ok: false } & Fault)

function fail(status: Fault['status'], detail: string): { ok: false } & Fault {
  return { detail, ok: false, status }
}

export async function plant(self: Swarm, input: Plant) {
  self.kv.put('id', input.swarm)
  if (self.kv.get<string>('form') === 'tree') return false
  self.kv.put('form', 'tree')
  self.kv.put('tree', input.settings)
  self.kv.put('treeSetup', input.setup)
  self.kv.put('dispatcherText', input.dispatcher)
  self.kv.put('nodeRules', input.rules)
  await Nodes.post(self, { by: 'seed', form: 'goal', needs: [], nid: Nodes.root, parent: null, ...input.root })
  await Nodes.post(self, { by: 'seed', form: 'triage', needs: [], nid: Nodes.triage, parent: Nodes.root, statement: null, title: 'Triage', words: "Weighs riders' proposals and suggestions for the root's money." })
  for (const node of input.seed) {
    const posted = await Nodes.post(self, node)
    Nodes.weigh(self, posted.nid, 1)
  }
  return true
}

export function archived(self: Swarm) {
  return self.kv.get<number>('archivedAt') ?? null
}

function filtered(view: Nodes.View, query: { depth: number; root: string; status: Tree.Status | undefined }) {
  const nodes: Tree.Node[] = []
  const walk = (nid: string, depth: number) => {
    const node = view.nodes.get(nid)
    if (!node) return
    if (!query.status || node.status === query.status) nodes.push(node)
    if (depth < query.depth) for (const child of node.children) walk(child, depth + 1)
  }
  walk(query.root, 0)
  return nodes
}

export async function tree(self: Swarm, query: { depth: number; root: string; status: Tree.Status | undefined }): Promise<Answer<TreeView>> {
  const view = await Nodes.view(self)
  if (!view.nodes.has(query.root)) return fail(404, 'No node has this id.')
  return { ok: true, value: { headline: Tree.headline([...view.nodes.values()]), nodes: filtered(view, query), seq: view.seq } }
}

export async function node(self: Swarm, nid: string): Promise<Answer<NodeView>> {
  const view = await Nodes.view(self)
  const shown = view.nodes.get(nid)
  if (!shown) return fail(404, 'No node has this id.')
  const found = view.state
  const names = await Nodes.names(self, found)
  const runs: NodeRun[] = (found.runs.get(nid) ?? []).map((task) => {
    const spawned = self.kv.get<Nodes.Spawned>('run:' + task.id)
    const done = task.outcome && 'done' in task.outcome ? (Runner.json(task.outcome.done) ?? {}) : {}
    const spent = found.rows.filter((row) => row.run === task.id && row.kind === 'spend').reduce((sum, row) => sum - row.amount, 0n)
    const live = Memo.units(self.kv.get<Nodes.Live>('live:' + task.id)?.spent ?? '0')
    const committed = found.rows.filter((row) => row.run === task.id && row.kind === 'commit').reduce((sum, row) => sum + row.amount, 0n)
    const outcome = typeof done['outcome'] === 'string' ? (done['outcome'] as NodeRun['outcome']) : null
    const summary = typeof done['summary'] === 'string' ? done['summary'] : task.outcome && 'failed' in task.outcome ? clip(task.outcome.failed, 200) : task.reason ? clip(task.reason, 200) : ''
    return {
      budget: Flow.usd(committed),
      commit: typeof done['commit'] === 'string' ? done['commit'] : null,
      k: Nodes.kOf(task.id),
      outcome,
      since: spawned?.at ?? 0,
      spent: Flow.usd(spent > 0n ? spent : live),
      summary: redact(summary),
      task: task.id,
      until: Work.terminal(task.phase) ? (found.tasks.get(Nodes.settleId(task.id)) ? (task.untilMs ?? null) : null) : null,
    }
  })
  const steers: NodeSteer[] = self.ctx.storage.sql
    .exec<{ at: number; text: string }>("SELECT at, text FROM tree_deltas WHERE node = ? AND event = 'steered' ORDER BY seq DESC LIMIT 50", nid)
    .toArray()
    .map((row) => {
      const money = String(row.text).match(/^\[\$([\d.]+) behind this, from @([^\]]+)\] ([\s\S]*)$/)
      const handle = money?.[2] ?? 'rider'
      return { amount: Memo.decimal(Memo.units(money?.[1] ?? '0')), at: Number(row.at), note: money?.[3] ?? String(row.text), who: { address: null, agent: null, handle } }
    })
  const { results } = await self.env.DB.prepare('select id, author, text, created_at from ideas where swarm = ? and parent = ? and node is null order by created_at desc limit 50')
    .bind(Nodes.swarm(self), nid)
    .all<{ author: string; created_at: number; id: string; text: string }>()
  const authors = await Store.handles(self.env, results.map((idea) => idea.author as Address))
  const suggestions: Suggestion[] = results.map((idea) => ({ at: idea.created_at, id: idea.id, text: redact(idea.text), who: Nodes.who(idea.author, authors) }))
  const task = found.nodes.get(nid)
  const review = !!task && task.labels['by'] === 'seed' && !self.kv.get('reviewed:' + nid) && Nodes.parse(task.spec).statement !== null
  return { ok: true, value: { ...shown, funders: Nodes.allFunders(found, nid, names), review, runs, steers, suggestions } }
}

export async function deltas(self: Swarm, input: { after: number; limit: number; nid: string | null }): Promise<Answer<NodeUpdates>> {
  const view = await Nodes.view(self)
  if (input.nid !== null && !view.nodes.has(input.nid)) return fail(404, 'No node has this id.')
  const rows = self.ctx.storage.sql
    .exec<{ at: number; event: Nodes.Event; node: string; seq: number; text: string }>(
      input.nid === null ? 'SELECT seq, at, node, event, text FROM tree_deltas WHERE seq > ? ORDER BY seq LIMIT ?' : 'SELECT seq, at, node, event, text FROM tree_deltas WHERE seq > ? AND node = ? ORDER BY seq LIMIT ?',
      ...(input.nid === null ? [input.after, input.limit] : [input.after, input.nid, input.limit]),
    )
    .toArray()
  const found = rows.flatMap((row) => {
    const shown = view.nodes.get(row.node)
    return shown ? [{ at: Number(row.at), event: row.event, node: shown, seq: Number(row.seq), text: row.text }] : []
  })
  return { ok: true, value: { deltas: found, next: Number(rows.at(-1)?.seq ?? input.after) } }
}

const hourMs = 3_600_000

export async function burn(self: Swarm): Promise<Tree.Burn> {
  const events = self.ctx.storage.sql.exec<{ at: number; event: string; text: string }>("SELECT at, event, text FROM tree_deltas WHERE event IN ('proven', 'ended') ORDER BY seq").toArray()
  const spends = await Flow.spends(self.env, Nodes.swarm(self))
  const first = Math.min(...events.map((event) => Number(event.at)), ...spends.map((spend) => spend.at), Infinity)
  if (!Number.isFinite(first)) return []
  const now = Date.now()
  const start = Math.floor(first / hourMs) * hourMs
  const hours = Math.min(24 * 90, Math.floor((now - start) / hourMs) + 1)
  const from = Math.floor(now / hourMs) * hourMs - (hours - 1) * hourMs
  const series: Tree.Burn = []
  let proven = 0
  let deadEnds = 0
  let spent = 0n
  let e = 0
  let s = 0
  for (let hour = 0; hour < hours; hour++) {
    const end = from + (hour + 1) * hourMs
    while (e < events.length && Number(events[e]?.at) < end) {
      const event = events[e]
      if (event?.event === 'proven') proven += 1
      else if (event && !String(event.text).startsWith('merged')) deadEnds += 1
      e += 1
    }
    while (s < spends.length && (spends[s]?.at ?? Infinity) < end) {
      spent += spends[s]?.amount ?? 0n
      s += 1
    }
    series.push({ at: from + hour * hourMs, deadEnds, proven, spent: Flow.usd(spent) })
  }
  return series
}

export async function proofs(self: Swarm): Promise<ProofsView> {
  const view = await Nodes.view(self)
  return {
    proofs: [...view.nodes.values()]
      .filter((one) => one.proof)
      .sort((a, b) => (b.proof?.at ?? 0) - (a.proof?.at ?? 0))
      .map((one) => ({ check: one.proof as Tree.Check, node: one.id, title: one.title })),
  }
}

export async function propose(self: Swarm, nid: string, proposal: Proposal): Promise<Answer<string>> {
  const found = await Nodes.state(self)
  const parent = found.nodes.get(proposal.parent)
  if (!parent || Work.terminal(parent.phase)) return fail(409, 'The parent node is not open.')
  if (proposal.parent === Nodes.triage) return fail(400, 'Nodes go under the tree, not under triage.')
  self.kv.put('proposal:' + nid, proposal)
  return { ok: true, value: nid }
}

export async function pledge(self: Swarm, input: { amount: bigint; contributor: string; hash: string; nid: string | null }): Promise<{ nid: string }> {
  const contributor = input.contributor.toLowerCase()
  const found = await Nodes.state(self)
  let target = input.nid ?? Nodes.root
  const proposal = input.nid ? self.kv.get<Proposal>('proposal:' + input.nid) : undefined
  if (input.nid && !found.nodes.has(input.nid) && proposal) {
    const parent = found.nodes.get(proposal.parent)
    if (input.amount >= Nodes.units(self).ideaMin && parent && !Work.terminal(parent.phase)) {
      await Nodes.post(self, { by: proposal.by, form: proposal.form, needs: [], nid: input.nid, parent: proposal.parent, statement: proposal.statement, title: proposal.title, words: proposal.words })
      self.kv.delete('proposal:' + input.nid)
    } else target = Flow.free
  } else if (!found.nodes.has(target)) target = Nodes.root
  const task = target === Flow.free ? undefined : found.nodes.get(target) ?? (await self.board.task(Nodes.nodeId(target))) ?? undefined
  if (target !== Flow.free && (!task || Work.terminal(task.phase) || target === Nodes.triage)) target = Flow.free
  const wrote = await Nodes.budgeting(self, () => Flow.write(self.env, { from: null, id: input.hash.toLowerCase(), kind: 'pledge', parts: [[contributor, input.amount]], swarm: Nodes.swarm(self), to: { node: target, run: null } }))
  if (wrote) {
    Nodes.changed(self)
    await seed(self)
    const handle = (await Store.account(self.env, contributor as Address)).handle
    Nodes.emit(self, target === Flow.free ? Nodes.root : target, 'funded', '@' + handle + ' rode it with $' + trim(input.amount) + (target === Flow.free ? ', kept free to move' : ''))
    await Runner.tick(self).then((next) => (next === null ? undefined : arm(self, next)))
  }
  return { nid: target }
}

export async function seed(self: Swarm) {
  if (self.kv.get<number>('seeded')) return true
  const made = await Verify.seed(self.env, Nodes.swarm(self)).catch((error: unknown) => ({ detail: String(error), ok: false as const, status: 503 }))
  if (made.ok || ('status' in made && made.status === 409)) {
    self.kv.put('seeded', Date.now())
    return true
  }
  return false
}

async function arm(self: Swarm, at: number) {
  const pending = await self.ctx.storage.getAlarm()
  if (pending === null || pending > at) await self.ctx.storage.setAlarm(at)
}

function trim(amount: bigint) {
  return Memo.decimal(amount).replace(/\.?0+$/, '')
}

export async function steer(self: Swarm, input: { amount: bigint; contributor: string; nid: string; note: string }): Promise<Answer<Tree.Node>> {
  const contributor = input.contributor.toLowerCase()
  const found = await Nodes.state(self)
  const task = found.nodes.get(input.nid)
  if (!task || Work.terminal(task.phase) || input.nid === Nodes.triage) return fail(409, 'This node is not open.')
  if (input.amount > 0n) {
    const moved = await Nodes.budgeting(self, async () => {
      const rows = await Flow.rows(self.env, Nodes.swarm(self))
      return Flow.write(self.env, { from: { node: Flow.free, run: null }, id: 'steer:' + input.nid + ':' + contributor + ':' + rows.length, kind: 'move', parts: [[contributor, input.amount]], swarm: Nodes.swarm(self), to: { node: input.nid, run: null } })
    })
    if (!moved) return fail(409, 'You have less free money in this swarm than that. Ride the node instead.')
  }
  const after = await Nodes.state(self)
  const behind = after.ledger.funders.get(input.nid)?.get(contributor)?.amount ?? 0n
  if (behind <= 0n) return fail(403, 'Only a rider with money on this node can steer it.')
  const handle = (await Store.account(self.env, contributor as Address)).handle
  const text = '[$' + trim(behind) + ' behind this, from @' + handle + '] ' + input.note
  const run = (after.runs.get(input.nid) ?? []).find((one) => !Work.terminal(one.phase) && one.phase === 'claimed')
  const steered = await self.board.steer(run ? run.id : Nodes.nodeId(input.nid), text)
  if (!steered.ok) await self.board.steer(Nodes.nodeId(input.nid), text)
  Nodes.emit(self, input.nid, 'steered', text)
  Runner.wake(self)
  if (input.amount > 0n) await Runner.tick(self).then((next) => (next === null ? undefined : arm(self, next)))
  const view = await Nodes.view(self)
  return { ok: true, value: view.nodes.get(input.nid) as Tree.Node }
}

export async function move(self: Swarm, input: { amount: bigint; contributor: string; from: string; to: string }): Promise<Answer<Tree.Node | null>> {
  const contributor = input.contributor.toLowerCase()
  const found = await Nodes.state(self)
  for (const nid of [input.from, input.to]) {
    if (nid === Flow.free) continue
    const task = found.nodes.get(nid)
    if (!task || nid === Nodes.triage) return fail(404, 'No node has this id.')
    if (nid === input.to && Work.terminal(task.phase)) return fail(409, 'Money moves only onto an open node.')
  }
  if (input.from === input.to) return fail(400, 'Move money between two different places.')
  const moved = await Nodes.budgeting(self, async () => {
    const rows = await Flow.rows(self.env, Nodes.swarm(self))
    return Flow.write(self.env, { from: { node: input.from, run: null }, id: 'move:' + input.from + ':' + input.to + ':' + contributor + ':' + rows.length, kind: 'move', parts: [[contributor, input.amount]], swarm: Nodes.swarm(self), to: { node: input.to, run: null } })
  })
  if (!moved) return fail(409, 'You have less uncommitted money there than that.')
  Nodes.changed(self)
  const handle = (await Store.account(self.env, contributor as Address)).handle
  if (input.to !== Flow.free) Nodes.emit(self, input.to, 'moved', '@' + handle + ' moved $' + trim(input.amount) + ' here')
  if (input.from !== Flow.free) Nodes.emit(self, input.from, 'moved', '@' + handle + ' moved $' + trim(input.amount) + ' away')
  await Runner.tick(self).then((next) => (next === null ? undefined : arm(self, next)))
  const view = await Nodes.view(self)
  return { ok: true, value: view.nodes.get(input.to === Flow.free ? input.from : input.to) ?? null }
}

export async function end(self: Swarm, input: { admin: boolean; contributor: string | null; nid: string; why: string }): Promise<Answer<Tree.Node>> {
  const found = await Nodes.state(self)
  const task = found.nodes.get(input.nid)
  if (!task || input.nid === Nodes.root || input.nid === Nodes.triage) return fail(404, 'No node you can end has this id.')
  if (Work.terminal(task.phase)) return fail(409, 'This node has ended already.')
  if (!input.admin) {
    const behind = found.ledger.funders.get(input.nid) ?? new Map<string, { amount: bigint; since: number }>()
    const total = Flow.sum([...behind.values()].map((held) => held.amount))
    const mine = input.contributor ? (behind.get(input.contributor.toLowerCase())?.amount ?? 0n) : 0n
    if (total === 0n || mine * 2n <= total) return fail(403, 'Only whoever holds more than half of what is behind a node, or an admin, can end it.')
  }
  await Nodes.end(self, input.nid, { at: Date.now(), check: null, into: null, kind: 'withdrawn', why: input.why }, Runner.halt)
  await Runner.tick(self).then((next) => (next === null ? undefined : arm(self, next)))
  const view = await Nodes.view(self)
  return { ok: true, value: view.nodes.get(input.nid) as Tree.Node }
}

export async function triage(self: Swarm, action: Triage.Action, by: string) {
  const applied = await Triage.apply(self, [action], by, 'hand:' + Date.now(), Runner.halt)
  await Runner.tick(self).then((next) => (next === null ? undefined : arm(self, next)))
  return applied
}

export async function standing(self: Swarm, contributor: string): Promise<Standing> {
  const lower = contributor.toLowerCase()
  const found = await Nodes.state(self)
  const held = new Map<string, bigint>()
  let committed = 0n
  let spent = 0n
  for (const row of found.rows) {
    if (row.contributor !== lower) continue
    if (row.run !== null) {
      if (row.kind === 'spend') spent -= row.amount
      else committed += row.amount
      continue
    }
    held.set(row.node, (held.get(row.node) ?? 0n) + row.amount)
  }
  committed += spent
  const buckets: Bucket[] = [...held]
    .filter(([node, amount]) => amount > 0n && node !== Flow.free)
    .map(([node, amount]) => ({ amount: Flow.usd(amount), node, title: Nodes.parse(found.nodes.get(node)?.spec ?? '').title }))
  const free = held.get(Flow.free) ?? 0n
  const refundable = free + Flow.sum([...held].filter(([node]) => node !== Flow.free).map(([, amount]) => (amount > 0n ? amount : 0n)))
  return { buckets, committed: Flow.usd(committed > 0n ? committed : 0n), free: Flow.usd(free > 0n ? free : 0n), refundable: Flow.usd(refundable), spent: Flow.usd(spent), swarm: Nodes.swarm(self) }
}

export const tolerance = 50_000n

export async function health(self: Swarm): Promise<Ledgered> {
  const swarm = Nodes.swarm(self)
  await Runner.late(self).catch((error: unknown) => console.error('Charging late spend failed', error))
  const rows = await Flow.rows(self.env, swarm)
  const totals = Flow.totals(rows)
  const live = await Runner.live(self)
  const credit = await Gateway.credit(self.env, swarm)
  const gateway = credit.ok ? { deposited: credit.value.deposited, left: credit.value.left, spent: credit.value.spent } : null
  const drift = gateway ? Memo.units(gateway.left) - (totals.held - live) : 0n
  const balanced = totals.held === totals.pledged - totals.spent
  const ok = balanced && gateway !== null && (drift < 0n ? -drift : drift) <= tolerance
  return { drift: Flow.usd(drift), gateway, held: Flow.usd(totals.held), live: Flow.usd(live), ok, pledged: Flow.usd(totals.pledged), spent: Flow.usd(totals.spent), swarm }
}

export async function review(self: Swarm, nid: string, by: string): Promise<Answer<boolean>> {
  const found = await Nodes.state(self)
  if (!found.nodes.has(nid)) return fail(404, 'No node has this id.')
  self.kv.put('reviewed:' + nid, { at: Date.now(), by })
  Nodes.changed(self)
  return { ok: true, value: true }
}

export async function archive(self: Swarm, at: number) {
  self.kv.put('archivedAt', at)
  await Runner.stop(self)
  await self.ctx.storage.deleteAlarm()
}

