import { DatabaseSync } from 'node:sqlite'
import { applied, load, mutant, pin, recorder, rng, type Canary, type Outcome } from './mh-kit.ts'

type Sessions = typeof import('../../src/worker/Sessions.ts')

type Value = string | number | bigint | null

const limits = { addresses: 6, days: 30, isolatesMost: 4, lagMost: 6, steps: 240, tickMs: 3_600_000 }

const table = 'create table sessions (key text primary key, value text not null, expires_at integer)'

function world() {
  const primary = new DatabaseSync(':memory:')
  const replica = new DatabaseSync(':memory:')
  primary.exec(table)
  replica.exec(table)
  const pending: { query: string; values: Value[] }[] = []
  const execute = (on: DatabaseSync, query: string, values: Value[]) => {
    if (on === primary && !/^select/i.test(query)) pending.push({ query, values })
    const statement = on.prepare(query)
    if (!statement.columns().length) return { meta: { changes: Number(statement.run(...values).changes) }, results: [], success: true }
    return { meta: {}, results: statement.all(...values).map((row) => ({ ...row })), success: true }
  }
  const prepare = (on: DatabaseSync, query: string, values: Value[] = []): D1PreparedStatement =>
    ({
      all: async () => execute(on, query, values),
      bind: (...next: Value[]) => prepare(on, query, next),
      first: async () => execute(on, query, values).results[0] ?? null,
      run: async () => execute(on, query, values),
    }) as unknown as D1PreparedStatement
  const database = (on: DatabaseSync) => ({ prepare: (query: string) => prepare(on, query) })
  const db = {
    ...database(primary),
    batch: async (statements: D1PreparedStatement[]) => {
      const results = []
      for (const statement of statements) results.push(await statement.all())
      return results
    },
    withSession: (constraint?: string) => database(constraint === 'first-unconstrained' ? replica : primary),
  } as unknown as D1Database
  const catchUp = (count: number) => {
    for (const write of pending.splice(0, count)) replica.prepare(write.query).run(...write.values)
  }
  return { catchUp, env: { DB: db } as unknown as Cloudflare.Env, lag: () => pending.length }
}

let flipped = ''

async function isolates(count: number): Promise<Sessions[]> {
  const url = new URL('../../src/worker/Sessions.ts', import.meta.url).href
  if (!flipped) return Promise.all(Array.from({ length: count }, (_, i) => import(url + '?isolate=' + i) as Promise<Sessions>))
  await load<Sessions>('src/worker/Sessions.ts')
  const loaded = await Promise.all(Array.from({ length: count }, (_, i) => import(url + '?mh=' + flipped + '.' + i) as Promise<Sessions>))
  applied()
  return loaded
}

async function sessions(seed: string): Promise<Outcome> {
  const random = rng(seed, 'sessions')
  const { fail, violations } = recorder()
  const unpin = pin(random)
  let clock = Date.now()
  Date.now = () => clock
  try {
    const { catchUp, env, lag } = world()
    const each = await isolates(random.int(2, limits.isolatesMost))
    const tokens = new Map<string, { address: string; expiresAt: number; ended: boolean }>()
    const addresses = Array.from({ length: limits.addresses }, (_, i) => '0x' + String(i + 1).repeat(40))
    const check = async (at: number, token: string, when: string) => {
      const want = tokens.get(token)!
      const got = await each[at]!.holder(env, token)
      if (want.ended && got) fail('revoked everywhere', 'isolate ' + at + ' of ' + each.length + ' answered ' + got + ' for a token ended ' + when)
      else if (!want.ended && want.expiresAt <= clock && got) fail('expired refused', 'isolate ' + at + ' answered ' + got + ' for an expired token')
      else if (!want.ended && want.expiresAt > clock && got !== want.address)
        fail('signed in', 'isolate ' + at + ' answered ' + String(got) + ' for a live token of ' + want.address)
    }
    let steps = 0
    for (; steps < limits.steps; steps++) {
      const at = random.int(0, each.length - 1)
      const known = [...tokens.keys()]
      const roll = random.next()
      if (roll < 0.2 || !known.length) {
        const token = 'tok' + seed + 'x' + steps
        const address = random.pick(addresses)
        const expiresAt = clock + random.int(1, limits.days) * limits.tickMs
        await each[at]!.store(env.DB).setItem('tempo-id:session:' + token, { address, expiresAt, method: 'siwe' }, { expiresAt })
        tokens.set(token, { address, ended: false, expiresAt })
      } else if (roll < 0.65) await check(at, random.pick(known), 'earlier')
      else if (roll < 0.8) {
        const token = random.pick(known)
        const ended = each[at]!.store(env.DB)
        if (random.chance(0.5)) await ended.removeItem('tempo-id:session:' + token)
        else await ended.takeItem!('tempo-id:session:' + token)
        tokens.get(token)!.ended = true
        for (let other = 0; other < each.length; other++) await check(other, token, 'through isolate ' + at + ' at the step before')
      } else if (roll < 0.92) catchUp(random.int(0, Math.min(lag(), limits.lagMost)))
      else clock += random.int(1, limits.tickMs)
    }
    return { steps, violations }
  } finally {
    unpin()
  }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { sessions }

const file = 'src/worker/Sessions.ts'

const read = "    getItem: async (key) => live(await db.prepare('select value, expires_at from sessions where key = ?').bind(key).first<Stored>()),"

function flip(name: string, from: string, to: string) {
  const source = mutant(name, file, from, to)
  return () => {
    const undo = source()
    flipped = name
    return () => {
      undo()
      flipped = ''
    }
  }
}

export const canaries: Canary[] = [
  {
    flip: flip(
      'sessions.held',
      'export function store(db: D1Database): Store.Store {\n  return {\n' + read + '\n    removeItem: async (key) => {\n',
      'const held = new Map<string, Stored>()\nexport function store(db: D1Database): Store.Store {\n  return {\n' +
        "    getItem: async (key) => live(held.get(key) ?? (await db.prepare('select value, expires_at from sessions where key = ?').bind(key).first<Stored>().then((row) => (row && held.set(key, row), row)))),\n    removeItem: async (key) => {\n      held.delete(key)\n",
    ),
    invariant: 'revoked everywhere',
    name: 'sessions.held',
    scenario: 'sessions',
    seeds: ['1', '2', '3'],
  },
  {
    flip: flip('sessions.replica', 'live(await db.prepare(', "live(await db.withSession('first-unconstrained').prepare("),
    invariant: 'revoked everywhere',
    name: 'sessions.replica',
    scenario: 'sessions',
    seeds: ['1', '2', '3'],
  },
]
