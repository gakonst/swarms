import { EventEmitter } from 'node:events'
import { fileURLToPath } from 'node:url'
import type * as M1 from '../e2e/endpoints.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function entry(seed: string): Promise<Outcome> {
  const random = rng('entry', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const Endpoints = await load<typeof M1>('test/e2e/endpoints.ts')
  const file = fileURLToPath(new URL('../e2e/endpoints.ts', import.meta.url).href)
  const url = new URL('../e2e/endpoints.ts', import.meta.url).href
  const swarm = 'abc123abc123'

  function answer(path: string) {
    if (path === '/openapi.json') return { paths: {} }
    if (path === '/v1/swarms') return { funders: {}, swarms: [{ form: 'agent', id: swarm, nickname: null, status: 'paused' }] }
    return { artifacts: [], branches: [], commands: [], machines: [], messages: [], nodes: [] }
  }

  async function swept(root: string) {
    const fetched = globalThis.fetch
    const socket = globalThis.WebSocket
    globalThis.fetch = (async (input: string | URL | Request) => {
      const at = new URL(String(input instanceof Request ? input.url : input))
      return Response.json(answer(at.pathname))
    }) as typeof fetch
    globalThis.WebSocket = class {
      listeners = new Map<string, () => void>()
      constructor() {
        setTimeout(() => this.listeners.get('error')?.(), 0)
      }
      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, listener)
      }
      close() {}
    } as unknown as typeof WebSocket
    try {
      return await Endpoints.run({ root, samples: 1, token: '' })
    } finally {
      globalThis.fetch = fetched
      globalThis.WebSocket = socket
    }
  }

  function stream(error: Error | null) {
    const out = new EventEmitter() as EventEmitter & { written: string }
    out.written = ''
    return Object.assign(out, {
      write(text: string, done: (error?: Error | null) => void) {
        if (!error) out.written += text
        queueMicrotask(() => {
          if (error) out.emit('error', error)
          done(error)
        })
        return !error
      },
    }) as unknown as NodeJS.WritableStream & { written: string }
  }

  async function reported(text: string, failed: boolean, error: Error | null) {
    const code = process.exitCode
    const write = process.stderr.write
    let told = ''
    process.stderr.write = ((chunk: string) => ((told += chunk), true)) as typeof process.stderr.write
    const out = stream(error)
    try {
      Endpoints.report(text, failed, out)
      await new Promise<void>((done) => setTimeout(done, 0))
      return { code: process.exitCode, out: out.written, told }
    } finally {
      process.stderr.write = write
      process.exitCode = code
    }
  }

  applied()
  const cases: [string, () => Promise<void> | void][] = [
    [
      'the sweep prints its summary line and exits 1 when a route fails',
      async () => {
        const root = 'http://127.0.0.1:' + random.int(1024, 65535)
        const done = await swept(root)
        const text = Endpoints.summary(done)
        a.match(text, new RegExp('^# ' + root.replace(/[.]/g, '\\.') + ' \\(' + swarm + '\\)', 'm'))
        const line = /^(\d+) routes, (\d+) failed, \d+ over 300 ms\. Wall p50 \d+ ms/m.exec(text)
        a.ok(line, 'no summary line in ' + JSON.stringify(text.slice(-300)))
        const failed = Endpoints.stats(done.rows).failed
        a.ok(failed > 0 && failed <= done.rows.length, failed + ' of ' + done.rows.length + ' failed')
        const printed = await reported(text, failed > 0, null)
        a.equal(printed.code, 1)
        a.equal(printed.out, text + '\n')
        a.equal((await reported(text, false, null)).code, 0)
      },
    ],
    [
      'a sweep whose report cannot be written exits 1 instead of 0 with nothing printed',
      async () => {
        const full = Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
        for (const failed of [false, true]) {
          const printed = await reported('report', failed, full)
          a.equal(printed.code, 1, 'failed ' + failed)
          a.match(printed.told, /could not write the report: ENOSPC/)
          a.equal(printed.told.split('\n').filter(Boolean).length, 1, 'told once')
        }
      },
    ],
    [
      'the entry runs on a node without import.meta.main only when it is argv[1]',
      () => {
        a.equal(Endpoints.entry({ main: true, url }, []), true)
        a.equal(Endpoints.entry({ main: false, url }, ['node', file]), false)
        a.equal(Endpoints.entry({ url }, ['node', file]), true)
        a.equal(Endpoints.entry({ url }, ['node', fileURLToPath(import.meta.url)]), false)
        a.equal(Endpoints.entry({ url }, ['node']), false)
      },
    ],
    [
      'on production the sweep also reads the two-Worker layout at each Worker, and only reads',
      () => {
        a.equal(Endpoints.production('https://swarms.new'), true)
        a.equal(Endpoints.production('https://paradigm.xyz/swarms'), true)
        a.equal(Endpoints.production('http://127.0.0.1:5620'), false)
        a.equal(Endpoints.production('not a url'), false)
        const probes = Endpoints.layout('https://swarms.new', { swarm })
        a.deepEqual(
          probes.filter((each) => Endpoints.mutating.has(each.probe.method)),
          [],
        )
        const seen = probes.map((each) => each.root + ' ' + each.probe.method + ' ' + each.probe.path)
        for (const want of [
          'https://swarms.new HEAD /og/about/card.png',
          'https://swarms.new GET /v1/auth/challenge',
          Endpoints.hosts.objects + ' GET /og/about/card.png',
          Endpoints.hosts.objects + ' GET /v1/swarms/' + swarm,
          Endpoints.hosts.objects + ' GET /docs',
          Endpoints.hosts.proxy + ' GET /docs',
          Endpoints.hosts.site + ' GET /og/about/card.png',
          Endpoints.hosts.site + ' GET /v1/auth/challenge',
        ])
          a.ok(seen.includes(want), want)
      },
    ],
  ]
  for (const [name, run] of [...cases].sort(() => random.next() - 0.5)) {
    a.as(name)
    try {
      await run()
    } catch (error) {
      fail(name, String((error as Error)?.stack ?? error).slice(0, 400))
    }
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { entry }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('entry.exit', 'test/e2e/endpoints.ts', '  process.exitCode = failed ? 1 : 0\n', '  process.exitCode = 0\n'),
    invariant: 'the sweep prints its summary line and exits 1 when a route fails',
    name: 'entry.exit',
    scenario: 'entry',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'entry.lost',
      'test/e2e/endpoints.ts',
      '  const lost = (error: Error) => {\n    process.exitCode = 1\n',
      '  const lost = (error: Error) => {\n',
    ),
    invariant: 'a sweep whose report cannot be written exits 1 instead of 0 with nothing printed',
    name: 'entry.lost',
    scenario: 'entry',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('entry.once', 'test/e2e/endpoints.ts', '    if (told) return\n', ''),
    invariant: 'a sweep whose report cannot be written exits 1 instead of 0 with nothing printed',
    name: 'entry.once',
    scenario: 'entry',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('entry.main', 'test/e2e/endpoints.ts', "  if (typeof meta.main === 'boolean') return meta.main\n", ''),
    invariant: 'the entry runs on a node without import.meta.main only when it is argv[1]',
    name: 'entry.main',
    scenario: 'entry',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'entry.argv',
      'test/e2e/endpoints.ts',
      '    return realpathSync(argv[1]) === realpathSync(fileURLToPath(meta.url))',
      "    return realpathSync(argv[1]) !== ''",
    ),
    invariant: 'the entry runs on a node without import.meta.main only when it is argv[1]',
    name: 'entry.argv',
    scenario: 'entry',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'entry.reads',
      'test/e2e/endpoints.ts',
      "  const auth: Probe = { kind: 'json', method: 'GET', path: '/v1/auth/challenge', status: [404, 405] }",
      "  const auth: Probe = { kind: 'json', method: 'POST', path: '/v1/auth/challenge', status: [404, 405] }",
    ),
    invariant: 'on production the sweep also reads the two-Worker layout at each Worker, and only reads',
    name: 'entry.reads',
    scenario: 'entry',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'entry.production',
      'test/e2e/endpoints.ts',
      '    return productionHosts.has(new URL(root).hostname)',
      "    return productionHosts.has(new URL(root).host + '.')",
    ),
    invariant: 'on production the sweep also reads the two-Worker layout at each Worker, and only reads',
    name: 'entry.production',
    scenario: 'entry',
    seeds: ['1', '2', '3'],
  },
]
