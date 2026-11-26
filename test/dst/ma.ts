import { createHash } from 'node:crypto'
import * as Flow from '../../src/worker/Flow.ts'
import * as Hand from '../../src/worker/machines/Hand.ts'
import * as Run from '../../src/worker/machines/Run.ts'
import * as Sub from '../../src/worker/machines/Sub.ts'
import * as Tree from '../../src/worker/machines/Tree.ts'
import type * as Gateway from '../../src/worker/Gateway.ts'
import type * as SwarmModule from '../../src/worker/Swarm.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  check: { crashes: 3, crashSteps: 8, lives: 10, pollMs: 10, polls: 1000, runs: 8, waitMs: 100 },
  foldrun: { cases: 4, childrenMost: 3, crashSteps: 12, lives: 3, restartSteps: 6 },
  lent: { crashes: 3, ops: 14 },
  node: { events: 60, runs: 200 },
  refusal: { steps: 2000 },
  seen: { agents: 2, reads: 400, spendCents: 400, subs: 3 },
  system: { pollMs: 5, timing: { idleMs: 100_000, listMs: 0, pollMs: 10, streamDownMs: 10, verifyMs: 10 }, untilMs: 5000 },
  violations: 20,
}

type Rng = { chance: (p: number) => boolean; int: (lo: number, hi: number) => number; next: () => number; pick: <T>(items: readonly T[]) => T }

function rng(...parts: (number | string)[]): Rng {
  const digest = createHash('sha256').update(parts.join(':')).digest()
  let a = digest.readUInt32LE(0)
  let b = digest.readUInt32LE(4)
  let c = digest.readUInt32LE(8)
  let d = digest.readUInt32LE(12)
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0
    d = (d + 1) >>> 0
    a = (b ^ (b >>> 9)) >>> 0
    b = (c + (c << 3)) >>> 0
    c = ((c << 21) | (c >>> 11)) >>> 0
    c = (c + t) >>> 0
    return t / 4294967296
  }
  return {
    chance: (p) => next() < p,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    next,
    pick: (items) => items[Math.floor(next() * items.length)] as never,
  }
}

function recorder() {
  const violations: Violation[] = []
  const fail = (invariant: string, detail: string) => {
    if (violations.length < limits.violations) violations.push({ detail, invariant })
  }
  return { fail, violations }
}

function store() {
  const map = new Map<string, unknown>()
  const kv: Tree.Kv = {
    delete: (key) => map.delete(key),
    get: <T>(key: string) => (map.has(key) ? (structuredClone(map.get(key)) as T) : undefined),
    put: (key, value) => void map.set(key, structuredClone(value)),
  }
  return kv
}

function seeded(random: Rng) {
  const saved = { random: Math.random, uuid: crypto.randomUUID.bind(crypto) }
  Math.random = () => random.next()
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () => random.int(0, 15).toString(16)).join('')
    return (hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32)) as ReturnType<
      Crypto['randomUUID']
    >
  }
  return () => {
    Math.random = saved.random
    crypto.randomUUID = saved.uuid
  }
}

class Crash extends Error {}

const json = (value: unknown) => JSON.stringify(value)

async function seen(seed: string): Promise<Outcome> {
  const random = rng(seed, 'seen')
  const { fail, violations } = recorder()
  const S = limits.seen
  const kv = store()
  const states = ['unknown', 'running', 'running', 'completed', 'failed', 'closed', 'interrupted', 'stopped']
  const most = new Map<string, bigint>()
  let steps = 0
  for (; steps < S.reads; steps++) {
    const agent = 'agt' + random.int(0, S.agents - 1)
    const id = random.int(1, S.subs)
    const key = Sub.key(agent, id)
    const role = 'n:a#' + id
    const pick = random.next()
    if (pick < 0.04) {
      kv.put(key, {
        spent: '9.000000',
        sub: { agent_id: id, parent_agent_id: null, role, spent_usd: 9, status: { state: 'completed' }, task: 't' },
        v: Sub.version + 1,
      })
      most.delete(key)
      if (Sub.get(kv, agent, id) !== undefined) fail('version', key + ' of another version was read')
      continue
    }
    if (pick < 0.1) {
      const had = Sub.get(kv, agent, id)
      const raw = json(kv.get(key))
      Sub.seed(kv, agent, id, role)
      if (had && json(kv.get(key)) !== raw) fail('seed keeps', key + ' was overwritten by a seed')
      if (!had) {
        most.set(key, 0n)
        const planted = Sub.get(kv, agent, id)
        if (!planted || Sub.rank(planted.sub.status.state) !== 0 || Sub.spent(planted) !== 0n) fail('seed keeps', key + ' seeded as ' + json(planted))
      }
      continue
    }
    const state = random.pick(states)
    const spend = random.int(0, S.spendCents) / 100
    const read: Gateway.Subagent = {
      agent_id: id,
      parent_agent_id: null,
      role,
      spent_usd: spend,
      status: { state },
      task: 't',
      ...(Sub.rank(state) === 2 ? { result: 'r' + steps } : {}),
    }
    const at = Sub.get(kv, agent, id)
    const next = Sub.observe(kv, agent, read)
    const micro = Flow.micro(spend)
    const was = at ? (most.get(key) ?? Sub.spent(at)) : micro
    const top = was > micro ? was : micro
    most.set(key, top)
    if (Sub.spent(next) !== top || Sub.view(next).spent_usd !== Flow.number(top))
      fail('spend most', key + ' spent ' + next.spent + ' after reads up to ' + Flow.number(top))
    if (json(Sub.get(kv, agent, id)) !== json(next)) fail('stored', key + ' stored ' + json(kv.get(key)) + ' but answered ' + json(next))
    if (Sub.done(next) !== (Sub.rank(next.sub.status.state) === 2)) fail('done', key + ' done disagrees with ' + next.sub.status.state)
    if (!at) {
      if (json(next.sub) !== json(read)) fail('newer taken', key + ' first read not kept')
      continue
    }
    const before = Sub.rank(at.sub.status.state)
    const now = Sub.rank(state)
    if (Sub.rank(next.sub.status.state) < before) fail('rank rises', key + ' fell ' + at.sub.status.state + ' -> ' + next.sub.status.state)
    if (before === 2 && json(next.sub) !== json(at.sub)) fail('ended fixed', key + ' ended ' + at.sub.status.state + ' changed to ' + json(next.sub))
    const older = now < before || (now === before && micro < Sub.spent(at))
    if (older && json(next.sub) !== json(at.sub))
      fail('no regress', key + ' ' + at.sub.status.state + ' at ' + at.spent + ' replaced by older ' + state + ' at ' + spend)
    const newer = before < 2 && (now > before || (now === before && micro >= Sub.spent(at)))
    if (newer && json(next.sub) !== json(read))
      fail('newer taken', key + ' ' + state + ' at ' + spend + ' not taken over ' + at.sub.status.state + ' at ' + at.spent)
  }
  return { steps, violations }
}

const outcomes: Tree.Outcome[] = ['progress', 'proved', 'refuted', 'split', 'stuck']

async function foldrun(seed: string): Promise<Outcome> {
  const random = rng(seed, 'foldrun')
  const { fail, violations } = recorder()
  const F = limits.foldrun
  let steps = 0
  for (let n = 0; n < F.cases; n++) {
    const outcome = random.pick(outcomes)
    const children = outcome === 'split' ? random.int(0, F.childrenMost) : 0
    const ids = Array.from({ length: children }, (_, index) => 'c' + index)
    const existing = ids.filter(() => random.chance(0.3))
    const proof = (outcome === 'proved' || outcome === 'refuted') && random.chance(0.8)
    const quiet = random.int(0, 2)
    const stuck = random.int(0, 2)
    const input: Tree.FoldInput = { children, outcome, proof, summary: 'did ' + outcome }
    for (let crashAt = -1; crashAt < F.crashSteps; crashAt++) {
      const kv = store()
      if (quiet) kv.put('quiet:n', quiet)
      if (stuck) kv.put('stuck:n', stuck)
      const nodes = new Set(existing)
      const checks = new Set<string>()
      const emits = { checking: 0, progress: 0 }
      const life = async (at: number) => {
        let count = 0
        const step = async () => {
          await Promise.resolve()
          steps += 1
          if (count++ === at) throw new Crash()
        }
        const io: Tree.FoldIo = {
          emit: (event) => void (emits[event] += 1),
          fresh: async () => {
            await step()
            return ids.filter((id) => !nodes.has(id))
          },
          kv,
          node: 'n',
          post: async (index) => {
            await step()
            nodes.add(ids[index] as string)
            await step()
          },
          verify: async () => {
            await step()
            checks.add('v:n')
            await step()
            return 'Checking'
          },
        }
        const folded = await Tree.runFold(io, 'r:n:1', input)
        await step()
        if (folded === 'folded') Tree.settle(kv, 'r:n:1', 'done')
      }
      let crashes = 0
      let at = crashAt
      for (;;) {
        try {
          await life(at)
          break
        } catch (error) {
          if (!(error instanceof Crash)) throw error
          crashes += 1
          at = random.chance(0.3) && crashes < F.lives ? random.int(0, F.restartSteps - 1) : -1
        }
      }
      await life(-1)
      const where = outcome + ' case ' + n + ' crash at ' + crashAt
      if (emits.progress !== 1) fail('progress once', where + ': progress told ' + emits.progress + ' times')
      if (emits.checking !== (proof ? 1 : 0)) fail('checking once', where + ': checking told ' + emits.checking + ' times')
      if (proof && !checks.has('v:n')) fail('check posted', where + ': the check was not posted')
      for (const id of ids) if (!nodes.has(id)) fail('children posted', where + ': child ' + id + ' not posted')
      const counted = kv.get<number>('stuck:n')
      if (outcome === 'stuck' ? counted !== stuck + 1 : counted !== undefined) fail('stuck count', where + ': stuck counted as ' + counted)
      const fresh = ids.filter((id) => !existing.includes(id)).length
      const reset = outcome === 'proved' || outcome === 'refuted' || fresh > 0
      const quieted = kv.get<number>('quiet:n')
      if (reset ? quieted !== undefined : quieted !== quiet + 1) fail('quiet count', where + ': quiet counted as ' + quieted)
      if (kv.get(Tree.foldedKey('r:n:1')) === undefined) fail('settled', where + ': never settled')
      if (kv.get(Tree.foldKey('r:n:1')) !== undefined) fail('settled', where + ': fold record left behind')
    }
  }
  return { steps, violations }
}

type NodeModel = { open: string[]; state: Tree.NodeState }

const nodeWants = [
  'proposed>post',
  'open>start',
  'running>settle',
  'running+check>settle',
  'running+check>checked',
  'open>ask',
  'running>ask',
  'checking>checked',
  'checking>ask',
  'open>prove',
  'running>prove',
  'checking>prove',
  'open>end',
  'running>end',
  'checking>end',
]

function nodeEvent(random: Rng, model: NodeModel, k: number): Tree.NodeEvent {
  const pick = random.next()
  const run = 'r:n:' + (random.chance(0.2) ? Math.max(1, k - 1) : k)
  const check = 'v:n:' + random.int(0, 2)
  if (pick < 0.1) return { kind: 'post' }
  if (pick < 0.35) return { kind: 'start', run }
  if (pick < 0.55) return { kind: 'settle', run: model.state.kind === 'running' && random.chance(0.7) ? model.state.run : run }
  if (pick < 0.7) return { check, kind: 'ask' }
  const asked = model.state.kind === 'checking' || model.state.kind === 'running' ? model.state.check : undefined
  if (pick < 0.85) return { check: asked !== undefined && random.chance(0.7) ? asked : check, kind: 'checked' }
  if (pick < 0.93) return { check, kind: 'prove' }
  return { end: 'exhausted', kind: 'end' }
}

async function node(seed: string): Promise<Outcome> {
  const random = rng(seed, 'node')
  const { fail, violations } = recorder()
  const N = limits.node
  const taken = new Set<string>()
  let steps = 0
  for (let r = 0; r < N.runs; r++) {
    const stored = { state: { kind: 'proposed' } as Tree.NodeState }
    const model: NodeModel = { open: [], state: stored.state }
    let k = 1
    let last: Tree.NodeEvent | undefined
    for (let i = 0; i < N.events; i++, steps++) {
      if (random.chance(0.15)) model.state = structuredClone(stored.state)
      const event = last && random.chance(0.2) ? last : nodeEvent(random, model, k)
      const before = model.state
      const stepped = Tree.node(before, event)
      if (stepped.ok) {
        taken.add(before.kind + (before.kind === 'running' && before.check ? '+check' : '') + '>' + event.kind)
        if (Tree.terminalNode(before)) fail('terminal', 'run ' + r + ': left terminal ' + before.kind + ' on ' + event.kind)
        if (event.kind === 'start') {
          model.open.push(event.run)
          k += 1
        }
        if (event.kind === 'settle') model.open = model.open.filter((one) => one !== event.run)
        if (event.kind === 'settle' && before.kind === 'running' && before.run !== event.run)
          fail('stale settle', 'run ' + r + ': a stale settle of ' + event.run + ' was folded')
        model.state = stepped.state
        stored.state = stepped.state
      } else if (last === event && stepped.why === 'illegal' && Tree.terminalNode(before))
        fail('replay refused', 'run ' + r + ': a duplicate on a terminal node was not refused as replayed')
      if (model.open.length > 1) fail('one run', 'run ' + r + ': ' + model.open.length + ' runs open at once')
      last = event
    }
  }
  for (const want of nodeWants) if (!taken.has(want)) fail('coverage', 'transition ' + want + ' was never taken')
  return { steps, violations }
}

type Verdict = { failed: string } | { passed: number }

async function check(seed: string): Promise<Outcome> {
  const random = rng(seed, 'check')
  const { fail, violations } = recorder()
  const C = limits.check
  const window = { pollMs: C.pollMs, waitMs: C.waitMs }
  let steps = 0
  for (let r = 0; r < C.runs; r++) {
    const kv = store()
    const key = 'check:v:n:abc'
    const outKey = 'verified:v:n:abc'
    let now = 0
    let asked = 0
    let waits = 0
    const arrives = random.chance(0.25) ? Infinity : random.int(0, C.waitMs + C.waitMs / 2)
    const first: Verdict = random.chance(0.5) ? { passed: 1 } : { failed: 'log' }
    const second: Verdict = 'passed' in first ? { failed: 'late' } : { passed: 2 }
    let delivered = 0
    const deliver = (verdict: Verdict) => {
      if (Tree.came(kv, key, 'abc', 'passed' in verdict, now).ok) kv.put(outKey, verdict)
    }
    const crashes = new Set(Array.from({ length: C.crashes }, () => random.int(0, C.crashSteps - 1)))
    let count = 0
    const io: Tree.CheckIo<Verdict> = {
      kv,
      now: () => now,
      outcome: () => kv.get<Verdict>(outKey),
      request: async () => {
        steps += 1
        if (Tree.readCheck(kv.get(key))?.state === 'waiting') fail('ask once', 'run ' + r + ': the verifier was asked again while a check waited')
        asked += 1
        if (crashes.has(count++)) throw new Crash()
        return { ok: true }
      },
      wait: async (ms) => {
        steps += 1
        waits += 1
        if (waits > C.polls) throw new Error('hung')
        now += ms
        while (now >= arrives && delivered < 3) {
          deliver(delivered === 2 ? second : first)
          delivered += 1
        }
        if (crashes.has(count++)) throw new Crash()
      },
    }
    let result: Tree.Waited<Verdict> | undefined
    let lives = 0
    let hung = false
    while (!result && lives++ < C.lives) {
      try {
        result = await Tree.waitCheck(io, key, 'abc', window)
      } catch (error) {
        if (error instanceof Error && error.message === 'hung') {
          fail('deadline', 'run ' + r + ': the wait never ended')
          hung = true
          break
        }
        if (!(error instanceof Crash)) throw error
      }
    }
    if (!result && !hung) fail('result', 'run ' + r + ': no result after ' + lives + ' lives')
    if (asked === 0 && result?.kind !== 'came') fail('ask once', 'run ' + r + ': the verifier was never asked')
    if (result?.kind === 'came' && json(result.outcome) !== json(first)) fail('first outcome', 'run ' + r + ': a later outcome replaced the first')
    if (result?.kind === 'expired' && arrives <= C.waitMs - C.pollMs) fail('expiry', 'run ' + r + ': expired although the outcome came at ' + arrives)
    if (result?.kind === 'expired') {
      deliver(first)
      if (kv.get(outKey) !== undefined && arrives === Infinity) fail('late outcome', 'run ' + r + ': an outcome after expiry was taken')
    }
    if (now > C.waitMs * 3) fail('deadline', 'run ' + r + ': waited past the deadline until ' + now)
  }
  return { steps, violations }
}

const handRank = { issue: 0, kept: 1, mint: 2, return: 3, revoke: 4 } as const

function handWant(at: Hand.Hand | undefined, event: Hand.HandEvent): Hand.Stepped<Hand.HandState> {
  if (event.kind === 'issue') return at ? { ok: false, why: 'replayed' } : { ok: true, state: 'issued' }
  if (!at) return { ok: false, why: 'illegal' }
  if (at.state === 'returned') return { ok: false, why: event.kind === 'return' || event.kind === 'revoke' ? 'replayed' : 'stale' }
  if (event.kind === 'mint') return at.state === 'issued' ? { ok: true, state: 'minted' } : { ok: false, why: at.state === 'minted' ? 'replayed' : 'stale' }
  if (event.kind === 'revoke') return { ok: true, state: 'revoking' }
  if (event.kind === 'kept') return at.state === 'revoking' ? { ok: true, state: 'minted' } : { ok: false, why: 'stale' }
  return at.state === 'minted' ? { ok: false, why: 'illegal' } : { ok: true, state: 'returned' }
}

const foldRank: Record<Tree.FoldState, number> = { checking: 2, quieted: 4, splitting: 3, told: 1 }

const foldReach = { check: 'checking', quiet: 'quieted', split: 'splitting', tell: 'told' } as const

function checkWant(at: Tree.Check | undefined, event: Tree.CheckEvent): Tree.Stepped<Tree.CheckState> {
  if (event.kind === 'ask') return at ? { ok: false, why: 'replayed' } : { ok: true, state: 'requested' }
  if (!at) return event.kind === 'came' ? { ok: true, state: event.passed ? 'passed' : 'failed' } : { ok: false, why: 'illegal' }
  if (Tree.terminalCheck(at.state)) return { ok: false, why: event.kind === 'came' ? 'stale' : 'replayed' }
  if (event.kind === 'asked') return at.state === 'requested' ? { ok: true, state: 'waiting' } : { ok: false, why: 'replayed' }
  if (event.kind === 'came') return { ok: true, state: event.passed ? 'passed' : 'failed' }
  return at.state === 'waiting' && (at.deadline ?? Infinity) <= event.at ? { ok: true, state: 'expired' } : { ok: false, why: 'illegal' }
}

function same<S>(want: Tree.Stepped<S>, got: Tree.Stepped<{ state: S }>) {
  return want.ok ? got.ok && got.state.state === want.state : !got.ok && got.why === want.why
}

async function refusal(seed: string): Promise<Outcome> {
  const random = rng(seed, 'refusal')
  const { fail, violations } = recorder()
  let hand: Hand.Hand | undefined
  let fold: Tree.Fold | undefined
  let checked: Tree.Check | undefined
  let steps = 0
  for (; steps < limits.refusal.steps; steps++) {
    const lane = random.int(0, 2)
    if (lane === 0) {
      if (random.chance(0.05)) hand = undefined
      const kind = random.pick(Object.keys(handRank) as (keyof typeof handRank)[])
      const life = 'l' + random.int(0, 3)
      const event: Hand.HandEvent =
        kind === 'issue'
          ? { at: steps, kind, life }
          : kind === 'revoke'
            ? { at: steps, by: random.pick(['evicted', 'failed', 'owner'] as const), kind, life }
            : { at: steps, kind }
      const want = handWant(hand, event)
      const got = Hand.machine.step(hand, event)
      if (!same(want, got)) fail('hand why', (hand?.state ?? '-') + ' on ' + kind + ' answered ' + json(got) + ', wanted ' + json(want))
      if (got.ok && event.kind === 'revoke' && (got.state.life !== event.life || got.state.by !== event.by))
        fail('hand why', 'a revoke did not name its life ' + json(got.state))
      for (const busy of [false, true]) {
        const wanted = !!hand && (hand.state === 'issued' || hand.state === 'revoking') && !busy
        if (Hand.machine.unfinished(hand, busy) !== wanted) fail('unfinished', (hand?.state ?? '-') + ' busy ' + busy + ' read unfinished ' + !wanted)
      }
      if (got.ok) hand = Hand.machine.read(structuredClone(got.state))
    } else if (lane === 1) {
      if (random.chance(0.05)) {
        const raw: Record<string, unknown> = {}
        if (random.chance(0.5)) raw['checking'] = true
        if (random.chance(0.5)) raw['fresh'] = ['x' + steps]
        if (random.chance(0.3)) raw['quieted'] = true
        const legacy = Tree.foldMachine.read(raw)
        const wanted: Tree.FoldState = raw['quieted'] ? 'quieted' : raw['fresh'] ? 'splitting' : raw['checking'] ? 'checking' : 'told'
        if (
          legacy?.state !== wanted ||
          json(legacy.fresh) !== json(raw['fresh']) ||
          !!legacy.checking !== !!raw['checking'] ||
          !!legacy.quieted !== !!raw['quieted']
        )
          fail('fold legacy', json(raw) + ' read as ' + json(legacy))
        fold = legacy
      } else if (random.chance(0.05)) fold = undefined
      const kind = random.pick(['check', 'quiet', 'split', 'tell'] as const)
      const event: Tree.FoldEvent = kind === 'split' ? { fresh: ['n' + steps], kind } : { kind }
      const to = foldReach[kind]
      const want: Tree.Stepped<Tree.FoldState> =
        fold && foldRank[fold.state] >= foldRank[to]
          ? { ok: false, why: 'replayed' }
          : !fold && kind !== 'tell'
            ? { ok: false, why: 'illegal' }
            : { ok: true, state: to }
      const got = Tree.foldMachine.step(fold, event)
      if (!same(want, got)) fail('fold why', (fold?.state ?? '-') + ' on ' + kind + ' answered ' + json(got) + ', wanted ' + json(want))
      if (got.ok) {
        const fresh = fold?.fresh ?? (event.kind === 'split' ? event.fresh : undefined)
        if (
          json(got.state.fresh) !== json(fresh) ||
          !!got.state.checking !== (!!fold?.checking || kind === 'check') ||
          !!got.state.quieted !== (!!fold?.quieted || kind === 'quiet')
        )
          fail('fold keeps', (fold ? json(fold) : '-') + ' on ' + kind + ' became ' + json(got.state))
        fold = Tree.foldMachine.read(structuredClone(got.state))
      }
    } else {
      if (random.chance(0.05)) checked = undefined
      if (random.chance(0.02) && Tree.checkMachine.read({ state: random.pick(['waiting', 'passed'] as const) }) !== undefined)
        fail('check read', 'an unversioned check record was read')
      const kind = random.pick(['ask', 'asked', 'came', 'expire'] as const)
      const at = steps + random.int(-3, 3)
      const event: Tree.CheckEvent =
        kind === 'ask'
          ? { at, kind, sha: 'a' }
          : kind === 'asked'
            ? { at, deadline: at + random.int(0, 6), kind }
            : kind === 'came'
              ? { at, kind, passed: random.chance(0.5) }
              : { at, kind }
      const want = checkWant(checked, event)
      const got = Tree.checkMachine.step(checked, event)
      if (!same(want, got))
        fail(
          'check why',
          (checked ? checked.state + ' deadline ' + checked.deadline : '-') + ' on ' + json(event) + ' answered ' + json(got) + ', wanted ' + json(want),
        )
      if (got.ok) checked = Tree.checkMachine.read(structuredClone(got.state))
    }
  }
  return { steps, violations }
}

type Swarm = InstanceType<typeof SwarmModule.Swarm>

async function lent(seed: string, d1 = true): Promise<Outcome> {
  const random = rng(seed, 'lent')
  const { fail, violations } = recorder()
  const L = limits.lent
  const restoreRandom = seeded(rng(seed, 'lent', 'ids'))
  const { world } = await import('../run.ts')
  const id = 'abc123abc123'
  const minted = new Map<string, number>()
  const listed = new Set<string>()
  let crashes = 0
  let armed = false
  let die = () => undefined as void
  let steps = 0
  const hang = new Promise<never>(() => undefined)
  const fault = () => {
    steps += 1
    if (!armed || crashes >= L.crashes || random.next() >= 0.06) return false
    crashes += 1
    die()
    return true
  }
  const w = world((async (request: Request, url: URL) => {
    if (url.pathname === '/v1/hands' && request.method === 'POST') {
      if (fault()) return hang
      if (random.chance(0.1)) return Response.json({ detail: 'down' }, { status: 500 })
      const name = url.searchParams.get('name') ?? ''
      minted.set(name, (minted.get(name) ?? 0) + 1)
      listed.add(name)
      if (fault()) return hang
      return Response.json({ command: 'nc hand', short: 'nc', token: 'hand_' + name, url: 'wss://gateway.test/v1/hands/' + name })
    }
    if (url.pathname === '/v1/hands') return Response.json({ hands: [...listed].map((name) => ({ connected: true, name, requests: 1 })) })
    const named = /^\/v1\/hands\/([^/]+)$/.exec(url.pathname)
    if (named && request.method === 'DELETE') {
      if (fault()) return hang
      const name = decodeURIComponent(named[1] ?? '')
      if (armed && random.chance(0.1)) return Response.json({ detail: 'down' }, { status: 500 })
      if (!listed.delete(name)) return Response.json({ detail: 'No such hand' }, { status: 404 })
      if (fault()) return hang
      return Response.json({ disconnected: true })
    }
    return undefined
  }) as Parameters<typeof world>[0])
  try {
    const db = w.env.DB
    const wrap = (inner: D1PreparedStatement, query: string): D1PreparedStatement => {
      const writes = /^\s*(insert|update|delete)/i.test(query)
      const call = async <T>(work: () => Promise<T>) => {
        if (d1 && fault()) return hang
        const answer = await work()
        if (writes && d1 && fault()) return hang
        return answer
      }
      return {
        all: () => call(() => inner.all()),
        bind: (...values: unknown[]) => wrap(inner.bind(...values), query),
        first: (column?: string) => call(() => (column === undefined ? inner.first() : inner.first(column))),
        inner,
        raw: (options?: { columnNames?: boolean }) => call(() => inner.raw(options as never)),
        run: () => call(() => inner.run()),
      } as unknown as D1PreparedStatement
    }
    ;(w.env as unknown as { DB: D1Database }).DB = {
      ...db,
      batch: async (statements: D1PreparedStatement[]) => {
        if (d1 && fault()) return hang
        const answer = await db.batch(statements.map((one) => (one as unknown as { inner?: D1PreparedStatement }).inner ?? one))
        if (d1 && fault()) return hang
        return answer
      },
      prepare: (query: string) => wrap(db.prepare(query), query),
    } as unknown as D1Database
    await w.seed('0')
    armed = true
    const Life = w.swarm.constructor as new (ctx: unknown, env: unknown) => Swarm
    let swarm: Swarm = new Life(w.swarm.ctx, w.env)
    const restart = () => {
      swarm = new Life(w.swarm.ctx, w.env)
    }
    const issued = new Set<string>()
    const removed = new Set<string>()
    const kept = new Set<string>()
    const maybe = new Set<string>()
    const attempt = async <T>(work: () => Promise<T>) => {
      const crashed = new Promise<undefined>((resolve) => void (die = () => resolve(undefined)))
      const answer = await Promise.race([work(), crashed])
      if (answer === undefined) restart()
      return answer
    }
    for (let op = 0; op < L.ops; op++) {
      const pick = random.next()
      const names = [...issued]
      if (pick < 0.5 || !names.length) {
        const answer = await attempt(() => swarm.lend(id, 'box', null))
        if (answer?.ok) {
          if (issued.has(answer.name)) fail('issued once', answer.name + ' issued twice')
          issued.add(answer.name)
        }
      } else if (pick < 0.85) {
        const name = random.pick(names)
        const was = removed.has(name)
        const answer = await attempt(() => swarm.unlend(id, name))
        if (answer === undefined) {
          kept.delete(name)
          if (!was) maybe.add(name)
        } else if (answer.ok) {
          if (was) fail('removed once', 'a duplicate removal of ' + name + ' answered ok')
          removed.add(name)
          maybe.delete(name)
          kept.delete(name)
        } else if (answer.reason === 'upstream' && !maybe.has(name)) kept.add(name)
        else if (answer.reason === 'missing' && !was && !maybe.has(name)) fail('removed once', name + ' missing before it was removed')
      } else await attempt(() => swarm.lent(id))
    }
    armed = false
    restart()
    await swarm.lend(id, 'final', null)
    const rows = (await db.prepare('select name, returned_at from hands where swarm = ?').bind(id).all<{ name: string; returned_at: number | null }>()).results
    const live = new Set(rows.filter((row) => row.returned_at === null).map((row) => row.name))
    const now = Date.now()
    for (const task of await swarm.board.tasks()) {
      if (task.labels?.['hands'] !== 'lent') continue
      const name = task.id.slice('hand:'.length)
      if (task.phase === 'claimed' && (task.untilMs ?? 0) > now && !live.has(name))
        fail('slot has row', name + ' holds a slot with no row ' + json(swarm.kv.get(Hand.key(name))))
      if ((task.phase === 'done' || task.phase === 'failed') && live.has(name)) fail('slot has row', name + ' has a live row but its task ended')
    }
    for (const name of listed) if (!live.has(name)) fail('no leak', name + ' is still at the gateway with no row')
    for (const name of removed) {
      if (listed.has(name)) fail('no leak', 'removed ' + name + ' is still at the gateway')
      if (rows.some((row) => row.name === name)) fail('removed gone', 'removed ' + name + ' still has a row')
      if (swarm.fleet().some((machine) => machine.name === name)) fail('removed gone', 'removed ' + name + ' is still a machine')
      const again = await swarm.unlend(id, name)
      if (again.ok || again.reason !== 'missing') fail('removed once', 'removing ' + name + ' again answered ' + json(again))
    }
    for (const name of maybe) {
      const gone = !listed.has(name) && !rows.some((row) => row.name === name) && !swarm.fleet().some((machine) => machine.name === name)
      const there = listed.has(name) && live.has(name)
      if (!gone && !there) fail('repaired', name + ', whose removal stopped half way, is neither removed nor lent')
    }
    for (const name of kept) if (!listed.has(name)) fail('kept', name + ', whose removal failed, was revoked anyway')
    for (const [name, count] of minted) if (count > 1) fail('minted once', name + ' minted ' + count + ' times')
    for (const raw of swarm.kv.list({ prefix: 'lent:' })) {
      const at = Hand.machine.read(raw[1])
      if (at && (at.state === 'issued' || at.state === 'revoking')) fail('repaired', raw[0] + ' left ' + at.state)
    }
  } finally {
    w.restore()
    restoreRandom()
  }
  return { steps, violations }
}

const counted = (sql: SqlStorage, query: string) => Number(sql.exec<{ n: number }>(query).one().n)

type Spawned = { agent_id: number; parent_agent_id: null; role: string; spent_usd: number; status: { output?: unknown; state: string }; task: string }

function subagents() {
  const subs: Spawned[] = []
  const keyed = new Map<string, Spawned>()
  let agents = 0
  const make = (args: { role: string; task: string }) => {
    const sub: Spawned = { agent_id: subs.length + 1, parent_agent_id: null, role: args.role, spent_usd: 0, status: { state: 'running' }, task: args.task }
    subs.push(sub)
    return sub
  }
  const route = async (request: Request, url: URL): Promise<Response | undefined> => {
    if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_d' + ++agents })
    const reported = /^\/v1\/agents\/agt_d\d+\/turns\/(.+)$/.exec(url.pathname)
    if (reported && request.method === 'GET')
      return Response.json({ ok: { message: '' }, request_id: decodeURIComponent(reported[1] ?? ''), spent_usd: 0.004, status: 'completed' })
    if (/^\/v1\/agents\/agt_d\d+\/turns$/.test(url.pathname) && request.method === 'POST') {
      const body = (await request.json()) as { prompt: string }
      if (body.prompt.startsWith('Pick the model for')) return Response.json({ request_id: 'p', status: 'queued' })
      make(JSON.parse(body.prompt.slice(body.prompt.indexOf('{'))) as { role: string; task: string })
      return Response.json({ request_id: 'x', status: 'queued' })
    }
    if (/^\/v1\/agents\/agt_d\d+\/subagents$/.test(url.pathname) && request.method === 'POST') {
      const body = (await request.json()) as { key: string; role: string; task: string }
      const known = keyed.get(body.key)
      if (known) return Response.json({ agent: known, created: false })
      const sub = make(body)
      keyed.set(body.key, sub)
      return Response.json({ agent: sub, created: true }, { status: 201 })
    }
    if (/^\/v1\/agents\/agt_d\d+\/subagents$/.test(url.pathname)) return Response.json({ agents: subs })
    const one = /^\/v1\/agents\/agt_d\d+\/subagents\/(\d+)\/(budget|close|messages)$/.exec(url.pathname)
    if (one) {
      const found = subs.find((sub) => sub.agent_id === Number(one[1]))
      if (!found) return Response.json({ error: 'no' }, { status: 404 })
      if (one[2] === 'budget') return Response.json({ agent: found })
      if (one[2] === 'messages') return Response.json({ disposition: 'queued' })
      if (!['completed', 'failed'].includes(found.status.state)) found.status = { ...found.status, state: 'closed' }
      return Response.json({ agents: subs })
    }
    if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '10', left: '10', spent: '0' })
    if (url.pathname === '/api/keys/me') return Response.json({ wallet: '0x' + 'e'.repeat(40) })
    return undefined
  }
  return { route, subs }
}

async function until(check: () => boolean | Promise<boolean>) {
  const end = performance.now() + limits.system.untilMs
  while (performance.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, limits.system.pollMs))
  }
  throw new Error('timed out')
}

async function refold(seed: string): Promise<Outcome> {
  const random = rng(seed, 'refold')
  const { fail, violations } = recorder()
  const restoreRandom = seeded(rng(seed, 'refold', 'ids'))
  const { Board } = await import('nanocode-ts')
  const { world } = await import('../run.ts')
  const Runner = await import('../../src/worker/Runner.ts')
  const Nodes = await import('../../src/worker/Nodes.ts')
  const Store = await import('../../src/worker/Store.ts')
  Object.assign(Runner.timing, limits.system.timing)
  const id = 'abc123abc123'
  const g = subagents()
  const w = world(g.route as Parameters<typeof world>[0])
  const children = random.int(2, 3)
  const at = random.int(0, children - 1)
  let cut = 0
  try {
    Object.assign(w.env, {
      GITHUB: { fetch: async (request: Request) => (request.method === 'GET' ? Response.json({ workflow_runs: [] }) : new Response(null, { status: 204 })) },
      SWARMS_GITHUB_TOKEN: 't',
    })
    await Store.insert(w.env, { creator: null, form: 'tree', goal: 'g', id, problem: null, setup: null, steering: 'open', title: 'Tree' })
    await w.swarm.plant({
      dispatcher: 'spawn',
      reviewed: false,
      root: { statement: null, title: 'Does P = NP?', words: 'The question.' },
      rules: 'rules',
      seed: [],
      settings: { ...Nodes.defaults, triageShare: 0 },
      setup: null,
      swarm: id,
    })
    const board = w.swarm.board
    const post = board.post
    board.post = async (task, options) => {
      if (task.labels?.['kind'] === 'node' && task.parent === 'n:root' && cut++ === at) throw new Board.LeaseLost('r:root:1')
      return post(task, options)
    }
    await w.swarm.treePledge(id, { amount: '5', contributor: '0x' + 'a'.repeat(40), hash: '0x' + '9'.repeat(64), nid: null })
    await until(() => g.subs.length === 1)
    const sub = g.subs[0] as Spawned
    sub.spent_usd = 1
    sub.status = {
      output: {
        children: Array.from({ length: children }, (_, n) => ({ needs: [], spec: 'S' + n + '.', statement: null, title: 'Lemma ' + n })),
        commit: null,
        outcome: 'split',
        summary: 'Split',
        theorem: null,
        why: null,
      },
      state: 'completed',
    }
    Runner.wake(w.swarm)
    await until(() => cut > at)
    await Runner.stop(w.swarm)
    w.swarm.runtime = undefined
    await Runner.tick(w.swarm)
    await until(async () => (await w.swarm.board.task('r:root:1'))?.phase === 'done')
    const sql = w.swarm.ctx.storage.sql
    const told = counted(sql, "SELECT COUNT(*) AS n FROM tree_deltas WHERE node = 'root' AND event = 'progress'")
    if (told !== 1) fail('told once', 'root progress told ' + told + ' times after the fold was cut at post ' + at)
    const posted = counted(sql, "SELECT COUNT(*) AS n FROM tree_deltas WHERE event = 'posted' AND node NOT IN ('root', 'triage')")
    if (posted !== children) fail('children posted', posted + ' of ' + children + ' children posted after the fold was cut at post ' + at)
    if (w.swarm.kv.get('quiet:root') !== undefined) fail('quiet count', 'a split counted root quiet')
  } catch (error) {
    fail('finished', 'cut at post ' + at + ': ' + String(error))
  } finally {
    await Runner.stop(w.swarm)
    w.restore()
    restoreRandom()
  }
  return { steps: cut, violations }
}

async function turnend(seed: string): Promise<Outcome> {
  const { fail, violations } = recorder()
  const restoreRandom = seeded(rng(seed, 'turnend', 'ids'))
  const { world } = await import('../run.ts')
  let report = { request_id: 'agt_1:1', status: 'running' } as Record<string, unknown>
  let hung = 0
  let wake = () => undefined as void
  const w = world(((_request: Request, url: URL) => {
    if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json(report)
    if (url.pathname === '/v1/kv/list' && report['status'] === 'completed' && hung++ === 0)
      return new Promise<Response>((resolve) => void (wake = () => resolve(Response.json({ error: 'gone' }, { status: 503 }))))
    return undefined
  }) as Parameters<typeof world>[0])
  let first: Promise<void> = Promise.resolve()
  try {
    await w.seed()
    await w.swarm.wake('money')
    await w.ring()
    if (w.swarm.run().state !== 'working') fail('finished', 'the run did not start: ' + w.swarm.run().state)
    report = { ok: { message: 'Did a step' }, request_id: 'agt_1:1', status: 'completed' }
    w.swarm.checked = 0
    first = w.swarm.alarm()
    await until(() => hung === 1)
    const Life = w.swarm.constructor as new (ctx: unknown, env: unknown) => Swarm
    const again = new Life(w.swarm.ctx, w.swarm.env)
    await again.alarm()
    if (again.run().state !== 'waiting') fail('finished', 'the restarted object left the run ' + again.run().state)
    const posted = counted(w.sql as unknown as SqlStorage, "SELECT COUNT(*) AS n FROM feed WHERE text LIKE 'Posted an update%'")
    if (posted !== 1) fail('posted once', 'the update was posted ' + posted + ' times')
    const told = counted(w.sql as unknown as SqlStorage, "SELECT COUNT(*) AS n FROM chat WHERE text LIKE 'Update:%'")
    if (told !== 1) fail('told once', 'the update was announced ' + told + ' times')
  } catch (error) {
    fail('finished', String(error))
  } finally {
    wake()
    await first
    w.restore()
    restoreRandom()
  }
  return { steps: hung, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  check,
  foldrun,
  lent: (seed) => lent(seed),
  lent_gateway: (seed) => lent(seed, false),
  node,
  refold,
  refusal,
  seen,
  turnend,
}

function patch<T extends object, K extends keyof T>(target: T, key: K, make: (was: T[K]) => T[K]) {
  return () => {
    const was = target[key]
    target[key] = make(was)
    return () => {
      target[key] = was
    }
  }
}

function flag<T extends Record<string, boolean>>(guards: T, key: keyof T) {
  return () => {
    guards[key] = false as T[keyof T]
    return () => {
      guards[key] = true as T[keyof T]
    }
  }
}

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: flag(Sub.guards, 'monotonic'), invariant: 'no regress', name: 'seen.monotonic', scenario: 'seen', seeds: ['1', '2', '3'] },
  {
    flip: patch(
      Tree.foldMachine,
      'step',
      (step) => (at, event) => (event.kind === 'tell' ? { ok: true, state: at ?? { state: 'told', v: Tree.version } } : step(at, event)),
    ),
    invariant: 'progress once',
    name: 'foldrun.tell',
    scenario: 'foldrun',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(Tree.foldMachine, 'step', (step) => (at, event) => (event.kind === 'check' && at?.checking ? { ok: true, state: at } : step(at, event))),
    invariant: 'checking once',
    name: 'foldrun.check',
    scenario: 'foldrun',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(Tree.foldMachine, 'read', (read) => (raw) => {
      const kept = read(raw)
      if (!kept) return kept
      const { fresh: _, ...rest } = kept
      return rest
    }),
    invariant: 'quiet count',
    name: 'foldrun.fresh',
    scenario: 'foldrun',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(
      Tree.foldMachine,
      'step',
      (step) => (at, event) => (event.kind === 'quiet' && at?.state === 'quieted' ? { ok: true, state: at } : step(at, event)),
    ),
    invariant: 'quiet count',
    name: 'foldrun.quiet',
    scenario: 'foldrun',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(Tree.foldMachine, 'settled', () => () => false),
    invariant: 'progress once',
    name: 'foldrun.settled',
    scenario: 'foldrun',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(Tree.checkMachine, 'step', (step) => (at, event) => (event.kind === 'expire' ? { ok: false, why: 'illegal' } : step(at, event))),
    invariant: 'deadline',
    name: 'check.expire',
    scenario: 'check',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(Tree.checkMachine, 'read', (read) => (raw) => {
      const kept = read(raw)
      return kept?.state === 'waiting' ? { ...kept, state: 'requested' } : kept
    }),
    invariant: 'ask once',
    name: 'check.restart',
    scenario: 'check',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(
      Tree.checkMachine,
      'step',
      (step) => (at, event) =>
        event.kind === 'came' && at && Tree.terminalCheck(at.state)
          ? { ok: true, state: { ...at, state: event.passed ? 'passed' : 'failed' } }
          : step(at, event),
    ),
    invariant: 'first outcome',
    name: 'check.first',
    scenario: 'check',
    seeds: ['1', '2', '3'],
  },
  { flip: patch(Hand.machine, 'unfinished', () => () => false), invariant: 'repaired', name: 'lent.unfinished', scenario: 'lent', seeds: ['2', '4', '5'] },
  {
    flip: patch(Hand.machine, 'step', (step) => (at, event) => (event.kind === 'kept' ? { ok: false, why: 'stale' } : step(at, event))),
    invariant: 'kept',
    name: 'lent.kept',
    scenario: 'lent',
    seeds: ['15', '16', '19'],
  },
  {
    flip: patch(Hand.machine, 'step', (step) => (at, event) => (event.kind === 'issue' ? { ok: false, why: 'illegal' } : step(at, event))),
    invariant: 'slot has row',
    name: 'lent.issue',
    scenario: 'lent',
    seeds: ['2', '7', '8'],
  },
  {
    flip: patch(Hand.machine, 'step', (step) => (at, event) => (event.kind === 'mint' && at?.state === 'minted' ? { ok: true, state: at } : step(at, event))),
    invariant: 'hand why',
    name: 'refusal.hand',
    scenario: 'refusal',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(Tree.foldMachine, 'step', (step) => (at, event) => (!at && event.kind === 'quiet' ? { ok: false, why: 'replayed' } : step(at, event))),
    invariant: 'fold why',
    name: 'refusal.fold',
    scenario: 'refusal',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(
      Tree.checkMachine,
      'step',
      (step) => (at, event) => (event.kind === 'came' && at && Tree.terminalCheck(at.state) ? { ok: false, why: 'replayed' } : step(at, event)),
    ),
    invariant: 'check why',
    name: 'refusal.check',
    scenario: 'refusal',
    seeds: ['1', '2', '3'],
  },
  {
    flip: patch(
      Tree.foldMachine,
      'step',
      (step) => (at, event) => (event.kind === 'tell' ? { ok: true, state: at ?? { state: 'told', v: Tree.version } } : step(at, event)),
    ),
    invariant: 'told once',
    name: 'refold.tell',
    scenario: 'refold',
    seeds: ['1', '2', '3'],
  },
  { flip: flag(Run.guards, 'once'), invariant: 'posted once', name: 'turnend.once', scenario: 'turnend', seeds: ['1', '2', '3'] },
]
