import type { Entry, Kind, Update } from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import * as Search from './Search.ts'
import type { Swarm } from './Swarm.ts'

export const pushedTurns = "WHERE n IN (SELECT n FROM turns WHERE commits != '[]' UNION ALL SELECT n FROM (SELECT n FROM turns WHERE status = 'completed' AND message IS NOT NULL ORDER BY n DESC LIMIT 3))"

export const newerTurns = "WHERE n IN (SELECT n FROM turns WHERE status = 'completed' AND message IS NOT NULL AND ended_at > ? ORDER BY n DESC LIMIT 5)"

export const lastTurns = "WHERE n IN (SELECT n FROM turns WHERE status = 'completed' AND message IS NOT NULL AND ended_at IS NOT NULL ORDER BY n DESC LIMIT ?)"

export const searched = 5_000

export const fleetWindow = 2_000

export const machined = "(kind = 'machine' OR (kind IN ('output', 'error') AND substr(text, 1, 14) = 'compute_create') OR (kind = 'tool' AND text = 'Called browser_create'))"

export const searchable = "text || ' ' || substr(coalesce(detail, ''), 1, 4000)"

const indexChunk = 1_000

export const indexMs = 1_000

export function entry(row: Record<string, SqlStorageValue>): Entry {
  return {
    at: Number(row['at']),
    detail: row['detail'] === null ? null : String(row['detail']),
    event: row['event'] === null || row['event'] === undefined ? null : Number(row['event']),
    kind: String(row['kind']) as Kind,
    seq: Number(row['seq']),
    text: String(row['text']),
    who: row['who'] === null || row['who'] === undefined ? null : String(row['who']),
  }
}

export function updates(turns: readonly Search.Turn[]): Update[] {
  return turns.flatMap((turn) => {
    if (turn.status !== 'completed' || !turn.message || turn.endedAt === null) return []
    const answer = Answer.parse(turn.message, turn.endedAt)
    return answer.text ? [{ at: turn.endedAt, base: turn.base, commits: turn.commits, done: answer.done, spent: turn.spent, text: answer.text }] : []
  })
}

export function rows(self: Swarm, where: string, ...bindings: SqlStorageValue[]): Search.Turn[] {
  return self.ctx.storage.sql
    .exec<Record<string, SqlStorageValue>>(`SELECT n, started_at, ended_at, status, message, spent, commits, base FROM turns ${where} ORDER BY n`, ...bindings)
    .toArray()
    .map((row) => ({
      base: row['base'] === null ? null : String(row['base']),
      commits: JSON.parse(String(row['commits'] ?? '[]')) as string[],
      endedAt: row['ended_at'] === null ? null : Number(row['ended_at']),
      message: row['message'] === null ? null : String(row['message']),
      n: Number(row['n']),
      spent: Memo.decimal(BigInt(String(row['spent']))),
      startedAt: Number(row['started_at']),
      status: String(row['status']),
    }))
}

export function indexed(self: Swarm) {
  const below = self.kv.get<number>('unindexed')
  if (below === undefined) return false
  const sql = self.ctx.storage.sql
  const edge = sql.exec<{ low: number | null; n: number }>('SELECT MIN(seq) AS low, COUNT(*) AS n FROM (SELECT seq FROM feed WHERE seq <= ? ORDER BY seq DESC LIMIT ?)', below, indexChunk).one()
  if (edge.low !== null) sql.exec(`INSERT INTO feed_search (rowid, body) SELECT seq, ${searchable} FROM feed WHERE seq BETWEEN ? AND ?`, edge.low, below)
  if (edge.low === null || edge.n < indexChunk) {
    self.kv.delete('unindexed')
    return false
  }
  self.kv.put('unindexed', edge.low - 1)
  return true
}

export async function reindex(self: Swarm) {
  if (self.kv.get<number>('unindexed') === undefined || self.run().state !== 'paused') return
  const alarm = await self.ctx.storage.getAlarm()
  if (alarm === null || alarm > Date.now() + indexMs) await self.ctx.storage.setAlarm(Date.now())
}
