import type { Address } from 'viem'
import type { Chatter, Reaction, Replies, Said, Shown, Steer } from '../shared/Api.ts'
import { redact } from '../shared/Trail.ts'
import type { Swarm } from './Swarm.ts'
import * as Limits from '../shared/Limits.ts'

export const schema = ['CREATE TABLE IF NOT EXISTS chat_reactions (message INTEGER NOT NULL, emoji TEXT NOT NULL, author TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (message, emoji, author)) WITHOUT ROWID']

export const columns = [
  ['chat', 'parent', 'ALTER TABLE chat ADD COLUMN parent INTEGER'],
  ['chat', 'node', 'ALTER TABLE chat ADD COLUMN node TEXT'],
] as const

export const indexes = ['CREATE INDEX IF NOT EXISTS chat_top ON chat (id) WHERE parent IS NULL', 'CREATE INDEX IF NOT EXISTS chat_thread ON chat (parent, id) WHERE parent IS NOT NULL', 'CREATE INDEX IF NOT EXISTS chat_node ON chat (node) WHERE node IS NOT NULL']

const selected = 'SELECT id, at, author, text, mentions, steer, artifact, parent, node FROM chat'

export type Place = { node?: string; parent?: number }

function said(row: Record<string, SqlStorageValue>): Said {
  const message: Said = {
    artifact: row['artifact'] === null || row['artifact'] === undefined ? null : (JSON.parse(String(row['artifact'])) as Shown),
    at: Number(row['at']),
    author: row['author'] === null ? null : (String(row['author']) as Address),
    id: Number(row['id']),
    mentions: JSON.parse(String(row['mentions'] ?? '[]')) as Address[],
    steer: row['steer'] === null ? null : (JSON.parse(String(row['steer'])) as Steer),
    text: String(row['text']),
  }
  if (row['node'] !== null && row['node'] !== undefined) message.node = String(row['node'])
  if (row['parent'] !== null && row['parent'] !== undefined) message.parent = Number(row['parent'])
  return message
}

export function attached(socket: WebSocket) {
  const attachment = socket.deserializeAttachment() as { address: Address | null } | null
  return attachment?.address ?? undefined
}

export type Attached = { address?: Address | null; hello?: number; typing?: number }

export const helloMs = Limits.Chat.helloMs

export const holderMs = Limits.Chat.holderMs

export const typingMs = Limits.Chat.typingMs

export const socketsMost = Limits.Chat.socketsMost

export const streamsMost = Limits.Chat.streamsMost

export const postsPerMinute = Limits.Chat.postsPerMinute

export const repliersShown = Limits.Chat.repliersShown

export const threadedEvents: ReadonlySet<string> = new Set(['funded', 'started', 'progress', 'checking', 'proven', 'ended', 'steered', 'moved'])

export function speak(self: Swarm, author: Address | null, text: string, mentions: Address[], steer: Steer | null, artifact: Shown | null = null, place: Place = {}): Said {
  const at = Date.now()
  const row = self.ctx.storage.sql
    .exec<{ id: number }>(
      'INSERT INTO chat (at, author, text, mentions, steer, artifact, parent, node) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      at,
      author,
      text,
      JSON.stringify(mentions),
      steer ? JSON.stringify(steer) : null,
      artifact ? JSON.stringify(artifact) : null,
      place.parent ?? null,
      place.node ?? null,
    )
    .one()
  const message: Said = { artifact, at, author, id: Number(row.id), mentions, steer, text, ...(place.node !== undefined ? { node: place.node } : {}), ...(place.parent !== undefined ? { parent: place.parent } : {}) }
  self.touch()
  broadcast(self, { message, type: 'said' })
  if (place.parent !== undefined) {
    const replies = threads(self, place.parent, place.parent).get(place.parent)
    if (replies) broadcast(self, { id: place.parent, replies, type: 'replies' })
  }
  return message
}

export function announce(self: Swarm, text: string, artifact: Shown | null = null) {
  speak(self, null, redact(text), [], null, artifact)
}

export function root(self: Swarm, id: number): number | null {
  const row = self.ctx.storage.sql.exec<{ id: number; parent: number | null }>('SELECT id, parent FROM chat WHERE id = ?', id).toArray()[0]
  return row ? Number(row.parent ?? row.id) : null
}

export function follow(self: Swarm, node: string, text: string) {
  const row = self.ctx.storage.sql.exec<{ id: number }>('SELECT id FROM chat WHERE node = ? AND parent IS NULL ORDER BY id LIMIT 1', node).toArray()[0]
  if (row) speak(self, null, redact(text), [], null, null, { parent: Number(row.id) })
}

export function reactions(self: Swarm, low: number, high: number) {
  const out = new Map<number, Reaction[]>()
  const rows = self.ctx.storage.sql.exec<{ author: string; emoji: string; message: number }>('SELECT message, emoji, author FROM chat_reactions WHERE message BETWEEN ? AND ? ORDER BY message, at, emoji', low, high)
  for (const row of rows) {
    const id = Number(row.message)
    const list = out.get(id) ?? []
    if (!out.has(id)) out.set(id, list)
    const found = list.find((reaction) => reaction.emoji === row.emoji)
    if (found) found.who.push(row.author as Address)
    else list.push({ emoji: row.emoji, who: [row.author as Address] })
  }
  return out
}

export function threads(self: Swarm, low: number, high: number) {
  const out = new Map<number, Replies>()
  const rows = self.ctx.storage.sql.exec<{ at: number; author: string | null; last: number; n: number; parent: number }>(
    'SELECT parent, author, COUNT(*) AS n, MAX(id) AS last, MAX(at) AS at FROM chat WHERE parent BETWEEN ? AND ? GROUP BY parent, author ORDER BY last DESC',
    low,
    high,
  )
  for (const row of rows) {
    const id = Number(row.parent)
    const known = out.get(id)
    const who = row.author === null ? null : (row.author as Address)
    if (!known) out.set(id, { at: Number(row.at), count: Number(row.n), who: [who] })
    else {
      known.count += Number(row.n)
      known.at = Math.max(known.at, Number(row.at))
      if (known.who.length < repliersShown) known.who.push(who)
    }
  }
  return out
}

function decorated(self: Swarm, list: Said[]): Said[] {
  const first = list[0]
  const last = list.at(-1)
  if (!first || !last) return list
  const low = Math.min(first.id, last.id)
  const high = Math.max(first.id, last.id)
  const reacted = reactions(self, low, high)
  const replied = threads(self, low, high)
  return list.map((message) => {
    const shown = reacted.get(message.id)
    const thread = replied.get(message.id)
    return shown || thread ? { ...message, ...(shown ? { reactions: shown } : {}), ...(thread ? { replies: thread } : {}) } : message
  })
}

export function react(self: Swarm, input: { author: Address; emoji: string; message: number; on: boolean }): Reaction[] | null {
  const sql = self.ctx.storage.sql
  if (!sql.exec('SELECT id FROM chat WHERE id = ?', input.message).toArray().length) return null
  const author = input.author.toLowerCase()
  if (input.on) sql.exec('INSERT OR IGNORE INTO chat_reactions (message, emoji, author, at) VALUES (?, ?, ?, ?)', input.message, input.emoji, author, Date.now())
  else sql.exec('DELETE FROM chat_reactions WHERE message = ? AND emoji = ? AND author = ?', input.message, input.emoji, author)
  const list = reactions(self, input.message, input.message).get(input.message) ?? []
  self.touch()
  broadcast(self, { id: input.message, reactions: list, type: 'reacted' })
  return list
}

export function thread(self: Swarm, id: number, query: { after: number; limit: number }): { next: number; parent: Said; replies: Said[] } | null {
  const top = root(self, id)
  if (top === null) return null
  const sql = self.ctx.storage.sql
  const head = sql.exec<Record<string, SqlStorageValue>>(`${selected} WHERE id = ?`, top).toArray()[0]
  if (!head) return null
  const replies = sql.exec<Record<string, SqlStorageValue>>(`${selected} WHERE parent = ? AND id > ? ORDER BY id LIMIT ?`, top, query.after, query.limit).toArray().map(said)
  const [parent] = decorated(self, [said(head)])
  return { next: replies.at(-1)?.id ?? query.after, parent: parent!, replies: decorated(self, replies) }
}

export function presence(self: Swarm, gone?: WebSocket) {
  const sockets = self.ctx.getWebSockets().filter((socket) => socket !== gone && !self.ctx.getTags(socket).includes('listen'))
  const online = [...new Set(sockets.flatMap((socket) => attached(socket) ?? []))]
  broadcast(self, { online, type: 'presence', watching: sockets.length }, gone)
}

export function broadcast(self: Swarm, event: Chatter, except?: WebSocket) {
  const data = JSON.stringify(event)
  for (const socket of self.ctx.getWebSockets())
    if (socket !== except)
      try {
        socket.send(data)
      } catch {}
}

export function messages(self: Swarm, query: { after: number; before?: number | undefined; limit: number }): Said[] {
  const sql = self.ctx.storage.sql
  const top = `${selected} WHERE parent IS NULL`
  const rows =
    query.before !== undefined
      ? sql.exec<Record<string, SqlStorageValue>>(`${top} AND id < ? ORDER BY id DESC LIMIT ?`, query.before, query.limit).toArray().reverse()
      : query.after > 0
        ? sql.exec<Record<string, SqlStorageValue>>(`${top} AND id > ? ORDER BY id LIMIT ?`, query.after, query.limit).toArray()
        : sql.exec<Record<string, SqlStorageValue>>(`${top} ORDER BY id DESC LIMIT ?`, query.limit).toArray().reverse()
  return decorated(self, rows.map(said))
}
