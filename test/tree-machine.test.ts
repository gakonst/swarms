import assert from 'node:assert/strict'
import test from 'node:test'
import * as Machine from '../src/worker/machines/Tree.ts'

class Crash extends Error {}

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function store() {
  const map = new Map<string, unknown>()
  const kv: Machine.Kv = {
    delete: (key) => map.delete(key),
    get: <T>(key: string) => (map.has(key) ? (structuredClone(map.get(key)) as T) : undefined),
    put: (key, value) => void map.set(key, structuredClone(value)),
  }
  return { kv, map }
}

const outcomes: Machine.Outcome[] = ['progress', 'proved', 'refuted', 'split', 'stuck']

type FoldWorld = { checks: Set<string>; emits: { checking: number; progress: number }; kv: Machine.Kv; nodes: Set<string> }

function foldCase(random: () => number) {
  const outcome = outcomes[Math.floor(random() * outcomes.length)] as Machine.Outcome
  const children = outcome === 'split' ? Math.floor(random() * 4) : 0
  const ids = Array.from({ length: children }, (_, index) => 'c' + index)
  const existing = ids.filter(() => random() < 0.3)
  const proof = (outcome === 'proved' || outcome === 'refuted') && random() < 0.8
  const quiet = Math.floor(random() * 3)
  const stuck = Math.floor(random() * 3)
  return { children, existing, ids, input: { children, outcome, proof, summary: 'did ' + outcome } satisfies Machine.FoldInput, quiet, stuck }
}

type Case = ReturnType<typeof foldCase>

function life(world: FoldWorld, c: Case, crashAt: number, machine: Machine.FoldMachine) {
  let steps = 0
  const step = async () => {
    await Promise.resolve()
    if (steps++ === crashAt) throw new Crash()
  }
  const io: Machine.FoldIo = {
    emit: (event) => void (world.emits[event] += 1),
    fresh: async () => {
      await step()
      return c.ids.filter((id) => !world.nodes.has(id))
    },
    kv: world.kv,
    node: 'n',
    post: async (index) => {
      await step()
      world.nodes.add(c.ids[index] as string)
      await step()
    },
    verify: async () => {
      await step()
      world.checks.add('v:n')
      await step()
      return 'Checking'
    },
  }
  return (async () => {
    const folded = await Machine.runFold(io, 'r:n:1', c.input, machine)
    await step()
    if (folded === 'folded') Machine.settle(world.kv, 'r:n:1', 'done')
  })()
}

function violations(world: FoldWorld, c: Case) {
  const found: string[] = []
  if (world.emits.progress !== 1) found.push('progress told ' + world.emits.progress + ' times')
  if (world.emits.checking !== (c.input.proof ? 1 : 0)) found.push('checking told ' + world.emits.checking + ' times')
  if (c.input.proof && !world.checks.has('v:n')) found.push('the check was not posted')
  for (const id of c.ids) if (!world.nodes.has(id)) found.push('child ' + id + ' not posted')
  const stuck = world.kv.get<number>('stuck:n')
  if (c.input.outcome === 'stuck' ? stuck !== c.stuck + 1 : stuck !== undefined) found.push('stuck counted as ' + stuck)
  const fresh = c.ids.filter((id) => !c.existing.includes(id)).length
  const reset = c.input.outcome === 'proved' || c.input.outcome === 'refuted' || fresh > 0
  const quiet = world.kv.get<number>('quiet:n')
  if (reset ? quiet !== undefined : quiet !== c.quiet + 1) found.push('quiet counted as ' + quiet)
  if (world.kv.get('folded:r:n:1') === undefined) found.push('never settled')
  if (world.kv.get('ran:r:n:1') !== undefined) found.push('fold record left behind')
  return found
}

async function simulate(seed: number, machine: Machine.FoldMachine = Machine.foldMachine) {
  const random = rng(seed)
  const c = foldCase(random)
  const bad: string[] = []
  for (let crashAt = -1; crashAt < 12; crashAt++) {
    const { kv } = store()
    if (c.quiet) kv.put('quiet:n', c.quiet)
    if (c.stuck) kv.put('stuck:n', c.stuck)
    const world: FoldWorld = { checks: new Set(), emits: { checking: 0, progress: 0 }, kv, nodes: new Set(c.existing) }
    let crashes = 0
    let at = crashAt
    for (;;) {
      try {
        await life(world, c, at, machine)
        break
      } catch (error) {
        if (!(error instanceof Crash)) throw error
        crashes += 1
        at = random() < 0.3 && crashes < 3 ? Math.floor(random() * 6) : -1
      }
    }
    await life(world, c, -1, machine)
    for (const one of violations(world, c)) bad.push('seed ' + seed + ' crash at ' + crashAt + ': ' + one)
  }
  return bad
}

async function sweep(machine: Machine.FoldMachine = Machine.foldMachine, seeds = 200) {
  const bad: string[] = []
  for (let seed = 1; seed <= seeds; seed++) bad.push(...(await simulate(seed, machine)))
  return bad
}

test('a run fold, crashed at every step and restarted on the same storage, then delivered again, tells and counts once and posts every child', async () => {
  assert.deepEqual(await sweep(), [])
})

test('the fold machine covers every transition and refuses replays', () => {
  const told = Machine.fold(undefined, { kind: 'tell' })
  assert.ok(told.ok)
  const checked = Machine.fold(told.state, { kind: 'check' })
  assert.ok(checked.ok)
  const split = Machine.fold(told.state, { fresh: ['a'], kind: 'split' })
  assert.ok(split.ok)
  assert.deepEqual(split.state.fresh, ['a'])
  const quieted = Machine.fold(split.state, { kind: 'quiet' })
  assert.ok(quieted.ok)
  assert.deepEqual(Machine.fold(undefined, { kind: 'quiet' }), { ok: false, why: 'illegal' })
  for (const event of [{ kind: 'tell' }, { kind: 'check' }, { fresh: [], kind: 'split' }, { kind: 'quiet' }] as Machine.FoldEvent[])
    assert.deepEqual(Machine.fold(quieted.state, event), { ok: false, why: 'replayed' })
  assert.deepEqual(Machine.fold(checked.state, { kind: 'check' }), { ok: false, why: 'replayed' })
})

test('a fold record an older object wrote reads as the same state, and the record an older object reads keeps its fields', () => {
  assert.equal(Machine.readFold({})?.state, 'told')
  assert.equal(Machine.readFold({ checking: true })?.state, 'checking')
  assert.deepEqual(Machine.readFold({ fresh: ['a'] }), { fresh: ['a'], state: 'splitting', v: 1 })
  assert.equal(Machine.readFold({ checking: true, quieted: true })?.state, 'quieted')
  const split = Machine.fold(Machine.fold(undefined, { kind: 'tell' }).ok ? Machine.readFold({}) : undefined, { fresh: ['x'], kind: 'split' })
  assert.ok(split.ok)
  assert.deepEqual(split.state.fresh, ['x'])
  const quieted = Machine.fold(split.state, { kind: 'quiet' })
  assert.ok(quieted.ok && quieted.state.quieted === true && quieted.state.fresh?.[0] === 'x')
})

const mutants: [string, Machine.FoldMachine][] = [
  ['tell is not refused on replay', { ...Machine.foldMachine, step: (at, event) => (event.kind === 'tell' ? { ok: true, state: at ?? { state: 'told', v: 1 } } : Machine.fold(at, event)) }],
  ['checking is not refused on replay', { ...Machine.foldMachine, step: (at, event) => (event.kind === 'check' && at?.checking ? { ok: true, state: at } : Machine.fold(at, event)) }],
  ['the fresh children are recomputed on each attempt', { ...Machine.foldMachine, read: (raw) => { const kept = Machine.readFold(raw); if (!kept) return kept; const { fresh: _, ...rest } = kept; return rest } }],
  ['quiet is not refused on replay', { ...Machine.foldMachine, step: (at, event) => (event.kind === 'quiet' && at?.state === 'quieted' ? { ok: true, state: at } : Machine.fold(at, event)) }],
  ['a settled run is folded again', { ...Machine.foldMachine, settled: () => false }],
]

for (const [name, machine] of mutants)
  test('mutant: ' + name + ' turns the fold simulation red', async () => {
    assert.notDeepEqual(await sweep(machine), [])
  })

type NodeModel = { open: string[]; state: Machine.NodeState; trail: Machine.NodeState[] }

function nodeEvents(random: () => number, model: NodeModel, k: number): Machine.NodeEvent {
  const pick = random()
  const run = 'r:n:' + (random() < 0.2 ? Math.max(1, k - 1) : k)
  const check = 'v:n:' + Math.floor(random() * 3)
  if (pick < 0.1) return { kind: 'post' }
  if (pick < 0.35) return { kind: 'start', run }
  if (pick < 0.55) return { kind: 'settle', run: model.state.kind === 'running' && random() < 0.7 ? model.state.run : run }
  if (pick < 0.7) return { check, kind: 'ask' }
  const asked = model.state.kind === 'checking' || model.state.kind === 'running' ? model.state.check : undefined
  if (pick < 0.85) return { check: asked !== undefined && random() < 0.7 ? asked : check, kind: 'checked' }
  if (pick < 0.93) return { check, kind: 'prove' }
  return { end: 'exhausted', kind: 'end' }
}

function nodeSim(seed: number, step: typeof Machine.node = Machine.node) {
  const random = rng(seed)
  const stored = { state: { kind: 'proposed' } as Machine.NodeState }
  const model: NodeModel = { open: [], state: stored.state, trail: [] }
  const seen = new Set<string>()
  const bad: string[] = []
  let k = 1
  let last: Machine.NodeEvent | undefined
  for (let i = 0; i < 60; i++) {
    if (random() < 0.15) model.state = structuredClone(stored.state)
    const event = last && random() < 0.2 ? last : nodeEvents(random, model, k)
    const before = model.state
    const stepped = step(before, event)
    if (stepped.ok) {
      seen.add(before.kind + (before.kind === 'running' && before.check ? '+check' : '') + '>' + event.kind)
      if (Machine.terminalNode(before)) bad.push('seed ' + seed + ': left terminal ' + before.kind + ' on ' + event.kind)
      if (event.kind === 'start') {
        model.open.push(event.run)
        k += 1
      }
      if (event.kind === 'settle') model.open = model.open.filter((one) => one !== event.run)
      if (event.kind === 'settle' && before.kind === 'running' && before.run !== event.run) bad.push('seed ' + seed + ': a stale settle of ' + event.run + ' was folded')
      model.state = stepped.state
      stored.state = stepped.state
    } else if (last === event && stepped.why === 'illegal' && Machine.terminalNode(before)) bad.push('seed ' + seed + ': a duplicate on a terminal node was not refused as replayed')
    if (model.open.length > 1) bad.push('seed ' + seed + ': ' + model.open.length + ' runs open at once')
    last = event
  }
  return { bad, seen }
}

test('a node, driven by seeded posts, runs, settles, checks, proofs and ends with duplicates, stale deliveries and restarts, keeps one open run and never leaves a terminal state', () => {
  const seen = new Set<string>()
  const bad: string[] = []
  for (let seed = 1; seed <= 500; seed++) {
    const ran = nodeSim(seed)
    bad.push(...ran.bad)
    for (const one of ran.seen) seen.add(one)
  }
  assert.deepEqual(bad, [])
  for (const want of ['proposed>post', 'open>start', 'running>settle', 'running+check>settle', 'running+check>checked', 'open>ask', 'running>ask', 'checking>checked', 'checking>ask', 'open>prove', 'running>prove', 'checking>prove', 'open>end', 'running>end', 'checking>end'])
    assert.ok(seen.has(want), 'transition ' + want + ' was never taken')
})

const nodeMutants: [string, typeof Machine.node][] = [
  ['a run starts while another is open', (at, event) => (event.kind === 'start' && at.kind === 'running' ? { ok: true, state: { kind: 'running', run: event.run } } : Machine.node(at, event))],
  ['a terminal node takes a transition', (at, event) => (Machine.terminalNode(at) && event.kind === 'settle' ? { ok: true, state: { kind: 'open' } } : Machine.node(at, event))],
  ['a stale settle is folded', (at, event) => (event.kind === 'settle' && at.kind === 'running' ? { ok: true, state: { kind: 'open' } } : Machine.node(at, event))],
]

for (const [name, step] of nodeMutants)
  test('mutant: ' + name + ' turns the node simulation red', () => {
    const bad: string[] = []
    for (let seed = 1; seed <= 500; seed++) bad.push(...nodeSim(seed, step).bad)
    assert.notDeepEqual(bad, [])
  })

type Verdict = { failed: string } | { passed: number }

async function checkSim(seed: number, machine: Machine.CheckMachine = Machine.checkMachine) {
  const random = rng(seed)
  const { kv } = store()
  const key = 'check:v:n:abc'
  const outKey = 'verified:v:n:abc'
  const limits = { pollMs: 10, waitMs: 100 }
  let now = 0
  let requests = 0
  let requestsWhileWaiting = 0
  let waits = 0
  const arrives = random() < 0.25 ? Infinity : Math.floor(random() * 150)
  const first: Verdict = random() < 0.5 ? { passed: 1 } : { failed: 'log' }
  const second: Verdict = 'passed' in first ? { failed: 'late' } : { passed: 2 }
  let delivered = 0
  const bad: string[] = []
  const deliver = (verdict: Verdict) => {
    if (Machine.came(kv, key, 'abc', 'passed' in verdict, now, machine).ok) kv.put(outKey, verdict)
  }
  const crashes = new Set(Array.from({ length: 3 }, () => Math.floor(random() * 8)))
  let steps = 0
  const io: Machine.CheckIo<Verdict> = {
    kv,
    now: () => now,
    outcome: () => kv.get<Verdict>(outKey),
    request: async () => {
      requests += 1
      if (machine.read(kv.get(key))?.state === 'waiting') requestsWhileWaiting += 1
      if (crashes.has(steps++)) throw new Crash()
      return { ok: true }
    },
    wait: async (ms) => {
      waits += 1
      if (waits > 1000) throw new Error('hung')
      now += ms
      while (now >= arrives && delivered < 3) {
        deliver(delivered === 1 ? second : first)
        delivered += 1
      }
      if (crashes.has(steps++)) throw new Crash()
    },
  }
  let result: Machine.Waited<Verdict> | undefined
  let lives = 0
  while (!result && lives++ < 10) {
    try {
      const before = machine.read(kv.get(key))
      if (before?.state === 'waiting' || before?.state === 'expired') {
        const counted = requests
        result = await Machine.waitCheck(io, key, 'abc', limits, machine)
        if (requests !== counted) requestsWhileWaiting += 1
      } else result = await Machine.waitCheck(io, key, 'abc', limits, machine)
    } catch (error) {
      if (error instanceof Error && error.message === 'hung') {
        bad.push('seed ' + seed + ': the wait never ended')
        break
      }
      if (!(error instanceof Crash)) throw error
    }
  }
  if (!result && !bad.length) bad.push('seed ' + seed + ': no result after ' + lives + ' lives')
  if (requestsWhileWaiting) bad.push('seed ' + seed + ': the verifier was asked again while a check waited')
  if (result?.kind === 'came' && JSON.stringify(result.outcome) !== JSON.stringify(first)) bad.push('seed ' + seed + ': a later outcome replaced the first')
  if (result?.kind === 'expired' && arrives <= limits.waitMs - limits.pollMs) bad.push('seed ' + seed + ': expired although the outcome came in time')
  if (result?.kind === 'expired') {
    deliver(first)
    if (kv.get(outKey) !== undefined && arrives === Infinity) bad.push('seed ' + seed + ': an outcome after expiry was taken')
  }
  if (now > limits.waitMs * 3) bad.push('seed ' + seed + ': waited past the deadline until ' + now)
  return bad
}

async function checkSweep(machine: Machine.CheckMachine = Machine.checkMachine) {
  const bad: string[] = []
  for (let seed = 1; seed <= 400; seed++) bad.push(...(await checkSim(seed, machine)))
  return bad
}

test('a Lean check, with its callback late, never, duplicated or contradicted, and crashed at every step, asks once, takes the first outcome and expires at its deadline', async () => {
  assert.deepEqual(await checkSweep(), [])
})

test('the check machine covers every transition and refuses stale and replayed ones', () => {
  const asked = Machine.check(undefined, { at: 0, kind: 'ask', sha: 'a' })
  assert.ok(asked.ok && asked.state.state === 'requested')
  assert.deepEqual(Machine.check(asked.state, { at: 0, kind: 'ask', sha: 'a' }), { ok: false, why: 'replayed' })
  const waiting = Machine.check(asked.state, { at: 1, deadline: 10, kind: 'asked' })
  assert.ok(waiting.ok && waiting.state.state === 'waiting')
  assert.deepEqual(Machine.check(waiting.state, { at: 5, kind: 'expire' }), { ok: false, why: 'illegal' })
  const expired = Machine.check(waiting.state, { at: 10, kind: 'expire' })
  assert.ok(expired.ok && expired.state.state === 'expired')
  assert.deepEqual(Machine.check(expired.state, { at: 11, kind: 'came', passed: true }), { ok: false, why: 'stale' })
  const passed = Machine.check(waiting.state, { at: 3, kind: 'came', passed: true })
  assert.ok(passed.ok && passed.state.state === 'passed')
  assert.deepEqual(Machine.check(passed.state, { at: 4, kind: 'came', passed: false }), { ok: false, why: 'stale' })
  const failed = Machine.check(asked.state, { at: 3, kind: 'came', passed: false })
  assert.ok(failed.ok && failed.state.state === 'failed')
  const legacy = Machine.check(undefined, { at: 3, kind: 'came', passed: true })
  assert.ok(legacy.ok && legacy.state.state === 'passed')
  assert.equal(Machine.readCheck({ state: 'waiting' }), undefined)
})

const checkMutants: [string, Machine.CheckMachine][] = [
  ['a wait has no deadline', { ...Machine.checkMachine, step: (at, event) => (event.kind === 'expire' ? { ok: false, why: 'illegal' } : Machine.check(at, event)) }],
  ['a restart asks the verifier again', { ...Machine.checkMachine, read: (raw) => { const kept = Machine.readCheck(raw); return kept?.state === 'waiting' ? { ...kept, state: 'requested' } : kept } }],
  ['a later outcome replaces the first', { ...Machine.checkMachine, step: (at, event) => (event.kind === 'came' && at && Machine.terminalCheck(at.state) ? { ok: true, state: { ...at, state: event.passed ? 'passed' : 'failed' } } : Machine.check(at, event)) }],
]

for (const [name, machine] of checkMutants)
  test('mutant: ' + name + ' turns the check simulation red', async () => {
    assert.notDeepEqual(await checkSweep(machine), [])
  })
