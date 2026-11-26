import { useSyncExternalStore } from 'react'
import type * as Tree from '../shared/Tree.ts'
import * as Limits from '../shared/Limits.ts'

export type State = 'fresh' | 'stale' | 'stored'

export type Row = { at: number; state: State; value: unknown; version: string | undefined }

export type Mutation = { after: number; at: number; id: string; input: unknown; kind: string; state: 'queued' | 'sending'; swarm: string }

export type Runner = { confirm: (mutation: Mutation, result: unknown) => void; landed: (mutation: Mutation) => Promise<boolean>; run: (mutation: Mutation) => Promise<unknown> }

const tables = ['swarms', 'nodes', 'messages', 'riders', 'runs', 'views'] as const

type Table = (typeof tables)[number]

const keep = Limits.WebLocal.keep


const refetched = new Set<Tree.Delta['event']>(['proven', 'ended', 'started', 'progress', 'checking', 'funded', 'moved', 'steered'])

const rows = new Map<string, Row>()
const cold = new Set<string>()
const listeners = new Map<string, Set<() => void>>()
const flights = new Map<string, Promise<unknown>>()
const versions = new Map<string, string>()
const cursors = new Map<string, number>()
const linked = new Set<string>()
const queue = new Map<string, Mutation>()
const runners = new Map<string, Runner>()
const waiting = new Map<string, { reject: (error: unknown) => void; resolve: (value: unknown) => void }>()
const dirty = { meta: new Set<string>(), outbox: new Set<string>(), rows: new Set<string>() }
let timer: ReturnType<typeof setTimeout> | undefined
let database: Promise<IDBDatabase | undefined> | undefined
let persist = false

let live = false

export function scope(key: string) {
  const [kind, id] = key.includes(':') ? [key.slice(0, key.indexOf(':')), key.split(':')[1]] : ['', key]
  return kind !== 'rider' && id && /^[0-9a-f]{12}$/.test(id) ? id : undefined
}

export function table(key: string): Table {
  const kind = key.includes(':') ? key.slice(0, key.indexOf(':')) : ''
  if (kind === '') return 'swarms'
  if (kind === 'node') return 'nodes'
  if (kind === 'room' || kind === 'replies') return 'messages'
  if (kind === 'rider') return 'riders'
  if (kind === 'updates' && key.split(':').length === Limits.WebLocal.runKeyParts) return 'runs'
  return 'views'
}

function ping(key: string) {
  for (const listener of [...(listeners.get(key) ?? [])]) listener()
}

function watched(key: string) {
  return (listeners.get(key)?.size ?? 0) > 0
}

function save(key: string) {
  if (!persist) return
  dirty.rows.add(key)
  soon()
}

function scoped(swarm: string) {
  return [...rows].filter(([key]) => scope(key) === swarm)
}

export function subscribe(key: string, listener: () => void) {
  const set = listeners.get(key) ?? new Set()
  set.add(listener)
  listeners.set(key, set)
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(key)
  }
}

export function row(key: string) {
  return rows.get(key)
}

export function value<T>(key: string) {
  return rows.get(key)?.value as T | undefined
}

export function fresh(key: string) {
  return rows.get(key)?.state === 'fresh' && !cold.has(key)
}

export function seed(entries: Record<string, unknown>, at: number) {
  for (const [key, data] of Object.entries(entries)) {
    if (key.startsWith('!') || data === undefined) continue
    rows.set(key, { at, state: 'fresh', value: data, version: undefined })
    save(key)
  }
}

export function put(key: string, data: unknown, version = versionOf(key)) {
  if (!live) return
  const swarm = scope(key)
  if (swarm && key === `tree:${swarm}` && linked.has(swarm) && !cursors.has(swarm) && typeof (data as { seq?: unknown }).seq === 'number') {
    cursors.set(swarm, (data as { seq: number }).seq)
    mark(swarm, versions.get(swarm) ?? '')
  }
  cold.delete(key)
  const before = rows.get(key)
  if (before && before.state === 'fresh' && JSON.stringify(before.value) === JSON.stringify(data)) {
    before.at = Date.now()
    before.version = version
    return save(key)
  }
  rows.set(key, { at: Date.now(), state: 'fresh', value: data, version })
  save(key)
  ping(key)
}

export function change<T>(key: string, update: (current: T | undefined) => T | undefined) {
  if (!live) return
  const before = rows.get(key)
  const next = update(before?.value as T | undefined)
  if (next === undefined || next === before?.value) return
  rows.set(key, before ? { ...before, value: next } : { at: Date.now(), state: 'fresh', value: next, version: versionOf(key) })
  save(key)
  ping(key)
}

export function patch<T>(key: string, update: (current: T) => T) {
  if (rows.has(key)) change<T>(key, (current) => (current === undefined ? undefined : update(current)))
}

export function stale(key: string) {
  const before = rows.get(key)
  if (!before || before.state === 'stale') return
  rows.set(key, { ...before, state: 'stale' })
  save(key)
  ping(key)
}

export function chill(key: string) {
  if (!rows.has(key) || cold.has(key)) return
  cold.add(key)
  save(key)
}

function covered(key: string) {
  const kind = key.includes(':') ? key.slice(0, key.indexOf(':')) : ''
  return table(key) !== 'views' || kind === 'tree' || kind === 'proofs'
}

function tracked(key: string) {
  return table(key) === 'nodes' || table(key) === 'runs'
}

function versionOf(key: string) {
  const swarm = scope(key)
  return swarm ? versions.get(swarm) : undefined
}

export function load<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const flying = flights.get(key)
  if (flying) return flying as Promise<T>
  const swarm = scope(key)
  const start = swarm ? versions.get(swarm) : undefined
  const promise = loader()
    .then((data) => {
      put(key, data, start)
      if (swarm && versions.get(swarm) !== start) cold.add(key)
      return data
    })
    .finally(() => flights.delete(key))
  flights.set(key, promise)
  return promise
}

export function warm<T>(key: string, loader: () => Promise<T>) {
  if (fresh(key) || flights.has(key)) return
  void load(key, loader).catch(() => {})
}

export function version(swarm: string) {
  return versions.get(swarm)
}

function mark(swarm: string, next: string) {
  versions.set(swarm, next)
  if (persist) {
    dirty.meta.add(swarm)
    soon()
  }
}

export function welcome(swarm: string, next: string): 'same' | 'moved' {
  const known = versions.get(swarm)
  mark(swarm, next)
  if (known !== next) {
    const caught = cursors.has(swarm)
    for (const [key] of scoped(swarm)) if (!caught || !tracked(key)) stale(key)
    return 'moved'
  }
  for (const [key, held] of scoped(swarm)) {
    if (!covered(key)) stale(key)
    else if (held.state === 'fresh') held.version = next
    else if (held.state === 'stored' && held.version === next) {
      rows.set(key, { ...held, state: 'fresh' })
      ping(key)
    } else continue
    save(key)
  }
  return 'same'
}

export function link(swarm: string, up: boolean) {
  if (up) linked.add(swarm)
  else linked.delete(swarm)
}

export function cursor(swarm: string) {
  return cursors.get(swarm)
}

export function caught(swarm: string, next: number) {
  cursors.set(swarm, next)
  mark(swarm, versions.get(swarm) ?? '')
  for (const [key, held] of scoped(swarm)) {
    if (!tracked(key) || held.state !== 'stored' || cold.has(key)) continue
    rows.set(key, { ...held, state: 'fresh', version: versions.get(swarm) })
    save(key)
    ping(key)
  }
}

export function lost(swarm: string) {
  cursors.delete(swarm)
  mark(swarm, versions.get(swarm) ?? '')
  for (const [key] of scoped(swarm)) if (tracked(key)) stale(key)
}

export function advance(swarm: string, next: string, changed: boolean) {
  const known = versions.get(swarm)
  mark(swarm, next)
  for (const [key, held] of scoped(swarm)) {
    if (held.state !== 'fresh' || held.version !== known) continue
    if (changed && !watched(key) && !tracked(key) && table(key) !== 'messages') {
      chill(key)
      continue
    }
    held.version = next
    save(key)
  }
}

type Message = { id: number; parent?: number }

type Thread = { next: number; parent: Message; replies: readonly Message[] }

function placed<T extends Message>(list: readonly T[], message: T) {
  return list.some((each) => each.id === message.id) ? list : [...list, message].sort((a, b) => a.id - b.id)
}

function threads(swarm: string) {
  return [...rows.keys()].filter((key) => key.startsWith(`replies:${swarm}:`))
}

export function said(swarm: string, message: Message) {
  if (message.parent === undefined) return patch<{ messages: readonly Message[] }>(`room:${swarm}`, (room) => ({ ...room, messages: placed(room.messages, message) }))
  patch<Thread>(`replies:${swarm}:${message.parent}`, (thread) => ({ ...thread, next: Math.max(thread.next, message.id), replies: placed(thread.replies, message) }))
}

function edited<T extends Message>(list: readonly T[], id: number, update: (message: T) => T) {
  return list.some((each) => each.id === id) ? list.map((each) => (each.id === id ? update(each) : each)) : list
}

export function touched<T extends Message>(swarm: string, id: number, update: (message: T) => T) {
  patch<{ messages: readonly T[] }>(`room:${swarm}`, (room) => {
    const messages = edited(room.messages, id, update)
    return messages === room.messages ? room : { ...room, messages }
  })
  for (const key of threads(swarm))
    patch<{ next: number; parent: T; replies: readonly T[] }>(key, (thread) => {
      const replies = edited(thread.replies, id, update)
      const parent = thread.parent.id === id ? update(thread.parent) : thread.parent
      return replies === thread.replies && parent === thread.parent ? thread : { ...thread, parent, replies }
    })
}

export function delta(swarm: string, event: Tree.Delta) {
  const node = `node:${swarm}:${event.node.id}`
  patch<{ funders: unknown; runs: unknown }>(node, (view) => ({ ...view, ...event.node, funders: view.funders, runs: view.runs }))
  if (event.event === 'doing') return
  cursors.set(swarm, Math.max(cursors.get(swarm) ?? event.seq, event.seq))
  if (persist) {
    dirty.meta.add(swarm)
    soon()
  }
  patch<{ deltas: Tree.Delta[]; next: number }>(`updates:${swarm}:${event.node.id}`, (current) => ({ deltas: [event, ...current.deltas.filter((each) => each.seq !== event.seq)], next: Math.max(current.next, event.seq) }))
  if (refetched.has(event.event)) stale(node)
  for (const key of [`tree:${swarm}`, `burn:${swarm}`, `proofs:${swarm}`, swarm]) if (!watched(key)) chill(key)
  if (event.node.parent) chill(`node:${swarm}:${event.node.parent}`)
}

export function useRow(key: string, server: () => Row | undefined) {
  return useSyncExternalStore(
    (listener) => subscribe(key, listener),
    () => rows.get(key),
    server,
  )
}

export function define(kind: string, runner: Runner) {
  runners.set(kind, runner)
}

export function pending(swarm: string, kind: string) {
  return [...queue.values()].filter((mutation) => mutation.swarm === swarm && mutation.kind === kind)
}

const none: readonly Mutation[] = Object.freeze([])
const lists = new Map<string, readonly Mutation[]>()

function listed(swarm: string, kind: string) {
  const name = `outbox:${swarm}:${kind}`
  const list = pending(swarm, kind)
  const before = lists.get(name) ?? none
  if (before.length === list.length && before.every((each, index) => each === list[index])) return before
  lists.set(name, list)
  return list
}

export function usePending(swarm: string, kind: string) {
  return useSyncExternalStore(
    (listener) => subscribe(`outbox:${swarm}`, listener),
    () => listed(swarm, kind),
    () => none,
  )
}

function shelve(mutation: Mutation) {
  if (persist) {
    dirty.outbox.add(mutation.id)
    soon()
  }
  ping(`outbox:${mutation.swarm}`)
}

export function offline(error: unknown) {
  return error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)
}

function send(mutation: Mutation, runner: Runner) {
  queue.set(mutation.id, { ...mutation, state: 'sending' })
  shelve(mutation)
  runner.run(mutation).then(
    (result) => settle(mutation, runner, result),
    (error: unknown) => {
      if (offline(error)) {
        queue.set(mutation.id, { ...mutation, state: 'queued' })
        return shelve(mutation)
      }
      queue.delete(mutation.id)
      shelve(mutation)
      waiting.get(mutation.id)?.reject(error)
      waiting.delete(mutation.id)
    },
  )
}

function settle(mutation: Mutation, runner: Runner, result: unknown) {
  runner.confirm(mutation, result)
  queue.delete(mutation.id)
  shelve(mutation)
  waiting.get(mutation.id)?.resolve(result)
  waiting.delete(mutation.id)
}

export function mutate<T>(kind: string, swarm: string, input: unknown, after = 0): Promise<T> {
  const runner = runners.get(kind)
  if (!runner) return Promise.reject(new Error(`No runner for ${kind}.`))
  const mutation: Mutation = { after, at: Date.now(), id: crypto.randomUUID(), input, kind, state: 'sending', swarm }
  const promise = new Promise<T>((resolve, reject) => waiting.set(mutation.id, { reject, resolve: resolve as (value: unknown) => void }))
  send(mutation, runner)
  return promise
}

export function drop(id: string) {
  const mutation = queue.get(id)
  if (!mutation) return
  queue.delete(id)
  shelve(mutation)
  waiting.get(id)?.reject(new Error('Dropped.'))
  waiting.delete(id)
}

let replaying = false

export async function replay() {
  if (replaying || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  replaying = true
  try {
    for (const mutation of [...queue.values()]) {
      const runner = runners.get(mutation.kind)
      if (!runner || mutation.state !== 'queued') continue
      const landed = await runner.landed(mutation).catch(() => undefined)
      if (landed === undefined) continue
      if (landed) settle(mutation, runner, undefined)
      else send(mutation, runner)
    }
  } finally {
    replaying = false
  }
}

function soon() {
  if (timer !== undefined) return
  timer = setTimeout(() => {
    timer = undefined
    void flush()
  }, Limits.Client.flushMs)
}

function done(request: IDBTransaction) {
  return new Promise<void>((resolve) => {
    request.oncomplete = () => resolve()
    request.onerror = () => resolve()
    request.onabort = () => resolve()
  })
}

async function flush() {
  const base = await open()
  if (!base) return
  const keys = [...dirty.rows]
  const metas = [...dirty.meta]
  const boxes = [...dirty.outbox]
  dirty.rows.clear()
  dirty.meta.clear()
  dirty.outbox.clear()
  const transaction = base.transaction([...tables, 'meta', 'outbox'], 'readwrite')
  for (const key of keys) {
    const held = rows.get(key)
    const store = transaction.objectStore(table(key))
    if (held) store.put({ at: held.at, settled: held.state !== 'stale' && !cold.has(key), value: held.value, version: held.version }, key)
    else store.delete(key)
  }
  for (const swarm of metas) transaction.objectStore('meta').put({ seq: cursors.get(swarm), version: versions.get(swarm) }, swarm)
  for (const id of boxes) {
    const mutation = queue.get(id)
    if (mutation) transaction.objectStore('outbox').put({ ...mutation, state: 'queued' }, id)
    else transaction.objectStore('outbox').delete(id)
  }
  await done(transaction)
}

function open() {
  database ??= new Promise((resolve) => {
    if (!persist || typeof indexedDB === 'undefined') return resolve(undefined)
    const request = indexedDB.open('swarms', 1)
    request.onupgradeneeded = () => {
      for (const name of [...tables, 'meta', 'outbox']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(undefined)
    request.onblocked = () => resolve(undefined)
  })
  return database
}

function every(store: IDBObjectStore) {
  return new Promise<[IDBValidKey[], unknown[]]>((resolve) => {
    const keys = store.getAllKeys()
    const values = store.getAll()
    values.onsuccess = () => resolve([keys.result, values.result])
    values.onerror = () => resolve([[], []])
  })
}

async function hydrate() {
  const base = await open()
  if (!base) return
  const transaction = base.transaction([...tables, 'meta', 'outbox'], 'readwrite')
  const [[swarms, marks], [, boxes], ...read] = await Promise.all([every(transaction.objectStore('meta')), every(transaction.objectStore('outbox')), ...tables.map((name) => every(transaction.objectStore(name)))])
  for (const [at, name] of tables.entries()) {
    const store = transaction.objectStore(name)
    const [keys, values] = read[at]!
    const found = keys.flatMap((key, index) => (typeof key === 'string' ? [[key, values[index] as { at: number; settled: boolean; value: unknown; version: string | undefined }] as const] : []))
    found.sort((a, b) => b[1].at - a[1].at)
    for (const [key] of found.slice(keep)) store.delete(key)
    for (const [key, held] of found.slice(0, keep)) {
      if (rows.has(key)) continue
      rows.set(key, { at: held.at, state: held.settled ? 'stored' : 'stale', value: held.value, version: held.version })
      ping(key)
    }
  }
  swarms.forEach((swarm, index) => {
    const held = marks[index] as { seq: number | undefined; version: string | undefined } | undefined
    if (typeof swarm !== 'string' || !held || versions.has(swarm)) return
    if (held.version) versions.set(swarm, held.version)
    if (held.seq !== undefined && !cursors.has(swarm)) cursors.set(swarm, held.seq)
  })
  for (const mutation of boxes as Mutation[]) if (!queue.has(mutation.id)) queue.set(mutation.id, { ...mutation, state: 'queued' })
  for (const swarm of new Set((boxes as Mutation[]).map((mutation) => mutation.swarm))) ping(`outbox:${swarm}`)
}

export function start(options: { data: Record<string, unknown>; now: number; persist: boolean }) {
  live = true
  persist = options.persist
  seed(options.data, options.now)
  const ready = hydrate().catch(() => {})
  if (typeof addEventListener !== 'undefined') addEventListener('online', () => void replay())
  return ready.then(() => replay())
}

export function reset() {
  rows.clear()
  cold.clear()
  listeners.clear()
  flights.clear()
  versions.clear()
  cursors.clear()
  queue.clear()
  waiting.clear()
}
