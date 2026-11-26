import type { Board } from 'nanocode-ts'
import { decimal, units } from './Memo.ts'

export type Form = 'goal' | 'program' | 'approach' | 'lemma' | 'idea' | 'triage'
export type Status = 'proposed' | 'funded' | 'in flight' | 'proven' | 'dead end'
export type Usd = string
export type Who = { address: `0x${string}` | null; agent: string | null; handle: string }
export type Check = {
  repo: string
  commit: string
  theorem: string
  statement: string
  axioms: string[]
  toolchain: string
  mathlib: string
  checker: string
  command: string
  exitCode: number
  durationMs: number
  contentHash: string
  run: string
  url: string
  at: number
}
export type End = {
  kind: 'refuted' | 'barrier' | 'exhausted' | 'merged' | 'withdrawn' | 'rejected'
  why: string
  into: string | null
  check: Check | null
  at: number
}
export type Funder = { who: Who; amount: Usd; since: number }
export type Money = {
  pledged: Usd
  inherited: Usd
  granted: Usd
  spent: Usd
  left: Usd
  committed: Usd
  subtree: { spent: Usd; left: Usd; pledged: Usd }
}
export type Doing = { text: string; at: number }
export type Last = { event: 'started' | 'progress' | 'checking' | 'proven' | 'ended'; text: string; at: number }
export type Ran = { k: number; outcome: 'proved' | 'refuted' | 'split' | 'progress' | 'stuck' | 'failed'; summary: string }
export type Run = { task: string; k: number; attempt: number; agent: number | null; since: number; until: number; budget: Usd; spent: Usd; checking: boolean; doing?: Doing | null; model?: string | null }
export type Node = {
  id: string
  parent: string | null
  paused: number | null
  form: Form
  title: string
  spec: string
  statement: string | null
  review: boolean
  by: Who
  status: Status
  end: End | null
  proof: Check | null
  run: Run | null
  needs: string[]
  children: string[]
  counts: Record<Status, number>
  money: Money
  funders: Funder[]
  riders: number
  createdAt: number
  updatedAt: number
  last?: Last | null
  ran?: Ran | null
}
export type Delta = { seq: number; at: number; node: Node; event: 'posted' | 'funded' | 'started' | 'progress' | 'checking' | 'proven' | 'ended' | 'steered' | 'moved' | 'doing'; text: string }
export type Headline = { proven: number; frontier: number; inFlight: number; deadEnds: number; spent: Usd; pledged: Usd; perProven: Usd | null; lastProvenAt: number | null }
export type Burn = { at: number; proven: number; deadEnds: number; spent: Usd }[]

export const worked: readonly Last['event'][] = ['started', 'progress', 'checking', 'proven', 'ended']

export type State = 'open' | 'stuck' | 'blocked' | 'queued' | 'running' | 'checking' | 'stalled' | 'paused' | 'done' | 'dead'
export type Line = { state: State; label: string; text: string; at: number | null; run: number | null; agent: number | null; spent: Usd | null; budget: Usd | null }

const labels: Record<State, string> = { stuck: 'Stuck', blocked: 'Blocked', checking: 'Checking', dead: 'Dead end', done: 'Done', open: 'Open', paused: 'Paused', queued: 'Queued', running: 'Running', stalled: 'Stalled' }

export const graceMs = 2_000

export function line(node: Node, now: number, title: (nid: string) => { title: string; status: Status } | undefined): Line {
  const last = node.last ?? null
  const base = { agent: null, at: last?.at ?? null, budget: null, run: null, spent: null, text: last?.text ?? '' }
  const make = (state: State, rest: Partial<Line> = {}): Line => ({ ...base, ...rest, label: labels[state], state })
  if (node.status === 'proven') return make('done', node.proof ? { at: node.proof.at || base.at, text: 'Checked by Lean at ' + node.proof.commit.slice(0, 7) } : {})
  if (node.status === 'dead end') return make('dead', node.end ? { at: node.end.at || base.at, text: node.end.why || node.end.kind } : {})
  if (node.status === 'in flight' && node.run) {
    const run = { agent: node.run.agent, budget: node.run.budget, run: node.run.k, spent: node.run.spent }
    if (node.run.checking) return make('checking', run)
    if (node.run.until > 0 && node.run.until + graceMs < now) return make('stalled', { ...run, at: node.run.until, text: 'Its lease lapsed' })
    const doing = node.run.doing?.text ? node.run.doing : null
    return make('running', { ...run, at: doing?.at ?? node.run.since ?? base.at, text: doing?.text ?? base.text })
  }
  const waiting = node.needs.map(title).find((need) => need && need.status !== 'proven')
  if (waiting) return make('blocked', { at: null, text: 'Waits on ' + waiting.title })
  if (node.paused !== null) return make('paused', { text: node.paused + ' runs without a result' })
  if (node.status === 'proposed' && node.ran && (node.ran.outcome === 'stuck' || node.ran.outcome === 'failed')) return make('stuck', { run: node.ran.k, text: node.ran.summary || base.text })
  return make(node.status === 'funded' ? 'queued' : 'open')
}

const held = new Set<Board.Stage>(['held', 'lapsed', 'stalled'])
const waiting = new Set<Board.Stage>(['open', 'blocked', 'scheduled'])

function open(task: Board.Task) {
  return task.phase !== 'done' && task.phase !== 'failed' && task.phase !== 'cancelled'
}

export function status(input: { node: Board.Task; runs: readonly Board.Task[]; verifies: readonly Board.Task[] }): Status {
  if (input.node.phase === 'done') return 'proven'
  if (input.node.phase === 'failed' || input.node.phase === 'cancelled') return 'dead end'
  if (input.runs.some((run) => open(run) && (run.phase === 'claimed' || held.has(run.stage)))) return 'in flight'
  if (input.verifies.some(open)) return 'in flight'
  if (input.runs.some((run) => open(run) && waiting.has(run.stage))) return 'funded'
  return 'proposed'
}

export function headline(nodes: readonly Node[]): Headline {
  const proven = new Set(nodes.filter((node) => node.status === 'proven').map((node) => node.id))
  let spent = 0n
  let pledged = 0n
  let lastProvenAt: number | null = null
  for (const node of nodes) {
    spent += units(node.money.spent)
    pledged += units(node.money.pledged)
    if (node.status === 'proven' && node.proof && (lastProvenAt === null || node.proof.at > lastProvenAt)) lastProvenAt = node.proof.at
  }
  return {
    deadEnds: nodes.filter((node) => node.status === 'dead end').length,
    frontier: nodes.filter((node) => node.form === 'lemma' && node.status !== 'proven' && node.status !== 'dead end' && node.needs.every((need) => proven.has(need))).length,
    inFlight: nodes.filter((node) => node.status === 'in flight').length,
    lastProvenAt,
    pledged: decimal(pledged),
    perProven: proven.size ? decimal(spent / BigInt(proven.size)) : null,
    proven: proven.size,
    spent: decimal(spent),
  }
}
