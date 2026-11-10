import * as Answer from './Answer.ts'
import type { Entry, Kind } from './Api.ts'

export type Row = { at: number; count: number; detail: string | null; kind: Kind; seq: number; text: string; who: string | null }

const folded: ReadonlySet<Kind> = new Set(['error', 'status'])

function why(detail: string | null) {
  if (!detail) return null
  try {
    const error = (JSON.parse(detail) as { error?: unknown } | null)?.error
    return typeof error === 'string' && error.trim() ? error.trim() : null
  } catch {
    return null
  }
}

function said(entry: Entry) {
  if (entry.kind === 'status') return Answer.spoken(entry.text)
  if (entry.kind === 'thinking') return entry.text.replace(/\*\*|__|`/g, '')
  if (entry.kind !== 'error') return entry.text
  const reason = why(entry.detail)
  return reason ? `${entry.text.replace(/\.$/, '')}: ${reason}` : entry.text
}

export function rows(entries: readonly Entry[]) {
  const listed: Row[] = []
  let run = 0
  let kind: Kind | undefined
  for (const entry of entries) {
    const text = said(entry)
    if (text === null) continue
    if (entry.kind !== kind || !folded.has(entry.kind)) run = listed.length
    kind = entry.kind
    const same = listed.slice(run).find((row) => row.who === entry.who && row.text === text)
    if (same) {
      same.at = entry.at
      same.count += 1
      same.detail = entry.detail
      continue
    }
    listed.push({ at: entry.at, count: 1, detail: entry.detail, kind: entry.kind, seq: entry.seq, text, who: entry.who })
  }
  return listed
}

export function shown(row: Pick<Row, 'detail' | 'text'>) {
  if (!row.detail) return row.text
  try {
    const parsed = JSON.parse(row.detail) as unknown
    const fields = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    const streams = fields ? [fields['stdout'], fields['stderr']].filter((part): part is string => typeof part === 'string' && part.trim() !== '') : []
    if (streams.length) return streams.join('\n').slice(0, 20_000)
    return (typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)).slice(0, 20_000)
  } catch {
    return row.detail.slice(0, 20_000)
  }
}
