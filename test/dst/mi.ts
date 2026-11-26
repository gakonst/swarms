import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import * as Answer from '../../src/shared/Answer.ts'
import * as Fuzzy from '../../src/shared/Fuzzy.ts'
import * as Limits from '../../src/shared/Limits.ts'
import * as Maths from '../../src/shared/Math.ts'
import * as Prose from '../../src/shared/Prose.ts'
import * as Surface from '../../src/shared/Surface.ts'
import * as Showing from '../../src/web/showing.ts'
import * as Clock from '../../src/worker/Clock.ts'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export const limits = {
  cases: 200,
  clipMost: 80,
  deadlineMs: 2500,
  events: 40,
  micro: 1_000_000,
  sixDecimalsUnder: 0.0001,
  nodes: 30,
  queryMost: 4,
  violations: 20,
  words: 12,
}

export type Rng = { chance: (p: number) => boolean; int: (lo: number, hi: number) => number; next: () => number; pick: <T>(items: readonly T[]) => T }

export function rng(...parts: (number | string)[]): Rng {
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

function shown(value: unknown) {
  return JSON.stringify(value, (_, one: unknown) => (typeof one === 'bigint' ? one + 'n' : one))
}

export function recorder() {
  const violations: Violation[] = []
  let steps = 0
  const fail = (invariant: string, detail: string) => {
    if (violations.length < limits.violations) violations.push({ detail, invariant })
  }
  const same = (invariant: string, got: unknown, want: unknown, what: string) => {
    steps++
    if (shown(got) !== shown(want)) fail(invariant, what + ' gave ' + shown(got) + ', wanted ' + shown(want))
  }
  const holds = (invariant: string, ok: boolean, detail: string) => {
    steps++
    if (!ok) fail(invariant, detail)
  }
  return { fail, holds, same, steps: () => steps, violations }
}

type Format = {
  money: (value: string, token: 'mach' | 'pathusd') => string
  signed: (account: { name: string | null } | undefined, address: string) => string
  usd: (value: string) => string
}

const webFormat = '../../src/web/format.ts'

const Format = (await import(webFormat)) as Format

const impl = {
  clip: Prose.clip,
  match: Fuzzy.match,
  seen: Showing.seen,
  usd: Format.usd,
  read: Surface.read,
  span: Maths.span,
  within: Clock.within,
}

const mutants = {
  clip: (text: string, length: number) => (text.length <= length ? text : text.slice(0, length) + '…'),
  match: (query: string, text: string) => (/[^\x00-\x7f]/.test(text) ? undefined : Fuzzy.match(query, text)),
  seen: (now: Showing.Showing, visible: boolean): Showing.Showing => (visible ? (now === 'away' ? 'queued' : now) : now === 'loading' ? 'loading' : 'away'),
  usd: (value: string) => '$' + Number(value).toFixed(6),
  read: (value: unknown) => {
    const nodes = Array.isArray(value) ? value : ((value as { nodes?: unknown[] } | null)?.nodes ?? [])
    return nodes.flatMap((one) => Surface.read([one]))
  },
  span: (text: string, at: number) => {
    const found = Maths.span(text, at)
    if (found || text[at] !== '$') return found
    const end = text.indexOf('$', at + 1)
    return end > at ? { body: text.slice(at + 1, end), display: false, end: end + 1 } : undefined
  },
  within: async <T>(work: Promise<T>, ms: number) => {
    let timer: Parameters<typeof clearTimeout>[0]
    try {
      return await Promise.race([work, new Promise<undefined>((resolve) => (timer = setTimeout(resolve, ms)))])
    } catch {
      return undefined
    } finally {
      if (ms < 0) clearTimeout(timer)
    }
  },
} as const

function mutant<K extends keyof typeof impl>(key: K) {
  return () => {
    const was = impl[key]
    impl[key] = mutants[key] as never
    return () => void (impl[key] = was)
  }
}

function amount(random: Rng) {
  const micros = random.chance(0.5) ? random.int(0, limits.micro) : random.int(0, limits.micro * 100_000)
  return (micros / limits.micro).toFixed(6)
}

async function format(seed: string): Promise<Outcome> {
  const random = rng('format', seed)
  const { holds, same, steps, violations } = recorder()
  const table: [string, string][] = [
    ['1', '$1.00'],
    ['2.5', '$2.50'],
    ['1.028919', '$1.03'],
    ['1234.567891', '$1,234.57'],
    ['0.996', '$1.00'],
    ['0', '$0.00'],
    ['0.5', '$0.50'],
    ['0.05', '$0.05'],
    ['0.123456', '$0.12'],
    ['0.028264', '$0.028'],
    ['0.000183', '$0.00018'],
    ['0.000001', '$0.000001'],
    ['0.0995', '$0.10'],
  ]
  for (const [value, want] of table) same('usd', impl.usd(value), want, 'usd(' + value + ')')
  same('money', Format.money('1.3', 'mach'), '1.30 MACH', 'money 1.3 mach')
  same('money', Format.money('0.086055', 'pathusd'), '0.086 pathUSD', 'money 0.086055 pathusd')
  const address = '0x7a3f5e1b2c4d6e8f9a0b1c2d3e4f5a6b7c8d9c2e'
  same('signed', Format.signed({ name: 'mira' }, address), '@mira', 'a named account')
  same('signed', Format.signed({ name: null }, address), '0x7a3f…9c2e', 'an unnamed account')
  same('signed', Format.signed(undefined, address), '0x7a3f…9c2e', 'no account')
  for (let at = 0; at < limits.cases; at++) {
    const value = amount(random)
    const shown = impl.usd(value)
    const number = Number(value)
    const digits = shown.replace(/^\$/, '').replace(/,/g, '')
    if (number >= 0.995 || number === 0) holds('usd', /^\$\d{1,3}(,\d{3})*\.\d{2}$/.test(shown), value + ' showed ' + shown)
    else {
      const significant = (digits.split('.')[1] ?? '').replace(/^0+/, '').length
      holds('usd', significant >= 1 && significant <= 2, value + ' showed ' + shown + ' with ' + significant + ' significant figures')
    }
    holds('usd', Math.abs(Number(digits) - number) <= Math.max(0.005, number * 0.05), value + ' showed ' + shown)
    holds('no six decimals', !/\.\d{6}/.test(shown) || number < limits.sixDecimalsUnder, value + ' showed ' + shown)
  }
  return { steps: steps(), violations }
}

const report =
  '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.** It is memory bound.\n\n| Parser | GiB/s |\n| --- | --- |\n| sonic-rs | 1.55 |\n\n' +
  '\x60\x60\x60rust\nlet value = sonic_rs::from_slice(&line)?;\n\x60\x60\x60\n\nNext: measure bandwidth with \x60mbw\x60.'

const pieces = [
  'word',
  'parse',
  'TiB',
  '0.21',
  '**bold run**',
  '*soft*',
  '\x60code_x\x60',
  '[link text](https://x.test/z)',
  '$a_i + b_i$',
  'snake_case',
  'end.',
  'Next.',
]

function balanced(text: string) {
  const body = text.replace(/…/g, '')
  const stars = (body.match(/\*\*/g) ?? []).length
  const ticks = (body.match(/\x60/g) ?? []).length
  const dollars = (body.replace(/\\\$/g, '').match(/\$/g) ?? []).length
  return stars % 2 === 0 && ticks % 2 === 0 && dollars % 2 === 0 && !/\[[^\]]*$/.test(body) && !/\]\([^)]*$/.test(body)
}

async function prose(seed: string): Promise<Outcome> {
  const random = rng('prose', seed)
  const { holds, same, steps, violations } = recorder()
  same(
    'line',
    Prose.line(report),
    '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.** It is memory bound. Next: measure bandwidth with \x60mbw\x60.',
    'line of the report',
  )
  same(
    'line',
    Prose.line('# Plan\n- first item\n- second item\n\nThen a paragraph\nthat wraps.'),
    'Plan · first item · second item · Then a paragraph that wraps.',
    'line of a plan',
  )
  same('clip', impl.clip(Prose.line(report), 40), '**Headline: sonic-rs parses a TiB for…**', 'clip of the report')
  same('clip', impl.clip('see \x60sonic_rs::from_slice\x60 now', 12), 'see \x60sonic_r\x60…', 'clip in code')
  same('clip', impl.clip('a [link text here](https://x.test/z) and more', 10), 'a link…', 'clip in a link')
  same('clip', impl.clip('*one* **two three four five six**', 20), '*one* **two three four…**', 'clip in bold')
  same('clip', impl.clip('short **enough**', 40), 'short **enough**', 'clip of a short line')
  same('clip', impl.clip('Bound $a_i + b_i$ then \\(c_j\\) holds across many rounds of work', 22), 'Bound $a_i + b_i$ then…', 'clip in math')
  same('sentences', Prose.sentences('**A one. B two.** C three. D'), ['**A one.**', '**B two.**', 'C three.', 'D'], 'sentences across bold')
  same('sentences', Prose.sentences('It costs 0.21 per TiB. Next.'), ['It costs 0.21 per TiB.', 'Next.'], 'sentences with a decimal')
  same(
    'sentences',
    Prose.sentences('Show $x_1 = y_1$. Then \\(z\\) follows. Done'),
    ['Show $x_1 = y_1$.', 'Then \\(z\\) follows.', 'Done'],
    'sentences with math',
  )
  same('plain', Prose.plain('**Bold** \x60code_x\x60 [link](https://x.test) 2 * 3 snake_case'), 'Bold code_x link 2 * 3 snake_case', 'plain')
  same('plain', Prose.plain('Bound $a_i + b_i$ and \\(c_j\\)'), 'Bound a_i + b_i and c_j', 'plain math')
  same('line', Prose.line('Claim\n\\[\nx_1 = 2\n\\]\nthen done'), 'Claim $x_1 = 2$ then done', 'line of display math')
  same(
    'summary',
    Answer.opening(report, 'Parse a terabyte'),
    '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.**',
    'opening',
  )
  same('summary', Answer.brief(report, 60), '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs,…**', 'brief')
  same('summary', Answer.excerpt(report, 60), 'Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs,…', 'excerpt')
  for (let at = 0; at < limits.cases; at++) {
    const text = Array.from({ length: random.int(1, limits.words) }, () => random.pick(pieces)).join(' ')
    const length = random.int(4, limits.clipMost)
    const cut = impl.clip(text, length)
    holds('clip whole markup', balanced(cut), JSON.stringify(text) + ' at ' + length + ' cut to ' + JSON.stringify(cut))
    if (text.length <= length) holds('clip keeps short', cut === text, JSON.stringify(text) + ' at ' + length + ' cut to ' + JSON.stringify(cut))
    for (const one of Prose.sentences(text)) holds('sentences whole markup', balanced(one), JSON.stringify(text) + ' gave sentence ' + JSON.stringify(one))
  }
  return { steps: steps(), violations }
}

async function math(seed: string): Promise<Outcome> {
  const random = rng('math', seed)
  const { holds, same, steps, violations } = recorder()
  same('span', impl.span('$x^2$ tail', 0), { body: 'x^2', display: false, end: 5 }, 'inline dollars')
  same('span', impl.span('\\(a_i\\)', 0), { body: 'a_i', display: false, end: 7 }, 'parentheses')
  same('span', impl.span('\\[ a+b \\]', 0), { body: 'a+b', display: true, end: 9 }, 'brackets')
  same('span', impl.span('$$ \\frac{a}{b} $$', 0), { body: '\\frac{a}{b}', display: true, end: 17 }, 'display dollars')
  for (const text of ['$5 and $10', '$ x$', '$x$5', '\\(open', '\\[a\n\nb\\]']) same('span', impl.span(text, 0), undefined, JSON.stringify(text))
  same('normalize', Maths.normalize('so \\(x^2\\) and \\[y\\] end', false), 'so $x^2$ and $$y$$ end', 'normalize')
  same('normalize', Maths.normalize('\\[\na &= b \\\\\n c\n\\]', false), '\n\n$$\na &= b \\\\\nc\n$$\n\n', 'normalize display')
  same('normalize', Maths.normalize('so \\(x\\) and \\[y\\] and $$z$$ end', true), 'so $x$ and $y$ and $z$ end', 'normalize inline')
  same('normalize', Maths.normalize('keep $a$ and $$b$$', false), 'keep $a$ and $$b$$', 'normalize keeps dollars')
  same('normalize', Maths.normalize('code \x60\\(x\\)\x60 and \\$5 \\(y\\)', false), 'code \x60\\(x\\)\x60 and \\$5 $y$', 'normalize outside code')
  same(
    'normalize',
    Maths.normalize('\x60\x60\x60tex\n\\(x\\)\n\x60\x60\x60\n\\(y\\)', false),
    '\x60\x60\x60tex\n\\(x\\)\n\x60\x60\x60\n$y$',
    'normalize outside a fence',
  )
  const prices = '|S| = 2^e·3^{(n−e)/2}, ν = Σ⌊m_j/2⌋ costs $5 and $10'
  same('normalize', Maths.normalize(prices, false), prices, 'normalize prices')
  for (let at = 0; at < limits.cases; at++) {
    const words = Array.from({ length: random.int(2, limits.words) }, () =>
      random.chance(0.4)
        ? '$' + random.int(1, 999) + (random.chance(0.3) ? '.' + random.int(10, 99) : '')
        : random.pick(['costs', 'and', 'or', 'paid', 'x', 'total']),
    )
    const text = words.join(' ')
    for (let i = 0; i < text.length; i++)
      if (text[i] === '$') holds('prices are not math', impl.span(text, i) === undefined, JSON.stringify(text) + ' found math at ' + i)
    holds('prices are not math', Maths.normalize(text, false) === text, JSON.stringify(text) + ' changed when normalized')
  }
  return { steps: steps(), violations }
}

type Timer = { at: number; fire: () => void; id: number }

async function clock(seed: string): Promise<Outcome> {
  const random = rng('clock', seed)
  const { holds, steps, violations } = recorder()
  const real = { clear: globalThis.clearTimeout, set: globalThis.setTimeout }
  let now = 0
  let ids = 0
  const timers = new Map<number, Timer>()
  let cleared = 0
  globalThis.setTimeout = ((fire: () => void, ms: number) => {
    const id = ++ids
    timers.set(id, { at: now + ms, fire, id })
    return id
  }) as never
  globalThis.clearTimeout = ((id: number | undefined) => {
    if (id !== undefined) cleared++
    if (id !== undefined) timers.delete(id)
  }) as never
  const tick = async (ms: number) => {
    now += ms
    for (const timer of [...timers.values()].sort((a, b) => a.at - b.at))
      if (timer.at <= now) {
        timers.delete(timer.id)
        timer.fire()
      }
    for (let i = 0; i < 4; i++) await Promise.resolve()
  }
  try {
    for (let at = 0; at < limits.cases / 4; at++) {
      cleared = 0
      const kind = random.pick(['ready', 'reject', 'stall', 'late'] as const)
      const ms = random.int(1, limits.deadlineMs)
      let settle: { resolve: (value: string) => void; reject: (error: Error) => void } = { reject: () => undefined, resolve: () => undefined }
      const work =
        kind === 'ready'
          ? Promise.resolve('ready')
          : kind === 'reject'
            ? Promise.reject(new Error('unavailable'))
            : new Promise<string>((resolve, reject) => (settle = { reject, resolve }))
      let done = false
      let answer: string | undefined = 'unset'
      void impl.within(work, ms).then((value) => {
        done = true
        answer = value
      })
      await tick(0)
      if (kind === 'ready') holds('ready answers', done && answer === 'ready', 'a ready read answered ' + answer)
      if (kind === 'reject') holds('rejected falls back', done && answer === undefined, 'a rejected read answered ' + answer)
      if (kind === 'stall' || kind === 'late') {
        await tick(ms - 1)
        holds('deadline', !done, 'a stalled read with a ' + ms + ' ms deadline ended ' + 1 + ' ms early')
        await tick(1)
        holds('deadline', done && answer === undefined, 'a stalled read did not fall back at its ' + ms + ' ms deadline')
        if (kind === 'late') settle.reject(new Error('late failure'))
        if (kind === 'stall') settle.resolve('late')
        await tick(0)
      }
      holds('deadline released', cleared === 1 && timers.size === 0, kind + ' read left ' + timers.size + ' timers and cleared ' + cleared)
      timers.clear()
    }
  } finally {
    globalThis.setTimeout = real.set
    globalThis.clearTimeout = real.clear
  }
  return { steps: steps(), violations }
}

const titles = [
  'Does P = NP?',
  'Better post-quantum signatures',
  'Benchmark every open-weight coding model',
  'Port SQLite to Rust',
  'Faster JSON parser',
  'Prove the Riemann hypothesis in Lean',
  'Erdős problems',
  'Paradigm swarms',
  'Compare sorting',
]

function best(query: string, list: readonly string[]) {
  return list
    .map((title) => ({ hit: impl.match(query, title), title }))
    .filter((each) => each.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score)
    .map((each) => each.title)
}

function fold(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

async function fuzzy(seed: string): Promise<Outcome> {
  const random = rng('fuzzy', seed)
  const { holds, same, steps, violations } = recorder()
  const list = titles.slice(0, 6)
  same('match', best('np', list).slice(0, 1), ['Does P = NP?'], 'np')
  same('match', best('quantum', list), ['Better post-quantum signatures'], 'quantum')
  same('match', best('pqs', list)[0], 'Better post-quantum signatures', 'pqs')
  same('match', best('rust port', list), ['Port SQLite to Rust'], 'rust port')
  same('match', best('bench code', list), ['Benchmark every open-weight coding model'], 'bench code')
  same('match', best('jsn', list), ['Faster JSON parser'], 'jsn')
  same('match', best('riemann lean', list), ['Prove the Riemann hypothesis in Lean'], 'riemann lean')
  same('match', best('zzz', list), [], 'zzz')
  same('match', impl.match('', 'anything'), undefined, 'empty query')
  same('match', impl.match('x', 'Faster JSON parser'), undefined, 'absent letter')
  same('rank', best('par', ['Compare sorting', 'Faster JSON parser', 'Paradigm swarms']), ['Paradigm swarms', 'Faster JSON parser', 'Compare sorting'], 'par')
  holds('accents fold', !!impl.match('erdos', 'Erdős problems'), 'erdos missed Erdős problems')
  same('marks', impl.match('np', 'Does P = NP?')?.marks, [9, 10], 'marks of np')
  same(
    'spans',
    Fuzzy.spans('Does P = NP?', [9, 10]),
    [
      { lit: false, text: 'Does P = ' },
      { lit: true, text: 'NP' },
      { lit: false, text: '?' },
    ],
    'spans of np',
  )
  holds(
    'same',
    Fuzzy.same('Solve P = NP.', 'Solve P = NP.') && Fuzzy.same('solve p=np', 'Solve P = NP.') && Fuzzy.same('Café', 'cafe'),
    'a repeated title was not the same',
  )
  holds('same', !Fuzzy.same('Solve P = NP. Work in the open.', 'Solve P = NP.'), 'a longer goal counted as the title')
  for (let at = 0; at < limits.cases; at++) {
    const title = random.pick(titles)
    const from = random.int(0, title.length - 1)
    const piece = title.slice(from, from + random.int(1, limits.queryMost + 2)).split(/\s/)[0] ?? ''
    if (!piece) continue
    const query = [...piece].map((ch) => (random.chance(0.5) ? ch.toUpperCase() : fold(ch))).join('')
    const hit = impl.match(query, title)
    holds('substring matches', !!hit && hit.exact, JSON.stringify(query) + ' missed ' + JSON.stringify(title))
    if (!hit) continue
    const marked = hit.marks.map((i) => fold(title[i] ?? '')).join('')
    holds(
      'marks cover the query',
      marked === fold(query) && hit.marks.every((m, i) => i === 0 || m > hit.marks[i - 1]!),
      JSON.stringify(query) + ' on ' + JSON.stringify(title) + ' marked ' + JSON.stringify(hit.marks),
    )
    holds(
      'spans rebuild',
      Fuzzy.spans(title, hit.marks)
        .map((one) => one.text)
        .join('') === title,
      'spans of ' + JSON.stringify(title) + ' lost text',
    )
  }
  return { steps: steps(), violations }
}

function node(random: Rng, at: number): unknown {
  const id = random.chance(0.2) ? 'dup' : 'n' + at
  const kind = random.pick(['stats', 'checklist', 'chart', 'graph', 'attention', 'list', 'meter', 'estimate', 'range', 'tiles', 'text', 'status'])
  if (random.chance(0.05)) return 'not a node'
  if (kind === 'meter') return { id, kind, max: random.int(1, 2000), value: random.int(-10, 3000) }
  if (kind === 'range' || kind === 'estimate') return { high: random.int(0, 9), id, kind, low: random.int(0, 9), mid: random.int(0, 9) }
  if (kind === 'text') return { id, kind, text: random.chance(0.8) ? 'x' : '' }
  if (kind === 'chart')
    return {
      id,
      kind,
      points: [1, '1.07', 'x', 1.4],
      tried: [
        [2, 1.1],
        ['x', 1],
      ],
    }
  return {
    id,
    items: Array.from({ length: random.int(0, 4) }, (_, i) =>
      random.chance(0.5) ? { label: 'l' + i, state: 'done', text: 't' + i, value: String(i) } : 't' + i,
    ),
    kind,
  }
}

async function surface(seed: string): Promise<Outcome> {
  const random = rng('surface', seed)
  const { holds, same, steps, violations } = recorder()
  const nodes = impl.read({
    nodes: [
      { id: 'stats', items: [{ label: 'best', value: '1.40×' }, { label: 'no value' }], kind: 'stats' },
      { id: 'plan', items: [{ state: 'done', text: 'Baseline' }, { state: 'running', text: 'Attention' }, 'Glue fusion'], kind: 'checklist' },
      {
        goal: 2.61,
        id: 'chart',
        kind: 'chart',
        points: [1, '1.07', 1.4],
        tried: [
          [2, 1.1],
          ['x', 1],
        ],
      },
      { id: 'map', kind: 'graph', nodes: [] },
      {
        id: 'needs',
        items: [
          { amount: '$5', text: 'Fund the attention rewrite', why: 'It is the slowest part' },
          { action: 'lend', text: 'Lend a Hand that knows CUTLASS' },
        ],
        kind: 'attention',
      },
      { id: 'empty', items: [], kind: 'list' },
      'not a node',
    ],
  })
  same(
    'kinds',
    nodes.map((one) => one.kind),
    ['asks', 'stats', 'checklist', 'chart'],
    'kinds read',
  )
  const [asks, stats, plan, chart] = nodes
  same('asks', asks?.kind === 'asks' && asks.items.map((one) => one.action), ['back', 'chat'], 'ask actions')
  same('stats', stats?.kind === 'stats' && stats.items.length, 1, 'stats kept')
  same('checklist', plan?.kind === 'checklist' && plan.items.map((one) => one.state), ['done', 'doing', 'todo'], 'checklist states')
  same('chart', chart?.kind === 'chart' && [chart.points, chart.tried], [[1, 1.07, 1.4], [[2, 1.1]]], 'chart points')
  const ranged = impl.read([
    { id: 'tests', kind: 'meter', max: 1248, value: 1300 },
    { id: 'tests', kind: 'meter', max: 2, value: 1 },
    { high: 3.8, id: 'est', kind: 'estimate', low: 1.2, mid: 2.1, unit: 'T' },
    { high: 4, id: 'bad', kind: 'range', low: 3, mid: 2 },
    { id: 'files', items: [{ label: 'parser.rs', state: 'tested' }, { label: 'ffi.rs', state: 'porting' }, 'utils.rs'], kind: 'tiles' },
  ])
  same(
    'unique ids',
    ranged.map((one) => one.id),
    ['tests', 'est', 'files'],
    'ids kept',
  )
  same('in range', ranged[0]?.kind === 'meter' && ranged[0].value, 1248, 'meter value')
  same('tones', ranged[2]?.kind === 'tiles' && ranged[2].items.map((one) => one.tone), ['good', 'warn', null], 'tile tones')
  same(
    'capped',
    impl.read(Array.from({ length: 40 }, (_, i) => ({ id: String(i), kind: 'text', text: 'x' }))).length,
    Limits.SharedSurface.most,
    'forty text nodes',
  )
  same('parse', Surface.parse('not json'), [], 'not json')
  same('parse', Surface.parse('{"kind":"text","text":"x"}'), [], 'a bare node')
  same(
    'is',
    [Surface.is({ form: 'json', slug: 'surface', title: 'Surface' }), Surface.is({ form: 'page', slug: 'surface', title: 'Surface' })],
    [true, false],
    'is surface',
  )
  const grid = impl.read({
    nodes: [
      { id: 's', items: ['one', 'two'], kind: 'status' },
      { id: 't', items: Array.from({ length: 60 }, (_, i) => ({ label: String(i + 1), state: 'open' })), kind: 'tiles' },
    ],
  })
  same('status apart', Surface.status(grid), ['one', 'two'], 'status')
  same(
    'status apart',
    Surface.shown(grid).map((one) => one.kind),
    ['tiles'],
    'shown kinds',
  )
  same('tiles whole', grid[1]?.kind === 'tiles' && grid[1].items.length, 60, 'tiles kept')
  for (let at = 0; at < limits.cases / 4; at++) {
    const read = impl.read(Array.from({ length: random.int(0, limits.nodes) }, (_, i) => node(random, i)))
    const ids = read.map((one) => one.id)
    holds('unique ids', new Set(ids).size === ids.length, 'ids ' + JSON.stringify(ids))
    holds('capped', read.length <= Limits.SharedSurface.most, read.length + ' nodes read')
    for (const one of read) {
      if (one.kind === 'meter') holds('in range', one.value >= 0 && one.value <= one.max, 'meter ' + one.value + ' of ' + one.max)
      if (one.kind === 'range') holds('in range', one.low <= one.mid && one.mid <= one.high, 'range ' + [one.low, one.mid, one.high].join(' '))
    }
  }
  return { steps: steps(), violations }
}

async function showing(seed: string): Promise<Outcome> {
  const random = rng('showing', seed)
  const { holds, same, steps, violations } = recorder()
  same('queue then load', [impl.seen('away', true), Showing.granted('queued'), Showing.loaded('loading')], ['queued', 'loading', 'shown'], 'away to shown')
  for (const now of ['away', 'queued', 'loading', 'shown'] as const) same('leaves', impl.seen(now, false), 'away', now + ' off screen')
  same('stays', [impl.seen('loading', true), impl.seen('shown', true)], ['loading', 'shown'], 'on screen again')
  same(
    'late grant',
    [Showing.granted('away'), Showing.granted('shown'), Showing.loaded('shown'), Showing.loaded('away')],
    ['away', 'shown', 'shown', 'away'],
    'late events',
  )
  for (let run = 0; run < limits.cases / 10; run++) {
    let state: Showing.Showing = 'away'
    let model: Showing.Showing = 'away'
    for (let at = 0; at < limits.events; at++) {
      const event = random.pick(['on', 'off', 'grant', 'load'] as const)
      const before = state
      state =
        event === 'on' ? impl.seen(state, true) : event === 'off' ? impl.seen(state, false) : event === 'grant' ? Showing.granted(state) : Showing.loaded(state)
      model =
        event === 'off'
          ? 'away'
          : event === 'on'
            ? model === 'away'
              ? 'queued'
              : model
            : event === 'grant'
              ? model === 'queued'
                ? 'loading'
                : model
              : model === 'loading'
                ? 'shown'
                : model
      holds('transitions', state === model, before + ' on ' + event + ' went to ' + state + ', wanted ' + model)
      holds('holds a slot only loading', Showing.holds(state) === (state === 'loading'), state + ' holds ' + Showing.holds(state))
      holds('framed once granted', Showing.framed(state) === (state === 'loading' || state === 'shown'), state + ' framed ' + Showing.framed(state))
    }
  }
  return { steps: steps(), violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { clock, format, fuzzy, math, prose, showing, surface }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  { flip: mutant('usd'), invariant: 'usd', name: 'format.usd', scenario: 'format', seeds: ['1', '2', '3'] },
  { flip: mutant('clip'), invariant: 'clip whole markup', name: 'prose.clip', scenario: 'prose', seeds: ['1', '2', '3'] },
  { flip: mutant('span'), invariant: 'prices are not math', name: 'math.span', scenario: 'math', seeds: ['1', '2', '3'] },
  { flip: mutant('within'), invariant: 'deadline released', name: 'clock.within', scenario: 'clock', seeds: ['1', '2', '3'] },
  { flip: mutant('match'), invariant: 'accents fold', name: 'fuzzy.match', scenario: 'fuzzy', seeds: ['1', '2', '3'] },
  { flip: mutant('read'), invariant: 'unique ids', name: 'surface.read', scenario: 'surface', seeds: ['1', '2', '3'] },
  { flip: mutant('seen'), invariant: 'leaves', name: 'showing.seen', scenario: 'showing', seeds: ['1', '2', '3'] },
]

export function checker(fail: (invariant: string, detail: string) => void, count: () => void) {
  let at = 'check'
  const show = (value: unknown) => JSON.stringify(value, (_, one: unknown) => (typeof one === 'bigint' ? one + 'n' : one))?.slice(0, 300)
  const check = (ok: boolean, detail: string, note?: unknown) => {
    count()
    if (!ok) fail(at, (typeof note === 'string' ? note + ': ' : '') + detail)
  }
  return {
    as: (name: string) => void (at = name),
    deepEqual: (got: unknown, want: unknown, note?: unknown) => check(isDeepStrictEqual(got, want), show(got) + ' is not ' + show(want), note),
    doesNotMatch: (got: string, pattern: RegExp, note?: unknown) => check(!pattern.test(got), show(got) + ' matches ' + pattern, note),
    equal: (got: unknown, want: unknown, note?: unknown) => check(Object.is(got, want), show(got) + ' is not ' + show(want), note),
    match: (got: string, pattern: RegExp, note?: unknown) => check(pattern.test(got), show(got) + ' does not match ' + pattern, note),
    notEqual: (got: unknown, want: unknown, note?: unknown) => check(!Object.is(got, want), show(got) + ' equals ' + show(want), note),
    ok: (value: unknown, note?: unknown) => check(!!value, 'not true', note),
    rejects: async (promise: Promise<unknown>, pattern?: RegExp) => {
      const error = await promise.then(
        () => undefined,
        (thrown: unknown) => thrown,
      )
      check(
        error !== undefined && (!pattern || pattern.test(String((error as Error)?.message ?? error))),
        'did not reject' + (pattern ? ' with ' + pattern : ''),
      )
    },
  }
}

export type Checker = ReturnType<typeof checker>
