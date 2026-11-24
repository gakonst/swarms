export type Showing = 'away' | 'queued' | 'loading' | 'shown'

export function seen(now: Showing, visible: boolean): Showing {
  if (!visible) return 'away'
  return now === 'away' ? 'queued' : now
}

export function granted(now: Showing): Showing {
  return now === 'queued' ? 'loading' : now
}

export function loaded(now: Showing): Showing {
  return now === 'loading' ? 'shown' : now
}

export function holds(now: Showing) {
  return now === 'loading'
}

export function framed(now: Showing) {
  return now === 'loading' || now === 'shown'
}
