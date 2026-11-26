import { useSyncExternalStore } from 'react'
import type { Reaction, Said, Steer } from '../shared/Api.ts'
import { redact } from '../shared/Trail.ts'
import { offline } from './local.ts'

export type State = 'sending' | 'queued' | 'failed' | 'sent'

export type Draft = { after: number; at: number; author: string; client: string; error?: string; message?: Said; parent?: number; place: string; state: State; steer?: Steer; text: string }

export type Shown = Said & { client?: string; error?: string; sending?: Exclude<State, 'sent'> }

export type Sender = (draft: Draft) => Promise<Said>

const drafts = new Map<string, Draft>()
const listeners = new Map<string, Set<() => void>>()
const lists = new Map<string, readonly Draft[]>()
const senders = new Map<string, Sender>()
const keys = new Map<string, string>()
const none: readonly Draft[] = Object.freeze([])

function ping(place: string) {
  for (const listener of [...(listeners.get(place) ?? [])]) listener()
}

function set(draft: Draft) {
  drafts.set(draft.client, draft)
  ping(draft.place)
}

export function same(draft: Draft, message: Said) {
  if (draft.message) return draft.message.id === message.id
  if (!message.author || message.author.toLowerCase() !== draft.author.toLowerCase()) return false
  if ((message.parent ?? undefined) !== draft.parent || message.id <= draft.after) return false
  const text = draft.text.trim()
  return message.text === text || message.text === redact(text)
}

export function shown(place: string, messages: readonly Said[], list: readonly Draft[]): { landed: string[]; shown: Shown[] } {
  const claimed = new Set<number>()
  const landed: string[] = []
  const extra: Shown[] = []
  list.forEach((draft, index) => {
    const found = messages.find((message) => !claimed.has(message.id) && same(draft, message))
    if (found) {
      claimed.add(found.id)
      keys.set(`${place}:${found.id}`, draft.client)
      landed.push(draft.client)
      return
    }
    if (draft.message) {
      keys.set(`${place}:${draft.message.id}`, draft.client)
      extra.push({ ...draft.message, client: draft.client })
      return
    }
    const sending = draft.state === 'sent' ? 'sending' : draft.state
    extra.push({ artifact: null, at: draft.at, author: draft.author as `0x${string}`, client: draft.client, id: Number.MAX_SAFE_INTEGER - list.length + index, mentions: [], sending, steer: draft.steer ?? null, text: draft.text.trim(), ...(draft.error ? { error: draft.error } : {}), ...(draft.parent !== undefined ? { parent: draft.parent } : {}) })
  })
  const kept: Shown[] = messages.map((message) => {
    const client = keys.get(`${place}:${message.id}`)
    return client ? { ...message, client } : message
  })
  const real = extra.filter((each) => !each.sending).sort((a, b) => a.id - b.id)
  const waiting = extra.filter((each) => each.sending)
  const merged = real.length ? [...kept, ...real].sort((a, b) => a.id - b.id) : kept
  return { landed, shown: waiting.length ? [...merged, ...waiting] : merged }
}

export function key(message: Shown) {
  return message.client ? `c${message.client}` : `m${message.id}`
}

export function define(kind: string, sender: Sender) {
  senders.set(kind, sender)
}

function kind(place: string) {
  return place.split(':')[0] ?? ''
}

function run(draft: Draft) {
  const sender = senders.get(kind(draft.place))
  if (!sender) return set({ ...draft, error: 'Not sent.', state: 'failed' })
  const { error: _error, ...clean } = draft
  set({ ...clean, state: 'sending' })
  sender(draft).then(
    (message) => {
      if (drafts.has(draft.client)) set({ ...clean, message, state: 'sent' })
    },
    (error: unknown) => {
      if (!drafts.has(draft.client)) return
      if (offline(error)) set({ ...clean, state: 'queued' })
      else set({ ...clean, error: error instanceof Error ? error.message : 'Not sent.', state: 'failed' })
    },
  )
}

export function send(place: string, input: { after: number; author: string; parent?: number | undefined; steer?: Steer | undefined; text: string }) {
  const draft: Draft = { after: input.after, at: Date.now(), author: input.author, client: crypto.randomUUID(), place, state: 'sending', text: input.text, ...(input.parent !== undefined ? { parent: input.parent } : {}), ...(input.steer ? { steer: input.steer } : {}) }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) set({ ...draft, state: 'queued' })
  else run(draft)
  return draft.client
}

export function retry(client: string) {
  const draft = drafts.get(client)
  if (draft && (draft.state === 'failed' || draft.state === 'queued')) run(draft)
}

export function resume() {
  for (const draft of [...drafts.values()]) if (draft.state === 'queued') run(draft)
}

export function forget(client: string) {
  const draft = drafts.get(client)
  if (!draft) return
  drafts.delete(client)
  ping(draft.place)
}

export function draft(client: string) {
  return drafts.get(client)
}

export function list(place: string) {
  const list = [...drafts.values()].filter((draft) => draft.place === place)
  const before = lists.get(place) ?? none
  if (before.length === list.length && before.every((each, index) => each === list[index])) return before
  lists.set(place, list)
  return list
}

export function subscribe(place: string, listener: () => void) {
  const set = listeners.get(place) ?? new Set()
  set.add(listener)
  listeners.set(place, set)
  return () => {
    set.delete(listener)
    if (!set.size) listeners.delete(place)
  }
}

export function useDrafts(place: string) {
  return useSyncExternalStore(
    (listener) => subscribe(place, listener),
    () => list(place),
    () => none,
  )
}

export function flip(list: readonly Reaction[] | undefined, emoji: string, me: string, on: boolean): Reaction[] {
  const mine = me.toLowerCase() as `0x${string}`
  const out = (list ?? []).map((each) => ({ emoji: each.emoji, who: each.who.filter((address) => each.emoji !== emoji || address.toLowerCase() !== mine) }))
  const found = out.find((each) => each.emoji === emoji)
  if (on && found) found.who.push(mine)
  else if (on) out.push({ emoji, who: [mine] })
  return out.filter((each) => each.who.length)
}

const flights = new Map<string, { emoji: string; me: string; on: boolean; turn: number }>()

let turns = 0

export function held(swarm: string, message: number, list: readonly Reaction[] | undefined): Reaction[] {
  let out = [...(list ?? [])]
  for (const [name, flight] of flights) if (name.startsWith(`${swarm}:${message}:`)) out = flip(out, flight.emoji, flight.me, flight.on)
  return out
}

export function fly(swarm: string, message: number, emoji: string, me: string, on: boolean) {
  const name = `${swarm}:${message}:${emoji}`
  const turn = ++turns
  flights.set(name, { emoji, me, on, turn })
  return () => {
    if (flights.get(name)?.turn === turn) flights.delete(name)
  }
}

export function reset() {
  flights.clear()
  drafts.clear()
  lists.clear()
  keys.clear()
}

if (typeof addEventListener !== 'undefined') addEventListener('online', resume)
