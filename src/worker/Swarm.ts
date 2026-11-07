import { DurableObject } from 'cloudflare:workers'
import type { Address } from 'viem'
import type { Chatter, Code, Currency, Entry, Hand, Kind, Live, Note, Part, Pulse, Roster, Said, Snapshot, Steer, Update, Working } from '../shared/Api.ts'
import { clip, redact } from '../shared/Trail.ts'
import * as Btw from '../shared/Btw.ts'
import * as Fleet from '../shared/Fleet.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Artifacts from './Artifacts.ts'
import * as Chain from './Chain.ts'
import * as Gateway from './Gateway.ts'
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
import * as Follow from './Follow.ts'
import * as Repo from './Repo.ts'
import * as Branching from './Branching.ts'
import * as Chat from './Chat.ts'
import * as Turns from './Turns.ts'
import * as Feed from './Feed.ts'

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

const healMs = 5 * 60_000

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
  born = Date.now()
  branched = 0
  reported: Gateway.Report | undefined
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
  window: { close: (at: number) => void; live: boolean; stop: AbortController } | undefined
  fails = 0
  cues = new Map<Follow.Cue, number>()
  polled = new Map<Follow.Cue, number>()
  held: Vault.Balances | undefined
  pledged = { biggest: 0n, left: 0n, spent: 0n }
  waiters = new Set<() => void>()
  pending: Pending = { at: 0, parts: new Set(), pulse: undefined, timer: undefined }
  holders = new Map<string, { address: Address | undefined; at: number }>()
  steady: Store.Row | undefined
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

  async found(id: string) {
    const row = await this.memo(`row:${id}`, id, () => Store.find(this.env, id), (row) => !!row?.wallet)
    if (row?.wallet) this.steady = structuredClone(row)
    return row
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
      Chat.announce(this, `${Mention.at((await Store.account(this.env, input.contributor)).handle)} put the ${Words.trim(input.amount)} ${Chain.symbol(input.token)} they sent behind "${input.note ?? ''}".`)
      if (input.noteId) await this.steer(input.swarm, input.noteId)
      this.changed('detail', 'members')
      return this.wake('note')
    }
    this.log(
      'funds',
      `${Words.short(input.contributor)} sent ${Words.trim(input.amount)} ${Chain.symbol(input.token)}${input.note ? ' with a note' : ''}`,
      [input.note, input.hash].filter(Boolean).join('\n'),
    )
    Chat.announce(this, `${Mention.at((await Store.account(this.env, input.contributor)).handle)} sent ${Words.trim(input.amount)} ${Chain.symbol(input.token)}${input.note ? ` behind "${input.note}"` : ''}.`)
    if (input.noteId) await this.steer(input.swarm, input.noteId)
    this.cue('chain')
    this.cue('sponsors')
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
    if (pulse) Chat.broadcast(this, { ...this.pulsed(pulse), type: 'pulse', version })
    if (parts.size) Chat.broadcast(this, { parts: [...parts].sort(), type: 'changed', version })
  }

  pulsed(row: Store.Row): Pulse {
    const paused = Phase.paused(this.run())
    return { hands: this.kv.get<Hand[]>('hands') ?? [], reason: paused ? Phase.reason(paused) : null, swarm: Store.summary(row), why: paused?.why ?? null, working: this.working() }
  }

  rostered(roster: Roster) {
    Chat.broadcast(this, { roster, type: 'roster' })
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
    this.kv.put('issued', Date.now())
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
      if (row) await Turns.expose(this, row).catch((error: unknown) => console.error('Making the swarm data public failed', error))
      this.kv.delete('exposing')
    }
    await Feed.reindex(this)
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
          .map(Feed.entry)
      : []
    const id = this.kv.get<string>('id')
    const repo = this.kv.get<string>('repo')
    const owner = this.kv.get<string>('owner')
    const turns = shape.pushed ? Feed.rows(this, Feed.pushedTurns) : this.turns()
    const shown = shape.pushed ? Feed.updates(turns).filter((update, index, all) => update.commits.length > 0 || index === all.length - 1) : Feed.updates(turns)
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
    return { turns, updates: Feed.updates(turns), working: this.working() }
  }

  latest(after: number): { update: Update | null; working: Working | null } {
    return { update: Feed.updates(Feed.rows(this, Feed.newerTurns, after)).at(-1) ?? null, working: this.working() }
  }

  recent(limit: number): { updates: Update[]; working: Working | null } {
    return { updates: Feed.updates(Feed.rows(this, Feed.lastTurns, limit + 10)).slice(-limit), working: this.working() }
  }

  working(): Working | null {
    const since = Phase.since(this.run())
    return since === null ? null : { since }
  }

  turns(after = 0): Search.Turn[] {
    return Feed.rows(this, 'WHERE n > ?', after)
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
    return (filter.before === undefined ? rows : rows.reverse()).map(Feed.entry)
  }

  fleet(): Fleet.Machine[] {
    return Fleet.folded(this.feed(0, { before: Number.MAX_SAFE_INTEGER, kinds: ['tool', 'output', 'error', 'machine'], limit: 2000 }), this.kv.get<Hand[]>('hands') ?? [])
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
    if (!indexed) this.ctx.waitUntil(Feed.reindex(this))
    const score = terms.map(() => "(instr(lower(text || ' ' || coalesce(detail, '')), ?) > 0)").join(' + ')
    const [query, ...values]: [string, ...(string | number)[]] = indexed
      ? [
          'SELECT f.seq, f.at, f.kind, f.text, f.detail, f.who, f.event FROM (SELECT rowid, rank FROM feed_search WHERE feed_search MATCH ? ORDER BY rank, rowid DESC LIMIT ?) s JOIN feed f ON f.seq = s.rowid ORDER BY s.rank, f.seq DESC',
          terms.map((term) => `"${term}"`).join(' OR '),
          limit,
        ]
      : [
          `SELECT seq, at, kind, text, detail, who, event FROM (SELECT *, ${score} AS score FROM (SELECT * FROM feed ORDER BY seq DESC LIMIT ${Feed.searched})) WHERE score > 0 ORDER BY score DESC, seq DESC LIMIT ?`,
          ...terms,
          limit,
        ]
    return this.ctx.storage.sql.exec<Record<string, SqlStorageValue>>(query, ...values).toArray().map(Feed.entry)
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
    const indexing = Feed.indexed(this)
    this.stepping ??= Turns.step(this)
      .catch((error: unknown) => {
        this.log('error', 'The swarm hit an error and will retry.', String(error))
        return Date.now() + Clock.retryMs
      })
      .finally(() => {
        this.stepping = undefined
      })
    const stepped = await this.stepping
    const next = indexing && this.run().state === 'paused' ? Math.min(stepped ?? Infinity, Date.now() + Feed.indexMs) : stepped
    if (next === null) return
    const pending = await this.ctx.storage.getAlarm()
    await this.ctx.storage.setAlarm(pending !== null && pending < next ? pending : next)
  }

  cue(cue: Follow.Cue) {
    const now = Date.now()
    this.cues.set(cue, now)
    this.window?.close(Follow.until(this, now))
  }

  async budget(secret: string, app: string | undefined): Promise<Paying.Paid> {
    const known = this.kv.get<string>('secret')
    if (!known || !Words.same(known, secret)) return { code: 'unauthorized', detail: 'Unknown payer secret.', status: 401 }
    const row = await this.found(this.kv.get<string>('id') ?? '')
    if (!row) return { code: 'unauthorized', detail: 'No swarm has this id.', status: 401 }
    if (app !== undefined && app !== Gateway.app(row.id)) return { code: 'unauthorized', detail: 'This payer pays only for its own swarm.', status: 401 }
    const summary = Store.summary(row)
    const page = new URL(`/s/${row.id}`, this.env.SWARMS_URL).href
    return { daily: '0.000000', page, raised: summary.raised, room: new URL(`/v1/swarms/${row.id}/chat`, this.env.SWARMS_URL).href, spent: summary.spent, swarm: row.id, usd: summary.remaining }
  }

  pay(input: Paying.Pay): Promise<Paying.Paid> {
    const secret = this.kv.get<string>('secret')
    if (!secret || !Words.same(secret, input.secret)) return Promise.resolve({ code: 'unauthorized', detail: 'Unknown payer secret.', status: 401 })
    return Paying.queued(this, input)
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
      prompt: Turns.weighed(this.tell([note])[0] ?? note),
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
        Chat.announce(this, `New artifact: ${artifact.title}${artifact.summary ? `, ${artifact.summary}` : ''}`, { slug: artifact.slug, title: artifact.title })
      }
      if (changed) this.log('status', `Updated the artifact "${artifact.title}" (version ${artifact.version})`, artifact.summary)
      next[artifact.slug] = { title: artifact.title, turn: !seen || changed ? turn : seen.turn, version: artifact.version }
    }
    const moved = Object.keys(next).length !== Object.keys(known).length || Object.entries(next).some(([slug, seen]) => known[slug]?.version !== seen.version)
    if (!moved) return
    this.kv.put('artifacts', next)
    if (this.listened()) Chat.broadcast(this, { artifacts: found, type: 'artifacts' })
  }

  chat(query: { after: number; before?: number | undefined; limit: number }) {
    const stamp = this.stamp()
    return { messages: Chat.messages(this, query), stamp }
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
    return Chat.speak(this, input.author, redact(input.text), input.mentions, steer)
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
      Chat.announce(this, input.said)
    }
    this.touch()
    this.changed('branches', 'members')
    return { ok: true, value: set ? Gateway.subagent(set.value.agent) : null }
  }

  async voice(swarm: string, text: string): Promise<Gateway.Result<true>> {
    this.kv.put('id', swarm)
    Chat.announce(this, text)
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
    Chat.announce(this, input.said)
    this.touch()
    this.changed('branches', 'members')
    return { ok: true, value: closed.value.agents.map(Gateway.subagent) }
  }

  paced(address: Address) {
    const now = Date.now()
    const key = 'said:' + address.toLowerCase()
    const recent = (this.kv.get<number[]>(key) ?? []).filter((at) => at > now - Clock.minuteMs)
    if (recent.length >= Chat.postsPerMinute) return false
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

  socket(request: Request) {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('Open the room as a WebSocket.', { status: 426 })
    if (this.ctx.getWebSockets().length >= Chat.socketsMost) return new Response('This room is full right now; read it over HTTP.', { status: 503 })
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    const listening = new URL(request.url).searchParams.get('listen') === '1'
    this.ctx.acceptWebSocket(server, listening ? ['listen'] : [])
    this.window?.close(Follow.until(this, Date.now()))
    server.serializeAttachment({ address: null })
    server.send(JSON.stringify({ type: 'welcome', version: this.stamp().version } satisfies Chatter))
    if (!listening) Chat.presence(this)
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
    const state = (socket.deserializeAttachment() ?? {}) as Chat.Attached
    if (event.type === 'hello') {
      if (now - (state.hello ?? 0) < Chat.helloMs || this.ctx.getTags(socket).includes('listen')) return
      socket.serializeAttachment({ ...state, hello: now })
      const token = typeof event.token === 'string' ? event.token.slice(0, 200) : ''
      const known = this.holders.get(token)
      const address = known && now - known.at < Chat.holderMs ? known.address : token ? await Sessions.holder(this.env, token) : undefined
      if (token) this.holders.set(token, { address, at: now })
      if (this.holders.size > 1000) this.holders.delete(this.holders.keys().next().value as string)
      socket.serializeAttachment({ ...state, address: address ?? null, hello: now })
      Chat.presence(this)
    }
    if (event.type === 'typing') {
      const address = Chat.attached(socket)
      if (!address || now - (state.typing ?? 0) < Chat.typingMs) return
      socket.serializeAttachment({ ...state, typing: now })
      Chat.broadcast(this, { address, type: 'typing' }, socket)
    }
  }

  override async webSocketClose(socket: WebSocket, code: number) {
    try {
      socket.close(code === 1005 || code === 1006 ? 1000 : code, 'Closed')
    } catch {}
    Chat.presence(this, socket)
  }

  override async webSocketError(socket: WebSocket) {
    Chat.presence(this, socket)
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
    this.ctx.storage.sql.exec(`INSERT INTO feed_search (rowid, body) SELECT seq, ${Feed.searchable} FROM feed WHERE seq = ?`, row.seq)
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
