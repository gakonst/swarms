import { AsyncLocalStorage } from 'node:async_hooks'

type Spans = Map<string, { count: number; ms: number }>

const store = new AsyncLocalStorage<{ spans: Spans; start: number }>()

export function run<T>(work: () => T) {
  return store.run({ spans: new Map(), start: Date.now() }, work)
}

export async function span<T>(name: string, work: Promise<T>): Promise<T> {
  const current = store.getStore()
  if (!current) return work
  const started = Date.now()
  try {
    return await work
  } finally {
    const spent = current.spans.get(name) ?? { count: 0, ms: 0 }
    spent.count += 1
    spent.ms += Date.now() - started
    current.spans.set(name, spent)
  }
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
  return [...parts, `total;dur=${Date.now() - current.start}`].join(', ')
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
    const spent = current.spans.get(name) ?? { count: 0, ms: 0 }
    spent.count += 1
    spent.ms += Date.now() - started
    current.spans.set(name, spent)
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

export function object<T extends object>(stub: T, label = 'do'): T {
  return new Proxy(stub, {
    get(target, property) {
      const value = Reflect.get(target, property) as unknown
      if (typeof value !== 'function' || typeof property !== 'string') return value
      return (...args: unknown[]) => {
        const result = Reflect.apply(value as (...args: unknown[]) => unknown, target, args) as unknown
        return result instanceof Promise || (result && typeof (result as { then?: unknown }).then === 'function') ? span(`${label}.${property}`, Promise.resolve(result)) : result
      }
    },
  })
}
