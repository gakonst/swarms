import { registerHooks } from 'node:module'
import * as Progress from '../../src/shared/Progress.ts'
import type * as Tree from '../../src/shared/Tree.ts'
import { recorder, rng, type Outcome } from './mi.ts'

export const limits = {
  cases: 200,
  coldMs: 20,
  edgeFastMs: 150,
  idleMs: 40 * 60_000,
  goneMs: 61 * 60_000,
  keepSeconds: 3600,
  nodes: 12,
  refreshMs: 200,
  staleSeconds: 60,
}

type Grove = {
  grow: (tree: object) => GroveState
  needsMoney: (node: Tree.Node) => boolean
  patch: (grove: GroveState, delta: object) => GroveState
  rows: (nodes: Record<string, Tree.Node>, root: string, open: Set<string>, filter: string) => { hit: boolean; node: Tree.Node }[]
}
type GroveState = {
  headline: { frontier: number; inFlight: number; lastProvenAt: number | null; proven: number }
  landed: Record<string, number>
  nodes: Record<string, Tree.Node>
  seq: number
}

const web = { grove: '../../src/web/grove.ts' }

const impl = {
  patch: null as null | ((patch: Grove['patch']) => Grove['patch']),
  merges: Progress.merges,
  steps: Progress.steps,
  cached: null as null | ((cached: EdgeModule['cached']) => EdgeModule['cached']),
}

const mutants: { [K in keyof typeof impl]: (typeof impl)[K] } = {
  patch: (patch) => (grove, delta) => {
    const next = patch(grove, delta)
    return next === grove ? patch({ ...grove, seq: grove.seq - 1 }, delta) : next
  },
  merges: (message) => /^merge (\S+?):/i.exec(message)?.[1] ?? null,
  steps: (tsv, metric) => Progress.steps(tsv, metric).map((step) => ({ ...step, kept: true })),
  cached: (cached) => (env, key, fresh, read, keep, wait) => cached(env, key, fresh, read, keep, wait).then(async (value) => (await read()) ?? value),
}

function mutant<K extends keyof typeof impl>(key: K) {
  return () => {
    const was = impl[key]
    impl[key] = mutants[key]
    return () => void (impl[key] = was)
  }
}

function node(id: string, parent: string | null, status: Tree.Status, extra: Partial<Tree.Node> = {}): Tree.Node {
  const counts = { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 0 }
  counts[status] = 1
  return {
    by: { address: null, agent: null, handle: 'ada' },
    children: [],
    counts,
    createdAt: 1,
    end: null,
    form: 'lemma',
    funders: [],
    id,
    money: { committed: '0', granted: '0', inherited: '0', left: '0', pledged: '0', spent: '0', subtree: { left: '0', pledged: '0', spent: '0' } },
    needs: [],
    parent,
    proof: null,
    riders: 0,
    run: null,
    spec: id,
    statement: null,
    status,
    title: id,
    updatedAt: 1,
    ...extra,
  } as Tree.Node
}

const proof = {
  at: 9,
  axioms: [],
  checker: '',
  command: '',
  commit: 'x',
  contentHash: '',
  durationMs: 1,
  exitCode: 0,
  mathlib: '',
  repo: '',
  run: '1',
  statement: '',
  theorem: '',
  toolchain: '',
  url: 'u',
}

async function grove(seed: string): Promise<Outcome> {
  const random = rng('grove', seed)
  const { holds, same, steps, violations } = recorder()
  const Grove = (await import(web.grove)) as Grove
  const patch = impl.patch ? impl.patch(Grove.patch) : Grove.patch
  const world = () => {
    const a = node('a', 'root', 'proven')
    const b = node('b', 'root', 'in flight', { needs: ['a'] })
    const c = node('c', 'root', 'proposed', { needs: ['b'] })
    const root = node('root', null, 'proposed', {
      children: ['a', 'b', 'c'],
      counts: { 'dead end': 0, funded: 0, 'in flight': 1, proposed: 2, proven: 1 },
      form: 'goal',
    })
    return Grove.grow({
      headline: { deadEnds: 0, frontier: 1, inFlight: 1, lastProvenAt: null, pledged: '0', perProven: '0', proven: 1, spent: '0' },
      nodes: [root, a, b, c],
      seq: 5,
    })
  }
  const start = world()
  const proven = node('b', 'root', 'proven', { needs: ['a'], proof })
  const next = patch(start, { at: 9, event: 'proven', node: proven, seq: 6, text: 'Checked by Lean' })
  same(
    'proven moves once',
    [
      next.nodes['root']!.counts.proven,
      next.nodes['root']!.counts['in flight'],
      next.headline.proven,
      next.headline.inFlight,
      next.headline.frontier,
      next.headline.lastProvenAt,
      next.landed['b'],
    ],
    [2, 0, 2, 0, 1, 9, 9],
    'a proven delta',
  )
  holds('replay is a no-op', patch(next, { at: 9, event: 'proven', node: proven, seq: 6, text: '' }) === next, 'the same proven delta changed the grove again')
  const fresh = node('d', 'root', 'proposed', {
    money: {
      committed: '0',
      granted: '0',
      inherited: '0',
      left: '1.000000',
      pledged: '1.000000',
      spent: '0',
      subtree: { left: '1.000000', pledged: '1.000000', spent: '0' },
    },
  })
  const posted = patch(start, { at: 2, event: 'posted', node: fresh, seq: 6, text: '' })
  same(
    'posted joins',
    [posted.nodes['root']!.children, posted.nodes['root']!.counts.proposed, posted.nodes['root']!.money.subtree.left],
    [['a', 'b', 'c', 'd'], 3, '1.000000'],
    'a posted node',
  )
  same(
    'filters',
    Grove.rows(start.nodes, 'root', new Set(['root']), 'proven').map((row) => [row.node.id, row.hit]),
    [
      ['root', false],
      ['a', true],
    ],
    'proven filter',
  )
  same(
    'filters',
    Grove.rows(start.nodes, 'root', new Set(), 'all').map((row) => row.node.id),
    ['root'],
    'closed root',
  )
  same('needs money', [Grove.needsMoney(node('x', null, 'proposed')), Grove.needsMoney(node('x', null, 'funded'))], [true, false], 'needs money')
  const run: Tree.Run = {
    agent: 3,
    attempt: 1,
    budget: '1',
    checking: false,
    doing: { at: 7, text: 'Ran lake build' },
    k: 1,
    since: 1,
    spent: '0',
    task: 'r',
    until: 0,
  }
  const busy = node('b', 'root', 'in flight', { needs: ['a'], run })
  const doing = patch(start, { at: 7, event: 'doing', node: busy, seq: 5, text: 'Ran lake build' })
  same(
    'doing keeps cursor',
    [doing.nodes['b']?.run?.doing?.text, doing.seq, doing.headline.inFlight, doing.headline.frontier, doing.headline.proven],
    ['Ran lake build', 5, start.headline.inFlight, start.headline.frontier, start.headline.proven],
    'a doing delta',
  )
  holds(
    'replay is a no-op',
    patch(doing, { at: 8, event: 'doing', node: busy, seq: 4, text: '' }) === doing &&
      patch(doing, { at: 8, event: 'progress', node: busy, seq: 5, text: '' }) === doing,
    'an older delta changed the grove',
  )
  for (let run = 0; run < limits.cases / 10; run++) {
    let state = world()
    let seq = state.seq
    const ids = ['a', 'b', 'c']
    for (let at = 0; at < limits.nodes; at++) {
      const pick = random.pick(ids)
      const stale = random.chance(0.3)
      const delta = { at: at + 10, event: 'proven', node: node(pick, 'root', 'proven', { proof }), seq: stale ? seq : seq + 1, text: '' }
      const before = state
      state = patch(state, delta)
      if (stale) holds('replay is a no-op', state === before, 'a delta at seq ' + delta.seq + ' changed a grove at ' + before.seq)
      else seq++
      const counted = Object.values(state.nodes).filter((one) => one.id !== 'root' && one.status === 'proven').length
      holds(
        'proven moves once',
        state.headline.proven === counted && state.nodes['root']!.counts.proven === counted,
        'headline ' + state.headline.proven + ' and root ' + state.nodes['root']!.counts.proven + ' for ' + counted + ' proven',
      )
    }
  }
  return { steps: steps(), violations }
}

const main = [
  'commit\tspeedup\tmemory_gb\tstatus\tdescription',
  'base0\t1.0019\t0\tkeep\tbaseline: SGLang modules split',
  'moe-34880e5\t1.0747\t0\tkeep\tmerge moe: post-expert norm kernel called directly',
  'df-0f697c7\t1.1160\t0\tkeep\tmerge dense-fusion: fused router',
  'rerun-bd6fcf8\t1.3186\t0\tkeep\tfresh H200 + rebuilt harness',
  'attn-tile-sweep\t0\t0\tdiscard\tsplit-KV attention sweep',
  'moe2-e8c16f5\t1.2777\t0\tkeep\tmerged moe2: Marlin block_m tuning',
].join('\n')

const data = {
  branches: [
    { explores: 'merged best of all branches', found: '1.4x', name: 'main', state: 'exploring' },
    { explores: 'routed experts', found: '1.075x (merged)', name: 'moe', state: 'done' },
    { explores: 'dense GEMVs', found: '1.036x alone', name: 'dense-fusion', state: 'done' },
    { explores: 'FP8 verify attention', found: 'both lose to FA3', name: 'attention2', state: 'dead end' },
    { explores: 'Marlin replacement', found: '1.278x', name: 'Moe2', state: 'Done' },
    { explores: 'overlap', found: '', name: 'overlap', state: 'running' },
  ],
  better: 'higher',
  goal: 2.61,
  metric: 'speedup',
  title: 'Speedup over SGLang',
}

const commit = (sha: string, parents: string[], message: string) => ({ date: null, message, parents, sha })

async function progress(seed: string): Promise<Outcome> {
  const random = rng('progress', seed)
  const { holds, same, steps, violations } = recorder()
  const trunk = impl.steps(main, 'speedup')
  same(
    'trunk',
    [trunk.length, trunk.map((one) => one.merged), trunk.map((one) => one.kept), trunk[4]?.value, trunk[1]?.value],
    [6, [null, 'moe', 'dense-fusion', null, null, 'moe2'], [true, true, true, true, false, true], null, 1.0747],
    'main.tsv',
  )
  same(
    'needs metric',
    [
      Progress.parse(data, undefined),
      Progress.parse({ ...data, metric: '' }, main),
      Progress.parse(data, 'commit\tspeedup\tstatus\nx\t0\tdiscard'),
      Progress.parse(null, main),
    ],
    [undefined, undefined, undefined, undefined],
    'incomplete records',
  )
  const parsed = Progress.parse(data, main)
  same(
    'branches',
    [parsed?.goal, parsed?.better, parsed?.branches.map((one) => [one.name, one.state, one.merged])],
    [
      2.61,
      'higher',
      [
        ['moe', 'done', true],
        ['dense-fusion', 'done', true],
        ['attention2', 'dead end', false],
        ['moe2', 'done', true],
        ['overlap', 'exploring', false],
      ],
    ],
    'branches',
  )
  const history = [
    commit('m4', ['m3', 'b2'], 'merge dense2: tuned GEMVs\n\nspeedup: 1.30'),
    commit('b2', ['b1'], 'dense2: fused pooler'),
    commit('m3', ['m2'], 'tune stages\n\nspeedup: 1.20'),
    commit('b1', ['m1'], 'dense2: tuned GEMVs'),
    commit('m2', ['m1', 'a1'], "Merge branch 'moe' into main\n\nspeedup: 1.10"),
    commit('a1', ['m1'], 'moe: post-expert norm kernel'),
    commit('m1', [], 'baseline\n\nspeedup: 1.00'),
  ]
  const logs = {
    attention: [
      commit('c2', ['c1'], 'attention: FP8 verify kernel loses to FA3'),
      commit('c1', ['m2'], 'attention: start'),
      commit('m2', ['m1', 'a1'], ''),
      commit('m1', [], ''),
    ],
    dense2: [commit('b2', ['b1'], ''), commit('b1', ['m1'], ''), commit('m1', [], '')],
    moe: [commit('a1', ['m1'], ''), commit('m1', [], '')],
    overlap: [commit('o1', ['m3'], 'overlap: side streams'), commit('m3', ['m2'], '')],
  }
  const branches = [
    { name: 'main', sha: 'm4' },
    { name: 'moe', sha: 'a1' },
    { name: 'attention', sha: 'c2' },
    { name: 'dense2', sha: 'b2' },
    { name: 'overlap', sha: 'o1' },
  ]
  const git = Progress.fromGit({ branches, hint: undefined, live: ['overlap'], logs, main: history, trunk: 'main' })
  same(
    'git tree',
    [git?.source, git?.metric, git?.better, git?.main.map((one) => [one.commit, one.merged, one.value])],
    [
      'git',
      'speedup',
      'higher',
      [
        ['m1', null, 1],
        ['m2', 'moe', 1.1],
        ['m3', null, 1.2],
        ['m4', 'dense2', 1.3],
      ],
    ],
    'git main',
  )
  same(
    'git tree',
    git?.branches.map((one) => [one.name, one.merged, one.state, one.from, one.found]),
    [
      ['moe', true, 'done', 'm1', ''],
      ['attention', false, 'dead end', 'm2', 'attention: FP8 verify kernel loses to FA3'],
      ['dense2', true, 'done', 'm1', ''],
      ['overlap', false, 'exploring', 'm3', 'overlap: side streams'],
    ],
    'git branches',
  )
  same(
    'git tree',
    Progress.fromGit({ branches: [{ name: 'main', sha: 'm1' }], hint: undefined, live: [], logs: {}, main: [commit('m1', [], 'first')], trunk: 'main' }),
    undefined,
    'main alone',
  )
  const merges: [string, string | null][] = [
    ['merge moe2: Marlin tuning', 'moe2'],
    ["Merge branch 'dense3' into main", 'dense3'],
    ["Merge remote-tracking branch 'origin/attn-4'", 'attn-4'],
    ['merge dense-fusion - fused router', 'dense-fusion'],
    ['fix the harness', null],
  ]
  for (const [message, want] of merges) same('merges', impl.merges(message), want, message)
  for (let at = 0; at < limits.cases / 4; at++) {
    const rows = Array.from({ length: random.int(1, limits.nodes) }, (_, i) => {
      const kept = random.chance(0.7)
      return [
        'c' + i,
        kept ? (1 + random.int(0, 999) / 1000).toFixed(4) : '0',
        '0',
        kept ? 'keep' : random.pick(['discard', 'crash']),
        random.chance(0.3) ? 'merge b' + i + ': x' : 'step ' + i,
      ].join('\t')
    })
    const tsv = ['commit\tspeedup\tmemory_gb\tstatus\tdescription', ...rows].join('\n')
    const got = impl.steps(tsv, 'speedup')
    holds('trunk', got.length === rows.length, got.length + ' steps for ' + rows.length + ' rows')
    holds(
      'trunk',
      got.every((one, i) => one.kept === rows[i]!.includes('\tkeep\t') && (one.kept ? one.value !== null : one.value === null)),
      'a discard was kept or a kept row lost its value',
    )
    const name = random.pick(['moe', 'dense-fusion', 'attn-4', 'b_2'])
    holds(
      'merges',
      impl.merges(random.pick(['merge ' + name + ': x', "Merge branch '" + name + "' into main", "Merge remote-tracking branch 'origin/" + name + "'"])) ===
        name,
      'missed the branch ' + name,
    )
  }
  return { steps: steps(), violations }
}

type EdgeModule = {
  cached: <T>(env: never, key: string, fresh: number, read: () => Promise<T>, keep?: number, wait?: number) => Promise<T>
  page: (request: Request, version: string, draw: (request: Request) => Promise<{ response: Response; whole: Promise<boolean> }>) => Promise<Response>
  put: (env: never, key: string, value: unknown, keep: number) => void
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function edge(seed: string): Promise<Outcome> {
  const random = rng('edge', seed)
  const { holds, same, steps, violations } = recorder()
  const waited: Promise<unknown>[] = []
  const stored = new Map<string, Response>()
  const globals = globalThis as Record<string, unknown>
  globals['__waited'] = waited
  globals['caches'] = {
    default: {
      match: async (request: Request) => stored.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => void stored.set(request.url, response),
    },
  }
  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'cloudflare:workers'
        ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = (task) => globalThis.__waited.push(task); export class DurableObject {}' }
        : next(specifier, context),
  })
  await import('../host.ts' as string)
  const Edge = (await import('../../src/worker/Edge.ts' as string)) as EdgeModule
  const cached = impl.cached ? impl.cached(Edge.cached) : Edge.cached
  const env = { SWARMS_URL: 'https://swarms.test' } as never
  const settle = async () => void (await Promise.all(waited.splice(0)))
  let reads = 0
  const cold = async () => {
    const n = ++reads
    await sleep(limits.coldMs)
    return n
  }
  const pair = await Promise.all([cached(env, 'cold-' + seed, 5, cold), cached(env, 'cold-' + seed, 5, cold)])
  same('no shared reads', [reads, [...pair].sort()], [2, [1, 2]], 'two cold reads')
  await settle()
  const key = 'idle-' + seed
  const age = random.chance(0.5) ? limits.idleMs : limits.goneMs
  stored.set('https://swarms.test/__cache/' + key, Response.json('old', { headers: { 'x-cached-at': String(Date.now() - age) } }))
  let refreshed = 0
  const refresh = async () => {
    refreshed++
    await sleep(limits.refreshMs)
    return 'new'
  }
  const started = Date.now()
  const answers = await Promise.all(Array.from({ length: random.int(1, 3) }, () => cached(env, key, 10, refresh, limits.keepSeconds)))
  if (age === limits.idleMs) {
    holds(
      'stale answers at once',
      answers.every((one) => one === 'old') && Date.now() - started < limits.edgeFastMs,
      'answered ' + JSON.stringify(answers) + ' after ' + (Date.now() - started) + ' ms',
    )
    await settle()
    same('one refresh', refreshed, 1, 'background refreshes')
    same('one refresh', await cached(env, key, 10, refresh, limits.keepSeconds), 'new', 'after the refresh')
    same('one refresh', refreshed, 1, 'refreshes after reading the new value')
  } else
    holds(
      'gone is read again',
      answers.every((one) => one === 'new'),
      'a value past its keep answered ' + JSON.stringify(answers),
    )
  await settle()
  let draws = 0
  const draw = async (request: Request) => ({ response: new Response(new URL(request.url).host + ' ' + ++draws), whole: Promise.resolve(true) })
  const read = async (url: string) => (await Edge.page(new Request(url), 'v' + seed, draw)).text()
  same(
    'page per host',
    [await read('https://swarms.new/faq'), await read('https://swarms.tempo-dev.workers.dev/faq')],
    ['swarms.new 1', 'swarms.tempo-dev.workers.dev 2'],
    'first draws',
  )
  await settle()
  same(
    'page per host',
    [await read('https://swarms.new/faq'), await read('https://swarms.tempo-dev.workers.dev/faq'), draws],
    ['swarms.new 1', 'swarms.tempo-dev.workers.dev 2', 2],
    'cached draws',
  )
  delete globals['caches']
  delete globals['__waited']
  return { steps: steps(), violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { edge, grove, progress }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('patch'), invariant: 'replay is a no-op', name: 'grove.replay', scenario: 'grove', seeds: ['1', '2', '3'] },
  { flip: mutant('merges'), invariant: 'merges', name: 'progress.merges', scenario: 'progress', seeds: ['1', '2', '3'] },
  { flip: mutant('steps'), invariant: 'trunk', name: 'progress.trunk', scenario: 'progress', seeds: ['1', '2', '3'] },
  { flip: mutant('cached'), invariant: 'no shared reads', name: 'edge.stale', scenario: 'edge', seeds: ['1', '3', '4'] },
]
