import { DurableObject } from 'cloudflare:workers'
import type { Address } from 'viem'
import type { Chatter, Code, Currency, Entry, Hand, Kind, Live, Note, Part, Pulse, Roster, Said, Shown, Snapshot, Steer, Update, Working } from '../shared/Api.ts'
import { clip, redact } from '../shared/Trail.ts'
import * as Answer from '../shared/Answer.ts'
import * as Btw from '../shared/Btw.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Artifacts from './Artifacts.ts'
import * as Chain from './Chain.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Payer from './Payer.ts'
import * as Persona from './Persona.ts'
import * as Phase from './Phase.ts'
import type { Why } from '../shared/Api.ts'
import * as Search from './Search.ts'
import * as Sessions from './Sessions.ts'
import * as Lobby from './Lobby.ts'
import * as Store from './Store.ts'
import * as Vault from './Vault.ts'
import * as Words from './Words.ts'
import * as Relay from './Relay.ts'
import * as Clock from './Clock.ts'
import * as Paying from './Paying.ts'
import * as Money from './Money.ts'
import * as Follow from './Follow.ts'
import * as Repo from './Repo.ts'
import * as Branching from './Branching.ts'

export type Contributed = {
  amount: string
  contributor: Address
  hash: string
  note: string | null
  noteId: string | null
  swarm: string
  token: Currency
  kind?: 'new' | 'noted' | undefined
}

export type View = {
  code: Code | null
  feed: Entry[]
  hands: Hand[]
  reason: string | null
  why: Why | null
  stamp: Stamp
  steered: string[]
  ended: { endedAt: number; n: number }[]
  updates: Update[]
  working: Working | null
}

export type Stamp = { quiet: boolean; version: string }

export type Spoken = {
  author: Address
  mentions: Address[]
  steer: { amount: string; context?: string; note: string; noteId: string } | null
  swarm: string
  text: string
}

type Seen = { title: string; turn: number; version: number }

export type Lead = { briefed: boolean; cursor: number; id: string; persona: boolean; unreachable: number | null; url: string }

export type Turning = Extract<Phase.Run, { state: 'working' }>

const version = 2

const dead = ['turn', 'started', 'since', 'paused', 'why', 'failures', 'wanted', 'checked', 'n', 'fresh', 'unreachable', 'url', 'persona', 'cursor', 'shelved', 'terms', 'left', 'expected', 'poolKey', 'poolAgent', 'poolChannel', 'poolSpent', 'round', 'resting', 'stuck', 'kicked', 'rechecked', 'retired', 'retiring', 'tallied', 'workers', 'refundAt', 'refunded', 'closing', 'returning', 'open', 'source', 'pledge', 'swept']

const gone = ['owed:', 'sent:', 'seen:', 'closing:', 'available:']

const sourced = ['banked:', 'spent:', 'paid:', 'pending:', 'exhausted:', 'unopened:', 'owing:', 'channel:', 'mppx:']

function migrate(storage: DurableObjectStorage, from: number) {
  const kv = storage.kv
  const sql = storage.sql
  if (from < 1) {
    const n = Number(sql.exec<{ n: number | null }>('SELECT MAX(n) AS n FROM turns').one().n ?? kv.get<number>('n') ?? 0)
    if (kv.get<Phase.Run>('run') === undefined) kv.put('run', Phase.migrated(kv, n, Date.now()))
    const agent = kv.get<unknown>('agent')
    if (typeof agent === 'string')
      kv.put('agent', {
        briefed: !kv.get<boolean>('fresh'),
        cursor: kv.get<number>('cursor') ?? 0,
        id: agent,
        persona: kv.get<string>('persona') === Persona.name,
        unreachable: kv.get<number>('unreachable') ?? null,
        url: kv.get<string>('url') ?? '',
      } satisfies Lead)
    for (const key of dead) kv.delete(key)
    for (const prefix of gone) for (const [key] of [...kv.list({ prefix })]) kv.delete(key)
    for (const prefix of sourced)
      for (const [key] of [...kv.list({ prefix })]) {
        const id = key.slice(prefix.length)
        if (!id.startsWith('pool') && !id.startsWith('hand:')) kv.delete(key)
      }
    if (sql.exec<{ name: string }>('PRAGMA table_info(feed)').toArray().some((row) => row.name === 'round')) sql.exec('ALTER TABLE feed DROP COLUMN round')
  }
  if (from < 2) {
    kv.delete('sponsored')
    for (const [key] of [...kv.list({ prefix: 'delivered:' })]) kv.delete(key)
    const last = sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM feed').one().seq
    if (last !== null) kv.put('unindexed', Number(last))
  }
  kv.put('v', version)
}

const schema = [
  'CREATE TABLE IF NOT EXISTS feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, detail TEXT)',
  "CREATE TABLE IF NOT EXISTS turns (n INTEGER PRIMARY KEY, turn TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL, message TEXT, spent_before TEXT NOT NULL, spent TEXT NOT NULL DEFAULT '0')",
  'CREATE TABLE IF NOT EXISTS steered (note TEXT PRIMARY KEY, at INTEGER NOT NULL)',
  "CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, author TEXT, text TEXT NOT NULL, mentions TEXT NOT NULL DEFAULT '[]', steer TEXT)",
  "CREATE VIRTUAL TABLE IF NOT EXISTS feed_search USING fts5(body, content='', contentless_delete=1, tokenize='porter unicode61 remove_diacritics 2')",
]

const columns = [
  ['turns', 'commits', "ALTER TABLE turns ADD COLUMN commits TEXT NOT NULL DEFAULT '[]'"],
  ['turns', 'base', 'ALTER TABLE turns ADD COLUMN base TEXT'],
  ['feed', 'who', 'ALTER TABLE feed ADD COLUMN who TEXT'],
  ['feed', 'event', 'ALTER TABLE feed ADD COLUMN event INTEGER'],
  ['chat', 'artifact', 'ALTER TABLE chat ADD COLUMN artifact TEXT'],
  ['steered', 'weight', 'ALTER TABLE steered ADD COLUMN weight TEXT'],
] as const

const indexes = ["CREATE INDEX IF NOT EXISTS turns_committed ON turns (n) WHERE commits != '[]'", 'CREATE INDEX IF NOT EXISTS feed_who ON feed (who)']

const pushedTurns = "WHERE n IN (SELECT n FROM turns WHERE commits != '[]' UNION ALL SELECT n FROM (SELECT n FROM turns WHERE status = 'completed' AND message IS NOT NULL ORDER BY n DESC LIMIT 3))"

const newerTurns = "WHERE n IN (SELECT n FROM turns WHERE status = 'completed' AND message IS NOT NULL AND ended_at > ? ORDER BY n DESC LIMIT 5)"

const lastTurns = "WHERE n IN (SELECT n FROM turns WHERE status = 'completed' AND message IS NOT NULL AND ended_at IS NOT NULL ORDER BY n DESC LIMIT ?)"

const searched = 5_000

const searchable = "text || ' ' || substr(coalesce(detail, ''), 1, 4000)"

const indexChunk = 1_000

const indexMs = 1_000

const healMs = 5 * 60_000

const unreachableMs = 15 * 60_000

const maxFailures = 3

const settleMs = 15_000

const quickMs = 60_000

const rowMs = 10_000

const stillMs = 2_000

export class Swarm extends DurableObject<Cloudflare.Env> {
  declare ctx: DurableObjectState<{}>
  declare env: Cloudflare.Env
  stepping: Promise<number | null> | undefined
  paying: Promise<unknown> = Promise.resolve()
  funding: Promise<void> | undefined
  wallet: Promise<unknown> = Promise.resolve()
  checked = 0
  vended = 0
  signers = new Map<string, Promise<Paying.Signer>>()
  clients = new Map<string, Payer.Client>()
  memos = new Map<string, { at: number; epoch: number; marked: number; value: unknown }>()
  marked = 0
  boot = crypto.randomUUID().slice(0, 8)
  touches = 0
  stamped = { at: 0, tuple: '' }
  kept: SyncKvStorage | undefined
  watchers = new Set<Relay.Watcher>()
  ring: Relay.Ring = { bytes: 0, frames: [] }
  window: { live: boolean; stop: AbortController } | undefined
  fails = 0
  cues = new Map<Follow.Cue, number>()
  polled = new Map<Follow.Cue, number>()
  held: Vault.Balances | undefined
  pledged = { biggest: 0n, left: 0n, spent: 0n }
  waiters = new Set<() => void>()
  pending: Pending = { at: 0, parts: new Set(), pulse: undefined, timer: undefined }
  holders = new Map<string, { address: Address | undefined; at: number }>()
  beating: ReturnType<typeof setInterval> | undefined

  budgeting: Promise<unknown> = Promise.resolve()

  listing: { agent: string; at: number; pending: boolean; value: Promise<Gateway.Result<{ agent: string | null; list: Gateway.Subagent[] }>> } | undefined

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    const sql = ctx.storage.sql
    const tables = new Set(sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'").toArray().map((row) => row.name))
    if (tables.has('rounds') && !tables.has('turns')) sql.exec('ALTER TABLE rounds RENAME TO turns')
    if (tables.has('researchers')) {
      for (const row of sql.exec<{ id: string; snapshot: string }>('SELECT id, snapshot FROM researchers').toArray())
        sql.exec('UPDATE feed SET who = ? WHERE who = ?', (JSON.parse(row.snapshot) as { name?: string }).name ?? 'subagent', row.id)
      sql.exec('DROP TABLE researchers')
    }
    const counted = ctx.storage.kv.get<number>('round')
    if (counted !== undefined) {
      ctx.storage.kv.put('n', counted)
      ctx.storage.kv.delete('round')
      ctx.storage.kv.delete('workers')
    }
    for (const statement of schema) sql.exec(statement)
    for (const [table, column, statement] of columns)
      if (!ctx.storage.sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray().some((row) => row.name === column))
        ctx.storage.sql.exec(statement)
    for (const statement of indexes) sql.exec(statement)
    const from = ctx.storage.kv.get<number>('v') ?? 0
    if (from < version) migrate(ctx.storage, from)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  get kv(): SyncKvStorage {
    return (this.kept ??= touched(this.ctx.storage.kv, () => this.touch()))
  }

  touch() {
    this.touches += 1
  }

  stamp(): Stamp {
    const tuple = `${Store.epoch(this.kv.get<string>('id') ?? '')}.${this.marked}.${this.touches}`
    const now = Date.now()
    if (tuple !== this.stamped.tuple) this.stamped = { at: now, tuple }
    return { quiet: now - this.stamped.at >= stillMs, version: `${this.boot}.${tuple}` }
  }

  version(): Stamp {
    this.ctx.waitUntil(this.heal())
    return this.stamp()
  }

  found(id: string) {
    return this.memo(`row:${id}`, id, () => Store.find(this.env, id), (row) => !!row?.wallet)
  }

  remember(row: Store.Row) {
    this.memos.set(`row:${row.id}`, { at: Date.now(), epoch: Store.epoch(row.id), marked: this.marked, value: structuredClone(row) })
  }

  async memo<T>(key: string, swarm: string, read: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
    const held = this.memos.get(key)
    if (held && held.epoch === Store.epoch(swarm) && held.marked === this.marked && Date.now() - held.at < rowMs) return structuredClone(held.value) as T
    const at = Date.now()
    const epoch = Store.epoch(swarm)
    const marked = this.marked
    const value = await read()
    if (keep(value)) this.memos.set(key, { at, epoch, marked, value: structuredClone(value) })
    else this.memos.delete(key)
    return value
  }

  async contributed(input: Contributed) {
    this.marked += 1
    this.kv.put('id', input.swarm)
    this.kv.delete('exhausted:pool')
    if (input.kind === 'noted') {
      this.log('funds', `${Words.short(input.contributor)} put the ${Words.trim(input.amount)} ${Chain.symbol(input.token)} they sent behind a note`, [input.note, input.hash].filter(Boolean).join('\n'))
      this.announce(`${Mention.at((await Store.account(this.env, input.contributor)).handle)} put the ${Words.trim(input.amount)} ${Chain.symbol(input.token)} they sent behind "${input.note ?? ''}".`)
      if (input.noteId) await this.steer(input.swarm, input.noteId)
      this.changed('detail', 'members')
      return this.wake('note')
    }
    this.log(
      'funds',
      `${Words.short(input.contributor)} sent ${Words.trim(input.amount)} ${Chain.symbol(input.token)}${input.note ? ' with a note' : ''}`,
      [input.note, input.hash].filter(Boolean).join('\n'),
    )
    this.announce(`${Mention.at((await Store.account(this.env, input.contributor)).handle)} sent ${Words.trim(input.amount)} ${Chain.symbol(input.token)}${input.note ? ` behind "${input.note}"` : ''}.`)
    if (input.noteId) await this.steer(input.swarm, input.noteId)
    this.cue('chain')
    this.changed('detail', 'members')
    await this.wake('money')
    if (this.listened()) {
      const row = await this.found(input.swarm)
      if (row) this.beacon(row)
    }
  }

  run(): Phase.Run {
    return this.kv.get<Phase.Run>('run') ?? { state: 'new' }
  }

  agent(): Lead | undefined {
    return this.kv.get<Lead>('agent')
  }

  turn() {
    const run = this.run()
    return run.state === 'working' ? run.turn : undefined
  }

  last() {
    return Number(this.ctx.storage.sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM feed').one().seq ?? 0)
  }

  turned() {
    return Number(this.ctx.storage.sql.exec<{ n: number | null }>('SELECT MAX(n) AS n FROM turns').one().n ?? 0)
  }

  set(run: Phase.Run) {
    Phase.check(this.run().state, run.state)
    this.kv.put('run', run)
  }

  async move(row: Store.Row, run: Phase.Run, fields: Store.Fields = {}) {
    this.set(run)
    for (const waiter of [...this.waiters]) waiter()
    const projected = Phase.project(run, run.state === 'starting' || run.state === 'working' ? run.n : this.turned())
    const changed = projected.status !== row.status || projected.why !== (row.why ?? null)
    if (changed || Object.keys(fields).length) {
      await Store.update(this.env, row.id, { ...(changed ? projected : {}), ...fields })
      row.status = projected.status
      row.why = projected.why
    }
    this.beacon(row)
  }

  async waited(since: number, ms: number): Promise<{ update: Update | null; working: Working | null }> {
    const now = this.latest(since)
    if (now.update || !now.working || ms <= 0) return now
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.waiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, Math.min(ms, maxWaitMs))
      this.waiters.add(done)
    })
    return this.latest(since)
  }

  listened() {
    return this.ctx.getWebSockets().length > 0
  }

  changed(...parts: Part[]) {
    if (!this.listened()) return
    for (const part of parts) this.pending.parts.add(part)
    this.soon()
  }

  beacon(row: Store.Row) {
    const summary = Store.summary(row)
    const told = JSON.stringify(summary)
    if (!(row as Store.Row & { hidden?: number }).hidden && this.kv.get<string>('lobby') !== told) {
      this.kv.put('lobby', told)
      this.ctx.waitUntil(Lobby.tell(this.env, summary))
    }
    if (!this.listened()) return
    this.pending.pulse = row
    this.soon()
  }

  soon() {
    if (this.pending.timer !== undefined) return
    this.pending.timer = setTimeout(() => this.emit(), Math.max(0, this.pending.at + coalesceMs - Date.now()))
  }

  emit() {
    const { parts, pulse } = this.pending
    this.pending = { at: Date.now(), parts: new Set(), pulse: undefined, timer: undefined }
    const version = this.stamp().version
    if (pulse) this.broadcast({ ...this.pulsed(pulse), type: 'pulse', version })
    if (parts.size) this.broadcast({ parts: [...parts].sort(), type: 'changed', version })
  }

  pulsed(row: Store.Row): Pulse {
    const paused = Phase.paused(this.run())
    return { hands: this.kv.get<Hand[]>('hands') ?? [], reason: paused ? Phase.reason(paused) : null, swarm: Store.summary(row), why: paused?.why ?? null, working: this.working() }
  }

  rostered(roster: Roster) {
    this.broadcast({ roster, type: 'roster' })
  }

  async wake(reason: Phase.Reason) {
    const run = this.run()
    if (run.state === 'paused') {
      if (!Phase.wakes(run.pause, reason)) return
      this.set({ from: run.pause, since: null, state: 'waiting', until: Date.now() })
    }
    if (run.state === 'paused' || run.state === 'waiting' || run.state === 'new') await this.ctx.storage.setAlarm(Date.now())
  }

  async hand(swarm: string, name: string): Promise<Gateway.Result<Gateway.Minted>> {
    this.marked += 1
    this.kv.put('id', swarm)
    this.kv.put('issued', true)
    this.changed('hands', 'members')
    this.cue('hands')
    const listed = await Gateway.hands(this.env, swarm)
    if (listed.ok && listed.value.hands.some((hand) => hand.name === name))
      return { detail: 'A hand of the swarm already has this name.', ok: false, status: 409 }
    return Gateway.hand(this.env, swarm, name)
  }

  async lent() {
    const id = this.kv.get<string>('id')
    if (!id) return []
    const listed = await Gateway.hands(this.env, id)
    return listed.ok ? listed.value.hands : []
  }

  async heal() {
    const now = Date.now()
    const id = this.kv.get<string>('id')
    if (id && !this.kv.get<number>('published') && now - (this.kv.get<number>('exposing') ?? 0) > 60_000) {
      this.kv.put('exposing', now)
      const row = await this.found(id)
      if (row) await this.expose(row).catch((error: unknown) => console.error('Making the swarm data public failed', error))
      this.kv.delete('exposing')
    }
    await this.reindex()
    const run = this.run()
    if (run.state === 'paused' || run.state === 'new' || now - (this.kv.get<number>('healed') ?? 0) < healMs) return
    const alarm = await this.ctx.storage.getAlarm()
    if (alarm !== null) return
    this.kv.put('healed', now)
    console.log(JSON.stringify({ alarm, heal: this.kv.get<string>('id') }))
    await this.ctx.storage.setAlarm(now)
  }

  view(shape: { feed?: number; pushed?: boolean; texts?: boolean } = {}): View {
    const stamp = this.stamp()
    this.ctx.waitUntil(this.heal())
    const sql = this.ctx.storage.sql
    const limit = shape.feed ?? 200
    const feed = limit > 0
      ? sql
          .exec<Record<string, SqlStorageValue>>('SELECT seq, at, kind, text, detail, who, event FROM feed ORDER BY seq DESC LIMIT ?', limit)
          .toArray()
          .reverse()
          .map(entry)
      : []
    const id = this.kv.get<string>('id')
    const repo = this.kv.get<string>('repo')
    const owner = this.kv.get<string>('owner')
    const turns = shape.pushed ? this.rows(pushedTurns) : this.turns()
    const shown = shape.pushed ? updates(turns).filter((update, index, all) => update.commits.length > 0 || index === all.length - 1) : updates(turns)
    const paused = Phase.paused(this.run())
    return {
      code: id && repo && owner ? { app: Gateway.app(id), clone: `${this.env.GATEWAY_URL}/p/${owner}/${Gateway.app(id)}/git/${repo}.git`, name: repo, owner } : null,
      feed,
      hands: this.kv.get<Hand[]>('hands') ?? [],
      reason: paused ? Phase.reason(paused) : null,
      stamp,
      why: paused?.why ?? null,
      steered: this.steered(),
      ended: this.ctx.storage.sql
        .exec<{ ended_at: number; n: number }>('SELECT n, ended_at FROM turns WHERE ended_at IS NOT NULL ORDER BY n DESC LIMIT 20')
        .toArray()
        .map((row) => ({ endedAt: Number(row.ended_at), n: Number(row.n) })),
      updates: shape.texts === false ? shown.map((update) => ({ ...update, text: '' })) : shown,
      working: this.working(),
    }
  }

  pulse() {
    const turns = this.turns()
    return { turns, updates: updates(turns), working: this.working() }
  }

  latest(after: number): { update: Update | null; working: Working | null } {
    return { update: updates(this.rows(newerTurns, after)).at(-1) ?? null, working: this.working() }
  }

  recent(limit: number): { updates: Update[]; working: Working | null } {
    return { updates: updates(this.rows(lastTurns, limit + 10)).slice(-limit), working: this.working() }
  }

  working(): Working | null {
    const since = Phase.since(this.run())
    return since === null ? null : { since }
  }

  turns(after = 0): Search.Turn[] {
    return this.rows('WHERE n > ?', after)
  }

  private rows(where: string, ...bindings: SqlStorageValue[]): Search.Turn[] {
    return this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>(`SELECT n, started_at, ended_at, status, message, spent, commits, base FROM turns ${where} ORDER BY n`, ...bindings)
      .toArray()
      .map((row) => ({
        base: row['base'] === null ? null : String(row['base']),
        commits: JSON.parse(String(row['commits'] ?? '[]')) as string[],
        endedAt: row['ended_at'] === null ? null : Number(row['ended_at']),
        message: row['message'] === null ? null : String(row['message']),
        n: Number(row['n']),
        spent: Memo.decimal(BigInt(String(row['spent']))),
        startedAt: Number(row['started_at']),
        status: String(row['status']),
      }))
  }

  feed(
    after: number,
    filter: { before?: number | undefined; kind?: Kind | undefined; kinds?: readonly Kind[] | undefined; limit?: number | undefined; who?: string | undefined } = {},
  ): Entry[] {
    const where = [
      'seq > ?',
      ...(filter.before === undefined ? [] : ['seq < ?']),
      ...(filter.kind ? ['kind = ?'] : []),
      ...(filter.kinds?.length ? [`kind IN (${filter.kinds.map(() => '?').join(', ')})`] : []),
      ...(filter.who === undefined ? [] : [filter.who === 'agent' ? 'who IS NULL' : 'who = ?']),
    ]
    const values = [
      after,
      ...(filter.before === undefined ? [] : [filter.before]),
      ...(filter.kind ? [filter.kind] : []),
      ...(filter.kinds ?? []),
      ...(filter.who === undefined || filter.who === 'agent' ? [] : [filter.who]),
    ]
    const rows = this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>(
        `SELECT seq, at, kind, text, detail, who, event FROM feed WHERE ${where.join(' AND ')} ORDER BY seq ${filter.before === undefined ? '' : 'DESC '}LIMIT ?`,
        ...values,
        filter.limit ?? 200,
      )
      .toArray()
    return (filter.before === undefined ? rows : rows.reverse()).map(entry)
  }

  page(
    after: number,
    filter: { before?: number | undefined; kind?: Kind | undefined; kinds?: readonly Kind[] | undefined; limit?: number | undefined; who?: string | undefined } = {},
  ) {
    const last = this.ctx.storage.sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM feed').one().seq ?? 0
    return { entries: this.feed(after, filter), last: Number(last) }
  }

  search(terms: string[], limit: number): Entry[] {
    if (!terms.length) return []
    const indexed = this.kv.get<number>('unindexed') === undefined
    if (!indexed) this.ctx.waitUntil(this.reindex())
    const score = terms.map(() => "(instr(lower(text || ' ' || coalesce(detail, '')), ?) > 0)").join(' + ')
    const [query, ...values]: [string, ...(string | number)[]] = indexed
      ? [
          'SELECT f.seq, f.at, f.kind, f.text, f.detail, f.who, f.event FROM (SELECT rowid, rank FROM feed_search WHERE feed_search MATCH ? ORDER BY rank, rowid DESC LIMIT ?) s JOIN feed f ON f.seq = s.rowid ORDER BY s.rank, f.seq DESC',
          terms.map((term) => `"${term}"`).join(' OR '),
          limit,
        ]
      : [
          `SELECT seq, at, kind, text, detail, who, event FROM (SELECT *, ${score} AS score FROM (SELECT * FROM feed ORDER BY seq DESC LIMIT ${searched})) WHERE score > 0 ORDER BY score DESC, seq DESC LIMIT ?`,
          ...terms,
          limit,
        ]
    return this.ctx.storage.sql.exec<Record<string, SqlStorageValue>>(query, ...values).toArray().map(entry)
  }

  index() {
    const below = this.kv.get<number>('unindexed')
    if (below === undefined) return false
    const sql = this.ctx.storage.sql
    const edge = sql.exec<{ low: number | null; n: number }>('SELECT MIN(seq) AS low, COUNT(*) AS n FROM (SELECT seq FROM feed WHERE seq <= ? ORDER BY seq DESC LIMIT ?)', below, indexChunk).one()
    if (edge.low !== null) sql.exec(`INSERT INTO feed_search (rowid, body) SELECT seq, ${searchable} FROM feed WHERE seq BETWEEN ? AND ?`, edge.low, below)
    if (edge.low === null || edge.n < indexChunk) {
      this.kv.delete('unindexed')
      return false
    }
    this.kv.put('unindexed', edge.low - 1)
    return true
  }

  async reindex() {
    if (this.kv.get<number>('unindexed') === undefined || this.run().state !== 'paused') return
    const alarm = await this.ctx.storage.getAlarm()
    if (alarm === null || alarm > Date.now() + indexMs) await this.ctx.storage.setAlarm(Date.now())
  }

  override async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/chat') return this.socket(request)
    const after = url.searchParams.get('after')
    const follow = after !== null && /^\d{1,15}$/.test(after)
    const streaming = this.streaming()
    if (!follow && !streaming) return Relay.sse(`data: ${JSON.stringify({ type: 'idle' } satisfies Live)}\n\n`)

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const watcher: Relay.Watcher = { follow, relaying: false, until: Date.now() + Relay.followForMs, writer: writable.getWriter() }
    this.watchers.add(watcher)
    request.signal.addEventListener('abort', () => Relay.unwatch(this, watcher), { once: true })
    if (follow) {
      if (!streaming) Relay.write(this, watcher, Relay.encoded({ type: 'idle' }))
      const backlog = this.feed(Number(after), { limit: Relay.backlogSize })
      for (const found of backlog) Relay.write(this, watcher, Relay.encoded({ entry: found, type: 'entry' }))
      if (backlog.length === Relay.backlogSize) {
        Relay.unwatch(this, watcher)
        return Relay.sse(readable)
      }
    }
    if (streaming) Relay.join(this, watcher)
    Relay.beat(this)
    return Relay.sse(readable)
  }

  streaming() {
    return !!(this.kv.get<string>('id') && this.agent() && this.turn() && this.kv.get<string>('secret'))
  }

  override async alarm() {
    const indexing = this.index()
    this.stepping ??= this.step()
      .catch((error: unknown) => {
        this.log('error', 'The swarm hit an error and will retry.', String(error))
        return Date.now() + Clock.retryMs
      })
      .finally(() => {
        this.stepping = undefined
      })
    const stepped = await this.stepping
    const next = indexing && this.run().state === 'paused' ? Math.min(stepped ?? Infinity, Date.now() + indexMs) : stepped
    if (next === null) return
    const pending = await this.ctx.storage.getAlarm()
    await this.ctx.storage.setAlarm(pending !== null && pending < next ? pending : next)
  }

  async step() {
    const id = this.kv.get<string>('id')
    const row = id ? await this.found(id) : null
    if (!row) return null

    this.initialize()
    const run = this.run()
    if (run.state === 'paused') {
      if (!Phase.due(run, Date.now())) return run.pause.why === 'money' ? run.pause.wake : null
      this.set({ from: run.pause, since: null, state: 'waiting', until: Date.now() })
    }
    if (run.state === 'working') return Follow.follow(this, row, run)
    return this.advance(row)
  }

  initialize() {
    if (this.kv.get<string>('secret')) return
    const run = this.run()
    if (run.state === 'working') this.ctx.storage.sql.exec("UPDATE turns SET status = 'cancelled', ended_at = ? WHERE n = ? AND status = 'running'", Date.now(), run.n)
    if (run.state === 'working' || run.state === 'starting') this.set({ since: null, state: 'waiting', until: Date.now() })
    this.kv.delete('agent')
    this.kv.put('secret', Words.hex(crypto.getRandomValues(new Uint8Array(32))))
  }

  async advance(row: Store.Row) {
    const run = this.run()
    const worked = this.turned()
    await Money.fund(this, row)
    const money = await Money.refresh(this, row)
    if (run.state !== 'starting' && money.left < Store.reserve) {
      const wake = Paying.rested(this)
      await this.pause(money.row, worked || money.row.contributors ? { left: String(money.left), wake, why: 'money' } : { why: 'unfunded' })
      return wake
    }
    const repo = await Repo.located(this, row)

    const agent = await this.lead(row)
    if ('error' in agent) return this.retry(money.row, agent.error, agent.detail)

    const n = run.state === 'starting' ? run.n : worked + 1
    const since = Phase.since(run)
    const notes = await this.notes(money.row)
    const base = repo.state === 'ready' ? await Repo.head(this, row.id, repo.name) : null
    if (base) this.kv.put('seen', base)
    else this.kv.delete('seen')
    const told = this.told()
    const included = agent.briefed ? notes.filter((note) => grown(told.get(note.id), Memo.units(note.weight))) : notes
    const text = agent.briefed ? next(this.tell(included)) : brief(money.row, this.tell(notes))
    const id = `${agent.id}:${n}`
    const start: Phase.Run =
      run.state === 'starting' && run.id === id ? run : { id, n, since, state: 'starting', told: included.map((note) => [note.id, String(Memo.units(note.weight))]) }
    await this.move(money.row, start)
    const sent = await Gateway.prompt(this.env, row.id, agent.id, { id: start.id, prompt: text, steer: false })
    if (!sent.ok && sent.status !== 409) {
      if (sent.status === 404) this.kv.delete('agent')
      if (sent.status >= 500 && this.unreachable(Date.now())) this.abandon(agent.id, sent.detail)
      return this.retry(money.row, 'The gateway did not take the next message for the agent.', sent.detail)
    }

    const now = Date.now()
    const turn = sent.ok ? sent.value.request_id : start.id
    await Money.cap(this, row, money.left / Hands.share)
    this.kv.put('agent', { ...(this.agent() ?? agent), briefed: true, unreachable: null })
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO turns (n, turn, started_at, status, spent_before, base) VALUES (?, ?, ?, 'running', ?, ?)",
      n,
      turn,
      now,
      String(money.row.spent),
      base,
    )
    for (const [note, weight] of start.told) {
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO steered (note, at, weight) VALUES (?, ?, ?)', note, now, weight)
      this.kv.delete('collapse:' + note)
    }
    for (const note of notes.filter((found) => told.get(found.id) === null)) this.ctx.storage.sql.exec('UPDATE steered SET weight = ? WHERE note = ? AND weight IS NULL', String(Memo.units(note.weight)), note.id)
    this.touch()
    await this.move(money.row, { from: this.last(), n, since: start.since ?? now, started: now, state: 'working', turn }, { rounds: n })
    Relay.begin(this)
    this.log('status', start.since === null ? `${worked ? 'Back at work' : 'Started working'}.` : 'Told the agent to keep going.', text)
    if (start.since === null) this.announce(`${worked ? 'Back at work' : 'Started working'}.`)
    return now + Clock.followMs
  }

  async retry(row: Store.Row, error: string, detail: string) {
    const run = this.run()
    const now = Date.now()
    const last = run.state === 'waiting' ? run.retry : undefined
    const repeat = last?.error === error
    const logged = last && repeat && now - last.logged < Clock.quietMs ? last.logged : now
    if (logged === now) this.log('error', error, detail)
    await this.move(row, {
      ...(run.state === 'waiting' && run.from ? { from: run.from } : {}),
      retry: { count: (last && repeat ? last.count : 0) + 1, error, logged },
      since: Phase.since(run),
      state: 'waiting',
      until: now + Clock.retryMs,
    })
    return now + Clock.retryMs
  }

  unreachable(now: number) {
    const agent = this.agent()
    if (!agent) return false
    if (agent.unreachable === null) this.kv.put('agent', { ...agent, unreachable: now })
    return agent.unreachable !== null && now - agent.unreachable >= unreachableMs
  }

  reached() {
    const agent = this.agent()
    if (agent && agent.unreachable !== null) this.kv.put('agent', { ...agent, unreachable: null })
  }

  abandon(agent: string, detail: string) {
    this.kv.delete('agent')
    this.log('error', "The agent's session stopped answering for 15 minutes, so the swarm starts a new agent with its goal, notes and updates; the old agent's workspace stays behind.", `${agent}: ${detail}`)
  }

  async lead(row: Store.Row): Promise<Lead | { detail: string; error: string }> {
    const payer = { secret: this.kv.get<string>('secret') ?? '', url: `${this.env.SWARMS_URL}/api/swarms/${row.id}/pay` }
    const known = this.agent()
    if (known) {
      if (known.url === payer.url) return this.styled(row, known)
      const patched = await Gateway.repay(this.env, row.id, known.id, payer)
      if (patched.ok) {
        const moved = { ...known, url: payer.url }
        this.kv.put('agent', moved)
        return this.styled(row, moved)
      }
      if (patched.status !== 404) return { detail: patched.detail, error: "The gateway did not move the agent's payer." }
      this.kv.delete('agent')
    }

    const styled = await Persona.ensure(this.env)
    const named = { name: row.title.slice(0, 60), payer }
    let created = await Gateway.agent(this.env, row.id, styled ? { ...named, persona: Persona.name } : named)
    const persona = styled && created.ok
    if (!created.ok && styled && created.status === 409) created = await Gateway.agent(this.env, row.id, named)
    if (!created.ok) return { detail: created.detail, error: 'The gateway did not create the agent.' }
    const agent: Lead = { briefed: false, cursor: 0, id: created.value.id, persona, unreachable: null, url: payer.url }
    this.kv.put('agent', agent)
    this.log('status', "Created the swarm's agent on the gateway. Every model call, machine and tool it pays for is paid from the contributions, one at a time.", created.value.id)
    await Branching.release(this, row.id, created.value.id).catch((error: unknown) => console.error('Releasing the old agent\'s branches failed', error))
    return agent
  }

  async styled(row: Store.Row, agent: Lead): Promise<Lead> {
    if (!(await Persona.ensure(this.env)) || agent.persona) return agent
    const patched = await Gateway.restyle(this.env, row.id, agent.id, Persona.name)
    if (!patched.ok && patched.status !== 409) {
      console.error('Giving the agent the swarm persona failed', patched.status, patched.detail)
      return agent
    }
    const styled = { ...agent, persona: true }
    this.kv.put('agent', styled)
    if (patched.ok) this.log('status', "Gave the agent the swarm's instructions on artifacts, appended to its system prompt.")
    return styled
  }

  cue(cue: Follow.Cue) {
    this.cues.set(cue, Date.now())
  }

  async finish(row: Store.Row, run: Turning, report: Gateway.Report) {
    Relay.ended(this)
    const n = run.n
    const error = typeof report.error === 'string' ? report.error : report.error?.message
    const message = report.ok?.message ?? error ?? null
    const status = report.status === 'completed' ? 'completed' : report.status === 'cancelled' ? 'cancelled' : 'failed'
    Follow.flush(this)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    for (const source of await Paying.sources(this, row)) await Paying.probe(this, row, source).catch(() => undefined)
    const money = await Money.refresh(this, row)
    const found = this.ctx.storage.sql
      .exec<{ base: string | null; spent_before: string }>('SELECT spent_before, base FROM turns WHERE n = ?', n)
      .toArray()[0]
    await Branching.settled(this, money.row).catch((error: unknown) => console.error('Settling closed branches failed', error))
    const repo = await Repo.located(this, money.row)
    const commits = repo.state === 'ready' ? await Repo.pushed(this, row.id, repo.name, found?.base ?? null) : []
    const spent = BigInt(money.row.spent) - BigInt(found?.spent_before ?? '0')
    this.ctx.storage.sql.exec(
      'UPDATE turns SET ended_at = ?, status = ?, message = ?, spent = ?, commits = ? WHERE n = ?',
      Date.now(),
      status,
      message === null ? null : redact(message),
      String(spent > 0n ? spent : 0n),
      JSON.stringify(commits.map((commit) => commit.sha)),
      n,
    )
    this.touch()
    const answer = status === 'completed' && message ? Answer.parse(redact(message), Date.now()) : undefined
    if (answer?.text) await Store.update(this.env, row.id, { answer: JSON.stringify(answer) })
    const ended = this.rows('WHERE n = ?', n)[0]
    if (ended) await Search.report(this.env, row.id, ended).catch((error: unknown) => console.error('Indexing the update failed', error))
    const pushed = commits.length ? ` and pushed ${commits.length} commit${commits.length === 1 ? '' : 's'} to ${repo.name}` : ''
    this.log(
      status === 'completed' ? 'status' : 'error',
      status === 'completed' ? `Posted an update after spending ${Words.dollars(spent > 0n ? spent : 0n)}${pushed}.` : `The agent stopped with an error after spending ${Words.dollars(spent > 0n ? spent : 0n)}${pushed}.`,
      status === 'completed' ? (commits.length ? commits.map((commit) => `${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0]}`).join('\n') : null) : message,
    )
    await this.publish(row.id)
    this.changed('detail')
    if (answer?.text) this.announce(`Update: ${Answer.excerpt(answer.text, 280)}`)

    const stored = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM feed WHERE seq > ? AND kind = 'tool' AND ((text || coalesce(detail, '')) LIKE '%kv_set%' OR (text || coalesce(detail, '')) LIKE '%bucket_put%' OR (text || coalesce(detail, '')) LIKE '%git_create%')", run.from).one().n
    if (stored > 0 || !this.kv.get<number>('published')) await this.expose(row).catch((error: unknown) => console.error('Making the swarm data public failed', error))
    const latest = this.run()
    const wanted = BigInt(latest.state === 'working' ? (latest.wanted ?? '0') : '0')
    if (status !== 'completed' && (money.left < Store.reserve || wanted > money.biggest)) {
      const wake = Paying.rested(this)
      await this.pause(money.row, wanted > money.biggest ? { wanted: String(wanted), why: 'costly' } : { left: String(money.left), wake, why: 'money' })
      return wanted > money.biggest ? null : wake
    }
    const failures = status === 'completed' ? 0 : this.failures(run.since)
    if (failures >= maxFailures) {
      await this.pause(money.row, { failures, why: 'rest' })
      return null
    }
    const until = status === 'completed' ? Math.max(Date.now(), run.started + quickMs) : Date.now() + settleMs
    await this.move(money.row, { since: run.since, state: 'waiting', until })
    return until
  }

  failures(since: number) {
    let count = 0
    for (const row of this.ctx.storage.sql.exec<{ status: string }>('SELECT status FROM turns WHERE started_at >= ? ORDER BY n DESC LIMIT ?', since, maxFailures).toArray()) {
      if (row.status === 'completed') break
      count += 1
    }
    return count
  }

  async expose(row: Store.Row) {
    const hidden: ['bucket' | 'git' | 'kv', string][] = []
    for (const [kind, page] of [['kv', (cursor: string | null) => Gateway.values(this.env, row.id, cursor).then((found) => found.ok ? { cursor: found.value.cursor, items: found.value.entries } : undefined)], ['bucket', (cursor: string | null) => Gateway.objects(this.env, row.id, cursor).then((found) => found.ok ? { cursor: found.value.cursor, items: found.value.objects } : undefined)]] as const) {
      let cursor: string | null = null
      for (let pages = 0; pages < 20; pages++) {
        const found: { cursor: string | null; items: { key: string; public: boolean }[] } | undefined = await page(cursor)
        if (!found) break
        for (const item of found.items) if (!item.public) hidden.push([kind, item.key])
        cursor = found.cursor
        if (!cursor) break
      }
    }
    const listed = await Gateway.repos(this.env, row.id)
    if (listed.ok) for (const repo of listed.value.repos) if (!repo.public) hidden.push(['git', repo.name])
    let shown = 0
    for (const [kind, name] of hidden) if ((await Gateway.reveal(this.env, row.id, kind, name)).ok) shown++
    this.kv.put('published', Date.now())
    console.log(JSON.stringify({ expose: row.id, hidden: hidden.length, shown }))
    if (shown) this.log('status', `Made ${shown} private item${shown === 1 ? '' : 's'} the agent stored public, so everything the swarm produces can be read by anyone.`, hidden.map(([kind, name]) => `${kind} ${name}`).join('\n'))
  }

  async sweep(row: Store.Row) {
    const started = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM feed WHERE seq > ? AND kind = 'machine' AND text LIKE 'Starting machine%'", this.kv.get<number>('sweptSeq') ?? 0).one().n
    if (!started && !(this.kv.get<Hand[]>('hands') ?? []).length) return
    const listed = await Gateway.sandboxes(this.env, row.id)
    if (!listed.ok) return
    this.kv.put('sweptSeq', this.last())
    for (const sandbox of listed.value.sandboxes.filter((found) => found.status !== 'terminated')) {
      const ended = await Gateway.terminate(this.env, row.id, sandbox.sandboxId)
      if (ended.ok) this.log('machine', `Shut down ${sandbox.hand ?? sandbox.sandboxId}, which was still running when the swarm stopped.`)
    }
  }

  async budget(secret: string, app: string | undefined): Promise<Paying.Paid> {
    const known = this.kv.get<string>('secret')
    if (!known || !Words.same(known, secret)) return { code: 'unauthorized', detail: 'Unknown payer secret.', status: 401 }
    const row = await this.found(this.kv.get<string>('id') ?? '')
    if (!row) return { code: 'unauthorized', detail: 'No swarm has this id.', status: 401 }
    if (app !== undefined && app !== Gateway.app(row.id)) return { code: 'unauthorized', detail: 'This payer pays only for its own swarm.', status: 401 }
    const summary = Store.summary(row)
    return { daily: '0.000000', raised: summary.raised, spent: summary.spent, usd: summary.remaining }
  }

  pay(input: Paying.Pay): Promise<Paying.Paid> {
    const secret = this.kv.get<string>('secret')
    if (!secret || !Words.same(secret, input.secret)) return Promise.resolve({ code: 'unauthorized', detail: 'Unknown payer secret.', status: 401 })
    const run = this.paying.then(() => Paying.charge(this, input))
    this.paying = run.catch(() => undefined)
    return run
  }

  async pause(row: Store.Row, pause: Phase.Pause) {
    const run = this.run()
    if (run.state === 'paused' && Phase.same(run.pause, pause)) return
    const text = Phase.reason(pause)
    if (Phase.since(run) !== null) {
      if (pause.why === 'rest') await this.sweep(row)
      if (this.turned()) this.announce(text)
    }
    const shown = Phase.paused(run)
    await this.move(row, { at: Date.now(), pause, state: 'paused' })
    if (shown?.why !== pause.why) this.log('status', text)
  }

  code(): Snapshot | null {
    const id = this.kv.get<string>('id')
    const repo = this.kv.get<string>('repo')
    const snapshot = this.kv.get<Snapshot>('snapshot')
    if (id && repo && (!snapshot || snapshot.name !== repo || Date.now() - snapshot.at > Repo.snapshotMs) && Date.now() - (this.kv.get<number>('snapping') ?? 0) > Repo.snapshotMs) {
      this.kv.put('snapping', Date.now())
      this.ctx.waitUntil(Repo.snapshot(this, id, repo).catch((error: unknown) => console.error('Reading the repository failed', error)))
    }
    return snapshot && snapshot.name === repo ? snapshot : null
  }

  async steer(swarm: string, noteId: string): Promise<Note | undefined> {
    const row = await this.found(swarm)
    const agent = this.agent()?.id
    const turn = this.turn()
    if (!turn) await this.wake('note')
    if (!row || !agent || !turn || !this.kv.get<string>('secret')) return undefined

    const note = (await this.notes(row)).find((found) => found.id === noteId)
    if (!note) return undefined
    const sent = await Gateway.prompt(this.env, swarm, agent, {
      prompt: weighed(this.tell([note])[0] ?? note),
      steer: true,
    })
    if (!sent.ok) return undefined

    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO steered (note, at, weight) VALUES (?, ?, ?)', note.id, Date.now(), String(Memo.units(note.weight)))
    this.kv.delete('collapse:' + note.id)
    this.touch()
    this.changed('detail')
    this.log(
      'steer',
      `Steered the agent toward "${clip(note.note, 120)}"`,
      `${Words.dollars(Memo.units(note.weight))} behind it, ${Words.percent(note.share)} of everything contributed`,
    )
    return note
  }

  async publish(swarm: string) {
    this.kv.put('shelvedAt', Date.now())
    const found = await Artifacts.list(this.env, swarm, false).catch(() => undefined)
    if (!found) return
    const known = this.kv.get<Record<string, Seen>>('artifacts') ?? {}
    const turn = this.turned()
    const next: Record<string, Seen> = {}
    for (const artifact of found) {
      const seen = known[artifact.slug]
      const changed = !!seen && seen.version !== artifact.version && seen.turn !== turn
      if (!seen) {
        this.log('status', `Published the artifact "${artifact.title}"`, [artifact.summary, `${Artifacts.base(swarm)}/${artifact.slug}/${artifact.entry}`].filter(Boolean).join('\n'))
        this.announce(`New artifact: ${artifact.title}${artifact.summary ? `, ${artifact.summary}` : ''}`, { slug: artifact.slug, title: artifact.title })
      }
      if (changed) this.log('status', `Updated the artifact "${artifact.title}" (version ${artifact.version})`, artifact.summary)
      next[artifact.slug] = { title: artifact.title, turn: !seen || changed ? turn : seen.turn, version: artifact.version }
    }
    const moved = Object.keys(next).length !== Object.keys(known).length || Object.entries(next).some(([slug, seen]) => known[slug]?.version !== seen.version)
    if (!moved) return
    this.kv.put('artifacts', next)
    if (this.listened()) this.broadcast({ artifacts: found, type: 'artifacts' })
  }

  messages(query: { after: number; before?: number | undefined; limit: number }): Said[] {
    const sql = this.ctx.storage.sql
    const columns = 'SELECT id, at, author, text, mentions, steer, artifact FROM chat'
    const rows =
      query.before !== undefined
        ? sql.exec<Record<string, SqlStorageValue>>(`${columns} WHERE id < ? ORDER BY id DESC LIMIT ?`, query.before, query.limit).toArray().reverse()
        : query.after > 0
          ? sql.exec<Record<string, SqlStorageValue>>(`${columns} WHERE id > ? ORDER BY id LIMIT ?`, query.after, query.limit).toArray()
          : sql.exec<Record<string, SqlStorageValue>>(`${columns} ORDER BY id DESC LIMIT ?`, query.limit).toArray().reverse()
    return rows.map(said)
  }

  chat(query: { after: number; before?: number | undefined; limit: number }) {
    const stamp = this.stamp()
    return { messages: this.messages(query), stamp }
  }

  async say(input: Spoken): Promise<Said> {
    this.marked += 1
    this.kv.put('id', input.swarm)
    let steer: Steer | null = null
    if (input.steer?.context) this.kv.put('collapse:' + input.steer.noteId, [...(this.kv.get<string[]>('collapse:' + input.steer.noteId) ?? []), input.steer.context])
    if (input.steer) {
      const sent = await this.steer(input.swarm, input.steer.noteId)
      const row = sent ? null : await this.found(input.swarm)
      const note = sent ?? (row ? await Store.note(this.env, row.id, input.steer.noteId, BigInt(row.raised), new Set(this.steered())) : undefined)
      steer = {
        amount: input.steer.amount,
        backers: note?.backers ?? 1,
        note: input.steer.note,
        live: !!sent,
        noteId: input.steer.noteId,
        share: note?.share ?? 0,
        weight: note?.weight ?? input.steer.amount,
      }
    }
    if (steer) this.changed('detail', 'members')
    return this.speak(input.author, redact(input.text), input.mentions, steer)
  }

  tell(notes: Note[]): Note[] {
    return notes.map((note) => {
      const collapsed = this.kv.get<string[]>('collapse:' + note.id)
      return collapsed?.length ? { ...note, note: collapsed.join('\n\n') } : note
    })
  }

  async subagents(swarm: string, fresh = false): Promise<Gateway.Result<{ agent: string | null; list: Gateway.Subagent[] }>> {
    const agent = this.agent()?.id
    if (!agent) return { ok: true, value: { agent: null, list: [] } }
    if (fresh) return Branching.list(this, swarm, agent)
    const known = this.listing?.agent === agent ? this.listing : undefined
    if (known && !known.pending && Date.now() - known.at < Branching.listingMs) return known.value
    const kept = this.kv.get<{ agent: string; at: number; list: Gateway.Subagent[] }>('subagents')
    if (kept?.agent === agent && Date.now() - kept.at < Branching.keptMs) {
      if (!known?.pending) this.ctx.waitUntil(Branching.list(this, swarm, agent).catch(() => undefined))
      return { ok: true, value: { agent, list: kept.list } }
    }
    return known?.pending ? known.value : Branching.list(this, swarm, agent)
  }

  async direct(
    swarm: string,
    input: { agent: string; branch: number; previous: number | null; said: string | null; steer?: { note: string; text: string; who: string }; usd: number | null; wake: string | null },
  ): Promise<Gateway.Result<Gateway.Subagent | null>> {
    const agent = this.agent()?.id
    if (!agent) return { detail: 'The swarm has no agent yet: it starts once money arrives.', ok: false, status: 409 }
    if (agent !== input.agent) return { detail: "The swarm started a new agent since its branches were listed; list them again.", ok: false, status: 409 }
    const set = input.usd === null ? undefined : await Branching.rebudget(this, swarm, agent, input.branch)
    if (set && !set.ok) return set

    if (input.steer) {
      const told = await Gateway.tell(this.env, swarm, agent, input.branch, input.steer.text, 'urgent')
      if (!told.ok) {
        if (set) await Gateway.budget(this.env, swarm, agent, input.branch, input.previous)
        return told
      }
      this.log('steer', input.steer.note, input.steer.text, { who: input.steer.who })
    } else if (input.wake) await Gateway.tell(this.env, swarm, agent, input.branch, input.wake)
    if (input.said) {
      if (!input.steer) this.log('funds', input.said)
      this.announce(input.said)
    }
    this.touch()
    this.changed('branches', 'members')
    return { ok: true, value: set ? Gateway.subagent(set.value.agent) : null }
  }

  async voice(swarm: string, text: string): Promise<Gateway.Result<true>> {
    this.kv.put('id', swarm)
    this.announce(text)
    return { ok: true, value: true }
  }

  async halt(swarm: string, input: { agent: string; branch: number; said: string }): Promise<Gateway.Result<Gateway.Subagent[]>> {
    const agent = this.agent()?.id
    if (!agent) return { detail: 'The swarm has no agent yet.', ok: false, status: 409 }
    if (agent !== input.agent) return { detail: "The swarm started a new agent since its branches were listed; list them again.", ok: false, status: 409 }
    const closed = await Gateway.close(this.env, swarm, agent, input.branch)
    if (!closed.ok) return closed
    if (this.turn())
      await Gateway.prompt(this.env, swarm, agent, { prompt: `${input.said} Backers stopped this branch: do not restart it, or give its work to another subagent, unless backers ask for it again.`, steer: true })
    this.log('status', input.said)
    this.announce(input.said)
    this.touch()
    this.changed('branches', 'members')
    return { ok: true, value: closed.value.agents.map(Gateway.subagent) }
  }

  paced(address: Address) {
    const now = Date.now()
    const key = 'said:' + address.toLowerCase()
    const recent = (this.kv.get<number[]>(key) ?? []).filter((at) => at > now - Clock.minuteMs)
    if (recent.length >= postsPerMinute) return false
    this.kv.put(key, [...recent, now])
    return true
  }

  vouched(address: Address, seals: readonly string[]) {
    const known = new Set(this.kv.get<string[]>('answered:' + address.toLowerCase()) ?? [])
    return seals.every((seal) => known.has(seal))
  }

  async btw(input: { address: Address; branch?: number; prompt: string; question: string; swarm: string }): Promise<Gateway.Result<string>> {
    this.kv.put('id', input.swarm)
    const agent = this.agent()?.id
    if (!agent) return { detail: 'The swarm has no agent yet: it starts once money arrives.', ok: false, status: 409 }
    const now = Date.now()
    const key = 'btw:' + input.address.toLowerCase()
    const recent = (this.kv.get<number[]>(key) ?? []).filter((at) => at > now - Clock.hourMs)
    const oldest = recent[0]
    if (recent.length >= Btw.perHour && oldest !== undefined)
      return { detail: `At most ${Btw.perHour} side questions an hour; the next one opens at ${Words.clock(oldest + Clock.hourMs)} UTC.`, ok: false, status: 429 }
    const everyone = (this.kv.get<number[]>('btw:*') ?? []).filter((at) => at > now - Clock.hourMs)
    const first = everyone[0]
    if (everyone.length >= Btw.perSwarmHour && first !== undefined)
      return { detail: `This swarm answers at most ${Btw.perSwarmHour} side questions an hour, from everyone; the next one opens at ${Words.clock(first + Clock.hourMs)} UTC.`, ok: false, status: 429 }
    this.kv.put(key, [...recent, now])
    this.kv.put('btw:*', [...everyone, now])

    const answered = input.branch === undefined ? await Gateway.side(this.env, input.swarm, agent, input.prompt) : await Gateway.ask(this.env, input.swarm, agent, input.branch, input.prompt)
    if (!answered.ok) {
      this.kv.put(key, recent)
      this.kv.put('btw:*', everyone)
      return answered
    }
    const answer = redact(answered.value.text)
    const sealed = 'answered:' + input.address.toLowerCase()
    this.kv.put(sealed, [...(this.kv.get<string[]>(sealed) ?? []), await Btw.seal({ answer, question: input.question })].slice(-200))
    return { ok: true, value: answer }
  }

  announce(text: string, artifact: Shown | null = null) {
    this.speak(null, redact(text), [], null, artifact)
  }

  speak(author: Address | null, text: string, mentions: Address[], steer: Steer | null, artifact: Shown | null = null): Said {
    const at = Date.now()
    const row = this.ctx.storage.sql
      .exec<{ id: number }>(
        'INSERT INTO chat (at, author, text, mentions, steer, artifact) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
        at,
        author,
        text,
        JSON.stringify(mentions),
        steer ? JSON.stringify(steer) : null,
        artifact ? JSON.stringify(artifact) : null,
      )
      .one()
    const message: Said = { artifact, at, author, id: Number(row.id), mentions, steer, text }
    this.touch()
    this.broadcast({ message, type: 'said' })
    return message
  }

  socket(request: Request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Open the room as a WebSocket.', { status: 426 })
    if (this.ctx.getWebSockets().length >= socketsMost) return new Response('This room is full right now; read it over HTTP.', { status: 503 })
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    const listening = new URL(request.url).searchParams.get('listen') === '1'
    this.ctx.acceptWebSocket(server, listening ? ['listen'] : [])
    server.serializeAttachment({ address: null })
    server.send(JSON.stringify({ type: 'welcome', version: this.stamp().version } satisfies Chatter))
    if (!listening) this.presence()
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== 'string' || data.length > 1000) return
    let event: { token?: unknown; type?: unknown }
    try {
      event = JSON.parse(data) as typeof event
    } catch {
      return
    }
    const now = Date.now()
    const state = (socket.deserializeAttachment() ?? {}) as Attached
    if (event.type === 'hello') {
      if (now - (state.hello ?? 0) < helloMs || this.ctx.getTags(socket).includes('listen')) return
      socket.serializeAttachment({ ...state, hello: now })
      const token = typeof event.token === 'string' ? event.token.slice(0, 200) : ''
      const known = this.holders.get(token)
      const address = known && now - known.at < holderMs ? known.address : token ? await Sessions.holder(this.env, token) : undefined
      if (token) this.holders.set(token, { address, at: now })
      if (this.holders.size > 1000) this.holders.delete(this.holders.keys().next().value as string)
      socket.serializeAttachment({ ...state, address: address ?? null, hello: now })
      this.presence()
    }
    if (event.type === 'typing') {
      const address = attached(socket)
      if (!address || now - (state.typing ?? 0) < typingMs) return
      socket.serializeAttachment({ ...state, typing: now })
      this.broadcast({ address, type: 'typing' }, socket)
    }
  }

  override async webSocketClose(socket: WebSocket, code: number) {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, 'Closed')
    } catch {}
    this.presence(socket)
  }

  override async webSocketError(socket: WebSocket) {
    this.presence(socket)
  }

  presence(gone?: WebSocket) {
    const sockets = this.ctx.getWebSockets().filter((socket) => socket !== gone && !this.ctx.getTags(socket).includes('listen'))
    const online = [...new Set(sockets.flatMap((socket) => attached(socket) ?? []))]
    this.broadcast({ online, type: 'presence', watching: sockets.length }, gone)
  }

  broadcast(event: Chatter, except?: WebSocket) {
    const data = JSON.stringify(event)
    for (const socket of this.ctx.getWebSockets())
      if (socket !== except)
        try {
          socket.send(data)
        } catch {}
  }

  async notes(row: Store.Row) {
    return Store.notes(this.env, row.id, BigInt(row.raised), new Set(this.steered()))
  }

  told() {
    return new Map(
      this.ctx.storage.sql
        .exec<{ note: string; weight: string | null }>('SELECT note, weight FROM steered')
        .toArray()
        .map((row) => [row.note, row.weight === null ? null : BigInt(row.weight)] as const),
    )
  }

  steered() {
    return this.ctx.storage.sql
      .exec<{ note: string }>('SELECT note FROM steered')
      .toArray()
      .map((row) => row.note)
  }

  log(kind: Kind, text: string, detail?: string | null, origin: { at?: number; event?: number; who?: string | null } = {}) {
    const logged = {
      at: origin.at ?? Date.now(),
      detail: detail ? redact(detail) : null,
      event: origin.event ?? null,
      kind,
      text: redact(text),
      who: origin.who ?? null,
    }
    const row = this.ctx.storage.sql
      .exec<{ seq: number }>(
        'INSERT INTO feed (at, kind, text, detail, who, event) VALUES (?, ?, ?, ?, ?, ?) RETURNING seq',
        logged.at,
        logged.kind,
        logged.text,
        logged.detail,
        logged.who,
        logged.event,
      )
      .one()
    this.ctx.storage.sql.exec(`INSERT INTO feed_search (rowid, body) SELECT seq, ${searchable} FROM feed WHERE seq = ?`, row.seq)
    this.touch()
    if (!this.turn()) this.changed('feed')
    if (!this.watchers.size) return
    const bytes = Relay.encoded({ entry: { ...logged, seq: Number(row.seq) }, type: 'entry' })
    for (const watcher of this.watchers) if (watcher.follow || watcher.relaying) Relay.write(this, watcher, bytes)
  }
}

type Pending = { at: number; parts: Set<Part>; pulse: Store.Row | undefined; timer: ReturnType<typeof setTimeout> | undefined }

const maxWaitMs = 60_000

const coalesceMs = 2_000

const viewKeys = new Set(['run', 'hands', 'repo', 'owner', 'id'])

type Attached = { address?: Address | null; hello?: number; typing?: number }

const helloMs = 10_000

const holderMs = 300_000

const typingMs = 2_000

const socketsMost = 500

const postsPerMinute = 10

function touched(kv: SyncKvStorage, touch: () => void): SyncKvStorage {
  return {
    delete(key) {
      const deleted = kv.delete(key)
      if (viewKeys.has(key)) touch()
      return deleted
    },
    get: (key) => kv.get(key),
    list: (options) => kv.list(options),
    put(key, value) {
      kv.put(key, value)
      if (viewKeys.has(key)) touch()
    },
  }
}

function brief(row: Store.Row, notes: Note[]) {
  return [row.title, row.goal, ...notes.map(weighed)].filter(Boolean).join('\n\n')
}

function next(notes: Note[]) {
  return ['Keep going.', ...notes.map(weighed)].join('\n\n')
}

function grown(told: bigint | null | undefined, weight: bigint) {
  if (told === undefined) return true
  if (told === null) return false
  return weight >= told + (told / 4n > 100_000n ? told / 4n : 100_000n)
}

function weighed(note: Note) {
  const backers = note.backers === 1 ? '1 backer' : `${note.backers} backers`
  return `[${Words.dollars(Memo.units(note.weight))} behind this, from ${backers}] ${Mention.claimed(note.note)}`
}

function updates(turns: readonly Search.Turn[]): Update[] {
  return turns.flatMap((turn) => {
    if (turn.status !== 'completed' || !turn.message || turn.endedAt === null) return []
    const answer = Answer.parse(turn.message, turn.endedAt)
    return answer.text ? [{ at: turn.endedAt, base: turn.base, commits: turn.commits, done: answer.done, spent: turn.spent, text: answer.text }] : []
  })
}

function said(row: Record<string, SqlStorageValue>): Said {
  return {
    artifact: row['artifact'] === null || row['artifact'] === undefined ? null : (JSON.parse(String(row['artifact'])) as Shown),
    at: Number(row['at']),
    author: row['author'] === null ? null : (String(row['author']) as Address),
    id: Number(row['id']),
    mentions: JSON.parse(String(row['mentions'] ?? '[]')) as Address[],
    steer: row['steer'] === null ? null : (JSON.parse(String(row['steer'])) as Steer),
    text: String(row['text']),
  }
}

function attached(socket: WebSocket) {
  const attachment = socket.deserializeAttachment() as { address: Address | null } | null
  return attachment?.address ?? undefined
}

function entry(row: Record<string, SqlStorageValue>): Entry {
  return {
    at: Number(row['at']),
    detail: row['detail'] === null ? null : String(row['detail']),
    event: row['event'] === null || row['event'] === undefined ? null : Number(row['event']),
    kind: String(row['kind']) as Kind,
    seq: Number(row['seq']),
    text: String(row['text']),
    who: row['who'] === null || row['who'] === undefined ? null : String(row['who']),
  }
}
