import * as Answer from '../shared/Answer.ts'
import type { Account, Artifact, Branch, Branches, Code, Chatter, Config, Contributed, Contribution, Currency, Detail, Entry, Form, Kind, Lent, Live as LiveEvent, Lobby, Me, Member, Note, Part, Posted, Pulse, Room, Roster, Said, Status, Steering, Summary, Token, Update, Way, Why } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import { problems } from '../shared/ResearchBrief.ts'
import * as Setup from '../shared/Setup.ts'
import { usd } from './format.ts'
import { pace, scene, visitor } from './stage.ts'

type Line = readonly [Kind, string, (string | null)?, string?]

type Backing = { amount: string; contributor: `0x${string}`; note: string }

type Live = Omit<Detail, 'answer' | 'reason' | 'updates' | 'why' | 'working'> & { updates: Update[]; chat: Said[]; cursor: number; flicker: readonly string[]; next: number; resting: boolean; script: readonly Line[]; since: number | null; steered: Set<string>; steers: Backing[] }

const minute = 60_000

const models: Setup.Price[] = [
  { cached: 0.19, id: '@cf/moonshotai/kimi-k2.7-code', input: 0.95, output: 4 },
  { cached: 0.14, id: '@cf/zai-org/glm-5.3', input: 1.12, output: 3.52 },
  { cached: 0.024, id: '@cf/zai-org/glm-5.3-flash', input: 0.12, output: 0.4 },
  { cached: 0.0048, id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017', input: 0.24, output: 0.96 },
  { cached: 0.25, id: 'vercel/anthropic/claude-fable-5.1', input: 10, output: 50 },
  { cached: 0.01, id: 'vercel/anthropic/claude-haiku-5.5', input: 0.1, output: 0.5 },
  { cached: 0.2, id: 'vercel/anthropic/claude-opus-5.5', input: 4, output: 20 },
  { cached: 0.1, id: 'vercel/anthropic/claude-sonnet-5.5', input: 2, output: 10 },
  { cached: 0.075, id: 'vercel/google/gemini-3.8-flash', input: 0.75, output: 3.75 },
  { cached: 0.1, id: 'vercel/google/gemini-4-argon', input: 2, output: 10 },
  { cached: 0.23, id: 'vercel/moonshotai/kimi-k3', input: 2.3, output: 11.4 },
  { cached: 1, id: 'vercel/openai/gpt-6-astra', input: 10, output: 50 },
  { cached: 0.01, id: 'vercel/openai/gpt-6-luna', input: 0.1, output: 0.5 },
  { cached: 0.1, id: 'vercel/openai/gpt-6.1-sol', input: 2, output: 10 },
  { cached: 0.05, id: 'vercel/openai/gpt-6.1-terra', input: 1, output: 5 },
  { cached: 0.5, id: 'vercel/spacexai/grok-4.7', input: 2, output: 6 },
]

function setup(choice: Setup.Choice) {
  const resolved = Setup.resolve(choice)
  const priced = typeof resolved === 'string' ? resolved : Setup.priced(resolved, new Map(models.map((model) => [model.id, model])))
  if (typeof priced === 'string') throw fail(400, 'invalid_request', priced)
  return priced
}

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
  gifts?: readonly (readonly [number, string, Token, number, string | null])[]
  problem?: string | undefined
  resting?: boolean
  script?: readonly Line[]
  setup?: Setup.Setup | null
  since?: number
  spent: string
  status: Status
  steered?: readonly string[]
  title: string
  updates: readonly (readonly [number, string, string])[]
}): Live {
  const contributions = (input.gifts ?? []).map(([person, amount, token, minutes, note], index): Contribution => ({
    amount,
    at: at(minutes),
    contributor: people[person] ?? visitor,
    hash: `0x${id(`${input.id}:gift:${index}`).repeat(8)}`,
    note,
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
    chat: [],
    contributions,
    contributors: 0,
    createdAt: at(input.age),
    code: input.code ?? null,
    cursor: 0,
    feed,
    flicker: input.flicker ?? [],
    goal: input.goal,
    hands: (input.hands ?? []).map((name) => ({ connected: true, name })),
    id: input.id,
    machines: 0,
    next: started + 1200,
    notes: [],
    pool: '0',
    problem: input.problem ?? null,
    resting: input.resting ?? false,
    raised: '0',
    remaining: '0',
    setup: input.setup === undefined ? setup({ template: 'frontier-mix' }) : input.setup,
    wallet,
    script: input.script ?? [],
    since: input.status === 'running' ? at(input.since ?? 30) : null,
    spent: input.spent,
    status: input.status,
    steered: new Set(input.steered ?? []),
    steering: 'open',
    steers: [],
    title: input.title,
    updatedAt: feed.at(-1)?.at ?? at(input.age),
    updates: input.updates.map(([minutes, text, spent]): Update => ({ at: at(minutes), base: null, commits: [], done: /STATUS:\s*done/i.test(text), spent, text: Answer.parse(text, at(minutes)).text })),
  })
}

function settle(swarm: Live) {
  const given = swarm.contributions.reduce((sum, gift) => sum + units(gift.amount), 0n)
  const raised = given
  swarm.raised = decimal(raised)
  swarm.remaining = decimal(raised > units(swarm.spent) ? raised - units(swarm.spent) : 0n)
  swarm.contributors = new Set(swarm.contributions.map((gift) => gift.contributor)).size
  swarm.pool = decimal(given > units(swarm.spent) / 2n ? given - units(swarm.spent) / 2n : 0n)
  swarm.machines = swarm.hands.filter((hand) => hand.connected).length
  const groups = new Map<string, (Contribution | Backing)[]>()
  for (const backing of [...swarm.contributions, ...swarm.steers]) if (backing.note) groups.set(backing.note, [...(groups.get(backing.note) ?? []), backing])
  swarm.notes = [...groups]
    .map(([note, backings]): Note => {
      const weight = backings.reduce((sum, backing) => sum + units(backing.amount), 0n)
      return {
        backers: new Set(backings.map((backing) => backing.contributor)).size,
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
  ['status', 'Updated the artifact "Coding model leaderboard" (version 3)', 'Solve rate and cost per solved task, live.'],
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
    gifts: [
      [0, '2.000000', 'usdce', 140, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
      [2, '0.640000', 'usdce', 70, 'Report cost per solved task, not per token'],
      [5, '0.500000', 'pathusd', 52, null],
      [3, '0.250000', 'ousd', 31, 'Publish the harness as a repo anyone can fork'],
      [2, '0.400000', 'usdce', 12, 'Report cost per solved task, not per token'],
      [1, '1.000000', 'usdce', 180, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
      [2, '0.500000', 'usdce', 170, 'Report cost per solved task, not per token'],
      [3, '0.250000', 'usdce', 150, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
      [4, '0.600000', 'usdce', 120, 'Publish the harness as a repo anyone can fork'],
      [5, '0.250000', 'usdce', 95, null],
      [6, '0.700000', 'usdce', 60, 'Report cost per solved task, not per token'],
      [7, '0.250000', 'usdce', 40, 'Skip models without tool calling'],
      [8, '0.150000', 'usdce', 22, 'Try a second pass at temperature 0'],
      [0, '0.300000', 'usdce', 9, 'Include Qwen3-Coder and Kimi K2.7 even if they are slow'],
      [1, '0.250000', 'usdce', 3, 'Report cost per solved task, not per token'],
      [0, '1.000000', 'usdce', 100, null],
    ],
    id: 'bench-coders',
    problem: 'coding-models',
    lines: [
      ['status', 'Told the agent to keep going, with $2.68 left.'],
      ['status', 'Published the artifact "Coding model leaderboard"', 'Solve rate and cost per solved task, live.\n/a/bench-coders/leaderboard/index.html'],
      ['steer', 'Steered the agent toward "Include Qwen3-Coder and Kimi K2.7 even if they are slow"', '1.55 MACH behind it, 36.5% of everything contributed'],
      ['status', 'Published the artifact "Solved tasks per dollar"', 'Which model gets the most done for the money.\n/a/bench-coders/solved-per-dollar/chart.svg'],
      ...benchmark,
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
    gifts: [
      [4, '0.180000', 'pathusd', 38, 'Measure cost per GiB, not just throughput'],
      [3, '0.500000', 'usdce', 68, 'Measure cost per GiB, not just throughput'],
      [5, '0.250000', 'usdce', 30, null],
      [6, '0.100000', 'usdce', 12, 'Include serde_json as the baseline'],
    ],
    id: 'json-terabyte',
    problem: 'json-terabyte',
    lines: [['status', 'Started working with $0.62 to spend.'], ...parser],
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
    gifts: [
      [2, '0.600000', 'usdce', 29, 'Keep code blocks in English'],
    ],
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
    gifts: [
      [4, '0.500000', 'usdce', 390, 'Explain fees with real transactions'],
      [7, '0.300000', 'usdce', 300, null],
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
    lines: [['status', 'Created. The first contribution starts its agent.']],
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
    gifts: [
      [5, '1.000000', 'usdce', 1430, 'Separate sandwiches from arbitrage'],
      [8, '0.500000', 'usdce', 1300, null],
      [1, '0.500000', 'usdce', 1100, 'Separate sandwiches from arbitrage'],
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
  costly: "Waiting for money: the agent's next model call holds $0.2147, more than the $0.2083 any one contribution can pay at once. A contribution that can cover it starts it again.",
  money: 'Waiting for money: $0.0038 is payable now, less than one model call holds. New money keeps it going.',
  rest: 'The agent hit 3 errors in a row, so the swarm stopped to rest. New money restarts it.',
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
    goal: swarm.goal,
    id: swarm.id,
    machines: swarm.machines,
    pool: swarm.pool,
    problem: swarm.problem,
    raised: swarm.raised,
    remaining: swarm.remaining,
    setup: swarm.setup,
    spent: swarm.spent,
    status: swarm.status,
    steering: swarm.steering,
    title: swarm.title,
    updatedAt: swarm.updatedAt,
    wallet: swarm.wallet,
    why: reason(swarm) ? why(swarm) : null,
  }
}

function detail(swarm: Live): Detail {
  return {
    ...summary(swarm),
    code: swarm.code,
    contributions: swarm.contributions,
    feed: swarm.feed.slice(-200),
    hands: swarm.hands,
    notes: swarm.notes,
    reason: reason(swarm),
    why: reason(swarm) ? why(swarm) : null,
    updates: swarm.updates,
    working: swarm.since === null ? null : { since: swarm.since },
  }
}

export function config(): Promise<Config> {
  return steady({
    auth: '/v1/auth',
    chainId: 4217,
    channel: { escrow: '0x4d50500000000000000000000000000000000000', least: '0.050000', operator: '0x4cC7C5c526B16a0137270C48D84f826E16C99965', recipient: '0x40def0Cf3B5d28B6e9a7976BA10591e515AfECFE', signer: '0xa47b45c12b7588b56e3a11fe3e808fc1b72577b2' },
    explorer: 'https://explore.tempo.xyz',
    gateway: 'https://gateway.tempo-dev.workers.dev',
    models,
    reserve: '0.050000',
    rpc: 'https://rpc.tempo.xyz',
    tokens: [
      { address: '0x20c0000000000000000000006a37DA5C996874BE', id: 'ousd', symbol: 'OUSD' },
      { address: '0x20c0000000000000000000000000000000000000', id: 'pathusd', symbol: 'pathUSD' },
      { address: '0x20C000000000000000000000b9537d11c60E8b50', id: 'usdce', symbol: 'USDC.e' },
      { address: '0x20c000000000000000000000f37de3740ADec032', id: 'mach', symbol: 'MACH' },
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

export function live(key: string, after: number, listener: (event: LiveEvent | { type: 'lost' | 'open' }) => void) {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let event = 1_000_000
  let turn = 0
  let cursor = after
  let working = false
  const later = (ms: number, run: () => void) => {
    timer = setTimeout(() => alive && run(), ms)
  }
  const flush = (swarm: Live) => {
    for (const entry of swarm.feed)
      if (entry.seq > cursor) {
        cursor = entry.seq
        listener({ entry, type: 'entry' })
      }
  }
  const say = (swarm: Live, who: string | null, kind: Kind, text: string, detail: string | null) => {
    const entry: Entry = { at: Date.now(), detail, event: ++event, kind, seq: 0, text, who }
    listener({ entry, type: 'entry' })
    swarm.feed.push({ ...entry, seq: (swarm.feed.at(-1)?.seq ?? 0) + 1 })
    swarm.updatedAt = entry.at
    flush(swarm)
  }
  const next = async () => {
    const swarm = await find(key).catch(() => undefined)
    if (!alive) return
    if (swarm) flush(swarm)
    if (!swarm || swarm.status !== 'running') {
      if (working) listener({ type: 'end' })
      working = false
      return later(4000, () => void next())
    }
    if (!working) listener({ at: swarm.since ?? Date.now(), type: 'start' })
    working = true
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
  void find(key).then(
    (swarm) => {
      if (!alive) return
      listener({ type: 'open' })
      if (swarm.status !== 'running') listener({ type: 'idle' })
      void next()
    },
    () => alive && listener({ type: 'lost' }),
  )
  return () => {
    alive = false
    clearTimeout(timer)
  }
}

export function create(input: { goal: string; problem?: string; title: string } & Partial<Setup.Choice>) {
  const key = id(`${input.title}:${Date.now()}`)
  const swarm = build({ age: 0, goal: input.goal, id: key, problem: input.problem, setup: setup({ ...input, template: input.template ?? Setup.fallback }), lines: [['status', 'Created. The first contribution starts its agent.']], spent: '0', status: 'funding', title: input.title, updates: [] })
  fixtures.unshift(swarm)
  return delay(summary(swarm), 400)
}

function begin(swarm: Live) {
  if (swarm.status !== 'funding' && swarm.status !== 'paused') return
  push(swarm, 'status', `${swarm.updates.length ? 'Back at work' : 'Started working'} with ${usd(swarm.remaining)} to spend.`, null, Date.now())
  swarm.status = 'running'
  swarm.since = Date.now()
  if (swarm.script.length === 0) swarm.script = translation
}

export const sent = new Map<string, { amount: bigint; token: Currency }>()

const dropped = new Set<string>()

export async function contribute(key: string, input: { hash: string; note?: string }): Promise<Contributed> {
  const swarm = await find(key)
  const hash = input.hash as `0x${string}`
  if (swarm.contributions.some((gift) => gift.hash === hash)) throw fail(409, 'conflict', 'This transaction is already counted.')
  if (scene.has('uncounted') && !dropped.has(hash)) {
    dropped.add(hash)
    throw fail(502, 'unavailable', 'Swarms could not reach Tempo to check the transfer.')
  }
  const paid = sent.get(hash)
  const token = paid?.token ?? 'usdce'
  const contribution: Contribution = { amount: decimal(paid?.amount ?? 250_000n), at: Date.now(), contributor: visitor, hash, note: input.note?.trim() || null, token }
  swarm.contributions.push(contribution)
  if (contribution.note) swarm.steered.add(contribution.note)
  push(swarm, 'funds', `${visitor.slice(0, 6)}…${visitor.slice(-4)} sent ${contribution.amount} ${token === 'mach' ? 'MACH' : 'USDC.e'}${contribution.note ? ' with a note' : ''}`, contribution.note, Date.now())
  begin(swarm)
  settle(swarm)
  pulsed(key, swarm)
  changed(key, ['detail', 'members'])
  return delay({ contribution, swarm: summary(swarm) }, 500)
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

const wishes = JSON.stringify([
  { want: 'An H100 with 80 GB for about 3 hours', why: 'The 70B models do not fit on the A10G machines, so 4 of the 12 models on the leaderboard are still untested', use: 'Would pay up to $12 from the swarm money, or run on a lent machine', status: 'open' },
  { want: 'Access to the Claude Opus 5.5 batch API', why: 'Half price on the 300 SWE-bench Lite tasks, which would let the swarm test 3 more models', use: 'About $40 of tasks a run, paid per call', status: 'open' },
  { want: 'SWE-bench Verified with its gold patches', why: 'The harness needs the verified split to score patches', use: 'Read once per run', status: 'found', found: 'Hugging Face princeton-nlp/SWE-bench_Verified, from @ana' },
  { want: 'Someone who maintains the SWE-bench harness', why: 'Two tasks time out the same way for every model', status: 'no longer needed' },
])

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
    ['wishlist', 'Wishlist', '2 open: an H100 for the 70B models.', 'wishlist', 'json', wishes, 10],
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
  ...(scene.has('nameless') ? [] : [[visitor, 'ada'] as [string, string]]),
  [people[2], 'mira'],
  [people[4], 'tensorbox'],
])

function called(address: string) {
  return names.get(address.toLowerCase()) ?? Mention.short(address)
}

function spoken(text: string) {
  return text.replace(/@(\d)\b/g, (_, index: string) => Mention.at(called(people[Number(index)] ?? visitor)))
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
  for (const gift of swarm.contributions) add(gift.contributor, units(gift.amount), gift.note ? units(gift.amount) : 0n, 'transfer', gift.at)
  for (const steer of swarm.steers) if (found.has(steer.contributor)) add(steer.contributor, 0n, units(steer.amount), undefined, Date.now())
  for (const put of planted.get(swarm.id) ?? []) if (found.has(put.contributor)) add(put.contributor, 0n, put.amount, undefined, Date.now())
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

export async function say(key: string, input: { artifact?: boolean; steer?: string; text: string }, who: `0x${string}` | undefined): Promise<Posted> {
  const swarm = seed(await find(key))
  if (scene.has('stall')) return new Promise<Posted>(() => {})
  if (scene.has('mute')) return new Promise<Posted>((_, reject) => setTimeout(() => reject(fail(503, 'unavailable', 'The room is not answering right now.')), 600))
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo Wallet to post in a room.')
  if (!names.has(who.toLowerCase())) throw fail(403, 'username_required', 'Pick a username first.')
  const self = me(swarm, who) as Me
  const seated = swarm.steering === 'team' ? rosters.get(key)?.seats.find((found) => found.address === who.toLowerCase()) : undefined
  if (!self?.member && !seated) throw fail(403, 'not_member', 'Back this swarm first: money or a lent machine lets you post in its room.')
  const text = input.text.trim()
  if (swarm.steering === 'team' && Mention.steers(text) && !seated) throw fail(403, 'not_member', "Only this swarm's team steers it.")
  let steer: Said['steer'] = null
  if (Mention.steers(text)) {
    const note = Mention.idea(text)
    if (note.length < 3 || note.length > maxNote) throw fail(400, 'invalid_request', 'Say what the swarm should do after @swarm, in at most 280 characters.')
    if (!input.steer) throw fail(400, 'invalid_request', '@swarm steers the swarm with money: say how much of your backing goes behind it.')
    if (seated ? seated.left !== null && units(input.steer) > units(seated.left) : units(input.steer) > units(self.available)) throw fail(409, 'insufficient_balance', `You have ${usd(self.available)} of backing not yet behind a note. Put new money behind this idea instead.`)
    swarm.steers.push({ amount: decimal(units(input.steer)), contributor: who, note })
    swarm.steered.add(note)
    settle(swarm)
    steer = steering(swarm, decimal(units(input.steer)), note)
    if (swarm.status === 'running') push(swarm, 'steer', `Steered the agent toward "${note}"`, null, Date.now())
    changed(key, ['detail', 'members'])
  }
  const message: Said = { artifact: null, at: Date.now(), author: who, id: (swarm.chat.at(-1)?.id ?? 0) + 1, mentions: mentions(swarm, text), steer, text }
  swarm.chat.push(message)
  tell(key, { message, type: 'said' })
  return delay({ me: me(swarm, who) as Me, message }, 250)
}

export async function btw(key: string, input: { branch?: number; question: string; thread: readonly { answer: string; question: string }[] }, who: `0x${string}` | undefined) {
  const swarm = seed(await find(key))
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo Wallet to ask the swarm side questions.')
  if (!names.has(who.toLowerCase())) throw fail(403, 'username_required', 'Pick a username first.')
  const asker = me(swarm, who)
  if (!(asker?.member && units(asker.backed) >= 10_000n) && !(swarm.steering === 'team' && rosters.get(key)?.seats.some((found) => found.address === who.toLowerCase())))
    throw fail(403, 'not_member', "Side questions are paid from the swarm's money, so they take at least $0.01 of your own sent to it.")
  const branch = input.branch === undefined ? undefined : grown(swarm).find((found) => found.id === input.branch)
  const answer = `${branch ? `${branch.role}, from what it has done on its branch` : `From what it has done so far on "${swarm.title}"`}: ${input.thread.length ? 'building on your earlier questions, ' : ''}it would answer "${input.question.trim()}" from its last update without stopping its work.`
  return delay({ answer, question: input.question.trim() }, 600)
}

const versions = new Map<string, number>()

function version(key: string) {
  const next = (versions.get(key) ?? 0) + 1
  versions.set(key, next)
  return String(next)
}

function pulse(swarm: Live): Pulse {
  const shown = detail(swarm)
  return { hands: shown.hands, reason: shown.reason, swarm: summary(swarm), why: shown.why, working: shown.working }
}

function changed(key: string, parts: Part[]) {
  tell(key, { parts, type: 'changed', version: version(key) })
}

function pulsed(key: string, swarm: Live) {
  tell(key, { type: 'pulse', version: version(key), ...pulse(swarm) })
}

const offline = scene.has('down') || scene.has('wait')

export function chatter(key: string, listen: boolean, listener: (event: Chatter | { type: 'open' | 'closed' }) => void) {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let watch: ReturnType<typeof setInterval> | undefined
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
  const follow = () => {
    let sent: string | undefined
    let fed = 0
    let updates = 0
    watch = setInterval(() => {
      void find(key).then((swarm) => {
        if (!alive) return
        const now = pulse(swarm)
        const json = JSON.stringify(now)
        if (sent !== undefined && json !== sent) listener({ type: 'pulse', version: version(key), ...now })
        const grown = sent !== undefined && swarm.status !== 'running' && swarm.feed.length > fed
        const updated = sent !== undefined && swarm.updates.length > updates
        if (grown || updated) listener({ parts: [...(grown ? (['feed'] as const) : []), ...(updated ? (['detail'] as const) : [])], type: 'changed', version: version(key) })
        sent = json
        fed = swarm.feed.length
        updates = swarm.updates.length
      }, () => {})
    }, 5000)
  }
  setTimeout(() => {
    if (!alive) return
    listener({ type: 'open' })
    if (!listen) presence()
    if (!offline) listener({ type: 'welcome', version: String(versions.get(key) ?? 0) })
    follow()
    if (!listen) next()
  }, 200)
  return {
    close: () => {
      alive = false
      clearTimeout(timer)
      clearInterval(watch)
      set.delete(listener)
    },
    hello: () => {
      if (listen) return
      here = true
      presence()
    },
    typing: () => {},
  }
}

export function lobby(listener: (event: Lobby | { type: 'open' | 'closed' }) => void) {
  let alive = true
  let timer: ReturnType<typeof setInterval> | undefined
  const sent = new Map<string, string>()
  const listed = () => (scene.has('empty') ? [] : fixtures.map((swarm) => summary(swarm)).filter((swarm) => Number(swarm.raised) > 0))
  const opened = setTimeout(() => {
    if (!alive || offline) return
    listener({ type: 'open' })
    listener({ type: 'welcome' })
    for (const swarm of listed()) sent.set(swarm.id, JSON.stringify(swarm))
    timer = setInterval(() => {
      for (const swarm of fixtures) tick(swarm)
      for (const swarm of listed()) {
        const json = JSON.stringify(swarm)
        if (sent.get(swarm.id) === json) continue
        sent.set(swarm.id, json)
        listener({ swarm, type: 'swarm' })
      }
    }, 10_000)
  }, 200)
  return () => {
    alive = false
    clearTimeout(opened)
    clearInterval(timer)
  }
}

const rosters = new Map<string, Roster>()

function rostered(key: string, steering: Steering): Roster {
  return rosters.get(key) ?? { admins: [visitor.toLowerCase() as `0x${string}`], memberBudget: null, seats: [], steering, team: null }
}

export async function team(key: string): Promise<Roster> {
  const swarm = seed(await find(key))
  return delay(rostered(key, swarm.steering))
}

export async function govern(key: string, input: { memberBudget?: number | null; steering?: Steering }, who: `0x${string}` | undefined): Promise<Roster> {
  const swarm = seed(await find(key))
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo Wallet to manage who steers a swarm.')
  const current = rostered(key, swarm.steering)
  if (!current.admins.includes(who.toLowerCase() as `0x${string}`)) throw fail(403, 'access_denied', "Only this swarm's admins choose who steers it.")
  if (input.steering) swarm.steering = input.steering
  const seats = current.seats.length ? current.seats : [{ address: who.toLowerCase() as `0x${string}`, handle: me(swarm, who)?.handle ?? 'you', left: null, limit: null, role: 'admin' as const, spent: '0.000000' }]
  const next: Roster = { ...current, memberBudget: input.memberBudget === undefined ? current.memberBudget : input.memberBudget === null ? null : decimal(units(String(input.memberBudget))), seats, steering: swarm.steering, team: current.team ?? '0x00000000000000000000000000000000000000aa' }
  rosters.set(key, next)
  tell(key, { roster: next, type: 'roster' })
  return delay(next, 250)
}

export async function seat(key: string, input: { budget?: number | null; member: string; role: 'admin' | 'member' }, who: `0x${string}` | undefined): Promise<Roster> {
  const current = await govern(key, {}, who)
  const address = input.member.toLowerCase() as `0x${string}`
  const limit = input.budget === undefined || input.budget === null ? current.memberBudget : decimal(units(String(input.budget)))
  const seats = [...current.seats.filter((found) => found.address !== address), { address, handle: called(address), left: limit, limit, role: input.role, spent: '0.000000' }]
  const next: Roster = { ...current, admins: seats.filter((found) => found.role === 'admin').map((found) => found.address), seats }
  rosters.set(key, next)
  tell(key, { roster: next, type: 'roster' })
  return delay(next, 250)
}

export async function unseat(key: string, member: string, who: `0x${string}` | undefined): Promise<Roster> {
  const current = rosters.get(key)
  if (!who || !current) throw fail(404, 'not_found', 'This swarm has no team yet.')
  const seats = current.seats.filter((found) => found.address !== member.toLowerCase())
  const next: Roster = { ...current, admins: seats.filter((found) => found.role === 'admin').map((found) => found.address), seats }
  rosters.set(key, next)
  tell(key, { roster: next, type: 'roster' })
  return delay(next, 250)
}


type Sprout = readonly [number, number | null, string, string, Branch['state'], string | null, string | null]

const sprouts: readonly Sprout[] = [
  [1, null, 'rust-subset', 'Write 50 small Rust tasks with hidden tests (parsing, lifetimes, async) and run every shortlisted model against them.', 'running', null, '0.640000'],
  [2, 1, 'parser-tasks', 'Write the 18 parsing tasks and their hidden tests.', 'completed', null, '0.110000'],
  [3, null, 'swe-bench-lite', 'Run SWE-bench Lite on four machines, 75 tasks per model, and record the solve rate and the cost of each solved task.', 'running', '2.000000', '1.420000'],
  [4, 3, 'machine-2', 'Run tasks 76 to 150 on the second machine.', 'running', '0.600000', '0.310000'],
  [5, null, 'latency-probe', 'Measure time to first token and tokens per second for each model through the gateway.', 'failed', '0.500000', '0.500000'],
  [6, null, 'license-check', 'Read each shortlisted model\'s license and say which ones a company may use commercially.', 'completed', '0.300000', '0.120000'],
]

const planted = new Map<string, { amount: bigint; branch: number; contributor: `0x${string}` }[]>()

const woken = new Set<string>()

const halted = new Set<string>()

const found: Record<number, string> = {
  2: '18 parsing tasks with hidden tests, in `tasks/parse/`. Two of them (nested generics, raw strings) fail on every model so far.',
  6: 'Seven of the nine shortlisted models allow commercial use. **Llama 4** needs a separate license above 700M monthly users, and **Command R+** is non-commercial only. Details in `licenses.md`.',
}

function grown(swarm: Live): Branch[] {
  if (swarm.status === 'funding') return []
  const puts = planted.get(swarm.id) ?? []
  return sprouts.map(([id, parent, role, task, state, budget, spent]) => {
    const mine = puts.filter((put) => put.branch === id)
    const funded = mine.reduce((sum, put) => sum + put.amount, 0n)
    const total = budget === null ? null : units(budget) + funded
    const used = spent === null ? (total === null ? null : 0n) : units(spent)
    const awake = woken.has(`${swarm.id}:${id}`)
    const stopped = halted.has(`${swarm.id}:${id}`)
    const starved = state === 'failed' && !awake && total !== null && used !== null && used >= total
    const shares = new Map<`0x${string}`, bigint>()
    for (const put of mine) shares.set(put.contributor, (shares.get(put.contributor) ?? 0n) + put.amount)
    return {
      budget: total === null ? null : decimal(total),
      error: null,
      funded: decimal(funded > 0n ? funded : 0n),
      funders: [...shares].filter(([, amount]) => amount > 0n).sort((a, b) => (b[1] > a[1] ? 1 : -1)).map(([address, amount]) => ({ address, amount: decimal(amount), handle: called(address) })),
      id,
      left: total === null || used === null ? null : decimal(total > used ? total - used : 0n),
      parent,
      result: found[id] ?? null,
      role,
      spent: used === null ? null : decimal(used),
      starved: starved && !stopped,
      state: stopped ? 'closed' : awake && state === 'failed' ? 'running' : state,
      task,
      who: role,
    }
  })
}

export async function branches(key: string): Promise<Branches> {
  const swarm = seed(await find(key))
  return delay({ branches: grown(swarm), steering: swarm.steering })
}

function directing(swarm: Live, key: string, who: `0x${string}` | undefined) {
  if (!who) throw fail(401, 'unauthorized', "Sign in with Tempo Wallet to direct a swarm's money.")
  if (!names.has(who.toLowerCase())) throw fail(403, 'username_required', 'Pick a username first.')
  const seated = swarm.steering === 'team' ? rosters.get(key)?.seats.find((found) => found.address === who.toLowerCase()) : undefined
  if (swarm.steering === 'team' && !seated) throw fail(403, 'not_member', "Only this swarm's team directs its money.")
  return seated
}

export async function stop(key: string, branch: number, who: `0x${string}` | undefined): Promise<Branch> {
  const swarm = seed(await find(key))
  directing(swarm, key, who)
  const target = grown(swarm).find((found) => found.id === branch && found.parent === null)
  if (!target) throw fail(404, 'not_found', `This swarm has no branch ${branch}.`)
  const funded = target.funders.reduce((sum, funder) => sum + units(funder.amount), 0n)
  const mine = units(target.funders.find((funder) => funder.address === who?.toLowerCase())?.amount ?? '0')
  if (!(funded > 0n && mine * 2n > funded) && !rostered(key, swarm.steering).admins.includes(who?.toLowerCase() as `0x${string}`))
    throw fail(403, 'access_denied', `Only whoever holds more than half of the money behind ${target.role}, or the swarm's admins, stop it.`)
  halted.add(`${swarm.id}:${branch}`)
  const left = target.budget === null ? funded : target.left === null ? 0n : units(target.left)
  const back = left < funded ? left : funded
  if (back > 0n)
    planted.set(swarm.id, [...(planted.get(swarm.id) ?? []), ...target.funders.map((funder) => ({ amount: -(back * units(funder.amount)) / funded, branch, contributor: funder.address }))])
  push(swarm, 'status', `${Mention.at(called(who as string))} stopped ${target.role} (branch ${branch}).`, null, Date.now())
  changed(key, ['branches', 'members'])
  return delay(grown(swarm).find((found) => found.id === branch) as Branch, 300)
}

export async function fund(key: string, branch: number, input: { amount: string; artifact?: boolean; message?: string }, who: `0x${string}` | undefined): Promise<Branch> {
  const swarm = seed(await find(key))
  const seated = directing(swarm, key, who)
  const target = grown(swarm).find((found) => found.id === branch && found.parent === null)
  if (!target) throw fail(404, 'not_found', `This swarm has no branch ${branch}.`)
  const self = me(swarm, who)
  const amount = units(input.amount)
  if (!seated && (!self?.member || amount > units(self.available)))
    throw fail(409, 'insufficient_balance', `You have ${usd(self?.available ?? '0')} of backing not yet behind a note or branch. Put new money behind this branch instead.`)
  planted.set(swarm.id, [...(planted.get(swarm.id) ?? []), { amount, branch, contributor: who as `0x${string}` }])
  if (target.starved) woken.add(`${swarm.id}:${branch}`)
  const after = grown(swarm).find((found) => found.id === branch) as Branch
  if (input.message) {
    const at = Date.now()
    const seq = (swarm.feed.at(-1)?.seq ?? 0) + 1
    swarm.feed.push({ at, detail: input.message, event: null, kind: 'steer', seq, text: `${Mention.at(called(who as string))} steered ${after.who} with ${usd(decimal(amount))}: ${input.message.split('\n')[0]?.slice(0, 200)}`, who: after.who })
    swarm.updatedAt = at
  } else push(swarm, 'funds', `${Mention.at(called(who as string))} put ${usd(decimal(amount))} behind ${after.role} (branch ${branch}), whose budget is now ${usd(after.budget ?? '0')}.`, null, Date.now())
  changed(key, ['branches', 'members'])
  return delay(after, 300)
}

export async function move(key: string, branch: number, input: { amount: string; to: number }, who: `0x${string}` | undefined): Promise<Branch[]> {
  const swarm = seed(await find(key))
  directing(swarm, key, who)
  const list = grown(swarm)
  const source = list.find((found) => found.id === branch && found.parent === null)
  const target = list.find((found) => found.id === input.to && found.parent === null)
  if (!source || !target || source.id === target.id) throw fail(404, 'not_found', 'Move money between two branches.')
  const amount = units(input.amount)
  const mine = units(source.funders.find((funder) => funder.address === who?.toLowerCase())?.amount ?? '0')
  if (amount > mine) throw fail(409, 'insufficient_balance', `You put less than ${usd(decimal(amount))} behind ${source.role}.`)
  if (source.left === null || amount > units(source.left)) throw fail(409, 'insufficient_balance', `${source.role} has ${usd(source.left ?? '0')} of its budget left.`)
  const contributor = (who as string).toLowerCase() as `0x${string}`
  planted.set(swarm.id, [...(planted.get(swarm.id) ?? []), { amount: -amount, branch, contributor }, { amount, branch: input.to, contributor }])
  const after = grown(swarm)
  changed(key, ['branches', 'members'])
  return delay([after.find((found) => found.id === branch) as Branch, after.find((found) => found.id === input.to) as Branch], 300)
}
