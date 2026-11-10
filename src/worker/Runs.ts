import type { Entry } from '../shared/Api.ts'
import * as Fleet from '../shared/Fleet.ts'
import { redact } from '../shared/Trail.ts'
import * as Feed from './Feed.ts'
import * as Gateway from './Gateway.ts'
import type { Swarm } from './Swarm.ts'

export const schema = [
  'CREATE TABLE IF NOT EXISTS runs (seq INTEGER PRIMARY KEY, machine TEXT NOT NULL, at INTEGER NOT NULL, who TEXT, text TEXT NOT NULL, output INTEGER, failed INTEGER NOT NULL DEFAULT 0, exit INTEGER, ms INTEGER, clipped INTEGER NOT NULL DEFAULT 0, log TEXT)',
  'CREATE TABLE IF NOT EXISTS machine_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, sandbox TEXT NOT NULL, at INTEGER NOT NULL, stream TEXT NOT NULL, text TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS job_logs (run INTEGER NOT NULL, offset INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run, offset))',
]

export const indexes = ['CREATE INDEX IF NOT EXISTS runs_machine ON runs (machine, seq)', 'CREATE INDEX IF NOT EXISTS machine_logs_at ON machine_logs (sandbox, at)']

export type Run = Omit<Fleet.Command, 'output'> & { event: number | null }

export type Opened = Run & { call: number | null; input: string | null; output: string | null; tool: string }


type Held = { cursor: number; state: Fleet.Tracker }

type Kept = { checked: number; complete: boolean; newest: number | null; older: string | null | undefined }

type Tailed = { checked: number; done: boolean; exit: number | null; offset: number }

export const page = { most: 500, standard: 100 }

const chunk = 2_000

const pages = 10

const lines = 1_000

export const logMs = 30_000

const jobMs = 15_000

const listenMs = 8_000

const graceMs = 10 * 60_000

const lifeMs = 24 * 60 * 60_000

export const jobBytes = 4 * 1024 * 1024

const memory = new WeakMap<Swarm, Held>()

const tracking = 2

function loaded(self: Swarm): Held {
  const known = memory.get(self)
  if (known) return known
  const kv = self.ctx.storage.kv
  const current = kv.get<number>('runs:v') === tracking
  const held = current ? { cursor: kv.get<number>('runs:cursor') ?? 0, state: kv.get<Fleet.Tracker>('runs:tracker') ?? Fleet.tracker() } : { cursor: 0, state: Fleet.tracker() }
  memory.set(self, held)
  return held
}

function save(self: Swarm, held: Held) {
  self.ctx.storage.kv.put('runs:cursor', held.cursor)
  self.ctx.storage.kv.put('runs:tracker', held.state)
  self.ctx.storage.kv.put('runs:v', tracking)
}

function apply(self: Swarm, changes: Fleet.Tracked[]) {
  const sql = self.ctx.storage.sql
  for (const change of changes) {
    if (change.kind === 'command') {
      const run = change.command
      sql.exec('INSERT INTO runs (seq, machine, at, who, text) VALUES (?, ?, ?, ?, ?) ON CONFLICT (seq) DO NOTHING', run.seq, run.machine, run.at, run.who, run.text)
      continue
    }
    const done = change.answer
    sql.exec(
      'UPDATE runs SET output = ?, failed = ?, exit = ?, ms = coalesce(ms, ?), clipped = ?, log = ? WHERE seq = ?',
      done.output,
      done.failed ? 1 : 0,
      done.exit,
      done.ms,
      done.clipped ? 1 : 0,
      done.log,
      done.seq,
    )
  }
}

export function sync(self: Swarm) {
  const held = loaded(self)
  const sql = self.ctx.storage.sql
  const start = held.cursor
  for (;;) {
    const rows = sql
      .exec<Record<string, SqlStorageValue>>(`SELECT seq, at, kind, text, detail, who, event FROM feed WHERE seq > ? AND kind IN ('tool', 'output', 'error', 'machine') ORDER BY seq LIMIT ?`, held.cursor, chunk)
      .toArray()
      .map(Feed.entry)
    for (const entry of rows) apply(self, Fleet.track(held.state, entry))
    if (rows.length) held.cursor = rows.at(-1)?.seq ?? held.cursor
    if (rows.length < chunk) break
  }
  held.cursor = Math.max(held.cursor, self.last())
  if (held.cursor !== start) save(self, held)
  return held
}

export function logged(self: Swarm, entry: Entry, ms: number | null) {
  const held = memory.get(self) ?? sync(self)
  if (held.cursor === entry.seq - 1 && !(Fleet.watched as readonly string[]).includes(entry.kind)) {
    held.cursor = entry.seq
    return
  }
  if (held.cursor !== entry.seq - 1) {
    if (held.cursor < entry.seq) sync(self)
    return
  }
  held.cursor = entry.seq
  const before = JSON.stringify(held.state)
  const changes = Fleet.track(held.state, entry, ms)
  apply(self, changes)
  if (changes.length || JSON.stringify(held.state) !== before) save(self, held)
}

function row(raw: Record<string, SqlStorageValue>): Run {
  return {
    at: Number(raw['at']),
    clipped: Number(raw['clipped']) === 1,
    event: raw['event'] === null || raw['event'] === undefined ? null : Number(raw['event']),
    exit: raw['exit'] === null ? null : Number(raw['exit']),
    failed: Number(raw['failed']) === 1,
    log: raw['log'] === null ? null : String(raw['log']),
    machine: String(raw['machine']),
    ms: raw['ms'] === null ? null : Number(raw['ms']),
    seq: Number(raw['seq']),
    text: String(raw['text']),
    who: raw['who'] === null ? null : String(raw['who']),
  }
}

const columns = 'r.seq, r.machine, r.at, r.who, r.text, r.failed, r.exit, r.ms, r.clipped, r.log, f.event'

export function listed(self: Swarm, machine: string, query: { cursor?: number | undefined; limit: number; order: 'newest' | 'oldest' }) {
  sync(self)
  const sql = self.ctx.storage.sql
  const newest = query.order === 'newest'
  const cursor = query.cursor ?? (newest ? Number.MAX_SAFE_INTEGER : 0)
  const rows = sql
    .exec<Record<string, SqlStorageValue>>(
      `SELECT ${columns} FROM runs r LEFT JOIN feed f ON f.seq = r.output WHERE r.machine = ? AND r.seq ${newest ? '<' : '>'} ? ORDER BY r.seq ${newest ? 'DESC' : ''} LIMIT ?`,
      machine,
      cursor,
      query.limit + 1,
    )
    .toArray()
    .map(row)
  const total = Number(sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE machine = ?', machine).one().n)
  const shown = rows.slice(0, query.limit)
  return { commands: shown, next: rows.length > query.limit ? (shown.at(-1)?.seq ?? null) : null, total }
}

function json(text: string | null) {
  if (!text) return undefined
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function opened(self: Swarm, machine: string, seqs: readonly number[]): Opened[] {
  if (!seqs.length) return []
  sync(self)
  const sql = self.ctx.storage.sql
  const wanted = new Set(seqs)
  return sql
    .exec<Record<string, SqlStorageValue>>(
      `SELECT ${columns}, t.detail AS input, t.text AS tool, t.event AS call, f.detail AS answer, f.text AS said FROM runs r JOIN feed t ON t.seq = r.seq LEFT JOIN feed f ON f.seq = r.output WHERE r.machine = ? AND r.seq BETWEEN ? AND ? ORDER BY r.seq`,
      machine,
      Math.min(...seqs),
      Math.max(...seqs),
    )
    .toArray()
    .filter((raw) => wanted.has(Number(raw['seq'])))
    .map((raw) => {
      const input = raw['input'] === null ? null : String(raw['input'])
      const lead = json(input) ? null : input
      const said = raw['said'] === null || raw['said'] === undefined ? null : String(raw['answer'] ?? raw['said'])
      const output = said === null ? lead : [lead, said].filter(Boolean).join('\n')
      return { ...row(raw), call: raw['call'] === null ? null : Number(raw['call']), input, output, tool: String(raw['tool']) }
    })
}

export function timed(self: Swarm, seq: number, ms: number) {
  self.ctx.storage.sql.exec('UPDATE runs SET ms = ? WHERE seq = ?', ms, seq)
}

export function counted(self: Swarm, machines: Fleet.Machine[]) {
  const held = sync(self)
  const sql = self.ctx.storage.sql
  const found = new Map(machines.map((machine) => [machine.name, machine]))
  const totals = sql.exec<{ failed: number; first: number; last: number; machine: string; n: number; who: string | null }>(
    'SELECT machine, COUNT(*) AS n, SUM(failed) AS failed, MIN(at) AS first, MAX(at) AS last, (SELECT who FROM runs o WHERE o.machine = r.machine ORDER BY seq LIMIT 1) AS who FROM runs r GROUP BY machine',
  )
  for (const total of totals) {
    let machine = found.get(total.machine)
    if (!machine) {
      machine = { by: total.who, charged: null, commands: [], config: [], connected: false, ended: null, failed: null, kind: Fleet.named(held.state, total.machine).length ? 'sandbox' : 'hand', label: null, name: total.machine, price: null, requests: null, runs: null, sandboxes: [], started: Number(total.first) }
      found.set(total.machine, machine)
    }
    machine.started ??= Number(total.first)
    machine.runs = { count: Number(total.n), failed: Number(total.failed), last: Number(total.last) }
  }
  for (const machine of found.values()) {
    machine.runs ??= { count: 0, failed: 0, last: null }
    machine.sandboxes = machine.kind === 'sandbox' ? Fleet.named(held.state, machine.name) : []
  }
  return [...found.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || (b.started ?? 0) - (a.started ?? 0))
}

export function sandboxes(self: Swarm, machine: string) {
  return Fleet.named(sync(self).state, machine)
}

function finished(machine: Fleet.Machine | undefined, now: number) {
  if (!machine) return true
  if (machine.ended !== null && now - machine.ended > graceMs) return true
  return machine.started !== null && now - machine.started > lifeMs + graceMs
}

function cached(self: Swarm, sandbox: string, query: { before?: string | undefined; limit: number; stream?: string | undefined }) {
  const [at, id] = (query.before ?? '').split('.').map(Number)
  const bounded = at !== undefined && id !== undefined && Number.isFinite(at) && Number.isFinite(id)
  const rows = self.ctx.storage.sql
    .exec<{ at: number; id: number; stream: string; text: string }>(
      `SELECT id, at, stream, text FROM machine_logs WHERE sandbox = ?${query.stream ? ' AND stream = ?' : ''}${bounded ? ' AND (at, id) < (?, ?)' : ''} ORDER BY at DESC, id DESC LIMIT ?`,
      sandbox,
      ...(query.stream ? [query.stream] : []),
      ...(bounded ? [at, id] : []),
      query.limit + 1,
    )
    .toArray()
    .map((line) => ({ at: Number(line.at), id: Number(line.id), stream: String(line.stream), text: String(line.text) }))
  const shown = rows.slice(0, query.limit).reverse()
  const first = shown[0]
  return { lines: shown, next: rows.length > query.limit && first ? `${first.at}.${first.id}` : null }
}

const fetching = new WeakMap<Swarm, Map<string, Promise<string | null>>>()

function once(self: Swarm, key: string, run: () => Promise<string | null>) {
  const map = fetching.get(self) ?? new Map<string, Promise<string | null>>()
  fetching.set(self, map)
  const running = map.get(key)
  if (running) return running
  const task = run().finally(() => map.delete(key))
  map.set(key, task)
  return task
}

function reading(self: Swarm, swarm: string, sandbox: string, before: string | undefined): Promise<Gateway.Result<Gateway.Logged>> {
  return Gateway.output(self.env, swarm, sandbox, { before, limit: lines }).catch((error: unknown) => ({ detail: error instanceof Error ? error.message : String(error), ok: false as const, status: 502 }))
}

async function refresh(self: Swarm, swarm: string, sandbox: string, machine: Fleet.Machine | undefined): Promise<string | null> {
  const key = `log:${sandbox}`
  const kv = self.ctx.storage.kv
  const kept = kv.get<Kept>(key) ?? { checked: 0, complete: false, newest: null, older: undefined }
  const now = Date.now()
  if ((kept.complete && finished(machine, now)) || now - kept.checked < logMs) return null
  const sql = self.ctx.storage.sql
  const insert = (entries: Gateway.Logged['entries'], above: number | null) => {
    for (const entry of entries) {
      if (above !== null && entry.at < above) continue
      const text = redact(entry.text)
      if (above !== null && entry.at === above && sql.exec('SELECT 1 FROM machine_logs WHERE sandbox = ? AND at = ? AND stream = ? AND text = ? LIMIT 1', sandbox, entry.at, entry.stream, text).toArray().length) continue
      sql.exec('INSERT INTO machine_logs (sandbox, at, stream, text) VALUES (?, ?, ?, ?)', sandbox, entry.at, entry.stream, text)
    }
  }
  let error: string | null = null
  let newest = kept.newest
  let older = kept.older
  let gone = false
  let before: string | undefined
  let rest: string | null = null
  for (let count = 0; count < pages; count++) {
    const read = await reading(self, swarm, sandbox, before)
    if (!read.ok) {
      gone = read.status === 404
      error = gone ? null : read.detail
      break
    }
    const entries = read.value.entries
    insert(entries, kept.newest)
    if (entries.length) newest = Math.max(newest ?? 0, entries.at(-1)?.at ?? 0)
    rest = read.value.before
    if (!rest || (kept.newest !== null && (entries[0]?.at ?? 0) <= kept.newest)) break
    before = rest
  }
  if (older === undefined && !error && !gone) older = rest
  if (older && !error && !gone) {
    let cursor: string | null = older
    for (let count = 0; count < pages && cursor; count++) {
      const read = await reading(self, swarm, sandbox, cursor)
      if (!read.ok) {
        gone = read.status === 404
        error = gone ? null : read.detail
        break
      }
      insert(read.value.entries, null)
      cursor = read.value.before
    }
    older = cursor
  }
  kv.put(key, { checked: now, complete: gone || (!error && older === null && finished(machine, now)), newest, older } satisfies Kept)
  return error
}

export async function logs(self: Swarm, swarm: string, machine: Fleet.Machine | undefined, name: string, query: { before?: string | undefined; limit: number; sandbox?: string | undefined; stream?: string | undefined }): Promise<Fleet.Logged> {
  const all = sandboxes(self, name)
  const sandbox = query.sandbox && all.includes(query.sandbox) ? query.sandbox : all.at(-1)
  if (!sandbox) return { complete: true, error: null, fetchedAt: null, lines: [], next: null, sandbox: '', sandboxes: [] }
  const error = query.before ? null : await once(self, `log:${sandbox}`, () => refresh(self, swarm, sandbox, machine))
  const kept = self.ctx.storage.kv.get<Kept>(`log:${sandbox}`)
  return { ...cached(self, sandbox, query), complete: kept?.complete ?? false, error, fetchedAt: kept?.checked ?? null, sandbox, sandboxes: all }
}

function stored(self: Swarm, seq: number) {
  const parts = self.ctx.storage.sql.exec<{ data: string }>('SELECT data FROM job_logs WHERE run = ? ORDER BY offset', seq).toArray()
  return parts.map((part) => String(part.data)).join('')
}

async function follow(self: Swarm, swarm: string, sandbox: string, run: Run, tailed: Tailed, gone: boolean): Promise<string | null> {
  const now = Date.now()
  const key = `job:${run.seq}`
  const kv = self.ctx.storage.kv
  if ((tailed.done && (gone || tailed.exit !== null)) || now - tailed.checked < jobMs || !run.log) return null
  if (gone) {
    kv.put(key, { ...tailed, checked: now, done: true })
    return null
  }
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), listenMs)
  const next = { ...tailed, checked: now, done: false }
  let error: string | null = null
  const held = () => Number(self.ctx.storage.sql.exec<{ n: number | null }>('SELECT SUM(length(data)) AS n FROM job_logs WHERE run = ?', run.seq).one().n ?? 0)
  try {
    const response = await Gateway.tail(self.env, swarm, sandbox, run.log, tailed.offset, stop.signal).catch(() => undefined)
    if (!response) error = 'The gateway did not answer.'
    else if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '')
      if (response.status === 404) next.done = true
      else error = text.slice(0, 300) || `The gateway answered ${response.status}.`
    } else {
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let size = held()
      for (;;) {
        const read = await reader.read().catch(() => undefined)
        if (!read || read.done) break
        buffer += read.value
        const parts = buffer.split('\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          if (!part.trim()) continue
          const event = JSON.parse(part) as { code?: string; data?: string; detail?: string; exitCode?: number | null; offset?: number; type: string }
          if (event.type === 'log' && typeof event.data === 'string' && typeof event.offset === 'number') {
            if (size < jobBytes) self.ctx.storage.sql.exec('INSERT OR REPLACE INTO job_logs (run, offset, data) VALUES (?, ?, ?)', run.seq, next.offset, redact(event.data))
            size += event.data.length
            next.offset = event.offset
          } else if (event.type === 'exit') {
            next.done = true
            next.exit = event.exitCode ?? null
          } else if (event.type === 'error') {
            if (event.code === 'not_found') next.done = true
            else error = event.detail ?? 'The gateway could not read the log.'
          }
        }
        if (next.done) break
      }
      await reader.cancel().catch(() => undefined)
    }
  } finally {
    clearTimeout(timer)
  }
  kv.put(key, next)
  return error
}

export async function job(self: Swarm, swarm: string, machine: Fleet.Machine | undefined, name: string, seq: number): Promise<Fleet.Job | undefined> {
  sync(self)
  const raw = self.ctx.storage.sql
    .exec<Record<string, SqlStorageValue>>(`SELECT ${columns}, t.detail AS input FROM runs r JOIN feed t ON t.seq = r.seq LEFT JOIN feed f ON f.seq = r.output WHERE r.machine = ? AND r.seq = ?`, name, seq)
    .toArray()[0]
  const found = raw ? row(raw) : undefined
  if (!found?.log) return undefined
  const sandbox = Fleet.sandbox(String(raw?.['input'] ?? '')) ?? sandboxes(self, name).at(-1) ?? name
  const key = `job:${seq}`
  const tailed = self.ctx.storage.kv.get<Tailed>(key) ?? { checked: 0, done: false, exit: null, offset: 0 }
  const error = await once(self, key, () => follow(self, swarm, sandbox, found, tailed, finished(machine, Date.now())))
  const now = self.ctx.storage.kv.get<Tailed>(key) ?? tailed
  const data = stored(self, seq)
  return { data, done: now.done, error, exit: now.exit, fetchedAt: now.checked || null, held: data.length, log: found.log, offset: now.offset, sandbox, seq }
}
