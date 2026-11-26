import * as Limits from '../../src/shared/Limits.ts'
import * as Rail from '../../src/shared/Rail.ts'
import * as ResearchBrief from '../../src/shared/ResearchBrief.ts'
import * as Site from '../../src/shared/Site.ts'
import { recorder, rng, type Outcome, type Rng } from './mi.ts'

export const limits = { aboutSpent: 2_000n, cases: 200, cookies: 5, quietMs: 3_000, reloadWaitMs: 10, segments: 4, viewSteps: 12 }

type Pages = { fresh: <T>(name: string, load: () => Promise<T>) => Promise<T>; preload: (name: string, component: unknown) => void }

const impl = {
  open: ResearchBrief.open,
  parse: Rail.parse,
  at: Site.at,
  fresh: null as null | ((pages: Pages, stored: Map<string, string>) => Pages['fresh']),
  viewed: null as
    | null
    | ((swarm: {
        viewed: (shape: object, version: string | null) => unknown
        view: (shape: object) => unknown
      }) => (shape: object, version: string | null) => unknown),
  clean: null as null | ((clean: (text: string) => string | null) => (text: string) => string | null),
  ensure: null as null | ((ensure: (swarm: never) => Promise<void>, swarm: { kv: { delete: (key: string) => void } }) => Promise<void>),
}

const mutants: { [K in keyof typeof impl]: (typeof impl)[K] } = {
  open: (swarms) => ResearchBrief.problems.filter((problem) => swarms[0]?.problem !== problem.id),
  parse: (header) => (header?.includes(Rail.cookie + '=expanded') ? 'expanded' : 'collapsed'),
  at: (path, base = '/swarms') => (/^https?:/.test(path) ? path : base + path),
  fresh: (pages, stored) => (name, load) => {
    stored.clear()
    return pages.fresh(name, load)
  },
  viewed: (swarm) => (shape) => swarm.view(shape),
  clean: (clean) => (text) => (text.trim() ? text.trim() : clean(text)),
  ensure: async (ensure, swarm) => {
    swarm.kv.delete('aboutTried')
    await ensure(swarm as never)
  },
}

function mutant<K extends keyof typeof impl>(key: K) {
  return () => {
    const was = impl[key]
    impl[key] = mutants[key]
    return () => void (impl[key] = was)
  }
}

async function problems(seed: string): Promise<Outcome> {
  const random = rng('problems', seed)
  const { holds, same, steps, violations } = recorder()
  const all = ResearchBrief.problems
  same('ids unique', new Set(all.map((one) => one.id)).size, all.length, 'problem ids')
  for (let at = 0; at < limits.cases / 4; at++) {
    const swarms = Array.from({ length: random.int(0, all.length) }, () => ({ problem: random.chance(0.2) ? null : random.pick(all).id }))
    const taken = new Set(swarms.map((one) => one.problem))
    const free = impl.open(swarms)
    holds(
      'open hides taken',
      free.every((one) => !taken.has(one.id)),
      'a taken problem stayed open for ' + JSON.stringify([...taken]),
    )
    holds('open keeps free', free.length === all.filter((one) => !taken.has(one.id)).length, free.length + ' open for ' + taken.size + ' taken')
  }
  return { steps: steps(), violations }
}

function cookieHeader(random: Rng) {
  const values = ['expanded', 'collapsed', 'expandedx', 'x', '']
  const names = [Rail.cookie, 'x' + Rail.cookie, 'swarms_tz', 'swarms_face', Rail.cookie + 'x']
  return Array.from({ length: random.int(0, limits.cookies) }, () => random.pick(names) + '=' + random.pick(values)).join('; ')
}

async function rail(seed: string): Promise<Outcome> {
  const random = rng('rail', seed)
  const { holds, same, steps, violations } = recorder()
  const table: [string | undefined, Rail.Rail][] = [
    [undefined, 'collapsed'],
    ['', 'collapsed'],
    ['swarms_rail=expanded', 'expanded'],
    ['swarms_tz=UTC; swarms_rail=expanded; swarms_face=x', 'expanded'],
    ['swarms_rail=collapsed', 'collapsed'],
    ['swarms_rail=expandedx', 'collapsed'],
    ['xswarms_rail=expanded', 'collapsed'],
  ]
  for (const [header, want] of table) same('exact cookie', impl.parse(header), want, 'parse ' + JSON.stringify(header))
  for (const rail of ['collapsed', 'expanded'] as const) {
    same('toggle', Rail.toggle(Rail.toggle(rail)), rail, 'toggle twice ' + rail)
    holds('session cookie', !/max-age|expires/.test(Rail.written(rail)), Rail.written(rail))
    same('round trip', impl.parse(Rail.written(rail)), rail, 'parse written ' + rail)
  }
  same('written', Rail.written('expanded'), 'swarms_rail=expanded; path=/; samesite=lax', 'written expanded')
  for (let at = 0; at < limits.cases; at++) {
    const header = cookieHeader(random)
    const want = header.split('; ').some((pair) => pair === Rail.cookie + '=expanded') ? 'expanded' : 'collapsed'
    same('exact cookie', impl.parse(header), want, 'parse ' + JSON.stringify(header))
  }
  return { steps: steps(), violations }
}

function path(random: Rng) {
  const parts = ['s', 'abc', 'v1', 'swarms', 'swarmsx', 'faq', 'ideas', 'assets', 'index.js']
  const body = '/' + Array.from({ length: random.int(0, limits.segments) }, () => random.pick(parts)).join('/')
  return body + (random.chance(0.2) ? '?r=x' : '')
}

async function site(seed: string): Promise<Outcome> {
  const random = rng('site', seed)
  const { holds, same, steps, violations } = recorder()
  same(
    'at',
    [impl.at('/'), impl.at('/s/abc?r=x'), impl.at('/swarms/s/abc'), impl.at('https://example.com/a')],
    ['/swarms/', '/swarms/s/abc?r=x', '/swarms/s/abc', 'https://example.com/a'],
    'at',
  )
  same(
    'strip',
    [Site.strip('/swarms'), Site.strip('/swarms/'), Site.strip('/swarms/v1/swarms/abc'), Site.strip('/swarmsx/ideas'), Site.strip('/ideas')],
    ['/', '/', '/v1/swarms/abc', '/swarmsx/ideas', '/ideas'],
    'strip',
  )
  same('under', [Site.under('/swarms'), Site.under('/swarms/ideas'), Site.under('/swarmsx'), Site.under('/')], [true, true, false, false], 'under')
  const env = { SWARMS_URL: 'https://paradigm.xyz/swarms' }
  same(
    'home',
    [
      Site.home(env),
      Site.home({ SWARMS_URL: 'https://paradigm.xyz/swarms/' }),
      Site.home({ SWARMS_URL: 'https://tunnel.example' }),
      Site.home({ SWARMS_URL: 'https://swarms.new/' }),
    ],
    ['https://paradigm.xyz/swarms', 'https://paradigm.xyz/swarms', 'https://tunnel.example/swarms', 'https://swarms.new'],
    'home',
  )
  same(
    'url',
    [
      Site.url(env, 'https://swarms.tempo-dev.workers.dev/s/abc'),
      Site.url(env, new URL('http://localhost:5199/ideas')),
      Site.url(env, 'https://swarms.new/pequalsnp'),
      Site.url(env, 'http://swarms.new/'),
    ],
    ['https://paradigm.xyz/swarms', 'http://localhost:5199/swarms', 'https://swarms.new', 'http://swarms.new'],
    'url',
  )
  same(
    'prefix',
    ['https://swarms.new/faq', 'https://www.swarms.new/', 'https://swarms.tempo-dev.workers.dev/swarms/faq', 'http://localhost:5300/swarms'].map((one) =>
      Site.prefix(new URL(one)),
    ),
    ['', '/swarms', '/swarms', '/swarms'],
    'prefix',
  )
  same(
    'root base',
    [impl.at('/faq', ''), impl.at('/faq', '/swarms'), Site.strip('/swarms/faq', ''), Site.under('/faq', ''), Site.under('/', '')],
    ['/faq', '/swarms/faq', '/swarms/faq', true, true],
    'root base',
  )
  same(
    'www',
    [Site.www(new URL('https://www.swarms.new/faq?x=1')), Site.www(new URL('https://swarms.new/faq'))],
    ['https://swarms.new/faq?x=1', undefined],
    'www',
  )
  const place = (url: string) => Site.place(new URL(url))
  same(
    'place',
    [
      place('https://swarms.new/pequalsnp'),
      place('https://swarms.new/'),
      place('https://swarms.new/swarms/faq'),
      place('https://swarms.new/swarms/assets/index.js'),
      place('https://swarms.tempo-dev.workers.dev/swarms/faq'),
      place('https://swarms.tempo-dev.workers.dev/swarms'),
      place('https://swarms.tempo-dev.workers.dev/faq'),
    ],
    [
      { path: '/pequalsnp', stray: false },
      { path: '/', stray: false },
      { path: '/faq', stray: true },
      { path: '/assets/index.js', stray: true },
      { path: '/faq', stray: false },
      { path: '/', stray: false },
      { path: '/faq', stray: true },
    ],
    'place',
  )
  const globals = globalThis as Record<string, unknown>
  try {
    same('booted base', Site.root(), '/swarms', 'root on no page')
    globals['location'] = { hostname: Site.domain }
    same('booted base', [Site.root(), impl.at('/s/abc')], ['', '/s/abc'], 'root on ' + Site.domain)
    globals['window'] = {}
    globals['__SWARMS_BOOT__'] = { base: '/swarms' }
    same('booted base', [Site.root(), impl.at('/s/abc')], ['/swarms', '/swarms/s/abc'], 'root booted under the base')
  } finally {
    delete globals['location']
    delete globals['window']
    delete globals['__SWARMS_BOOT__']
  }
  for (let at = 0; at < limits.cases; at++) {
    const one = path(random)
    for (const base of ['/swarms', ''] as const) {
      const placed = impl.at(one, base)
      holds('at once', impl.at(placed, base) === placed, JSON.stringify(one) + ' under ' + JSON.stringify(base) + ' placed twice changed')
      holds('under after at', Site.under(placed.split('?')[0]!, base), JSON.stringify(placed) + ' not under ' + JSON.stringify(base))
      if (base === '' || !Site.under(one.split('?')[0]!, base))
        holds('strip undoes at', Site.strip(placed, base) === one, JSON.stringify(one) + ' came back as ' + JSON.stringify(Site.strip(placed, base)))
    }
  }
  return { steps: steps(), violations }
}

const webPages = '../../src/web/pages.ts'

const harness = { dispatch: '../dispatch.ts', run: '../run.ts' }

async function pages(seed: string): Promise<Outcome> {
  const random = rng('pages', seed)
  const { holds, steps, violations } = recorder()
  const stored = new Map<string, string>()
  let reloads = 0
  const globals = globalThis as Record<string, unknown>
  globals['location'] = { pathname: '/swarms/new', reload: () => void reloads++ }
  globals['sessionStorage'] = {
    getItem: (key: string) => stored.get(key) ?? null,
    removeItem: (key: string) => void stored.delete(key),
    setItem: (key: string, value: string) => void stored.set(key, value),
  }
  try {
    const Pages = (await import(webPages)) as Pages
    const fresh = impl.fresh ? impl.fresh(Pages, stored) : Pages.fresh
    const gone = () => Promise.reject(new Error('Failed to fetch dynamically imported module'))
    const settled = (promise: Promise<unknown>) =>
      Promise.race([
        promise.then(
          () => 'loaded',
          () => 'failed',
        ),
        new Promise((resolve) => setTimeout(() => resolve('reloading'), limits.reloadWaitMs)),
      ])
    const names = ['new', 'docs', 'faq']
    const since = new Map<string, boolean>()
    for (let at = 0; at < limits.cases / 8; at++) {
      const name = random.pick(names)
      const kind = random.pick(['gone', 'gone', 'ok', 'deploy'] as const)
      if (kind === 'deploy') {
        Pages.preload(name, () => null)
        since.set(name, false)
        holds(
          'preload clears',
          !stored.size || [...stored.keys()].every((key) => !key.includes(name)),
          'preload of ' + name + ' left ' + JSON.stringify([...stored]),
        )
        continue
      }
      const before = reloads
      const answer = await settled(fresh(name, kind === 'ok' ? async () => name : gone))
      if (kind === 'ok') {
        holds('loads', answer === 'loaded', name + ' answered ' + answer)
        continue
      }
      const want = since.get(name) ? 'failed' : 'reloading'
      holds(
        'reload once per deploy',
        answer === want && reloads === before + (want === 'reloading' ? 1 : 0),
        name + ' answered ' + answer + ' wanting ' + want + ' after ' + (reloads - before) + ' reloads',
      )
      since.set(name, true)
    }
  } finally {
    delete globals['location']
    delete globals['sessionStorage']
  }
  return { steps: steps(), violations }
}

type Shape = { excerpts: boolean; feed: number }
type Stamped = { stamp: { quiet: boolean; version: string } }
type ViewSwarm = {
  kv: { put: (key: string, value: unknown) => void }
  log: (kind: string, text: string) => void
  view: (shape: Shape) => Stamped
  viewed: (shape: Shape, version: string | null) => Stamped | null
}

async function viewed(seed: string): Promise<Outcome> {
  const random = rng('viewed', seed)
  const { holds, steps, violations } = recorder()
  const { world } = (await import(harness.run)) as unknown as {
    world: (gateway: () => undefined) => { pass: (ms: number) => void; restore: () => void; seed: () => Promise<void>; swarm: ViewSwarm }
  }
  const w = world(() => undefined)
  try {
    await w.seed()
    const shape = { excerpts: true, feed: 0 }
    const ask = impl.viewed ? (impl.viewed(w.swarm as never) as ViewSwarm['viewed']) : w.swarm.viewed.bind(w.swarm)
    const first = w.swarm.view(shape)
    holds('unquiet answers', ask(shape, first.stamp.version) !== null, 'a version not yet quiet answered null')
    w.pass(limits.quietMs)
    let known = w.swarm.view(shape).stamp
    for (let at = 0; at < limits.viewSteps; at++) {
      const change = random.pick(['none', 'log', 'failure', 'other'] as const)
      if (change === 'log') w.swarm.log('status', 'something happened ' + at)
      if (change === 'failure') w.swarm.kv.put('failure', { at: at + 1, code: null, message: 'x' + at, route: '/v1/swarms', status: null })
      w.pass(limits.quietMs)
      const answer = ask(shape, change === 'other' ? 'other' : known.version)
      if (change === 'none') holds('unchanged answers null', answer === null, 'an unchanged quiet view answered ' + JSON.stringify(answer?.stamp))
      else if (change === 'other') holds('other version answers', answer !== null, 'a view asked with another version answered null')
      else
        holds(
          'changed answers',
          answer !== null && answer.stamp.version !== known.version,
          change + ' answered ' + JSON.stringify(answer?.stamp) + ' over ' + known.version,
        )
      known = w.swarm.view(shape).stamp
    }
  } finally {
    w.restore()
  }
  return { steps: steps(), violations }
}

type AboutModule = { clean: (text: string) => string | null; ensure: (swarm: never) => Promise<void>; most: number }

async function about(seed: string): Promise<Outcome> {
  const random = rng('about', seed)
  const { holds, same, steps, violations } = recorder()
  const Dispatch = (await import(harness.dispatch)) as unknown as {
    ana: string
    gateway: () => { route: unknown; sides: string[]; state: { side: string } }
    id: string
    planted: (route: unknown) => Promise<{
      env: unknown
      restore: () => void
      swarm: {
        kv: { delete: (key: string) => void; get: (key: string) => unknown }
        treePledge: (id: string, pledge: object) => Promise<unknown>
        view: (shape: object) => { about: string | null }
      }
    }>
    until: (done: () => boolean) => Promise<void>
  }
  const About = (await import('../../src/worker/About.ts')) as unknown as AboutModule
  const clean = impl.clean ? impl.clean(About.clean) : About.clean
  same(
    'clean',
    [clean('  '), clean('{"model": "x"}'), clean('See https://user:secret@example.com now')],
    [null, null, 'See https://***@example.com now'],
    'clean',
  )
  for (let at = 0; at < limits.cases / 8; at++) {
    const text = random.pick([' ', '{"a": 1}', 'x', 'An answer.', 'https://u:p@h.test/x']).repeat(random.int(1, About.most))
    const kept = clean(text)
    holds(
      'clean',
      kept === null || (kept.length <= About.most && kept === kept.trim() && !kept.startsWith('{') && !/:\/\/[^@/\s]+:[^@/\s]+@/.test(kept)),
      JSON.stringify(text.slice(0, 40)) + ' kept as ' + JSON.stringify(kept?.slice(0, 40)),
    )
  }
  const Flow = (await import('../../src/worker/Flow.ts')) as unknown as {
    rows: (env: unknown, id: string) => Promise<never>
    totals: (rows: never) => { spent: bigint }
  }
  const Runner = (await import('../../src/worker/Runner.ts')) as unknown as { stop: (swarm: unknown) => Promise<void> }
  const g = Dispatch.gateway()
  const w = await Dispatch.planted(g.route)
  const ensure = () => (impl.ensure ? impl.ensure(About.ensure, w.swarm) : About.ensure(w.swarm as never))
  try {
    await ensure()
    same('unfunded asks nothing', [g.sides.length, w.swarm.view({ feed: 0 }).about], [0, null], 'an unfunded swarm')
    await w.swarm.treePledge(Dispatch.id, { amount: '12', contributor: Dispatch.ana, hash: '0x' + '1'.repeat(64), nid: null })
    await Dispatch.until(() => w.swarm.kv.get('dispatcher') !== undefined)
    await ensure()
    same('asked once', g.sides.length, 1, 'asks after funding')
    holds('asked of the orchestrator', /^Not a model pick\./.test(g.sides[0] ?? ''), 'asked ' + JSON.stringify(g.sides[0]))
    same('bad answer not kept', w.swarm.kv.get('about'), undefined, 'a model-pick answer')
    await ensure()
    same('asked once', g.sides.length, 1, 'asks before the retry')
    w.swarm.kv.delete('aboutTried')
    g.state.side = '  A swarm   on whether P = NP.\n'
    await ensure()
    same('asked once', g.sides.length, 2, 'asks after the retry')
    same('stored', w.swarm.view({ feed: 0 }).about, 'A swarm on whether P = NP.', 'about kept')
    same('paid', Flow.totals(await Flow.rows(w.env, Dispatch.id)).spent, limits.aboutSpent, 'spent on the about')
    same('paid', w.swarm.kv.get('aboutOwed'), undefined, 'owed after paying')
    w.swarm.kv.delete('aboutTried')
    await ensure()
    same('asked once', g.sides.length, 2, 'asks once stored')
  } finally {
    await Runner.stop(w.swarm)
    w.restore()
  }
  return { steps: steps(), violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { about, pages, problems, rail, site, viewed }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('open'), invariant: 'open hides taken', name: 'problems.open', scenario: 'problems', seeds: ['1', '2', '3'] },
  { flip: mutant('parse'), invariant: 'exact cookie', name: 'rail.parse', scenario: 'rail', seeds: ['1', '2', '3'] },
  { flip: mutant('at'), invariant: 'at', name: 'site.at', scenario: 'site', seeds: ['1', '2', '3'] },
  { flip: mutant('fresh'), invariant: 'reload once per deploy', name: 'pages.fresh', scenario: 'pages', seeds: ['1', '2', '3'] },
  { flip: mutant('viewed'), invariant: 'unchanged answers null', name: 'viewed.null', scenario: 'viewed', seeds: ['1', '2', '3'] },
  { flip: mutant('clean'), invariant: 'clean', name: 'about.clean', scenario: 'about', seeds: ['1', '2', '3'] },
  { flip: mutant('ensure'), invariant: 'asked once', name: 'about.once', scenario: 'about', seeds: ['1'] },
]

void Limits
