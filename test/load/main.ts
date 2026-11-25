import { execFile } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { defaults, faultNames, type Fault, type Options, type Report } from './sim.ts'

export function run(options: Options): Promise<Report> {
  return new Promise((resolve, reject) =>
    execFile(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), '--options', JSON.stringify(options)], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(error)
      resolve(JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as Report)
    }),
  )
}

function command(options: Options) {
  return `pnpm load --seed ${options.seed} --swarms ${options.swarms} --offset ${options.offset} --children ${options.children} --pledges ${options.pledges} --active ${options.activeMs / 60_000} --tail ${options.tailMs / 60_000} --faults ${options.faults.join(',') || ','}`
}

function print(report: Report) {
  const { counts, ledger, options } = report
  process.stdout.write(
    `seed ${options.seed}: ${options.swarms} swarms × ${options.children} children, ${counts.subagents} subagents, ${counts.folds} folds, ${counts.evictions} evictions, ${counts.redeliveries} redeliveries, ${counts.moves} moves, ${counts.gatewayCalls} gateway calls; ${Math.round(report.virtualMs / 60_000)} virtual minutes in ${report.wallMs} ms; trace ${report.trace}\n` +
      `  ledger: riders sent $${ledger.contributed}, gateway charged $${ledger.spentGateway}, ledger spent $${ledger.spentLedger}, held $${ledger.held}, drift $${ledger.drift}; slowest fold ${Math.round(report.slowestFoldMs / 1000)}s\n`,
  )
  for (const violation of report.violations) process.stdout.write(`  ✗ ${violation.invariant} [swarm ${violation.swarm}] ${violation.detail}\n`)
  if (!report.violations.length) process.stdout.write('  ✓ every invariant held\n')
}

async function failing(options: Options, invariant: string) {
  const report = await run(options)
  return report.violations.some((violation) => violation.invariant === invariant)
}

async function shrink(options: Options, invariant: string, swarm: number) {
  let found: Options = options
  const alone = { ...options, offset: swarm, swarms: 1 }
  if (await failing(alone, invariant)) found = alone
  for (const fault of [...found.faults]) {
    const fewer = { ...found, faults: found.faults.filter((one) => one !== fault) }
    if (await failing(fewer, invariant)) found = fewer
  }
  for (const children of [0, 1, 2, 3].filter((n) => n < found.children)) {
    const smaller = { ...found, children }
    if (await failing(smaller, invariant)) {
      found = smaller
      break
    }
  }
  return found
}

async function main() {
  const { values } = parseArgs({
    options: {
      active: { type: 'string' },
      children: { type: 'string' },
      faults: { type: 'string' },
      json: { type: 'boolean' },
      offset: { type: 'string' },
      options: { type: 'string' },
      pledges: { type: 'string' },
      seed: { type: 'string' },
      seeds: { type: 'string' },
      shrink: { type: 'boolean' },
      swarms: { type: 'string' },
      tail: { type: 'string' },
    },
  })
  if (values.options) {
    const { simulate } = await import('./sim.ts')
    process.stdout.write(JSON.stringify(await simulate(JSON.parse(values.options) as Options)) + '\n')
    return
  }
  const faults = (values.faults ? values.faults.split(',').filter(Boolean) : [...faultNames]) as Fault[]
  for (const fault of faults) if (!faultNames.includes(fault)) throw new Error('Unknown fault ' + fault + '; pick from ' + faultNames.join(','))
  const base: Options = {
    ...defaults,
    ...(values.active ? { activeMs: Number(values.active) * 60_000 } : {}),
    ...(values.children ? { children: Number(values.children) } : {}),
    ...(values.offset ? { offset: Number(values.offset) } : {}),
    ...(values.pledges ? { pledges: Number(values.pledges) } : {}),
    ...(values.swarms ? { swarms: Number(values.swarms) } : {}),
    ...(values.tail ? { tailMs: Number(values.tail) * 60_000 } : {}),
    faults,
  }
  const seeds = values.seeds ? Array.from({ length: Number(values.seeds) }, (_, i) => String(i + 1)) : [values.seed ?? defaults.seed]
  const reports: Promise<Report>[] = []
  const width = Math.max(1, Math.floor(availableParallelism() / 4))
  let next = 0
  const lanes = Array.from({ length: Math.min(width, seeds.length) }, async () => {
    while (next < seeds.length) {
      const at = next++
      reports[at] = run({ ...base, seed: seeds[at] as string })
      await reports[at]?.catch(() => undefined)
    }
  })
  await Promise.all(lanes)
  let failed = 0
  for (const report of await Promise.all(reports)) {
    if (values.json) process.stdout.write(JSON.stringify(report) + '\n')
    else print(report)
    if (report.violations.length) failed += 1
    if (values.shrink)
      for (const invariant of [...new Set(report.violations.filter((one) => one.swarm >= 0).map((one) => one.invariant))]) {
        const first = report.violations.find((one) => one.invariant === invariant)
        const smallest = await shrink(report.options, invariant, first?.swarm ?? 0)
        process.stdout.write(`  repro ${invariant}: ${command(smallest)}\n`)
      }
  }
  if (seeds.length > 1) process.stdout.write(`${failed} of ${seeds.length} seeds broke an invariant\n`)
  process.exitCode = failed ? 1 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
