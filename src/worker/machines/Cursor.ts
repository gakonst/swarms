import * as Assert from '../../shared/Assert.ts'


export type Seqd = { seq: number }

export const guards = { seq: true }

export function fresh<T extends Seqd>(events: readonly T[], cursor: number): { cursor: number; events: T[] } {
  const kept: T[] = []
  let at = cursor
  for (const event of events) {
    if (guards.seq && event.seq <= at) continue
    kept.push(event)
    at = Math.max(at, event.seq)
  }
  Assert.assert(at >= cursor, 'A cursor never goes back.', { at, cursor })
  return { cursor: at, events: kept }
}

