import { createHash } from 'node:crypto'
import type { Board } from 'nanocode-ts'
import * as Setup from '../../src/shared/Setup.ts'
import * as Tree from '../../src/shared/Tree.ts'
import * as Attempt from '../../src/web/attempt.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  attempt: { errors: 5, steps: 400 },
  micro: 1_000_000,
  setup: { digits: 3, fine: 10_000, fineDigits: 4, extras: 4, floorMost: 80_000, priceMost: 60, reads: 40, steps: 200 },
  tree: { fixedSpent: [500_000, 3_000_000, 2_000_000, 0, 0, 0, 0], headlines: 300, moneyMost: 20_000_000, nodes: 9, runs: 4, statuses: 600, verifies: 3 },
  violations: 20,
}

type Rng = {
  chance: (p: number) => boolean
  int: (lo: number, hi: number) => number
  next: () => number
  pick: <T>(items: readonly T[]) => T
}

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

const subject = {
  attempt: { ...Attempt },
  board: Setup.board,
  call: Setup.call,
  headline: Tree.headline,
  moved: Setup.moved,
  priced: Setup.priced,
  reserve: Setup.reserve,
  status: Tree.status,
  told: Setup.told,
}

function swap<K extends keyof typeof subject>(key: K, broken: (typeof subject)[K]) {
  return () => {
    const was = subject[key]
    subject[key] = broken
    return () => void (subject[key] = was)
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function attempt(seed: string): Promise<Outcome> {
  const random = rng(seed, 'attempt')
  const { fail, violations } = recorder()
  const A = subject.attempt
  let now: Attempt.Attempt = A.idle
  let steps = 0
  for (; steps < limits.attempt.steps; steps++) {
    const op = random.pick(['start', 'start', 'settle', 'fail', 'fail', 'read', 'set'] as const)
    const was = JSON.stringify(now)
    if (op === 'set') {
      now = random.pick<Attempt.Attempt>([A.idle, { at: 'busy' }, { at: 'failed', error: 'e' + random.int(0, limits.attempt.errors) }])
      continue
    }
    if (op === 'start') {
      const next = A.start(now)
      const expected = now.at === 'busy' ? undefined : { at: 'busy' }
      if (!same(next, expected)) fail('attempt once', 'start from ' + was + ' gave ' + JSON.stringify(next) + ', expected ' + JSON.stringify(expected))
      if (next) now = next
    } else if (op === 'settle') {
      const next = A.settle(now)
      const expected = now.at === 'busy' ? { at: 'idle' } : now
      if (!same(next, expected)) fail('attempt settles', 'settle from ' + was + ' gave ' + JSON.stringify(next))
      now = next
    } else if (op === 'fail') {
      const error = 'e' + random.int(0, limits.attempt.errors)
      const next = A.fail(now, error)
      const expected = now.at === 'busy' ? { at: 'failed', error } : now
      if (!same(next, expected)) fail('attempt settles', 'fail ' + error + ' from ' + was + ' gave ' + JSON.stringify(next))
      now = next
    } else {
      const busy = A.busy(now)
      const error = A.error(now)
      if (busy !== (now.at === 'busy')) fail('attempt shows', was + ' read busy ' + busy)
      if (error !== (now.at === 'failed' ? now.error : undefined)) fail('attempt shows', was + ' read error ' + error)
    }
  }
  return { steps, violations }
}

const phases: Board.Phase[] = ['open', 'claimed', 'done', 'failed', 'cancelled', 'blocked']

const stages: Board.Stage[] = ['scheduled', 'open', 'held', 'lapsed', 'blocked', 'stalled', 'done', 'failed', 'cancelled']

function task(id: string, phase: Board.Phase, stage: Board.Stage): Board.Task {
  return { assignee: null, attempts: 0, dueAtMs: null, id, labels: {}, needs: [], parent: null, phase, rank: null, replies: [], spec: id, stage }
}

const ended = (one: Board.Task) => one.phase === 'done' || one.phase === 'failed' || one.phase === 'cancelled'

function expectedStatus(node: Board.Task, runs: Board.Task[], verifies: Board.Task[]): Tree.Status {
  if (node.phase === 'done') return 'proven'
  if (node.phase === 'failed' || node.phase === 'cancelled') return 'dead end'
  if (runs.some((run) => !ended(run) && (run.phase === 'claimed' || ['held', 'lapsed', 'stalled'].includes(run.stage)))) return 'in flight'
  if (verifies.some((one) => !ended(one))) return 'in flight'
  if (runs.some((run) => !ended(run) && ['open', 'blocked', 'scheduled'].includes(run.stage))) return 'funded'
  return 'proposed'
}

const statusCases: [Board.Task, Board.Task[], Board.Task[], Tree.Status][] = [
  [task('n:a', 'open', 'open'), [], [], 'proposed'],
  [task('n:a', 'open', 'open'), [task('r:a:1', 'done', 'done')], [], 'proposed'],
  [task('n:a', 'open', 'open'), [task('r:a:1', 'open', 'open')], [], 'funded'],
  [task('n:a', 'open', 'open'), [task('r:a:1', 'open', 'scheduled')], [], 'funded'],
  [task('n:a', 'open', 'open'), [task('r:a:1', 'blocked', 'blocked')], [], 'funded'],
  [task('n:a', 'open', 'open'), [task('r:a:1', 'claimed', 'held')], [], 'in flight'],
  [task('n:a', 'open', 'open'), [task('r:a:1', 'claimed', 'lapsed')], [], 'in flight'],
  [task('n:a', 'open', 'open'), [], [task('v:a:1', 'open', 'open')], 'in flight'],
  [task('n:a', 'open', 'open'), [], [task('v:a:1', 'failed', 'failed')], 'proposed'],
  [task('n:a', 'done', 'done'), [task('r:a:1', 'claimed', 'held')], [], 'proven'],
  [task('n:a', 'failed', 'failed'), [], [], 'dead end'],
  [task('n:a', 'cancelled', 'cancelled'), [], [], 'dead end'],
]

const statuses: Tree.Status[] = ['proposed', 'funded', 'in flight', 'proven', 'dead end']

const forms: Tree.Form[] = ['goal', 'program', 'approach', 'lemma', 'idea', 'triage']

const usd = (micro: bigint) => micro / BigInt(limits.micro) + '.' + (micro % BigInt(limits.micro)).toString().padStart(String(limits.micro).length - 1, '0')

function treeNode(id: string, status: Tree.Status, extra: Partial<Tree.Node> = {}): Tree.Node {
  const zero = usd(0n)
  return {
    by: { address: null, agent: null, handle: 'x' },
    children: [],
    counts: { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 0 },
    createdAt: 0,
    end: null,
    form: 'lemma',
    funders: [],
    id,
    money: { committed: zero, granted: zero, inherited: zero, left: zero, pledged: zero, spent: zero, subtree: { left: zero, pledged: zero, spent: zero } },
    needs: [],
    parent: 'root',
    paused: null,
    proof: null,
    riders: 0,
    run: null,
    spec: id,
    statement: null,
    status,
    title: id,
    updatedAt: 0,
    ...extra,
  } as Tree.Node
}

function expectedHeadline(nodes: Tree.Node[], spent: bigint[], pledged: bigint[]): Tree.Headline {
  const proven = nodes.filter((one) => one.status === 'proven')
  const ids = new Set(proven.map((one) => one.id))
  const total = spent.reduce((sum, one) => sum + one, 0n)
  const ats = proven.flatMap((one) => (one.proof ? [one.proof.at] : []))
  return {
    deadEnds: nodes.filter((one) => one.status === 'dead end').length,
    frontier: nodes.filter((one) => one.form === 'lemma' && one.status !== 'proven' && one.status !== 'dead end' && one.needs.every((need) => ids.has(need)))
      .length,
    inFlight: nodes.filter((one) => one.status === 'in flight').length,
    lastProvenAt: ats.length ? Math.max(...ats) : null,
    pledged: usd(pledged.reduce((sum, one) => sum + one, 0n)),
    perProven: proven.length ? usd(total / BigInt(proven.length)) : null,
    proven: proven.length,
    spent: usd(total),
  }
}

async function tree(seed: string): Promise<Outcome> {
  const random = rng(seed, 'tree')
  const { fail, violations } = recorder()
  const L = limits.tree
  let steps = 0
  for (const [node, runs, verifies, expected] of statusCases) {
    const got = subject.status({ node, runs, verifies })
    if (got !== expected)
      fail(
        'tree status',
        'node ' +
          node.phase +
          ' runs ' +
          runs.map((one) => one.phase + '/' + one.stage) +
          ' verifies ' +
          verifies.map((one) => one.phase) +
          ' is ' +
          got +
          ', not ' +
          expected,
      )
  }
  for (let i = 0; i < L.statuses; i++, steps++) {
    const make = (prefix: string, n: number) => Array.from({ length: random.int(0, n) }, (_, k) => task(prefix + k, random.pick(phases), random.pick(stages)))
    const node = task('n:x', random.pick(phases), random.pick(stages))
    const runs = make('r:x:', L.runs)
    const verifies = make('v:x:', L.verifies)
    const got = subject.status({ node, runs, verifies })
    const expected = expectedStatus(node, runs, verifies)
    if (got !== expected)
      fail(
        'tree status',
        'node ' +
          node.phase +
          ' runs ' +
          runs.map((one) => one.phase + '/' + one.stage) +
          ' verifies ' +
          verifies.map((one) => one.phase + '/' + one.stage) +
          ' is ' +
          got +
          ', not ' +
          expected,
      )
  }
  const fixed = [
    treeNode('root', 'funded', { form: 'goal', parent: null }),
    treeNode('a', 'proven', { proof: { at: 5 } as Tree.Check }),
    treeNode('b', 'proven', { proof: { at: 9 } as Tree.Check }),
    treeNode('c', 'in flight', { needs: ['a'] }),
    treeNode('d', 'proposed', { needs: ['a', 'e'] }),
    treeNode('e', 'dead end'),
    treeNode('f', 'funded', { form: 'program' }),
  ]
  const fixedSpent = limits.tree.fixedSpent.map((one) => BigInt(one))
  const fixedPledged = fixed.map((one) => (one.id === 'root' ? BigInt(limits.micro) * 10n : 0n))
  fixed.forEach((one, i) => (one.money = { ...one.money, pledged: usd(fixedPledged[i]!), spent: usd(fixedSpent[i]!) }))
  const cases: [Tree.Node[], bigint[], bigint[]][] = [
    [fixed, fixedSpent, fixedPledged],
    [[], [], []],
  ]
  for (let i = 0; i < L.headlines; i++) {
    const count = random.int(0, L.nodes)
    const ids = Array.from({ length: count }, (_, k) => 'n' + k)
    const spent = ids.map(() => BigInt(random.int(0, L.moneyMost)))
    const pledged = ids.map(() => BigInt(random.int(0, L.moneyMost)))
    const nodes = ids.map((id, k) => {
      const status = random.pick(statuses)
      const zero = usd(0n)
      return treeNode(id, status, {
        form: random.pick(forms),
        money: {
          committed: zero,
          granted: zero,
          inherited: zero,
          left: zero,
          pledged: usd(pledged[k]!),
          spent: usd(spent[k]!),
          subtree: { left: zero, pledged: zero, spent: zero },
        },
        needs: ids.filter((other) => other !== id && random.chance(1 / L.runs)),
        proof: status === 'proven' && random.chance(L.runs / (L.runs + 1)) ? ({ at: random.int(0, L.moneyMost) } as Tree.Check) : null,
      })
    })
    cases.push([nodes, spent, pledged])
  }
  for (const [nodes, spent, pledged] of cases) {
    steps += 1
    const got = subject.headline(nodes)
    const expected = expectedHeadline(nodes, spent, pledged)
    if (!same(got, expected))
      fail(
        'tree headline',
        nodes.map((one) => one.id + ':' + one.status + ':' + one.form + '<' + one.needs + '>').join(' ') +
          ' headline ' +
          JSON.stringify(got) +
          ', expected ' +
          JSON.stringify(expected),
      )
  }
  return { steps, violations }
}

const anchors = new Map<string, Setup.Price>([
  [Setup.fable, { cached: 0.2, id: Setup.fable, input: 8, output: 40 }],
  [Setup.opus, { cached: 0.2, id: Setup.opus, input: 4, output: 20 }],
  [Setup.sol, { cached: 0.1, id: Setup.sol, input: 2, output: 10 }],
  [Setup.astra, { cached: 1, id: Setup.astra, input: 10, output: 50 }],
  [Setup.flash, { cached: 0.0048, id: Setup.flash, input: 0.24, output: 0.96 }],
  [Setup.glmFlash, { cached: 0.024, id: Setup.glmFlash, input: 0.12, output: 0.4 }],
  [Setup.glm, { cached: 0.14, id: Setup.glm, input: 1.12, output: 3.52 }],
  [Setup.kimi, { cached: 0.2, id: Setup.kimi, input: 1.7, output: 8.5 }],
])

const anchored: { template: Setup.Chosen; most?: string; step?: string; steps?: Record<string, string> }[] = [
  { step: '65600', template: 'frontier-anthropic' },
  { most: String(Setup.least), template: 'cheap' },
  { most: '220480', step: '37600', steps: { [Setup.glm]: '12480', [Setup.kimi]: '21500', [Setup.opus]: '37600' }, template: 'frontier-mix' },
  { most: '440960', step: '65600', template: 'fable' },
  { most: String(Setup.least), template: 'free' },
]

const leads: Record<Exclude<Setup.Chosen, 'custom'>, { harness: Setup.Harness; model: string; subagents: Setup.Offer | null }> = {
  cheap: { harness: 'codex', model: Setup.flash, subagents: { harnesses: ['codex', 'claude'], models: [Setup.flash, Setup.glmFlash] } },
  fable: { harness: 'claude', model: Setup.fable, subagents: { harnesses: ['claude', 'codex'], models: [Setup.fable, Setup.opus, Setup.kimi, Setup.glm] } },
  free: { harness: 'codex', model: Setup.flash, subagents: null },
  'frontier-anthropic': { harness: 'claude', model: Setup.fable, subagents: { harnesses: ['claude'], models: [Setup.fable] } },
  'frontier-mix': { harness: 'claude', model: Setup.opus, subagents: { harnesses: ['claude', 'codex'], models: [Setup.opus, Setup.kimi, Setup.glm] } },
  'frontier-openai': { harness: 'codex', model: Setup.sol, subagents: { harnesses: ['codex'], models: [Setup.sol, Setup.astra] } },
}

const movedTo: Record<string, string> = {
  'boundless/anthropic/claude-fable-5.2': Setup.fable,
  'boundless/anthropic/claude-opus-5.5': Setup.opus,
  'boundless/deepseek/deepseek-v4.1-flash-1017': Setup.flash,
  'boundless/moonshotai/kimi-k3.1-pro': Setup.kimi,
  'boundless/unknown/model': Setup.opus,
  'boundless/z-ai/glm-5.3': Setup.glm,
}

const known = [Setup.fable, Setup.opus, Setup.sol, Setup.astra, Setup.flash, Setup.glmFlash, Setup.glm, Setup.kimi]

const extras = ['vercel/google/gemini-3.8-flash', 'vercel/openai/gpt-oss-120b', 'vercel/xai/grok-4.7', 'vercel/anthropic/claude-haiku-5']

function microOf(usdValue: number) {
  return BigInt(Math.ceil(usdValue * limits.micro))
}

function costOf(price: Setup.Price) {
  const step = microOf(((Setup.context - Setup.fresh) * price.cached + Setup.fresh * price.input + Setup.written * price.output) / limits.micro)
  const most = microOf((Setup.context * price.input + Setup.longest * price.output) / limits.micro)
  return { most: most > Setup.least ? most : Setup.least, step }
}

function dollars(value: string) {
  return '$' + (Number(value) / limits.micro).toFixed(Number(value) < limits.setup.fine ? limits.setup.fineDigits : limits.setup.digits)
}

async function setup(seed: string): Promise<Outcome> {
  const random = rng(seed, 'setup')
  const { fail, violations } = recorder()
  const L = limits.setup
  let steps = 0
  if (Setup.fallback !== 'frontier-anthropic') fail('setup template', 'the default template is ' + Setup.fallback)
  for (const one of anchored) {
    const resolved = Setup.resolve({ template: one.template })
    const priced = typeof resolved === 'string' ? resolved : subject.priced(resolved, anchors)
    if (typeof priced === 'string') {
      fail('setup cost', one.template + ' did not price: ' + priced)
      continue
    }
    if (one.step !== undefined && priced.step !== one.step) fail('setup cost', one.template + ' step ' + priced.step + ', expected ' + one.step)
    if (one.most !== undefined && priced.most !== one.most) fail('setup cost', one.template + ' most ' + priced.most + ', expected ' + one.most)
    if (one.steps && !same(Object.entries(priced.steps).sort(), Object.entries(one.steps).sort()))
      fail('setup cost', one.template + ' steps ' + JSON.stringify(priced.steps))
  }
  const mix = subject.priced(Setup.resolve({ template: 'frontier-mix' }) as Exclude<ReturnType<typeof Setup.resolve>, string>, anchors)
  if (typeof mix !== 'string') {
    const told = subject.told(mix)
    for (const want of ['Claude Code with ' + Setup.opus, Setup.kimi + ' (about $0.021 a call)', 'at least ' + Setup.budgetCalls + " of its model's calls"])
      if (!told.includes(want)) fail('setup told', 'the frontier-mix brief lacks ' + want)
  }
  for (const preset of Object.values(Setup.presets))
    for (const model of [preset.model, ...(preset.subagents?.models ?? [])]) if (Setup.direct(model)) fail('setup moved', 'a template names ' + model)
  for (; steps < L.steps; steps++) {
    const prices = new Map<string, Setup.Price>()
    for (const id of [...known, ...extras, ...Object.keys(movedTo)])
      if (random.chance(id.startsWith('boundless/') ? 1 / L.extras : 1 - 1 / L.extras))
        prices.set(id, { cached: random.next() / L.extras, id, input: random.next() * L.priceMost, output: random.next() * L.priceMost })
    const op = random.pick(['template', 'custom', 'reserve', 'moved', 'board'] as const)
    if (op === 'template') {
      const template = random.pick(Object.keys(leads) as (keyof typeof leads)[])
      const resolved = Setup.resolve({ template })
      const want = leads[template]
      if (typeof resolved === 'string' || !same({ harness: resolved.harness, model: resolved.model, subagents: resolved.subagents }, want)) {
        fail('setup template', template + ' resolved to ' + JSON.stringify(resolved))
        continue
      }
      check(resolved, prices)
    } else if (op === 'custom') {
      const pool = [...known, ...extras, ...Object.keys(movedTo), 'nope/model']
      const harness = random.pick(Setup.harnesses)
      const bare = random.chance(1 / L.extras)
      const model = random.pick(pool)
      const subagents = random.chance(1 / L.extras)
        ? null
        : { harnesses: [random.pick(Setup.harnesses)], models: Array.from({ length: random.int(1, L.extras) }, () => random.pick(pool)) }
      const resolved = Setup.resolve(bare ? { template: 'custom' } : { harness, model, subagents, template: 'custom' })
      if (bare) {
        if (typeof resolved !== 'string') fail('setup template', 'a custom setup with no lead resolved to ' + JSON.stringify(resolved))
        continue
      }
      if (!same(resolved, { harness, model, subagents, template: 'custom' }))
        fail('setup template', 'custom ' + model + ' resolved to ' + JSON.stringify(resolved))
      if (typeof resolved !== 'string') check(resolved, prices)
    } else if (op === 'reserve') {
      const most = String(random.int(0, L.floorMost * L.extras))
      const step = String(random.int(0, L.floorMost))
      const floor = BigInt(random.int(0, L.floorMost))
      const none = random.chance(1 / L.extras)
      const reserve = subject.reserve(none ? null : { most })
      const call = subject.call(none ? null : { step }, floor)
      if (reserve !== (none ? Setup.least : BigInt(most))) fail('setup reserve', 'reserve of ' + (none ? 'no setup' : most) + ' is ' + reserve)
      const typical = none ? 0n : BigInt(step)
      if (call !== (typical > floor ? typical : floor)) fail('setup reserve', 'call of ' + (none ? 'no setup' : step) + ' over ' + floor + ' is ' + call)
    } else if (op === 'moved') {
      const pool = [...known, ...Object.keys(movedTo)]
      const model = random.pick(pool)
      const subagents = random.chance(1 / L.extras)
        ? null
        : { harnesses: [...Setup.harnesses], models: Array.from({ length: random.int(1, L.extras + 2) }, () => random.pick(pool)) }
      const given = { harness: random.pick(Setup.harnesses), model, subagents, template: random.pick(Setup.templates) }
      const stranded = (one: string) => Setup.direct(one) && !prices.has(one)
      const to = (one: string) => (stranded(one) ? (movedTo[one] ?? Setup.opus) : one)
      const expected = [model, ...(subagents?.models ?? [])].some(stranded)
        ? {
            harness: given.harness,
            model: to(model),
            subagents: subagents && { harnesses: subagents.harnesses, models: [...new Set(subagents.models.map(to))] },
            template: given.template,
          }
        : undefined
      const got = subject.moved(given, prices)
      if (!same(got, expected)) fail('setup moved', JSON.stringify(given) + ' moved to ' + JSON.stringify(got) + ', expected ' + JSON.stringify(expected))
    } else {
      prices.set(Setup.flash, { cached: 0, id: Setup.flash, input: 1, output: 1 })
      if (random.chance(1 / L.extras)) for (const id of [...prices.keys()]) if (id !== Setup.flash && id !== Setup.glm) prices.delete(id)
      const got = subject.board(prices)
      const models = [...prices.keys()].filter((one) => ['anthropic', 'google', 'openai'].includes(one.split('/').at(-2) ?? '')).sort()
      const expected = models.length
        ? { harness: 'claude', model: Setup.fable, subagents: { harnesses: ['claude', 'codex'], models }, template: 'board' }
        : 'The gateway lists no OpenAI, Anthropic or Google model right now.'
      if (!same(got, expected)) fail('setup board', 'board over ' + [...prices.keys()].join(',') + ' gave ' + JSON.stringify(got))
      for (const one of models)
        if (Setup.harnessOf(one) !== (one.split('/').at(-2) === 'anthropic' ? 'claude' : 'codex')) fail('setup board', one + ' runs on ' + Setup.harnessOf(one))
      if (typeof got !== 'string') {
        const priced = subject.priced(got, prices)
        if (
          typeof priced !== 'string' &&
          !subject
            .told(priced)
            .startsWith(
              "Models: the swarm's orchestrator picked the model you run on for this run. Your own subagents may use the Claude Code or Codex harness with " +
                models[0],
            )
        )
          fail('setup told', 'the board brief is ' + subject.told(priced).slice(0, L.reads * L.extras))
      }
    }
  }
  function check(resolved: Exclude<ReturnType<typeof Setup.resolve>, string>, prices: Map<string, Setup.Price>) {
    const priced = subject.priced(resolved, prices)
    const missing = [resolved.model, ...(resolved.subagents?.models ?? [])].find((one) => !prices.has(one))
    if (missing) {
      const why = Setup.direct(missing) ? 'do not run on Boundless' : 'is not a gateway model'
      if (typeof priced !== 'string' || !priced.includes(missing) || !priced.includes(why))
        fail('setup cost', 'pricing without ' + missing + ' gave ' + JSON.stringify(priced).slice(0, L.reads * L.extras))
      return
    }
    if (typeof priced === 'string') return fail('setup cost', JSON.stringify(resolved) + ' did not price: ' + priced)
    const lead = costOf(prices.get(resolved.model)!)
    const steps = Object.fromEntries((resolved.subagents?.models ?? []).map((one) => [one, String(costOf(prices.get(one)!).step)]))
    if (priced.most !== String(lead.most) || priced.step !== String(lead.step) || !same(priced.steps, steps))
      fail(
        'setup cost',
        resolved.model +
          ' priced ' +
          JSON.stringify({ most: priced.most, step: priced.step, steps: priced.steps }) +
          ', expected ' +
          JSON.stringify({ most: String(lead.most), step: String(lead.step), steps }),
      )
    const told = subject.told(priced)
    const harness = (one: Setup.Harness) => (one === 'claude' ? 'Claude Code' : 'Codex')
    if (!told.includes('you run on ' + harness(priced.harness) + ' with ' + priced.model))
      fail('setup told', 'the brief does not name its lead: ' + told.slice(0, L.reads * L.extras))
    for (const one of priced.subagents?.models ?? [])
      if (!told.includes(one + ' (about ' + dollars(priced.steps[one]!) + ' a call)'))
        fail('setup told', 'the brief does not price ' + one + ': ' + told.slice(0, L.reads * L.extras))
    if (priced.subagents && !told.includes('at least ' + Setup.budgetCalls + " of its model's calls")) fail('setup told', 'the brief lacks the budget floor')
  }
  return { steps, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  'mf.attempt': attempt,
  'mf.setup': setup,
  'mf.tree': tree,
}

function cheapened() {
  const offer = Setup.presets.cheap.subagents!
  const was = offer.models
  offer.models = [Setup.flash]
  return () => void (offer.models = was)
}

function widened() {
  Setup.providers.push('deepseek')
  return () => void Setup.providers.pop()
}

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: swap('attempt', { ...Attempt, start: () => ({ at: 'busy' }) }),
    invariant: 'attempt once',
    name: 'mf.attempt.twice',
    scenario: 'mf.attempt',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('attempt', { ...Attempt, fail: (_now, error) => ({ at: 'failed', error }) }),
    invariant: 'attempt settles',
    name: 'mf.attempt.late',
    scenario: 'mf.attempt',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('attempt', { ...Attempt, error: (now) => (now.at === 'idle' ? undefined : 'busy') }),
    invariant: 'attempt shows',
    name: 'mf.attempt.shown',
    scenario: 'mf.attempt',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('status', (input) => Tree.status({ ...input, verifies: [] })),
    invariant: 'tree status',
    name: 'mf.tree.verifies',
    scenario: 'mf.tree',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('headline', (nodes) => ({
      ...Tree.headline(nodes),
      frontier: nodes.filter((one) => one.form === 'lemma' && one.status !== 'proven' && one.status !== 'dead end').length,
    })),
    invariant: 'tree headline',
    name: 'mf.tree.frontier',
    scenario: 'mf.tree',
    seeds: ['1', '2', '3'],
  },
  { flip: cheapened, invariant: 'setup template', name: 'mf.setup.cheap', scenario: 'mf.setup', seeds: ['1', '2', '3'] },
  {
    flip: swap('priced', (given, prices) => {
      const priced = Setup.priced(given, prices)
      return typeof priced === 'string' ? priced : { ...priced, most: String(Setup.units(Setup.most(prices.get(given.model)!))) }
    }),
    invariant: 'setup cost',
    name: 'mf.setup.floor',
    scenario: 'mf.setup',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('call', (given, floor) => (given ? BigInt(given.step) : floor)),
    invariant: 'setup reserve',
    name: 'mf.setup.call',
    scenario: 'mf.setup',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('told', (given) => Setup.told({ ...given, steps: {} })),
    invariant: 'setup told',
    name: 'mf.setup.told',
    scenario: 'mf.setup',
    seeds: ['1', '2', '3'],
  },
  {
    flip: swap('moved', (given, metered) => {
      const moved = Setup.moved(given, metered)
      return moved && { ...moved, subagents: given.subagents }
    }),
    invariant: 'setup moved',
    name: 'mf.setup.moved',
    scenario: 'mf.setup',
    seeds: ['1', '2', '3'],
  },
  { flip: widened, invariant: 'setup board', name: 'mf.setup.board', scenario: 'mf.setup', seeds: ['1', '2', '3'] },
]
