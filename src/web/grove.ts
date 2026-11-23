import type { TreeView } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'
import type * as Tree from '../shared/Tree.ts'

export type Filter = 'all' | 'flight' | 'proven' | 'dead' | 'money'

export const filters: readonly (readonly [Filter, string])[] = [
  ['all', 'All'],
  ['flight', 'In flight'],
  ['proven', 'Proven'],
  ['dead', 'Dead ends'],
  ['money', 'Needs money'],
]

export type Grove = { headline: Tree.Headline; landed: Readonly<Record<string, number>>; nodes: Readonly<Record<string, Tree.Node>>; seq: number }

export type Row = { depth: number; frontier: boolean; hit: boolean; node: Tree.Node; open: boolean }

export const runMin = 500_000n

const statuses: readonly Tree.Status[] = ['proposed', 'funded', 'in flight', 'proven', 'dead end']

const before: Partial<Record<Tree.Delta['event'], Tree.Status>> = { ended: 'in flight', funded: 'proposed', proven: 'in flight', started: 'funded' }

export function grow(view: TreeView, kept?: Grove): Grove {
  const fresh = Object.fromEntries(view.nodes.map((node) => [node.id, node]))
  return { headline: view.headline, landed: kept?.landed ?? {}, nodes: kept ? { ...kept.nodes, ...fresh } : fresh, seq: view.seq }
}

export function graft(grove: Grove, view: TreeView): Grove {
  return { ...grove, nodes: { ...grove.nodes, ...Object.fromEntries(view.nodes.map((node) => [node.id, node])) }, seq: Math.max(grove.seq, view.seq) }
}

export function closed(node: Tree.Node) {
  return node.status === 'proven' || node.status === 'dead end'
}

export function frontier(node: Tree.Node | undefined, nodes: Readonly<Record<string, Tree.Node>>) {
  return !!node && node.form === 'lemma' && !closed(node) && node.needs.every((need) => nodes[need]?.status === 'proven')
}

export function needsMoney(node: Tree.Node) {
  return node.status === 'proposed' && node.form !== 'triage' && units(node.money.left) < runMin
}

export function fits(filter: Filter, node: Tree.Node) {
  if (filter === 'flight') return node.status === 'in flight'
  if (filter === 'proven') return node.status === 'proven'
  if (filter === 'dead') return node.status === 'dead end'
  if (filter === 'money') return needsMoney(node)
  return true
}

function plus(value: string, change: bigint) {
  return change === 0n ? value : decimal(units(value) + change)
}

function counted(counts: Record<Tree.Status, number>, change: Record<Tree.Status, number>) {
  return Object.fromEntries(statuses.map((status) => [status, counts[status] + change[status]])) as Record<Tree.Status, number>
}

function zero(): Record<Tree.Status, number> {
  return { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 0 }
}

export function patch(grove: Grove, delta: Tree.Delta): Grove {
  if (delta.seq <= grove.seq) return grove
  const next = delta.node
  const old = grove.nodes[next.id]
  const was = old?.status ?? (delta.event === 'posted' ? undefined : (before[delta.event] ?? next.status))
  const change = zero()
  if (old) for (const status of statuses) change[status] = next.counts[status] - old.counts[status]
  else if (delta.event === 'posted') Object.assign(change, next.counts)
  else if (was) {
    change[next.status] += 1
    change[was] -= 1
  }
  const spent = old ? units(next.money.subtree.spent) - units(old.money.subtree.spent) : delta.event === 'posted' ? units(next.money.subtree.spent) : 0n
  const left = old ? units(next.money.subtree.left) - units(old.money.subtree.left) : delta.event === 'posted' ? units(next.money.subtree.left) : 0n
  const pledged = old ? units(next.money.subtree.pledged) - units(old.money.subtree.pledged) : delta.event === 'posted' ? units(next.money.subtree.pledged) : 0n
  const nodes: Record<string, Tree.Node> = { ...grove.nodes, [next.id]: next }
  const moved = statuses.some((status) => change[status] !== 0) || spent !== 0n || left !== 0n || pledged !== 0n
  for (let at = next.parent, guard = 0; at && guard < 256; guard++) {
    const parent = nodes[at]
    if (!parent) break
    const adopted = !old && !parent.children.includes(next.id) && at === next.parent
    if (moved || adopted)
      nodes[at] = {
        ...parent,
        children: adopted ? [...parent.children, next.id] : parent.children,
        counts: counted(parent.counts, change),
        money: { ...parent.money, subtree: { left: plus(parent.money.subtree.left, left), pledged: plus(parent.money.subtree.pledged, pledged), spent: plus(parent.money.subtree.spent, spent) } },
      }
    at = parent.parent
  }
  const own = (status: Tree.Status) => (next.status === status ? 1 : 0) - (was === status ? 1 : 0)
  const touched = [next.id, ...Object.values(nodes).flatMap((node) => (node.needs.includes(next.id) ? [node.id] : []))]
  const reach = touched.reduce((sum, id) => sum + (frontier(nodes[id], nodes) ? 1 : 0) - (frontier(grove.nodes[id], grove.nodes) ? 1 : 0), 0)
  const proven = grove.headline.proven + own('proven')
  const total = plus(grove.headline.spent, units(next.money.spent) - units(old?.money.spent ?? next.money.spent))
  const headline: Tree.Headline = {
    deadEnds: grove.headline.deadEnds + own('dead end'),
    frontier: Math.max(0, grove.headline.frontier + reach),
    inFlight: Math.max(0, grove.headline.inFlight + own('in flight')),
    lastProvenAt: next.status === 'proven' && next.proof && next.proof.at > (grove.headline.lastProvenAt ?? 0) ? next.proof.at : grove.headline.lastProvenAt,
    pledged: plus(grove.headline.pledged, units(next.money.pledged) - units(old?.money.pledged ?? (delta.event === 'posted' ? '0' : next.money.pledged))),
    perProven: proven > 0 ? decimal(units(total) / BigInt(proven)) : null,
    proven,
    spent: total,
  }
  const landed = delta.event === 'proven' && was !== 'proven' ? { ...grove.landed, [next.id]: delta.at } : grove.landed
  return { headline, landed, nodes, seq: delta.seq }
}

export function rows(nodes: Readonly<Record<string, Tree.Node>>, root: string, open: ReadonlySet<string>, filter: Filter): Row[] {
  const out: Row[] = []
  const hits = new Map<string, boolean>()
  const hit = (id: string, guard = 0): boolean => {
    const known = hits.get(id)
    if (known !== undefined) return known
    const node = nodes[id]
    const found = !!node && guard < 64 && (fits(filter, node) || node.children.some((child) => hit(child, guard + 1)))
    hits.set(id, found)
    return found
  }
  const walk = (id: string, depth: number) => {
    const node = nodes[id]
    if (!node || depth > 64) return
    if (filter !== 'all' && !hit(id)) return
    const unfolded = filter !== 'all' || open.has(id)
    out.push({ depth, frontier: frontier(node, nodes), hit: fits(filter, node), node, open: unfolded && node.children.length > 0 })
    if (unfolded) for (const child of node.children) walk(child, depth + 1)
  }
  walk(root, 0)
  return out
}

export function trail(nodes: Readonly<Record<string, Tree.Node>>, id: string) {
  const path: Tree.Node[] = []
  for (let at: string | null = id, guard = 0; at && guard < 64; guard++) {
    const node: Tree.Node | undefined = nodes[at]
    if (!node) break
    path.unshift(node)
    at = node.parent
  }
  return path
}

export function missing(nodes: Readonly<Record<string, Tree.Node>>, id: string) {
  return nodes[id]?.children.some((child) => !nodes[child]) ?? false
}

export function since(nodes: Readonly<Record<string, Tree.Node>>, at: number) {
  const all = Object.values(nodes)
  const proven = all.filter((node) => node.status === 'proven' && (node.proof?.at ?? 0) > at)
  const dead = all.filter((node) => node.status === 'dead end' && (node.end?.at ?? 0) > at)
  const posted = all.filter((node) => node.createdAt > at)
  return { dead, posted, proven }
}


export function pledged(node: Tree.Node) {
  return units(node.money.subtree.pledged)
}

export function ranked(nodes: Readonly<Record<string, Tree.Node>>, id: string, filter: Filter) {
  const kids = (nodes[id]?.children ?? []).flatMap((child) => {
    const node = nodes[child]
    return node && node.form !== 'triage' && (filter === 'all' || rows(nodes, child, new Set(), filter).length) ? [node] : []
  })
  return kids.sort((a, b) => Number(a.status === 'dead end') - Number(b.status === 'dead end') || (pledged(b) > pledged(a) ? 1 : pledged(b) < pledged(a) ? -1 : 0) || a.createdAt - b.createdAt)
}

export function sum(nodes: readonly Tree.Node[]) {
  return decimal(nodes.reduce((total, node) => total + pledged(node), 0n))
}
