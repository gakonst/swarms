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
}
export type Delta = { seq: number; at: number; node: Node; event: 'posted' | 'funded' | 'started' | 'progress' | 'checking' | 'proven' | 'ended' | 'steered' | 'moved' | 'doing'; text: string }
export type Headline = { proven: number; frontier: number; inFlight: number; deadEnds: number; spent: Usd; pledged: Usd; perProven: Usd | null; lastProvenAt: number | null }
export type Burn = { at: number; proven: number; deadEnds: number; spent: Usd }[]

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
