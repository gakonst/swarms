import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export type Job = { name: string; options?: Record<string, unknown>; scenario?: string }

export type Canary = { flag: string; invariant: string; job: string; module: string; name: string; seeds: string[] }

export type Seed = { fix: string; found: string; invariant: string; job: string; seed: string }

export type Outcome = { ms: number; steps: number; trace: string; violations: { detail: string; invariant: string }[] }

const small = { activeMs: 30 * 60_000, children: 4, pledges: 4, swarms: 2, tailMs: 2 * 60 * 60_000 }

const holding = ['evict', 'dup', 'reorder', 'stale', 'retry', 'move', 'refuse']

export const jobs: Job[] = [
  { name: 'swarm', options: small },
  { name: 'swarm_calm', options: { ...small, faults: [] } },
  { name: 'swarm_crash', options: { ...small, faults: ['crash', ...holding] } },
  { name: 'swarm_list', options: { ...small, faults: ['staleList', 'lag'] } },
  { name: 'swarm_money', options: { ...small, faults: ['stranded', 'chainLag', 'lag', 'retry', 'move', 'dup'] } },
  { name: 'swarm_net', options: { ...small, faults: ['partition', 'skew', 'evict', 'crash'] } },
  { name: 'swarm_wide', options: { activeMs: 45 * 60_000, children: 6, pledges: 6, swarms: 3, tailMs: 3 * 60 * 60_000 } },
]

export const canaries: Canary[] = [
  { flag: 'monotonic', invariant: 'illegal transition', job: 'swarm_list', module: 'machines/Sub', name: 'swarm.sub.monotonic', seeds: ['1', '2', '3'] },
  { flag: 'covered', invariant: 'negative balance', job: 'swarm', module: 'Flow', name: 'swarm.flow.covered', seeds: ['2', '5', '6'] },
  { flag: 'closed', invariant: 'duplicate payment', job: 'swarm', module: 'machines/Payment', name: 'swarm.payment.closed', seeds: ['1', '3', '6'] },
  { flag: 'keyed', invariant: 'duplicate payment', job: 'swarm', module: 'machines/Payment', name: 'swarm.payment.keyed', seeds: ['3'] },
]

const here = dirname(fileURLToPath(import.meta.url))

const seedsFile = join(here, 'seeds.json')

export const limits = { canarySeeds: 8, huntMinutesMost: 24 * 60, outputBytes: 64 * 1024 * 1024, seedsMost: 100_000 }

type Module = {
  canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[]
  scenarios: Record<string, (seed: string) => Promise<{ steps: number; violations: { detail: string; invariant: string }[] }>>
}

async function modules(): Promise<Module[]> {
  const files = readdirSync(here)
    .filter((file) => file.endsWith('.ts') && file !== 'main.ts')
    .sort()
  const loaded = await Promise.all(files.map(async (file) => (await import(pathToFileURL(join(here, file)).href)) as Partial<Module>))
  return loaded.filter((found): found is Module => !!found.scenarios && !!found.canaries)
}

export async function allJobs(): Promise<Job[]> {
  const scenarios = (await modules()).flatMap((found) => Object.keys(found.scenarios))
  return [...jobs, ...scenarios.map((name) => ({ name, scenario: name }))]
}

export async function allCanaries(): Promise<Canary[]> {
  const scenarioCanaries = (await modules()).flatMap((found) =>
    found.canaries.map((one) => ({ flag: '', invariant: one.invariant, job: one.scenario, module: '', name: one.name, seeds: one.seeds })),
  )
  return [...canaries, ...scenarioCanaries]
}

export function seeds(): Seed[] {
  return JSON.parse(readFileSync(seedsFile, 'utf8')) as Seed[]
}

async function one(job: Job, seed: string, canary: string | null, log = false): Promise<Outcome> {
  const began = performance.now()
  if (job.scenario) {
    const all = await modules()
    const scenario = all.find((found) => found.scenarios[job.scenario as string])?.scenarios[job.scenario]
    if (!scenario) throw new Error('No scenario ' + job.scenario)
    const flipped = canary ? all.flatMap((found) => found.canaries).find((one) => one.name === canary) : undefined
    if (canary && !flipped) throw new Error('No canary ' + canary)
    const restore = flipped?.flip()
    try {
      const outcome = await scenario(seed)
      return { ms: Math.round(performance.now() - began), steps: outcome.steps, trace: '', violations: outcome.violations }
    } finally {
      restore?.()
    }
  }
  const flipped = canary ? canaries.find((one) => one.name === canary) : undefined
  if (canary && !flipped) throw new Error('No canary ' + canary)
  const guards = flipped
    ? ((await import(pathToFileURL(join(here, '..', '..', 'src', 'worker', flipped.module + '.ts')).href)) as { guards: Record<string, boolean> }).guards
    : undefined
  if (guards && flipped) guards[flipped.flag] = false
  try {
    const { simulate } = await import('../load/sim.ts')
    const report = await simulate({ ...(job.options ?? {}), ...(log ? { log } : {}), seed } as never)
    return {
      ms: Math.round(performance.now() - began),
      steps: report.counts.steps,
      trace: report.trace,
      violations: report.violations.map(({ detail, invariant }) => ({ detail, invariant })),
    }
  } finally {
    if (guards && flipped) guards[flipped.flag] = true
  }
}

export function run(job: string, seed: string, canary: string | null = null): Promise<Outcome> {
  return new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      ['--experimental-strip-types', fileURLToPath(import.meta.url), '--one', JSON.stringify({ canary, job, seed })],
      { maxBuffer: limits.outputBytes },
      (error, stdout) => {
        const last = stdout.trim().split('\n').at(-1) ?? ''
        if (error && !last.startsWith('{')) return reject(error)
        resolve(JSON.parse(last) as Outcome)
      },
    ),
  )
}

export async function pool<T, R>(items: readonly T[], width: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(width, items.length)) }, async () => {
      while (next < items.length) {
        const at = next++
        out[at] = await work(items[at] as T)
      }
    }),
  )
  return out
}

function command(job: string, seed: string, canary: string | null) {
  return 'pnpm dst --job ' + job + ' --seed ' + seed + (canary ? ' --canary ' + canary : '')
}

function failed(job: string, seed: string, outcome: Outcome) {
  for (const violation of outcome.violations.slice(0, 4))
    process.stdout.write('FAIL ' + job + ' seed=' + seed + ' ' + violation.invariant + ': ' + violation.detail.slice(0, 300) + '\n')
  process.stdout.write('  repro: ' + command(job, seed, null) + '\n')
}

async function pass(pairs: { job: string; seed: string }[], width: number) {
  let bad = 0
  await pool(pairs, width, async ({ job, seed }) => {
    const outcome = await run(job, seed).catch((error: unknown) => ({
      ms: 0,
      steps: 0,
      trace: '',
      violations: [{ detail: String((error as Error)?.message ?? error).slice(0, 300), invariant: 'crashed' }],
    }))
    if (outcome.violations.length) {
      bad += 1
      failed(job, seed, outcome)
    } else process.stdout.write('PASS ' + job + ' seed=' + seed + ' steps=' + outcome.steps + ' ' + outcome.ms + 'ms\n')
  })
  return bad
}

async function canaryRun(list: Canary[], width: number) {
  let missed = 0
  await pool(list, width, async (canary) => {
    for (const seed of canary.seeds.slice(0, limits.canarySeeds)) {
      const outcome = await run(canary.job, seed, canary.name).catch(() => null)
      const caught = outcome?.violations.find((one) => one.invariant === canary.invariant)
      if (caught) {
        process.stdout.write(
          'CAUGHT ' + canary.name + ' job=' + canary.job + ' seed=' + seed + ' ' + caught.invariant + ': ' + caught.detail.slice(0, 160) + '\n',
        )
        return
      }
    }
    missed += 1
    process.stdout.write('MISSED ' + canary.name + ' job=' + canary.job + ' seeds=' + canary.seeds.join(',') + ': no ' + canary.invariant + '\n')
  })
  return missed
}

async function replay(job: string, seed: string) {
  const [first, again] = await Promise.all([run(job, seed), run(job, seed)])
  if (first.trace === again.trace && first.steps === again.steps) {
    process.stdout.write('REPLAY ' + job + ' seed=' + seed + ' trace=' + first.trace + '\n')
    return 0
  }
  process.stdout.write('FAIL replay ' + job + ' seed=' + seed + ': traces ' + first.trace + ' and ' + again.trace + '\n')
  return 1
}

async function hunt(minutes: number, width: number, names: string[]) {
  const until = Date.now() + Math.min(minutes, limits.huntMinutesMost) * 60_000
  const began = Date.now()
  let ran = 0
  let found = 0
  const log = join(here, '..', '..', 'output', 'dst', 'found.jsonl')
  mkdirSync(dirname(log), { recursive: true })
  await Promise.all(
    Array.from({ length: width }, async (_, lane) => {
      for (let i = 0; Date.now() < until && i < limits.seedsMost; i++) {
        const job = names[(lane + i) % names.length] as string
        const seed = 'h' + randomBytes(6).toString('hex')
        const outcome = await run(job, seed).catch((error: unknown) => ({
          ms: 0,
          steps: 0,
          trace: '',
          violations: [{ detail: String((error as Error)?.message ?? error).slice(0, 300), invariant: 'crashed' }],
        }))
        ran += 1
        if (!outcome.violations.length) continue
        found += 1
        failed(job, seed, outcome)
        appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), job, seed, violations: outcome.violations.slice(0, 4) }) + '\n')
      }
    }),
  )
  const hours = (Date.now() - began) / 3_600_000
  process.stdout.write('HUNT seeds=' + ran + ' failing=' + found + ' seeds/hour=' + Math.round(ran / hours) + ' width=' + width + '\n')
  return found
}

async function main() {
  const { values } = parseArgs({
    options: {
      canaries: { type: 'boolean' },
      canary: { type: 'string' },
      hunt: { type: 'boolean' },
      job: { type: 'string' },
      minutes: { type: 'string' },
      one: { type: 'string' },
      seed: { type: 'string' },
      seeds: { type: 'string' },
      'seeds-file': { type: 'boolean' },
      width: { type: 'string' },
    },
  })
  if (values.one) {
    const asked = JSON.parse(values.one) as { canary: string | null; job: string; log?: boolean; seed: string }
    const known = await allJobs()
    const job = known.find((one) => one.name === asked.job)
    if (!job) throw new Error('No job ' + asked.job + '; pick from ' + known.map((one) => one.name).join(','))
    process.stdout.write(JSON.stringify(await one(job, asked.seed, asked.canary, asked.log === true)) + '\n')
    process.exit(0)
  }
  const width = values.width ? Number(values.width) : Math.max(1, Math.floor(availableParallelism() / 2))
  const known = await allJobs()
  const named = values.job ? values.job.split(',') : known.map((one) => one.name)
  for (const name of named)
    if (!known.some((one) => one.name === name)) throw new Error('No job ' + name + '; pick from ' + known.map((one) => one.name).join(','))
  const available = named
  let bad = 0
  if (values.hunt) bad += await hunt(Number(values.minutes ?? '10'), width, available)
  else if (values.canary)
    bad += await canaryRun(
      (await allCanaries()).filter((one) => one.name === values.canary),
      width,
    )
  else if (values.canaries)
    bad += await canaryRun(
      (await allCanaries()).filter((one) => available.includes(one.job)),
      width,
    )
  else if (values['seeds-file'])
    bad += await pass(
      seeds().filter((one) => available.includes(one.job)),
      width,
    )
  else if (!values.seed && !values.seeds && !values.job) {
    bad += await pass([...seeds().filter((one) => available.includes(one.job)), ...available.map((job) => ({ job, seed: '1' }))], width)
    bad += await replay('swarm', '7')
    bad += await canaryRun(
      (await allCanaries()).filter((one) => available.includes(one.job)),
      width,
    )
  } else {
    const list = values.seeds ? Array.from({ length: Math.min(Number(values.seeds), limits.seedsMost) }, (_, i) => String(i + 1)) : [values.seed ?? '1']
    bad += await pass(
      available.flatMap((job) => list.map((seed) => ({ job, seed }))),
      width,
    )
  }
  process.stdout.write(bad ? 'RED dst ' + bad + ' failing\n' : 'GREEN dst\n')
  process.exitCode = bad ? 1 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
