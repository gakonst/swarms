import { DatabaseSync } from 'node:sqlite'

// An in-memory SQLite shaped like a Durable Object's `ctx.storage.sql`.
export function memorySql() {
  const db = new DatabaseSync(':memory:')
  return {
    exec(query: string, ...values: unknown[]) {
      const statement = db.prepare(query)
      const rows = statement.columns().length ? statement.all(...(values as never[])).map((row) => ({ ...row })) : (statement.run(...(values as never[])), [])
      return { one: () => rows[0], toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }
    },
  } as never as SqlStorage
}
