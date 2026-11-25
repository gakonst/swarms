// A lease on one board task, held by one holder: the nanocode lease.
//
//   Unowned -> Claiming -> Owned { claim, epoch, until } -> Draining -> Released
//                                  \-> Lost  (a renew or a fenced write was refused, or 'until' passed unrenewed)
//
// The epoch counts this holder's claims, so a write made under an older claim
// is told apart from one under the current claim. A transport error (a
// renew that threw rather than answered) changes nothing: ownership is lost
// only when the board refuses, or when the lease runs out (rule 5).

export type State =
  | { kind: 'Unowned'; epoch: number }
  | { epoch: number; kind: 'Claiming' }
  | { claim: string; epoch: number; kind: 'Owned'; until: number }
  | { claim: string; epoch: number; kind: 'Draining' }
  | { epoch: number; kind: 'Released' }
  | { epoch: number; kind: 'Lost'; why: string }

export type Event =
  | { type: 'claim' }
  | { claim: string; type: 'claimed'; until: number }
  | { type: 'held'; why: string }
  | { type: 'renewed'; until: number }
  | { type: 'refused'; why: string }
  | { type: 'transport' }
  | { now: number; type: 'tick' }
  | { type: 'drain' }
  | { type: 'released' }

export const unowned: State = { epoch: 0, kind: 'Unowned' }

// Guards the tests turn off to check that the simulation catches each broken
// invariant. Never changed outside tests.
export const guards = { expiry: true, lost: true }

export class Illegal extends Error {}

export function step(state: State, event: Event): State {
  switch (event.type) {
    case 'claim':
      if (state.kind === 'Unowned' || state.kind === 'Released' || state.kind === 'Lost') return { epoch: state.epoch + 1, kind: 'Claiming' }
      break
    case 'claimed':
      if (state.kind === 'Claiming') return { claim: event.claim, epoch: state.epoch, kind: 'Owned', until: event.until }
      break
    case 'held':
      if (state.kind === 'Claiming') return { epoch: state.epoch, kind: 'Unowned' }
      break
    case 'renewed':
      // A renew that answers after the lease was lost or let go revives nothing.
      if (state.kind === 'Owned') return { ...state, until: Math.max(state.until, event.until) }
      return state
    case 'refused':
      if (state.kind === 'Owned' || state.kind === 'Draining') return guards.lost ? { epoch: state.epoch, kind: 'Lost', why: event.why } : state
      return state
    case 'transport':
      return state
    case 'tick':
      if (state.kind === 'Owned' && guards.expiry && event.now >= state.until) return { epoch: state.epoch, kind: 'Lost', why: 'expired' }
      return state
    case 'drain':
      if (state.kind === 'Owned') return { claim: state.claim, epoch: state.epoch, kind: 'Draining' }
      if (state.kind === 'Lost') return state
      break
    case 'released':
      if (state.kind === 'Draining') return { epoch: state.epoch, kind: 'Released' }
      if (state.kind === 'Lost') return state
      break
  }
  throw new Illegal(state.kind + ' cannot take ' + event.type)
}

// Whether a write under 'epoch' may land now.
export function writable(state: State, epoch: number, now: number) {
  return state.kind === 'Owned' && state.epoch === epoch && now < state.until
}

