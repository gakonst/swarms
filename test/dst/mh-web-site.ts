import { registerHooks } from 'node:module'
import type * as SiteModule from '../../src/worker/site.ts'
import type * as D1Module from '../d1.ts'
import { applied, type Canary, load, mutant, type Outcome, pin, recorder, type Rng, rng } from './mh-kit.ts'

export const limits = {
  chance: 0.5,
  id: 12,
  short: 4,
  site: { assets: 4, ids: 3, pages: 6, queries: 3, redirects: 8, sockets: 8 },
}

const digits = '0123456789abcdef'

const letters = 'abcdefghijklmnopqrstuvwxyz'

function word(random: Rng, length: number, from = letters) {
  return Array.from({ length }, () => random.pick([...from])).join('')
}

function hex(random: Rng, length = limits.id) {
  return word(random, length, digits)
}

const hooked = { done: false }

function siteHooks() {
  if (hooked.done) return
  hooked.done = true
  const site = new URL('../../src/shared/Site.ts', import.meta.url).href
  const modules: Record<string, string> = {
    'cloudflare:workers':
      'export const waitUntil = () => {}; export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }; export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env } }',
    '#ssr':
      'import * as Site from ' +
      JSON.stringify(site) +
      "; export async function render() { return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('<a href=\"' + Site.at('/faq') + '\">faq</a>')); controller.close() } }) }",
  }
  registerHooks({
    resolve: (specifier, context, next) => {
      const source =
        modules[specifier] ??
        ((context.parentURL ?? '').includes('/src/worker/Og.ts') && /\.(wasm|bin)$/.test(specifier) ? 'export default new ArrayBuffer(0)' : undefined)
      return source === undefined ? next(specifier, context) : { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent(source) }
    },
  })
  Object.assign(globalThis, { WebSocketRequestResponsePair: class {}, caches: { default: { match: async () => undefined, put: async () => undefined } } })
}

const workers = 'swarms.tempo-dev.workers.dev'

const paradigm = 'https://paradigm.xyz/swarms'

const shown = ['/', '/faq', '/ideas', '/about', '/docs', '/new']

async function site(seed: string): Promise<Outcome> {
  const random = rng(seed, 'web_site')
  const check = recorder()
  const unpin = pin(random)
  siteHooks()
  let steps = 0
  try {
    await load('test/host.ts')
    const { open } = await load<typeof D1Module>('test/d1.ts')
    const worker = (await load<typeof SiteModule>('src/worker/site.ts')).default
    applied()
    const d1 = open()
    const rooms = ['abc123abc123', ...Array.from({ length: random.int(1, limits.site.ids) }, () => hex(random))]
    for (const room of rooms)
      d1.sqlite.prepare('insert into swarms (id, title, goal, created_at, updated_at) values (?, ?, ?, 1, 1)').run(room, 'T ' + room, 'G ' + room)
    const db = d1.env.DB as unknown as Record<string, unknown>
    db['withSession'] = () => db
    const assets: string[] = []
    const opened: { at: string; url: string }[] = []
    const answer = (at: string) => ({ fetch: async (request: Request) => (opened.push({ at, url: request.url }), { at, upgraded: true }) })
    const env = {
      ...d1.env,
      ASSETS: {
        fetch: async (request: Request) => {
          const url = new URL(request.url)
          assets.push(url.host + url.pathname)
          return url.pathname === '/index.html'
            ? new Response('<html><head><title>x</title></head><body><div id="root"></div></body></html>')
            : url.pathname.startsWith('/assets/')
              ? new Response('asset')
              : new Response(null, { status: 404 })
        },
      },
      GATEWAY: { fetch: async () => Response.json({ code: 'not_found' }, { status: 404 }) },
      GATEWAY_URL: 'https://gateway.test',
      LOBBY: { getByName: (name: string) => answer(name) },
      SWARMS: { get: (id: string) => answer(id), idFromName: (name: string) => 'room:' + name },
      SWARMS_URL: paradigm,
    } as never
    const context = { passThroughOnException() {}, props: {}, waitUntil() {} } as never
    const get = (url: string, headers: Record<string, string>) => worker.fetch(new Request(url, { headers }), env, context) as unknown as Promise<unknown>
    const html = () => random.pick(['text/html', 'text/html,application/xhtml+xml', '*/*', ''])
    const query = () =>
      random.chance(limits.chance)
        ? ''
        : '?' + Array.from({ length: random.int(1, limits.site.queries) }, () => word(random, limits.short) + '=' + hex(random, limits.short)).join('&')
    const paged = () =>
      random.pick([
        ...shown,
        '/s/' + hex(random),
        '/s/' + hex(random) + '/chat',
        '/pequalsnp/chat',
        '/u/' + word(random, limits.short),
        '/me',
        '/x/s/' + hex(random),
      ])
    const cases: (() => Promise<void>)[] = []
    const status = (got: unknown) => (got instanceof Response ? got.status : JSON.stringify(got))
    const moved = (invariant: string, url: string, headers: Record<string, string>, location: string) => async () => {
      const got = await get(url, headers)
      check.same(invariant, url + ' ' + JSON.stringify(headers), [status(got), got instanceof Response ? got.headers.get('location') : null], [301, location])
    }
    const page = (url: string, headers: Record<string, string>, base: string, home: string, path: string) => async () => {
      const got = await get(url, headers)
      const invariant = base === '' ? 'root pages' : 'proxied pages'
      if (!(got instanceof Response) || got.status !== 200) return check.fail(invariant, url + ' answered ' + status(got))
      const text = await got.text()
      const wants = [
        '<a href="' + base + '/faq">faq</a>',
        '"base":"' + base + '"',
        '"site":"' + home + '"',
        ...(path === '/' ? [] : ['<link rel="canonical" href="' + home + path + '">']),
      ]
      if (base === '') wants.push('"socket":"wss://swarms.new"')
      for (const want of wants) if (!text.includes(want)) check.fail(invariant, url + ' lacks ' + want)
    }
    const asset = (url: string, headers: Record<string, string>, held: string) => async () => {
      assets.length = 0
      const got = await get(url, headers)
      check.same('assets', url, [got instanceof Response ? await got.text() : status(got), [...assets]], ['asset', [held]])
    }
    const socket = (url: string, at: string, room?: string) => async () => {
      const got = await get(url, { upgrade: random.pick(['websocket', 'WebSocket']) })
      check.same('socket untouched', url, got, { at, upgraded: true })
      if (room !== undefined) check.same('room opened', url, opened.at(-1)?.url, room)
    }
    const missing = (url: string) => async () => {
      const before = opened.length
      const got = await get(url, { upgrade: 'websocket' })
      check.same('missing room', url, [status(got), opened.length], [404, before])
    }
    const plain = (url: string) => async () => {
      const got = await get(url, random.chance(limits.chance) ? {} : { accept: '*/*' })
      check.same('plain socket route', url, status(got), 400)
    }
    cases.push(
      page('https://swarms.new/faq', { accept: 'text/html' }, '', 'https://swarms.new', '/faq'),
      page('https://' + workers + '/swarms/faq', { accept: 'text/html', 'cf-worker': 'paradigm.xyz' }, '/swarms', paradigm, '/faq'),
      moved('www moved', 'https://www.swarms.new/faq?x=1', { accept: 'text/html' }, 'https://swarms.new/faq?x=1'),
      moved('stray moved', 'https://swarms.new/swarms/pequalsnp/chat?x=1', { accept: 'text/html' }, '/pequalsnp/chat?x=1'),
      moved('stray moved', 'https://swarms.new/swarms', { accept: 'text/html' }, '/'),
      moved('proxied moved', 'https://' + workers + '/faq', { accept: 'text/html' }, paradigm + '/faq'),
      moved('stray moved', 'https://' + workers + '/faq', { accept: 'text/html', 'cf-worker': 'paradigm.xyz' }, '/swarms/faq'),
      asset('https://swarms.new/swarms/assets/a.js', { accept: '*/*' }, 'swarms.new/assets/a.js'),
      asset('https://swarms.new/assets/a.js', { accept: '*/*' }, 'swarms.new/assets/a.js'),
      asset('https://' + workers + '/swarms/assets/a.js', { accept: '*/*' }, workers + '/assets/a.js'),
      socket('https://swarms.new/v1/swarms/live', 'lobby'),
      socket('https://' + workers + '/swarms/api/swarms/live', 'lobby'),
      socket('https://swarms.new/api/general/chat/live', 'general'),
      socket('https://swarms.new/v1/swarms/abc123abc123/chat/live?listen=1', 'room:abc123abc123', 'https://swarm/chat?swarm=abc123abc123&listen=1'),
      missing('https://swarms.new/v1/swarms/nope00000000/chat/live'),
      plain('https://swarms.new/v1/swarms/live'),
    )
    for (let i = 0; i < limits.site.pages; i++) {
      const path = random.pick(shown)
      if (random.chance(limits.chance)) cases.push(page('https://swarms.new' + path, { accept: html() }, '', 'https://swarms.new', path))
      else
        cases.push(
          page(
            'https://' + workers + '/swarms' + (path === '/' ? random.pick(['', '/']) : path),
            { accept: html(), 'cf-worker': random.pick(['paradigm.xyz', 'x']) },
            '/swarms',
            paradigm,
            path,
          ),
        )
    }
    for (let i = 0; i < limits.site.redirects; i++) {
      const path = paged()
      const search = query()
      const shape = random.pick(['www', 'legacy', 'bare', 'based', 'forwarded'] as const)
      if (shape === 'www') {
        const any = random.pick([path, '/assets/' + hex(random, limits.short) + '.js', '/v1/swarms/' + hex(random)])
        cases.push(
          moved(
            'www moved',
            'https://www.swarms.new' + any + search,
            { accept: random.pick(['text/html', '*/*', 'application/json']) },
            'https://swarms.new' + any + search,
          ),
        )
      }
      if (shape === 'legacy')
        cases.push(moved('stray moved', 'https://swarms.new/swarms' + (path === '/' ? '' : path) + search, { accept: html() }, path + search))
      if (shape === 'bare') cases.push(moved('proxied moved', 'https://' + workers + path + search, { accept: html() }, paradigm + path + search))
      if (shape === 'based') cases.push(moved('proxied moved', 'https://' + workers + '/swarms' + path + search, { accept: html() }, paradigm + path + search))
      if (shape === 'forwarded')
        cases.push(moved('stray moved', 'https://' + workers + path + search, { accept: html(), 'cf-worker': 'paradigm.xyz' }, '/swarms' + path + search))
    }
    for (let i = 0; i < limits.site.assets; i++) {
      const name = hex(random, limits.short) + random.pick(['.js', '.css', '.woff2'])
      const [host, prefix] = random.pick([
        ['swarms.new', '/swarms'],
        ['swarms.new', ''],
        [workers, '/swarms'],
        [workers, ''],
      ] as const)
      cases.push(
        asset(
          'https://' + host + prefix + '/assets/' + name,
          { accept: '*/*', ...(random.chance(limits.chance) ? { 'cf-worker': 'paradigm.xyz' } : {}) },
          host + '/assets/' + name,
        ),
      )
    }
    for (let i = 0; i < limits.site.sockets; i++) {
      const [host, prefix] = random.pick([
        ['https://swarms.new', ''],
        ['https://' + workers, '/swarms'],
      ] as const)
      const api = random.pick(['/v1', '/api'])
      const shape = random.pick(['lobby', 'general', 'room', 'missing', 'plain'] as const)
      if (shape === 'lobby') cases.push(socket(host + prefix + api + '/swarms/live', 'lobby'))
      if (shape === 'general') cases.push(socket(host + prefix + api + '/general/chat/live', 'general'))
      if (shape === 'plain') cases.push(plain(host + prefix + '/v1/swarms/live'))
      if (shape === 'missing') cases.push(missing(host + prefix + api + '/swarms/' + hex(random) + '/chat/live'))
      if (shape === 'room') {
        const room = random.pick(rooms)
        const asked = random.shuffle([
          ...(random.chance(limits.chance) ? ['listen=1'] : []),
          ...(random.chance(limits.chance) ? ['watch=1'] : []),
          ...(random.chance(limits.chance) ? ['other=' + hex(random, limits.short)] : []),
        ])
        const tail = (asked.includes('listen=1') ? '&listen=1' : '') + (asked.includes('watch=1') ? '&watch=1' : '')
        cases.push(
          socket(
            host + prefix + api + '/swarms/' + room + '/chat/live' + (asked.length ? '?' + asked.join('&') : ''),
            'room:' + room,
            'https://swarm/chat?swarm=' + room + tail,
          ),
        )
      }
    }
    for (const run of random.shuffle(cases)) {
      await run()
      steps++
    }
  } finally {
    unpin()
  }
  return { steps, violations: check.violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  web_site: site,
}

const all = ['1', '2', '3']

function canary(name: string, file: string, from: string, to: string, invariant: string, scenario: string, seeds = all): Canary {
  return { flip: mutant(name, file, from, to), invariant, name, scenario, seeds }
}

export const canaries: Canary[] = [
  canary(
    'web.site.www',
    'src/shared/Site.ts',
    'return asked.hostname === \u0060www.${domain}\u0060',
    'return asked.hostname === \u0060ww.${domain}\u0060',
    'www moved',
    'web_site',
  ),
  canary('web.site.root', 'src/shared/Site.ts', "return asked.hostname === domain ? '' : base", 'return base', 'root pages', 'web_site'),
  canary('web.site.stray', 'src/worker/site.ts', 'if (page && stray) return', 'if (page && stray && !page) return', 'stray moved', 'web_site'),
  canary('web.site.forwarded', 'src/worker/site.ts', "!request.headers.has('cf-worker')", "request.method !== ''", 'proxied pages', 'web_site'),
  canary(
    'web.site.away',
    'src/worker/site.ts',
    'new URL(site).origin !== url.origin && ',
    'new URL(site).origin === url.origin && ',
    'proxied moved',
    'web_site',
  ),
  canary('web.site.assets', 'src/worker/site.ts', '  url.pathname = path\n', '', 'assets', 'web_site'),
  canary('web.site.socket', 'src/worker/site.ts', 'if (socket) return socket', 'if (socket && !socket) return socket', 'socket untouched', 'web_site'),
  canary('web.site.listen', 'src/worker/Operations.ts', "asked.get('listen') === '1' ? '&listen=1' : ''", "''", 'room opened', 'web_site'),
  canary(
    'web.site.missing',
    'src/worker/Operations.ts',
    'if (!(await Store.exists(env, parsed.value.swarm))) return missing()\n\n  const asked',
    '\n  const asked',
    'missing room',
    'web_site',
  ),
  canary(
    'web.site.plain',
    'src/worker/Lobby.ts',
    "export function enter(env: Cloudflare.Env, request: Request) {\n  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return",
    'export function enter(env: Cloudflare.Env, request: Request) {\n  if (!request) return',
    'plain socket route',
    'web_site',
  ),
]
