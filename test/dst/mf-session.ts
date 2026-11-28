import type { Route } from '../run.ts'
import type * as HandoffModule from '../../src/worker/Handoff.ts'
import type * as PhaseModule from '../../src/worker/Phase.ts'
import type * as StoreModule from '../../src/worker/Store.ts'
import type * as TurnsModule from '../../src/worker/Turns.ts'
import type * as SessionModule from '../../src/worker/machines/Session.ts'
import type * as LimitsModule from '../../src/shared/Limits.ts'
import { recorder, rng, type Canary, type Outcome, type Rng } from './mh-kit.ts'

type Fail = (invariant: string, detail: string) => void

export const limits = {
  ringsMost: 90,
  passLeastMs: 16_000,
  passMostMs: 20 * 60_000,
  centsMost: 40,
  micro: 10_000,
  completions: 2,
  walkSteps: 200,
  walkAgents: 4,
  walkGapMostMs: 9 * 60 * 60_000,
}

const crashes = [
  'the turn restarted 4 times without progress',
  'Tool execution interrupted by a host crash; outcome unknown.',
  'This nested call was running when its cell moved to another host; its outcome is unknown.',
  'Messages transport: {"detail":"request authority stopped"}',
  "Durable Object's isolate exceeded its memory limit and was reset.",
  'The session was reset after its host crashed four times in a row while running a code cell.',
]

const stalled = 'The agent made no model call or tool call for 30 minutes, so the swarm stopped the turn to start another.'

const owner = '0x' + 'c'.repeat(40)

const facts = {
  done: 'Compute the size-16 table',
  result: 'Sizes 0 to 16 reproduced twice',
  update: 'Size 17 did not work; sizes 12 and 13 passed a second check.',
  commit: 'Add the 2-process size-16 run',
  readme: '# Formula sizes for 5-variable functions',
  summary: 'What was computed and how to check it.',
}

let Handoff: typeof HandoffModule
let Phase: typeof PhaseModule
let Store: typeof StoreModule
let Turns: typeof TurnsModule
let Session: typeof SessionModule
let Limits: typeof LimitsModule
let harness: typeof import('../run.ts')

async function load() {
  if (harness) return
  harness = await import('../run.ts')
  Handoff = await import('../../src/worker/Handoff.ts')
  Phase = await import('../../src/worker/Phase.ts')
  Store = await import('../../src/worker/Store.ts')
  Turns = await import('../../src/worker/Turns.ts')
  Session = await import('../../src/worker/machines/Session.ts')
  Limits = await import('../../src/shared/Limits.ts')
}

type Report = { error?: string; ok?: { message: string }; request_id: string; spent_usd: number; status: string }

type Gateway = {
  agents: () => string[]
  observe: { rotations: () => number }
  prompts: { agent: string; prompt: string; rotations: number; turn: string }[]
  reports: Map<string, Report>
  route: Route
}

function gateway(random: Rng, fails: (index: number) => number): Gateway {
  const agents: { fails: number; id: string; sent: number }[] = []
  const prompts: Gateway['prompts'] = []
  const reports = new Map<string, Report>()
  const observe = { rotations: () => 0 }
  const route: Route = async (request, url) => {
    const path = url.pathname
    if (path === '/api/keys/credit') return Response.json({ deposited: '5', left: '5', spent: '0' })
    if (path === '/api/keys/me') return Response.json({ wallet: owner })
    if (path === '/v1/agents' && request.method === 'POST') {
      const id = 'agt_' + (agents.length + 1)
      agents.push({ fails: fails(agents.length), id, sent: 0 })
      return Response.json({ id })
    }
    if (path.includes('/git/')) {
      if (path.endsWith('/log')) return Response.json({ commits: [{ message: facts.commit + '\n\nwhy', sha: 'a'.repeat(40) }] })
      if (path.endsWith('/read'))
        return url.searchParams.get('path') === 'README.md' ? Response.json({ text: facts.readme }) : Response.json({ text: facts.summary })
      return Response.json({ files: [] })
    }
    const found = /^\/v1\/agents\/(agt_\d+)(\/.*)?$/.exec(path)
    const agent = found ? agents.find((one) => one.id === found[1]) : undefined
    if (!found || !agent) return undefined
    const rest = found[2] ?? ''
    if (rest === '/events') {
      if (url.searchParams.get('live') === '1') return new Response('down', { status: 500 })
      return Response.json({ events: [], has_more: false, next_cursor: 0 })
    }
    if (rest === '/turns' && request.method === 'POST') {
      const body = (await request.json()) as { prompt: string }
      agent.sent += 1
      const turn = agent.id + ':' + agent.sent
      prompts.push({ agent: agent.id, prompt: body.prompt, rotations: observe.rotations(), turn })
      const spent = random.int(0, limits.centsMost) / 100
      const failing = agent.fails > 0
      if (failing) agent.fails -= 1
      reports.set(
        turn,
        failing
          ? { error: random.chance(0.3) && agent.sent > 1 ? stalled : random.pick(crashes), request_id: turn, spent_usd: spent, status: 'failed' }
          : { ok: { message: 'Worked on the next step and checked it.' }, request_id: turn, spent_usd: spent, status: 'completed' },
      )
      return Response.json({ request_id: turn, status: 'queued' })
    }
    const report = /^\/turns\/([^/]+?)(\/cancel)?$/.exec(rest)
    if (report?.[1]) {
      const known = reports.get(report[1])
      return known ? Response.json(known) : Response.json({ error: 'not here' }, { status: 404 })
    }
    return undefined
  }
  return { agents: () => agents.map((one) => one.id), observe, prompts, reports, route }
}

type World = ReturnType<typeof harness.world>

async function seeded(w: World) {
  await w.seed('5000000')
  w.swarm.kv.put('owner', owner)
  w.swarm.kv.put('repo', 'solve')
  await Store.update(w.env, harness.id, { answer: JSON.stringify({ at: Date.now(), done: false, text: facts.update }), repo: 'solve' })
  w.sql.exec("INSERT INTO board_items (at, key, title, source, state, why) VALUES (?, 'k1', ?, 'lead', 'done', ?)", Date.now(), facts.done, facts.result)
  await w.swarm.wake('money')
}

async function spin(random: Rng, w: World, done: () => boolean) {
  let rings = 0
  while (rings < limits.ringsMost && !done()) {
    w.pass(random.int(limits.passLeastMs, limits.passMostMs))
    w.swarm.checked = 0
    await w.ring()
    rings += 1
  }
  return rings
}

function charged(w: World, gw: Gateway, fail: Fail) {
  const rows = w.sql.exec('SELECT turn, spent FROM turns WHERE ended_at IS NOT NULL').toArray() as { spent: string; turn: string }[]
  const seen = new Set<string>()
  for (const row of rows) {
    if (seen.has(row.turn)) fail('double charged', 'turn ' + row.turn + ' was counted twice')
    seen.add(row.turn)
    const report = gw.reports.get(row.turn)
    const want = report ? String(Math.round(report.spent_usd * 100) * limits.micro) : 'unknown'
    if (row.spent !== want) fail('double charged', 'turn ' + row.turn + ' counted ' + row.spent + ' for a settled ' + want)
  }
}

function rotated(w: World) {
  return w.sql
    .exec("SELECT text FROM feed WHERE kind = 'status' AND text = ?", Handoff.said)
    .toArray()
    .map((row) => String(row['text']))
}

async function loop(random: Rng, fail: Fail) {
  const sick = random.int(Limits.Session.failsToRotate, Limits.Session.failsToRotate + 1)
  const gw = gateway(random, (index) => (index === 0 ? sick : 1))
  const w = harness.world(gw.route)
  gw.observe.rotations = () => Session.read(Session.kv(w.swarm.kv)).rotations.length
  try {
    await seeded(w)
    const healthy = () => w.sql.exec("SELECT COUNT(*) AS n FROM turns WHERE status = 'completed' AND turn LIKE 'agt_2:%'").one()?.['n'] as number
    const rings = await spin(random, w, () => healthy() >= limits.completions || w.swarm.run().state === 'paused')
    const agents = gw.agents()
    if (agents.length !== 2) fail('one rotation', 'a session that crash-looped ' + sick + ' turns made ' + agents.length + ' agents: ' + agents.join(', '))
    const said = rotated(w)
    if (said.length !== 1) fail('one rotation', 'the feed said a fresh session started ' + said.length + ' times')
    const posts = w.sql.exec('SELECT COUNT(*) AS n FROM chat WHERE text = ?', Handoff.said).one()?.['n']
    if (posts !== 1) fail('one rotation', 'the Board thread said a fresh session started ' + String(posts) + ' times')
    const first = gw.prompts.find((one) => one.agent === 'agt_2')
    const missing = first
      ? [Handoff.marker, 'g', facts.done, facts.result, facts.update, facts.commit, facts.readme, facts.summary].filter((one) => !first.prompt.includes(one))
      : ['the prompt']
    if (missing.length) fail('handoff', 'the fresh session first turn lacked ' + JSON.stringify(missing))
    if (healthy() < limits.completions) fail('handoff', 'after ' + rings + ' rings the fresh session completed ' + healthy() + ' turns')
    if (w.swarm.agent()?.id !== 'agt_2') fail('handoff', 'the swarm current agent is ' + w.swarm.agent()?.id)
    const late = gw.prompts.filter((one) => one.agent === 'agt_1' && one.rotations > 0)
    if (late.length) fail('double charged', 'the old session was prompted ' + late.length + ' times after the fresh one started')
    charged(w, gw, fail)
    return rings
  } finally {
    w.restore()
  }
}

async function limit(random: Rng, fail: Fail) {
  const gw = gateway(random, () => Number.MAX_SAFE_INTEGER)
  const w = harness.world(gw.route)
  try {
    await seeded(w)
    const rings = await spin(random, w, () => w.swarm.run().state === 'paused')
    const made = gw.agents().length - 1
    if (made > Limits.Session.rotationsPerDay)
      fail('daily limit', 'a swarm whose every session crash-loops started ' + made + ' fresh sessions within a day, past ' + Limits.Session.rotationsPerDay)
    const run = w.swarm.run()
    const reason = run.state === 'paused' ? Phase.reason(run.pause) : ''
    if (!/daily limit/.test(reason)) fail('daily limit', 'after ' + rings + ' rings and ' + made + ' fresh sessions the run was ' + JSON.stringify(run))
    const state = Session.read(Session.kv(w.swarm.kv))
    if (made === Limits.Session.rotationsPerDay && !(state.kind === 'Spent' && state.paused)) fail('daily limit', 'the session read ' + JSON.stringify(state))
    charged(w, gw, fail)
    return rings
  } finally {
    w.restore()
  }
}

async function walk(random: Rng, fail: Fail) {
  let kept: unknown
  const store = { get: () => kept, put: (state: unknown) => void (kept = structuredClone(state)) }
  let now = limits.walkGapMostMs
  let stale = 0
  for (let index = 0; index < limits.walkSteps; index++) {
    now += random.int(0, limits.walkGapMostMs)
    const seen = Session.read(store)
    const agent = 'agt_' + random.int(1, limits.walkAgents)
    const event = random.pick([
      { agent: seen.kind === 'Seeding' ? seen.agent : agent, at: now, type: 'unusable', why: 'w' } as const,
      { agent: 'agt_' + (limits.walkAgents + index + 1), type: 'made' } as const,
      { agent: seen.kind === 'Seeding' ? seen.agent : agent, type: 'seeded' } as const,
      { type: 'paused' } as const,
      { type: 'resumed' } as const,
    ])
    let next: SessionModule.State
    try {
      next = Session.step(seen, event)
    } catch (error) {
      if (error instanceof Session.Refused) continue
      fail('session write', String(error))
      continue
    }
    const raced = random.chance(0.3)
    if (raced) store.put({ ...Session.read(store), rev: Session.rev(seen) + 1 })
    try {
      Session.write(store, next, Session.rev(seen))
      if (raced) fail('session write', 'a write that read rev ' + Session.rev(seen) + ' landed over a newer one')
    } catch (error) {
      if (!(error instanceof Session.Refused) || !raced) fail('session write', 'an unraced write was refused: ' + String(error))
      stale += 1
    }
    const day = Session.within(Session.read(store), now)
    if (day.length > Limits.Session.rotationsPerDay) fail('daily limit', day.length + ' rotations within a day')
  }
  return limits.walkSteps + stale
}

function scenario(name: string, cases: ((random: Rng, fail: Fail) => Promise<number>)[]) {
  return async (seed: string): Promise<Outcome> => {
    await load()
    const random = rng(seed, name)
    const { fail, violations } = recorder()
    const quiet = { error: console.error, log: console.log, warn: console.warn }
    console.error = () => undefined
    console.log = () => undefined
    console.warn = () => undefined
    const restore = pending?.()
    let steps = 0
    try {
      for (const one of cases) steps += await one(random, fail)
    } finally {
      restore?.()
      console.error = quiet.error
      console.log = quiet.log
      console.warn = quiet.warn
    }
    return { steps, violations }
  }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  'mf-session.rotate': scenario('mf-session.rotate', [loop, limit, walk]),
}

let pending: (() => () => void) | undefined

function flag(module: () => Record<string, boolean>, key: string) {
  return () => {
    pending = () => {
      const guards = module()
      guards[key] = false
      return () => void (guards[key] = true)
    }
    return () => void (pending = undefined)
  }
}

export const canaries: Canary[] = [
  { flip: flag(() => Turns.guards, 'since'), invariant: 'one rotation', name: 'mf-session.since', scenario: 'mf-session.rotate', seeds: ['1', '2', '3'] },
  { flip: flag(() => Handoff.guards, 'handoff'), invariant: 'handoff', name: 'mf-session.handoff', scenario: 'mf-session.rotate', seeds: ['1', '2', '3'] },
  { flip: flag(() => Turns.guards, 'switch'), invariant: 'double charged', name: 'mf-session.switch', scenario: 'mf-session.rotate', seeds: ['1', '2', '3'] },
  { flip: flag(() => Session.guards, 'limit'), invariant: 'daily limit', name: 'mf-session.limit', scenario: 'mf-session.rotate', seeds: ['1', '2', '3'] },
  { flip: flag(() => Session.guards, 'fence'), invariant: 'session write', name: 'mf-session.fence', scenario: 'mf-session.rotate', seeds: ['1', '2', '3'] },
]
