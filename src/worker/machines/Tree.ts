import * as Assert from '../../shared/Assert.ts'
import * as Limits from '../../shared/Limits.ts'

export type Refused = { ok: false; why: 'illegal' | 'replayed' | 'stale' }

export type Stepped<S> = Refused | { ok: true; state: S }

export type Kv = {
  delete(key: string): unknown
  get<T>(key: string): T | undefined
  put(key: string, value: unknown): void
}

export const version = 1

export type FoldState = 'checking' | 'quieted' | 'splitting' | 'told'

export type Fold = { checking?: boolean; fresh?: string[]; quieted?: boolean; state: FoldState; v: typeof version }

export type FoldEvent = { kind: 'check' } | { fresh: string[]; kind: 'split' } | { kind: 'quiet' } | { kind: 'tell' }

const rank: Record<FoldState, number> = Limits.MachineTree.rank

const reaches = { check: 'checking', quiet: 'quieted', split: 'splitting', tell: 'told' } as const

export function readFold(raw: unknown): Fold | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const kept = raw as Partial<Fold>
  const state: FoldState = kept.state && kept.state in rank ? kept.state : kept.quieted ? 'quieted' : kept.fresh ? 'splitting' : kept.checking ? 'checking' : 'told'
  return { ...(kept.checking ? { checking: true } : {}), ...(kept.fresh ? { fresh: kept.fresh } : {}), ...(kept.quieted ? { quieted: true } : {}), state, v: version }
}

export function fold(at: Fold | undefined, event: FoldEvent): Stepped<Fold> {
  const next = folding(at, event)
  Assert.assert(!next.ok || at === undefined || rank[next.state.state] > rank[at.state], 'A fold only moves forward.', { at, event })
  return next
}

function folding(at: Fold | undefined, event: FoldEvent): Stepped<Fold> {
  const to = reaches[event.kind]
  if (at && rank[at.state] >= rank[to]) return { ok: false, why: 'replayed' }
  if (!at && event.kind !== 'tell') return { ok: false, why: 'illegal' }
  const base: Fold = at ?? { state: to, v: version }
  if (event.kind === 'check') return { ok: true, state: { ...base, checking: true, state: to } }
  if (event.kind === 'split') return { ok: true, state: { ...base, fresh: base.fresh ?? event.fresh, state: to } }
  if (event.kind === 'quiet') return { ok: true, state: { ...base, quieted: true, state: to } }
  return { ok: true, state: { ...base, state: to } }
}

export type FoldMachine = { read: (raw: unknown) => Fold | undefined; settled: (kv: Kv, run: string) => boolean; step: typeof fold }

export const foldMachine: FoldMachine = { read: readFold, settled: (kv, run) => kv.get<string>(foldedKey(run)) !== undefined, step: fold }

export function foldKey(run: string) {
  return 'ran:' + run
}

export function foldedKey(run: string) {
  return 'folded:' + run
}

export function apply(kv: Kv, key: string, event: FoldEvent, effect: (next: Fold) => void, machine: FoldMachine = foldMachine) {
  const stepped = machine.step(machine.read(kv.get(key)), event)
  if (!stepped.ok) return false
  effect(stepped.state)
  kv.put(key, stepped.state)
  return true
}

export type Outcome = 'progress' | 'proved' | 'refuted' | 'split' | 'stuck'

export type FoldInput = { children: number; outcome: Outcome; proof: boolean; summary: string }

export type FoldIo = {
  emit: (event: 'checking' | 'progress', text: string) => void
  fresh: () => Promise<string[]>
  kv: Kv
  node: string
  post: (index: number) => Promise<void>
  verify: () => Promise<string | null>
}

export type Folded = 'folded' | 'settled'

export async function runFold(io: FoldIo, run: string, input: FoldInput, machine: FoldMachine = foldMachine): Promise<Folded> {
  if (machine.settled(io.kv, run)) return 'settled'
  const key = foldKey(run)
  const stuck = 'stuck:' + io.node
  const quiet = 'quiet:' + io.node
  apply(
    io.kv,
    key,
    { kind: 'tell' },
    () => {
      io.emit('progress', input.summary || input.outcome)
      if (input.outcome === 'stuck') io.kv.put(stuck, (io.kv.get<number>(stuck) ?? 0) + 1)
      else io.kv.delete(stuck)
    },
    machine,
  )
  if (input.proof) {
    const checking = await io.verify()
    if (checking !== null) apply(io.kv, key, { kind: 'check' }, () => io.emit('checking', checking), machine)
  }
  let split = 0
  if (input.outcome === 'split' && input.children > 0) {
    const before = machine.read(io.kv.get(key))
    const fresh = before?.fresh ?? (await io.fresh())
    apply(io.kv, key, { fresh, kind: 'split' }, () => undefined, machine)
    split = (machine.read(io.kv.get(key))?.fresh ?? fresh).length
    for (let index = 0; index < input.children; index++) await io.post(index)
  }
  const reset = input.outcome === 'proved' || input.outcome === 'refuted' || split > 0
  apply(
    io.kv,
    key,
    { kind: 'quiet' },
    () => {
      if (reset) io.kv.delete(quiet)
      else io.kv.put(quiet, (io.kv.get<number>(quiet) ?? 0) + 1)
    },
    machine,
  )
  return 'folded'
}

export function settle(kv: Kv, run: string, done: string) {
  kv.put(foldedKey(run), done)
  kv.delete(foldKey(run))
}

export type NodeState =
  | { check: string; kind: 'checking' }
  | { end: string; kind: 'ended' }
  | { kind: 'open' }
  | { kind: 'proposed' }
  | { check: string; kind: 'proven' }
  | { check?: string; kind: 'running'; run: string }

export type NodeEvent =
  | { check: string; kind: 'ask' }
  | { check: string; kind: 'checked' }
  | { end: string; kind: 'end' }
  | { kind: 'post' }
  | { check: string; kind: 'prove' }
  | { kind: 'settle'; run: string }
  | { kind: 'start'; run: string }

export function terminalNode(state: NodeState) {
  return state.kind === 'proven' || state.kind === 'ended'
}

export function node(at: NodeState, event: NodeEvent): Stepped<NodeState> {
  if (event.kind === 'post') return at.kind === 'proposed' ? { ok: true, state: { kind: 'open' } } : { ok: false, why: 'replayed' }
  if (at.kind === 'proposed') return { ok: false, why: 'illegal' }
  if (terminalNode(at)) return { ok: false, why: event.kind === 'prove' || event.kind === 'end' ? 'replayed' : 'stale' }
  if (event.kind === 'start') return at.kind === 'open' ? { ok: true, state: { kind: 'running', run: event.run } } : { ok: false, why: at.kind === 'running' && at.run === event.run ? 'replayed' : 'illegal' }
  if (event.kind === 'settle') {
    if (at.kind !== 'running' || at.run !== event.run) return { ok: false, why: 'stale' }
    return { ok: true, state: at.check === undefined ? { kind: 'open' } : { check: at.check, kind: 'checking' } }
  }
  if (event.kind === 'ask') {
    if ((at.kind === 'checking' || at.kind === 'running') && at.check === event.check) return { ok: false, why: 'replayed' }
    return { ok: true, state: at.kind === 'running' ? { check: event.check, kind: 'running', run: at.run } : { check: event.check, kind: 'checking' } }
  }
  if (event.kind === 'checked') {
    if ((at.kind !== 'checking' && at.kind !== 'running') || at.check !== event.check) return { ok: false, why: 'stale' }
    return { ok: true, state: at.kind === 'running' ? { kind: 'running', run: at.run } : { kind: 'open' } }
  }
  if (event.kind === 'prove') return { ok: true, state: { check: event.check, kind: 'proven' } }
  return { ok: true, state: { end: event.end, kind: 'ended' } }
}

export type CheckState = 'expired' | 'failed' | 'passed' | 'requested' | 'waiting'

export type Check = { at: number; deadline?: number; sha: string; state: CheckState; v: typeof version }

export type CheckEvent = { at: number; kind: 'ask'; sha: string } | { at: number; deadline: number; kind: 'asked' } | { at: number; kind: 'came'; passed: boolean } | { at: number; kind: 'expire' }

export function terminalCheck(state: CheckState) {
  return state === 'passed' || state === 'failed' || state === 'expired'
}

export function check(at: Check | undefined, event: CheckEvent): Stepped<Check> {
  if (event.kind === 'ask') return at ? { ok: false, why: 'replayed' } : { ok: true, state: { at: event.at, sha: event.sha, state: 'requested', v: version } }
  if (!at) return event.kind === 'came' ? { ok: true, state: { at: event.at, sha: '', state: event.passed ? 'passed' : 'failed', v: version } } : { ok: false, why: 'illegal' }
  if (terminalCheck(at.state)) return { ok: false, why: event.kind === 'came' ? 'stale' : 'replayed' }
  if (event.kind === 'asked') return at.state === 'requested' ? { ok: true, state: { ...at, at: event.at, deadline: event.deadline, state: 'waiting' } } : { ok: false, why: 'replayed' }
  if (event.kind === 'came') return { ok: true, state: { ...at, at: event.at, state: event.passed ? 'passed' : 'failed' } }
  if (at.state !== 'waiting' || (at.deadline ?? Infinity) > event.at) return { ok: false, why: 'illegal' }
  return { ok: true, state: { ...at, at: event.at, state: 'expired' } }
}

export function readCheck(raw: unknown): Check | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const kept = raw as Partial<Check>
  if (kept.v !== version || typeof kept.state !== 'string') return undefined
  return kept as Check
}

export type CheckMachine = { read: typeof readCheck; step: typeof check }

export const checkMachine: CheckMachine = { read: readCheck, step: check }

export type CheckIo<R> = {
  kv: Kv
  now: () => number
  outcome: () => R | undefined
  request: () => Promise<{ detail: string; ok: false } | { ok: true }>
  wait: (ms: number) => Promise<void>
}

export type Waited<R> = { kind: 'came'; outcome: R } | { detail: string; kind: 'refused' } | { kind: 'expired' }

export async function waitCheck<R>(io: CheckIo<R>, key: string, sha: string, limits: { pollMs: number; waitMs: number }, machine: CheckMachine = checkMachine): Promise<Waited<R>> {
  const step = (event: CheckEvent) => {
    const stepped = machine.step(machine.read(io.kv.get(key)), event)
    if (stepped.ok) io.kv.put(key, stepped.state)
    return stepped
  }
  const first = io.outcome()
  if (first !== undefined) return { kind: 'came', outcome: first }
  let at = machine.read(io.kv.get(key))
  if (at?.state === 'expired') return { kind: 'expired' }
  if (!at || at.state === 'requested') {
    step({ at: io.now(), kind: 'ask', sha })
    const asked = await io.request()
    if (!asked.ok) {
      io.kv.delete(key)
      return { detail: asked.detail, kind: 'refused' }
    }
    step({ at: io.now(), deadline: io.now() + limits.waitMs, kind: 'asked' })
  }
  for (;;) {
    const outcome = io.outcome()
    if (outcome !== undefined) return { kind: 'came', outcome }
    at = machine.read(io.kv.get(key))
    if (at?.state === 'expired' || step({ at: io.now(), kind: 'expire' }).ok) return { kind: 'expired' }
    const deadline = at?.deadline ?? io.now()
    await io.wait(Math.max(1, Math.min(limits.pollMs, deadline - io.now())))
  }
}

export function came(kv: Kv, key: string, sha: string, passed: boolean, at: number, machine: CheckMachine = checkMachine) {
  const stepped = machine.step(machine.read(kv.get(key)), { at, kind: 'came', passed })
  if (!stepped.ok) return stepped
  kv.put(key, { ...stepped.state, sha: stepped.state.sha || sha })
  return stepped
}
