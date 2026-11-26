import type { Snapshot, Unavailable } from '../shared/Api.ts'
import * as Limits from '../shared/Limits.ts'

export const guards = { degrade: true, snapshot: true }

export const header = 'x-swarms-unavailable'

export const status = Limits.Storage.unpaid

export const message = "The gateway can't pay for code storage right now, so the code can't be read here. It comes back once the gateway can pay again."

const said = /treasury cannot cover/i

export function unpaid(code: number, body: string) {
  if (code !== status) return false
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail
    return typeof detail === 'string' && said.test(detail)
  } catch {
    return false
  }
}

export class Unpaid extends Error {}

export function unavailable(): Unavailable {
  return { message, reason: 'treasury', state: 'unavailable' }
}

export function kept(read: string, query: URLSearchParams, snapshot: Snapshot | null): unknown {
  if (!guards.snapshot || !snapshot) return undefined
  const ref = query.get('ref') ?? 'main'
  const head = snapshot.commits[0]?.sha
  const limit = Number(query.get('limit'))
  if (read === 'log' && ref === 'main') return { commits: Number.isInteger(limit) && limit > 0 ? snapshot.commits.slice(0, limit) : snapshot.commits }
  if (read === 'files' && ref === 'main') return { files: snapshot.files.map((path) => ({ path, type: 'blob' })) }
  if (read === 'read' && head && (ref === 'main' || ref === head) && snapshot.readme && query.get('path') === snapshot.readme.path)
    return { size: snapshot.readme.text.length, text: snapshot.readme.text }
  if (read === 'diff' && head && ref === head && !query.get('base') && snapshot.diff) return { files: snapshot.diff }
  return undefined
}

export function degraded(
  read: string,
  query: URLSearchParams,
  snapshot: Snapshot | null,
  status: number,
  body: string,
): { body: unknown; snapshot: boolean } | undefined {
  if (!guards.degrade || !unpaid(status, body)) return undefined
  const known = kept(read, query, snapshot)
  return known === undefined ? { body: unavailable(), snapshot: false } : { body: known, snapshot: true }
}
