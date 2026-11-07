import type { Address } from 'viem'
import type { Chatter, Said, Shown, Steer } from '../shared/Api.ts'
import { redact } from '../shared/Trail.ts'
import type { Swarm } from './Swarm.ts'

function said(row: Record<string, SqlStorageValue>): Said {
  return {
    artifact: row['artifact'] === null || row['artifact'] === undefined ? null : (JSON.parse(String(row['artifact'])) as Shown),
    at: Number(row['at']),
    author: row['author'] === null ? null : (String(row['author']) as Address),
    id: Number(row['id']),
    mentions: JSON.parse(String(row['mentions'] ?? '[]')) as Address[],
    steer: row['steer'] === null ? null : (JSON.parse(String(row['steer'])) as Steer),
    text: String(row['text']),
  }
}

export function attached(socket: WebSocket) {
  const attachment = socket.deserializeAttachment() as { address: Address | null } | null
  return attachment?.address ?? undefined
}

export type Attached = { address?: Address | null; hello?: number; typing?: number }

export const helloMs = 10_000

export const holderMs = 300_000

export const typingMs = 2_000

export const socketsMost = 500

export const postsPerMinute = 10

export function speak(self: Swarm, author: Address | null, text: string, mentions: Address[], steer: Steer | null, artifact: Shown | null = null): Said {
  const at = Date.now()
  const row = self.ctx.storage.sql
    .exec<{ id: number }>(
      'INSERT INTO chat (at, author, text, mentions, steer, artifact) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      at,
      author,
      text,
      JSON.stringify(mentions),
      steer ? JSON.stringify(steer) : null,
      artifact ? JSON.stringify(artifact) : null,
    )
    .one()
  const message: Said = { artifact, at, author, id: Number(row.id), mentions, steer, text }
  self.touch()
  broadcast(self, { message, type: 'said' })
  return message
}

export function announce(self: Swarm, text: string, artifact: Shown | null = null) {
  speak(self, null, redact(text), [], null, artifact)
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
  const columns = 'SELECT id, at, author, text, mentions, steer, artifact FROM chat'
  const rows =
    query.before !== undefined
      ? sql.exec<Record<string, SqlStorageValue>>(`${columns} WHERE id < ? ORDER BY id DESC LIMIT ?`, query.before, query.limit).toArray().reverse()
      : query.after > 0
        ? sql.exec<Record<string, SqlStorageValue>>(`${columns} WHERE id > ? ORDER BY id LIMIT ?`, query.after, query.limit).toArray()
        : sql.exec<Record<string, SqlStorageValue>>(`${columns} ORDER BY id DESC LIMIT ?`, query.limit).toArray().reverse()
  return rows.map(said)
}
