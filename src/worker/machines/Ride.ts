import type { Address } from 'viem'
import { z } from 'zod'
import { assert, never } from '../../shared/Assert.ts'
import type * as Tree from '../../shared/Tree.ts'

export const version = 1

export type Fault = { detail: string; status: 400 | 403 | 404 | 409 | 410 }

export type Task = 'open' | 'closed' | 'missing'

export type Proposal = { by: string; form: Tree.Form; parent: string; said?: { mentions: Address[]; text: string } | null; statement: string | null; title: string; words: string }

export type Reviewed = { at: number; by: string; v: number }

export type Route = { at: 'adopt'; nid: string; proposal: Proposal } | { at: 'node'; nid: string } | { at: 'free' }

export type Target = { at: 'node'; nid: string } | { at: 'free' }

export type Spot = { at: 'free' } | { at: 'node'; nid: string; task: Task; triage: boolean }

export type Facts = {
  amount: bigint
  ideaMin: bigint
  known: boolean
  parent: Task
  proposal: Proposal | null
  requested: string | null
  root: string
}

const forms = ['goal', 'program', 'approach', 'lemma', 'idea', 'triage'] as const satisfies readonly Tree.Form[]

const address = z.custom<Address>((value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value))

const record = z.object({
  by: z.string(),
  form: z.enum(forms),
  parent: z.string(),
  said: z.object({ mentions: z.array(address), text: z.string() }).nullable().optional(),
  statement: z.string().nullable(),
  title: z.string(),
  v: z.number().int().optional(),
  words: z.string(),
})

export function stored(proposal: Proposal) {
  return { ...proposal, v: version }
}

export function read(raw: unknown, key: string): Proposal | null {
  if (raw === undefined || raw === null) return null
  const parsed = record.safeParse(raw)
  if (!parsed.success) {
    console.error('Dropping an unreadable proposal record', key, parsed.error.issues)
    return null
  }
  const found = parsed.data
  const proposal: Proposal = { by: found.by, form: found.form, parent: found.parent, statement: found.statement, title: found.title, words: found.words }
  return found.said === undefined ? proposal : { ...proposal, said: found.said }
}

export function reviewed(at: number, by: string): Reviewed {
  assert(Number.isFinite(at) && at > 0, 'a review is stamped with a time', at)
  return { at, by, v: version }
}

export function route(facts: Facts): Route {
  if (facts.requested !== null && !facts.known && facts.proposal) {
    if (facts.amount < facts.ideaMin || facts.parent !== 'open') return { at: 'free' }
    assert(facts.amount >= facts.ideaMin, 'an adopted proposal is paid at least the idea minimum', facts.amount)
    return { at: 'adopt', nid: facts.requested, proposal: facts.proposal }
  }
  if (facts.requested !== null && facts.known) return { at: 'node', nid: facts.requested }
  return { at: 'node', nid: facts.root }
}

export function land(route: Route, task: Task, triage: string): Target {
  switch (route.at) {
    case 'free':
      return { at: 'free' }
    case 'adopt':
    case 'node':
      return task === 'open' && route.nid !== triage ? { at: 'node', nid: route.nid } : { at: 'free' }
    default:
      return never(route, 'pledge route')
  }
}

export function proposable(parent: Task, parentId: string, triage: string): Fault | null {
  if (parent !== 'open') return { detail: 'The parent node is not open.', status: 409 }
  if (parentId === triage) return { detail: 'Nodes go under the tree, not under triage.', status: 400 }
  return null
}

export function steerable(task: Task, triage: boolean): Fault | null {
  return task !== 'open' || triage ? { detail: 'This node is not open.', status: 409 } : null
}

export function backed(behind: bigint): Fault | null {
  return behind <= 0n ? { detail: 'Only a rider with money on this node can steer it.', status: 403 } : null
}

function same(from: Spot, to: Spot) {
  if (from.at === 'free' || to.at === 'free') return from.at === to.at
  return from.nid === to.nid
}

export function movable(from: Spot, to: Spot): Fault | null {
  for (const spot of [from, to]) {
    switch (spot.at) {
      case 'free':
        continue
      case 'node':
        if (spot.task === 'missing' || spot.triage) return { detail: 'No node has this id.', status: 404 }
        if (to.at === 'node' && spot.nid === to.nid && spot.task === 'closed') return { detail: 'Money moves only onto an open node.', status: 409 }
        continue
      default:
        return never(spot, 'money spot')
    }
  }
  if (same(from, to)) return { detail: 'Move money between two different places.', status: 400 }
  return null
}

export function endable(input: { admin: boolean; fixed: boolean; mine: bigint; task: Task; total: bigint }): Fault | null {
  if (input.task === 'missing' || input.fixed) return { detail: 'No node you can end has this id.', status: 404 }
  if (input.task === 'closed') return { detail: 'This node has ended already.', status: 409 }
  if (!input.admin && (input.total === 0n || input.mine * 2n <= input.total)) return { detail: 'Only whoever holds more than half of what is behind a node, or an admin, can end it.', status: 403 }
  return null
}
