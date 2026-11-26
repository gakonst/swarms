import * as Assert from '../../shared/Assert.ts'


export type State =
  | { kind: 'Unowned'; epoch: number }
  | { epoch: number; kind: 'Claiming' }
  | { claim: string; epoch: number; kind: 'Owned'; until: number }
  | { claim: string; epoch: number; kind: 'Draining' }
  | { epoch: number; kind: 'Released' }
  | { epoch: number; kind: 'Lost'; why: string }

export type Event =
  | { type: 'claim' }
  | { claim: string; epoch: number; type: 'claimed'; until: number }
  | { type: 'held'; why: string }
  | { type: 'renewed'; until: number }
  | { type: 'refused'; why: string }
  | { type: 'transport' }
  | { now: number; type: 'tick' }
  | { type: 'drain' }
  | { type: 'released' }

export const unowned: State = { epoch: 0, kind: 'Unowned' }

export const guards = { expiry: true, lost: true }

export class Illegal extends Error {}

export function step(state: State, event: Event): State {
  const next = move(state, event)
  Assert.assert(next.kind !== 'Owned' || next.claim.length > 0, 'An owned lease holds a claim.', next)
  Assert.assert(state.kind !== 'Owned' || next.kind !== 'Owned' || next.until >= state.until, 'A lease never shortens.', { event, next, state })
  return next
}

function move(state: State, event: Event): State {
  switch (event.type) {
    case 'claim':
      if (state.kind === 'Unowned' || state.kind === 'Released' || state.kind === 'Lost') return { epoch: state.epoch, kind: 'Claiming' }
      break
    case 'claimed':
      if (state.kind === 'Claiming') return { claim: event.claim, epoch: event.epoch, kind: 'Owned', until: event.until }
      break
    case 'held':
      if (state.kind === 'Claiming') return { epoch: state.epoch, kind: 'Unowned' }
      break
    case 'renewed':
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

export function writable(state: State, epoch: number, now: number) {
  return state.kind === 'Owned' && state.epoch === epoch && now < state.until
}

