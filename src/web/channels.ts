import { useSyncExternalStore } from 'react'
import type { Branch, Branches, TreeView } from '../shared/Api.ts'
import * as Crew from '../shared/Crew.ts'
import * as Prose from '../shared/Prose.ts'
import type * as Tree from '../shared/Tree.ts'
import { seeded, server } from './boot.ts'

export type Thread = { at: number; checking: boolean; doing: string | null; id: string; live: boolean; money: string; status: Tree.Status; title: string }

export type Channel = { at: number; id: string; live: boolean; money: string; status: Tree.Status; threads: readonly Thread[]; title: string; topic: string }

export type Shape = { form: 'tree' | 'agent'; channels: readonly Channel[] }

export const crewMarks: Record<Crew.State, Tree.Status> = { done: 'proven', failed: 'dead end', starved: 'proposed', stopped: 'proposed', working: 'in flight' }

function busy(node: Tree.Node) {
  return node.status === 'in flight' || node.counts['in flight'] > 0
}

function doingOf(node: Tree.Node) {
  return node.status === 'in flight' && node.run?.doing?.text ? node.run.doing : null
}

function topicOf(spec: string) {
  const text = spec.replace(/^#[^\n]*\n+/, '').replace(/```[\s\S]*?```/g, '').trim()
  return Prose.line(text.split('\n').find((line) => line.trim()) ?? '')
}

function thread(node: Tree.Node): Thread {
  const said = doingOf(node)
  return { at: said?.at ?? node.updatedAt, checking: !!node.run?.checking, doing: said?.text ?? null, id: node.id, live: busy(node), money: node.money.subtree.pledged, status: node.status, title: node.title }
}

function order(a: Thread, b: Thread) {
  return Number(b.live) - Number(a.live) || Number(b.money) - Number(a.money)
}

export function fromTree(nodes: readonly Tree.Node[]): Shape {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const programs = (byId.get('root')?.children ?? []).flatMap((nid) => byId.get(nid) ?? [])
  return {
    channels: programs
      .map((node) => ({
        at: node.updatedAt,
        id: node.id,
        live: busy(node),
        money: node.money.subtree.pledged,
        status: node.status,
        threads: node.children.flatMap((nid) => byId.get(nid) ?? []).map(thread).sort(order),
        title: node.title,
        topic: topicOf(node.spec),
      }))
      .sort((a, b) => Number(b.money) - Number(a.money)),
    form: 'tree',
  }
}

function branchThread(branch: Branch): Thread {
  const member = Crew.member(branch)
  return { at: 0, checking: member.state === 'starved', doing: member.state === 'working' ? member.summary : null, id: String(branch.id), live: member.state === 'working', money: String(member.spent), status: crewMarks[member.state], title: member.title }
}

export function fromBranches(branches: readonly Branch[]): Shape {
  return {
    channels: Crew.board(branches).map((member) => {
      const children = branches.filter((branch) => branch.parent === member.id).map(branchThread).sort(order)
      return { at: 0, id: String(member.id), live: member.state === 'working' || children.some((child) => child.live), money: String(member.spent), status: crewMarks[member.state], threads: children, title: member.title, topic: member.summary ?? '' }
    }),
    form: 'agent',
  }
}

const shapes = new Map<string, { key: string; shape: Shape }>()

const planted = new Map<string, { from: unknown; shape: Shape }>()

const watchers = new Set<() => void>()

const nothing: readonly (readonly [string, Shape])[] = []

let every = nothing

function seed(id: string): Shape | undefined {
  const tree = seeded<TreeView>(`tree:${id}`)
  const branches = tree ? undefined : seeded<Branches>(`branches:${id}`)
  const from = tree ?? branches
  if (!from) return undefined
  if (server) return tree ? fromTree(tree.nodes) : fromBranches(branches!.branches)
  const kept = planted.get(id)
  if (kept && kept.from === from) return kept.shape
  const shape = tree ? fromTree(tree.nodes) : fromBranches(branches!.branches)
  planted.set(id, { from, shape })
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

export function shareBranches(id: string, branches: readonly Branch[]) {
  keep(id, fromBranches(branches))
}

function watch(listener: () => void) {
  watchers.add(listener)
  return () => {
    watchers.delete(listener)
  }
}

export function useShape(id: string | undefined) {
  return useSyncExternalStore(
    watch,
    () => (id ? (shapes.get(id)?.shape ?? seed(id)) : undefined),
    () => (id ? seed(id) : undefined),
  )
}

export function useShapes() {
  return useSyncExternalStore(watch, () => every, () => nothing)
}

export function holding(shape: Shape | undefined, nid: string | undefined) {
  if (!shape || !nid) return undefined
  return shape.channels.find((channel) => channel.id === nid || channel.threads.some((each) => each.id === nid))
}
