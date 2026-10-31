import * as Answer from '../shared/Answer.ts'
import type { Budget, BudgetRequested, Budgeted, Config, Contributed, Contribution, Currency, Detail, Entry, Kind, Note, Pledge, Pledged, Requested, Researcher, Round, Status, Summary, Token } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'

type Line = readonly [Kind, string, (string | null)?]

type Live = Omit<Detail, 'answer'> & { cursor: number; flicker: readonly string[]; next: number; script: readonly Line[]; steered: Set<string> }

const minute = 60_000

const started = Date.now()

export const visitor = '0x7a3f5e1b2c4d6e8f9a0b1c2d3e4f5a6b7c8d9c2e'

export const balance = 1_250_000n

export const balances: Record<Currency, bigint> = { mach: balance, ousd: 420_000n, pathusd: 3_000_000n, usdce: 8_750_000n }

const wallet = '0x3c93fC3eA108A4E738c10f64c4360d53C9415e5F'

const people = [
  visitor,
  '0x1d9c40e7b25a8f3c6e01d4b7a9f2c58e3b6d0a41',
  '0xe2b8a6c4d0f1937a5b8c2e4d6f0a1b3c5d7e9f80',
  '0x4f60c1a9e8d7b6c5a4f3e2d1c0b9a8f7e6d5c4b3',
  '0x93ab7e21c4d5f6a7b8c9d0e1f2a3b4c5d6e7f812',
  '0xc0ffee254729296a45a3885639ac7e10f9d54979',
  '0x5aeda56215b167893e80b4fe645ba6d5bab767de',
  '0x2bd8e1f0c3a4b5d6e7f8091a2b3c4d5e6f7a8b9c',
  '0x8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f',
] as const satisfies readonly `0x${string}`[]

const requested = new Map<string, { amount: string; note: string | null; token: Currency }>()

const allowances = new Map<string, { amount: string; note: string | null; token: Token }>()

function at(minutes: number) {
  return started - minutes * minute
}

function id(seed: string) {
  let value = 0x811c9dc5
  for (const char of seed) value = Math.imul(value ^ char.charCodeAt(0), 0x01000193) >>> 0
  return value.toString(16).padStart(8, '0')
}

function add(values: readonly string[]) {
  return decimal(values.reduce((sum, value) => sum + units(value), 0n))
}

function build(input: {
  age: number
  flicker?: readonly string[]
  goal: string
  hands?: readonly string[]
  history: readonly Round[]
  id: string
  lines: readonly Line[]
  budgets?: readonly (readonly [number, string, Token, string, string, Budget['status'], number, string | null])[]
  gifts?: readonly (readonly [number, string, Token, number, string | null, Contribution['kind']])[]
  pledges: readonly (readonly [number, string, number, string | null, Currency?])[]
  script?: readonly Line[]
  spent: string
  status: Status
  steered?: readonly string[]
  title: string
  workers: number
}): Live {
  const pledges = input.pledges.map(([person, amount, minutes, note, token], index): Pledge => ({
    amount,
    at: at(minutes),
    contributor: people[person] ?? visitor,
    id: id(`${input.id}:${index}`),
    note,
    spent: '0',
    status: 'active',
    token: token ?? 'mach',
  }))
  const contributions = (input.gifts ?? []).map(([person, amount, token, minutes, note, kind], index): Contribution => ({
    amount,
    at: at(minutes),
    budget: kind === 'pull' ? id(`${input.id}:budget:${person}`) : null,
    contributor: people[person] ?? visitor,
    hash: `0x${id(`${input.id}:gift:${index}`).repeat(8)}`,
    kind,
    note,
    token,
  }))
  const budgets = (input.budgets ?? []).map(([person, amount, token, pulled, left, status, minutes, note]): Budget => ({
    amount,
    at: at(minutes),
    contributor: people[person] ?? visitor,
    detail: status === 'waiting' ? 'Used up for this period.' : status === 'revoked' ? 'Revoked in Tempo Wallet.' : null,
    expiresAt: started + 29 * 86_400_000,
    id: id(`${input.id}:budget:${person}`),
    left,
    nextAt: status === 'waiting' ? started + 5 * 3_600_000 : null,
    note,
    period: 86_400,
    pulled,
    status,
    token,
  }))
  const feed = input.lines.map(([kind, text, detail], index): Entry => ({
    at: at(input.lines.length - index) + (index % 3) * 11_000,
    detail: detail ?? null,
    kind,
    round: Math.max(1, input.history.length),
    seq: index + 1,
    text,
  }))
  return settle({
    budgets,
    contributions,
    contributors: 0,
    createdAt: at(input.age),
    cursor: 0,
    daily: '0',
    feed,
    flicker: input.flicker ?? [],
    goal: input.goal,
    hands: (input.hands ?? []).map((name) => ({ connected: true, name })),
    history: [...input.history],
    id: input.id,
    machines: 0,
    next: started + 1200,
    notes: [],
    parallel: 1,
    pledges,
    pool: '0',
    raised: '0',
    remaining: '0',
    rounds: input.history.length,
    wallet: input.budgets || input.gifts ? wallet : null,
    script: input.script ?? [],
    spent: input.spent,
    status: input.status,
    steered: new Set(input.steered ?? []),
    title: input.title,
    updatedAt: feed.at(-1)?.at ?? at(input.age),
    workers: input.workers,
  })
}

function settle(swarm: Live) {
  const given = swarm.contributions.reduce((sum, gift) => sum + units(gift.amount), 0n)
  const raised = swarm.pledges.reduce((sum, pledge) => sum + units(pledge.amount), 0n) + given
  let left = units(swarm.spent)
  for (const pledge of swarm.pledges) {
    const spent = left < units(pledge.amount) ? left : units(pledge.amount)
    left -= spent
    pledge.spent = decimal(spent)
    pledge.status = swarm.status === 'done' ? 'ended' : spent === units(pledge.amount) ? 'spent' : 'active'
  }
  swarm.raised = decimal(raised)
  swarm.remaining = decimal(raised > units(swarm.spent) ? raised - units(swarm.spent) : 0n)
  swarm.parallel = Math.min(4, 1 + Number(units(swarm.remaining) / 100_000n))
  swarm.contributors = new Set([...swarm.pledges.map((pledge) => pledge.contributor), ...swarm.contributions.map((gift) => gift.contributor), ...swarm.budgets.flatMap((budget) => (budget.contributor ? [budget.contributor] : []))]).size
  swarm.daily = decimal(swarm.budgets.filter((budget) => budget.status === 'active' || budget.status === 'waiting').reduce((sum, budget) => sum + units(budget.amount), 0n))
  swarm.pool = decimal(given > units(swarm.spent) / 2n ? given - units(swarm.spent) / 2n : 0n)
  swarm.machines = swarm.hands.filter((hand) => hand.connected).length
  const groups = new Map<string, (Pledge | Contribution)[]>()
  for (const backing of [...swarm.pledges, ...swarm.contributions]) if (backing.note) groups.set(backing.note, [...(groups.get(backing.note) ?? []), backing])
  swarm.notes = [...groups]
    .map(([note, pledges]): Note => {
      const weight = pledges.reduce((sum, pledge) => sum + units(pledge.amount), 0n)
      return {
        backers: new Set(pledges.map((pledge) => pledge.contributor)).size,
        id: id(`${swarm.id}:${note}`),
        note,
        share: raised > 0n ? Number((weight * 10_000n) / raised) / 10_000 : 0,
        steered: swarm.steered.has(note),
        weight: decimal(weight),
      }
    })
    .sort((a, b) => b.share - a.share)
  return swarm
}

function push(swarm: Live, kind: Kind, text: string, detail: string | null, when: number) {
  const seq = (swarm.feed.at(-1)?.seq ?? 0) + 1
  swarm.feed.push({ at: when, detail, kind, round: Math.max(1, swarm.rounds), seq, text })
  swarm.updatedAt = when
}

function tick(swarm: Live) {
  if (swarm.status !== 'running' || swarm.script.length === 0) return
  const now = Date.now()
  for (const name of swarm.flicker) {
    const connected = Math.floor(now / 9000 + name.length) % 3 !== 0
    const hand = swarm.hands.find((item) => item.name === name)
    if (connected && !hand) {
      swarm.hands.push({ connected: true, name })
      push(swarm, 'machine', `Machine ${name} joined the swarm.`, null, now)
    }
    if (!connected && hand) {
      swarm.hands = swarm.hands.filter((item) => item.name !== name)
      push(swarm, 'machine', `Machine ${name} left.`, null, now)
    }
  }
  while (swarm.next <= now) {
    const line = swarm.script[swarm.cursor % swarm.script.length]
    swarm.cursor++
    if (line) push(swarm, line[0], line[1], line[2] ?? null, swarm.next)
    if (line?.[0] === 'tool') swarm.spent = add([swarm.spent, '0.000870'])
    swarm.next += 1300 + ((swarm.cursor * 7919) % 2900)
  }
  settle(swarm)
}

const benchmark: readonly Line[] = [
  ['tool', 'Spawned an explorer: rust-subset', 'Write 50 small Rust tasks with hidden tests (parsing, lifetimes, async). Run every model in the shortlist against them with the same harness and record solve rate, latency and MACH per task.'],
  ['thinking', 'Cost per solved task carries the most weight among the notes, so every explorer reports MACH spent next to its solve count. Qwen3-Coder is slow; give it its own machine so it does not hold the others back.'],
  ['machine', 'Starting machine sb-c41d9e07 (python:3.12-slim)', '{"attach":"sb-c41d9e07","image":"python:3.12-slim","cpu":2,"memory":4096}'],
  ['tool', '$ git clone --depth 1 https://github.com/princeton-nlp/SWE-bench && pip install -q -e SWE-bench on sb-c41d9e07', "Cloning into 'SWE-bench'...\nSuccessfully installed swebench-3.0.4"],
  ['tool', '$ python -m swebench.harness.run_evaluation --dataset_name princeton-nlp/SWE-bench_Lite --max_workers 4 --run_id glm-5.3 on sb-3f9a2c1d', 'Running 75 instances...\n31 resolved, 44 unresolved\nTotal cost: 0.0612 MACH'],
  ['message', 'Explorer swe-lite-a finished its slice: GLM-5.3 resolved 31 of 75 SWE-bench Lite tasks (41%) at 0.0020 MACH per resolved task, median 94 s per task.'],
  ['tool', 'Waiting on explorers'],
  ['funds', '0x1d9c…0a41 pledged 0.25 MACH behind "Report cost per solved task, not per token".'],
  ['steer', 'Steering: "Report cost per solved task, not per token" now has 1.45 MACH behind it (34.1% of everything raised, 3 backers).'],
  ['tool', '$ cargo test --release -q 2>&1 | tail -3 on sb-77ab01e2', 'test result: ok. 37 passed; 13 failed; 0 ignored\nkimi-k2.7: 37/50'],
  ['error', 'compute_create failed', '{"code":"unavailable","detail":"Modal has no capacity for a T4 in us-east right now."}'],
  ['thinking', 'No T4 in us-east. The Rust subset is CPU-bound anyway; retry on a 4-CPU machine in the same region instead of moving to eu-west and paying the broad-region rate.'],
  ['machine', 'Starting machine sb-d2f81a33 (rust:1.90-slim)', '{"attach":"sb-d2f81a33","image":"rust:1.90-slim","cpu":4}'],
  ['tool', 'Ran a script: const rows = await Promise.all(models.map((model) => score(model)))', 'const rows = await Promise.all(models.map((model) => score(model)))\nconsole.table(rows)'],
  ['message', 'Explorer rust-subset: Kimi K2.7 passes 37 of 50 Rust tasks, DeepSeek V4.1 Flash 33, GLM-5.3 35. DeepSeek is the cheapest per pass at 0.0004 MACH.'],
  ['tool', 'Called kv_set', '{"app":"swarm","key":"results/round-3/rust-subset","value":{"kimi-k2.7":37,"deepseek-v4.1-flash":33,"glm-5.3":35}}'],
]

const parser: readonly Line[] = [
  ['tool', '$ ./bench --parser sonic-rs --threads 8 --input /data/logs-64g.ndjson on sb-91e0aa4f', 'sonic-rs: 64.0 GiB in 41.2 s (1.55 GiB/s)'],
  ['tool', '$ ./bench --parser simd-json --threads 8 --input /data/logs-64g.ndjson on sb-5c2b7d10', 'simd-json: 64.0 GiB in 46.9 s (1.36 GiB/s)'],
  ['thinking', 'Both are memory-bound past 8 threads. The interesting axis is now cost: a 16-CPU machine at twice the rate only buys 30% more throughput.'],
  ['message', 'sonic-rs leads on 8 CPUs at 1.55 GiB/s. Next: the same run on 16 CPUs to see where scaling flattens.'],
  ['tool', 'Waiting on explorers'],
  ['tool', '$ nproc on sb-91e0aa4f', '8'],
]

const translation: readonly Line[] = [
  ['tool', '$ wc -w src/ch04-01-what-is-ownership.md on sb-0e4ab219', '4127 src/ch04-01-what-is-ownership.md'],
  ['thinking', 'Keep code blocks and identifiers in English; translate prose and comments. "Borrowing" becomes δανεισμός, which the Greek Rust community already uses.'],
  ['message', 'Chapter 4.1 is translated (4,127 words). Opening a pull request against the glossary first so later chapters stay consistent.'],
  ['tool', 'Called bucket_put', '{"key":"rust-book-el/ch04-01.md","size":31204}'],
]

const fixtures: Live[] = [
  build({
    age: 190,
    flicker: ['sb-d2f81a33'],
    goal: 'Run a fair, reproducible coding benchmark across every tool-calling model on the Tempo gateway. Use SWE-bench Lite and a 50-task Rust subset written for this run. Report solve rate, median latency and cost per solved task in MACH, with the exact prompts and harness settings so anyone can rerun it.',
    hands: ['sb-3f9a2c1d', 'sb-77ab01e2', 'sb-c41d9e07'],
    history: [
      {
        endedAt: at(150),
        message: 'Round 1: harness and shortlist.\n\nThe gateway lists 31 text models; 19 call tools and qualify. I built the harness on two python:3.12-slim machines and ran a 20-task smoke test on each model.\n\nShortlist for full runs: GLM-5.3, Kimi K2.7, DeepSeek V4.1 Flash, Qwen3-Coder, gpt-oss-120b, Llama 4 Scout.\nDropped: 13 models that solved fewer than 2 of 20.\n\nSpent 0.41 MACH, most of it on the smoke test.',
        n: 1,
        spent: '0.412800',
        startedAt: at(185),
        status: 'completed',
      },
      {
        endedAt: at(48),
        message: 'Round 2: SWE-bench Lite.\n\nFour explorers, each on its own machine, ran 75 tasks per model.\n\nKimi K2.7       118/300  39%  0.0031 MACH per solved task\nGLM-5.3         124/300  41%  0.0020\nDeepSeek V4.1   109/300  36%  0.0006\ngpt-oss-120b     92/300  31%  0.0011\n\nQwen3-Coder timed out on 40 tasks; it gets a dedicated machine next round, as the top note asks.',
        n: 2,
        spent: '0.981200',
        startedAt: at(146),
        status: 'completed',
      },
      { endedAt: null, message: null, n: 3, spent: '0.479412', startedAt: at(46), status: 'running' },
    ],
    budgets: [
      [2, '1.000000', 'usdce', '2.400000', '0.360000', 'active', 160, 'Report cost per solved task, not per token'],
      [5, '0.500000', 'pathusd', '1.500000', '0.000000', 'waiting', 120, null],
      [7, '0.250000', 'usdce', '0.250000', '0.000000', 'revoked', 90, 'Skip models without tool calling'],
    ],
    gifts: [
      [0, '2.000000', 'usdce', 140, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow', 'transfer'],
      [2, '0.640000', 'usdce', 70, 'Report cost per solved task, not per token', 'pull'],
      [5, '0.500000', 'pathusd', 52, null, 'pull'],
      [3, '0.250000', 'ousd', 31, 'Publish the harness as a repo anyone can fork', 'transfer'],
      [2, '0.400000', 'usdce', 12, 'Report cost per solved task, not per token', 'pull'],
    ],
    id: 'bench-coders',
    lines: [
      ['status', 'Round 3 started with 2.68 MACH left and room for 4 parallel explorers.'],
      ['steer', 'Steering: "Include Qwen3-Coder and Kimi K2.7 even if they are slow" has 1.55 MACH behind it (36.5% of everything raised, 3 backers).'],
      ...benchmark,
    ],
    pledges: [
      [1, '1.000000', 180, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
      [2, '0.500000', 170, 'Report cost per solved task, not per token'],
      [3, '0.250000', 150, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
      [4, '0.600000', 120, 'Publish the harness as a repo anyone can fork'],
      [5, '0.250000', 95, null],
      [6, '0.700000', 60, 'Report cost per solved task, not per token'],
      [7, '0.250000', 40, 'Skip models without tool calling'],
      [8, '0.150000', 22, 'Try a second pass at temperature 0'],
      [0, '0.300000', 9, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow', 'usdce'],
      [1, '0.250000', 3, 'Report cost per solved task, not per token'],
    ],
    script: benchmark,
    spent: '1.873412',
    status: 'running',
    steered: ['Include Qwen3-Coder and Kimi K2.7 even if they are slow', 'Report cost per solved task, not per token', 'Publish the harness as a repo anyone can fork'],
    title: 'Benchmark every open-weight coding model',
    workers: 4,
  }),
  build({
    age: 70,
    goal: 'Find the fastest and the cheapest way to parse a terabyte of newline-delimited JSON logs on rented machines. Compare serde_json, simd-json and sonic-rs across machine sizes and report GiB/s and MACH per TiB.',
    hands: ['sb-91e0aa4f', 'sb-5c2b7d10'],
    history: [
      { endedAt: at(31), message: 'Round 1: generated 64 GiB of synthetic access logs and a harness that streams them through each parser.\nsonic-rs 1.55 GiB/s, simd-json 1.36 GiB/s, serde_json 0.41 GiB/s on 8 CPUs.', n: 1, spent: '0.180000', startedAt: at(66), status: 'completed' },
      { endedAt: null, message: null, n: 2, spent: '0.052100', startedAt: at(29), status: 'running' },
    ],
    budgets: [[4, '0.250000', 'pathusd', '0.180000', '0.070000', 'active', 40, 'Measure cost per GiB, not just throughput']],
    gifts: [[4, '0.180000', 'pathusd', 38, 'Measure cost per GiB, not just throughput', 'pull']],
    id: 'json-terabyte',
    lines: [['status', 'Round 2 started with 0.62 MACH left and room for 4 parallel explorers.'], ...parser],
    pledges: [
      [3, '0.500000', 68, 'Measure cost per GiB, not just throughput'],
      [5, '0.250000', 30, null],
      [6, '0.100000', 12, 'Include serde_json as the baseline'],
    ],
    script: parser,
    spent: '0.232100',
    status: 'running',
    steered: ['Measure cost per GiB, not just throughput'],
    title: 'Parse a terabyte of JSON for under a dollar',
    workers: 2,
  }),
  build({
    age: 30,
    goal: 'Translate The Rust Programming Language into Greek, chapter by chapter, with a shared glossary so terms stay consistent. Publish each chapter to the bucket as it is finished.',
    hands: ['sb-0e4ab219'],
    history: [{ endedAt: null, message: null, n: 1, spent: '0.120000', startedAt: at(28), status: 'running' }],
    id: 'rust-book-el',
    lines: [['status', 'Round 1 started with 0.60 MACH left and room for 4 parallel explorers.'], ...translation],
    pledges: [[2, '0.600000', 29, 'Keep code blocks in English']],
    script: translation,
    spent: '0.120000',
    status: 'running',
    steered: ['Keep code blocks in English'],
    title: 'The Rust Book, in Greek',
    workers: 1,
  }),
  build({
    age: 400,
    goal: "Write a field guide to Tempo's stablecoin DEX for developers: how orders, flips and swaps work, what they cost, and runnable examples for each.",
    history: [
      { endedAt: at(330), message: 'Round 1: read the DEX precompile docs and traced 40 swaps on mainnet. Drafted the chapters on orders and flips.', n: 1, spent: '0.402000', startedAt: at(388), status: 'completed' },
      { endedAt: at(260), message: 'Round 2: wrote runnable viem examples for place, flip and swap, and a fee table from real transactions.\nThe guide is in the bucket at field-guide/dex.md.', n: 2, spent: '0.394210', startedAt: at(328), status: 'completed' },
    ],
    id: 'dex-guide',
    lines: [
      ['message', 'Round 2 report saved to field-guide/dex.md (11 pages).'],
      ['status', 'Paused with 0.003790 MACH left, below the 0.01 MACH reserve. A pledge resumes it.'],
    ],
    pledges: [
      [4, '0.500000', 390, 'Explain fees with real transactions'],
      [7, '0.300000', 300, null],
    ],
    spent: '0.796210',
    status: 'paused',
    title: "A field guide to Tempo's stablecoin DEX",
    workers: 0,
  }),
  build({
    age: 4,
    goal: 'Reproduce the nanoGPT speedrun on a single T4 and see how close a 15-minute budget gets to the 3.28 validation loss record.',
    history: [],
    id: 'speedrun-t4',
    lines: [['status', 'Created. The first pledge starts round 1.']],
    pledges: [],
    spent: '0',
    status: 'funding',
    title: 'The nanoGPT speedrun on one T4',
    workers: 0,
  }),
  build({
    age: 1440,
    goal: "Map the MEV in Tempo's first million blocks: which strategies exist, how much they extract, and who pays for it.",
    history: [
      { endedAt: at(1380), message: 'Round 1: indexed 1,000,000 blocks into the bucket (14 GiB of receipts).', n: 1, spent: '0.512000', startedAt: at(1428), status: 'completed' },
      { endedAt: at(1290), message: 'Round 2: classified 48,113 candidate bundles; 61% DEX arbitrage, 23% liquidations, 16% sandwiches.', n: 2, spent: '0.630000', startedAt: at(1378), status: 'completed' },
      { endedAt: at(1210), message: 'Round 3 failed: the classifier ran out of memory on a 2 GiB machine. Retrying on 8 GiB.', n: 3, spent: '0.401120', startedAt: at(1288), status: 'failed' },
      {
        endedAt: at(1100),
        message: "Final report.\n\n1. Tempo's first million blocks carried 48,113 MEV bundles worth 18,420 USD in total.\n2. Arbitrage between the stablecoin DEX and outside venues is 61% of it and mostly harmless: it keeps pegs tight.\n3. Sandwiches are 16% of bundles but 38% of value, concentrated in 4 searchers.\n4. Payment lanes left no room for sandwiches on transfers; every sandwich hit a DEX swap with slippage above 0.5%.\n\nData, notebooks and the classifier are in the bucket under mev/.",
        n: 4,
        spent: '0.405000',
        startedAt: at(1208),
        status: 'completed',
      },
    ],
    id: 'mev-map',
    lines: [
      ['message', 'Final report written. Everything the goal asked for is answered.'],
      ['status', 'Done. The goal is met. Unspent money returns to each pledge when the gateway closes its channel.'],
    ],
    pledges: [
      [5, '1.000000', 1430, 'Separate sandwiches from arbitrage'],
      [8, '0.500000', 1300, null],
      [1, '0.500000', 1100, 'Separate sandwiches from arbitrage'],
    ],
    spent: '1.948120',
    status: 'done',
    steered: ['Separate sandwiches from arbitrage'],
    title: "Map the MEV in Tempo's first million blocks",
    workers: 0,
  }),
]

function delay<T>(value: T, ms = 160) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), ms))
}

function find(key: string) {
  const swarm = fixtures.find((item) => item.id === key)
  if (!swarm) return Promise.reject(Object.assign(new Error('No swarm has this id.'), { code: 'not_found', status: 404 }))
  tick(swarm)
  return Promise.resolve(swarm)
}

function summary(swarm: Live): Summary {
  const answered = swarm.history.findLast((round) => round.status === 'completed' && round.message)
  return {
    answer: answered?.message ? Answer.parse(answered.n, answered.message, answered.endedAt ?? swarm.updatedAt) : null,
    contributors: swarm.contributors,
    createdAt: swarm.createdAt,
    daily: swarm.daily,
    goal: swarm.goal,
    id: swarm.id,
    machines: swarm.machines,
    parallel: swarm.parallel,
    pool: swarm.pool,
    raised: swarm.raised,
    remaining: swarm.remaining,
    rounds: swarm.rounds,
    spent: swarm.spent,
    status: swarm.status,
    title: swarm.title,
    updatedAt: swarm.updatedAt,
    wallet: swarm.wallet,
    workers: swarm.workers,
  }
}

function detail(swarm: Live): Detail {
  return { ...summary(swarm), budgets: swarm.budgets, contributions: swarm.contributions, feed: swarm.feed.slice(-200), hands: swarm.hands, history: swarm.history, notes: swarm.notes, pledges: swarm.pledges, researchers: demoTeam(swarm) }
}

function demoTeam(swarm: Live): Researcher[] {
  const names = swarm.id === 'bench-coders' ? ['swe-lite-a', 'rust-subset', 'cost-analysis'] : ['baseline', 'experiment', 'review']
  return swarm.history.flatMap((round) => names.slice(0, Math.max(0, (round.status === 'running' ? swarm.workers : swarm.parallel) - 1)).map((name, index): Researcher => {
    const completed = round.status === 'completed' || (swarm.id === 'bench-coders' && index === 0)
    const state = completed ? 'completed' : round.status === 'failed' ? 'failed' : round.status === 'cancelled' ? 'interrupted' : 'running'
    return { id: `demo:${round.n}:${index}`, parent: null, round: round.n, name, task: index === 0 ? 'Establish the baseline and report reproducible measurements.' : index === 1 ? 'Test the strongest alternative under matching conditions.' : 'Compare costs and check the evidence.', state, action: completed ? 'Measurements delivered to the lead' : index === 1 ? 'Running the next experiment' : 'Comparing results with the baseline', output: completed ? 'Baseline measurements collected. Commands, conditions and results are included in the round report.' : null, updatedAt: completed ? round.endedAt ?? round.startedAt : Date.now() - 3000, events: 8 + index, toolsCompleted: completed ? 6 : 2 + index, lastSequence: 1 }
  }))
}

export function config(): Promise<Config> {
  return delay({
    budget: { days: 30, max: '100.000000', min: '0.250000', period: 86_400 },
    chainId: 4217,
    explorer: 'https://explore.tempo.xyz',
    gateway: 'https://gateway.tempo-dev.workers.dev',
    mach: '0x20c000000000000000000000f37de3740adec032',
    minPledge: '0.100000',
    perWorker: '0.100000',
    reserve: '0.010000',
    rpc: 'https://rpc.tempo.xyz',
    tokens: [
      { address: '0x20c000000000000000000000f37de3740ADec032', id: 'mach', pool: false, symbol: 'MACH' },
      { address: '0x20c0000000000000000000006a37DA5C996874BE', id: 'ousd', pool: true, symbol: 'OUSD' },
      { address: '0x20c0000000000000000000000000000000000000', id: 'pathusd', pool: true, symbol: 'pathUSD' },
      { address: '0x20C000000000000000000000b9537d11c60E8b50', id: 'usdce', pool: true, symbol: 'USDC.e' },
    ],
  })
}

export function swarms() {
  for (const swarm of fixtures) tick(swarm)
  return delay({ swarms: fixtures.map(summary) })
}

export async function swarm(key: string) {
  return delay(detail(await find(key)))
}

export async function feed(key: string, after: number) {
  return delay({ entries: (await find(key)).feed.filter((entry) => entry.seq > after) })
}

export function create(input: { goal: string; title: string }) {
  const key = id(`${input.title}:${Date.now()}`)
  const swarm = build({ age: 0, goal: input.goal, history: [], id: key, lines: [['status', 'Created. The first pledge starts round 1.']], pledges: [], spent: '0', status: 'funding', title: input.title, workers: 0 })
  fixtures.unshift(swarm)
  return delay(summary(swarm), 400)
}

export async function pledge(key: string, input: { amount: string; note?: string; token: Currency }): Promise<Requested> {
  await find(key)
  const pledge = id(`pledge:${key}:${Date.now()}`)
  requested.set(pledge, { amount: decimal(units(input.amount)), note: input.note?.trim() || null, token: input.token })
  return delay({ authorizeAccessKey: {}, pledge }, 300)
}

export async function confirm(key: string, pledge: string): Promise<Pledged> {
  const swarm = await find(key)
  const request = requested.get(pledge)
  if (!request) throw Object.assign(new Error('No pending pledge has this id.'), { code: 'not_found', status: 404 })
  if (units(request.amount) > balances[request.token]) throw Object.assign(new Error('Your wallet holds less than the pledge.'), { code: 'insufficient_balance', status: 409 })
  requested.delete(pledge)
  const pledged: Pledge = { amount: request.amount, at: Date.now(), contributor: visitor, id: pledge, note: request.note, spent: '0', status: 'active', token: request.token }
  swarm.pledges.push(pledged)
  if (request.note) swarm.steered.add(request.note)
  push(swarm, 'funds', `${visitor.slice(0, 6)}…${visitor.slice(-4)} pledged ${request.amount} MACH${request.note ? ` behind "${request.note}"` : ''}.`, null, Date.now())
  if (swarm.status === 'funding' || swarm.status === 'paused') {
    swarm.status = 'running'
    swarm.rounds++
    swarm.workers = 1
    swarm.history.push({ endedAt: null, message: null, n: swarm.rounds, spent: '0', startedAt: Date.now(), status: 'running' })
    push(swarm, 'status', `Round ${swarm.rounds} started.`, null, Date.now())
    if (swarm.script.length === 0) swarm.script = translation
  }
  settle(swarm)
  return delay({ pledge: pledged, status: 'active', swarm: summary(swarm) }, 600)
}

function begin(swarm: Live) {
  if (swarm.status !== 'funding' && swarm.status !== 'paused') return
  swarm.status = 'running'
  swarm.rounds++
  swarm.workers = 1
  swarm.history.push({ endedAt: null, message: null, n: swarm.rounds, spent: '0', startedAt: Date.now(), status: 'running' })
  push(swarm, 'status', `Round ${swarm.rounds} started.`, null, Date.now())
  if (swarm.script.length === 0) swarm.script = translation
}

export async function contribute(key: string, input: { hash: string; note?: string }): Promise<Contributed> {
  const swarm = await find(key)
  const contribution: Contribution = { amount: '0.250000', at: Date.now(), budget: null, contributor: visitor, hash: input.hash as `0x${string}`, kind: 'transfer', note: input.note?.trim() || null, token: 'usdce' }
  swarm.contributions.push(contribution)
  if (contribution.note) swarm.steered.add(contribution.note)
  push(swarm, 'funds', `${visitor.slice(0, 6)}…${visitor.slice(-4)} sent 0.25 USDC.e${contribution.note ? ' with a note' : ''}`, contribution.note, Date.now())
  begin(swarm)
  settle(swarm)
  return delay({ contribution, swarm: summary(swarm) }, 500)
}

export async function budget(key: string, input: { amount: string; note?: string; token: Token }): Promise<BudgetRequested> {
  await find(key)
  const budget = id(`budget:${key}:${Date.now()}`)
  allowances.set(budget, { amount: decimal(units(input.amount)), note: input.note?.trim() || null, token: input.token })
  return delay({ authorizeAccessKey: {}, budget }, 300)
}

export async function allow(key: string, budget: string): Promise<Budgeted> {
  const swarm = await find(key)
  const request = allowances.get(budget)
  if (!request) throw Object.assign(new Error('No pending budget has this id.'), { code: 'not_found', status: 404 })
  allowances.delete(budget)
  const allowed: Budget = { amount: request.amount, at: Date.now(), contributor: visitor, detail: null, expiresAt: Date.now() + 30 * 86_400_000, id: budget, left: request.amount, nextAt: null, note: request.note, period: 86_400, pulled: '0.000000', status: 'active', token: request.token }
  swarm.budgets.push(allowed)
  push(swarm, 'funds', `${visitor.slice(0, 6)}…${visitor.slice(-4)} set a budget of ${request.amount} ${request.token === 'usdce' ? 'USDC.e' : request.token === 'pathusd' ? 'pathUSD' : 'OUSD'} a day`, request.note, Date.now())
  begin(swarm)
  settle(swarm)
  return delay({ budget: allowed, swarm: summary(swarm) }, 600)
}

