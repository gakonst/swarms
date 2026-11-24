import type { Chatter, Heard, Lobby, Part } from '../shared/Api.ts'
import type * as Tree from '../shared/Tree.ts'

export type Signal = Chatter | Heard | Lobby | { type: 'closed' }

export type Item = { data: unknown; event: string; id?: number | undefined }

export type Scope = { kind: 'hall' } | { kind: 'lobby' } | { kind: 'swarm'; swarm: string }

export type Query = Record<string, string | null>

export type Log = { after: (cursor: number) => Query; cursor: (body: unknown) => number; items: (body: unknown) => Item[]; path?: string }

export type Topic = { events: string[]; gap?: number; items?: (signal: Signal) => Item[]; log?: Log; name: string; scope: Scope; snapshot?: Query; stirs: (signal: Signal) => boolean }

export type Read = { body: unknown; status: number; text: string }

export type Tap = { close: () => void; ping: () => void }

export const beatMs = 25_000

export const pongMs = 10_000

export const retryMs = 3_000

const pagesMost = 10

const newest = '999999999999999'

const funding = new Set<Tree.Delta['event']>(['ended', 'funded', 'moved', 'started', 'steered'])

const proving = new Set<Tree.Delta['event']>(['checking', 'ended', 'proven'])

export function wanted(accept: string | undefined) {
  return (accept ?? '').includes('text/event-stream')
}

function changed(signal: Signal, ...parts: Part[]) {
  return signal.type === 'changed' && (!parts.length || signal.parts.some((part) => parts.includes(part)))
}

function delta(signal: Signal) {
  return signal.type === 'delta' ? signal.delta : undefined
}

function stored(signal: Signal) {
  const found = delta(signal)
  return found !== undefined && found.event !== 'doing'
}

function money(signal: Signal) {
  const found = delta(signal)
  return signal.type === 'pulse' || changed(signal, 'detail', 'members') || (found !== undefined && funding.has(found.event))
}

function anything(signal: Signal) {
  return signal.type === 'pulse' || signal.type === 'artifacts' || signal.type === 'roster' || changed(signal) || stored(signal)
}

function numbers(values: unknown[]) {
  return values.filter((value): value is number => typeof value === 'number')
}

function field<T>(body: unknown, key: string): T | undefined {
  return typeof body === 'object' && body !== null ? ((body as Record<string, unknown>)[key] as T | undefined) : undefined
}

function after(cursor: number): Query {
  return { after: String(cursor), before: null }
}

function deltas(nid?: string): Log {
  return {
    after: (cursor) => ({ ...after(cursor), limit: '500' }),
    cursor: (body) => Math.max(0, ...numbers([field(body, 'seq'), field(body, 'next')])),
    items: (body) => (field<Tree.Delta[]>(body, 'deltas') ?? []).filter((each) => nid === undefined || each.node.id === nid).map((each) => ({ data: each, event: 'delta', id: each.seq })),
  }
}

function treeItems(nid?: string) {
  return (signal: Signal): Item[] => {
    const found = delta(signal)
    if (!found || (nid !== undefined && found.node.id !== nid)) return []
    return [{ data: found, event: 'delta', id: found.event === 'doing' ? undefined : found.seq }]
  }
}

function swarmTopic(swarm: string, rest: string[], search: URLSearchParams): Topic | undefined {
  const scope: Scope = { kind: 'swarm', swarm }
  const [head, nid, tail, more] = rest
  if (head === undefined) return { events: ['snapshot'], name: 'swarm', scope, stirs: anything }
  if (head === 'live' || head === 'wait' || rest.includes('export') || rest.includes('live')) return undefined
  if (head === 'chat' && nid === undefined)
    return {
      events: ['snapshot', 'said'],
      items: (signal) => (signal.type === 'said' ? [{ data: { message: signal.message }, event: 'said', id: signal.message.id }] : []),
      log: {
        after,
        cursor: (body) => Math.max(0, ...numbers([field(body, 'next'), ...(field<{ id: number }[]>(body, 'messages') ?? []).map((message) => message.id)])),
        items: (body) => (field<{ id: number }[]>(body, 'messages') ?? []).map((message) => ({ data: { message }, event: 'said', id: message.id })),
      },
      name: 'chat',
      scope,
      stirs: (signal) => changed(signal, 'members'),
    }
  if (head === 'feed' && nid === undefined)
    return {
      events: ['snapshot', 'entry'],
      items: (signal) => (signal.type === 'entry' ? [{ data: signal.entry, event: 'entry', id: signal.entry.seq }] : []),
      log: {
        after,
        cursor: (body) => Math.max(0, ...numbers([field(body, 'next'), ...(field<{ seq: number }[]>(body, 'entries') ?? []).map((entry) => entry.seq)])),
        items: (body) => (field<{ seq: number }[]>(body, 'entries') ?? []).map((entry) => ({ data: entry, event: 'entry', id: entry.seq })),
      },
      name: 'feed',
      scope,
      ...(search.has('after') || search.has('before') ? {} : { snapshot: { before: newest } }),
      stirs: () => false,
    }
  if (head === 'tree' && nid === undefined) return { events: ['snapshot', 'delta'], items: treeItems(), log: { ...deltas(), path: '/v1/swarms/' + encodeURIComponent(swarm) + '/deltas' }, name: 'tree', scope, stirs: (signal) => signal.type === 'pulse' }
  if (head === 'deltas' && nid === undefined) return { events: ['snapshot', 'delta'], items: treeItems(), log: deltas(), name: 'deltas', scope, stirs: () => false }
  if (head === 'nodes' && nid !== undefined && tail === 'updates' && more === undefined) return { events: ['snapshot', 'delta'], items: (signal) => treeItems(nid)(signal).filter((item) => item.id !== undefined), log: deltas(nid), name: 'node updates', scope, stirs: () => false }
  if (head === 'nodes' && nid !== undefined && tail === undefined) {
    return {
      events: ['snapshot'],
      name: 'node',
      scope,
      stirs: (signal) => {
        const found = delta(signal)
        return found !== undefined && (found.node.id === nid || found.node.parent === nid)
      },
    }
  }
  const document = (name: string, stirs: (signal: Signal) => boolean, gap?: number): Topic => ({ events: ['snapshot'], ...(gap === undefined ? {} : { gap }), name, scope, stirs })
  if (head === 'proofs') return document('proofs', (signal) => proving.has(delta(signal)?.event ?? 'doing'))
  if (head === 'progress') return document('progress', (signal) => signal.type === 'pulse' || changed(signal, 'detail') || stored(signal))
  if (head === 'ledger' || head === 'backers') return document(head, money)
  if (head === 'artifacts') return document('artifacts', (signal) => signal.type === 'artifacts' || changed(signal, 'artifacts', 'detail'))
  if (head === 'team') return document('team', (signal) => signal.type === 'roster' || changed(signal, 'members'))
  if (head === 'branches') return document('branches', (signal) => signal.type === 'pulse' || changed(signal, 'branches'))
  if (head === 'hands') return document('hands', (signal) => changed(signal, 'hands'))
  if (head === 'code') return document('code', (signal) => changed(signal, 'code'))
  if (head === 'machines') return document('machines', (signal) => signal.type === 'pulse' || signal.type === 'entry' || changed(signal, 'hands'), 5_000)
  return document(head, anything)
}

export function topic(path: string, search: URLSearchParams = new URLSearchParams()): Topic | undefined {
  const parts = path.split('/').filter(Boolean)
  if (parts[0] !== 'v1') return undefined
  const [, first, second, ...rest] = parts
  const decoded = second === undefined ? undefined : decodeURIComponent(second)
  if (first === 'swarms' && decoded === undefined) return { events: ['snapshot', 'swarm'], items: (signal) => (signal.type === 'swarm' ? [{ data: signal.swarm, event: 'swarm' }] : []), name: 'swarms', scope: { kind: 'lobby' }, stirs: () => false }
  if (first === 'swarms' && decoded === 'live') return undefined
  if (first === 'swarms' && decoded !== undefined) return swarmTopic(decoded, rest, search)
  if (first === 'me' && second === 'swarms' && rest.length === 1) return { events: ['snapshot'], name: 'standing', scope: { kind: 'swarm', swarm: decodeURIComponent(rest[0] ?? '') }, stirs: money }
  if (first === 'general' && second === 'chat' && !rest.length)
    return {
      events: ['snapshot', 'said'],
      items: (signal) => (signal.type === 'said' && 'name' in signal ? [{ data: { message: signal.message, name: signal.name }, event: 'said', id: signal.message.id }] : []),
      log: {
        after,
        cursor: (body) => Math.max(0, ...numbers([field(body, 'next')])),
        items: (body) => (field<{ author: string; id: number }[]>(body, 'messages') ?? []).map((message) => ({ data: { message, name: field<Record<string, string>>(body, 'names')?.[message.author] ?? null }, event: 'said', id: message.id })),
      },
      name: '#general',
      scope: { kind: 'hall' },
      stirs: () => false,
    }
  if (first === undefined || first === 'hooks' || first === 'auth' || first === 'feedback' || (first === 'general' && second === 'chat')) return undefined
  return { events: ['snapshot'], gap: 5_000, name: first, scope: { kind: 'lobby' }, stirs: (signal) => signal.type === 'swarm' }
}

export const about =
  'Every GET under /v1 that reads something also streams it: send Accept: text/event-stream (an EventSource does). The stream sends the body the GET answers as event: snapshot, then what changes as it happens, a comment every 25 s, and retry: 3000. Logs (the room, #general, the feed, the tree and node deltas) send each new item as its own event with its seq as the id; everything else sends a new snapshot, under the hash of its body as the id, whenever its body changes. Reconnect with Last-Event-ID (an EventSource does it for you) or ?since=<id> to get only what you missed: the items after that seq, or nothing until the body differs from that hash.'

export function explain(topic: Topic) {
  const items = topic.events.filter((event) => event !== 'snapshot')
  if (topic.log) return 'Streams with Accept: text/event-stream: event: snapshot with this body and the newest seq as its id, then event: ' + items.join(', ') + ' for each new one with its seq as the id, and a new snapshot if the body changes otherwise. Last-Event-ID or ?since=<seq> sends only what came after it.'
  if (items.length) return 'Streams with Accept: text/event-stream: event: snapshot with this body and its hash as the id, then event: ' + items.join(', ') + ' with one changed summary to put in its place. Last-Event-ID or ?since=<hash> skips the snapshot while the list is unchanged.'
  return 'Streams with Accept: text/event-stream: event: snapshot with this body and its hash as the id, and again each time the body changes. Last-Event-ID or ?since=<hash> skips the snapshot while the body is unchanged.'
}

export function frame(event: string, data: string, id?: number | string) {
  return 'event: ' + event + '\n' + (id === undefined ? '' : 'id: ' + id + '\n') + 'data: ' + data + '\n\n'
}

export async function digest(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)))
  return Array.from(bytes.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

type Begun = { cursor: number; frames: string[]; text: string | undefined }

async function backlog(topic: Topic & { log: Log }, read: (query: Query, path?: string) => Promise<Read>, from: number): Promise<Begun | undefined> {
  let cursor = from
  const frames: string[] = []
  for (let page = 0; page < pagesMost; page += 1) {
    const found = await read(topic.log.after(cursor), topic.log.path).catch(() => undefined)
    if (found?.status !== 200) return undefined
    const items = topic.log.items(found.body).filter((item) => item.id === undefined || item.id > cursor)
    if (!items.length) return { cursor, frames, text: undefined }
    for (const item of items) {
      frames.push(frame(item.event, JSON.stringify(item.data), item.id))
      if (item.id !== undefined) cursor = Math.max(cursor, item.id)
    }
  }
  return undefined
}

async function begin(topic: Topic, read: (query: Query, path?: string) => Promise<Read>, last: string | null): Promise<Begun | Read> {
  if (topic.log && last !== null && /^\d{1,15}$/.test(last)) {
    const resumed = await backlog({ ...topic, log: topic.log }, read, Number(last))
    if (resumed) return resumed
  }
  const found = await read(topic.snapshot ?? {})
  if (found.status !== 200) return found
  const text = JSON.stringify(found.body)
  if (topic.log) {
    const cursor = topic.log.cursor(found.body)
    return { cursor, frames: [frame('snapshot', text, cursor)], text }
  }
  const id = await digest(text)
  return { cursor: 0, frames: last === id ? [] : [frame('snapshot', text, id)], text }
}

export async function open(input: { last: string | null; listen: (on: (signal: Signal) => void) => Promise<Tap | Response>; read: (query: Query, path?: string) => Promise<Read>; signal: AbortSignal; topic: Topic }): Promise<Response> {
  const { topic } = input
  const queue: Signal[] = []
  let take: (signal: Signal) => void = (signal) => void queue.push(signal)
  const tapped = await input.listen((signal) => take(signal))
  if (tapped instanceof Response) return tapped
  const begun = await begin(topic, input.read, input.last).catch((error: unknown) => ({ body: null, status: 502, text: JSON.stringify({ code: 'upstream_failed', detail: String(error), status: 502 }) }))
  if ('status' in begun) {
    tapped.close()
    return new Response(begun.text, { headers: { 'content-type': 'application/problem+json' }, status: begun.status })
  }
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  let done = false
  let cursor = begun.cursor
  let sent = begun.text
  let reading = false
  let dirty = false
  let readAt = 0
  let later: ReturnType<typeof setTimeout> | undefined
  const finish = () => {
    if (done) return
    done = true
    clearInterval(beat)
    clearTimeout(later)
    tapped.close()
    writer.close().catch(() => undefined)
  }
  const write = (text: string) => {
    if (!done) writer.write(encoder.encode(text)).catch(finish)
  }
  const refresh = async (): Promise<void> => {
    if (done) return
    if (reading) {
      dirty = true
      return
    }
    const wait = readAt + (topic.gap ?? 0) - Date.now()
    if (wait > 0) {
      later ??= setTimeout(() => {
        later = undefined
        void refresh()
      }, wait)
      return
    }
    reading = true
    dirty = false
    readAt = Date.now()
    const found = await input.read(topic.snapshot ?? {}).catch(() => undefined)
    reading = false
    if (found?.status === 200) {
      const text = JSON.stringify(found.body)
      if (text !== sent) {
        sent = text
        if (topic.log) cursor = Math.max(cursor, topic.log.cursor(found.body))
        write(frame('snapshot', text, topic.log ? cursor : await digest(text)))
      }
    }
    if (dirty) return refresh()
  }
  const heard = (signal: Signal) => {
    if (done) return
    if (signal.type === 'closed') return finish()
    for (const item of topic.items?.(signal) ?? []) {
      if (item.id !== undefined) {
        if (item.id <= cursor) continue
        cursor = item.id
      }
      write(frame(item.event, JSON.stringify(item.data), item.id))
    }
    if (topic.stirs(signal)) void refresh()
  }
  const beat = setInterval(() => {
    write(': keepalive\n\n')
    tapped.ping()
  }, beatMs)
  write('retry: ' + retryMs + '\n\n')
  for (const text of begun.frames) write(text)
  take = heard
  for (const signal of queue.splice(0)) heard(signal)
  input.signal.addEventListener('abort', finish, { once: true })
  if (input.signal.aborted) finish()
  return new Response(readable, { headers: { 'cache-control': 'no-store', 'content-type': 'text/event-stream', 'x-accel-buffering': 'no' } })
}

export function tap(response: Response, on: (signal: Signal) => void): Tap | Response {
  const socket = response.webSocket
  if (response.status !== 101 || !socket) return response.status === 101 ? new Response('The stream could not open.', { status: 503 }) : response
  socket.accept()
  let quiet: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const lost = () => {
    clearTimeout(quiet)
    if (closed) return
    closed = true
    on({ type: 'closed' })
  }
  socket.addEventListener('message', (event) => {
    clearTimeout(quiet)
    if (typeof event.data !== 'string' || event.data === 'pong') return
    try {
      on(JSON.parse(event.data) as Signal)
    } catch {}
  })
  socket.addEventListener('close', lost)
  socket.addEventListener('error', lost)
  return {
    close: () => {
      clearTimeout(quiet)
      closed = true
      try {
        socket.close(1000, 'Done')
      } catch {}
    },
    ping: () => {
      try {
        socket.send('ping')
        clearTimeout(quiet)
        quiet = setTimeout(lost, pongMs)
      } catch {
        lost()
      }
    },
  }
}
