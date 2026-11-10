import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import type * as SwarmModule from '../src/worker/Swarm.ts'
import type * as StoreModule from '../src/worker/Store.ts'
import { open } from './d1.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers'
      ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env } }' }
      : next(specifier, context),
})

const globals = globalThis as Record<string, unknown>
globals['WebSocketRequestResponsePair'] = class {}
globals['caches'] = { default: { match: async () => undefined, put: async () => undefined } }

const { Swarm }: typeof SwarmModule = await import('../src/worker/Swarm.ts')
const Store: typeof StoreModule = await import('../src/worker/Store.ts')

const timeout = setTimeout
const clock = Date.now
let now = clock()

export const id = 'abc123abc123'

export const rider = ('0x' + 'a'.repeat(40)) as `0x${string}`

export type Route = (request: Request, url: URL) => Response | Promise<Response> | undefined

function storage() {
  const db = new DatabaseSync(':memory:')
  const kv = new Map<string, unknown>()
  let alarm: number | null = null
  const sql = {
    exec(query: string, ...values: unknown[]) {
      const statement = db.prepare(query)
      const rows = statement.columns().length ? statement.all(...(values as never[])).map((row) => ({ ...row })) : (statement.run(...(values as never[])), [])
      return { one: () => rows[0], toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }
    },
  }
  return {
    alarm: () => alarm,
    rung: () => void (alarm = null),
    storage: {
      deleteAlarm: async () => void (alarm = null),
      getAlarm: async () => alarm,
      kv: {
        delete: (key: string) => kv.delete(key),
        get: (key: string) => (kv.has(key) ? structuredClone(kv.get(key)) : undefined),
        list: ({ prefix = '' }: { prefix?: string } = {}) => [...kv].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])[Symbol.iterator](),
        put: (key: string, value: unknown) => void kv.set(key, structuredClone(value)),
      },
      setAlarm: async (at: number) => void (alarm = at),
      sql,
    },
  }
}

export function world(route: Route) {
  const d1 = open()
  const calls: string[] = []
  const store = storage()
  const waits: Promise<unknown>[] = []
  now = clock()
  Date.now = () => now
  globalThis.setTimeout = ((work: () => void, ms?: number) => timeout(work, ms === 3_000 ? 0 : ms)) as typeof setTimeout
  const env = {
    DB: d1.env.DB,
    GATEWAY: {
      fetch: async (request: Request) => {
        const url = new URL(request.url)
        calls.push(request.method + ' ' + url.pathname + url.search)
        const answered = await route(request, url)
        if (answered) return answered
        if (url.pathname === '/api/keys/credit') return Response.json({ deposited: '1', left: '1', spent: '0' })
        if (url.pathname === '/api/keys/backings') return Response.json({ backings: [], left: '0', spent: '0' })
        if (url.pathname === '/v1/hands') return Response.json({ hands: [] })
        if (url.pathname.startsWith('/p/')) return Response.json({ repos: [] })
        if (url.pathname.endsWith('/subagents')) return Response.json({ agents: [] })
        if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_1' })
        if (url.pathname === '/v1/agents/agt_1/turns' && request.method === 'POST') return Response.json({ request_id: 'agt_1:1', status: 'queued' })
        if (url.pathname === '/v1/agents/agt_1/events' && url.searchParams.get('live') === '1') return new Response('down', { status: 500 })
        if (url.pathname === '/v1/agents/agt_1/events') return Response.json({ events: [], has_more: false, next_cursor: 0 })
        if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json({ request_id: 'agt_1:1', status: 'running' })
        return Response.json({ error: 'not here' }, { status: 404 })
      },
    },
    GATEWAY_URL: 'https://gateway.test',
    LOBBY: { getByName: () => ({ changed: async () => undefined }) },
    SWARMS_GATEWAY_KEY: 'test',
    SWARMS_URL: 'https://swarms.test',
  } as unknown as Cloudflare.Env
  const ctx = {
    acceptWebSocket: () => undefined,
    getTags: () => [],
    getWebSockets: () => [],
    setWebSocketAutoResponse: () => undefined,
    storage: store.storage,
    waitUntil: (work: Promise<unknown>) => void waits.push(work.catch(() => undefined)),
  }
  const swarm = new Swarm(ctx as never, env)
  return {
    alarm: store.alarm,
    calls,
    env,
    errors: () => store.storage.sql.exec("SELECT text FROM feed WHERE kind = 'error'").toArray().map((row) => String(row['text'])),
    async give(amount: string, hash = '0x' + 'b'.repeat(64)) {
      await Store.give(env, { amount, channel: null, contributor: rider, id: hash, note: null, note_id: null, swarm: id, token: 'pathusd' })
    },
    pass(ms: number) {
      now += ms
    },
    async seed(amount = '1000000') {
      await Store.insert(env, { creator: null, goal: 'g', id, problem: null, setup: null, steering: 'open', title: 'Test swarm' })
      if (amount !== '0') await this.give(amount)
      swarm.kv.put('id', id)
    },
    sql: store.storage.sql,
    async status() {
      return (await env.DB.prepare('select status, why from swarms where id = ?').bind(id).first()) as { status: string; why: string | null }
    },
    swarm,
    async viewed() {
      swarm.view({ feed: 0 })
      await Promise.all(waits.splice(0))
    },
    async ring() {
      store.rung()
      await swarm.alarm()
    },
    restore() {
      Date.now = clock
      globalThis.setTimeout = timeout
    },
  }
}
