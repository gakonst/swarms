import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Tree from '../shared/Tree.ts'
import { redact } from '../shared/Trail.ts'
import * as Chat from './Chat.ts'
import * as Flow from './Flow.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'
import * as Telegram from './Telegram.ts'
import * as Verify from './Verify.ts'
import * as Work from './Work.ts'

export const root = 'root'

export const triage = 'triage'

export type Settings = { ideaMin: string; runCap: string; runMin: string; runStep: string; slots: number; triageShare: number }

export const defaults: Settings = { ideaMin: '1.000000', runCap: '25.000000', runMin: '0.500000', runStep: '5.000000', slots: 16, triageShare: 0.05 }

export const retry: Work.Retry = { backoffMs: 15_000, maxAttempts: 3 }

export const stuckRuns = 3

const lockMs = 60_000

export const schema = [
  'CREATE TABLE IF NOT EXISTS tree_deltas (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, node TEXT NOT NULL, event TEXT NOT NULL, text TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS tree_deltas_node ON tree_deltas (node, seq)',
  'CREATE TABLE IF NOT EXISTS tree_weights (node TEXT PRIMARY KEY, weight INTEGER NOT NULL, at INTEGER NOT NULL)',
]

export type Event = Tree.Delta['event']

export type Spawned = { agent: string; at: number; sub: number; turn?: string }

export type Live = { budget: string; spent: string }

export type Result = {
  children: { needs: string[]; spec: string; statement: string | null; title: string }[]
  commit: string | null
  outcome: 'proved' | 'refuted' | 'split' | 'progress' | 'stuck'
  summary: string
  theorem: string | null
  why: string | null
}

export function nodeId(nid: string) {
  return 'n:' + nid
}

export function runId(nid: string, k: number) {
  return 'r:' + nid + ':' + k
}

export function verifyId(nid: string, sha: string) {
  return 'v:' + nid + ':' + sha.slice(0, 12)
}

export function settleId(id: string) {
  return 's:' + id
}

export function nidOf(id: string) {
  return id.split(':')[1] ?? ''
}

export function kOf(id: string) {
  return Number(id.split(':')[2] ?? 0)
}

export function normalized(title: string) {
  return title.trim().replace(/\s+/g, ' ')
}

export async function nid(parent: string, title: string) {
  return (await Store.noteId(parent + '\n' + normalized(title))).slice(0, 10)
}

const childId = nid

export async function stmt(statement: string | null) {
  if (!statement?.trim()) return 'none'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(statement.trim()))
  return Array.from(new Uint8Array(digest).slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const fence = '```'

export function spec(input: { statement: string | null; title: string; words: string }) {
  const parts = [normalized(input.title)]
  if (input.words.trim()) parts.push(input.words.trim())
  if (input.statement?.trim()) parts.push(fence + 'lean\n' + input.statement.trim() + '\n' + fence)
  return parts.join('\n\n')
}

export function parse(text: string) {
  const [title = '', ...rest] = text.split('\n')
  const body = rest.join('\n')
  const found = body.match(new RegExp(fence + 'lean\\n([\\s\\S]*?)\\n' + fence))
  return { statement: found?.[1]?.trim() ?? null, title, words: body.replace(found?.[0] ?? '\u0000', '').trim() }
}

export function settings(self: Swarm): Settings {
  return self.kv.get<Settings>('tree') ?? defaults
}

export function units(self: Swarm) {
  const set = settings(self)
  return { ideaMin: Memo.units(set.ideaMin), runCap: Memo.units(set.runCap), runMin: Memo.units(set.runMin), runStep: Memo.units(set.runStep), slots: set.slots, triageShare: set.triageShare }
}

export function swarm(self: Swarm) {
  const id = self.kv.get<string>('id')
  if (!id) throw new Error('The swarm has no id yet.')
  return id
}

export function changed(self: Swarm) {
  self.treeVersion += 1
  self.touch()
}

function terminal(task: Work.Task | undefined) {
  return !task || Work.terminal(task.phase)
}

export type State = {
  ledger: Flow.Ledger
  nodes: Map<string, Work.Task>
  rows: Flow.Row[]
  runs: Map<string, Work.Task[]>
  tasks: Map<string, Work.Task>
  verifies: Map<string, Work.Task[]>
}

export async function state(self: Swarm): Promise<State> {
  const [tasks, rows] = await Promise.all([self.board.tasks(), Flow.rows(self.env, swarm(self))])
  const nodes = new Map<string, Work.Task>()
  const runs = new Map<string, Work.Task[]>()
  const verifies = new Map<string, Work.Task[]>()
  for (const task of tasks) {
    const kind = task.labels['kind']
    if (kind === 'node') nodes.set(nidOf(task.id), task)
    const node = task.labels['node']
    if (node === undefined) continue
    if (kind === 'run') runs.set(node, [...(runs.get(node) ?? []), task])
    if (kind === 'verify') verifies.set(node, [...(verifies.get(node) ?? []), task])
  }
  return { ledger: Flow.fold(rows), nodes, rows, runs, tasks: new Map(tasks.map((task) => [task.id, task])), verifies }
}

export function needs(task: Work.Task) {
  const label = task.labels['needs']
  return label ? label.split(',').filter(Boolean) : []
}

export function parentOf(task: Work.Task) {
  return task.parent ? nidOf(task.parent) : null
}

export function statusOf(found: State, nid: string): Tree.Status {
  const node = found.nodes.get(nid)
  if (!node) return 'proposed'
  return Tree.status({ node, runs: found.runs.get(nid) ?? [], verifies: found.verifies.get(nid) ?? [] })
}

function settled(found: State, run: string) {
  return found.tasks.get(settleId(run))?.phase === 'done'
}

function openRun(found: State, nid: string) {
  return (found.runs.get(nid) ?? []).find((task) => !terminal(task) && !settled(found, task.id))
}

function children(found: State, nid: string) {
  return [...found.nodes.values()].filter((task) => parentOf(task) === nid).map((task) => nidOf(task.id))
}

function needsMet(found: State, task: Work.Task) {
  return needs(task).every((need) => found.nodes.get(need)?.phase === 'done')
}

function weights(self: Swarm) {
  return new Map(self.ctx.storage.sql.exec<{ node: string; weight: number }>('SELECT node, weight FROM tree_weights').toArray().map((row) => [row.node, Number(row.weight)]))
}

export function weigh(self: Swarm, nid: string, weight: number) {
  self.ctx.storage.sql.exec('INSERT INTO tree_weights (node, weight, at) VALUES (?, ?, ?) ON CONFLICT (node) DO UPDATE SET weight = excluded.weight, at = excluded.at', nid, Math.max(0, Math.min(10, Math.round(weight))), Date.now())
  changed(self)
}

function bucketTotal(found: State, run: string) {
  return found.ledger.runs.get(run) ?? 0n
}

function left(found: State, nid: string) {
  return found.ledger.left.get(nid) ?? 0n
}

function waiting(self: Swarm, nid: string) {
  return (self.kv.get<number>('stuck:' + nid) ?? 0) >= stuckRuns
}

export function emit(self: Swarm, nid: string, event: Event, text: string) {
  const at = Date.now()
  const seq = Number(self.ctx.storage.sql.exec<{ seq: number }>('INSERT INTO tree_deltas (at, node, event, text) VALUES (?, ?, ?, ?) RETURNING seq', at, nid, event, redact(text)).one().seq)
  changed(self)
  const announced = event === 'proven' || event === 'ended'
  if (!announced && !self.listened() && !self.treeWatchers.size) return
  self.ctx.waitUntil(
    view(self)
      .then(async (shown) => {
        const node = shown.nodes.get(nid)
        if (!node) return
        const delta: Tree.Delta = { at, event, node, seq, text: redact(text) }
        if (announced) self.ctx.waitUntil(Telegram.announce(self.env, swarm(self), shown.nodes.get(root)?.title ?? node.title, delta).catch(() => false))
        if (self.listened()) Chat.broadcast(self, { delta, type: 'delta' })
        const frame = new TextEncoder().encode('id: ' + seq + '\ndata: ' + JSON.stringify(delta) + '\n\n')
        for (const writer of [...self.treeWatchers]) await writer.write(frame).catch(() => self.treeWatchers.delete(writer))
      })
      .catch((error: unknown) => console.error('Sending a tree delta failed', error)),
  )
}

export function seq(self: Swarm) {
  return Number(self.ctx.storage.sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM tree_deltas').one().seq ?? 0)
}

export type Posting = { by: string; form: Tree.Form; needs: string[]; nid?: string; parent: string | null; statement: string | null; title: string; words: string }

export async function post(self: Swarm, input: Posting) {
  const id = input.nid ?? (input.parent === null ? root : await nid(input.parent, input.title))
  const posted = await self.board.post({
    id: nodeId(id),
    ...(input.parent === null ? {} : { parent: nodeId(input.parent) }),
    labels: { by: input.by.toLowerCase(), form: input.form, kind: 'node', needs: input.needs.join(','), stmt: await stmt(input.statement) },
    spec: spec(input),
  })
  if (posted.ok) {
    emit(self, id, 'posted', normalized(input.title))
    if (input.statement !== null && self.kv.get<number>('seeded')) self.ctx.waitUntil(Verify.statement(self.env, swarm(self), id, input.statement).catch(() => false))
    return { created: true, nid: id }
  }
  if (posted.rejection.kind === 'Exists') return { created: false, nid: id }
  throw new Error('Posting node ' + id + ' was refused: ' + posted.rejection.kind)
}

export function budgeting<T>(self: Swarm, work: () => Promise<T>) {
  return Work.serial(self.board, 'budgeting', lockMs, work)
}

export async function once<T>(self: Swarm, id: string, parent: string, work: () => Promise<T>): Promise<{ ran: true; value: T } | { ran: false }> {
  await Work.ensure(self.board, { id, labels: { kind: 'settle', of: parent }, spec: 'settle ' + parent })
  const held = await self.board.claim(id, { leaseMs: lockMs })
  if (!held.ok) return { ran: false }
  try {
    const value = await work()
    await self.board.finish(id, held.claim, { done: '' })
    return { ran: true, value }
  } catch (error) {
    await self.board.release(id, held.claim, String(error))
    throw error
  }
}

function nextK(found: State, nid: string) {
  let k = 0
  for (const task of found.runs.get(nid) ?? []) k = Math.max(k, kOf(task.id))
  for (const run of found.ledger.runs.keys()) if (Flow.runNode(run) === nid) k = Math.max(k, kOf(run))
  return k + 1
}

function weight(self: Swarm, found: State, weighed: Map<string, number>, nid: string) {
  const set = weighed.get(nid)
  if (set !== undefined) return set
  const task = found.nodes.get(nid)
  if (!task) return 0
  const by = task.labels['by'] ?? ''
  const parent = parentOf(task)
  if (by === 'seed' || (parent !== null && by === 'agent:n:' + parent)) return 1
  return (found.ledger.pledged.get(nid) ?? 0n) >= units(self).ideaMin ? 1 : 0
}

function eligible(self: Swarm, found: State, weighed: Map<string, number>, nid: string) {
  const task = found.nodes.get(nid)
  if (!task || terminal(task) || nid === triage || waiting(self, nid) || !needsMet(found, task)) return false
  const run = openRun(found, nid)
  if (run && bucketTotal(found, run.id) >= units(self).runStep) return false
  return weight(self, found, weighed, nid) > 0
}

async function grant(self: Swarm, found: State, from: string, to: string, amount: bigint, key: string) {
  const parts = Flow.split(Flow.shares(found.rows, { node: from, run: null }), amount)
  if (!parts.length) return 0n
  const written = await Flow.write(self.env, { from: { node: from, run: null }, id: key, kind: 'grant', parts, swarm: swarm(self), to: { node: to, run: null } })
  if (!written) return 0n
  await refresh(self, found)
  return Flow.sum(parts.map(([, value]) => value))
}

async function refresh(self: Swarm, found: State) {
  found.rows = await Flow.rows(self.env, swarm(self))
  found.ledger = Flow.fold(found.rows)
  changed(self)
}

function grantKey(found: State, from: string, to: string) {
  const prefix = 'grant:' + from + ':' + to + ':'
  let n = 0
  for (const row of found.rows) if (row.kind === 'grant' && row.node === to && row.peer === from) n += 1
  return prefix + n + ':' + found.rows.length
}

function reach(self: Swarm, found: State, weighed: Map<string, number>, nid: string): bigint {
  const task = found.nodes.get(nid)
  const parent = task ? parentOf(task) : null
  if (parent === null) return 0n
  const siblings = children(found, parent).filter((child) => child === nid || eligible(self, found, weighed, child))
  const total = siblings.reduce((sum, child) => sum + weight(self, found, weighed, child), 0)
  if (total <= 0) return 0n
  const above = parent === root ? 0n : reach(self, found, weighed, parent)
  return ((left(found, parent) + above) * BigInt(weight(self, found, weighed, nid))) / BigInt(total)
}

export async function pull(self: Swarm, found: State, nid: string, want: bigint, weighed = weights(self)): Promise<bigint> {
  const task = found.nodes.get(nid)
  const parent = task ? parentOf(task) : null
  if (parent === null || want <= 0n) return 0n
  const share = () => {
    const siblings = children(found, parent).filter((child) => child === nid || eligible(self, found, weighed, child))
    const total = siblings.reduce((sum, child) => sum + weight(self, found, weighed, child), 0)
    const mine = weight(self, found, weighed, nid)
    return total > 0 ? (left(found, parent) * BigInt(mine)) / BigInt(total) : 0n
  }
  if (share() < want && parent !== root) await pull(self, found, parent, want - share(), weighed)
  const take = share() < want ? share() : want
  if (take <= 0n) return 0n
  return grant(self, found, parent, nid, take, grantKey(found, parent, nid))
}

async function commit(self: Swarm, found: State, nid: string, run: string, amount: bigint, key: string) {
  const parts = Flow.split(Flow.shares(found.rows, { node: nid, run: null }), amount)
  if (!parts.length) return false
  const written = await Flow.write(self.env, { from: { node: nid, run: null }, id: key, kind: 'commit', parts, swarm: swarm(self), to: { node: nid, run } })
  if (written) await refresh(self, found)
  return written
}

export async function postRun(self: Swarm, found: State, nid: string, run: string) {
  const node = found.nodes.get(nid)
  const posted = await self.board.post(
    { id: run, labels: { kind: 'run', node: nid }, needs: node ? needs(node).map(nodeId) : [], parent: nodeId(nid), spec: 'run ' + kOf(run) + ' of ' + nid, terms: { retry } },
    { key: 'commit:' + nid + ':' + kOf(run) },
  )
  if (!posted.ok && posted.rejection.kind !== 'Exists') throw new Error('Posting ' + run + ' was refused: ' + posted.rejection.kind)
  changed(self)
}

export async function start(self: Swarm, found: State, nid: string, weighed = weights(self)) {
  const task = found.nodes.get(nid)
  if (!task || terminal(task) || nid === triage || waiting(self, nid) || !needsMet(found, task) || openRun(found, nid)) return false
  if ((found.verifies.get(nid) ?? []).some((one) => !terminal(one))) return false
  if (children(found, nid).some((child) => child !== triage && !terminal(found.nodes.get(child)))) return false
  const set = units(self)
  const want = set.runStep < set.runCap ? set.runStep : set.runCap
  const short = want - left(found, nid)
  if (short > 0n && !self.kv.get<number>('bounded:' + nid)) {
    const could = reach(self, found, weighed, nid)
    if (left(found, nid) + (could < short ? could : short) < set.runMin) return false
    await pull(self, found, nid, short, weighed)
  }
  const have = left(found, nid)
  const amount = have < want ? have : want
  if (amount < set.runMin) return false
  const run = runId(nid, nextK(found, nid))
  if (!(await commit(self, found, nid, run, amount, 'commit:' + nid + ':' + kOf(run)))) return false
  await postRun(self, found, nid, run)
  found.tasks = new Map((await self.board.tasks()).map((one) => [one.id, one]))
  const posted = found.tasks.get(run)
  if (posted) found.runs.set(nid, [...(found.runs.get(nid) ?? []), posted])
  emit(self, nid, 'funded', '$' + Memo.decimal(amount).replace(/\.?0+$/, '') + ' committed to run ' + kOf(run))
  return true
}

export async function consider(self: Swarm) {
  if (self.kv.get<number>('archivedAt')) return 0
  return budgeting(self, async () => {
    const found = await state(self)
    const weighed = weights(self)
    const depth = (nid: string) => {
      let d = 0
      for (let at = found.nodes.get(nid); at && parentOf(at) !== null; at = found.nodes.get(parentOf(at) ?? '')) d += 1
      return d
    }
    const order = [...found.nodes.keys()].sort((a, b) => depth(b) - depth(a) || (left(found, b) > left(found, a) ? 1 : -1))
    let started = 0
    for (const nid of order) if (await start(self, found, nid, weighed)) started += 1
    return started
  })
}

export async function topUp(self: Swarm, run: string, spent: bigint) {
  return budgeting(self, async () => {
    const found = await state(self)
    const nid = Flow.runNode(run)
    const task = found.tasks.get(run)
    if (terminal(task)) return null
    const set = units(self)
    const total = bucketTotal(found, run)
    if (total >= set.runCap || total - spent > set.runStep / 2n) return null
    const room = set.runCap - total
    const want = set.runStep < room ? set.runStep : room
    if (left(found, nid) < want) await pull(self, found, nid, want - left(found, nid))
    const have = left(found, nid)
    const amount = have < want ? have : want
    if (amount < set.runMin) return null
    const n = found.rows.filter((row) => row.run === run && row.kind === 'commit').length
    if (!(await commit(self, found, nid, run, amount, 'commit:' + nid + ':' + kOf(run) + ':' + n))) return null
    emit(self, nid, 'funded', '$' + Memo.decimal(amount).replace(/\.?0+$/, '') + ' more for run ' + kOf(run))
    return bucketTotal(found, run)
  })
}

export async function settleRun(self: Swarm, run: string, spent: bigint) {
  const nid = Flow.runNode(run)
  const ran = await once(self, settleId(run), run, () =>
    budgeting(self, async () => {
      const id = swarm(self)
      const bucket = { node: nid, run }
      let rows = await Flow.rows(self.env, id)
      const held = Flow.shares(rows, bucket)
      await Flow.write(self.env, { from: bucket, id: 'settle:' + run + ':spend', kind: 'spend', parts: Flow.split(held, spent), swarm: id, to: null })
      rows = await Flow.rows(self.env, id)
      await Flow.write(self.env, { from: bucket, id: 'settle:' + run + ':settle', kind: 'settle', parts: [...Flow.shares(rows, bucket)], swarm: id, to: { node: nid, run: null } })
      self.kv.delete('live:' + run)
      changed(self)
      return Flow.sum(held.values())
    }),
  )
  return ran.ran
}

export async function settleNode(self: Swarm, nid: string) {
  const id = swarm(self)
  return once(self, settleId(nodeId(nid)), nodeId(nid), () =>
    budgeting(self, async () => {
      const found = await state(self)
      const task = found.nodes.get(nid)
      const parent = task ? parentOf(task) : null
      const bucket = { node: nid, run: null }
      const own = new Map<string, bigint>()
      const inherited = new Map<string, bigint>()
      for (const row of found.rows) {
        if (row.node !== nid || row.run !== null) continue
        const mine = row.kind === 'pledge' || row.kind === 'move' || (row.kind === 'return' && row.amount < 0n && row.peer === Flow.free)
        const theirs = row.kind === 'grant' ? row.amount > 0n : row.kind === 'return' && row.amount < 0n && row.peer !== Flow.free
        if (mine) own.set(row.contributor, (own.get(row.contributor) ?? 0n) + row.amount)
        if (theirs) inherited.set(row.contributor, (inherited.get(row.contributor) ?? 0n) + row.amount)
      }
      const toParent: Flow.Part[] = []
      for (const [contributor, held] of Flow.shares(found.rows, bucket)) {
        const a = inherited.get(contributor) ?? 0n
        const b = own.get(contributor) ?? 0n
        const up = parent === null ? 0n : a <= 0n ? 0n : b <= 0n ? held : (held * a) / (a + b)
        if (up > 0n) toParent.push([contributor, up])
      }
      if (parent !== null) await Flow.write(self.env, { from: bucket, id: 'return:' + nid + ':parent', kind: 'return', parts: toParent, swarm: id, to: { node: parent, run: null } })
      const rest = Flow.shares(await Flow.rows(self.env, id), bucket)
      await Flow.write(self.env, { from: bucket, id: 'return:' + nid + ':free', kind: 'return', parts: [...rest], swarm: id, to: { node: Flow.free, run: null } })
      changed(self)
    }),
  )
}

export type Halt = (self: Swarm, run: string) => Promise<void>

export async function end(self: Swarm, nid: string, ended: Tree.End, halt: Halt) {
  const found = await state(self)
  const task = found.nodes.get(nid)
  if (!task || terminal(task)) return false
  for (const child of children(found, nid))
    if (!terminal(found.nodes.get(child))) await end(self, child, { ...ended, check: null, why: 'Its parent ended: ' + ended.why }, halt)
  for (const run of found.runs.get(nid) ?? []) if (!terminal(run)) await halt(self, run.id)
  const cancelled = await self.board.cancel(nodeId(nid), JSON.stringify(ended))
  if (!cancelled.ok && cancelled.rejection.kind !== 'Terminal') throw new Error('Ending ' + nid + ' was refused: ' + cancelled.rejection.kind)
  await settleNode(self, nid)
  emit(self, nid, 'ended', ended.kind + ': ' + ended.why)
  return true
}

export async function proven(self: Swarm, nid: string, check: Tree.Check, halt: Halt) {
  const found = await state(self)
  const task = found.nodes.get(nid)
  if (!task || terminal(task)) return false
  const held = await self.board.claim(nodeId(nid), { leaseMs: lockMs })
  if (!held.ok) throw new Error('Claiming ' + nid + ' to finish it was refused: ' + held.rejection.kind)
  const finished = await self.board.finish(nodeId(nid), held.claim, { done: JSON.stringify(check) })
  if (!finished.ok) {
    await self.board.release(nodeId(nid), held.claim)
    throw new Error('Finishing ' + nid + ' was refused: ' + finished.rejection.kind)
  }
  for (const child of children(found, nid))
    if (!terminal(found.nodes.get(child))) await end(self, child, { at: check.at, check: null, into: nid, kind: 'merged', why: 'Its parent was proven.' }, halt)
  for (const run of found.runs.get(nid) ?? []) if (!terminal(run)) await halt(self, run.id)
  await settleNode(self, nid)
  emit(self, nid, 'proven', 'Checked by Lean at ' + check.commit.slice(0, 7))
  return true
}

export async function heedNode(self: Swarm, nid: string, upto: number) {
  const held = await self.board.claim(nodeId(nid), { leaseMs: lockMs })
  if (!held.ok) return false
  try {
    const heeded = await self.board.heed(nodeId(nid), held.claim, upto)
    return heeded.ok
  } finally {
    await self.board.release(nodeId(nid), held.claim)
  }
}

export async function unheeded(self: Swarm, nid: string): Promise<Work.Steer[]> {
  return self.board.steers(nodeId(nid))
}

function resolveNeeds(names: readonly string[], titled: Map<string, string>, found: State) {
  return names.flatMap((name) => {
    const byTitle = titled.get(normalized(name).toLowerCase())
    if (byTitle) return [byTitle]
    const bare = name.startsWith('n:') ? name.slice(2) : name
    return found.nodes.has(bare) ? [bare] : []
  })
}

export async function ran(self: Swarm, run: string, result: Result, verify: (nid: string, sha: string, theorem: string, refutes: boolean) => Promise<void>) {
  const nid = Flow.runNode(run)
  emit(self, nid, 'progress', result.summary || result.outcome)
  if (result.outcome === 'stuck') self.kv.put('stuck:' + nid, (self.kv.get<number>('stuck:' + nid) ?? 0) + 1)
  else self.kv.delete('stuck:' + nid)
  if ((result.outcome === 'proved' || result.outcome === 'refuted') && result.commit && /^[0-9a-f]{40}$/.test(result.commit) && result.theorem) {
    await verify(nid, result.commit, result.theorem, result.outcome === 'refuted')
    emit(self, nid, 'checking', 'Checking ' + result.commit.slice(0, 7) + ' in Lean')
  }
  if (result.outcome === 'split' && result.children.length) {
    const found = await state(self)
    const titled = new Map<string, string>()
    for (const child of result.children) titled.set(normalized(child.title).toLowerCase(), await childId(nid, child.title))
    for (const child of result.children.slice(0, 20))
      await post(self, {
        by: 'agent:n:' + nid,
        form: child.statement ? 'lemma' : 'approach',
        needs: resolveNeeds(child.needs, titled, found).filter((need) => need !== titled.get(normalized(child.title).toLowerCase())),
        parent: nid,
        statement: child.statement,
        title: child.title,
        words: child.spec,
      })
  }
}

export async function reconcile(self: Swarm, spentOf: (run: string) => Promise<bigint | null>) {
  const found = await state(self)
  for (const [run, amount] of found.ledger.runs) {
    const task = found.tasks.get(run)
    const nid = Flow.runNode(run)
    if (!task && amount > 0n && !terminal(found.nodes.get(nid))) await postRun(self, found, nid, run)
    if (task && terminal(task) && amount > 0n) {
      const spent = await spentOf(run)
      if (spent !== null) await settleRun(self, run, spent)
    }
  }
  for (const runs of found.runs.values())
    for (const task of runs) if (!terminal(task) && !found.ledger.runs.has(task.id) && task.labels['node'] !== undefined) await self.board.cancel(task.id, 'orphan')
  for (const [nid, task] of found.nodes) if (terminal(task) && left(found, nid) > 0n) await settleNode(self, nid)
}

function whoOf(by: string, names: Map<string, string>): Tree.Who {
  if (/^0x[0-9a-f]{40}$/.test(by)) return { address: by as `0x${string}`, agent: null, handle: names.get(by) ?? Mention.short(by as `0x${string}`) }
  if (by.startsWith('agent:')) return { address: null, agent: by, handle: 'agent' }
  return { address: null, agent: by || null, handle: by || 'swarm' }
}

function json<T>(text: string | undefined): T | null {
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

function ending(task: Work.Task): Tree.End | null {
  if (task.phase !== 'failed' && task.phase !== 'cancelled') return null
  const text = task.outcome && 'failed' in task.outcome ? task.outcome.failed : task.reason
  return json<Tree.End>(text) ?? { at: 0, check: null, into: null, kind: 'exhausted', why: text ?? '' }
}

export type View = { nodes: Map<string, Tree.Node>; seq: number; state: State }

export async function view(self: Swarm): Promise<View> {
  const version = self.treeVersion
  const kept = self.treeView
  if (kept && kept.version === version) return kept.value
  const found = await state(self)
  const value = fold(self, found, await handles(self, found))
  if (self.treeVersion === version) self.treeView = { value, version }
  return value
}

async function handles(self: Swarm, found: State) {
  const addresses = new Set<`0x${string}`>()
  for (const task of found.nodes.values()) if (/^0x[0-9a-f]{40}$/.test(task.labels['by'] ?? '')) addresses.add(task.labels['by'] as `0x${string}`)
  for (const funders of found.ledger.funders.values()) for (const address of funders.keys()) addresses.add(address as `0x${string}`)
  return Store.handles(self.env, [...addresses])
}

const zero = (): Record<Tree.Status, number> => ({ 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 0 })

function fold(self: Swarm, found: State, names: Map<string, string>): View {
  const times = new Map(
    self.ctx.storage.sql
      .exec<{ first: number; last: number; node: string }>('SELECT node, MIN(at) AS first, MAX(at) AS last FROM tree_deltas GROUP BY node')
      .toArray()
      .map((row) => [row.node, { first: Number(row.first), last: Number(row.last) }]),
  )
  const kids = new Map<string, string[]>()
  for (const [nid, task] of found.nodes) {
    const parent = parentOf(task)
    if (parent !== null) kids.set(parent, [...(kids.get(parent) ?? []), nid])
  }
  const nodes = new Map<string, Tree.Node>()
  const build = (nid: string): Tree.Node => {
    const task = found.nodes.get(nid) as Work.Task
    const runs = found.runs.get(nid) ?? []
    const verifies = found.verifies.get(nid) ?? []
    const status = Tree.status({ node: task, runs, verifies })
    const open = runs.find((run) => !terminal(run))
    const liveOf = open ? self.kv.get<Live>('live:' + open.id) : undefined
    const live = liveOf ? Memo.units(liveOf.spent) : 0n
    const bucket = open ? bucketTotal(found, open.id) : 0n
    const checking = verifies.some((one) => !terminal(one))
    const last = open ?? (checking ? runs.at(-1) : undefined)
    const spawned = last ? self.kv.get<Spawned>('run:' + last.id) : undefined
    const run: Tree.Run | null = last
      ? { agent: spawned?.sub ?? null, attempt: last.attempts, budget: Flow.usd(bucket), checking, k: kOf(last.id), since: spawned?.at ?? 0, spent: Flow.usd(live), task: last.id, until: last.untilMs ?? 0 }
      : null
    const parsed = parse(task.spec)
    const childIds = (kids.get(nid) ?? []).sort()
    const built = childIds.map(build)
    const counts = zero()
    counts[status] += 1
    let subSpent = (found.ledger.spent.get(nid) ?? 0n) + live
    let subLeft = left(found, nid)
    let subPledged = found.ledger.pledged.get(nid) ?? 0n
    for (const child of built) {
      for (const key of Object.keys(counts) as Tree.Status[]) counts[key] += child.counts[key]
      subSpent += Memo.units(child.money.subtree.spent)
      subLeft += Memo.units(child.money.subtree.left)
      subPledged += Memo.units(child.money.subtree.pledged)
    }
    const funders = [...(found.ledger.funders.get(nid) ?? new Map()).entries()]
      .sort((a, b) => (b[1].amount > a[1].amount ? 1 : b[1].amount < a[1].amount ? -1 : 0))
      .map(([address, held]) => ({ amount: Flow.usd(held.amount), since: held.since, who: whoOf(address, names) }))
    const committed = bucket - live
    const node: Tree.Node = {
      by: whoOf(task.labels['by'] ?? '', names),
      children: childIds,
      counts,
      createdAt: times.get(nid)?.first ?? 0,
      end: ending(task),
      form: (task.labels['form'] ?? 'idea') as Tree.Form,
      funders,
      id: nid,
      money: {
        committed: Flow.usd(committed > 0n ? committed : 0n),
        granted: Flow.usd(found.ledger.granted.get(nid) ?? 0n),
        inherited: Flow.usd(found.ledger.inherited.get(nid) ?? 0n),
        left: Flow.usd(left(found, nid)),
        pledged: Flow.usd(found.ledger.pledged.get(nid) ?? 0n),
        spent: Flow.usd((found.ledger.spent.get(nid) ?? 0n) + live),
        subtree: { left: Flow.usd(subLeft), pledged: Flow.usd(subPledged), spent: Flow.usd(subSpent) },
      },
      needs: needs(task),
      parent: parentOf(task),
      review: task.labels['by'] === 'seed' && parsed.statement !== null && !self.kv.get('seedReviewed') && !self.kv.get('reviewed:' + nid),
      proof: task.phase === 'done' && task.outcome && 'done' in task.outcome ? json<Tree.Check>(task.outcome.done) : null,
      riders: funders.length,
      run,
      spec: task.spec,
      statement: parsed.statement,
      status,
      title: parsed.title,
      updatedAt: times.get(nid)?.last ?? 0,
    }
    nodes.set(nid, node)
    return node
  }
  for (const [nid, task] of found.nodes) if (parentOf(task) === null || !found.nodes.has(parentOf(task) ?? '')) build(nid)
  for (const node of nodes.values()) node.funders = node.funders.slice(0, 5)
  return { nodes, seq: seq(self), state: found }
}

export function allFunders(found: State, nid: string, names: Map<string, string>) {
  return [...(found.ledger.funders.get(nid) ?? new Map()).entries()]
    .sort((a, b) => (b[1].amount > a[1].amount ? 1 : -1))
    .map(([address, held]) => ({ amount: Flow.usd(held.amount), since: held.since, who: whoOf(address, names) }))
}

export { whoOf as who, handles as names }
