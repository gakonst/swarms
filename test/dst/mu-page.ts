import { registerHooks } from 'node:module'
import type * as M1 from '../../src/worker/Page.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

const marker = '/src/worker/Page.ts?page-server'

async function pageServer(seed: string): Promise<Outcome> {
  const random = rng('page-server', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const held = globalThis as unknown as { __pageServerConfig?: () => Promise<unknown> }
  let configured: () => Promise<unknown> = async () => ({ ready: true })
  held.__pageServerConfig = () => configured()

  const modules: Record<string, string> = {
    'cloudflare:workers': 'export const waitUntil = () => {}',
    '#ssr':
      'export async function render() { return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("server content")); controller.close() } }) }',
    './Artifacts.ts': '',
    './Edge.ts': '',
    './Og.ts': '',
    './Operations.ts': 'export const config = () => globalThis.__pageServerConfig()',
    './Share.ts':
      'export const share = () => ({ title: "Swarms", description: "Research" }); export const listing = () => ({}); export const plain = () => ({}); export const tags = () => ""',
    './Store.ts': '',
  }

  registerHooks({
    resolve(specifier, context, next) {
      const source = (context.parentURL ?? '').includes(marker) ? modules[specifier] : undefined
      return source === undefined ? next(specifier, context) : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) }
    },
  })

  const Page = await load<typeof M1>(marker.slice(1))
  const env = {
    ASSETS: { fetch: async () => new Response('<html><head></head><body><div id="root"></div></body></html>') },
    SWARMS_URL: 'https://swarms.test',
  } as never
  const request = (cookie?: string) => new Request('https://swarms.test/docs', cookie ? { headers: { cookie } } : {})
  const html = async (cookie?: string) => (await Page.lost(request(cookie), env)).text()

  applied()
  const cases: [string, () => Promise<void>][] = [
    [
      'a slow configuration read cannot hold the server-rendered page past its data budget',
      async () => {
        const real = { clear: globalThis.clearTimeout, set: globalThis.setTimeout }
        const due: { at: number; id: number; run: () => void }[] = []
        let clock = 0
        let ids = 0
        globalThis.setTimeout = ((run: () => void, ms = 0) => {
          ids += 1
          due.push({ at: clock + ms, id: ids, run })
          return ids
        }) as unknown as typeof setTimeout
        globalThis.clearTimeout = ((id: number) => {
          const at = due.findIndex((one) => one.id === id)
          if (at >= 0) due.splice(at, 1)
        }) as unknown as typeof clearTimeout
        const timers = {
          tick(ms: number) {
            clock += ms
            for (const one of due.filter((each) => each.at <= clock)) {
              due.splice(due.indexOf(one), 1)
              one.run()
            }
          },
        }
        try {
          configured = () => new Promise(() => {})
          const response = await Page.lost(request(), env)
          let text: string | undefined
          void response.text().then((done) => (text = done))
          const settle = async () => {
            for (let round = 0; round < 50 && text === undefined; round++) await new Promise<void>((done) => setImmediate(done))
          }
          const early = random.int(0, 2499)
          timers.tick(early)
          await settle()
          a.equal(text, undefined, 'done ' + early + ' ms in')
          timers.tick(2500 - early)
          await settle()
          a.ok(text !== undefined, 'the page still waits on its configuration at the budget')
          a.match(text ?? '', /server content/)
          a.match(text ?? '', /window\.__SWARMS_BOOT__/)
          a.doesNotMatch(text ?? '', /"config"/)
        } finally {
          globalThis.setTimeout = real.set
          globalThis.clearTimeout = real.clear
        }
      },
    ],
    [
      'a configuration failure still delivers the page for the existing client retry',
      async () => {
        configured = async () => {
          throw new Error('offline')
        }
        const page = await html()
        a.match(page, /server content/)
        a.doesNotMatch(page, /"config"/)
      },
    ],
    [
      'a ready configuration remains in the server-rendered bootstrap',
      async () => {
        configured = async () => ({ ready: true })
        a.match(await html(), /"config":\{"ready":true\}/)
      },
    ],
    [
      'the server renders the problems rail the way this session left it',
      async () => {
        configured = async () => ({ ready: true })
        a.match(await html(random.pick(['swarms_rail=expanded', 'a=1; swarms_rail=expanded'])), /"rail":"expanded"/)
        a.match(await html(), /"rail":"collapsed"/)
      },
    ],
    [
      'the server tells the page whether this visitor has seen the welcome',
      async () => {
        configured = async () => ({ ready: true })
        a.match(await html(), /"hello":"new"/)
        a.match(await html(random.pick(['swarms_hello=1', 'swarms_rail=expanded; swarms_hello=1'])), /"hello":"seen"/)
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { 'page-server': pageServer }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'page-server.budget',
      'src/worker/Page.ts',
      'within(Operations.config(env), Limits.Page.slowMs)',
      'within(Operations.config(env), Limits.Page.slowMs * 10)',
    ),
    invariant: 'a slow configuration read cannot hold the server-rendered page past its data budget',
    name: 'page-server.budget',
    scenario: 'page-server',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('page-server.config', 'src/worker/Page.ts', 'config: await configuring,', 'config: undefined,'),
    invariant: 'a ready configuration remains in the server-rendered bootstrap',
    name: 'page-server.config',
    scenario: 'page-server',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('page-server.rail', 'src/worker/Page.ts', "rail: Rail.parse(request.headers.get('cookie'))", 'rail: Rail.parse(null)'),
    invariant: 'the server renders the problems rail the way this session left it',
    name: 'page-server.rail',
    scenario: 'page-server',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('page-server.hello', 'src/worker/Page.ts', "hello: Hello.parse(request.headers.get('cookie'))", 'hello: Hello.parse(null)'),
    invariant: 'the server tells the page whether this visitor has seen the welcome',
    name: 'page-server.hello',
    scenario: 'page-server',
    seeds: ['1', '2', '3'],
  },
]
