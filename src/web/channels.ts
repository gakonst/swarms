import { useSyncExternalStore } from 'react'
import type { TreeView } from '../shared/Api.ts'
import type * as Tree from '../shared/Tree.ts'
import { seeded, server } from './boot.ts'

export type Thread = { at: number; checking: boolean; doing: string | null; id: string; live: boolean; money: string; status: Tree.Status; title: string }

export type Shape = { threads: readonly Thread[] }

function busy(node: Tree.Node) {
  return node.status === 'in flight' || node.counts['in flight'] > 0
}

function doingOf(node: Tree.Node) {
  return node.status === 'in flight' && node.run?.doing?.text ? node.run.doing : null
}

function thread(node: Tree.Node): Thread {
  const said = doingOf(node)
  return { at: said?.at ?? node.updatedAt, checking: !!node.run?.checking, doing: said?.text ?? null, id: node.id, live: busy(node), money: node.money.subtree.pledged, status: node.status, title: node.title }
}

function order(a: Thread, b: Thread) {
  return Number(b.live) - Number(a.live) || Number(b.money) - Number(a.money)
}

export function fromTree(nodes: readonly Tree.Node[]): Shape {
  return { threads: nodes.filter((node) => node.id !== 'root').map(thread).sort(order) }
}

const shapes = new Map<string, { key: string; shape: Shape }>()

const planted = new Map<string, { from: unknown; shape: Shape }>()

const watchers = new Set<() => void>()

const nothing: readonly (readonly [string, Shape])[] = Object.freeze([])

let every = nothing

function seed(id: string): Shape | undefined {
  const tree = seeded<TreeView>(`tree:${id}`)
  if (!tree) return undefined
  if (server) return fromTree(tree.nodes)
  const kept = planted.get(id)
  if (kept && kept.from === tree) return kept.shape
  const shape = fromTree(tree.nodes)
  planted.set(id, { from: tree, shape })
  return shape
}

function keep(id: string, shape: Shape) {
  const key = JSON.stringify(shape)
  const before = shapes.get(id)
  if (before?.key === key) return
  if (!before) {
    const first = seed(id)
    if (first && JSON.stringify(first) === key) {
      shapes.set(id, { key, shape: first })
      every = [...shapes].map(([each, held]) => [each, held.shape] as const)
      for (const watcher of watchers) watcher()
      return
    }
  }
  shapes.set(id, { key, shape })
  every = [...shapes].map(([each, held]) => [each, held.shape] as const)
  for (const watcher of watchers) watcher()
}

export function shareTree(id: string, nodes: Readonly<Record<string, Tree.Node>>) {
  keep(id, fromTree(Object.values(nodes)))
}

function watch(listener: () => void) {
  watchers.add(listener)
  return () => {
    watchers.delete(listener)
  }
}

export function useShapes() {
  return useSyncExternalStore(watch, () => every, () => nothing)
}
