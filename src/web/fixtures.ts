import * as Answer from '../shared/Answer.ts'
import type { Account, Artifact, Code, Budget, BudgetRequested, Budgeted, Chatter, Config, Contributed, Contribution, Currency, Detail, Entry, Form, Kind, Lent, Live as LiveEvent, Me, Member, Note, Pledge, Pledged, Posted, Requested, Room, Said, Status, Summary, Token, Update, Way, Why } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import { problems } from '../shared/ResearchBrief.ts'
import { usd } from './format.ts'
import { pace, scene, visitor } from './stage.ts'

type Line = readonly [Kind, string, (string | null)?, string?]

type Backing = { amount: string; contributor: `0x${string}`; note: string }

type Live = Omit<Detail, 'answer' | 'reason' | 'updates' | 'why' | 'working'> & { updates: Update[]; chat: Said[]; cursor: number; flicker: readonly string[]; next: number; resting: boolean; script: readonly Line[]; since: number | null; steered: Set<string>; steers: Backing[] }

const minute = 60_000

const started = Date.now()

export const balances: Record<Currency, bigint> = scene.has('broke') ? { mach: 0n, ousd: 0n, pathusd: 0n, usdce: 0n } : { mach: 1_250_000n, ousd: 420_000n, pathusd: 3_000_000n, usdce: 8_750_000n }

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
  code?: Code
  hands?: readonly string[]
  id: string
  lines: readonly Line[]
  budgets?: readonly (readonly [number, string, Token, string, string, Budget['status'], number, string | null])[]
  gifts?: readonly (readonly [number, string, Token, number, string | null, Contribution['kind']])[]
  pledges: readonly (readonly [number, string, number, string | null, Currency?])[]
  problem?: string | undefined
  resting?: boolean
  script?: readonly Line[]
  since?: number
  spent: string
  status: Status
  steered?: readonly string[]
  title: string
  updates: readonly (readonly [number, string, string])[]
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
  const feed = input.lines.map(([kind, text, detail, who], index): Entry => ({
    at: at(input.lines.length - index) + (index % 3) * 11_000,
    detail: detail ?? null,
    event: null,
    kind,
    seq: index + 1,
    text,
    who: who ?? null,
  }))
  return settle({
    budgets,
    chat: [],
    contributions,
    contributors: 0,
    createdAt: at(input.age),
    code: input.code ?? null,
    cursor: 0,
    daily: '0',
    feed,
    flicker: input.flicker ?? [],
    goal: input.goal,
    hands: (input.hands ?? []).map((name) => ({ connected: true, name })),
    id: input.id,
    machines: 0,
    next: started + 1200,
    notes: [],
    pledges,
    pool: '0',
    problem: input.problem ?? null,
    resting: input.resting ?? false,
    raised: '0',
    remaining: '0',
    wallet,
    script: input.script ?? [],
    since: input.status === 'running' ? at(input.since ?? 30) : null,
    spent: input.spent,
    status: input.status,
    steered: new Set(input.steered ?? []),
    steers: [],
    title: input.title,
    updatedAt: feed.at(-1)?.at ?? at(input.age),
    updates: input.updates.map(([minutes, text, spent]): Update => ({ at: at(minutes), base: null, commits: [], done: /STATUS:\s*done/i.test(text), spent, text: Answer.parse(text, at(minutes)).text })),
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
  swarm.contributors = new Set([...swarm.pledges.map((pledge) => pledge.contributor), ...swarm.contributions.map((gift) => gift.contributor), ...swarm.budgets.flatMap((budget) => (budget.contributor ? [budget.contributor] : []))]).size
  swarm.daily = decimal(swarm.budgets.filter((budget) => budget.status === 'active' || budget.status === 'waiting').reduce((sum, budget) => sum + units(budget.amount), 0n))
  swarm.pool = decimal(given > units(swarm.spent) / 2n ? given - units(swarm.spent) / 2n : 0n)
  swarm.machines = swarm.hands.filter((hand) => hand.connected).length
  const groups = new Map<string, (Pledge | Contribution | Backing)[]>()
  for (const backing of [...swarm.pledges, ...swarm.contributions, ...swarm.steers]) if (backing.note) groups.set(backing.note, [...(groups.get(backing.note) ?? []), backing])
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
  swarm.feed.push({ at: when, detail, event: null, kind, seq, text, who: null })
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
  ['tool', 'Spawned a subagent: rust-subset', 'Write 50 small Rust tasks with hidden tests (parsing, lifetimes, async). Run every model in the shortlist against them with the same harness and record solve rate, latency and MACH per task.'],
  ['status', 'Started a subagent: rust-subset', 'Write 50 small Rust tasks with hidden tests and run every shortlisted model against them.', 'rust-subset'],
  ['thinking', 'Cost per solved task carries the most weight among the notes, so every run reports MACH spent next to its solve count. Qwen3-Coder is slow; give it its own machine so it does not hold the others back.'],
  ['machine', 'Starting machine sb-c41d9e07 (python:3.12-slim)', '{"attach":"sb-c41d9e07","image":"python:3.12-slim","cpu":2,"memory":4096}'],
  ['tool', '$ git clone --depth 1 https://github.com/princeton-nlp/SWE-bench && pip install -q -e SWE-bench on sb-c41d9e07', "Cloning into 'SWE-bench'...\nSuccessfully installed swebench-3.0.4"],
  ['tool', '$ python -m swebench.harness.run_evaluation --dataset_name princeton-nlp/SWE-bench_Lite --max_workers 4 --run_id glm-5.3 on sb-3f9a2c1d', 'Running 75 instances...\n31 resolved, 44 unresolved\nTotal cost: 0.0612 MACH', 'swe-lite'],
  ['message', 'GLM-5.3 resolved 31 of 75 SWE-bench Lite tasks (41%) at 0.0020 MACH per resolved task, median 94 s per task.', null, 'swe-lite'],
  ['tool', 'Waiting on subagents'],
  ['funds', '0x1d9c…0a41 pledged 0.25 MACH behind "Report cost per solved task, not per token".'],
  ['steer', 'Steered the agent toward "Report cost per solved task, not per token"', '1.45 MACH behind it, 34.1% of everything contributed'],
  ['tool', '$ cargo test --release -q 2>&1 | tail -3 on sb-77ab01e2', 'test result: ok. 37 passed; 13 failed; 0 ignored\nkimi-k2.7: 37/50', 'rust-subset'],
  ['error', 'compute_create failed', '{"code":"unavailable","detail":"Modal has no capacity for a T4 in us-east right now."}', 'rust-subset'],
  ['thinking', 'No T4 in us-east. The Rust subset is CPU-bound anyway; retry on a 4-CPU machine in the same region instead of moving to eu-west and paying the broad-region rate.', null, 'rust-subset'],
  ['machine', 'Starting machine sb-d2f81a33 (rust:1.90-slim)', '{"attach":"sb-d2f81a33","image":"rust:1.90-slim","cpu":4}', 'rust-subset'],
  ['tool', 'Ran a script: const rows = await Promise.all(models.map((model) => score(model)))', 'const rows = await Promise.all(models.map((model) => score(model)))\nconsole.table(rows)'],
  ['output', 'rust-subset finished', 'Kimi K2.7 passes 37 of 50 Rust tasks, DeepSeek V4.1 Flash 33, GLM-5.3 35. DeepSeek is the cheapest per pass at 0.0004 MACH.', 'rust-subset'],
  ['tool', 'Called kv_set', '{"app":"swarm","key":"results/rust-subset","value":{"kimi-k2.7":37,"deepseek-v4.1-flash":33,"glm-5.3":35}}'],
  ['machine', "A contributor's machine joined the swarm as hand gpu-box-7a1c (tensorbox's 4090)."],
  ['tool', '$ nvidia-smi --query-gpu=name,memory.total --format=csv on gpu-box-7a1c', 'name, memory.total [MiB]\nNVIDIA GeForce RTX 4090, 24564 MiB'],
  ['tool', '$ python -m swebench.harness.run_evaluation --run_id qwen3-coder --max_workers 2 on gpu-box-7a1c', 'Running 75 instances...\n29 resolved, 46 unresolved'],
  ['tool', 'Called browser_create', '{"minutes":15,"name":"leaderboard-check"}'],
  ['machine', 'Shutting down a machine', '{"sandboxId":"sb-c41d9e07"}'],
]

const parser: readonly Line[] = [
  ['tool', '$ ./bench --parser sonic-rs --threads 8 --input /data/logs-64g.ndjson on sb-91e0aa4f', 'sonic-rs: 64.0 GiB in 41.2 s (1.55 GiB/s)'],
  ['tool', '$ ./bench --parser simd-json --threads 8 --input /data/logs-64g.ndjson on sb-5c2b7d10', 'simd-json: 64.0 GiB in 46.9 s (1.36 GiB/s)', 'simd'],
  ['thinking', 'Both are memory-bound past 8 threads. The interesting axis is now cost: a 16-CPU machine at twice the rate only buys 30% more throughput.'],
  ['message', 'sonic-rs leads on 8 CPUs at 1.55 GiB/s. Next: the same run on 16 CPUs to see where scaling flattens.'],
  ['tool', 'Waiting on subagents'],
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
    updates: [
      [150, 'Harness and shortlist.\n\nThe gateway lists 31 text models; 19 call tools and qualify. I built the harness on two python:3.12-slim machines and ran a 20-task smoke test on each model.\n\nShortlist for full runs: GLM-5.3, Kimi K2.7, DeepSeek V4.1 Flash, Qwen3-Coder, gpt-oss-120b, Llama 4 Scout.\nDropped: 13 models that solved fewer than 2 of 20.\n\nSpent 0.41 MACH, most of it on the smoke test.', '0.412800'],
      [48, 'SWE-bench Lite.\n\nFour subagents, each on its own machine, ran 75 tasks per model.\n\n| Model | Solved | Rate | MACH per solved task |\n| --- | --- | --- | --- |\n| GLM-5.3 | 124/300 | 41% | 0.0020 |\n| Kimi K2.7 | 118/300 | 39% | 0.0031 |\n| DeepSeek V4.1 | 109/300 | 36% | 0.0006 |\n| gpt-oss-120b | 92/300 | 31% | 0.0011 |\n\nQwen3-Coder timed out on 40 tasks; it gets a dedicated machine next, as the top note asks.', '0.981200'],
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
    problem: 'coding-models',
    lines: [
      ['status', 'Told the agent to keep going, with $2.68 left.'],
      ['steer', 'Steered the agent toward "Include Qwen3-Coder and Kimi K2.7 even if they are slow"', '1.55 MACH behind it, 36.5% of everything contributed'],
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
      [0, '1.000000', 100, null],
    ],
    script: benchmark,
    since: 186,
    spent: '1.873412',
    status: 'running',
    steered: ['Include Qwen3-Coder and Kimi K2.7 even if they are slow', 'Report cost per solved task, not per token', 'Publish the harness as a repo anyone can fork'],
    title: 'Benchmark every open-weight coding model',
  }),
  build({
    age: 70,
    goal: 'Find the fastest and the cheapest way to parse a terabyte of newline-delimited JSON logs on rented machines. Compare serde_json, simd-json and sonic-rs across machine sizes and report GiB/s and MACH per TiB.',
    hands: ['sb-91e0aa4f', 'sb-5c2b7d10'],
    updates: [[31, 'Generated 64 GiB of synthetic access logs and a harness that streams them through each parser.\nsonic-rs 1.55 GiB/s, simd-json 1.36 GiB/s, serde_json 0.41 GiB/s on 8 CPUs.', '0.180000']],
    budgets: [[4, '0.250000', 'pathusd', '0.180000', '0.070000', 'active', 40, 'Measure cost per GiB, not just throughput']],
    gifts: [[4, '0.180000', 'pathusd', 38, 'Measure cost per GiB, not just throughput', 'pull']],
    id: 'json-terabyte',
    problem: 'json-terabyte',
    lines: [['status', 'Started working with $0.62 to spend.'], ...parser],
    pledges: [
      [3, '0.500000', 68, 'Measure cost per GiB, not just throughput'],
      [5, '0.250000', 30, null],
      [6, '0.100000', 12, 'Include serde_json as the baseline'],
    ],
    script: parser,
    since: 66,
    spent: '0.232100',
    status: 'running',
    steered: ['Measure cost per GiB, not just throughput'],
    title: 'Parse a terabyte of JSON for under a dollar',
  }),
  build({
    age: 30,
    goal: 'Translate The Rust Programming Language into Greek, chapter by chapter, with a shared glossary so terms stay consistent. Publish each chapter to the bucket as it is finished.',
    hands: ['sb-0e4ab219'],
    updates: [],
    id: 'rust-book-el',
    lines: [['status', 'Started working with $0.60 to spend.'], ...translation],
    pledges: [[2, '0.600000', 29, 'Keep code blocks in English']],
    script: translation,
    since: 28,
    spent: '0.120000',
    status: 'running',
    steered: ['Keep code blocks in English'],
    title: 'The Rust Book, in Greek',
  }),
  build({
    age: 400,
    goal: "Write a field guide to Tempo's stablecoin DEX for developers: how orders, flips and swaps work, what they cost, and runnable examples for each.",
    updates: [
      [330, 'Read the DEX precompile docs and traced 40 swaps on mainnet. Drafted the chapters on orders and flips.', '0.402000'],
      [260, 'Wrote runnable viem examples for place, flip and swap, and a fee table from real transactions.\nThe guide is in the bucket at field-guide/dex.md.', '0.394210'],
    ],
    id: 'dex-guide',
    lines: [
      ['message', 'Saved the guide to field-guide/dex.md (11 pages).'],
      ['status', 'Waiting for money: $0.0038 is payable now, less than one model call holds. New money keeps it going.'],
    ],
    pledges: [
      [4, '0.500000', 390, 'Explain fees with real transactions'],
      [7, '0.300000', 300, null],
    ],
    spent: '0.796210',
    status: 'paused',
    title: "A field guide to Tempo's stablecoin DEX",
  }),
  build({
    age: 4,
    goal: 'Reproduce the nanoGPT speedrun on a single T4 and see how close a 15-minute budget gets to the 3.28 validation loss record.',
    updates: [],
    id: 'speedrun-t4',
    problem: 'small-model-math',
    lines: [['status', 'Created. The first pledge starts its agent.']],
    pledges: [],
    spent: '0',
    status: 'funding',
    title: 'The nanoGPT speedrun on one T4',
  }),
  build({
    age: 1440,
    goal: "Map the MEV in Tempo's first million blocks: which strategies exist, how much they extract, and who pays for it.",
    updates: [
      [1380, 'Indexed 1,000,000 blocks into the bucket (14 GiB of receipts).', '0.512000'],
      [1290, 'Classified 48,113 candidate bundles; 61% DEX arbitrage, 23% liquidations, 16% sandwiches.', '0.630000'],
      [1100, "Final report.\n\n1. Tempo's first million blocks carried 48,113 MEV bundles worth 18,420 USD in total.\n2. Arbitrage between the stablecoin DEX and outside venues is 61% of it and mostly harmless: it keeps pegs tight.\n3. Sandwiches are 16% of bundles but 38% of value, concentrated in 4 searchers.\n4. Payment lanes left no room for sandwiches on transfers; every sandwich hit a DEX swap with slippage above 0.5%.\n\nData, notebooks and the classifier are in the bucket under mev/ and in the repository.", '0.806120'],
    ],
    code: { app: 'swarm-mev-map', clone: 'https://gateway.tempo-dev.workers.dev/p/0x975937feafc6869a260c176854dda8764a78e122/swarm-mev-map/git/mev-map.git', name: 'mev-map', owner: '0x975937feafc6869a260c176854dda8764a78e122' },
    id: 'mev-map',
    lines: [
      ['error', 'The agent stopped with an error after spending $0.40.', 'The classifier ran out of memory on a 2 GiB machine.'],
      ['message', 'Final report written. Everything the goal asked for is answered.'],
      ['status', 'Resting: the agent found nothing worth spending on, so the swarm stopped asking it and spends nothing. $0.052 is kept for later; a note or new money wakes it.'],
    ],
    pledges: [
      [5, '1.000000', 1430, 'Separate sandwiches from arbitrage'],
      [8, '0.500000', 1300, null],
      [1, '0.500000', 1100, 'Separate sandwiches from arbitrage'],
    ],
    resting: true,
    spent: '1.948120',
    status: 'paused',
    steered: ['Separate sandwiches from arbitrage'],
    title: "Map the MEV in Tempo's first million blocks",
  }),
]

function delay<T>(value: T, wanted = 160) {
  const ms = wanted * pace
  if (scene.has('wait')) return new Promise<T>(() => {})
  if (scene.has('down')) return new Promise<T>((_, reject) => setTimeout(() => reject(fail(503, 'unavailable', 'Swarms is not answering right now.')), ms))
  return steady(value, ms)
}

function steady<T>(value: T, ms = 160) {
  return new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), ms * pace))
}

const reasons = {
  idle: 'Resting: the agent found nothing worth spending on, so the swarm stopped asking it and spends nothing. $0.052 is kept for later; a note or new money wakes it.',
  costly: "Waiting for money: the agent's next model call holds $0.2147, more than the $0.2083 any one contribution can pay at once. A contribution or budget pull that can cover it starts it again.",
  money: 'Waiting for money: $0.0038 is payable now, less than one model call holds. New money keeps it going.',
  rest: 'The agent hit 3 errors in a row, so the swarm stopped to rest. New money restarts it, and so does the next budget pull at 16:37 UTC.',
} as const

function why(swarm: Live): Why | null {
  if (swarm.status === 'funding') return 'unfunded'
  if (swarm.status !== 'paused') return null
  return (['costly', 'rest'] as const).find((key) => scene.has(key)) ?? (swarm.resting ? 'idle' : 'money')
}

function reason(swarm: Live) {
  const picked = why(swarm)
  return picked && picked !== 'unfunded' ? reasons[picked] : null
}

function find(key: string) {
  const swarm = fixtures.find((item) => item.id === key.split('~')[0])
  if (!swarm) return Promise.reject(Object.assign(new Error('No swarm has this id.'), { code: 'not_found', status: 404 }))
  tick(swarm)
  return Promise.resolve(swarm)
}

function summary(swarm: Live): Summary {
  const latest = swarm.updates.at(-1)
  return {
    answer: latest ? { at: latest.at, done: latest.done, text: latest.text } : null,
    contributors: swarm.contributors,
    createdAt: swarm.createdAt,
    daily: swarm.daily,
    goal: swarm.goal,
    id: swarm.id,
    machines: swarm.machines,
    pool: swarm.pool,
    problem: swarm.problem,
    raised: swarm.raised,
    remaining: swarm.remaining,
    spent: swarm.spent,
    status: swarm.status,
    title: swarm.title,
    updatedAt: swarm.updatedAt,
    wallet: swarm.wallet,
    why: reason(swarm) ? why(swarm) : null,
  }
}

function detail(swarm: Live): Detail {
  return {
    ...summary(swarm),
    budgets: swarm.budgets,
    code: swarm.code,
    contributions: swarm.contributions,
    feed: swarm.feed.slice(-200),
    hands: swarm.hands,
    notes: swarm.notes,
    pledges: swarm.pledges,
    reason: reason(swarm),
    why: reason(swarm) ? why(swarm) : null,
    updates: swarm.updates,
    working: swarm.since === null ? null : { since: swarm.since },
  }
}

export function config(): Promise<Config> {
  return steady({
    auth: '/v1/auth',
    budget: { days: 365, max: '100.000000', min: '2.000000', period: 2_592_000 },
    chainId: 4217,
    explorer: 'https://explore.tempo.xyz',
    gateway: 'https://gateway.tempo-dev.workers.dev',
    mach: '0x20c000000000000000000000f37de3740adec032',
    minPledge: '0.250000',
    reserve: '0.050000',
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
  return delay({ swarms: scene.has('empty') ? [] : scene.has('many') ? [...fixtures.map(summary), ...crowd()] : fixtures.map(summary) })
}

function crowd() {
  return problems.map((problem, index): Summary => {
    const base = summary(fixtures[index % fixtures.length]!)
    return { ...base, id: `${base.id}~${index}`, problem: null, title: problem.title }
  })
}

export async function swarm(key: string) {
  return delay(detail(await find(key)))
}

export async function feed(key: string, after: number, filter: { before?: number; who?: string } = {}) {
  const entries = (await find(key)).feed.filter(
    (entry) => entry.seq > after && (filter.before === undefined || entry.seq < filter.before) && (filter.who === undefined || (entry.who ?? 'agent') === filter.who),
  )
  const page = filter.before === undefined ? entries.slice(0, 200) : entries.slice(-200)
  return delay({ entries: page, next: page.at(-1)?.seq ?? after })
}

const musings = [
  'The cheapest way to settle this is a matched run: same inputs, same machine size, one variable changed at a time.',
  'The last result looks too good. Before trusting it, rerun with a cold cache and three seeds.',
  'Two runs disagree by 12%. The difference is the input size, not the method; normalise per gigabyte before comparing.',
  'This direction is not paying off. Write down what was tried and try the next idea from the notes.',
  'A smaller machine is enough here. The workload is memory bound, so more cores only add cost.',
]

const doings: readonly (readonly [string, string, string])[] = [
  ['$ python bench.py --seeds 3 --size 1g', '{"cmd":"python bench.py --seeds 3 --size 1g"}', 'seed 0: 41.8 s\nseed 1: 42.1 s\nseed 2: 41.6 s\nmedian 41.8 s (1.53 GiB/s)'],
  ['$ git log --oneline -5', '{"cmd":"git log --oneline -5"}', 'a41c2e9 Add the matched benchmark harness\n90b3db0 Record baseline measurements'],
  ['Ran a script: const runs = await Promise.all(sizes.map(measure))', 'const runs = await Promise.all(sizes.map(measure))\ntext(JSON.stringify(runs))', '[{"size":"256m","s":10.4},{"size":"1g","s":41.8},{"size":"4g","s":171.2}]'],
  ['$ pip install -q zstandard brotli && python compare.py', '{"cmd":"pip install -q zstandard brotli && python compare.py"}', 'zstd -19: ratio 4.12, 38 MB/s\nbrotli -11: ratio 4.31, 6 MB/s\nbz2 -9: ratio 3.95, 14 MB/s'],
]

export function live(key: string, listener: (event: LiveEvent) => void) {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let event = 1_000_000
  let turn = 0
  const later = (ms: number, run: () => void) => {
    timer = setTimeout(() => alive && run(), ms)
  }
  const say = (swarm: Live, who: string | null, kind: Kind, text: string, detail: string | null) => {
    const entry: Entry = { at: Date.now(), detail, event: ++event, kind, seq: 0, text, who }
    listener({ entry, type: 'entry' })
    swarm.feed.push({ ...entry, seq: (swarm.feed.at(-1)?.seq ?? 0) + 1 })
  }
  const next = async () => {
    const swarm = await find(key).catch(() => undefined)
    if (!alive) return
    if (!swarm || swarm.status !== 'running') {
      listener({ type: 'idle' })
      return later(4000, () => void next())
    }
    const crew = [...new Set(swarm.feed.flatMap((entry) => (entry.who ? [entry.who] : [])))]
    const who = crew.length ? ([null, ...crew][turn % (crew.length + 1)] ?? null) : null
    const thought = musings[turn % musings.length] ?? ''
    turn++
    let shown = 0
    const think = () => {
      const delta = thought.slice(shown, shown + 3 + (shown % 5))
      shown += delta.length
      if (delta) {
        listener({ channel: 'thinking', delta, item: `reasoning:${turn}`, offset: null, type: 'delta', who })
        return later(45, think)
      }
      say(swarm, who, 'thinking', thought, null)
      const [text, detail, output] = doings[turn % doings.length] ?? doings[0]!
      later(500, () => {
        say(swarm, who, 'tool', text, detail)
        later(1400, () => {
          say(swarm, who, 'output', text.startsWith('Ran') ? 'Script output' : 'Command output', output)
          later(900, () => void next())
        })
      })
    }
    think()
  }
  void find(key).then((swarm) => {
    if (alive && swarm.status === 'running') listener({ at: swarm.since ?? Date.now(), type: 'start' })
    void next()
  })
  return () => {
    alive = false
    clearTimeout(timer)
  }
}

export function create(input: { goal: string; problem?: string; title: string }) {
  const key = id(`${input.title}:${Date.now()}`)
  const swarm = build({ age: 0, goal: input.goal, id: key, problem: input.problem, lines: [['status', 'Created. The first pledge starts its agent.']], pledges: [], spent: '0', status: 'funding', title: input.title, updates: [] })
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
  begin(swarm)
  settle(swarm)
  return delay({ pledge: pledged, status: 'active', swarm: summary(swarm) }, 600)
}

function begin(swarm: Live) {
  if (swarm.status !== 'funding' && swarm.status !== 'paused') return
  push(swarm, 'status', `${swarm.updates.length ? 'Back at work' : 'Started working'} with ${usd(swarm.remaining)} to spend.`, null, Date.now())
  swarm.status = 'running'
  swarm.since = Date.now()
  if (swarm.script.length === 0) swarm.script = translation
}

export const sent = new Map<string, bigint>()

export async function contribute(key: string, input: { hash: string; note?: string }): Promise<Contributed> {
  const swarm = await find(key)
  const contribution: Contribution = { amount: decimal(sent.get(input.hash) ?? 250_000n), at: Date.now(), budget: null, contributor: visitor, hash: input.hash as `0x${string}`, kind: 'transfer', note: input.note?.trim() || null, token: 'usdce' }
  swarm.contributions.push(contribution)
  if (contribution.note) swarm.steered.add(contribution.note)
  push(swarm, 'funds', `${visitor.slice(0, 6)}…${visitor.slice(-4)} sent ${contribution.amount} USDC.e${contribution.note ? ' with a note' : ''}`, contribution.note, Date.now())
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
  const allowed: Budget = { amount: request.amount, at: Date.now(), contributor: visitor, detail: null, expiresAt: Date.now() + 365 * 86_400_000, id: budget, left: '0.000000', nextAt: null, note: request.note, period: 2_592_000, pulled: request.amount, status: 'active', token: request.token }
  swarm.budgets.push(allowed)
  push(swarm, 'funds', `${visitor.slice(0, 6)}…${visitor.slice(-4)} set a budget of ${request.amount} ${request.token === 'usdce' ? 'USDC.e' : request.token === 'pathusd' ? 'pathUSD' : 'OUSD'} a day`, request.note, Date.now())
  begin(swarm)
  settle(swarm)
  return delay({ budget: allowed, swarm: summary(swarm) }, 600)
}

const board = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
*{box-sizing:border-box}body{margin:0;padding:20px;font:15px/1.4 Georgia,serif;color:#111;background:#fbfcf9}
h1{margin:0;font-weight:400;font-size:24px;letter-spacing:-.02em}.at{margin:4px 0 18px;font:11px ui-monospace,monospace;color:#5c7350}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:18px}
.card{padding:12px;border:1px solid #dbe2d0;border-radius:10px;background:#fff}.card b{display:block;font-weight:400;font-size:22px}.card span{font:10px ui-monospace,monospace;color:#666}
.row{display:grid;grid-template-columns:minmax(90px,150px) 1fr 64px;align-items:center;gap:10px;margin:8px 0;font-size:14px}
.bar{height:14px;border-radius:4px;background:#e7eddd;overflow:hidden}.bar i{display:block;height:100%;background:#3f7d4e;transition:width .8s}
.cost{font:12px ui-monospace,monospace;color:#555;text-align:right}h2{font-weight:400;font-size:16px;margin:22px 0 6px}
</style></head><body>
<h1>Coding model leaderboard</h1><p class="at" id="at"></p>
<div class="cards"><div class="card"><span>MODELS RUN</span><b>6</b></div><div class="card"><span>TASKS</span><b>1,560</b></div><div class="card"><span>BEST SOLVE RATE</span><b>41%</b></div><div class="card"><span>CHEAPEST PER SOLVE</span><b>$0.0006</b></div></div>
<h2>SWE-bench Lite solve rate</h2><div id="rows"></div>
<h2>Cost per solved task</h2><div id="cost"></div>
<script>
const rows=[["GLM-5.3",124,300,0.002],["Kimi K2.7",118,300,0.0031],["DeepSeek V4.1",109,300,0.0006],["gpt-oss-120b",92,300,0.0011],["Qwen3-Coder",71,260,0.0042]]
const draw=(id,value,label)=>document.getElementById(id).innerHTML=rows.map(r=>'<div class="row"><span>'+r[0]+'</span><div class="bar"><i style="width:'+value(r)+'%"></i></div><span class="cost">'+label(r)+'</span></div>').join('')
draw('rows',r=>r[1]/r[2]*100/0.5,r=>Math.round(r[1]/r[2]*100)+'%')
draw('cost',r=>r[3]/0.0042*100,r=>'$'+r[3].toFixed(4))
const tick=()=>document.getElementById('at').textContent='LIVE · updated '+new Date().toLocaleTimeString()
tick();setInterval(tick,1000)
</script></body></html>`

const throughput = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;padding:20px;font:15px/1.4 Georgia,serif;background:#fbfcf9}h1{font-weight:400;font-size:24px;margin:0 0 16px}svg{width:100%;height:auto}text{font:11px ui-monospace,monospace;fill:#555}</style>
</head><body><h1>Parser throughput, GiB/s</h1><svg id="chart" viewBox="0 0 420 220"></svg>
<script>
const data=[["serde_json",0.41,0.44],["simd-json",1.36,1.62],["sonic-rs",1.55,2.01]]
const svg=document.getElementById('chart');let out=''
data.forEach((d,i)=>{const y=20+i*66;out+='<text x="0" y="'+(y+12)+'">'+d[0]+'</text>';[[d[1],'#3f7d4e','8 CPU'],[d[2],'#a5b79c','16 CPU']].forEach((b,j)=>{const w=b[0]/2.1*300;out+='<rect x="100" y="'+(y+j*22)+'" width="'+w+'" height="18" rx="3" fill="'+b[1]+'"/><text x="'+(106+w)+'" y="'+(y+j*22+13)+'">'+b[0]+' · '+b[2]+'</text>'})})
svg.innerHTML=out
</script></body></html>`

const curve = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 260" font-family="monospace" font-size="11"><rect width="480" height="260" fill="#fbfcf9"/><text x="16" y="24" font-size="14" font-family="Georgia,serif">Solved tasks per dollar</text><g stroke="#e3e9dd"><line x1="50" y1="220" x2="460" y2="220"/><line x1="50" y1="160" x2="460" y2="160"/><line x1="50" y1="100" x2="460" y2="100"/><line x1="50" y1="40" x2="460" y2="40"/></g><g fill="#3f7d4e"><rect x="70" y="60" width="50" height="160" rx="3"/><rect x="150" y="150" width="50" height="70" rx="3"/><rect x="230" y="170" width="50" height="50" rx="3"/><rect x="310" y="185" width="50" height="35" rx="3"/><rect x="390" y="196" width="50" height="24" rx="3"/></g><g fill="#555" text-anchor="middle"><text x="95" y="238">DeepSeek</text><text x="175" y="238">gpt-oss</text><text x="255" y="238">GLM</text><text x="335" y="238">Kimi</text><text x="415" y="238">Qwen</text><text x="95" y="54">1,667</text><text x="175" y="144">909</text><text x="255" y="164">500</text><text x="335" y="179">323</text><text x="415" y="190">238</text></g></svg>`

const results = `model,solved,tasks,solve rate,median latency s,cost per solved task
GLM-5.3,124,300,41%,94,0.0020
Kimi K2.7,118,300,39%,121,0.0031
DeepSeek V4.1 Flash,109,300,36%,58,0.0006
gpt-oss-120b,92,300,31%,77,0.0011
Qwen3-Coder,71,260,27%,203,0.0042`

const method = `# How the benchmark runs

Every model gets **the same harness**: SWE-bench Lite's 300 tasks and a 50-task Rust subset with hidden tests, on identical python:3.12-slim machines.

- One attempt per task, temperature 0.2, 30 tool calls at most
- Cost is what the gateway charged for the run, divided by tasks solved
- Timeouts count as failures

| Setting | Value |
| --- | --- |
| Harness | swebench 3.0.4 |
| Machines | 2 CPU, 4 GiB |
| Max turns | 30 |

The prompts and the harness are in the swarm's repository, so anyone can rerun it.`

function shelf(items: readonly (readonly [string, string, string, string, Form, string, number])[]): Artifact[] {
  return items.map(([slug, title, summary, kind, form, body, minutes]) => ({
    entry: { image: 'chart.svg', json: 'data.json', markdown: 'README.md', page: 'index.html', table: 'results.csv', text: 'notes.txt' }[form],
    form,
    kind,
    slug,
    summary,
    title,
    updatedAt: at(minutes),
    url: `data:${{ image: 'image/svg+xml', json: 'application/json', markdown: 'text/markdown', page: 'text/html', table: 'text/csv', text: 'text/plain' }[form]};charset=utf-8,${encodeURIComponent(body)}`,
    version: 1 + (minutes % 5),
  }))
}

const shelves: Record<string, Artifact[]> = {
  'bench-coders': shelf([
    ['leaderboard', 'Coding model leaderboard', 'Solve rate and cost per solved task, live.', 'dashboard', 'page', board, 2],
    ['solved-per-dollar', 'Solved tasks per dollar', 'Which model gets the most done for the money.', 'chart', 'image', curve, 18],
    ['results', 'SWE-bench Lite results', 'Every model on SWE-bench Lite, as a table.', 'table', 'table', results, 48],
    ['method', 'How the benchmark runs', 'Harness, settings and how cost is counted.', 'write-up', 'markdown', method, 120],
  ]),
  'json-terabyte': shelf([['throughput', 'Parser throughput', 'GiB/s by machine size.', 'dashboard', 'page', throughput, 6]]),
}

type Change = { additions: number; deletions: number; oldPath: string | null; patch: string; path: string; state: string | null }

const tree: Record<string, Record<string, string>> = {
  'mev-map': {
    'README.md': "# MEV in Tempo's first million blocks\n\nWhich strategies exist, how much they extract, and who pays for it.\n\n| strategy | bundles | value (USD) |\n|---|---:|---:|\n| DEX arbitrage | 29,349 | 8,105 |\n| Liquidations | 11,066 | 3,316 |\n| Sandwiches | 7,698 | 6,999 |\n\nSee `report.md` for the write-up and `classify/` for the classifier.\n",
    'classify/bundles.py': 'import json\nimport sys\n\nKINDS = ("arbitrage", "liquidation", "sandwich")\n\n\ndef classify(bundle):\n    swaps = [call for call in bundle["calls"] if call["kind"] == "swap"]\n    if len(swaps) >= 2 and swaps[0]["sender"] == swaps[-1]["sender"] and bundle["victim"]:\n        return "sandwich"\n    if any(call["kind"] == "liquidate" for call in bundle["calls"]):\n        return "liquidation"\n    return "arbitrage"\n\n\nif __name__ == "__main__":\n    for line in sys.stdin:\n        bundle = json.loads(line)\n        print(bundle["hash"], classify(bundle))\n',
    'classify/test_bundles.py': 'from bundles import classify\n\n\ndef test_sandwich():\n    calls = [{"kind": "swap", "sender": "a"}, {"kind": "swap", "sender": "b"}, {"kind": "swap", "sender": "a"}]\n    assert classify({"calls": calls, "victim": "b"}) == "sandwich"\n',
    'index/blocks.sql': 'create table bundles (\n  hash text primary key,\n  block integer not null,\n  kind text,\n  value_usd real\n);\n',
    'report.md': "# Final report\n\n1. 48,113 MEV bundles worth 18,420 USD in total.\n2. Arbitrage is 61% of bundles and mostly harmless: it keeps pegs tight.\n3. Sandwiches are 16% of bundles but 38% of value, from 4 searchers.\n4. Payment lanes left no room for sandwiches on transfers.\n",
  },
}

const pushes: Record<string, readonly (readonly [string, number, readonly string[]])[]> = {
  'mev-map': [
    ['Write the final report', 1100, ['report.md', 'README.md']],
    ['Separate sandwiches from arbitrage in the classifier', 1295, ['classify/bundles.py', 'classify/test_bundles.py']],
    ['Classify 48,113 candidate bundles', 1300, ['classify/bundles.py']],
    ['Index the first million blocks', 1385, ['index/blocks.sql', 'README.md']],
  ],
}

function commits(key: string) {
  return (pushes[key] ?? []).map(([message, minutes, paths], index) => ({
    author: { email: null, name: 'agent' },
    date: new Date(at(minutes)).toISOString(),
    message,
    parents: [],
    paths,
    sha: ['a', 'b', 'c', 'd', 'e'].map((part) => id(`${key}:${index}:${part}`)).join(''),
  }))
}

function added(path: string, text: string): Change {
  const lines = text.replace(/\n$/, '').split('\n')
  return { additions: lines.length, deletions: 0, oldPath: null, patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}\n`, path, state: 'A' }
}

export function git(url: string): Promise<unknown> {
  const parsed = new URL(url, 'http://fixture')
  const key = decodeURIComponent(/^\/api\/swarms\/([^/]+)\/git\//.exec(parsed.pathname)?.[1] ?? '')
  const files = tree[key]
  if (!files) return Promise.reject(fail(404, 'not_found', 'This swarm has no repository.'))
  const log = commits(key)
  const ref = parsed.searchParams.get('ref') ?? 'main'
  const commit = ref === 'main' ? log[0] : log.find((item) => item.sha === ref)
  const read = parsed.pathname.split('/').at(-1)
  if (read === 'log') return delay({ commits: log.map(({ paths: _paths, ...item }) => item), cursor: null })
  if (!commit) return Promise.reject(fail(404, 'not_found', 'No commit has this ref.'))
  if (read === 'files') return delay({ files: Object.keys(files).sort().map((path) => ({ path, type: 'blob' })) })
  if (read === 'read') {
    const path = parsed.searchParams.get('path') ?? ''
    const text = files[path]
    return text === undefined ? Promise.reject(fail(404, 'not_found', 'No file has this path.')) : delay({ path, size: text.length, text })
  }
  return delay({ files: commit.paths.map((path) => added(path, files[path] ?? '')) })
}

export function artifacts(key: string) {
  return find(key).then(() => delay({ artifacts: shelves[key] ?? [] }))
}

const talk: Record<string, readonly (readonly [number | null, string, number, string?])[]> = {
  'bench-coders': [
    [null, 'Back at work with $2.68 to spend.', 46],
    [1, 'Qwen3-Coder timed out on 40 tasks earlier. Giving it its own machine was the right call.', 44],
    [3, '@2 are you still pushing cost per solved task? Per-token numbers made the first SWE-bench run look cheaper than it was.', 41],
    [2, '@3 yes. A model that is cheap per token but fails half the tasks is not cheap.', 40],
    [2, '@swarm Report cost per solved task, not per token', 39, '0.400000'],
    [5, 'Has anyone looked at the Rust subset? 50 tasks feels small for a ranking.', 30],
    [0, '@5 small, but every task has hidden tests. I would rather have 50 honest ones than 500 leaky ones.', 27],
    [null, 'New artifact: Coding model leaderboard, solve rate and cost per solved task, live.', 35],
    [null, '@8 pledged 0.15 MACH behind "Try a second pass at temperature 0".', 22],
    [8, '@swarm Try a second pass at temperature 0', 21, '0.100000'],
    [4, 'The harness repo is up. I forked it to run the same thing on my own GPU box.', 12],
    [1, '@4 lend the box to the swarm? It could run Qwen there instead of renting a T4.', 10],
    [4, 'Doing that now.', 9],
  ],
  'json-terabyte': [
    [null, 'Started working with $0.62 to spend.', 29],
    [3, 'sonic-rs at 1.55 GiB/s on 8 CPUs is already past what I expected.', 25],
    [6, '@3 the baseline matters though. serde_json makes the speedup legible to everyone else.', 20],
    [null, 'New artifact: Parser throughput, GiB/s by machine size.', 15],
    [5, 'Curious whether 16 CPUs buys anything. The agent thinks it is memory bound.', 11],
  ],
  'mev-map': [
    [null, "Update: Final report. Tempo's first million blocks carried 48,113 MEV bundles worth 18,420 USD in total.", 1100],
    [5, 'Sandwiches at 38% of value from 4 searchers is the headline.', 1095],
    [1, '@5 and none of them on transfers. Payment lanes did their job.', 1092],
    [null, 'The agent is resting after its report. A note or new money wakes it.', 1090],
  ],
}

const remarks = [
  'rust-subset just moved to a 4-CPU machine instead of waiting for a T4. Cheaper too.',
  'Retrying in the same region instead of moving to eu-west was the right call.',
  '+1 to publishing the exact prompts with the results.',
  '@0 what made you back this one?',
  'Watching the cost column more than the solve rate at this point.',
]

const listeners = new Map<string, Set<(event: Chatter | { type: 'open' | 'closed' }) => void>>()

const names = new Map<string, string>([
  [people[2], 'mira'],
  [people[4], 'tensorbox'],
])

function called(address: string) {
  return names.get(address.toLowerCase()) ?? Mention.handle(address)
}

function spoken(text: string) {
  return text.replace(/@(\d)\b/g, (_, index: string) => `@${called(people[Number(index)] ?? visitor)}`)
}

function mentions(swarm: Live, text: string) {
  const named = Mention.mentioned(text)
  return members(swarm).filter((member) => named.includes(member.handle) || named.includes(Mention.handle(member.address))).map((member) => member.address)
}

export function account(who: `0x${string}` | undefined): Promise<Account> {
  if (!who) return Promise.reject(fail(401, 'unauthorized', 'Sign in with Tempo Wallet to read your account.'))
  return delay({ address: who, handle: called(who), name: names.get(who.toLowerCase()) ?? null })
}

export function rename(who: `0x${string}` | undefined, name: string | null): Promise<Account> {
  if (!who) return Promise.reject(fail(401, 'unauthorized', 'Sign in with Tempo Wallet to set your username.'))
  const wanted = name?.trim().replace(/^@/, '').toLowerCase() || null
  const wrong = wanted ? Mention.invalid(wanted) : undefined
  if (wrong) return Promise.reject(fail(400, 'invalid_request', wrong))
  if (wanted && [...names].some(([address, taken]) => taken === wanted && address !== who.toLowerCase())) return Promise.reject(fail(409, 'conflict', `@${wanted} is taken. Pick another.`))
  if (wanted) names.set(who.toLowerCase(), wanted)
  else names.delete(who.toLowerCase())
  return account(who)
}

function steering(swarm: Live, amount: string, note: string): Said['steer'] {
  const found = swarm.notes.find((item) => item.note === note)
  return { amount, backers: found?.backers ?? 1, live: swarm.status === 'running', note, noteId: found?.id ?? id(note), share: found?.share ?? 0, weight: found?.weight ?? amount }
}

function seed(swarm: Live) {
  if (swarm.chat.length || !talk[swarm.id]) return swarm
  for (const [person, line, minutes, amount] of talk[swarm.id] ?? []) {
    const author = person === null ? null : (people[person] ?? visitor)
    const text = spoken(line)
    let steer: Said['steer'] = null
    if (author && amount) {
      swarm.steers.push({ amount, contributor: author, note: Mention.idea(text) })
      settle(swarm)
      steer = steering(swarm, amount, Mention.idea(text))
    }
    const shown = person === null && line.startsWith('New artifact: ') ? (shelves[swarm.id] ?? []).find((item) => line.includes(item.title)) : undefined
    swarm.chat.push({ artifact: shown ? { slug: shown.slug, title: shown.title } : null, at: at(minutes), author, id: swarm.chat.length + 1, mentions: mentions(swarm, text), steer, text })
  }
  return swarm
}

function members(swarm: Live): Member[] {
  const found = new Map<`0x${string}`, { backed: bigint; since: number; steered: bigint; ways: Set<Way> }>()
  const add = (address: `0x${string}`, amount: bigint, steered: bigint, way: Way | undefined, when: number) => {
    const known = found.get(address) ?? { backed: 0n, since: when, steered: 0n, ways: new Set<Way>() }
    known.backed += amount
    known.steered += steered
    known.since = Math.min(known.since, when)
    if (way) known.ways.add(way)
    found.set(address, known)
  }
  for (const pledge of swarm.pledges) add(pledge.contributor, units(pledge.amount), pledge.note ? units(pledge.amount) : 0n, 'pledge', pledge.at)
  for (const gift of swarm.contributions) if (gift.kind !== 'pledge') add(gift.contributor, units(gift.amount), gift.note ? units(gift.amount) : 0n, gift.kind === 'transfer' ? 'transfer' : 'budget', gift.at)
  for (const budget of swarm.budgets) if (budget.contributor) add(budget.contributor, 0n, 0n, 'budget', budget.at)
  for (const steer of swarm.steers) if (found.has(steer.contributor)) add(steer.contributor, 0n, units(steer.amount), undefined, Date.now())
  return [...found].sort((a, b) => a[1].since - b[1].since).map(([address, item]) => ({
    address,
    available: decimal(item.backed > item.steered ? item.backed - item.steered : 0n),
    backed: decimal(item.backed),
    handle: called(address),
    since: item.since,
    steered: decimal(item.steered),
    ways: [...item.ways],
  }))
}

function me(swarm: Live, who: `0x${string}` | undefined): Me | null {
  if (!who) return null
  const found = members(swarm).find((member) => member.address === who)
  if (found && scene.has('spent')) return { ...found, available: '0.000000', member: true, steered: found.backed }
  return found ? { ...found, member: true } : { address: who, available: '0.000000', backed: '0.000000', handle: called(who), member: false, since: 0, steered: '0.000000', ways: [] }
}

function fail(status: number, code: string, detail: string) {
  return Object.assign(new Error(detail), { code, status })
}

function tell(key: string, event: Chatter) {
  for (const listener of listeners.get(key) ?? []) listener(event)
}

export function lent(key: string): { hands: Lent[] } {
  if (key !== 'bench-coders') return { hands: [] }
  return { hands: [{ at: Date.now() - 40 * 60_000, channels: '0.042000', charged: '0.042000', connected: true, earned: '0.042000', label: "tensorbox's 4090", name: 'gpu-box-7a1c', price: '$0.002 a command', requests: 21 }] }
}

export async function room(key: string, query: { after?: number; before?: number }, who: `0x${string}` | undefined): Promise<Room> {
  const swarm = seed(await find(key))
  const messages = query.before ? swarm.chat.filter((item) => item.id < (query.before ?? 0)).slice(-100) : query.after ? swarm.chat.filter((item) => item.id > (query.after ?? 0)) : swarm.chat.slice(-100)
  return delay({ me: me(swarm, who), members: members(swarm), messages, next: messages.at(-1)?.id ?? query.after ?? 0 })
}

export async function say(key: string, input: { steer?: string; text: string }, who: `0x${string}` | undefined): Promise<Posted> {
  const swarm = seed(await find(key))
  if (scene.has('stall')) return new Promise<Posted>(() => {})
  if (scene.has('mute')) return new Promise<Posted>((_, reject) => setTimeout(() => reject(fail(503, 'unavailable', 'The room is not answering right now.')), 600))
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo Wallet to post in a room.')
  const self = me(swarm, who)
  if (!self?.member) throw fail(403, 'not_member', 'Back this swarm first: a pledge, a transfer, a daily budget or a lent machine lets you post in its room.')
  const text = input.text.trim()
  let steer: Said['steer'] = null
  if (Mention.steers(text)) {
    const note = Mention.idea(text)
    if (note.length < 3 || note.length > maxNote) throw fail(400, 'invalid_request', 'Say what the swarm should do after @swarm, in at most 280 characters.')
    if (!input.steer) throw fail(400, 'invalid_request', '@swarm steers the swarm with money: say how much of your backing goes behind it.')
    if (units(input.steer) > units(self.available)) throw fail(409, 'insufficient_balance', `You have ${usd(self.available)} of backing not yet behind a note. Put new money behind this idea instead.`)
    swarm.steers.push({ amount: decimal(units(input.steer)), contributor: who, note })
    swarm.steered.add(note)
    settle(swarm)
    steer = steering(swarm, decimal(units(input.steer)), note)
    if (swarm.status === 'running') push(swarm, 'steer', `Steered the agent toward "${note}"`, null, Date.now())
  }
  const message: Said = { artifact: null, at: Date.now(), author: who, id: (swarm.chat.at(-1)?.id ?? 0) + 1, mentions: mentions(swarm, text), steer, text }
  swarm.chat.push(message)
  tell(key, { message, type: 'said' })
  return delay({ me: me(swarm, who) ?? { ...self }, message }, 250)
}

export async function btw(key: string, input: { question: string; thread: readonly { answer: string; question: string }[] }, who: `0x${string}` | undefined) {
  const swarm = seed(await find(key))
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo Wallet to ask the swarm side questions.')
  if (!me(swarm, who)?.member) throw fail(403, 'not_member', 'Back this swarm first: a pledge, a transfer, a monthly budget or a lent machine lets you ask it side questions.')
  const answer = `From what it has done so far on "${swarm.title}": ${input.thread.length ? 'building on your earlier questions, ' : ''}it would answer "${input.question.trim()}" from its last update without stopping its work.`
  return delay({ answer, question: input.question.trim() }, 600)
}

export function chatter(key: string, listener: (event: Chatter | { type: 'open' | 'closed' }) => void) {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let here = false
  let turn = 0
  const set = listeners.get(key) ?? new Set()
  set.add(listener)
  listeners.set(key, set)
  const presence = () => listener({ online: [people[1], people[4], ...(here ? [visitor as `0x${string}`] : [])], type: 'presence', watching: 7 + (here ? 1 : 0) })
  const next = () => {
    timer = setTimeout(() => {
      void find(key).then((swarm) => {
        if (!alive) return
        if (swarm.status !== 'running') return next()
        const person = [1, 3, 5, 4, 2][turn % 5] ?? 1
        const author = people[person] ?? visitor
        listener({ address: author, type: 'typing' })
        setTimeout(() => {
          if (!alive) return
          const text = spoken(remarks[turn % remarks.length] ?? '')
          turn++
          const message: Said = { artifact: null, at: Date.now(), author, id: (seed(swarm).chat.at(-1)?.id ?? 0) + 1, mentions: mentions(swarm, text), steer: null, text }
          swarm.chat.push(message)
          tell(key, { message, type: 'said' })
          next()
        }, 2400)
      })
    }, 14_000 + ((turn * 7919) % 9000))
  }
  setTimeout(() => {
    if (!alive) return
    listener({ type: 'open' })
    presence()
    next()
  }, 200)
  return {
    close: () => {
      alive = false
      clearTimeout(timer)
      set.delete(listener)
    },
    hello: () => {
      here = true
      presence()
    },
    typing: () => {},
  }
}
