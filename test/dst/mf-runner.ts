import { createHash } from 'node:crypto'
import type * as DispatchModule from '../dispatch.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  busy: { lemmasLeast: 2, lemmasMost: 4, pollMs: 600_000, untilMs: 2_000 },
  check: { amountMost: 9, extraMs: 600_000, statement: 'theorem P : True := trivial' },
  end: { amountMost: 5 },
  money: { cent: 10_000n, cents: 100, places: 6, unit: 1_000_000n },
  pick: { fuzz: 300, harnesses: ['claude', 'codex'], sideUsd: 0.002, turnUsd: 0.004 },
  refold: { refusalsMost: 2 },
  ride: { amountLeast: 1, amountMost: 20, childrenMost: 3, startingMost: 3, stepLeast: 2, stepMost: 8 },
  steer: { amountMost: 9, notesMost: 3, settleMs: 100 },
  stream: { deltasLeast: 5, deltasMost: 25, gapMostMs: 8, lockedMost: 1, quietMs: 600_000, untilMs: 3_000 },
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

function seeded(random: Rng) {
  const saved = { error: console.error, random: Math.random, uuid: crypto.randomUUID.bind(crypto) }
  Math.random = () => random.next()
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () => random.int(0, 15).toString(16)).join('')
    return (hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-4' + hex.slice(13, 16) + '-a' + hex.slice(17, 20) + '-' + hex.slice(20, 32)) as ReturnType<
      Crypto['randomUUID']
    >
  }
  console.error = () => undefined
  return () => {
    Math.random = saved.random
    crypto.randomUUID = saved.uuid
    console.error = saved.error
  }
}

const mutants = {
  ask: false,
  bound: false,
  cap: false,
  claims: false,
  drop: false,
  expire: false,
  first: false,
  forgot: false,
  halt: false,
  harness: false,
  heard: false,
  kick: false,
  needs: false,
  patience: false,
  relay: false,
  topped: false,
}

function mutant(key: keyof typeof mutants) {
  return () => {
    mutants[key] = true
    return () => void (mutants[key] = false)
  }
}

async function armed() {
  await import('../run.ts')
  const Runner = await import('../../src/worker/Runner.ts')
  const Nodes = await import('../../src/worker/Nodes.ts')
  const Machine = await import('../../src/worker/machines/Tree.ts')
  const Setup = await import('../../src/shared/Setup.ts')
  const undo: (() => void)[] = []
  const set = <T extends object, K extends keyof T>(target: T, key: K, value: T[K]) => {
    const was = target[key]
    target[key] = value
    undo.push(() => void (target[key] = was))
  }
  for (const key of ['bound', 'claims', 'halt', 'heard', 'kick', 'needs', 'relay', 'topped'] as const) if (mutants[key]) set(Runner.guards, key, false)
  if (mutants.patience) set(Runner.timing, 'spawnMs', 0)
  if (mutants.cap) set(Nodes.defaults, 'runCap', Nodes.defaults.runMin)
  if (mutants.harness) {
    const harnesses = Setup.harnesses as unknown as string[]
    harnesses.push('cursor')
    undo.push(() => void harnesses.pop())
  }
  if (mutants.forgot) {
    set(Runner.guards, 'folded', false)
    set(Machine.foldMachine, 'settled', () => false)
  }
  const step = Machine.checkMachine.step
  const read = Machine.checkMachine.read
  if (mutants.ask)
    set(Machine.checkMachine, 'read', (raw) => {
      const kept = read(raw)
      return kept?.state === 'waiting' ? { ...kept, state: 'requested' } : kept
    })
  if (mutants.expire) set(Machine.checkMachine, 'step', (at, event) => (event.kind === 'expire' ? { ok: false, why: 'illegal' } : step(at, event)))
  if (mutants.first)
    set(Machine.checkMachine, 'step', (at, event) =>
      event.kind === 'came' && at && Machine.terminalCheck(at.state)
        ? { ok: true, state: { ...at, state: event.passed ? 'passed' : 'failed' } }
        : step(at, event),
    )
  if (mutants.drop) set(Machine.checkMachine, 'step', (at, event) => (event.kind === 'came' && event.passed ? { ok: false, why: 'stale' } : step(at, event)))
  return () => {
    for (const one of undo.reverse()) one()
  }
}

function usd(micros: bigint) {
  const sign = micros < 0n ? '-' : ''
  const abs = micros < 0n ? -micros : micros
  return sign + String(abs / limits.money.unit) + '.' + String(abs % limits.money.unit).padStart(limits.money.places, '0')
}

function units(whole: number) {
  return BigInt(whole) * limits.money.unit
}

function dollars(micros: bigint) {
  return Number(micros) / Number(limits.money.unit)
}

async function runKey(run: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(run)))
  return 'run-' + [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

type World = Awaited<ReturnType<typeof DispatchModule.planted>>

async function plant(D: typeof DispatchModule, route: Parameters<typeof D.planted>[0], settings: Record<string, unknown>, statement: string | null = null) {
  const { world } = await import('../run.ts')
  const Store = await import('../../src/worker/Store.ts')
  const Nodes = await import('../../src/worker/Nodes.ts')
  const w = world(route)
  D.github(w.env)
  await Store.insert(w.env, { creator: null, form: 'tree', goal: 'g', id: D.id, problem: null, setup: null, steering: 'open', title: 'Tree' })
  await w.swarm.plant({
    dispatcher: 'spawn',
    reviewed: false,
    rules: 'rules',
    root: { statement, title: 'Does P = NP?', words: 'The question.' },
    seed: [],
    settings: { ...Nodes.defaults, triageShare: 0, ...settings },
    setup: null,
    swarm: D.id,
  })
  return w
}

function waiter(D: typeof DispatchModule, fail: (invariant: string, detail: string) => void) {
  return async (invariant: string, detail: string, check: () => boolean | Promise<boolean>, ms?: number) => {
    try {
      await D.until(check, ms)
      return true
    } catch {
      fail(invariant, detail + ' did not happen in time')
      return false
    }
  }
}

function hash(random: Rng) {
  return '0x' + Array.from({ length: 64 }, () => random.int(0, 15).toString(16)).join('')
}

async function scenario(
  seed: string,
  name: string,
  body: (random: Rng, fail: (invariant: string, detail: string) => void, D: typeof DispatchModule) => Promise<{ steps: number; w?: World | undefined }>,
): Promise<Outcome> {
  const random = rng(seed, name)
  const { fail, violations } = recorder()
  const unseed = seeded(rng(seed, name, 'ids'))
  const disarm = await armed()
  const D = await import('../dispatch.ts')
  const Runner = await import('../../src/worker/Runner.ts')
  const timing = { ...Runner.timing }
  let steps = 0
  const held: { w?: World | undefined } = {}
  try {
    const done = await body(random, fail, D)
    steps = done.steps
    held.w = done.w
  } catch (error) {
    fail('finished', String((error as Error)?.stack ?? error).slice(0, 400))
  } finally {
    disarm()
    Object.assign(Runner.timing, timing)
    unseed()
  }
  return { steps, violations }
}

async function ride(seed: string): Promise<Outcome> {
  return scenario(seed, 'ride', async (random, fail, D) => {
    const Runner = await import('../../src/worker/Runner.ts')
    const Flow = await import('../../src/worker/Flow.ts')
    const L = limits.ride
    const mode = random.pick(['route', 'missing', 'starting', 'fresh'] as const)
    const starting = mode === 'starting' ? random.int(1, L.startingMost) : 0
    const step = random.int(L.stepLeast, L.stepMost)
    const amount = random.int(L.amountLeast, L.amountMost)
    const bound = units(Math.min(step, amount))
    const g = D.gateway()
    g.state.spawnRoute = mode !== 'missing'
    g.state.starting = starting
    g.state.fresh = mode === 'fresh'
    const w = await plant(D, g.route as never, { runStep: usd(units(step)) })
    const wait = waiter(D, fail)
    const told = mode + ' with step ' + step + ' and pledge ' + amount
    try {
      await w.swarm.treePledge(D.id, { amount: String(amount), contributor: D.ana, hash: hash(random), nid: null })
      const fallback = mode === 'missing' || mode === 'fresh'
      const turn = fallback ? BigInt(Math.round(limits.pick.turnUsd * Number(limits.money.unit))) : 0n
      if (!(await wait('spawn once', told + ': the first run', () => g.subs.length === 1 && (!fallback || g.budgets.length === 1)))) return { steps: 1, w }
      const key = await runKey('r:root:1')
      if (g.subs[0]?.role !== 'n:root#1') fail('spawn once', told + ': spawned role ' + g.subs[0]?.role)
      if (fallback) {
        if (g.prompts.length !== 1 || g.spawned.length !== 0)
          fail('spawn once', told + ': ' + g.prompts.length + ' prompts and ' + g.spawned.length + ' spawn calls')
        if (JSON.stringify(g.budgets) !== JSON.stringify([[1, dollars(bound - turn)]]))
          fail('spawn bound', told + ': budgets set ' + JSON.stringify(g.budgets) + ', not ' + dollars(bound - turn))
      } else {
        if (g.spawned.length !== starting + 1) fail('spawn once', told + ': ' + g.spawned.length + ' spawn calls for ' + starting + ' starting answers')
        const keys = new Set(g.spawned.map((body) => body['key']))
        if (keys.size !== 1 || !keys.has(key)) fail('spawn once', told + ': spawn keys ' + JSON.stringify([...keys]) + ', not the run key')
        if (g.prompts.length !== 0) fail('spawn once', told + ': ' + g.prompts.length + ' prompts')
        if (g.spawned[0]?.['budget_usd'] !== dollars(bound)) fail('spawn bound', told + ': spawned with bound ' + String(g.spawned[0]?.['budget_usd']))
        if (g.budgets.length !== 0) fail('spawn bound', told + ': the bound was set again after the spawn ' + JSON.stringify(g.budgets))
      }
      if (g.subs[0]?.budget_usd !== dollars(bound - turn)) fail('spawn bound', told + ': the subagent holds ' + g.subs[0]?.budget_usd)
      let view = await w.swarm.treeRead(D.id, { depth: 3, root: 'root', status: undefined })
      const root = view.ok ? view.value.nodes.find((node) => node.id === 'root') : undefined
      if (root?.status !== 'in flight' || root.money.committed !== usd(bound) || root.money.left !== usd(units(amount) - bound))
        fail('money', told + ': root shows ' + JSON.stringify({ committed: root?.money.committed, left: root?.money.left, status: root?.status }))
      const cents = random.int(0, Number((bound - turn) / limits.money.cent))
      const spent = BigInt(cents) * limits.money.cent + turn
      const count = random.int(0, L.childrenMost)
      const children = Array.from({ length: count }, (_, i) => ({
        needs: i > 0 && random.chance(0.5) ? ['Lemma ' + (i - 1)] : [],
        spec: 'Part ' + i + '.',
        statement: random.chance(0.5) ? 'True' : null,
        title: 'Lemma ' + i,
      }))
      const sub = g.subs[0] as DispatchModule.Sub
      sub.spent_usd = cents / limits.money.cents
      sub.status = {
        output: { children, commit: null, outcome: count ? 'split' : 'progress', summary: 'Worked', theorem: null, why: null },
        state: 'completed',
      }
      Runner.wake(w.swarm)
      const fold = told + ' then ' + count + ' children'
      if (!(await wait(count ? 'split' : 'money', fold + ': the fold', async () => (await w.swarm.board.task('r:root:1'))?.phase === 'done')))
        return { steps: 2, w }
      if (
        count &&
        !(await wait('split', fold + ': children posted', async () => {
          const shown = await w.swarm.treeRead(D.id, { depth: 3, root: 'root', status: undefined })
          return shown.ok && shown.value.nodes.filter((node) => node.title.startsWith('Lemma ')).length === count
        }))
      )
        return { steps: 3, w }
      await wait('money', fold + ': root spend shown', async () => {
        const shown = await w.swarm.treeRead(D.id, { depth: 1, root: 'root', status: undefined })
        return shown.ok && shown.value.nodes[0]?.money.spent === usd(spent)
      })
      view = await w.swarm.treeRead(D.id, { depth: 3, root: 'root', status: undefined })
      const nodes = view.ok ? view.value.nodes : []
      const ids = new Map(nodes.map((node) => [node.title, node.id]))
      for (const child of children) {
        const node = nodes.find((one) => one.title === child.title)
        const want = child.needs.map((need) => ids.get(need))
        if (!node || node.by.agent !== 'agent:n:root' || JSON.stringify(node.needs) !== JSON.stringify(want))
          fail('split', fold + ': ' + child.title + ' posted as ' + JSON.stringify(node && { by: node.by, needs: node.needs }))
      }
      const free = children.filter((child) => !child.needs.length).map((child) => 'n:' + ids.get(child.title) + '#1')
      if (count && units(amount) - spent >= units(step)) {
        if (await wait('split', fold + ': a child run', () => g.subs.length >= 2)) {
          const roles = g.subs.slice(1).map((one) => one.role)
          if (roles.some((role) => !free.includes(role)))
            fail('split', fold + ': spawned ' + JSON.stringify(roles) + ' while only ' + JSON.stringify(free) + ' were free to start')
        }
      }
      const totals = Flow.totals(await Flow.rows(w.env, D.id))
      if (totals.held !== totals.pledged - totals.spent || totals.spent !== spent)
        fail(
          'money',
          fold + ': ledger ' + JSON.stringify({ held: String(totals.held), pledged: String(totals.pledged), spent: String(totals.spent), want: String(spent) }),
        )
      return { steps: 4 + count, w }
    } finally {
      await Runner.stop(w.swarm)
      w.restore()
    }
  })
}

async function check(seed: string): Promise<Outcome> {
  return scenario(seed, 'check', async (random, fail, D) => {
    const Runner = await import('../../src/worker/Runner.ts')
    const Nodes = await import('../../src/worker/Nodes.ts')
    const C = limits.check
    const path = random.pick(['run', 'direct'] as const)
    const first = path === 'direct' && random.chance(0.5)
    const restart = random.chance(0.5)
    const verdict = random.pick(['pass', 'pass', 'fail', 'never'] as const)
    const twice = verdict !== 'never' && random.chance(0.5)
    const sha = Array.from({ length: 40 }, () => random.int(0, 15).toString(16)).join('')
    const vid = Nodes.verifyId('root', sha)
    const told = path + (first ? ' first' : '') + (restart ? ' restart' : '') + ' ' + verdict + (twice ? ' twice' : '')
    const g = D.gateway()
    const w = await D.planted(g.route as never, 0, C.statement)
    const wait = waiter(D, fail)
    let dispatched = 0
    const github = (w.env as unknown as { GITHUB: { fetch: (request: Request) => Promise<Response> } }).GITHUB
    const inner = github.fetch
    github.fetch = async (request) => {
      if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/dispatches')) dispatched += 1
      return inner(request)
    }
    const passed = async () => D.proof(sha, await Nodes.stmt(C.statement))
    const amount = random.int(1, C.amountMost)
    let spent = 0n
    try {
      if (path === 'run') {
        await w.swarm.treePledge(D.id, { amount: String(amount), contributor: D.ana, hash: hash(random), nid: null })
        if (!(await wait('proven', told + ': the run', () => g.subs.length === 1))) return { steps: 1, w }
        const cents = random.int(0, Math.min(amount, Number(Nodes.defaults.runStep.split('.')[0])) * limits.money.cents)
        spent = BigInt(cents) * limits.money.cent
        const sub = g.subs[0] as DispatchModule.Sub
        sub.spent_usd = cents / limits.money.cents
        sub.status = {
          output: JSON.stringify({ children: [], commit: sha, outcome: 'proved', summary: 'Done', theorem: 'Pnp.Nroot', why: null }),
          state: 'completed',
        }
        Runner.wake(w.swarm)
      } else {
        const runtime = Runner.runtime(w.swarm)
        if (first) runtime.first = true
        await Runner.postVerify(w.swarm, 'root', sha, 'Pnp.Nroot', false)
        if (first) {
          if (!(await wait('claim kept', told + ': the claim', async () => (await w.swarm.board.task(vid))?.phase === 'claimed'))) return { steps: 1, w }
          const claim = (await w.swarm.board.task(vid))?.claim
          if (!claim || !runtime.claims.has(claim)) fail('claim kept', told + ': the pool did not hold its claim')
          await Runner.tick(w.swarm)
          const after = await w.swarm.board.task(vid)
          if (after?.phase !== 'claimed' || after.claim !== claim)
            fail('claim kept', told + ': the first tick left the check ' + after?.phase + ' under ' + after?.claim)
        }
      }
      if (!(await wait('ask once', told + ': the check waiting', () => w.swarm.kv.get<{ state: string }>(Runner.checkKey(vid))?.state === 'waiting')))
        return { steps: 2, w }
      if (path === 'run') {
        const view = await w.swarm.treeRead(D.id, { depth: 1, root: 'root', status: undefined })
        if (!view.ok || view.value.nodes[0]?.status !== 'in flight' || !view.value.nodes[0]?.run?.checking)
          fail('proven', told + ': the node is not shown checking')
      }
      if (restart) {
        await Runner.stop(w.swarm)
        w.swarm.runtime = undefined
        await Runner.tick(w.swarm)
        if (!(await wait('ask once', told + ': the check claimed again', async () => (await w.swarm.board.task(vid))?.phase === 'claimed')))
          return { steps: 3, w }
      }
      if (verdict === 'never') {
        w.pass(Runner.timing.checkMs + random.int(0, C.extraMs))
        Runner.wake(w.swarm)
        if (!(await wait('deadline', told + ': expiry', async () => (await w.swarm.board.task(vid))?.phase === 'failed'))) return { steps: 4, w }
        const state = w.swarm.kv.get<{ state: string }>(Runner.checkKey(vid))?.state
        if (state !== 'expired') fail('deadline', told + ': the check ended ' + state)
        const steers = (await w.swarm.board.steers('n:root')).filter((one) => one.body.includes('did not come back')).length
        if (steers !== 1) fail('deadline', told + ': the node was told ' + steers + ' times')
        await Runner.verified(w.swarm, 'root', sha, await passed())
        if (w.swarm.kv.get('verified:' + vid) !== undefined) fail('deadline', told + ': a result after expiry was taken')
        if ((await w.swarm.board.task('n:root'))?.phase === 'done') fail('deadline', told + ': a result after expiry proved the node')
      } else if (verdict === 'pass') {
        if (random.chance(0.5)) await w.swarm.treeVerified(D.id, 'root', sha, await passed())
        else await Runner.verified(w.swarm, 'root', sha, await passed())
        if (twice) await Runner.verified(w.swarm, 'root', sha, { failed: 'a later, different answer' })
        if (!(await wait('proven', told + ': the node proven', async () => (await w.swarm.board.task('n:root'))?.phase === 'done'))) return { steps: 4, w }
        const kept = w.swarm.kv.get<{ commit?: string }>('verified:' + vid)
        if (kept?.commit !== sha) fail('first outcome', told + ': kept ' + JSON.stringify(kept).slice(0, 120))
        const view = await w.swarm.treeRead(D.id, { depth: 1, root: 'root', status: undefined })
        const node = view.ok ? view.value.nodes[0] : undefined
        if (node?.status !== 'proven' || node.proof?.commit !== sha || (view.ok && view.value.headline.proven !== 1))
          fail('proven', told + ': root shows ' + node?.status + ' with proof ' + node?.proof?.commit)
        const proofs = await w.swarm.treeProofs(D.id)
        if (proofs.proofs[0]?.node !== 'root') fail('proven', told + ': proofs list ' + JSON.stringify(proofs.proofs.map((one) => one.node)))
        if (path === 'run') {
          const standing = await w.swarm.treeStanding(D.id, D.ana)
          if (standing.free !== usd(units(amount) - spent) || standing.spent !== usd(spent))
            fail('proven', told + ': standing ' + standing.free + ' free and ' + standing.spent + ' spent of ' + amount + ' with ' + usd(spent) + ' spent')
        }
      } else {
        await Runner.verified(w.swarm, 'root', sha, { failed: 'the proof does not check' })
        if (twice) await Runner.verified(w.swarm, 'root', sha, await passed())
        if (!(await wait('first outcome', told + ': the check failed', async () => (await w.swarm.board.task(vid))?.phase === 'failed'))) return { steps: 4, w }
        const kept = w.swarm.kv.get<{ failed?: string }>('verified:' + vid)
        if (kept?.failed !== 'the proof does not check') fail('first outcome', told + ': kept ' + JSON.stringify(kept).slice(0, 120))
        if ((await w.swarm.board.task('n:root'))?.phase === 'done') fail('first outcome', told + ': a later pass proved the node')
      }
      if (dispatched !== 1) fail('ask once', told + ': the verifier was asked ' + dispatched + ' times')
      return { steps: 5, w }
    } finally {
      await Runner.stop(w.swarm)
      w.restore()
    }
  })
}

async function steer(seed: string): Promise<Outcome> {
  return scenario(seed, 'steer', async (random, fail, D) => {
    const Runner = await import('../../src/worker/Runner.ts')
    const S = limits.steer
    const g = D.gateway()
    const w = await D.planted(g.route as never)
    const wait = waiter(D, fail)
    try {
      await w.swarm.treePledge(D.id, { amount: String(random.int(1, S.amountMost)), contributor: D.bo, hash: hash(random), nid: null })
      if (!(await wait('steer', 'the run', () => g.subs.length === 1))) return { steps: 1, w }
      const notes = Array.from({ length: random.int(1, S.notesMost) }, (_, i) => 'Try idea ' + i + ' ' + random.int(0, 999))
      for (const note of notes) {
        if (random.chance(0.5)) {
          const refused = await w.swarm.treeSteer(D.id, { amount: '0', contributor: D.ana, nid: 'root', note: 'Mine' })
          if (refused.ok || refused.status !== 403) fail('steer', 'a rider with nothing behind the node steered it: ' + JSON.stringify(refused).slice(0, 120))
        }
        const steered = await w.swarm.treeSteer(D.id, { amount: '0', contributor: D.bo, nid: 'root', note })
        if (!steered.ok) fail('steer', 'the backer was refused: ' + JSON.stringify(steered).slice(0, 120))
      }
      if (!(await wait('steer', notes.length + ' notes relayed', () => (g.subs[0]?.messages.length ?? 0) >= notes.length))) return { steps: 2, w }
      await new Promise((resolve) => setTimeout(resolve, S.settleMs))
      const messages = g.subs[0]?.messages ?? []
      if (messages.length !== notes.length) fail('steer', notes.length + ' notes reached the subagent ' + messages.length + ' times')
      notes.forEach((note, i) => {
        if (!messages[i]?.includes('behind this, from @') || !messages[i]?.endsWith('] ' + note))
          fail('steer', 'note ' + i + ' reached the subagent as ' + messages[i])
      })
      const told = Number(
        w.swarm.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM tree_deltas WHERE node = 'root' AND event = 'steered'").one().n,
      )
      if (told !== notes.length) fail('steer', 'steered told ' + told + ' times for ' + notes.length + ' notes')
      return { steps: 2 + notes.length, w }
    } finally {
      await Runner.stop(w.swarm)
      w.restore()
    }
  })
}

async function end(seed: string): Promise<Outcome> {
  return scenario(seed, 'end', async (random, fail, D) => {
    const Runner = await import('../../src/worker/Runner.ts')
    const Nodes = await import('../../src/worker/Nodes.ts')
    const Flow = await import('../../src/worker/Flow.ts')
    const g = D.gateway()
    const w = await D.planted(g.route as never)
    const wait = waiter(D, fail)
    const amount = random.int(1, limits.end.amountMost)
    try {
      const program = await Nodes.post(w.swarm, { by: 'seed', form: 'program', needs: [], parent: 'root', statement: null, title: 'Lower bounds', words: '' })
      const lemma = await Nodes.post(w.swarm, {
        by: 'agent:n:' + program.nid,
        form: 'lemma',
        needs: [],
        parent: program.nid,
        statement: 'True',
        title: 'Switching lemma',
        words: '',
      })
      const told = 'pledge ' + amount
      await w.swarm.treePledge(D.id, { amount: String(amount), contributor: D.ana, hash: hash(random), nid: program.nid })
      if (!(await wait('end cascade', told + ': the lemma run', () => g.subs.length === 1))) return { steps: 1, w }
      if (g.subs[0]?.role !== 'n:' + lemma.nid + '#1') fail('end cascade', told + ': spawned ' + g.subs[0]?.role)
      const inherited = Flow.fold(await Flow.rows(w.env, D.id)).inherited.get(lemma.nid)
      if (inherited !== units(amount)) fail('end cascade', told + ': the lemma inherited ' + String(inherited))
      const bound = units(Math.min(amount, Number(Nodes.defaults.runStep.split('.')[0])))
      const cents = random.int(0, Number(bound / limits.money.cent))
      const spent = BigInt(cents) * limits.money.cent
      ;(g.subs[0] as DispatchModule.Sub).spent_usd = cents / limits.money.cents
      const ended = await w.swarm.treeEnd(D.id, { admin: false, contributor: D.ana, nid: program.nid, why: 'Barrier' })
      if (!ended.ok || ended.value.status !== 'dead end') fail('end cascade', told + ': ending answered ' + JSON.stringify(ended).slice(0, 160))
      if (g.subs[0]?.status.state !== 'closed') fail('end cascade', told + ': the lemma run was left ' + g.subs[0]?.status.state)
      const ledger = Flow.fold(await Flow.rows(w.env, D.id))
      const left = { free: ledger.left.get('') ?? 0n, lemma: ledger.left.get(lemma.nid) ?? 0n, program: ledger.left.get(program.nid) ?? 0n }
      if (left.lemma !== 0n || left.program !== 0n || left.free !== units(amount) - spent)
        fail(
          'end cascade',
          told + ' spent ' + usd(spent) + ': money left ' + JSON.stringify({ free: usd(left.free), lemma: usd(left.lemma), program: usd(left.program) }),
        )
      const node = await w.swarm.nodeRead(D.id, lemma.nid)
      if (!node.ok || node.value.end?.kind !== 'withdrawn' || node.value.runs[0]?.spent !== usd(spent))
        fail('end cascade', told + ': the lemma reads ' + JSON.stringify(node.ok && { end: node.value.end?.kind, spent: node.value.runs[0]?.spent }))
      return { steps: 3, w }
    } finally {
      await Runner.stop(w.swarm)
      w.restore()
    }
  })
}

async function refold(seed: string): Promise<Outcome> {
  return scenario(seed, 'refold', async (random, fail, D) => {
    const Runner = await import('../../src/worker/Runner.ts')
    const g = D.gateway()
    const w = await D.planted(g.route as never)
    const wait = waiter(D, fail)
    const refusals = random.int(1, limits.refold.refusalsMost)
    try {
      const board = w.swarm.board
      const finish = board.finish
      let refused = 0
      board.finish = async (task, claim, outcome) => {
        if (task === 'r:root:1' && refused < refusals) {
          refused += 1
          throw new Error('the object restarted')
        }
        return finish(task, claim, outcome)
      }
      await w.swarm.treePledge(D.id, { amount: String(random.int(1, limits.end.amountMost)), contributor: D.ana, hash: hash(random), nid: null })
      if (!(await wait('refold once', 'the run', () => g.subs.length === 1))) return { steps: 1, w }
      const sub = g.subs[0] as DispatchModule.Sub
      const summary = 'Worked ' + random.int(0, 999)
      sub.spent_usd = (g.subs[0]?.budget_usd ?? 0) * random.next()
      sub.status = { output: { children: [], commit: null, outcome: 'progress', summary, theorem: null, why: null }, state: 'completed' }
      Runner.wake(w.swarm)
      for (let life = 1; life <= refusals; life++) {
        if (!(await wait('refold once', 'refusal ' + life, () => refused >= life))) return { steps: 2, w }
        await Runner.stop(w.swarm)
        w.swarm.runtime = undefined
        await Runner.tick(w.swarm)
      }
      if (!(await wait('refold once', refusals + ' restarts then the finish', async () => (await w.swarm.board.task('r:root:1'))?.phase === 'done')))
        return { steps: 3, w }
      const task = await w.swarm.board.task('r:root:1')
      const kept = JSON.parse((task?.outcome as { done: string }).done) as { summary: string }
      if (kept.summary !== summary) fail('refold once', 'the run finished as ' + kept.summary)
      const progress = Number(
        w.swarm.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM tree_deltas WHERE node = 'root' AND event = 'progress'").one().n,
      )
      if (progress !== 1) fail('refold once', 'progress told ' + progress + ' times after ' + refusals + ' restarts')
      const quiet = w.swarm.kv.get<number>('quiet:root')
      if (quiet !== 1) fail('refold once', 'root counted quiet ' + quiet + ' times after ' + refusals + ' restarts')
      return { steps: 3 + refusals, w }
    } finally {
      await Runner.stop(w.swarm)
      w.restore()
    }
  })
}

async function stream(seed: string): Promise<Outcome> {
  return scenario(seed, 'stream', async (random, fail, D) => {
    const Runner = await import('../../src/worker/Runner.ts')
    const S = limits.stream
    const g = D.gateway()
    let push: ((text: string) => void) | undefined
    const route = async (request: Request, url: URL) => {
      if (/^\/v1\/agents\/agt_d\d+\/events$/.test(url.pathname) && url.searchParams.get('live') === '1') {
        const body = new ReadableStream<Uint8Array>({ start: (controller) => void (push = (text) => controller.enqueue(new TextEncoder().encode(text))) })
        return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
      }
      return g.route(request, url)
    }
    const w = await D.planted(route as never)
    Runner.timing.listMs = S.quietMs
    Runner.timing.streamUpMs = S.quietMs
    const wait = waiter(D, fail)
    try {
      await w.swarm.treePledge(D.id, { amount: String(random.int(1, limits.end.amountMost)), contributor: D.ana, hash: hash(random), nid: null })
      if (!(await wait('stream ends', 'the stream up', () => g.subs.length === 1 && !!push && !!w.swarm.runtime?.follow?.up))) return { steps: 1, w }
      const sub = g.subs[0] as DispatchModule.Sub
      const board = w.swarm.board
      const claim = board.claim
      let locked = 0
      board.claim = async (task, options) => {
        if (task === 'budgeting') locked += 1
        return claim(task, options)
      }
      const deltas = random.int(S.deltasLeast, S.deltasMost)
      let seq = 0
      for (; seq < deltas;) {
        seq += 1
        const type = random.pick(['reasoning.summary.delta', 'tool.call', 'message.delta'])
        push!('data: {"seq":' + seq + ',"event":{"source":"subagent","update":{"event":{"type":"' + type + '"},"id":' + sub.agent_id + ',"type":"event"}}}\n\n')
        await new Promise((resolve) => setTimeout(resolve, random.int(0, S.gapMostMs)))
      }
      if (locked > S.lockedMost) fail('stream lock', deltas + ' deltas with no new spend took the budgeting lock ' + locked + ' times')
      sub.spent_usd = (sub.budget_usd ?? 0) * random.next()
      sub.status = { output: { children: [], commit: null, outcome: 'progress', summary: 'Streamed', theorem: null, why: null }, state: 'completed' }
      push!(
        'data: {"seq":' +
          (seq + 1) +
          ',"event":{"source":"subagent","update":{"id":' +
          sub.agent_id +
          ',"status":{"state":"completed"},"type":"completion"}}}\n\n',
      )
      await wait('stream ends', 'the run after a completion on the stream', async () => (await w.swarm.board.task('r:root:1'))?.phase === 'done', S.untilMs)
      return { steps: deltas + 2, w }
    } finally {
      await Runner.stop(w.swarm)
      w.restore()
    }
  })
}

async function busy(seed: string): Promise<Outcome> {
  return scenario(seed, 'busy', async (random, fail, D) => {
    const Runner = await import('../../src/worker/Runner.ts')
    const Nodes = await import('../../src/worker/Nodes.ts')
    const B = limits.busy
    const g = D.gateway()
    const w = await D.planted(g.route as never)
    Runner.timing.pollMs = B.pollMs
    const wait = waiter(D, fail)
    try {
      const count = random.int(B.lemmasLeast, B.lemmasMost)
      const lemmas = []
      for (let i = 0; i < count; i++)
        lemmas.push(await Nodes.post(w.swarm, { by: 'seed', form: 'lemma', needs: [], parent: 'root', statement: 'True', title: 'Lemma ' + i, words: '' }))
      const order = lemmas.map((lemma) => lemma.nid)
      for (let i = order.length - 1; i > 0; i--) {
        const j = random.int(0, i)
        ;[order[i], order[j]] = [order[j]!, order[i]!]
      }
      let steps = 0
      for (const nid of order) {
        steps += 1
        await w.swarm.treePledge(D.id, { amount: String(random.int(1, limits.end.amountMost)), contributor: D.ana, hash: hash(random), nid })
        if (!(await wait('claimed at once', 'run ' + steps + ' of ' + count + ' while the pool is busy', () => g.subs.length === steps, B.untilMs))) break
        if (g.subs[steps - 1]?.role !== 'n:' + nid + '#1') fail('claimed at once', 'run ' + steps + ' spawned ' + g.subs[steps - 1]?.role + ', not ' + nid)
      }
      return { steps, w }
    } finally {
      await Runner.stop(w.swarm)
      w.restore()
    }
  })
}

async function pick(seed: string): Promise<Outcome> {
  return scenario(seed, 'pick', async (random, fail, D) => {
    const Runner = await import('../../src/worker/Runner.ts')
    const Nodes = await import('../../src/worker/Nodes.ts')
    const Setup = await import('../../src/shared/Setup.ts')
    const P = limits.pick
    const models = [Setup.fable, Setup.sol, 'vercel/google/gemini-3.8-flash']
    const offers = [...models, 'vercel/openai/gpt-9', '']
    let steps = 0
    for (; steps < P.fuzz; steps++) {
      const model = random.pick(offers)
      const harness = random.pick([...P.harnesses, 'cursor', ''])
      const why = random.chance(0.5) ? 'Because ' + random.int(0, 99) : null
      const body = JSON.stringify({ harness: harness || undefined, model: model || undefined, why: why ?? undefined })
      const answer = random.pick([body, 'Sure: ' + body, '\u0060\u0060\u0060json\n' + body + '\n\u0060\u0060\u0060', undefined, 'no idea'])
      const fallback = random.pick(models)
      const asked = answer && answer !== 'no idea' && models.includes(model) ? model : undefined
      const chosen = asked ?? fallback
      const want = { harness: asked && P.harnesses.includes(harness) ? harness : Setup.harnessOf(chosen), model: chosen, why: asked ? why : null }
      const got = Runner.picked(answer, models, fallback)
      if (JSON.stringify(got) !== JSON.stringify(want))
        fail('pick', JSON.stringify(answer) + ' picked ' + JSON.stringify(got) + ', not ' + JSON.stringify(want))
    }
    const board = {
      harness: 'claude',
      model: Setup.fable,
      most: '0',
      step: '0',
      steps: {},
      subagents: { harnesses: ['claude', 'codex'], models },
      template: 'board',
    } as const
    const g = D.gateway()
    const mode = random.pick(['side', 'turn'] as const)
    const model = random.pick(offers.slice(0, -1))
    const harness = random.pick(P.harnesses)
    const answer = JSON.stringify({ harness, model, why: 'The rider asked.' })
    if (mode === 'side') g.state.side = answer
    else g.state.pick = answer
    const w = await D.planted(g.route as never, 0, null, board as never)
    const wait = waiter(D, fail)
    const told = mode + ' answering ' + model + ' on ' + harness
    try {
      const stuck = random.chance(0.5)
      if (stuck) w.swarm.kv.put('stuck:root', Nodes.stuckRuns)
      await w.swarm.treePledge(D.id, { amount: '12', contributor: D.ana, hash: hash(random), nid: null })
      const note = random.chance(0.5) ? 'Use model ' + random.int(0, 99) + ' for this one.' : null
      if (note) await w.swarm.treeSteer(D.id, { amount: '0', contributor: D.ana, nid: 'root', note })
      if (stuck) {
        if (g.subs.length !== 0) fail('pick', told + ': a stuck node spawned')
        w.swarm.kv.delete('stuck:root')
        await Runner.tick(w.swarm)
      }
      if (!(await wait('pick', told + ': the run', () => g.subs.length === 1))) return { steps, w }
      const agent = g.agents[0]
      if (
        JSON.stringify([agent?.['name'], agent?.['model'], agent?.['harness'], agent?.['subagents']]) !==
        JSON.stringify(['orchestrator', Setup.fable, 'claude', board.subagents])
      )
        fail('pick', told + ': the orchestrator is ' + JSON.stringify(agent).slice(0, 200))
      const question = mode === 'side' ? g.sides[0] : g.prompts[0]
      if (g.sides.length !== 1 || (mode === 'turn' && g.prompts.length !== 1))
        fail('pick', told + ': asked ' + g.sides.length + ' side questions and ' + g.prompts.length + ' turns')
      if (
        !question?.startsWith('Pick the model for the next run of node root: Does P = NP?') ||
        !question.includes('Budget: $5.') ||
        models.some((one) => !question.includes('- ' + one)) ||
        (note && !question.includes(note))
      )
        fail('pick', told + ': asked ' + JSON.stringify(question).slice(0, 300))
      const listed = models.includes(model)
      const cost = mode === 'side' ? P.sideUsd : P.turnUsd
      const runStep = Number(Nodes.defaults.runStep)
      const want = [listed ? model : Setup.fable, listed ? harness : 'claude', Number((runStep - cost).toFixed(limits.money.places))]
      const spawned = g.spawned[0]
      if (JSON.stringify([spawned?.['model'], spawned?.['harness'], spawned?.['budget_usd']]) !== JSON.stringify(want))
        fail(
          'pick',
          told + ': spawned ' + JSON.stringify([spawned?.['model'], spawned?.['harness'], spawned?.['budget_usd']]) + ', not ' + JSON.stringify(want),
        )
      const started = w.swarm.ctx.storage.sql.exec<{ text: string }>("SELECT text FROM tree_deltas WHERE node = 'root' AND event = 'started'").one()?.text
      if (started !== 'Run 1 started on ' + Setup.name(String(want[0]))) fail('pick', told + ': started told ' + started)
      const view = await w.swarm.treeRead(D.id, { depth: 1, root: 'root', status: undefined })
      if (!view.ok || view.value.nodes.find((node) => node.id === 'root')?.run?.model !== want[0]) fail('pick', told + ': the run shows another model')
      const cents = random.int(0, Math.floor((runStep - cost) * limits.money.cents))
      const sub = g.subs[0] as DispatchModule.Sub
      sub.spent_usd = cents / limits.money.cents
      sub.status = { output: { children: [], commit: null, outcome: 'progress', summary: 'Worked', theorem: null, why: null }, state: 'completed' }
      Runner.wake(w.swarm)
      const total = usd(BigInt(cents) * limits.money.cent + BigInt(Math.round(cost * Number(limits.money.unit))))
      await wait('pick', told + ': root spend ' + total + ' with the pick', async () => {
        const shown = await w.swarm.treeRead(D.id, { depth: 1, root: 'root', status: undefined })
        return shown.ok && shown.value.nodes.find((node) => node.id === 'root')?.money.spent === total
      })
      return { steps: steps + 1, w }
    } finally {
      await Runner.stop(w.swarm)
      w.restore()
    }
  })
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  'mf-runner.busy': busy,
  'mf-runner.check': check,
  'mf-runner.end': end,
  'mf-runner.pick': pick,
  'mf-runner.refold': refold,
  'mf-runner.ride': ride,
  'mf-runner.steer': steer,
  'mf-runner.stream': stream,
}

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('patience'), invariant: 'spawn once', name: 'mf-runner.ride.patience', scenario: 'mf-runner.ride', seeds: ['1', '2', '4'] },
  { flip: mutant('bound'), invariant: 'spawn bound', name: 'mf-runner.ride.bound', scenario: 'mf-runner.ride', seeds: ['1', '3', '5'] },
  { flip: mutant('cap'), invariant: 'money', name: 'mf-runner.ride.cap', scenario: 'mf-runner.ride', seeds: ['1', '2', '3'] },
  { flip: mutant('needs'), invariant: 'split', name: 'mf-runner.ride.needs', scenario: 'mf-runner.ride', seeds: ['4', '7', '13'] },
  { flip: mutant('drop'), invariant: 'proven', name: 'mf-runner.check.drop', scenario: 'mf-runner.check', seeds: ['1', '2', '6'] },
  { flip: mutant('claims'), invariant: 'claim kept', name: 'mf-runner.check.claims', scenario: 'mf-runner.check', seeds: ['4', '7', '8'] },
  { flip: mutant('expire'), invariant: 'deadline', name: 'mf-runner.check.expire', scenario: 'mf-runner.check', seeds: ['3', '5', '7'] },
  { flip: mutant('ask'), invariant: 'ask once', name: 'mf-runner.check.ask', scenario: 'mf-runner.check', seeds: ['1', '13', '17'] },
  { flip: mutant('first'), invariant: 'first outcome', name: 'mf-runner.check.first', scenario: 'mf-runner.check', seeds: ['1', '4', '6'] },
  { flip: mutant('relay'), invariant: 'steer', name: 'mf-runner.steer.relay', scenario: 'mf-runner.steer', seeds: ['1', '2', '3'] },
  { flip: mutant('halt'), invariant: 'end cascade', name: 'mf-runner.end.halt', scenario: 'mf-runner.end', seeds: ['1', '2', '3'] },
  { flip: mutant('forgot'), invariant: 'refold once', name: 'mf-runner.refold.forgot', scenario: 'mf-runner.refold', seeds: ['1', '2', '3'] },
  { flip: mutant('topped'), invariant: 'stream lock', name: 'mf-runner.stream.topped', scenario: 'mf-runner.stream', seeds: ['1', '2', '3'] },
  { flip: mutant('heard'), invariant: 'stream ends', name: 'mf-runner.stream.heard', scenario: 'mf-runner.stream', seeds: ['1', '2', '3'] },
  { flip: mutant('kick'), invariant: 'claimed at once', name: 'mf-runner.busy.kick', scenario: 'mf-runner.busy', seeds: ['1', '2', '3'] },
  { flip: mutant('harness'), invariant: 'pick', name: 'mf-runner.pick.harness', scenario: 'mf-runner.pick', seeds: ['1', '2', '3'] },
]
