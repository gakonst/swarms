// An event stream's cursor: the highest event seq whose effects landed.
//
// Events are folded in seq order and each at most once: an event at or below
// the cursor was folded already (a page read again, a stream that reconnects
// from an older cursor, a restart before the cursor was saved), so it is
// skipped. The caller saves the new cursor in the same synchronous step as the
// effects of the events it folded, before its next await.

export type Seqd = { seq: number }

// Guards the tests turn off to check that the simulation catches each broken
// invariant. Never changed outside tests.
export const guards = { seq: true }

export function fresh<T extends Seqd>(events: readonly T[], cursor: number): { cursor: number; events: T[] } {
  const kept: T[] = []
  let at = cursor
  for (const event of events) {
    if (guards.seq && event.seq <= at) continue
    kept.push(event)
    at = Math.max(at, event.seq)
  }
  return { cursor: at, events: kept }
}

