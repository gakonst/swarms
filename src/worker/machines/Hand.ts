export type Refused = { ok: false; why: 'illegal' | 'replayed' | 'stale' }

export type Stepped<S> = Refused | { ok: true; state: S }

export const version = 1

export type HandState = 'issued' | 'minted' | 'returned' | 'revoking'

export type Hand = { at: number; by?: 'evicted' | 'failed' | 'owner'; life: string; state: HandState; v: typeof version }

export type HandEvent =
  | { at: number; kind: 'issue'; life: string }
  | { at: number; kind: 'kept' }
  | { at: number; kind: 'mint' }
  | { at: number; kind: 'return' }
  | { at: number; by: 'evicted' | 'failed' | 'owner'; kind: 'revoke'; life: string }

export function hand(at: Hand | undefined, event: HandEvent): Stepped<Hand> {
  if (event.kind === 'issue') return at ? { ok: false, why: 'replayed' } : { ok: true, state: { at: event.at, life: event.life, state: 'issued', v: version } }
  if (!at) return { ok: false, why: 'illegal' }
  if (at.state === 'returned') return { ok: false, why: event.kind === 'return' || event.kind === 'revoke' ? 'replayed' : 'stale' }
  if (event.kind === 'mint') return at.state === 'issued' ? { ok: true, state: { ...at, at: event.at, state: 'minted' } } : { ok: false, why: at.state === 'minted' ? 'replayed' : 'stale' }
  if (event.kind === 'revoke') return { ok: true, state: { ...at, at: event.at, by: event.by, life: event.life, state: 'revoking' } }
  if (event.kind === 'kept') return at.state === 'revoking' ? { ok: true, state: { ...at, at: event.at, state: 'minted' } } : { ok: false, why: 'stale' }
  return at.state === 'revoking' || at.state === 'issued' ? { ok: true, state: { ...at, at: event.at, state: 'returned' } } : { ok: false, why: 'illegal' }
}

export function read(raw: unknown): Hand | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const kept = raw as Partial<Hand>
  return kept.v === version && typeof kept.state === 'string' ? (kept as Hand) : undefined
}

export function legacy(life: string, at: number): Hand {
  return { at, life, state: 'minted', v: version }
}

export function unfinished(at: Hand | undefined, busy: boolean) {
  return !!at && (at.state === 'issued' || at.state === 'revoking') && !busy
}

export const machine = { read, step: hand, unfinished }

export function key(name: string) {
  return 'lent:' + name
}
