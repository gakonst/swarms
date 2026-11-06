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

function statement(prepared: D1PreparedStatement): D1PreparedStatement {
  const bind = prepared.bind.bind(prepared)
  const first = prepared.first.bind(prepared)
  const all = prepared.all.bind(prepared)
  const run = prepared.run.bind(prepared)
  const raw = prepared.raw.bind(prepared)
  return Object.assign(prepared, {
    all: (() => span('d1', all())) as typeof prepared.all,
    bind: ((...values: unknown[]) => statement(bind(...values))) as typeof prepared.bind,
    first: ((column?: string) => span('d1', column === undefined ? first() : first(column))) as typeof prepared.first,
    raw: ((options?: { columnNames?: boolean }) => span('d1', raw(options as never))) as typeof prepared.raw,
    run: (() => span('d1', run())) as typeof prepared.run,
  })
}

export function database<T extends D1Database | D1DatabaseSession>(db: T): T {
  const prepare = db.prepare.bind(db)
  const batch = db.batch.bind(db)
  const wrapped = Object.create(db) as T
  return Object.assign(wrapped, {
    batch: ((statements: D1PreparedStatement[]) => span('d1', batch(statements))) as T['batch'],
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
