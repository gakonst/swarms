import * as Http from 'node:http'
import type * as EndpointsModule from '../e2e/endpoints.ts'
import { applied, type Canary, load, mutant, type Outcome, recorder, type Rng, rng } from './mh-kit.ts'

export const limits = {
  cold: {
    failing: 500,
    idleMost: 120,
    roundsLeast: 2,
    roundsMost: 3,
    routesLeast: 2,
    routesMost: 4,
    samplesMost: 3,
    serverMost: 900,
    settleMost: 3,
    statuses: [200, 404, 503],
  },
  id: 12,
  short: 4,
}

type Check = ReturnType<typeof recorder>

const digits = '0123456789abcdef'

const letters = 'abcdefghijklmnopqrstuvwxyz'

function word(random: Rng, length: number, from = letters) {
  return Array.from({ length }, () => random.pick([...from])).join('')
}

function hex(random: Rng, length = limits.id) {
  return word(random, length, digits)
}

type Plan = { idle: number; ray: string; rounds: number; routes: string[]; samples: number; settle: boolean; statuses: Record<string, number>; total: number }

async function coldPlan(E: typeof EndpointsModule, random: Rng, check: Check, plan: Plan) {
  const paths: string[] = []
  const counted = { connections: 0 }
  const server = Http.createServer((request, response) => {
    paths.push(request.url ?? '')
    response.statusCode = plan.statuses[request.url ?? ''] ?? 0
    response.setHeader('server-timing', 'do.viewed;dur=' + random.int(0, plan.total) + ', total;dur=' + plan.total)
    response.setHeader('cf-ray', plan.ray)
    response.end('ok')
  })
  server.on('connection', () => (counted.connections += 1))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const root = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const pauses: number[] = []
  try {
    const pause = async (ms: number) => {
      pauses.push(ms)
      if (plan.settle) await new Promise((resolve) => setTimeout(resolve, random.int(0, limits.cold.settleMost)))
    }
    const report = await E.cold(root, { idle: plan.idle, pause, rounds: plan.rounds, routes: plan.routes, samples: plan.samples })
    const n = plan.routes.length
    const order = [
      ...Array.from({ length: plan.rounds }, (_, round) => plan.routes.map((_, index) => plan.routes[(index + round) % n] as string)).flat(),
      ...plan.routes.flatMap((route) => Array.from({ length: plan.samples }, () => route)),
    ]
    check.same('cold runs', 'runs', report.runs.length, plan.rounds * n + n * plan.samples)
    check.same('cold runs', 'request order', paths, order)
    check.same(
      'cold runs',
      'run routes',
      report.runs.map((run) => run.route),
      order,
    )
    check.same(
      'cold runs',
      'modes',
      report.runs.map((run) => run.mode),
      order.map((_, i) => (i < plan.rounds * n ? 'idle' : 'fresh')),
    )
    check.same(
      'cold runs',
      'first after idle',
      report.runs.filter((run) => run.first).map((run) => run.route),
      Array.from({ length: plan.rounds }, (_, round) => plan.routes[round % n]),
    )
    check.same('cold fresh connection', 'connections', counted.connections, report.runs.length)
    check.same(
      'cold pause',
      'pauses',
      pauses,
      Array.from({ length: plan.rounds }, () => plan.idle * 1000),
    )
    for (const run of report.runs) {
      check.same('cold phases', run.route + ' phases', [run.phases.status, run.phases.server, run.phases.ray], [plan.statuses[run.route], plan.total, plan.ray])
      if (!(run.phases.connect <= run.phases.ttfb && run.phases.ttfb <= run.phases.total))
        check.fail('cold phases', run.route + ' phases out of order: ' + JSON.stringify(run.phases))
    }
    const table = E.coldTable(report)
    const lines = [
      ...plan.routes.flatMap((route) => ['| ' + route + ' | fresh | ' + plan.samples + ' |', '| ' + route + ' | idle | ' + plan.rounds + ' |']),
      '| any (first after idle) | idle | ' + plan.rounds + ' |',
    ]
    const failed = report.runs.filter((run) => run.phases.status >= limits.cold.failing).length
    if (failed) lines.push(failed + ' failed: ')
    for (const line of lines) if (!table.includes(line)) check.fail('cold table', 'the table lacks ' + line)
    return report.runs.length
  } finally {
    server.closeAllConnections()
    server.close()
  }
}

async function cold(seed: string): Promise<Outcome> {
  const random = rng(seed, 'web_cold')
  const check = recorder()
  const E = await load<typeof EndpointsModule>('test/e2e/endpoints.ts')
  applied()
  const fixture: Plan = {
    idle: 60,
    ray: 'ray-1',
    rounds: 2,
    routes: ['/', '/v1/health', '/x/card.svg'],
    samples: 3,
    settle: false,
    statuses: { '/': 200, '/v1/health': 200, '/x/card.svg': 200 },
    total: 12,
  }
  const routes = random
    .shuffle([
      '/',
      '/v1/health',
      '/x/card.svg',
      '/api/config',
      '/v1/swarms',
      '/s/' + hex(random),
      '/v1/swarms/' + hex(random),
      '/v1/swarms?status=' + word(random, limits.short),
    ])
    .slice(0, random.int(limits.cold.routesLeast, limits.cold.routesMost))
  const drawn: Plan = {
    idle: random.int(1, limits.cold.idleMost),
    ray: 'ray-' + hex(random, limits.short),
    rounds: random.int(limits.cold.roundsLeast, limits.cold.roundsMost),
    routes,
    samples: random.int(1, limits.cold.samplesMost),
    settle: true,
    statuses: Object.fromEntries(routes.map((route) => [route, random.pick(limits.cold.statuses)])),
    total: random.int(1, limits.cold.serverMost),
  }
  const steps = (await coldPlan(E, random, check, fixture)) + (await coldPlan(E, random, check, drawn))
  return { steps, violations: check.violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  web_cold: cold,
}

const all = ['1', '2', '3']

function canary(name: string, file: string, from: string, to: string, invariant: string, scenario: string, seeds = all): Canary {
  return { flip: mutant(name, file, from, to), invariant, name, scenario, seeds }
}

export const canaries: Canary[] = [
  canary('web.cold.order', 'test/e2e/endpoints.ts', 'routes[(index + round) % routes.length]', 'routes[index % routes.length]', 'cold runs', 'web_cold'),
  canary('web.cold.pause', 'test/e2e/endpoints.ts', 'await pause(idle * 1000)', 'await pause(idle)', 'cold pause', 'web_cold'),
  canary(
    'web.cold.reuse',
    'test/e2e/endpoints.ts',
    "{ agent: false, headers: { accept: '*/*', connection: 'close',",
    "{ agent: client.globalAgent, headers: { accept: '*/*', connection: 'keep-alive',",
    'cold fresh connection',
    'web_cold',
  ),
  canary(
    'web.cold.server',
    'test/e2e/endpoints.ts',
    '        const total = /(?:^|,\\s*)total;dur=',
    '        const total = /(?:^|,\\s*)viewed;dur=',
    'cold phases',
    'web_cold',
  ),
  canary(
    'web.cold.first',
    'test/e2e/endpoints.ts',
    "row('any (first after idle)', 'idle', report.runs.filter((run) => run.first))",
    "row('any (first after idle)', 'idle', report.runs.filter((run) => run.mode === 'idle'))",
    'cold table',
    'web_cold',
  ),
]
