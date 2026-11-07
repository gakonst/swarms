import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

type Value = string | number | bigint | null

export type Logged = { query: string; values: Value[] }

export function open() {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'))
  const log: Logged[] = []

  const execute = (query: string, values: Value[]) => {
    log.push({ query, values })
    const statement = sqlite.prepare(query)
    if (!statement.columns().length) return { meta: { changes: Number(statement.run(...values).changes) }, results: [], success: true }
    const results = statement.all(...values).map((row) => ({ ...row }))
    return { meta: { changes: results.length }, results, success: true }
  }

  const prepare = (query: string, values: Value[] = []): D1PreparedStatement =>
    ({
      all: async () => execute(query, values),
      bind: (...next: Value[]) => prepare(query, next),
      first: async (column?: string) => {
        const row = (execute(query, values).results[0] ?? null) as Record<string, unknown> | null
        return column === undefined ? row : (row?.[column] ?? null)
      },
      run: async () => execute(query, values),
      values,
      query,
    }) as unknown as D1PreparedStatement

  const db = {
    batch: async (statements: D1PreparedStatement[]) => {
      sqlite.exec('begin')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.all())
        sqlite.exec('commit')
        return results
      } catch (error) {
        sqlite.exec('rollback')
        throw error
      }
    },
    prepare: (query: string) => prepare(query),
  } as unknown as D1Database

  const plan = (logged: Logged) =>
    sqlite
      .prepare('explain query plan ' + logged.query)
      .all(...logged.values)
      .map((row) => String((row as { detail: string }).detail))

  return { env: { DB: db } as unknown as Cloudflare.Env, log, plan, sqlite }
}
