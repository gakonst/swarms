import { AsyncLocalStorage } from 'node:async_hooks'
import { assert } from '../shared/Assert.ts'
import * as Limits from '../shared/Limits.ts'
import * as Telemetry from './Telemetry.ts'

type Spans = Map<string, { count: number; ms: number }>

type Current = { context: Telemetry.Context; spans: Spans; start: number }

const store = new AsyncLocalStorage<Current>()

let warm = false

export function run<T>(work: () => T, parent?: string | null) {
  return store.run({ context: Telemetry.start(parent), spans: new Map(), start: Date.now() }, work)
}

function add(current: Current, name: string, count: number, ms: number) {
  const spent = current.spans.get(name)
  if (!spent && current.spans.size >= Limits.Telemetry.spans) return
  current.spans.set(name, { count: (spent?.count ?? 0) + count, ms: (spent?.ms ?? 0) + ms })
}

export async function span<T>(name: string, work: Promise<T>): Promise<T> {
  const current = store.getStore()
  if (!current) return work
  const started = Date.now()
  try {
    return await work
  } finally {
    add(current, name, 1, Date.now() - started)
  }
}

export function traceparent() {
  const current = store.getStore()
  return current ? Telemetry.child(current.context) : undefined
}

export function traced(request: Request) {
  const parent = traceparent()
  if (!parent) return request
  const forwarded = new Request(request)
  forwarded.headers.set(Telemetry.header, parent)
  return forwarded
}

export function spans(): Telemetry.Span[] {
  const current = store.getStore()
  return current ? [...current.spans].map(([name, spent]) => ({ count: spent.count, ms: spent.ms, name })) : []
}

export function report(worker: string, name: string, status: number) {
  const current = store.getStore()
  if (current) Telemetry.report(current.context, worker, name, status, Date.now() - current.start, spans())
}

export function label(path: string) {
  return path
    .split('?')[0]!
    .split('/')
    .filter(Boolean)
    .map((segment) => (/\d/.test(segment) ? 'x' : segment.replace(/[^A-Za-z]/g, '')))
    .join('.')
}

export function header() {
  const current = store.getStore()
  if (!current) return undefined
  const parts = [...current.spans].map(([name, spent]) => `${name};dur=${spent.ms};desc="${spent.count}"`)
  const isolate = warm ? [] : ['isolate;desc="cold"']
  warm = true
  return [...parts, ...isolate, `total;dur=${Date.now() - current.start}`, `trace;desc="${current.context.trace}"`].join(', ')
}

type Served = { meta?: { served_by_primary?: boolean; served_by_region?: string } }

function where(result: Served | readonly Served[] | undefined) {
  const meta = (Array.isArray(result) ? (result as readonly Served[])[0] : (result as Served | undefined))?.meta
  if (!meta) return 'd1'
  return meta.served_by_primary ? 'd1.primary' : `d1.${(meta.served_by_region ?? 'replica').toLowerCase()}`
}

async function query<T>(work: Promise<T>, located: boolean): Promise<T> {
  const current = store.getStore()
  if (!current) return work
  const started = Date.now()
  let name = 'd1'
  try {
    const result = await work
    if (located) name = where(result as Served | readonly Served[])
    return result
  } finally {
    add(current, name, 1, Date.now() - started)
  }
}

function statement(prepared: D1PreparedStatement): D1PreparedStatement {
  const bind = prepared.bind.bind(prepared)
  const first = prepared.first.bind(prepared)
  const all = prepared.all.bind(prepared)
  const run = prepared.run.bind(prepared)
  const raw = prepared.raw.bind(prepared)
  return Object.assign(prepared, {
    all: (() => query(all(), true)) as typeof prepared.all,
    bind: ((...values: unknown[]) => statement(bind(...values))) as typeof prepared.bind,
    first: ((column?: string) => query(column === undefined ? first() : first(column), false)) as typeof prepared.first,
    raw: ((options?: { columnNames?: boolean }) => query(raw(options as never), false)) as typeof prepared.raw,
    run: (() => query(run(), true)) as typeof prepared.run,
  })
}

export function database<T extends D1Database | D1DatabaseSession>(db: T): T {
  const prepare = db.prepare.bind(db)
  const batch = db.batch.bind(db)
  const wrapped = Object.create(db) as T
  return Object.assign(wrapped, {
    batch: ((statements: D1PreparedStatement[]) => query(batch(statements), true)) as T['batch'],
    prepare: ((query: string) => statement(prepare(query))) as T['prepare'],
    ...('withSession' in db ? { withSession: (constraint?: string) => database((db as D1Database).withSession(constraint as never)) } : {}),
    ...('getBookmark' in db ? { getBookmark: () => (db as D1DatabaseSession).getBookmark() } : {}),
    ...('dump' in db ? { dump: () => (db as D1Database).dump(), exec: (query: string) => (db as D1Database).exec(query) } : {}),
  })
}

const direct: ReadonlySet<string> = new Set(['alarm', 'connect', 'fetch', 'traced', 'webSocketClose', 'webSocketError', 'webSocketMessage'])

export type Reply = { spans: Telemetry.Span[]; v: 1; value: unknown }

function older(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /does not implement the method/i.test(message) && message.includes('traced')
}

function replied(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && (value as { v?: unknown }).v === 1 && Array.isArray((value as { spans?: unknown }).spans) && 'value' in value
}

function method(target: object, name: string) {
  for (let at: object | null = Object.getPrototypeOf(target) as object | null; at && at !== Object.prototype; at = Object.getPrototypeOf(at) as object | null) {
    const found = Object.getOwnPropertyDescriptor(at, name)
    if (found) return typeof found.value === 'function' ? (found.value as (...args: unknown[]) => unknown) : undefined
  }
  return undefined
}

export async function serve(target: object, parent: string, name: string, args: unknown[], worker: string): Promise<Reply> {
  assert(typeof name === 'string' && !direct.has(name) && !name.startsWith('_'), 'a traced call names an RPC method', name)
  assert(Array.isArray(args), 'a traced call passes its arguments as a list', name)
  const work = method(target, name)
  assert(work, 'a traced call names a method of the Durable Object', name)
  return run(async () => {
    let status: number = Limits.Telemetry.failedStatus
    try {
      const value = await Reflect.apply(work, target, args)
      status = Limits.Telemetry.okStatus
      return { spans: spans(), v: 1 as const, value }
    } finally {
      report(worker, name, status)
    }
  }, parent)
}

export function object<T extends object>(stub: T, label = 'do'): T {
  return new Proxy(stub, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown
      if (typeof value !== 'function' || typeof property !== 'string') return value
      return (...args: unknown[]) => {
        const current = store.getStore()
        const remote = Reflect.get(target, 'traced') as unknown
        if (current && !direct.has(property) && typeof remote === 'function') {
          const name = label + '.' + property
          const parent = Telemetry.child(current.context)
          const answered = Promise.resolve(Reflect.apply(remote as (...args: unknown[]) => unknown, target, [parent, property, args])).then(
            (reply: unknown) => {
              assert(replied(reply), 'a traced call answers its value and spans', property)
              for (const each of reply.spans) add(current, name + '.' + each.name, each.count, each.ms)
              return reply.value
            },
            (error: unknown) => {
              if (!older(error)) throw error
              return Reflect.apply(value as (...args: unknown[]) => unknown, target, args)
            },
          )
          return span(name, answered)
        }
        const result = Reflect.apply(value as (...args: unknown[]) => unknown, target, args) as unknown
        return result instanceof Promise || (result && typeof (result as { then?: unknown }).then === 'function') ? span(label + '.' + property, Promise.resolve(result)) : result
      }
    },
  })
}
