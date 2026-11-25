import * as Answer from '../shared/Answer.ts'
import * as Shelf from '../shared/Artifact.ts'
import type { Account, Artifact, Branch, Branches, Code, Chatter, Config, Contributed, Contribution, Currency, Detail, Entry, Form, Hall, Heard, Kind, Lent, Live as LiveEvent, Lobby, Me, Member, NodeRun, NodeSteer, NodeUpdates, NodeView, Note, Part, Posted, Profile, ProgressView, ProofsView, Proposed, Pulse, Reacted, Reaction, Replied, Replies, Room, Roster, Said, Shouted, Status, Steering, Suggested, Suggestion, Summary, Token, TreeView, Update, Way, Why } from '../shared/Api.ts'
import { decimal, maxNote, units } from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import { problems } from '../shared/ResearchBrief.ts'
import * as Progress from '../shared/Progress.ts'
import * as Setup from '../shared/Setup.ts'
import * as Site from '../shared/Site.ts'
import * as Tree from '../shared/Tree.ts'
import { usd } from './format.ts'
import { pace, scene, visitor } from './stage.ts'

type Line = readonly [Kind, string, (string | null)?, string?]

type Backing = { amount: string; contributor: `0x${string}`; note: string }

type Live = Omit<Detail, 'about' | 'answer' | 'reason' | 'updates' | 'why' | 'working'> & { updates: Update[]; chat: Said[]; cursor: number; flicker: readonly string[]; next: number; resting: boolean; owner: `0x${string}`; script: readonly Line[]; since: number | null; steered: Set<string>; steers: Backing[] }

const minute = 60_000

export const treeId = 'p-vs-np'

const treeAbout = 'This swarm asks whether every problem whose answer is quick to check is also quick to solve. If it is, much of cryptography breaks and huge search problems become easy; if not, that hardness is real and can be relied on. AI agents split the question into small mathematical steps, and Lean, a proof checker, decides which steps are actually proven, so no one has to take an agent at its word.'

const models: Setup.Price[] = [
  { cached: 0.19, id: '@cf/moonshotai/kimi-k2.7-code', input: 0.95, output: 4 },
  { cached: 0.14, id: '@cf/zai-org/glm-5.3', input: 1.12, output: 3.52 },
  { cached: 0.024, id: '@cf/zai-org/glm-5.3-flash', input: 0.12, output: 0.4 },
  { cached: 0.0048, id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017', input: 0.24, output: 0.96 },
  { cached: 0.25, id: 'vercel/anthropic/claude-fable-5.1', input: 10, output: 50 },
  { cached: 0.2, id: 'vercel/anthropic/claude-fable-5.2', input: 8, output: 40 },
  { cached: 0.01, id: 'vercel/anthropic/claude-haiku-5.5', input: 0.1, output: 0.5 },
  { cached: 0.2, id: 'vercel/anthropic/claude-opus-5.5', input: 4, output: 20 },
  { cached: 0.1, id: 'vercel/anthropic/claude-sonnet-5.5', input: 2, output: 10 },
  { cached: 0.075, id: 'vercel/google/gemini-3.8-flash', input: 0.75, output: 3.75 },
  { cached: 0.1, id: 'vercel/google/gemini-4-argon', input: 2, output: 10 },
  { cached: 0.23, id: 'vercel/moonshotai/kimi-k3', input: 2.3, output: 11.4 },
  { cached: 0.2, id: 'vercel/moonshotai/kimi-k3.1-pro', input: 1.7, output: 8.5 },
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
  owner?: `0x${string}`
  script?: readonly Line[]
  setup?: Setup.Setup | null
  since?: number
  spent: string
  status: Status
  steered?: readonly string[]
  steering?: Steering
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
    archivedAt: input.id === treeId || scene.has('open') ? null : at(600),
    form: input.id === treeId ? 'tree' : 'agent',
    balance: '0',
    chat: [],
    contributions,
    failure: null,
    contributors: 0,
    cover: null,
    createdAt: at(input.age),
    nickname: null,
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
    remaining: '0',
    owner: input.owner ?? visitor,
    setup: input.setup === undefined ? setup({ template: 'frontier-mix' }) : input.setup,
    script: input.script ?? [],
    since: input.status === 'running' ? at(input.since ?? 30) : null,
    spent: input.spent,
    status: input.status,
    steered: new Set(input.steered ?? []),
    steering: input.steering ?? (scene.has('helm') ? 'team' : 'open'),
    steers: [],
    title: input.title,
    updatedAt: feed.at(-1)?.at ?? at(input.age),
    updates: input.updates.map(([minutes, text, spent]): Update => ({ at: at(minutes), base: null, commits: [], done: /STATUS:\s*done/i.test(text), spent, text: Answer.parse(text, at(minutes)).text })),
  })
}

function settle(swarm: Live) {
  const given = swarm.contributions.reduce((sum, gift) => sum + units(gift.amount), 0n)
  swarm.balance = decimal(given)
  swarm.remaining = decimal(given > units(swarm.spent) ? given - units(swarm.spent) : 0n)
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
        share: given > 0n ? Number((weight * 10_000n) / given) / 10_000 : 0,
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
    code: { app: 'swarm-bench-coders', clone: 'https://gateway.tempo-dev.workers.dev/p/0x975937feafc6869a260c176854dda8764a78e122/swarm-bench-coders/git/bench-coders.git', name: 'bench-coders', owner: '0x975937feafc6869a260c176854dda8764a78e122' },
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
    updates: [
      [31, 'Generated 64 GiB of synthetic access logs and a harness that streams them through each parser.\nsonic-rs 1.55 GiB/s, simd-json 1.36 GiB/s, serde_json 0.41 GiB/s on 8 CPUs.', '0.180000'],
      [12, '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.** The 16-CPU machine tops out at 1.58 GiB/s because every parser is memory bound.\n\n| Parser | GiB/s on 8 CPUs | MACH per TiB |\n| --- | --- | --- |\n| sonic-rs | 1.55 | 0.21 |\n| simd-json | 1.36 | 0.24 |\n| serde_json | 0.41 | 0.79 |\n\n```rust\nlet value: sonic_rs::Value = sonic_rs::from_slice(&line)?;\n```\n\nNext: measure memory bandwidth with `mbw` before renting a bigger machine.', '0.051000'],
    ],
    gifts: [
      [4, '0.180000', 'pathusd', 38, 'Measure cost per GiB, not just throughput'],
      [3, '0.500000', 'usdce', 68, 'Measure cost per GiB, not just throughput'],
      [5, '0.250000', 'usdce', 30, null],
      [6, '0.100000', 'usdce', 12, 'Include serde_json as the baseline'],
      [2, '0.300000', 'usdce', 70, null],
      [0, '0.200000', 'usdce', 8, null],
    ],
    id: 'json-terabyte',
    problem: 'json-terabyte',
    lines: [['status', 'Started working with $0.62 to spend.'], ...parser],
    script: parser,
    since: 66,
    spent: '0.232100',
    status: 'running',
    owner: people[2],
    steered: ['Measure cost per GiB, not just throughput'],
    steering: 'team',
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
      [894, "I'm not starting anything this turn: $0.052 is left, and the room has no new messages or money.\n\nThe report above stands.", '0.029000'],
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
  build({
    age: 2880,
    gifts: [
      [0, '12.000000', 'usdce', 2800, null],
      [1, '8.000000', 'usdce', 2400, null],
      [2, '6.500000', 'pathusd', 1900, null],
      [3, '9.000000', 'usdce', 900, null],
      [4, '5.000000', 'ousd', 300, null],
    ],
    goal: 'Settle whether every problem whose answer can be checked quickly can also be solved quickly. Many agents work one tree of lemmas from both directions; Lean decides what is proven, and every dead end is kept with its reason.',
    id: 'p-vs-np',
    lines: [],
    setup: null,
    spent: '47.300000',
    status: 'running',
    title: 'Does P = NP?',
    updates: [],
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
  money: 'Out of money. Ride it to keep it going.',
  rest: 'The agent hit 3 errors in a row, so the swarm stopped to rest. New money restarts it.',
} as const

function why(swarm: Live): Why | null {
  if (swarm.status === 'funding') return 'unfunded'
  if (swarm.status !== 'paused') return swarm.status === 'running' && scene.has('retrying') ? 'stuck' : null
  return (['costly', 'rest'] as const).find((key) => scene.has(key)) ?? (swarm.resting ? 'idle' : 'money')
}

function reason(swarm: Live) {
  const picked = why(swarm)
  if (picked === 'money' && scene.has('refused')) return 'Its last step could not be paid for, though it has money. It tries again by itself.'
  return picked && picked !== 'unfunded' && picked !== 'stuck' ? reasons[picked] : null
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
    archivedAt: swarm.archivedAt,
    form: swarm.form,
    balance: swarm.balance,
    contributors: swarm.contributors,
    cover: Shelf.cover(shelves[swarm.id] ?? []),
    createdAt: swarm.createdAt,
    goal: swarm.goal,
    id: swarm.id,
    machines: swarm.machines,
    nickname: swarm.nickname,
    picture: swarm.picture ?? null,
    pool: swarm.pool,
    problem: swarm.problem,
    remaining: swarm.remaining,
    setup: swarm.setup,
    spent: swarm.spent,
    status: swarm.status,
    steering: swarm.steering,
    title: swarm.title,
    updatedAt: swarm.updatedAt,
    why: why(swarm) === 'stuck' || reason(swarm) ? why(swarm) : null,
  }
}

function detail(swarm: Live): Detail {
  return {
    ...summary(swarm),
    about: swarm.id === treeId ? treeAbout : null,
    code: swarm.code,
    contributions: swarm.contributions,
    failure: swarm.failure,
    feed: swarm.feed.slice(-200),
    hands: swarm.hands,
    notes: swarm.notes,
    reason: reason(swarm),
    why: why(swarm) === 'stuck' || reason(swarm) ? why(swarm) : null,
    updates: swarm.updates,
    working: swarm.since === null ? null : { since: swarm.since },
  }
}

export function config(): Promise<Config> {
  return steady({
    auth: '/v1/auth',
    chainId: 4217,
    credit: { owner: '0x975937feafc6869a260c176854dda8764a78e122', recipient: '0x40def0Cf3B5d28B6e9a7976BA10591e515AfECFE' },
    explorer: 'https://explore.tempo.xyz',
    gateway: 'https://gateway.tempo-dev.workers.dev',
    models,
    ownAi: true,
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
  const swarms = scene.has('empty') ? [] : scene.has('many') ? [...fixtures.map(summary), ...crowd()] : fixtures.map(summary)
  const gifts = new Map(fixtures.map((swarm) => [swarm.id, swarm.contributions]))
  const funders = Object.fromEntries(swarms.map((swarm) => [swarm.id, riding(gifts.get(swarm.id.split('~')[0]!) ?? [])]))
  const riders = new Set(swarms.flatMap((swarm) => (gifts.get(swarm.id.split('~')[0]!) ?? []).map((gift) => gift.contributor.toLowerCase()))).size
  const heads = Object.fromEntries(swarms.filter((swarm) => swarm.id.split('~')[0] === treeId && !swarm.archivedAt).map((swarm) => [swarm.id, Tree.headline(Object.values(derive()))]))
  return delay({ funders, heads, riders, swarms })
}

function riding(gifts: readonly Contribution[]): Tree.Funder[] {
  const sums = new Map<string, { amount: bigint; since: number }>()
  for (const gift of gifts) {
    const kept = sums.get(gift.contributor.toLowerCase())
    sums.set(gift.contributor.toLowerCase(), { amount: (kept?.amount ?? 0n) + units(gift.amount), since: Math.min(kept?.since ?? gift.at, gift.at) })
  }
  return [...sums]
    .sort((a, b) => (b[1].amount > a[1].amount ? 1 : b[1].amount < a[1].amount ? -1 : a[1].since - b[1].since))
    .slice(0, 3)
    .map(([address, kept]) => ({ amount: decimal(kept.amount), since: kept.since, who: { address: address as `0x${string}`, agent: null, handle: called(address) } }))
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

export async function feed(key: string, after: number, filter: { before?: number; limit?: number; who?: string } = {}) {
  const entries = (await find(key)).feed.filter(
    (entry) => entry.seq > after && (filter.before === undefined || entry.seq < filter.before) && (filter.who === undefined || (entry.who ?? 'agent') === filter.who),
  )
  const page = filter.before === undefined ? entries.slice(0, filter.limit ?? 200) : entries.slice(-(filter.limit ?? 200))
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

export function create(input: { goal: string; nickname?: string; problem?: string; steering?: Steering; title: string } & Partial<Setup.Choice>, who: `0x${string}` | undefined) {
  const steering = input.steering ?? (who ? 'team' : 'open')
  if (steering === 'team' && !who) return Promise.reject(fail(401, 'unauthorized', 'Sign in with Tempo ID to steer the swarm you start.'))
  const key = id(`${input.title}:${Date.now()}`)
  const swarm = build({ age: 0, goal: input.goal, id: key, problem: input.problem, owner: who ?? visitor, setup: setup({ ...input, template: input.template ?? Setup.fallback }), lines: [['status', 'Created. The first contribution starts its agent.']], spent: '0', status: 'funding', steering, title: input.title, updates: [] })
  swarm.nickname = input.nickname ?? null
  swarm.archivedAt = null
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
  await uncountable()
  if (scene.has('uncounted') && !dropped.has(hash)) {
    dropped.add(hash)
    throw fail(502, 'unavailable', 'Swarms could not reach Tempo to check the transfer.')
  }
  const paid = sent.get(hash)
  const token = paid?.token ?? 'usdce'
  const steers = swarm.steering !== 'team' || rostered(swarm).seats.some((found) => found.address === visitor.toLowerCase())
  const contribution: Contribution = { amount: decimal(paid?.amount ?? 250_000n), at: Date.now(), contributor: visitor, hash, note: (steers && input.note?.trim()) || null, token }
  swarm.contributions.push(contribution)
  if (contribution.note) swarm.steered.add(contribution.note)
  push(swarm, 'funds', `${visitor.slice(0, 6)}…${visitor.slice(-4)} sent ${contribution.amount} ${token === 'mach' ? 'MACH' : 'USDC.e'}${contribution.note ? ' with a note' : ''}`, contribution.note, Date.now())
  begin(swarm)
  settle(swarm)
  pulsed(key, swarm)
  changed(key, ['detail', 'members'])
  return delay({ contribution, swarm: summary(swarm) }, 500)
}

const kit = typeof location === 'undefined' ? '' : location.origin + Site.at('/kit/swarm.css')

const board = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${kit}">
<style>.rows{display:grid;gap:12px}.row{display:grid;grid-template-columns:minmax(90px,160px) 1fr 64px;align-items:center;gap:16px}.row .sw-num{text-align:right;font-size:12px}.at{font:12px var(--mono);letter-spacing:.02em}</style></head><body><main class="sw-page">
<h1>Coding model leaderboard</h1><p class="at sw-muted" id="at"></p>
<div class="sw-grid" style="margin-top:32px"><div class="sw-stat"><span>Models run</span><span>6</span></div><div class="sw-stat"><span>Tasks</span><span>1,560</span></div><div class="sw-stat"><span>Best solve rate</span><span>41%</span></div><div class="sw-stat"><span>Cheapest per solve</span><span>$0.0006</span></div></div>
<h3>SWE-bench Lite solve rate</h3><div class="rows" id="rows"></div>
<h3>Cost per solved task</h3><div class="rows" id="cost"></div>
</main><script>
const rows=[["GLM-5.3",124,300,0.002],["Kimi K2.7",118,300,0.0031],["DeepSeek V4.1",109,300,0.0006],["gpt-oss-120b",92,300,0.0011],["Qwen3-Coder",71,260,0.0042]]
const draw=(id,value,label)=>document.getElementById(id).innerHTML=rows.map(r=>'<div class="row"><span>'+r[0]+'</span><div class="sw-bar"><i style="width:'+value(r)+'%"></i></div><span class="sw-num sw-muted">'+label(r)+'</span></div>').join('')
draw('rows',r=>r[1]/r[2]*100/0.5,r=>Math.round(r[1]/r[2]*100)+'%')
draw('cost',r=>r[3]/0.0042*100,r=>'$'+r[3].toFixed(4))
const tick=()=>document.getElementById('at').textContent='Live · updated '+new Date().toLocaleTimeString()
tick();setInterval(tick,1000)
</script></body></html>`

const throughput = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${kit}">
<style>svg{display:block;width:100%;height:auto;margin-top:24px}text{font:11px var(--mono);fill:var(--muted)}.at{font:12px var(--mono);letter-spacing:.02em}</style>
</head><body><main class="sw-page"><p class="at sw-muted">Parser throughput, GiB/s · best</p><p class="sw-big">2.01</p><svg id="chart" viewBox="0 0 480 200"></svg></main>
<script>
const data=[["serde_json",0.41,0.44],["simd-json",1.36,1.62],["sonic-rs",1.55,2.01]]
const svg=document.getElementById('chart');let out=''
data.forEach((d,i)=>{const y=8+i*64;out+='<text x="0" y="'+(y+13)+'">'+d[0]+'</text>';[[d[1],'var(--edge)','8 CPU'],[d[2],'var(--high)','16 CPU']].forEach((b,j)=>{const w=b[0]/2.1*250;out+='<rect x="100" y="'+(y+j*22)+'" width="'+w+'" height="18" fill="'+b[1]+'"/><text x="'+(106+w)+'" y="'+(y+j*22+13)+'">'+b[0]+' · '+b[2]+'</text>'})})
svg.innerHTML=out
</script></body></html>`

const curve = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" font-family="ui-monospace,Menlo,monospace" font-size="11"><g stroke="#dddddd"><line x1="40" y1="230" x2="460" y2="230"/><line x1="40" y1="170" x2="460" y2="170"/><line x1="40" y1="110" x2="460" y2="110"/><line x1="40" y1="50" x2="460" y2="50"/></g><g fill="#161616"><rect x="60" y="70" width="56" height="160"/><rect x="142" y="160" width="56" height="70"/><rect x="224" y="180" width="56" height="50"/><rect x="306" y="195" width="56" height="35"/><rect x="388" y="206" width="56" height="24"/></g><g fill="#666666" text-anchor="middle"><text x="88" y="248">DeepSeek</text><text x="170" y="248">gpt-oss</text><text x="252" y="248">GLM</text><text x="334" y="248">Kimi</text><text x="416" y="248">Qwen</text><text x="88" y="62">1,667</text><text x="170" y="152">909</text><text x="252" y="172">500</text><text x="334" y="187">323</text><text x="416" y="198">238</text></g><text x="40" y="24" fill="#666666">Solved tasks per dollar</text></svg>`

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

const surface = JSON.stringify({
  nodes: [
    { id: 'status', kind: 'status', items: [
      'Eight of twelve models are scored on all 350 tasks, so $|S| = 2^e \\cdot 3^{(n-e)/2}$ and \\(\\nu = \\sum_j \\lfloor m_j/2 \\rfloor\\); bare |S| = 2^e·3^{(n−e)/2}, ν = Σ⌊m_j/2⌋ stays as written.',
      'Now running the frontier models through the batch API, two helpers on it.',
      'Next: the four 70B models, which need an H100 nobody has funded yet.',
    ] },
    { id: 'needs', kind: 'asks', title: 'Needs you', items: [
      { text: 'Fund the 70B runs on an H100', amount: '$12', why: '4 of the 12 models are untested because they do not fit on the A10G machines.' },
      { text: 'Know the SWE-bench harness?', action: 'chat', label: 'Help in the chat', why: 'Two tasks time out the same way for every model.' },
    ] },
    { id: 'stats', kind: 'stats', items: [{ label: 'best solve rate', value: '41%' }, { label: 'models run', value: '8 / 12' }, { label: 'tasks a run', value: '350' }, { label: 'best $ / task', value: '$0.0006' }] },
    { id: 'plan', kind: 'checklist', title: 'Plan', items: [
      { group: 'Harness', text: 'Same prompts, 30 tool calls, one attempt', state: 'done' },
      { group: 'Harness', text: 'Rust subset with hidden tests', state: 'done' },
      { group: 'Models', text: 'Small and mid open models', state: 'done' },
      { group: 'Models', text: '70B models on an H100', state: 'todo' },
      { group: 'Models', text: 'Frontier models on the batch API', state: 'doing' },
    ] },
    { id: 'solve', kind: 'bars', title: 'Solved, SWE-bench Lite', unit: '%', max: 100, items: [
      { label: 'DeepSeek V4.1 Flash', value: 41, tone: 'good' },
      { label: 'GLM-5.3', value: 38 },
      { label: 'gpt-oss-120b', value: 33 },
      { label: 'Qwen 3.5 32B', value: 27 },
    ] },
    { id: 'curve', kind: 'chart', title: 'Best solve rate over runs', unit: '%', goal: 50, goalLabel: 'target', points: [22, 27, 31, 33, 38, 41], tried: [[2, 26], [4, 35]] },
    { id: 'findings', kind: 'list', title: 'Findings', numbered: true, items: [
      { text: 'Feeding compile errors back to the model lifts the Rust subset from 18% to 29%.', state: 'kept' },
      { text: 'A second attempt on timeouts adds 2 points and doubles the cost.', state: 'dropped' },
    ] },
  ],
})

function shelf(items: readonly (readonly [string, string, string, string, Form, string, number, boolean?])[]): Artifact[] {
  return items.map(([slug, title, summary, kind, form, body, minutes, cover]) => ({
    cover: cover === true,
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
    ['solved-per-dollar', 'Solved tasks per dollar', 'Which model gets the most done for the money.', 'chart', 'image', curve, 18, true],
    ['results', 'SWE-bench Lite results', 'Every model on SWE-bench Lite, as a table.', 'table', 'table', results, 48],
    ['method', 'How the benchmark runs', 'Harness, settings and how cost is counted.', 'write-up', 'markdown', method, 120],
    ['wishlist', 'Wishlist', '2 open: an H100 for the 70B models.', 'wishlist', 'json', wishes, 10],
    ['surface', 'Surface', 'DeepSeek V4.1 Flash leads at 41%.', 'surface', 'json', surface, 3],
  ]),
  'json-terabyte': shelf([['throughput', 'Parser throughput', 'GiB/s by machine size.', 'dashboard', 'page', throughput, 6, true]]),
}

type Change = { additions: number; deletions: number; oldPath: string | null; patch: string; path: string; state: string | null }

const tree: Record<string, Record<string, string>> = {
  'bench-coders': {
    'README.md': "# Coding models, benchmarked by money\n\nWhich open model solves the most coding tasks per dollar, run through the same harness.\n\n**Best so far:** DeepSeek V4.1 Flash solves 41% of the tasks at $0.0006 a task.\n\n| model | solved | cost per solved task |\n|---|---:|---:|\n| DeepSeek V4.1 Flash | 41% | $0.0006 |\n| gpt-oss-120b | 33% | $0.0021 |\n| GLM-5.3 | 38% | $0.0044 |\n\n## Run it\n\n```sh\npython harness/run.py --model deepseek-v4.1-flash --tasks tasks/rust-subset\n```\n\nEvery branch of this repository is a direction the swarm tried; `main` keeps the ones that won.\n",
    'harness/run.py': 'import argparse\nimport json\n\nfrom harness.budget import Budget\n\n\ndef main():\n    parser = argparse.ArgumentParser()\n    parser.add_argument("--model", required=True)\n    parser.add_argument("--tasks", required=True)\n    args = parser.parse_args()\n    budget = Budget(steps=30)\n    print(json.dumps({"model": args.model, "tasks": args.tasks, "steps": budget.steps}))\n\n\nif __name__ == "__main__":\n    main()\n',
    'harness/budget.py': 'class Budget:\n    def __init__(self, steps):\n        self.steps = steps\n\n    def spend(self):\n        self.steps -= 1\n        return self.steps > 0\n',
    'results/solve-rate.csv': 'model,solved,cost_per_solved\ndeepseek-v4.1-flash,0.41,0.0006\ngpt-oss-120b,0.33,0.0021\nglm-5.3,0.38,0.0044\n',
    'tasks/rust-subset/README.md': '# Rust subset\n\n50 tasks with hidden tests, each a small crate.\n',
    'tasks/rust-subset/001/src/lib.rs': 'pub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n',
  },
  'mev-map': {
    'README.md': "# MEV in Tempo's first million blocks\n\nWhich strategies exist, how much they extract, and who pays for it.\n\n| strategy | bundles | value (USD) |\n|---|---:|---:|\n| DEX arbitrage | 29,349 | 8,105 |\n| Liquidations | 11,066 | 3,316 |\n| Sandwiches | 7,698 | 6,999 |\n\nSee `report.md` for the write-up and `classify/` for the classifier.\n",
    'classify/bundles.py': 'import json\nimport sys\n\nKINDS = ("arbitrage", "liquidation", "sandwich")\n\n\ndef classify(bundle):\n    swaps = [call for call in bundle["calls"] if call["kind"] == "swap"]\n    if len(swaps) >= 2 and swaps[0]["sender"] == swaps[-1]["sender"] and bundle["victim"]:\n        return "sandwich"\n    if any(call["kind"] == "liquidate" for call in bundle["calls"]):\n        return "liquidation"\n    return "arbitrage"\n\n\nif __name__ == "__main__":\n    for line in sys.stdin:\n        bundle = json.loads(line)\n        print(bundle["hash"], classify(bundle))\n',
    'classify/test_bundles.py': 'from bundles import classify\n\n\ndef test_sandwich():\n    calls = [{"kind": "swap", "sender": "a"}, {"kind": "swap", "sender": "b"}, {"kind": "swap", "sender": "a"}]\n    assert classify({"calls": calls, "victim": "b"}) == "sandwich"\n',
    'index/blocks.sql': 'create table bundles (\n  hash text primary key,\n  block integer not null,\n  kind text,\n  value_usd real\n);\n',
    'report.md': "# Final report\n\n1. 48,113 MEV bundles worth 18,420 USD in total.\n2. Arbitrage is 61% of bundles and mostly harmless: it keeps pegs tight.\n3. Sandwiches are 16% of bundles but 38% of value, from 4 searchers.\n4. Payment lanes left no room for sandwiches on transfers.\n",
  },
}

const pushes: Record<string, readonly (readonly [string, number, readonly string[]])[]> = {
  'bench-coders': [
    ['merge rust-subset: compile errors fed back to the model', 34, ['README.md', 'results/solve-rate.csv']],
    ['retry once on a timeout', 95, ['harness/run.py']],
    ['merge harness: tool calls and a 30-step budget per task', 240, ['harness/run.py', 'harness/budget.py', 'tasks/rust-subset/README.md', 'tasks/rust-subset/001/src/lib.rs']],
  ],
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

const commit = (sha: string, parents: string[], message: string) => ({ date: null, message, parents, sha })

const trunk = [
  commit('m6', ['m5', 'r2'], 'merge rust-subset: compile errors fed back to the model\n\nsolve rate: 0.41'),
  commit('r2', ['r1'], 'rust-subset: feed compiler output back'),
  commit('m5', ['m4'], 'retry once on a timeout\n\nsolve rate: 0.37'),
  commit('m4', ['m3', 's1'], 'merge swe-lite: retry once on a failing test\n\nsolve rate: 0.36'),
  commit('s1', ['m3'], 'swe-lite: retry failing tests'),
  commit('r1', ['m3'], 'rust-subset: 50 tasks with hidden tests'),
  commit('m3', ['m2', 'h1'], 'merge harness: tool calls and a 30-step budget per task\n\nsolve rate: 0.29'),
  commit('h1', ['m2'], 'harness: tool calls'),
  commit('m2', ['m1'], 'shortlist the 19 models that call tools'),
  commit('m1', [], 'baseline: one prompt, no tools\n\nsolve rate: 0.21'),
]

const forks = {
  context: [commit('c1', ['m3'], 'context: 128k context doubled timeouts, no gain'), commit('m3', ['m2', 'h1'], '')],
  harness: [commit('h1', ['m2'], ''), commit('m2', ['m1'], '')],
  'latency-probe': [commit('l1', ['m6'], 'latency-probe: give Qwen3-Coder its own machine'), commit('m6', ['m5', 'r2'], '')],
  'rust-subset': [commit('r2', ['r1'], ''), commit('r1', ['m3'], ''), commit('m3', ['m2', 'h1'], '')],
  'swe-lite': [commit('s1', ['m3'], ''), commit('m3', ['m2', 'h1'], '')],
  temperature: [commit('t1', ['m4'], 'temperature: 0 instead of 0.2 lost 2 points'), commit('m4', ['m3', 's1'], '')],
}

export async function progress(key: string) {
  await find(key)
  const names = ['main', ...Object.keys(forks)]
  const tree = Progress.fromGit({
    branches: names.map((name) => ({ name, sha: name === 'main' ? 'm6' : (forks[name as keyof typeof forks][0]?.sha ?? null) })),
    hint: { better: 'higher', explores: new Map(), goal: 0.6, metric: 'solve rate', title: 'Share of benchmark tasks solved' },
    live: ['latency-probe'],
    logs: forks,
    main: trunk,
    trunk: 'main',
  })
  return steady({ progress: key.split('~')[0] === 'bench-coders' ? (tree ?? null) : null })
}

export async function updates(key: string) {
  const swarm = await find(key)
  return steady({ updates: swarm.updates })
}

export function artifacts(key: string) {
  return find(key).then(() => delay({ artifacts: shelves[key] ?? [] }))
}

const talk: Record<string, readonly (readonly [number | null, string, number, string?])[]> = {
  'p-vs-np': [
    [3, 'Switching lemma run 2 looks close. Has anyone checked how it counts restrictions?', 95],
    [5, 'Both oracle lemmas are proven, so relativizing proofs are out. Natural proofs next?', 70],
    [1, 'Prove Cook–Levin before anything else in Foundations: half the tree needs it.', 41],
    [2, 'Razborov is moving again, the AND gate bound is nearly there.', 12],
  ],
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
    [null, 'Update: **Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.** The 16-CPU machine tops out at 1.58 GiB/s because every parser is memory bound.', 12],
    [5, 'Curious whether 16 CPUs buys anything. The agent thinks it is memory bound.', 11],
    [2, '@swarm Measure memory bandwidth on the 16-CPU machine before scaling up', 9, '1.000000'],
    [3, 'Two asks before anyone scales up:\n- pin `sonic-rs 0.5.1` so the numbers are reproducible\n- report **MACH per TiB** next to GiB/s\n\n```sh\nmbw -n 10 4096\n```', 6],
  ],
  'mev-map': [
    [null, "Update: Final report. Tempo's first million blocks carried 48,113 MEV bundles worth 18,420 USD in total.", 1100],
    [5, 'Sandwiches at 38% of value from 4 searchers is the headline.', 1095],
    [1, '@5 and none of them on transfers. Payment lanes did their job.', 1092],
    [null, 'The agent is resting after its report. A note or new money wakes it.', 1090],
    [null, "Update: I'm not starting anything this turn. $0.11 is left, and the room has no new messages or money.", 900],
    [null, "Update: I'm not starting anything this turn, and I made no tool calls, so this reply is the only cost.", 898],
    [null, "Update: I'm not starting anything this turn: $0.08 is left, and the room has no new messages or money.", 896],
    [null, "Update: I'm not starting anything this turn and made no tool calls, so this reply is the only cost.", 894],
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
  if (!who) return Promise.reject(fail(401, 'unauthorized', 'Sign in with Tempo ID to read your account.'))
  return delay({ address: who, handle: called(who), name: names.get(who.toLowerCase()) ?? null })
}

export async function rider(who: string): Promise<Profile> {
  const wanted = who.replace(/^@/, '').toLowerCase()
  const address = (/^0x[0-9a-f]{40}$/.test(wanted) ? wanted : [...names].find(([, name]) => name === wanted)?.[0]) as `0x${string}` | undefined
  if (!address) throw fail(404, 'not_found', 'No rider has this name.')
  const handle = called(address)
  const grown = await treeView(treeId, { depth: 64 })
  const items = grown.nodes
    .filter((node) => node.form !== 'goal' && node.form !== 'triage' && (node.by.handle === handle || node.funders.some((funder) => funder.who.handle === handle)))
    .map((node) => ({ created: node.by.handle === handle && !node.by.agent, node: node.id, ridden: node.funders.find((funder) => funder.who.handle === handle)?.amount ?? '0.000000', status: node.status, swarm: treeId, title: node.title }))
    .sort((a, b) => Number(units(b.ridden) - units(a.ridden)))
  const shown = fixtures.map(summary).sort((a, b) => Number(b.id === treeId) - Number(a.id === treeId)).slice(0, 3)
  const swarms = shown.map((one, index) => ({ balance: one.balance, form: one.form, id: one.id, nickname: one.nickname, ridden: decimal(BigInt(12 - index * 4) * 1_000_000n), riders: one.contributors, since: one.createdAt, started: index === 1, title: one.title }))
  const ridden = decimal(swarms.reduce((sum, one) => sum + units(one.ridden), 0n))
  return delay({ items, rider: { address, handle, name: names.get(address) ?? null }, ridden, swarms })
}

export function rename(who: `0x${string}` | undefined, name: string | null): Promise<Account> {
  if (!who) return Promise.reject(fail(401, 'unauthorized', 'Sign in with Tempo ID to set your username.'))
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

const items: Record<string, readonly (readonly [message: number, title: string])[]> = { 'p-vs-np': [[3, 'Cook–Levin: SAT is NP-complete']] }

const threads: Record<string, readonly (readonly [parent: number, person: number | null, line: string, minutes: number])[]> = {
  'p-vs-np': [
    [1, 4, 'Yes: three of the five cases go through. Depth two is the hard one.', 90],
    [1, 2, 'The count matches the textbook proof too.', 84],
    [1, 3, 'Thanks, putting $2 more on it.', 80],
    [3, null, '@kestrel rode it with $5', 40],
    [3, null, 'Run 1 started on GLM 5.3', 38],
    [3, null, 'Encoded the verifier as a 3-CNF; two of the four clause families check in Lean.', 18],
  ],
}

const seededReactions: Record<string, readonly (readonly [message: number, emoji: string, people: readonly number[]])[]> = {
  'p-vs-np': [
    [1, '👀', [2, 4]],
    [2, '🎉', [1, 3, 4, 5]],
    [2, '💯', [6]],
    [3, '🚀', [2, 5]],
  ],
}

function seed(swarm: Live) {
  if (swarm.chat.length || !talk[swarm.id]) return swarm
  const settled = () => {
    for (const [index, title] of items[swarm.id] ?? []) {
      const item = swarm.chat[index - 1]
      const node = grove.find((each) => each.title === title)
      if (item && node) item.node = node.id
    }
    for (const [parent, person, line, minutes] of threads[swarm.id] ?? []) swarm.chat.push({ artifact: null, at: at(minutes), author: person === null ? null : (people[person] ?? visitor), id: swarm.chat.length + 1, mentions: [], parent, steer: null, text: spoken(line) })
    const known = reactionsOf(swarm)
    for (const [message, emoji, who] of seededReactions[swarm.id] ?? []) known.set(message, [...(known.get(message) ?? []), { emoji, who: who.map((index) => people[index] ?? visitor) }])
  }
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
  settled()
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

const reactions = new Map<string, Map<number, Reaction[]>>()

function reactionsOf(swarm: Live) {
  const known = reactions.get(swarm.id) ?? new Map<number, Reaction[]>()
  reactions.set(swarm.id, known)
  return known
}

function replied(swarm: Live, id: number): Replies | undefined {
  const list = swarm.chat.filter((item) => item.parent === id)
  const last = list.at(-1)
  if (!last) return undefined
  const who: (`0x${string}` | null)[] = []
  for (const item of [...list].reverse()) if (!who.includes(item.author) && who.length < 3) who.push(item.author)
  return { at: last.at, count: list.length, who }
}

function decorated(swarm: Live, item: Said): Said {
  const shown = reactionsOf(swarm).get(item.id)
  const thread = replied(swarm, item.id)
  return { ...item, ...(shown?.length ? { reactions: shown } : {}), ...(thread ? { replies: thread } : {}) }
}

function rooted(swarm: Live, id: number) {
  const found = swarm.chat.find((item) => item.id === id)
  return found ? (found.parent ?? found.id) : undefined
}

function post(key: string, swarm: Live, message: Said) {
  swarm.chat.push(message)
  tell(key, { message, type: 'said' })
  const parent = message.parent
  const thread = parent === undefined ? undefined : replied(swarm, parent)
  if (parent !== undefined && thread) tell(key, { id: parent, replies: thread, type: 'replies' })
  return message
}

export async function room(key: string, query: { after?: number; before?: number }, who: `0x${string}` | undefined): Promise<Room> {
  const swarm = seed(await find(key))
  const top = swarm.chat.filter((item) => item.parent === undefined)
  const messages = (query.before ? top.filter((item) => item.id < (query.before ?? 0)).slice(-100) : query.after ? top.filter((item) => item.id > (query.after ?? 0)) : top.slice(-100)).map((item) => decorated(swarm, item))
  return delay({ me: me(swarm, who), members: members(swarm), messages, next: messages.at(-1)?.id ?? query.after ?? 0 })
}

export async function replies(key: string, message: number, after: number, who: `0x${string}` | undefined): Promise<Replied> {
  const swarm = seed(await find(key))
  const top = rooted(swarm, message)
  const parent = swarm.chat.find((item) => item.id === top)
  if (top === undefined || !parent) throw fail(404, 'not_found', 'No message in this room has that id.')
  const list = swarm.chat.filter((item) => item.parent === top && item.id > after).map((item) => decorated(swarm, item))
  return delay({ me: me(swarm, who), members: members(swarm), next: list.at(-1)?.id ?? after, parent: decorated(swarm, parent), replies: list }, 200)
}

export async function react(key: string, message: number, input: { emoji: string; on: boolean }, who: `0x${string}` | undefined): Promise<Reacted> {
  const swarm = seed(await find(key))
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to react in a room.')
  if (!me(swarm, who)?.member) throw fail(403, 'not_member', 'Ride this swarm first: money or a lent machine lets you post in its room.')
  if (!swarm.chat.some((item) => item.id === message)) throw fail(404, 'not_found', 'No message in this room has that id.')
  const known = reactionsOf(swarm)
  const mine = who.toLowerCase() as `0x${string}`
  const list = (known.get(message) ?? []).map((item) => ({ emoji: item.emoji, who: item.who.filter((address) => item.emoji !== input.emoji || address !== mine) }))
  const found = list.find((item) => item.emoji === input.emoji)
  if (input.on && found) found.who.push(mine)
  else if (input.on) list.push({ emoji: input.emoji, who: [mine] })
  const kept = list.filter((item) => item.who.length)
  known.set(message, kept)
  tell(key, { id: message, reactions: kept, type: 'reacted' })
  return delay({ id: message, reactions: kept }, 150)
}

export async function say(key: string, input: { artifact?: boolean; parent?: number; steer?: string; text: string }, who: `0x${string}` | undefined): Promise<Posted> {
  const swarm = seed(await find(key))
  if (scene.has('stall')) return new Promise<Posted>(() => {})
  if (scene.has('mute')) return new Promise<Posted>((_, reject) => setTimeout(() => reject(fail(503, 'unavailable', 'The room is not answering right now.')), 600))
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to post in a room.')
  if (!names.has(who.toLowerCase())) throw fail(403, 'username_required', 'Pick a username first.')
  const self = me(swarm, who) as Me
  const seated = swarm.steering === 'team' ? rostered(swarm).seats.find((found) => found.address === who.toLowerCase()) : undefined
  if (!self?.member && !seated) throw fail(403, 'not_member', 'Ride this swarm first: money or a lent machine lets you post in its room.')
  const text = input.text.trim()
  if (input.parent !== undefined) {
    if (Mention.steers(text)) throw fail(400, 'invalid_request', '@swarm goes in the room, not in a thread: post it as its own message.')
    const parent = rooted(swarm, input.parent)
    if (parent === undefined) throw fail(404, 'not_found', 'No message in this room has that id to reply to.')
    const reply = post(key, swarm, { artifact: null, at: Date.now(), author: who, id: (swarm.chat.at(-1)?.id ?? 0) + 1, mentions: mentions(swarm, text), parent, steer: null, text })
    return delay({ me: self, message: reply }, 250)
  }
  if (swarm.steering === 'team' && Mention.steers(text) && !seated) throw fail(403, 'not_member', "Only this swarm's team steers it. Its admins add who may: ask one of them in the room.")
  let steer: Said['steer'] = null
  if (Mention.steers(text)) {
    const note = Mention.idea(text)
    if (note.length < 3 || note.length > maxNote) throw fail(400, 'invalid_request', 'Say what the swarm should do after @swarm, in at most 280 characters.')
    if (!input.steer) throw fail(400, 'invalid_request', '@swarm steers the swarm with money: say how much of your backing goes behind it.')
    if (seated ? units(input.steer) > units(seated.left) : units(input.steer) > units(self.available)) throw fail(409, 'insufficient_balance', `You have ${usd(self.available)} of backing not yet behind a note. Put new money behind this idea instead.`)
    swarm.steers.push({ amount: decimal(units(input.steer)), contributor: who, note })
    swarm.steered.add(note)
    settle(swarm)
    steer = steering(swarm, decimal(units(input.steer)), note)
    if (swarm.status === 'running') push(swarm, 'steer', `Steered the agent toward "${note}"`, null, Date.now())
    changed(key, ['detail', 'members'])
  }
  const message = post(key, swarm, { artifact: null, at: Date.now(), author: who, id: (swarm.chat.at(-1)?.id ?? 0) + 1, mentions: mentions(swarm, text), steer, text })
  return delay({ me: me(swarm, who) as Me, message }, 250)
}

export async function btw(key: string, input: { branch?: number; question: string; thread: readonly { answer: string; question: string }[] }, who: `0x${string}` | undefined) {
  const swarm = seed(await find(key))
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to ask the swarm side questions.')
  if (!names.has(who.toLowerCase())) throw fail(403, 'username_required', 'Pick a username first.')
  const asker = me(swarm, who)
  if (!(asker?.member && units(asker.backed) >= 10_000n) && !(swarm.steering === 'team' && rostered(swarm).seats.some((found) => found.address === who.toLowerCase())))
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
  if (key === treeId) return woods(listener)
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
  const listed = () => (scene.has('empty') ? [] : fixtures.map((swarm) => summary(swarm)).filter((swarm) => Number(swarm.balance) > 0))
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

const team0 = '0x00000000000000000000000000000000000000aa'

function rostered(swarm: Live): Roster {
  const found = rosters.get(swarm.id)
  if (found) return { ...found, steering: swarm.steering }
  const owner = swarm.owner.toLowerCase() as `0x${string}`
  const seats = swarm.steering === 'team' ? [{ address: owner, handle: called(owner), left: swarm.balance, limit: null, role: 'admin' as const, spent: '0.000000' }] : []
  return { admins: [owner], memberBudget: null, seats, steering: swarm.steering, team: null }
}

export async function edit(key: string, who: `0x${string}` | undefined, edits: { nickname?: string | null; picture?: Summary['picture']; title?: string }): Promise<Summary> {
  const swarm = seed(await find(key))
  if (!who) throw fail(401, 'unauthorized', "Sign in with Tempo ID as one of the swarm's admins.")
  if (!rostered(swarm).admins.includes(who.toLowerCase() as `0x${string}`)) throw fail(403, 'access_denied', "Only the swarm's admins and the operator name it.")
  if (edits.nickname && fixtures.some((other) => other.id !== swarm.id && other.nickname === edits.nickname)) throw fail(409, 'conflict', 'Another swarm is called ' + edits.nickname + '.')
  if (edits.title !== undefined) swarm.title = edits.title.trim()
  if (edits.nickname !== undefined) swarm.nickname = edits.nickname
  if (edits.picture !== undefined) swarm.picture = edits.picture
  return delay(summary(swarm))
}

export async function paint(key: string, who: `0x${string}` | undefined, image: Blob): Promise<Summary> {
  return edit(key, who, { picture: { url: URL.createObjectURL(image) } })
}

export async function team(key: string): Promise<Roster> {
  const swarm = seed(await find(key))
  return delay(rostered(swarm))
}

function governed(swarm: Live, who: `0x${string}` | undefined) {
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to manage who steers a swarm.')
  if (!rostered(swarm).admins.includes(who.toLowerCase() as `0x${string}`)) throw fail(403, 'access_denied', "Only this swarm's admins choose who steers it.")
}

function regrouped(swarm: Live, next: Roster) {
  rosters.set(swarm.id, next)
  tell(swarm.id, { roster: next, type: 'roster' })
  return delay(next, 250)
}

export async function govern(key: string, input: { memberBudget?: number | null; steering?: Steering }, who: `0x${string}` | undefined): Promise<Roster> {
  const swarm = seed(await find(key))
  governed(swarm, who)
  if (input.steering) swarm.steering = input.steering
  pulsed(key, swarm)
  const current = rostered(swarm)
  if (input.memberBudget === undefined) {
    tell(key, { roster: current, type: 'roster' })
    return delay(current, 250)
  }
  return regrouped(swarm, { ...current, memberBudget: input.memberBudget === null ? null : decimal(units(String(input.memberBudget))), team: current.team ?? team0 })
}

export async function seat(key: string, input: { budget?: number | null; member: string; role: 'admin' | 'member' }, who: `0x${string}` | undefined): Promise<Roster> {
  const swarm = seed(await find(key))
  governed(swarm, who)
  const asked = input.member.trim().replace(/^@/, '').toLowerCase()
  const address = (/^0x[0-9a-f]{40}$/.test(asked) ? asked : [...names].find(([, name]) => name === asked)?.[0]) as `0x${string}` | undefined
  if (!address) throw fail(404, 'not_found', `No one is called @${asked}.`)
  const current = rostered(swarm)
  const limit = input.budget === undefined || input.budget === null ? current.memberBudget : decimal(units(String(input.budget)))
  const seats = [...current.seats.filter((found) => found.address !== address), { address, handle: called(address), left: limit ?? swarm.balance, limit, role: input.role, spent: '0.000000' }]
  return regrouped(swarm, { ...current, admins: seats.filter((found) => found.role === 'admin').map((found) => found.address), seats, team: current.team ?? team0 })
}

export async function unseat(key: string, member: string, who: `0x${string}` | undefined): Promise<Roster> {
  const swarm = seed(await find(key))
  const current = rosters.get(key)
  if (!who) throw fail(401, 'unauthorized', "Sign in with Tempo ID to leave or manage a swarm's team.")
  if (!current) throw member.toLowerCase() === swarm.owner.toLowerCase() ? fail(409, 'conflict', "The swarm's last admin stays: add another admin first.") : fail(404, 'not_found', "No one else is on this swarm's team.")
  const seats = current.seats.filter((found) => found.address !== member.toLowerCase())
  return regrouped(swarm, { ...current, admins: seats.filter((found) => found.role === 'admin').map((found) => found.address), seats })
}


type Sprout = readonly [number, number | null, string, string, Branch['state'], string | null, string | null]

const sprouts: readonly Sprout[] = [
  [1, null, 'rust-subset', 'Write 50 small Rust tasks with hidden tests (parsing, lifetimes, async) and run every shortlisted model against them.', 'running', null, '0.640000'],
  [2, 1, 'parser-tasks', 'Write the 18 parsing tasks and their hidden tests.', 'completed', null, '0.110000'],
  [3, null, 'swe-bench-lite', 'Run SWE-bench Lite on four machines, 75 tasks per model, and record the solve rate and the cost of each solved task.', 'running', '2.000000', '1.420000'],
  [4, 3, 'machine-2', 'Run tasks 76 to 150 on the second machine.', 'running', '0.600000', '0.310000'],
  [5, null, 'latency-probe', 'Measure time to first token and tokens per second for each model through the gateway.', 'failed', '0.500000', '0.500000'],
  [6, null, 'license-check', 'Read each shortlisted model\'s license and say which ones a company may use commercially.', 'completed', '0.300000', '0.120000'],
  [7, null, 'autoresearch branch: attention4 (full-layer verify attention)', 'Tune verify attention on full layers and keep only changes that pass the judge.', 'completed', '9.000000', '3.629664'],
  [8, null, 'autoresearch branch: moe5 (routed experts + MoE glue)', 'Fuse the MoE glue around the routed experts.', 'completed', '15.000000', '2.757636'],
  [9, null, 'autoresearch branch: moe2 (NVFP4 grouped GEMM)', 'Replace Marlin with an NVFP4 grouped GEMM.', 'failed', '9.000000', '0.324579'],
]

const planted = new Map<string, { amount: bigint; branch: number; contributor: `0x${string}` }[]>()

const woken = new Set<string>()

const halted = new Set<string>()

const errors: Record<number, string> = {
  9: 'subagent 9 could not resume after a runtime restart: invalid task request\n\nTool calls observed during the interrupted turn',
}

const found: Record<number, string> = {
  7: JSON.stringify({ best_commit_dir: '/w/attention4_best', best_speedup: 1.3697, blockers: 'No correctness or infrastructure blockers. Further gains likely need a cache-gather redesign.', files_changed: ['attn.py'], summary: 'Best commit 4be1c0d. Gathered both KV heads per program in verify attention and split the softmax across warps, 1.37x over SGLang on the six loads. Configuration sweeps past that had diminishing returns.' }, null, 2),
  8: JSON.stringify({ best_commit_dir: '/w/moe5_best', best_speedup: 1.3376, blockers: 'No active blockers. Small gains are close to the timing noise.', files_changed: ['moe.py'], summary: 'Best commit cfae32e. Fused pre-expert RMSNorm and local-id mapping with Marlin-compatible alignment in one Triton launch. Both best and final runs passed 13/13 judge tests.' }, null, 2),
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
      error: errors[id] ?? null,
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
  if (!who) throw fail(401, 'unauthorized', "Sign in with Tempo ID to direct a swarm's money.")
  if (!names.has(who.toLowerCase())) throw fail(403, 'username_required', 'Pick a username first.')
  const seated = swarm.steering === 'team' ? rostered(swarm).seats.find((found) => found.address === who.toLowerCase()) : undefined
  if (swarm.steering === 'team' && !seated) throw fail(403, 'not_member', "Only this swarm's team directs its money. Its admins add who may: ask one of them in the room.")
  return seated
}

export async function stop(key: string, branch: number, who: `0x${string}` | undefined): Promise<Branch> {
  const swarm = seed(await find(key))
  directing(swarm, key, who)
  const target = grown(swarm).find((found) => found.id === branch && found.parent === null)
  if (!target) throw fail(404, 'not_found', `This swarm has no branch ${branch}.`)
  const funded = target.funders.reduce((sum, funder) => sum + units(funder.amount), 0n)
  const mine = units(target.funders.find((funder) => funder.address === who?.toLowerCase())?.amount ?? '0')
  if (!(funded > 0n && mine * 2n > funded) && !rostered(swarm).admins.includes(who?.toLowerCase() as `0x${string}`))
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


const handles = ['ada', 'mira', 'kofi', 'lena', 'tomas', 'yuki', 'devi', 'sam', 'noor', 'ivan', 'zara', 'ben', 'olu', 'kai', 'rhea', 'tess', 'jun', 'pia', 'cal', 'eda', 'max', 'uma', 'leo'] as const

function who(index: number): Tree.Who {
  const address = index < people.length ? people[index] : (`0x${hex(`rider:${index % handles.length}`, 40)}` as const)
  return { address: address as `0x${string}`, agent: null, handle: handles[index % handles.length] ?? 'rider' }
}

const sown: Tree.Who = { address: null, agent: 'seed', handle: 'seed' }

function worker(parent: string): Tree.Who {
  return { address: null, agent: `agent:n:${parent}`, handle: 'worker' }
}

function nid(key: string) {
  return key === 'root' || key === 'triage' ? key : (id(`pnp:${key}`) + id(`n:${key}`)).slice(0, 10)
}

type Twig = {
  by: Tree.Who
  createdAt: number
  deltas: Tree.Delta[]
  end: Tree.End | null
  form: Tree.Form
  funders: Tree.Funder[]
  id: string
  inherited: bigint
  left: bigint
  needs: string[]
  parent: string | null
  pledged: bigint
  proof: Tree.Check | null
  run: Tree.Run | null
  runs: NodeRun[]
  spent: bigint
  statement: string | null
  status: Tree.Status
  steers: NodeSteer[]
  suggestions: Suggestion[]
  title: string
  updatedAt: number
  words: string
}

type Sprig = readonly [key: string, parent: string | null, form: Tree.Form, title: string, status: Tree.Status, spent: number, left: number, extra?: { by?: number | 'agent'; doing?: string; end?: [Tree.End['kind'], string]; needs?: readonly string[]; riders?: number; statement?: string; summaries?: readonly string[] }]

const sprigs: readonly Sprig[] = [
  ['root', null, 'goal', 'Does P = NP?', 'in flight', 0.42, 31.2, { by: 0, riders: 23 }],
  ['triage', 'root', 'triage', 'Triage', 'in flight', 0.31, 1.4, { by: 'agent', summaries: ['Approved 3 proposals, merged 1 duplicate, granted $4 to the switching lemma'] }],
  ['found', 'root', 'program', 'Foundations: machines, P, NP and reductions', 'in flight', 1.2, 6.5, { by: 0, riders: 6 }],
  ['tm', 'found', 'lemma', 'A Turing machine model with time bounds', 'proven', 3.1, 0, { by: 'agent', statement: 'theorem tm_time_bounded (M : TM) (n : ℕ) : M.steps n ≤ M.bound n', summaries: ['Wrote the machine model on Mathlib.Computability.TuringMachine', 'Proved; sent to the verifier'] }],
  ['pclosed', 'found', 'lemma', 'P is closed under composition', 'proven', 2.4, 0, { by: 'agent', needs: ['tm'], statement: 'theorem p_comp {f g : ℕ → ℕ} (hf : InP f) (hg : InP g) : InP (f ∘ g)', summaries: ['Proved with a polynomial bound on the composed running time'] }],
  ['npver', 'found', 'lemma', 'NP has polynomial-time verifiers', 'proven', 2.9, 0, { by: 2, needs: ['tm'], statement: 'theorem np_iff_verifier (L : Lang) : L ∈ NP ↔ ∃ V, InP V ∧ PolyWitness V L', summaries: ['Split the equivalence into two directions', 'Proved both directions; sent to the verifier'] }],
  ['red', 'found', 'lemma', 'Polynomial-time many-one reductions compose', 'in flight', 1.7, 3.3, { by: 'agent', doing: 'Composing the two polynomial bounds', needs: ['pclosed'], riders: 3, statement: 'theorem reduce_trans {A B C : Lang} : A ≤ₚ B → B ≤ₚ C → A ≤ₚ C', summaries: ['Stated the reduction and the bound; 3 of 5 steps compile'] }],
  ['cook', 'found', 'lemma', 'Cook–Levin: SAT is NP-complete', 'funded', 0, 5, { by: 1, needs: ['npver', 'red'], riders: 4, statement: 'theorem cook_levin : NPComplete SAT' }],
  ['lower', 'root', 'program', 'Lower bounds toward P ≠ NP', 'in flight', 0.8, 4.1, { by: 0, riders: 9 }],
  ['mono', 'lower', 'approach', 'Monotone circuit lower bounds', 'in flight', 0.6, 2.2, { by: 3, riders: 8 }],
  ['sun', 'mono', 'lemma', 'Sunflower lemma (Erdős–Rado)', 'proven', 4.2, 0, { by: 'agent', riders: 6, statement: 'theorem sunflower (F : Finset (Finset α)) (hk : ∀ s ∈ F, s.card = k) (h : F.card > k ! * (p - 1) ^ k) : HasSunflower F p', summaries: ['Proved on paper by induction on k', 'Formalized the induction; sent to the verifier'] }],
  ['razb', 'mono', 'lemma', "Razborov's approximation method for CLIQUE", 'in flight', 5.6, 2.4, { by: 'agent', doing: 'Bounding the AND gate error for k = 5', needs: ['sun'], riders: 12, statement: 'theorem approx_error (C : MonoCircuit) : ApproxError C ≤ C.size * errorPerGate', summaries: ['Set up approximators as unions of cliques', 'Bounded the error per OR gate; the AND gate case is open', 'Proved the AND gate bound for k ≤ 4'] }],
  ['clique', 'mono', 'lemma', 'Monotone circuits for CLIQUE need exponential size', 'proposed', 0, 0, { by: 4, needs: ['razb'], statement: 'theorem clique_mono_lower : ∃ ε > 0, ∀ n, monoSize (CLIQUE n) ≥ 2 ^ (n ^ ε)' }],
  ['ac0', 'lower', 'approach', 'Parity is not in AC0', 'in flight', 0.4, 3.1, { by: 5, riders: 5 }],
  ['switch', 'ac0', 'lemma', "Håstad's switching lemma", 'in flight', 3.3, 4.7, { by: 'agent', doing: 'Counting restrictions that leave depth above t', riders: 9, statement: 'theorem switching (f : DNF n w) (p : ℝ) : Pr[¬ DepthAtMost (restrict f ρ) t] ≤ (5 * p * w) ^ t', summaries: ['Chose the canonical decision tree argument', 'Encoded restrictions; the counting step compiles'] }],
  ['depth', 'ac0', 'lemma', 'Depth reduction by random restrictions', 'proposed', 0, 0.2, { by: 'agent', needs: ['switch'], statement: 'theorem depth_reduce (C : AC0 d s) : ∃ ρ, Depth (C.restrict ρ) ≤ d - 1' }],
  ['gct', 'lower', 'idea', 'Separate permanent and determinant by orbit closures', 'dead end', 2.1, 0, { by: 6, end: ['exhausted', 'Three runs found no step a checked lemma could state; occurrence obstructions are known not to exist for this pair.'] }],
  ['barrier', 'root', 'program', 'Barriers: why whole lines of attack fail', 'in flight', 0.5, 2.6, { by: 0 }],
  ['bgs', 'barrier', 'lemma', 'Baker–Gill–Solovay: an oracle A with P^A = NP^A', 'proven', 2.2, 0, { by: 'agent', statement: 'theorem bgs_eq : ∃ A, P[A] = NP[A]', summaries: ['Took A to be a PSPACE-complete set', 'Proved; sent to the verifier'] }],
  ['bgs2', 'barrier', 'lemma', 'An oracle B with P^B ≠ NP^B', 'proven', 3.4, 0, { by: 'agent', statement: 'theorem bgs_ne : ∃ B, P[B] ≠ NP[B]', summaries: ['Diagonalized against every polynomial-time oracle machine', 'Proved; sent to the verifier'] }],
  ['natural', 'barrier', 'lemma', 'Natural proofs barrier (Razborov–Rudich)', 'proposed', 0, 0, { by: 7, statement: 'theorem natural_barrier (h : PRFExist) : ¬ ∃ P, NaturalAgainst P PPoly' }],
  ['diag', 'barrier', 'idea', 'Diagonalization alone separates P and NP', 'dead end', 0.9, 0, { by: 1, end: ['barrier', 'Relativizes: the oracle B above has P^B ≠ NP^B and Baker–Gill–Solovay gives an oracle with equality, so no relativizing argument settles it.'] }],
  ['upper', 'root', 'program', 'Upper bounds toward P = NP', 'in flight', 0.4, 3.3, { by: 0 }],
  ['twosat', 'upper', 'lemma', '2-SAT is in P', 'proven', 1.9, 0, { by: 'agent', statement: 'theorem two_sat_in_p : TwoSAT ∈ P', summaries: ['Proved via strongly connected components of the implication graph'] }],
  ['horn', 'upper', 'lemma', 'Horn-SAT is in P', 'proven', 1.6, 0, { by: 2, statement: 'theorem horn_sat_in_p : HornSAT ∈ P', summaries: ['Proved by unit propagation'] }],
  ['schaefer', 'upper', 'lemma', "Schaefer's dichotomy theorem", 'funded', 0, 5, { by: 3, needs: ['twosat', 'horn'], riders: 7, statement: 'theorem schaefer (Γ : Constraints) : CSP Γ ∈ P ∨ NPComplete (CSP Γ)' }],
  ['xor', 'upper', 'lemma', 'XOR-SAT is in P by Gaussian elimination', 'proposed', 0, 0.3, { by: 5, statement: 'theorem xor_sat_in_p : XorSAT ∈ P' }],
  ['lp', 'upper', 'lemma', 'Linear programming is in P by the ellipsoid method', 'funded', 0, 5, { by: 9, riders: 5, statement: 'theorem lp_in_p : LinearProgramming ∈ P' }],
  ['matching', 'upper', 'lemma', 'Bipartite matching is in P', 'proposed', 0, 2, { by: 10, riders: 2 }],
  ['aks', 'upper', 'lemma', 'Primality is in P (AKS)', 'proposed', 0, 1.2, { by: 11 }],
  ['parity', 'ac0', 'lemma', 'Parity needs depth-d circuits of size 2^(n^(1/d))', 'proposed', 0, 0.8, { by: 12, needs: ['depth'] }],
  ['smol', 'ac0', 'lemma', 'Razborov–Smolensky: MOD3 is not in AC0[⊕]', 'proposed', 0, 1.6, { by: 13, riders: 3 }],
  ['ppoly', 'ac0', 'lemma', 'Random restrictions kill small DNFs', 'proposed', 0, 0.4, { by: 14 }],
  ['algebrize', 'barrier', 'lemma', 'Algebrization barrier (Aaronson–Wigderson)', 'proposed', 0, 3, { by: 15, riders: 4 }],
  ['space', 'found', 'lemma', 'The space hierarchy theorem', 'proposed', 0, 2, { by: 16, riders: 2 }],
  ['proof', 'root', 'program', 'Proof complexity: short proofs of tautologies', 'proposed', 0, 2.5, { by: 17, riders: 3 }],
  ['php', 'proof', 'lemma', 'Resolution needs exponential size for the pigeonhole principle', 'proposed', 0, 1.5, { by: 18, riders: 2 }],
  ['algebra', 'root', 'program', 'Algebraic complexity: VP versus VNP', 'proposed', 0, 1, { by: 19 }],
  ['claim', 'upper', 'idea', 'A claimed polynomial algorithm for 3-SAT', 'dead end', 1.2, 0, { by: 4, end: ['refuted', 'A checked counterexample: a 14-variable formula on which the algorithm answers unsatisfiable though it has a satisfying assignment.'] }],
]

const landing = nid('razb')

function hex(seed: string, size: number) {
  let out = ''
  for (let index = 0; out.length < size; index++) out += id(`${seed}:${index}`)
  return out.slice(0, size)
}

function checked(key: string, minutes: number): Tree.Check {
  const node = nid(key)
  return {
    at: at(minutes),
    axioms: ['propext', 'Classical.choice', 'Quot.sound'],
    checker: 'lean4checker v4.24.0',
    command: `lake build Pnp.Check.N${node} && lake exe lean4checker Pnp.Check`,
    commit: hex(`commit:${key}`, 40),
    contentHash: `sha256:${hex(`content:${key}`, 64)}`,
    durationMs: 140_000 + (Number.parseInt(hex(key, 4), 16) % 180_000),
    exitCode: 0,
    mathlib: hex('mathlib', 40),
    repo: 'example/pnp-proofs',
    run: String(19_000_000_000 + (Number.parseInt(hex(`run:${key}`, 6), 16) % 999_999)),
    statement: hex(`stmt:${key}`, 16),
    theorem: `Pnp.N${node}`,
    toolchain: 'leanprover/lean4:v4.24.0',
    url: `https://github.com/example/pnp-proofs/actions/runs/${19_000_000_000 + (Number.parseInt(hex(`run:${key}`, 6), 16) % 999_999)}`,
  }
}

const seededOnly = new Set(['root', 'triage', 'found', 'tm', 'pclosed', 'npver', 'red', 'cook', 'lower', 'mono', 'sun', 'razb', 'clique', 'ac0', 'switch', 'depth', 'barrier', 'bgs', 'bgs2', 'natural', 'upper', 'twosat', 'horn', 'schaefer', 'xor'])

function micro(value: number) {
  return BigInt(Math.round(value * 1_000_000))
}

function sprout(sprig: Sprig, index: number): Twig {
  const [key, parent, form, title, given, spentGiven, leftGiven, extra = {}] = sprig
  const seeded = scene.has('seeded')
  const status: Tree.Status = seeded ? (key === 'triage' ? 'funded' : given === 'funded' ? 'funded' : 'proposed') : (form === 'goal' || form === 'program' || form === 'approach') && given === 'in flight' ? 'proposed' : given
  const spent = seeded ? 0n : micro(spentGiven)
  const left = seeded ? (key === 'root' ? micro(40) : key === 'cook' || key === 'schaefer' ? micro(5) : 0n) : micro(leftGiven)
  const minutes = 2880 - index * 90
  const node = nid(key)
  const by = seeded ? sown : extra.by === 'agent' && parent ? worker(nid(parent)) : who(typeof extra.by === 'number' ? extra.by : index)
  const proof = status === 'proven' ? checked(key, Math.max(20, 1400 - index * 60)) : null
  const end = status === 'dead end' && extra.end ? { at: at(Math.max(30, 1500 - index * 40)), check: extra.end[0] === 'refuted' ? checked(key, 300) : null, into: null, kind: extra.end[0], why: extra.end[1] } : null
  const runs = seeded ? [] : (extra.summaries ?? (spent > 0n ? ['Read the parent and its siblings; planned the first step'] : [])).map((summary, k): NodeRun => {
    const share = spent / BigInt(Math.max(1, extra.summaries?.length ?? 1))
    const until = k === (extra.summaries?.length ?? 1) - 1 && status === 'in flight' ? null : at(minutes - 60 - k * 40)
    return { budget: decimal(share > 5_000_000n ? share : 5_000_000n), commit: until === null ? null : hex(`run:${key}:${k}`, 40), k: k + 1, outcome: until === null ? null : status === 'proven' && k === (extra.summaries?.length ?? 1) - 1 ? 'proved' : /Split/.test(summary) ? 'split' : 'progress', since: at(minutes - 50 - k * 40), spent: decimal(share), summary, task: `r:${node}:${k + 1}`, until }
  })
  const backers = extra.riders ? Array.from({ length: extra.riders }, (_, rank) => (index + rank * 5) % handles.length) : key === 'root' ? [0, 1, 2, 3, 4] : form === 'program' ? [index % 8] : spent > 0n || left > 0n ? [index % 8, (index + 3) % 8] : []
  const pledged = left + (spent * 2n) / 3n
  const funders = backers.map((person, rank): Tree.Funder => ({ amount: decimal(backers.length ? pledged / BigInt(backers.length) + BigInt(rank) * 10_000n : 0n), since: at(minutes - rank * 30), who: who(person) }))
  const run: Tree.Run | null = status === 'in flight' && form !== 'goal' && form !== 'program' && form !== 'approach' ? ({ agent: 3 + index, attempt: 1, budget: '5.000000', checking: false, k: runs.length, since: at(25), spent: decimal(spent % 5_000_000n), task: `r:${node}:${runs.length}`, until: at(-5), ...(extra.doing ? { doing: { at: at(3 + (index % 7)), text: extra.doing } } : {}) } as Tree.Run) : null
  return {
    by,
    createdAt: at(minutes),
    deltas: [],
    end,
    form,
    funders,
    id: node,
    inherited: parent && parent !== 'root' ? spent / 3n : 0n,
    left,
    needs: (extra.needs ?? []).map(nid),
    parent: parent ? nid(parent) : null,
    pledged: key === 'root' ? left + micro(18) : pledged,
    proof,
    run,
    runs,
    spent,
    statement: extra.statement ?? null,
    status,
    steers: key === 'switch' ? [{ amount: '2.000000', at: at(90), note: 'Try the Razborov encoding proof first; it is shorter in Lean.', who: who(5) }] : [],
    suggestions: key === 'lower' ? [{ at: at(200), id: 'idea-1', text: 'Formalize the Raz–McKenzie lifting theorem as its own approach.', who: who(6) }] : [],
    title,
    updatedAt: at(Math.max(1, minutes / 20)),
    words: form === 'goal' ? 'Settle whether every problem whose answer can be checked quickly can also be solved quickly. Every result is checked in Lean, and every dead end is kept with its reason.' : form === 'program' ? `A program of the swarm: ${title.toLowerCase()}. Its money flows to the runnable lemmas under it.` : form === 'triage' ? 'Reads new proposals and suggestions, approves, merges and grants from the root, within 5% of what riders put on the root.' : 'Stated in Lean below. Proven only when the verifier builds a proof of exactly this statement.',
  }
}

const grove: Twig[] = sprigs.filter(([key]) => (scene.has('empty') ? key === 'root' || key === 'triage' : scene.has('seeded') ? seededOnly.has(key) : true)).map(sprout)

if (scene.has('empty')) for (const twig of grove) Object.assign(twig, { funders: [], left: 0n, pledged: 0n, runs: [], spent: 0n, status: 'proposed' })

let treeSeq = 100

function zeroed(): Record<Tree.Status, number> {
  return { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 0 }
}

function derive(): Record<string, Tree.Node> {
  const kids = new Map<string, string[]>()
  for (const twig of grove) if (twig.parent) kids.set(twig.parent, [...(kids.get(twig.parent) ?? []), twig.id])
  const out: Record<string, Tree.Node> = {}
  const fold = (twig: Twig): Tree.Node => {
    const children = (kids.get(twig.id) ?? []).map((child) => fold(grove.find((each) => each.id === child)!))
    const counts = zeroed()
    counts[twig.status] += 1
    let spent = twig.spent
    let left = twig.left
    let pledged = twig.pledged
    for (const child of children) {
      for (const status of Object.keys(counts) as Tree.Status[]) counts[status] += child.counts[status]
      spent += units(child.money.subtree.spent)
      left += units(child.money.subtree.left)
      pledged += units(child.money.subtree.pledged)
    }
    const node: Tree.Node = {
      by: twig.by,
      children: children.map((child) => child.id),
      counts,
      createdAt: twig.createdAt,
      end: twig.end,
      form: twig.form,
      funders: twig.funders.slice(0, 5),
      id: twig.id,
      money: { committed: twig.run ? twig.run.budget : '0', granted: decimal(children.reduce((sum, child) => sum + units(child.money.inherited), 0n)), inherited: decimal(twig.inherited), left: decimal(twig.left), pledged: decimal(twig.pledged), spent: decimal(twig.spent), subtree: { left: decimal(left), pledged: decimal(pledged), spent: decimal(spent) } },
      needs: twig.needs,
      parent: twig.parent,
      paused: null,
      proof: twig.proof,
      review: twig.statement !== null && (scene.has('seeded') || twig.status === 'proposed'),
      riders: twig.funders.length,
      run: twig.run,
      spec: `# ${twig.title}\n\n${twig.words}${twig.statement ? `\n\n\`\`\`lean\n${twig.statement}\n\`\`\`` : ''}`,
      statement: twig.statement,
      status: twig.status,
      title: twig.title,
      updatedAt: twig.updatedAt,
    }
    out[twig.id] = node
    return node
  }
  const root = grove.find((twig) => twig.id === 'root')
  if (root) fold(root)
  return out
}

function deep(nodes: Record<string, Tree.Node>, root: string, depth: number) {
  const out: Tree.Node[] = []
  const walk = (id: string, level: number) => {
    const node = nodes[id]
    if (!node) return
    out.push(node)
    if (level < depth) for (const child of node.children) walk(child, level + 1)
  }
  walk(root, 0)
  return out
}

function twig(key: string, nidGiven: string) {
  if (key !== treeId) throw fail(404, 'not_found', 'No swarm has this id.')
  const found = grove.find((each) => each.id === nidGiven)
  if (!found) throw fail(404, 'not_found', 'No node has this id.')
  return found
}

export function treeView(key: string, query: { depth?: number; root?: string }): Promise<TreeView> {
  if (key !== treeId) return Promise.reject(fail(404, 'not_found', 'No swarm has this id.'))
  const nodes = derive()
  return delay({ headline: Tree.headline(Object.values(nodes)), nodes: deep(nodes, query.root ?? 'root', query.depth ?? 3), seq: treeSeq })
}

function told(found: Twig): Tree.Delta[] {
  const node = derive()[found.id]!
  const made: Tree.Delta[] = [{ at: found.createdAt, event: 'posted', node, seq: 1, text: `Proposed by @${found.by.handle}` }]
  for (const funder of found.funders) made.push({ at: funder.since, event: 'funded', node, seq: 2, text: `@${funder.who.handle} put ${usd(funder.amount)} on it` })
  for (const run of found.runs) made.push({ at: run.since, event: 'started', node, seq: 3, text: `Run ${run.k} started with ${usd(run.budget)}` }, ...(run.until ? [{ at: run.until, event: 'progress' as const, node, seq: 4, text: run.summary }] : []))
  if (found.proof) made.push({ at: found.proof.at, event: 'proven', node, seq: 5, text: 'Checked by Lean' })
  if (found.end) made.push({ at: found.end.at, event: 'ended', node, seq: 5, text: found.end.why })
  return [...made, ...found.deltas].sort((a, b) => b.at - a.at)
}

export function nodeView(key: string, nidGiven: string): Promise<NodeView> {
  try {
    const found = twig(key, nidGiven)
    const node = derive()[found.id]!
    return delay({ ...node, funders: found.funders, runs: [...found.runs].reverse(), steers: found.steers, suggestions: found.suggestions })
  } catch (error) {
    return Promise.reject(error)
  }
}

export function nodeUpdates(key: string, nidGiven: string): Promise<NodeUpdates> {
  try {
    return delay({ deltas: told(twig(key, nidGiven)).slice(0, 30), next: treeSeq })
  } catch (error) {
    return Promise.reject(error)
  }
}

export function burn(key: string): Promise<ProgressView> {
  if (key !== treeId) return Promise.reject(fail(404, 'not_found', 'No swarm has this id.'))
  const proven = grove.filter((each) => each.proof).map((each) => each.proof!.at)
  const dead = grove.filter((each) => each.end).map((each) => each.end!.at)
  const total = grove.reduce((sum, each) => sum + each.spent, 0n)
  const hours = 48
  const now = Date.now()
  return delay({ burn: scene.has('empty') ? [] : Array.from({ length: hours + 1 }, (_, index) => {
    const when = now - (hours - index) * 3_600_000
    return { at: when, deadEnds: dead.filter((time) => time <= when).length, proven: proven.filter((time) => time <= when).length, spent: decimal((total * BigInt(index)) / BigInt(hours)) }
  }) })
}

export function proofs(key: string): Promise<ProofsView> {
  if (key !== treeId) return Promise.reject(fail(404, 'not_found', 'No swarm has this id.'))
  return delay({ proofs: grove.filter((each) => each.proof).map((each) => ({ check: each.proof!, node: each.id, title: each.title })).sort((a, b) => b.check.at - a.check.at) })
}

function emit(found: Twig, event: Tree.Delta['event'], text: string) {
  treeSeq += 1
  const delta: Tree.Delta = { at: Date.now(), event, node: derive()[found.id]!, seq: treeSeq, text }
  found.deltas.push(delta)
  found.updatedAt = delta.at
  tell(treeId, { delta, type: 'delta' })
  const room = fixtures.find((each) => each.id === treeId)
  const head = room?.chat.find((item) => item.node === found.id && item.parent === undefined)
  if (room && head && event !== 'posted' && event !== 'doing') post(treeId, room, { artifact: null, at: delta.at, author: null, id: (room.chat.at(-1)?.id ?? 0) + 1, mentions: [], parent: head.id, steer: null, text })
  return delta
}

const proposals = new Map<string, Twig>()

const proposed = new Map<string, string>()

export async function propose(key: string, input: { form: Tree.Form; parent: string; said?: string; spec: string; statement?: string; title: string }, by: `0x${string}` | undefined): Promise<Proposed> {
  if (!by) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to propose.')
  const parent = twig(key, input.parent)
  const made = nid(`${parent.id}\n${input.title.trim().toLowerCase()}`)
  if (input.said?.trim()) proposed.set(made, input.said.trim())
  proposals.set(made, { by: who(0), createdAt: Date.now(), deltas: [], end: null, form: input.form, funders: [], id: made, inherited: 0n, left: 0n, needs: [], parent: parent.id, pledged: 0n, proof: null, run: null, runs: [], spent: 0n, statement: input.statement?.trim() || null, status: 'proposed', steers: [], suggestions: [], title: input.title.trim(), updatedAt: Date.now(), words: input.spec.trim() })
  const memo = `0x${hex(`memo:${made}`, 64)}` as `0x${string}`
  return delay({ nid: made, transfer: { amount: '1.000000', call: null, link: '', memo, memoText: `n:${made}`, note: `n:${made}`, swarm: key, symbol: 'USDC.e', to: '0x40def0Cf3B5d28B6e9a7976BA10591e515AfECFE', token: 'usdce', tokenAddress: '0x20C000000000000000000000b9537d11c60E8b50' } }, 400)
}

async function uncountable() {
  if (scene.has('stuck')) await new Promise<never>(() => {})
  if (scene.has('reject')) throw fail(400, 'invalid_request', 'That transaction is not a transfer to the gateway for this swarm.')
}

export async function ride(key: string, input: { hash: string; node: string }): Promise<Contributed> {
  const hash = input.hash as `0x${string}`
  await uncountable()
  if (scene.has('uncounted') && !dropped.has(hash)) {
    dropped.add(hash)
    throw fail(502, 'unavailable', 'Swarms could not reach Tempo to check the transfer.')
  }
  const fresh = proposals.get(input.node)
  if (fresh) {
    proposals.delete(input.node)
    grove.push(fresh)
    const said = proposed.get(input.node)
    const room = said ? seed(await find(key)) : undefined
    if (said && room) post(key, room, { artifact: null, at: Date.now(), author: visitor, id: (room.chat.at(-1)?.id ?? 0) + 1, mentions: mentions(room, said), node: fresh.id, steer: null, text: said })
    proposed.delete(input.node)
  }
  const found = twig(key, input.node)
  const amount = sent.get(hash)?.amount ?? 1_000_000n
  found.pledged += amount
  found.left += amount
  const mine = found.funders.find((funder) => funder.who.address === visitor)
  if (mine) mine.amount = decimal(units(mine.amount) + amount)
  else found.funders.unshift({ amount: decimal(amount), since: Date.now(), who: who(0) })
  if (found.status === 'proposed' && found.left >= 500_000n && found.form === 'lemma') found.status = 'funded'
  emit(found, fresh ? 'posted' : 'funded', fresh ? `@ada proposed it with ${usd(decimal(amount))}` : `@ada put ${usd(decimal(amount))} on it`)
  const swarm = await find(key)
  swarm.contributions.push({ amount: decimal(amount), at: Date.now(), contributor: visitor, hash, note: null, token: sent.get(hash)?.token ?? 'usdce' })
  settle(swarm)
  return delay({ contribution: swarm.contributions.at(-1)!, swarm: summary(swarm) }, 500)
}

export async function suggest(key: string, input: { parent: string; text: string }, by: `0x${string}` | undefined): Promise<Suggested> {
  if (!by) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to suggest.')
  const found = twig(key, input.parent)
  const made = `idea-${found.suggestions.length + 2}`
  found.suggestions.unshift({ at: Date.now(), id: made, text: input.text.trim(), who: who(0) })
  return delay({ id: made }, 300)
}

export async function steerNode(key: string, nidGiven: string, input: { amount: string; note: string }, by: `0x${string}` | undefined): Promise<Tree.Node> {
  if (!by) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to steer.')
  const found = twig(key, nidGiven)
  found.steers.unshift({ amount: input.amount, at: Date.now(), note: input.note.trim(), who: who(0) })
  return delay(emit(found, 'steered', `@ada: ${input.note.trim()}`).node, 300)
}

export async function moveNode(key: string, nidGiven: string, input: { amount: string; to: string }, by: `0x${string}` | undefined): Promise<Tree.Node> {
  if (!by) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to move money.')
  const found = twig(key, nidGiven)
  const mine = found.funders.find((funder) => funder.who.address === visitor)
  const amount = units(input.amount)
  if (!mine || units(mine.amount) < amount || found.left < amount) throw fail(409, 'conflict', 'You have less than that on this node.')
  mine.amount = decimal(units(mine.amount) - amount)
  found.left -= amount
  found.pledged -= amount
  const target = input.to ? twig(key, input.to) : undefined
  if (target) {
    target.left += amount
    target.pledged += amount
    const theirs = target.funders.find((funder) => funder.who.address === visitor)
    if (theirs) theirs.amount = decimal(units(theirs.amount) + amount)
    else target.funders.unshift({ amount: decimal(amount), since: Date.now(), who: who(0) })
    emit(target, 'moved', `@ada moved ${usd(input.amount)} here`)
  }
  return delay(emit(found, 'moved', `@ada moved ${usd(input.amount)} ${target ? 'to ' + target.title : 'to their free money'}`).node, 300)
}

function woods(listener: (event: Chatter | { type: 'open' | 'closed' }) => void) {
  const set = listeners.get(treeId) ?? new Set()
  set.add(listener)
  listeners.set(treeId, set)
  const timers: ReturnType<typeof setTimeout>[] = []
  let beat: ReturnType<typeof setInterval> | undefined
  timers.push(setTimeout(() => {
    listener({ type: 'open' })
    if (offline) return
    listener({ type: 'welcome', version: String(treeSeq) })
    if (scene.has('landing')) {
      const found = grove.find((each) => each.id === landing)
      if (found && found.status !== 'proven') {
        timers.push(setTimeout(() => {
          if (found.run) found.run = { ...found.run, checking: true }
          emit(found, 'checking', 'Run 4 says proved; the verifier is building it')
        }, 2000))
        timers.push(setTimeout(() => {
          found.status = 'proven'
          found.run = null
          found.proof = checked('razb', 0)
          found.proof.at = Date.now()
          found.runs.push({ budget: '5.000000', commit: found.proof.commit, k: found.runs.length + 1, outcome: 'proved', since: Date.now() - 600_000, spent: '1.120000', summary: 'Proved the AND gate bound for all k; sent to the verifier', task: `r:${found.id}:${found.runs.length + 1}`, until: Date.now() })
          emit(found, 'proven', 'Checked by Lean')
        }, 4500))
      }
    }
    if (!scene.has('empty') && !scene.has('seeded'))
      beat = setInterval(() => {
        const busy = grove.filter((each) => each.status === 'in flight' && each.run && !each.run.checking)
        const found = busy[Math.floor(Date.now() / 4000) % Math.max(1, busy.length)]
        if (!found?.run) return
        found.spent += 30_000n
        found.left = found.left > 30_000n ? found.left - 30_000n : 0n
        found.run = { ...found.run, spent: decimal(units(found.run.spent) + 30_000n) }
        emit(found, 'progress', 'Spent $0.03 on the next step')
      }, 4000)
  }, 200))
  return {
    close: () => {
      for (const timer of timers) clearTimeout(timer)
      clearInterval(beat)
      set.delete(listener)
    },
    hello: () => {},
    typing: () => {},
  }
}

const hallSaid: Said[] = [
  { artifact: null, at: at(190), author: people[2], id: 1, mentions: [], steer: null, text: 'Rode Does P = NP? with $5. Every green dot on its board is a proof Lean checked.' },
  { artifact: null, at: at(150), author: people[4], id: 2, mentions: [], steer: null, text: 'Is anyone starting a channel on attention kernels for small GPUs? I would ride it.' },
  { artifact: null, at: at(62), author: people[1], id: 3, mentions: [], steer: null, text: 'The JSON channel parsed its terabyte for under a dollar, about $c = k \\cdot n^{2}$ per task, \\(\\nu \\le 3\\). It cost $5 and $10.\n\n\\[\\frac{a}{b} = \\sqrt{c^2 + d_i}\\]' },
  { artifact: null, at: at(18), author: people[2], id: 4, mentions: [], steer: null, text: '@tensorbox start it, I put in $10 the minute it exists.' },
]

const hallListeners = new Set<(event: Heard | { type: 'open' | 'closed' }) => void>()

export async function general(query: { after?: number; before?: number }): Promise<Hall> {
  const messages = query.before ? hallSaid.filter((item) => item.id < (query.before ?? 0)) : hallSaid.filter((item) => item.id > (query.after ?? 0))
  return delay({ messages, names: Object.fromEntries(hallSaid.flatMap((item) => (item.author ? [[item.author, called(item.author)]] : []))), next: messages.at(-1)?.id ?? query.after ?? 0 })
}

export async function shout(text: string, who: `0x${string}` | undefined): Promise<Shouted> {
  if (!who) throw fail(401, 'unauthorized', 'Sign in with Tempo ID to post in #general.')
  const name = names.get(who.toLowerCase())
  if (!name) throw fail(403, 'username_required', 'Pick a username first.')
  const message: Said = { artifact: null, at: Date.now(), author: who, id: (hallSaid.at(-1)?.id ?? 0) + 1, mentions: [], steer: null, text: text.trim() }
  hallSaid.push(message)
  for (const listener of hallListeners) listener({ message, name, type: 'said' })
  return delay({ message, name }, 250)
}

export function hall(listener: (event: Heard | { type: 'open' | 'closed' }) => void) {
  hallListeners.add(listener)
  const opened = setTimeout(() => {
    if (offline) return
    listener({ type: 'open' })
    listener({ type: 'welcome' })
  }, 200)
  return () => {
    clearTimeout(opened)
    hallListeners.delete(listener)
  }
}
