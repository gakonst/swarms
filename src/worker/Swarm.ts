import { DurableObject } from 'cloudflare:workers'
import type { Account, Address, Hex } from 'viem'
import { isAddress } from 'viem'
import { Challenge } from 'mppx'
import { Mppx, tempo } from 'mppx/client'
import type { Chatter, Code, Currency, Entry, Hand, Kind, Live, Note, Part, Pulse, Roster, Said, Shown, Snapshot, Steer, Update, Working } from '../shared/Api.ts'
import { type Buffers, type Crew, clip, crew, narrate, redact, subagent, tool } from '../shared/Trail.ts'
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
import * as Seal from './Seal.ts'
import * as Search from './Search.ts'
import * as Sessions from './Sessions.ts'
import * as Lobby from './Lobby.ts'
import * as Store from './Store.ts'
import * as Vault from './Vault.ts'

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

export type Pay = {
  amount?: string | undefined
  app?: string | undefined
  operation?: string | undefined
  path?: string | undefined
  attempt?: number | undefined
  challenge: string | string[]
  channels?: Payer.Snapshot[] | undefined
  hand?: string | undefined
  recipient?: Address | undefined
  rejected?: { detail: string; status: number } | undefined
  secret: string
}

export type Paid = { authorization: string; topUp?: string } | { feeToken: Address } | Budget | { code: string; detail: string; retry?: number; status: 401 | 402 | 429 }

type Budget = { daily: string; raised: string; spent: string; usd: string }

type Source = { currency: Address; id: string; label: string }

type Signer = { account: Account; key: Hex }

type Room = { amount: bigint; resets: number | null }

type Money = { biggest: bigint; left: bigint; row: Store.Row }

type Repo = { name: string; state: 'none' | 'ready' }

type Seen = { title: string; turn: number; version: number }

type Lead = { briefed: boolean; cursor: number; id: string; persona: boolean; unreachable: number | null; url: string }

type Turning = Extract<Phase.Run, { state: 'working' }>

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

const followMs = 2_000

const refreshMs = 10_000

const healMs = 5 * 60_000

const hourMs = 3_600_000

const retryMs = 30_000

const unreachableMs = 15 * 60_000

const maxFailures = 3

const settleMs = 15_000

const quickMs = 60_000

const passCall = 250_000n

const vendorCap = passCall

const passHour = 1_000_000n

type Passed = { amount: string; at: number; host: string }

const dayMs = 86_400_000

const pullMs = 120_000

function earned(hand: Gateway.Listed) {
  const charges = hand['charges'] as { usd?: unknown } | null | undefined
  return typeof charges?.usd === 'number' && charges.usd > 0 ? Memo.units(charges.usd.toFixed(6)) : 0n
}

function asked(input: Pay) {
  const stated = Memo.units(/^\d+(\.\d{1,6})?$/.test(input.amount ?? '') ? (input.amount as string) : '0')
  const signed = (Array.isArray(input.challenge) ? input.challenge : [input.challenge]).map((serialized) => {
    try {
      const amount = (Challenge.deserialize(serialized).request as { amount?: unknown }).amount
      return typeof amount === 'string' && /^\d{1,19}$/.test(amount) ? BigInt(amount) : 0n
    } catch {
      return 0n
    }
  })
  return signed.reduce((most, amount) => (amount > most ? amount : most), stated)
}

function passHost(input: Pay) {
  try {
    return new URL(input.path ?? '').host || 'a paid service'
  } catch {
    return 'a paid service'
  }
}

const quietMs = 600_000
const snapshotMs = 60_000
const snapshotFiles = 2_000
const snapshotText = 64_000


const restMs = 10 * 60_000

const smallestSwap = 10_000n

const chunk = 100_000n

const handChunk = 50_000n

const perCall = Store.perCall

const recentMs = 10_000

const holdMs = 90_000

const heldMs = 10 * 60_000

const shelfMs = 30_000

const rowMs = 10_000

const stillMs = 2_000

const listingMs = 2_000

const keptMs = 10 * 60_000

const keptBytes = 1_000_000

export class Swarm extends DurableObject<Cloudflare.Env> {
  stepping: Promise<number | null> | undefined
  paying: Promise<unknown> = Promise.resolve()
  funding: Promise<void> | undefined
  wallet: Promise<unknown> = Promise.resolve()
  checked = 0
  vended = 0
  signers = new Map<string, Promise<Signer>>()
  clients = new Map<string, Payer.Client>()
  memos = new Map<string, { at: number; epoch: number; marked: number; value: unknown }>()
  marked = 0
  boot = crypto.randomUUID().slice(0, 8)
  touches = 0
  stamped = { at: 0, tuple: '' }
  kept: SyncKvStorage | undefined
  watchers = new Set<Watcher>()
  ring: Ring = { bytes: 0, frames: [] }
  window: { live: boolean; stop: AbortController } | undefined
  fails = 0
  cues = new Map<Cue, number>()
  polled = new Map<Cue, number>()
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
      this.log('funds', `${short(input.contributor)} put the ${trim(input.amount)} ${Chain.symbol(input.token)} they sent behind a note`, [input.note, input.hash].filter(Boolean).join('\n'))
      this.announce(`${Mention.at((await Store.account(this.env, input.contributor)).handle)} put the ${trim(input.amount)} ${Chain.symbol(input.token)} they sent behind "${input.note ?? ''}".`)
      if (input.noteId) await this.steer(input.swarm, input.noteId)
      this.changed('detail', 'members')
      return this.wake('note')
    }
    this.log(
      'funds',
      `${short(input.contributor)} sent ${trim(input.amount)} ${Chain.symbol(input.token)}${input.note ? ' with a note' : ''}`,
      [input.note, input.hash].filter(Boolean).join('\n'),
    )
    this.announce(`${Mention.at((await Store.account(this.env, input.contributor)).handle)} sent ${trim(input.amount)} ${Chain.symbol(input.token)}${input.note ? ` behind "${input.note}"` : ''}.`)
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
    if (!follow && !streaming) return sse(`data: ${JSON.stringify({ type: 'idle' } satisfies Live)}\n\n`)

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const watcher: Watcher = { follow, relaying: false, until: Date.now() + followForMs, writer: writable.getWriter() }
    this.watchers.add(watcher)
    request.signal.addEventListener('abort', () => this.unwatch(watcher), { once: true })
    if (follow) {
      if (!streaming) this.write(watcher, encoded({ type: 'idle' }))
      const backlog = this.feed(Number(after), { limit: backlogSize })
      for (const found of backlog) this.write(watcher, encoded({ entry: found, type: 'entry' }))
      if (backlog.length === backlogSize) {
        this.unwatch(watcher)
        return sse(readable)
      }
    }
    if (streaming) this.join(watcher)
    this.beat()
    return sse(readable)
  }

  streaming() {
    return !!(this.kv.get<string>('id') && this.agent() && this.turn() && this.kv.get<string>('secret'))
  }

  join(watcher: Watcher) {
    if (watcher.relaying || !this.watchers.has(watcher)) return
    watcher.relaying = true
    this.write(watcher, encoded({ at: this.working()?.since ?? Date.now(), type: 'start' }))
    for (const frame of this.ring.frames) if (!this.write(watcher, frame)) return
    if (this.window && !this.window.live) this.poke()
  }

  poke() {
    this.window?.stop.abort()
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now()))
  }

  relay(event: Live) {
    if (!this.watchers.size) return
    const bytes = encoded(event)
    this.ring.frames.push(bytes)
    this.ring.bytes += bytes.byteLength
    while (this.ring.bytes > ringBytes && this.ring.frames.length > 1) this.ring.bytes -= this.ring.frames.shift()?.byteLength ?? 0
    for (const watcher of this.watchers) if (watcher.relaying) this.write(watcher, bytes)
  }

  begin() {
    this.ring = { bytes: 0, frames: [] }
    this.fails = 0
    for (const watcher of this.watchers) this.join(watcher)
  }

  ended() {
    const bytes = encoded({ type: 'end' })
    for (const watcher of [...this.watchers])
      if (watcher.relaying) {
        this.write(watcher, bytes)
        watcher.relaying = false
        if (!watcher.follow) this.unwatch(watcher)
      }
    this.ring = { bytes: 0, frames: [] }
  }

  write(watcher: Watcher, bytes: Uint8Array) {
    if (!this.watchers.has(watcher)) return false
    if ((watcher.writer.desiredSize ?? 0) < -backlogSize) {
      this.unwatch(watcher)
      return false
    }
    watcher.writer.write(bytes).catch(() => this.unwatch(watcher))
    return true
  }

  unwatch(watcher: Watcher) {
    if (!this.watchers.delete(watcher)) return
    watcher.writer.close().catch(() => undefined)
    if (!this.watchers.size && this.beating !== undefined) {
      clearInterval(this.beating)
      this.beating = undefined
    }
  }

  beat() {
    this.beating ??= setInterval(() => {
      const now = Date.now()
      for (const watcher of this.watchers)
        if (watcher.follow && !watcher.relaying && now > watcher.until) this.unwatch(watcher)
        else this.write(watcher, keepalive)
    }, beatMs)
  }

  override async alarm() {
    const indexing = this.index()
    this.stepping ??= this.step()
      .catch((error: unknown) => {
        this.log('error', 'The swarm hit an error and will retry.', String(error))
        return Date.now() + retryMs
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
    if (run.state === 'working') return this.follow(row, run)
    return this.advance(row)
  }

  initialize() {
    if (this.kv.get<string>('secret')) return
    const run = this.run()
    if (run.state === 'working') this.ctx.storage.sql.exec("UPDATE turns SET status = 'cancelled', ended_at = ? WHERE n = ? AND status = 'running'", Date.now(), run.n)
    if (run.state === 'working' || run.state === 'starting') this.set({ since: null, state: 'waiting', until: Date.now() })
    this.kv.delete('agent')
    this.kv.put('secret', hex(crypto.getRandomValues(new Uint8Array(32))))
  }

  async advance(row: Store.Row) {
    const run = this.run()
    const worked = this.turned()
    await this.fund(row)
    const money = await this.refresh(row)
    if (run.state !== 'starting' && money.left < Store.reserve) {
      const wake = this.rested()
      await this.pause(money.row, worked || money.row.contributors ? { left: String(money.left), wake, why: 'money' } : { why: 'unfunded' })
      return wake
    }
    const repo = await this.repo(row)

    const agent = await this.lead(row)
    if ('error' in agent) return this.retry(money.row, agent.error, agent.detail)

    const n = run.state === 'starting' ? run.n : worked + 1
    const since = Phase.since(run)
    const notes = await this.notes(money.row)
    const base = repo.state === 'ready' ? await this.head(row.id, repo.name) : null
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
    await this.cap(row, money.left / Hands.share)
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
    this.begin()
    this.log('status', start.since === null ? `${worked ? 'Back at work' : 'Started working'}.` : 'Told the agent to keep going.', text)
    if (start.since === null) this.announce(`${worked ? 'Back at work' : 'Started working'}.`)
    return now + followMs
  }

  async retry(row: Store.Row, error: string, detail: string) {
    const run = this.run()
    const now = Date.now()
    const last = run.state === 'waiting' ? run.retry : undefined
    const repeat = last?.error === error
    const logged = last && repeat && now - last.logged < quietMs ? last.logged : now
    if (logged === now) this.log('error', error, detail)
    await this.move(row, {
      ...(run.state === 'waiting' && run.from ? { from: run.from } : {}),
      retry: { count: (last && repeat ? last.count : 0) + 1, error, logged },
      since: Phase.since(run),
      state: 'waiting',
      until: now + retryMs,
    })
    return now + retryMs
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
    await this.release(row.id, created.value.id).catch((error: unknown) => console.error('Releasing the old agent\'s branches failed', error))
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

  async follow(row: Store.Row, run: Turning) {
    const agent = this.agent()
    if (!agent) return this.finish(row, run, { error: 'The agent is gone.', request_id: run.turn, status: 'failed' })

    let ended = false
    let down = false
    const window = this.fails < streamFails ? await this.listen(row, agent, run) : undefined
    if (window) {
      this.fails = 0
      ended = window.ended
    } else {
      if (this.fails < streamFails) this.fails += 1
      let cursor = agent.cursor
      for (let page = 0; page < 5; page++) {
        const read = await Gateway.events(this.env, row.id, agent.id, cursor)
        if (!read.ok) {
          down = read.status >= 500
          break
        }
        if (read.value.events.length) this.reached()
        for (const event of read.value.events) ended = this.digest(event, run.turn) || ended
        if (read.value.next_cursor !== cursor) this.kv.put('agent', { ...(this.agent() ?? agent), cursor: read.value.next_cursor })
        cursor = read.value.next_cursor
        if (!read.value.has_more) break
      }
    }

    const now = Date.now()
    if (!window && !ended && now - this.checked < refreshMs) return now + followMs

    this.checked = now
    const plan = window ? this.plan(now) : { ...everything, artifacts: now - (this.kv.get<number>('shelvedAt') ?? 0) >= shelfMs, git: true, turn: true }
    const refreshing = plan.chain || plan.hands || plan.sponsors
    const [report, money] = await Promise.all([
      ended || plan.turn ? Gateway.turn(this.env, row.id, agent.id, run.turn) : undefined,
      refreshing ? this.refresh(row, plan) : undefined,
      plan.git ? this.watch(row) : undefined,
      plan.artifacts ? this.publish(row.id) : undefined,
    ])
    if (report?.ok && !['queued', 'running'].includes(report.value.status)) return this.finish(row, run, report.value)
    if (report && !report.ok && report.status !== 401 && report.status < 500)
      return this.finish(row, run, { error: report.detail, request_id: run.turn, status: 'failed' })
    if ((down || (report && !report.ok && report.status >= 500)) && this.unreachable(now)) {
      const detail = !report || report.ok ? 'its events did not load' : report.detail
      await Gateway.cancel(this.env, row.id, agent.id, run.turn).catch(() => undefined)
      this.abandon(agent.id, detail)
      return this.finish(row, run, { error: `The agent's session stopped answering: ${detail}`, request_id: run.turn, status: 'failed' })
    }
    if (money && plan.chain && (money.left < Store.reserve + Store.headroom || BigInt(this.kv.get<string>('loose') ?? '0') >= smallestSwap)) await this.fund(money.row)
    return window ? Date.now() : now + followMs
  }

  async listen(row: Store.Row, agent: Lead, run: Turning): Promise<{ ended: boolean } | undefined> {
    const stop = new AbortController()
    const live = [...this.watchers].some((watcher) => watcher.relaying)
    const opened = Date.now()
    this.window = { live, stop }
    const timer = setTimeout(() => stop.abort(), refreshMs)
    let ended = false
    let cursor = agent.cursor
    try {
      const response = await Gateway.stream(this.env, row.id, agent.id, cursor, stop.signal, live).catch(() => undefined)
      if (!response?.ok || !response.body) {
        await response?.body?.cancel().catch(() => undefined)
        return undefined
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      for (;;) {
        const read = await reader.read().catch(() => undefined)
        if (!read || read.done) {
          await reader.cancel().catch(() => undefined)
          if (stop.signal.aborted || ended) return { ended }
          return Date.now() - opened < refreshMs / 2 ? undefined : { ended }
        }
        buffer += read.value
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const found = frame(block)
          if (!found) continue
          const event = JSON.parse(found.data) as Gateway.Event
          if (found.live) {
            for (const delta of this.deltas(event, agent.id)) this.relay(delta)
            continue
          }
          this.reached()
          ended = this.digest(event, run.turn) || ended
          cursor = Math.max(cursor, event.seq)
        }
        if (cursor !== (this.agent() ?? agent).cursor) this.kv.put('agent', { ...(this.agent() ?? agent), cursor })
        if (ended) stop.abort()
      }
    } finally {
      clearTimeout(timer)
      if (this.window?.stop === stop) this.window = undefined
    }
  }

  deltas(event: Gateway.Event, agent: string): Live[] {
    const outer = event.event
    if (!outer || outer.source === undefined) return []
    if (outer.source === 'subagent') {
      const update = outer.update as { event?: { payload?: Record<string, unknown>; type?: string }; id?: unknown; type?: string } | undefined
      if (update?.type !== 'event') return []
      const who = this.crew().names[`${outer.root_session_id ?? agent}:${String(update.id)}`] ?? `subagent ${String(update.id)}`
      return streamed(who, update.event?.type, update.event?.payload ?? {})
    }
    return streamed(null, outer.event?.type, outer.event?.payload ?? {})
  }

  cue(cue: Cue) {
    this.cues.set(cue, Date.now())
  }

  due(cue: Cue, every: number, now: number) {
    const last = this.polled.get(cue) ?? 0
    const cued = this.cues.get(cue)
    const hit = (cued !== undefined && cued > last && now - cued >= cueMs) || now - last >= every
    if (hit) this.polled.set(cue, now)
    return hit
  }

  plan(now: number) {
    const lent = (this.kv.get<Hand[]>('hands') ?? []).length > 0 || !!this.kv.get<boolean>('issued')
    return {
      artifacts: this.due('artifacts', fallbackMs, now),
      chain: this.due('chain', minuteMs, now),
      git: this.due('git', this.kv.get<string>('repo') ? minuteMs : fallbackMs, now),
      hands: this.due('hands', lent ? refreshMs : minuteMs, now),
      sponsors: this.due('sponsors', this.listened() ? refreshMs : 3 * refreshMs, now),
      turn: this.due('turn', minuteMs, now),
    }
  }

  async finish(row: Store.Row, run: Turning, report: Gateway.Report) {
    this.ended()
    const n = run.n
    const error = typeof report.error === 'string' ? report.error : report.error?.message
    const message = report.ok?.message ?? error ?? null
    const status = report.status === 'completed' ? 'completed' : report.status === 'cancelled' ? 'cancelled' : 'failed'
    this.flush()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    for (const source of await this.sources(row)) await this.probe(row, source).catch(() => undefined)
    const money = await this.refresh(row)
    const found = this.ctx.storage.sql
      .exec<{ base: string | null; spent_before: string }>('SELECT spent_before, base FROM turns WHERE n = ?', n)
      .toArray()[0]
    await this.settled(money.row).catch((error: unknown) => console.error('Settling closed branches failed', error))
    const repo = await this.repo(money.row)
    const commits = repo.state === 'ready' ? await this.pushed(row.id, repo.name, found?.base ?? null) : []
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
      status === 'completed' ? `Posted an update after spending ${dollars(spent > 0n ? spent : 0n)}${pushed}.` : `The agent stopped with an error after spending ${dollars(spent > 0n ? spent : 0n)}${pushed}.`,
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
      const wake = this.rested()
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

  async vendor(row: Store.Row, input: Pay): Promise<Paid> {
    const refused = (detail: string): Paid => ({ code: 'payment_failed', detail, status: 402 })
    const serialized = (Array.isArray(input.challenge) ? input.challenge : [input.challenge])[0]
    if (!serialized || !row.sealed_wallet || !row.wallet) return refused('No challenge, or this swarm has no wallet.')
    const challenge = (() => {
      try {
        return Challenge.deserialize(serialized)
      } catch {
        return undefined
      }
    })()
    const request = challenge?.request as { amount?: string; currency?: string; methodDetails?: { chainId?: number }; recipient?: string } | undefined
    const amount = /^[1-9]\d{0,18}$/.test(request?.amount ?? '') ? BigInt(request!.amount!) : 0n
    if (
      challenge?.method !== 'tempo' ||
      challenge.intent !== 'charge' ||
      String(request?.currency).toLowerCase() !== Chain.tokens.usdce.address.toLowerCase() ||
      (request?.methodDetails?.chainId ?? 4217) !== 4217 ||
      !isAddress(request?.recipient ?? '') ||
      amount === 0n ||
      amount > vendorCap
    )
      return refused(`The swarm pays a service directly only for a Tempo USDC.e charge of at most ${dollars(vendorCap)}.`)
    const wallet = row.wallet
    const authorization = await this.locked(async () => {
      const account = await Vault.account(this.env, row)
      const held = await Vault.balances(this.env, wallet)
      if (held.usdce < amount) {
        const short = amount - held.usdce
        if (held.ousd < short + (short * Vault.slippage) / 10_000n + Vault.dust) return new Error("The swarm's wallet cannot cover this service.")
        await Vault.buy(this.env, account, 'usdce', short)
      }
      this.vended = Date.now()
      const client = Mppx.create({ methods: [tempo.charge({ account })], polyfill: false })
      return client.createCredential(new Response(null, { headers: { 'www-authenticate': serialized }, status: 402 })).catch((error: unknown) => error as Error)
    })
    if (authorization instanceof Error) return refused(authorization.message.split('\n')[0]?.slice(0, 200) ?? 'Signing failed.')
    this.kv.put('banked:pool', String(BigInt(this.kv.get<string>('banked:pool') ?? '0') + amount))
    const host = (() => {
      try {
        return new URL(input.path ?? '').host
      } catch {
        return challenge.realm
      }
    })()
    this.log('funds', `Paid ${host} ${dollars(amount)} in USDC.e from the swarm's wallet, because the gateway's treasury could not front it.`)
    return { authorization }
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

  sources(row: Store.Row): Source[] {
    return row.wallet ? [pool()] : []
  }

  source(row: Store.Row, id: string) {
    if (id === 'pool') return row.wallet ? pool() : undefined
    if (id.startsWith('hand:')) return row.wallet ? owing(id.slice('hand:'.length) as Address) : undefined
    return undefined
  }

  signer(row: Store.Row, source: Source): Promise<Signer> {
    const cached = this.signers.get(source.id)
    if (cached) return cached
    const created = Seal.open(this.env.SWARMS_SECRET, row.sealed_wallet ?? '').then(async (key) => ({ account: await Vault.account(this.env, row), key: key as Hex }))
    created.catch(() => this.signers.delete(source.id))
    this.signers.set(source.id, created)
    return created
  }

  async client(row: Store.Row, source: Source): Promise<Payer.Client> {
    const cached = this.clients.get(source.id)
    if (cached) return cached
    const created = Payer.client(this.env, this.kv, source.id, (await this.signer(row, source)).account, source.currency)
    this.clients.set(source.id, created)
    return created
  }

  async room(row: Store.Row): Promise<Room> {
    const balances = await Vault.balances(this.env, row.wallet as Address)
    return { amount: Payer.max(balances.ousd - Vault.dust, 0n), resets: null }
  }

  async channel(source: Source) {
    const channel = this.kv.get<Payer.Channel>(`channel:${source.id}`)
    if (!channel || channel.confirmed) return channel
    for (;;) {
      const state = await Payer.state(this.env, channel.id).catch(() => undefined)
      const old = Date.now() - channel.at > Payer.confirmMs
      if (state) {
        const confirmed = Payer.confirm(channel, state.deposit, Date.now())
        if (confirmed.confirmed) {
          this.kv.put(`channel:${source.id}`, confirmed)
          return confirmed
        }
        if (old && state.deposit === 0n) {
          Payer.forget(this.kv, source.id)
          this.clients.delete(source.id)
          if (Date.now() - (this.kv.get<number>(`unopened:${source.id}`) ?? 0) > quietMs) this.log('error', `The channel for ${source.label} never opened on Tempo, so the next payment opens another.`)
          this.kv.put(`unopened:${source.id}`, Date.now())
          return undefined
        }
      }
      if (old) return channel
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }

  passable(row: Store.Row, input: Pay): Paid | undefined {
    const amount = asked(input)
    const now = Date.now()
    const recent = (this.kv.get<Passed[]>('passed') ?? []).filter((item) => item.at > now - hourMs)
    const hourly = Payer.max(passHour, BigInt(row.raised) / 20n)
    const host = passHost(input)
    const used = recent.reduce((sum, item) => sum + BigInt(item.amount), 0n)
    const there = recent.filter((item) => item.host === host).reduce((sum, item) => sum + BigInt(item.amount), 0n)
    if (amount > passCall) return { code: 'limit_reached', detail: `The swarm pays an outside service at most ${dollars(passCall)} a call; ${host} asked ${dollars(amount)}.`, status: 402 }
    if (used + amount > hourly)
      return { code: 'limit_reached', detail: `The swarm pays outside services at most ${dollars(hourly)} an hour, and ${dollars(used)} went to them in the last hour.`, retry: 60, status: 402 }
    if (there + amount > hourly / 2n)
      return { code: 'limit_reached', detail: `The swarm pays one outside service at most ${dollars(hourly / 2n)} an hour, and ${host} had ${dollars(there)} of it.`, retry: 60, status: 402 }
    return undefined
  }

  passed(input: Pay, paid: Paid): Paid {
    if (!('authorization' in paid)) return paid
    const amount = asked(input)
    const now = Date.now()
    const host = passHost(input)
    this.kv.put('passed', [...(this.kv.get<Passed[]>('passed') ?? []).filter((item) => item.at > now - hourMs), { amount: String(amount), at: now, host }])
    if (input.operation === 'agent.fetch') this.log('funds', `The agent paid ${dollars(amount)} to an outside service through the gateway, from the swarm's money.`, input.path ?? null)
    return paid
  }

  async budget(secret: string, app: string | undefined): Promise<Paid> {
    const known = this.kv.get<string>('secret')
    if (!known || !same(known, secret)) return { code: 'unauthorized', detail: 'Unknown payer secret.', status: 401 }
    const row = await this.found(this.kv.get<string>('id') ?? '')
    if (!row) return { code: 'unauthorized', detail: 'No swarm has this id.', status: 401 }
    if (app !== undefined && app !== Gateway.app(row.id)) return { code: 'unauthorized', detail: 'This payer pays only for its own swarm.', status: 401 }
    const summary = Store.summary(row)
    return { daily: '0.000000', raised: summary.raised, spent: summary.spent, usd: summary.remaining }
  }

  pay(input: Pay): Promise<Paid> {
    const secret = this.kv.get<string>('secret')
    if (!secret || !same(secret, input.secret)) return Promise.resolve({ code: 'unauthorized', detail: 'Unknown payer secret.', status: 401 })
    const run = this.paying.then(() => this.charge(input))
    this.paying = run.catch(() => undefined)
    return run
  }

  async charge(input: Pay): Promise<Paid> {
    const row = await this.found(this.kv.get<string>('id') ?? '')
    if (!row) return { code: 'limit_reached', detail: 'This swarm pays for nothing.', status: 402 }
    if (input.app !== undefined && input.app !== Gateway.app(row.id)) return { code: 'unauthorized', detail: 'This payer pays only for its own swarm.', status: 401 }
    const passing = input.operation === 'vendor' || input.operation === 'agent.fetch'
    if (passing) {
      const refused = this.passable(row, input)
      if (refused) return refused
    }
    if (input.operation === 'vendor') return this.passed(input, await this.vendor(row, input))

    const price = Payer.priced(input.challenge)
    if (price !== undefined && price > Chain.cap)
      return { code: 'limit_reached', detail: `This request costs ${dollars(price)}, more than the ${dollars(Chain.cap)} the swarm pays for any one request; ask for less at once, such as a shorter lease or fewer machines.`, status: 402 }

    const snapshots = input.channels ?? []
    const known = [...this.kv.list<Payer.Channel>({ prefix: 'channel:' })]
    for (const [index, snapshot] of snapshots.entries())
      for (const [key, channel] of known) {
        if (channel.id.toLowerCase() !== snapshot.channelId.toLowerCase()) continue
        const id = key.slice('channel:'.length)
        this.kv.put('spent:' + id, snapshot.spent)
        if (snapshot.closing || (index === 0 && input.rejected?.status === 410)) this.drop(id)
        else if (Payer.unsure(channel) && BigInt(snapshot.deposit) >= Payer.held(channel)) this.kv.put(key, Payer.confirm(channel, BigInt(snapshot.deposit), Date.now()))
        if (index === 0 && input.rejected && (input.attempt ?? 0) >= 2) {
          this.kv.put('exhausted:' + id, Date.now() + restMs)
          this.log('funds', `The gateway refused ${id === 'pool' ? "the swarm wallet's" : 'a contribution\'s'} payment again, so the swarm moves on to the next contribution.`, input.rejected.detail)
        }
      }

    const owed = input.recipient ? owing(input.recipient) : undefined
    if (owed && row.wallet && [owed.id, 'pool'].every((id) => (this.kv.get<number>('exhausted:' + id) ?? 0) <= Date.now())) {
      const source = owed
      const result = await this.attempt(row, source, input, snapshots).catch(
        (error: unknown): Failed => ({ failed: String(error).split('\n')[0]?.slice(0, 300) ?? 'The payment failed.', room: undefined }),
      )
      if ('authorization' in result || 'feeToken' in result) return result
      if ((this.kv.get<number>('owing:' + source.id) ?? 0) <= Date.now()) {
        this.kv.put('owing:' + source.id, Date.now() + restMs)
        this.log('funds', `The swarm's wallet cannot pay the owner of hand ${input.hand ?? 'a lent machine'} over its own channel right now, so the gateway bills that hand's use and pays its owner.`, result.failed)
      }
    }

    const current = this.kv.get<string>('payer')
    const ordered = this.sources(row).filter((source) => (this.kv.get<number>('exhausted:' + source.id) ?? 0) <= Date.now())
    let busy = false
    let small = false
    let wanted = 0n
    for (const source of ordered) {
      const result = await this.attempt(row, source, input, snapshots).catch(
        (error: unknown): Failed => ({ failed: String(error).split('\n')[0]?.slice(0, 300) ?? 'The payment failed.', room: { amount: 0n, resets: Date.now() + retryMs } }),
      )
      if ('feeToken' in result) return result
      if ('authorization' in result) {
        if (current !== source.id) {
          this.kv.put('payer', source.id)
          this.log('funds', `Paying from ${source.label} now.`)
        }
        return passing ? this.passed(input, result) : result
      }
      if (result.busy) busy = true
      if (result.busy || result.small) {
        small ||= !!result.small
        if (result.small && result.price) wanted = Payer.max(wanted, result.price)
        continue
      }
      const until = result.room?.resets ?? Date.now() + restMs
      this.kv.put('exhausted:' + source.id, until)
      this.log('funds', `${capital(source.label)} cannot pay right now, so the swarm moves on until ${clock(until)} UTC.`, result.failed)
    }

    if (busy) return { code: 'busy', detail: "The swarm's contributions are holding other calls' reservations; try again shortly.", retry: 2, status: 429 }
    const held = BigInt(row.sponsor_left ?? 0)
    const most = BigInt(this.kv.get<string>('sponsoredMost') ?? '0')
    const scarce = !passing && held >= perCall && price !== undefined && most < price
    if (scarce) wanted = Payer.max(wanted, price)
    const run = this.run()
    if (wanted && run.state === 'working') this.set({ ...run, wanted: String(wanted) })
    const wake = this.rested()
    const spent = wake ? `Every contribution to this swarm is spent for now; the next one comes back at ${new Date(wake).toISOString()}.` : 'Every contribution to this swarm is spent.'
    return {
      code: 'limit_reached',
      detail: scarce
        ? `No channel of this swarm holds ${dollars(price)} at once: the MACH channels the gateway spends for it hold ${dollars(held)} in all, the largest ${dollars(most)}. Ask for less at once, such as a shorter lease or a smaller machine.`
        : held >= perCall && passing
          ? `Payments to outside services come only from the swarm's wallet, which cannot pay this; the MACH channels the gateway spends for the swarm (${dollars(held)} left) pay only for the gateway's own requests.`
          : held >= perCall
            ? `The swarm's wallet cannot pay this, though the MACH channels the gateway spends for it still hold ${dollars(held)}; try again in a moment.`
            : small
              ? 'No single contribution to this swarm can pay this much at once right now.'
              : spent,
      ...(wake ? { retry: Math.max(1, Math.ceil((wake - Date.now()) / 1000)) } : {}),
      status: 402,
    }
  }

  async attempt(row: Store.Row, source: Source, input: Pay, snapshots: Payer.Snapshot[]): Promise<{ authorization: string; topUp?: string } | { feeToken: Address } | Failed> {
    const payee = owner(source)
    const offered = Payer.offer(input.challenge, source.currency, payee)
    if (!offered)
      return payee
        ? { failed: 'The hand owner is paid in a token other than OUSD, which the swarm\'s wallet holds.', room: undefined, small: true }
        : { failed: `The gateway offered no OUSD session to its recipient for at most ${Memo.decimal(Chain.cap)}.`, room: undefined, small: true }
    const mppx = await this.client(row, source)
    const channel = await this.channel(source)
    const price = offered.amount
    const step = payee ? handChunk : chunk

    if (!channel) {
      const room = await this.room(row)
      const deposit = Payer.min(Payer.max(step, price), room.amount)
      if (deposit < price)
        return { failed: `It can put in ${Memo.decimal(room.amount)} now, less than the ${Memo.decimal(price)} this request holds.`, price, room, small: room.amount >= perCall }
      const authorization = await mppx.createCredential(offered.response, { depositRaw: String(deposit) })
      const entry = Payer.opened(this.kv, source.id)
      if (!entry) throw new Error('mppx stored no channel for the open')
      this.kv.put(`channel:${source.id}`, { at: Date.now(), confirmed: false, deposit: String(deposit), descriptor: entry.descriptor, id: entry.channelId, signed: String(price) } satisfies Payer.Channel)
      this.kv.put('spent:' + source.id, String(price))
      this.kv.put('paid:' + source.id, Date.now())
      this.cue('chain')
      if (payee) this.log('funds', `Opened a channel from the swarm's wallet to the owner of hand ${input.hand ?? 'a lent machine'} (${short(payee)}), which the gateway settles straight to them.`)
      return { authorization }
    }

    const snapshot = snapshots.find((item) => item.channelId.toLowerCase() === channel.id.toLowerCase())
    const accepted = BigInt(snapshot?.acceptedCumulative ?? '0')
    const recent = (this.kv.get<{ amount: string; at: number; cumulative: string }[]>('pending:' + source.id) ?? []).filter(
      (item) => Date.now() - item.at < recentMs && BigInt(item.cumulative) > accepted,
    )
    const pending = recent.reduce((sum, item) => sum + BigInt(item.amount), 0n)
    const signed = BigInt(channel.signed)
    const floor = snapshot ? recent.reduce((most, item) => Payer.max(most, BigInt(item.cumulative)), accepted) : signed
    const spent = snapshot?.spent ?? this.kv.get<string>('spent:' + source.id)
    const need =
      spent === undefined
        ? signed + price
        : [BigInt(snapshot?.requiredCumulative ?? '0'), floor + 1n, BigInt(spent) + pending + price].reduce(Payer.max)
    const deposit = BigInt(snapshot?.deposit ?? Payer.held(channel))
    let topUp: string | undefined
    let additional = 0n
    if (need > deposit) {
      const room = await this.room(row)
      const shortfall = need - deposit
      additional = Payer.min(Payer.max(step, shortfall), room.amount)
      if (additional < shortfall) {
        const unspent = spent === undefined ? 0n : deposit - BigInt(spent)
        return {
          busy: Date.now() - (this.kv.get<number>('paid:' + source.id) ?? 0) < (unspent >= perCall ? heldMs : holdMs),
          failed: `It can add ${Memo.decimal(room.amount)} now, less than the ${Memo.decimal(shortfall)} its channel needs (deposit ${Memo.decimal(deposit)}, spent ${Memo.decimal(BigInt(spent ?? '0'))}, accepted ${Memo.decimal(accepted)}, required ${Memo.decimal(BigInt(snapshot?.requiredCumulative ?? '0'))}, in flight ${Memo.decimal(pending)} over ${recent.length}, this request ${Memo.decimal(price)}).`,
          price,
          room,
          small: room.amount + Payer.max(unspent, 0n) >= perCall,
        }
      }
      topUp = await mppx.createCredential(offered.response, { action: 'topUp', additionalDepositRaw: String(additional), channelId: channel.id, descriptor: channel.descriptor })
    }
    const authorization = await mppx.createCredential(offered.response, { action: 'voucher', channelId: channel.id, cumulativeAmountRaw: String(need), descriptor: channel.descriptor })
    this.kv.put(`channel:${source.id}`, Payer.topped(channel, deposit, additional, need, Date.now()))
    if (topUp) this.cue('chain')
    this.kv.put('pending:' + source.id, [...recent, { amount: String(price), at: Date.now(), cumulative: String(need) }])
    this.kv.put('paid:' + source.id, Date.now())
    return topUp ? { authorization, topUp } : { authorization }
  }

  async probe(row: Store.Row, source: Source) {
    const channel = this.kv.get<Payer.Channel>(`channel:${source.id}`)
    if (!channel?.confirmed) return
    const init = { body: JSON.stringify({ key: 'probe' }), headers: { 'content-type': 'application/json', 'gateway-app': Gateway.app(row.id) }, method: 'POST' }
    const challenge = await Gateway.call(this.env, '/v1/kv/get', init)
    const offered = Payer.offer(challenge.headers.get('www-authenticate') ?? '', source.currency)
    const deposit = BigInt(channel.deposit)
    const known = BigInt(this.kv.get<string>('spent:' + source.id) ?? channel.signed)
    const cumulative = Payer.min(deposit, Payer.max(BigInt(channel.signed) + 1n, known + (offered?.amount ?? 0n)))
    if (!offered || cumulative <= BigInt(channel.signed)) return
    const mppx = await this.client(row, source)
    const authorization = await mppx.createCredential(offered.response, { action: 'voucher', channelId: channel.id, cumulativeAmountRaw: String(cumulative), descriptor: channel.descriptor })
    const paid = await Gateway.call(this.env, '/v1/kv/get', { ...init, headers: { ...init.headers, authorization } })
    const header = paid.headers.get('payment-receipt')
    if (!paid.ok || !header) return
    const receipt = JSON.parse(atob(header.replace(/-/g, '+').replace(/_/g, '/'))) as { acceptedCumulative?: string; spent?: string }
    this.kv.put(`channel:${source.id}`, { ...channel, signed: receipt.acceptedCumulative ?? String(cumulative) })
    if (receipt.spent) this.kv.put('spent:' + source.id, receipt.spent)
  }

  drop(id: string) {
    this.kv.put('banked:' + id, String(this.used(id)))
    this.kv.delete('spent:' + id)
    Payer.forget(this.kv, id)
    this.clients.delete(id)
  }

  used(id: string) {
    return BigInt(this.kv.get<string>('banked:' + id) ?? '0') + BigInt(this.kv.get<string>('spent:' + id) ?? '0')
  }

  owners() {
    const ids = new Set<string>()
    for (const prefix of ['channel:hand:', 'banked:hand:', 'spent:hand:'])
      for (const [key] of this.kv.list({ prefix })) ids.add(key.slice(key.indexOf('hand:')))
    return [...ids]
  }

  handsUsed() {
    return this.owners().reduce((sum, id) => sum + this.used(id), 0n)
  }

  rested() {
    const now = Date.now()
    const times = [...this.kv.list<number>({ prefix: 'exhausted:' })].map(([, until]) => until).filter((at) => at > now && at < now + 8 * 86_400_000)
    return times.length ? Math.min(...times) + 2_000 : null
  }

  async refresh(row: Store.Row, plan: Plan = everything): Promise<Money> {
    const sources = this.sources(row)
    const client = Chain.client(this.env)
    const unsure = plan.chain ? [...this.kv.list<Payer.Channel>({ prefix: 'channel:' })].filter(([, channel]) => Payer.unsure(channel)) : []
    const reading = plan.chain || !this.held
    const [hands, balances, states, pledged] = await Promise.all([
      plan.hands ? Gateway.hands(this.env, row.id) : undefined,
      row.wallet ? (reading ? Vault.balances(this.env, row.wallet, client) : Promise.resolve(this.held)) : Promise.resolve(undefined),
      Promise.all(unsure.map(([, channel]) => Payer.state(this.env, channel.id, client).catch(() => undefined))),
      plan.sponsors ? this.sponsorships(row) : undefined,
    ])
    if (reading && balances) this.held = balances
    for (const [index, [key, channel]] of unsure.entries()) {
      const state = states[index]
      const confirmed = state ? Payer.confirm(channel, state.deposit, Date.now()) : channel
      if (confirmed !== channel) this.kv.put(key, confirmed)
    }
    let left = 0n
    let biggest = 0n
    let pooled = 0n
    for (const source of sources) {
      const channel = this.kv.get<Payer.Channel>(`channel:${source.id}`)
      const spent = BigInt(this.kv.get<string>('spent:' + source.id) ?? channel?.signed ?? '0')
      const inside = Payer.inside(channel, spent)
      const room = balances ? Payer.max(Vault.total(balances) - Vault.dust * 3n, 0n) : 0n
      const available = inside + room
      if (room >= perCall) this.kv.delete('exhausted:' + source.id)
      pooled = available
      if ((this.kv.get<number>('exhausted:' + source.id) ?? 0) > Date.now()) continue
      left += available
      biggest = Payer.max(biggest, available)
    }
    const loose = String(balances ? balances.pathusd + balances.usdce - Vault.dust * 2n : 0n)
    if (this.kv.get<string>('loose') !== loose) this.kv.put('loose', loose)
    if (pledged) this.pledged = pledged
    const sponsored = plan.sponsors ? this.pledged : { biggest: this.pledged.biggest, left: BigInt(row.sponsor_left ?? 0), spent: BigInt(row.sponsor_spent ?? 0) }
    left += sponsored.left
    biggest = Payer.max(biggest, sponsored.biggest)
    this.kv.put('sponsoredMost', String(sponsored.biggest))

    const previous = this.kv.get<Hand[]>('hands') ?? []
    const connected = hands ? (hands.ok ? hands.value.hands.filter((hand) => hand.connected) : []) : undefined
    if (connected) await this.joined(row, connected, new Set(previous.map((hand) => hand.name)))

    const pool = { machines: connected?.length ?? previous.length, pool_left: Number(pooled), pool_spent: Number(this.used('pool') + this.handsUsed()), sponsor_left: Number(sponsored.left), sponsor_spent: Number(sponsored.spent) }
    if (
      Number(row.machines) !== pool.machines ||
      Number(row.pool_left) !== pool.pool_left ||
      Number(row.pool_spent) !== pool.pool_spent ||
      Number(row.sponsor_left) !== pool.sponsor_left ||
      Number(row.sponsor_spent) !== pool.sponsor_spent
    ) {
      await Store.update(this.env, row.id, pool)
      const updated = { ...row, ...pool, remaining: pool.pool_left + pool.sponsor_left, spent: Number(row.spent) - Number(row.pool_spent) - Number(row.sponsor_spent) + pool.pool_spent + pool.sponsor_spent }
      this.remember(updated)
      this.beacon(updated)
      return { biggest, left, row: updated }
    }
    return { biggest, left, row: (await this.found(row.id)) ?? row }
  }

  async joined(row: Store.Row, connected: Gateway.Listed[], previous: ReadonlySet<string>) {
    const issued = new Map(connected.some((hand) => !previous.has(hand.name)) ? (await Hands.list(this.env, row.id)).map((hand) => [hand.name, hand]) : [])
    for (const hand of connected) {
      if (previous.has(hand.name)) continue
      const guest = issued.get(hand.name)
      if (guest && 'cap' in hand && this.turn()) await Gateway.cap(this.env, row.id, hand.name, Number(Memo.decimal(this.allowance(row, hand, BigInt(this.kv.get<string>('handCap') ?? '0')))))
      this.log(
        'machine',
        guest
          ? `A contributor's machine joined the swarm as hand ${hand.name}${guest.label ? ` (${guest.label})` : ''}.`
          : `Machine ${hand.name} joined the swarm.`,
      )
    }
    for (const name of previous)
      if (!connected.some((hand) => hand.name === name)) this.log('machine', `Machine ${name} left.`)
    if (connected.length === previous.size && connected.every((hand) => previous.has(hand.name))) return
    this.kv.put('hands', connected.map((hand) => ({ connected: true, name: hand.name })))
    this.changed('hands')
  }

  async sponsorships(row: Store.Row) {
    const counted = new Map<string, bigint>((await Store.channels(this.env, row.id)).map((gift) => [gift.channel, BigInt(gift.amount)]))
    if (!counted.size) return { biggest: 0n, left: 0n, spent: 0n }
    const listed = await Gateway.sponsors(this.env, row.id)
    if (!listed.ok) return { biggest: 0n, left: BigInt(row.sponsor_left ?? 0), spent: BigInt(row.sponsor_spent ?? 0) }
    let biggest = 0n
    let left = 0n
    let spent = 0n
    for (const channel of listed.value.sponsors) {
      const used = Memo.units(channel.spent)
      spent += used
      if (channel.endedAt !== null || channel.closing) {
        const amount = counted.get(channel.channel.toLowerCase())
        if (amount !== undefined && amount !== used) {
          await Store.delivered(this.env, channel.channel, used)
          this.marked += 1
        }
        continue
      }
      const available = Memo.units(channel.available)
      left += available
      biggest = Payer.max(biggest, available)
    }
    return { biggest, left, spent }
  }

  fund(row: Store.Row) {
    this.funding ??= this.locked(() => this.refill(row)).finally(() => {
      this.funding = undefined
    })
    return this.funding
  }

  locked<T>(task: () => Promise<T>): Promise<T> {
    const run = this.wallet.then(task)
    this.wallet = run.catch(() => undefined)
    return run
  }

  async refill(row: Store.Row) {
    if (!row.wallet || !row.sealed_wallet) return
    const owner = await Vault.account(this.env, row)
    const balances = await Vault.balances(this.env, row.wallet)

    for (const id of ['pathusd', 'usdce'] as const) {
      const amount = balances[id] - Vault.dust
      if (amount < smallestSwap || (id === 'usdce' && Date.now() - this.vended < pullMs)) continue
      const result = await Vault.swap(this.env, owner, id, amount).catch((error: unknown) => error as Error)
      if (result instanceof Error) {
        this.log('error', `Swapping ${Chain.tokens[id].symbol} to OUSD failed.`, result.message.split('\n')[0] ?? null)
        continue
      }
      this.kv.delete('exhausted:pool')
      this.cue('chain')
      this.log(
        'funds',
        `Swapped ${trim(Memo.decimal(amount))} ${Chain.tokens[id].symbol} to ${trim(Memo.decimal(result.received))} OUSD on the stablecoin DEX (quote ${trim(Memo.decimal(result.quote))}, at least ${trim(Memo.decimal(result.minimum))}, fee ${trim(Memo.decimal(result.fee))}).`,
        result.hash,
      )
    }
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

  async owner() {
    const known = this.kv.get<string>('owner')
    if (known) return known
    const me = await Gateway.me(this.env)
    if (!me.ok) return undefined
    this.kv.put('owner', me.value.wallet.toLowerCase())
    return me.value.wallet.toLowerCase()
  }

  async repo(row: Store.Row): Promise<Repo> {
    const ready = this.kv.get<string>('repo')
    if (ready) return { name: ready, state: 'ready' }
    const name = row.repo ?? slug(row.title)
    const owner = await this.owner()
    const listed = owner ? await Gateway.code<{ repos: { name: string }[] }>(this.env, owner, row.id, `?at=${Date.now()}`) : undefined
    const found = listed?.repos.find((repo) => repo.name === name) ?? listed?.repos[0]
    if (found) {
      this.kv.put('repo', found.name)
      await Store.update(this.env, row.id, { repo: found.name })
      this.log('status', `The swarm's code now lives in its public repository ${found.name}, which its page shows.`)
      this.changed('detail', 'code')
      return { name: found.name, state: 'ready' }
    }
    return { name, state: 'none' }
  }

  async watch(row: Store.Row) {
    const repo = await this.repo(row)
    if (repo.state !== 'ready') return
    const fresh = await this.pushed(row.id, repo.name, this.kv.get<string>('seen') ?? null)
    if (!fresh[0]) return
    this.kv.put('seen', fresh[0].sha)
    await this.snapshot(row.id, repo.name).catch((error: unknown) => console.error('Reading the repository failed', error))
    this.changed('code')
    for (const commit of fresh.reverse()) this.log('status', `Pushed ${commit.sha.slice(0, 7)} to ${repo.name}: ${redact(commit.message.split('\n')[0] ?? '')}`)
  }

  code(): Snapshot | null {
    const id = this.kv.get<string>('id')
    const repo = this.kv.get<string>('repo')
    const snapshot = this.kv.get<Snapshot>('snapshot')
    if (id && repo && (!snapshot || snapshot.name !== repo || Date.now() - snapshot.at > snapshotMs) && Date.now() - (this.kv.get<number>('snapping') ?? 0) > snapshotMs) {
      this.kv.put('snapping', Date.now())
      this.ctx.waitUntil(this.snapshot(id, repo).catch((error: unknown) => console.error('Reading the repository failed', error)))
    }
    return snapshot && snapshot.name === repo ? snapshot : null
  }

  async snapshot(swarm: string, name: string) {
    const owner = await this.owner()
    if (!owner) return
    const base = `/${encodeURIComponent(name)}`
    const [log, listed] = await Promise.all([
      Gateway.code<{ commits: Snapshot['commits'] }>(this.env, owner, swarm, `${base}/log?ref=main&limit=50&at=${Date.now()}`),
      Gateway.code<{ files: { path: string; type: string }[] }>(this.env, owner, swarm, `${base}/files?ref=main&at=${Date.now()}`),
    ])
    if (!log || !listed) return
    const files = listed.files.filter((file) => file.type !== 'tree').map((file) => file.path)
    const head = log.commits[0]
    const path = files.find((file) => /^readme(\.md)?$/i.test(file)) ?? files.find((file) => /readme/i.test(file)) ?? files[0]
    const [read, diff] = await Promise.all([
      head && path ? Gateway.code<{ size: number; text?: string }>(this.env, owner, swarm, `${base}/read?path=${encodeURIComponent(path)}&ref=${head.sha}`) : undefined,
      head ? Gateway.code<{ files: NonNullable<Snapshot['diff']> }>(this.env, owner, swarm, `${base}/diff?ref=${head.sha}`) : undefined,
    ])
    this.kv.put('snapshot', {
      at: Date.now(),
      commits: log.commits.map((commit) => ({ ...commit, message: redact(commit.message) })),
      diff: diff && diff.files.reduce((total, change) => total + change.patch.length, 0) <= snapshotText * 2 ? diff.files.map((change) => ({ ...change, patch: redact(change.patch) })) : null,
      files: files.slice(0, snapshotFiles),
      name,
      readme: path && read?.text !== undefined && read.text.length <= snapshotText ? { path, text: redact(read.text) } : null,
    } satisfies Snapshot)
    this.kv.delete('snapping')
  }

  async commits(swarm: string, name: string, limit: number) {
    const owner = await this.owner()
    const read = owner
      ? await Gateway.code<{ commits: Gateway.Commit[] }>(this.env, owner, swarm, `/${name}/log?ref=main&limit=${limit}&at=${Date.now()}`)
      : undefined
    return read?.commits ?? []
  }

  async head(swarm: string, name: string) {
    return (await this.commits(swarm, name, 1))[0]?.sha ?? null
  }

  async pushed(swarm: string, name: string, base: string | null) {
    const commits = await this.commits(swarm, name, 50)
    const at = base ? commits.findIndex((commit) => commit.sha === base) : -1
    return at >= 0 ? commits.slice(0, at) : commits
  }

  async cap(row: Store.Row, amount: bigint) {
    this.kv.put('handCap', String(amount))
    const listed = await Gateway.hands(this.env, row.id)
    if (!listed.ok) return
    for (const hand of listed.value.hands.filter((found) => found.connected && 'cap' in found)) {
      this.kv.put('handTurn:' + hand.name, String(earned(hand)))
      await Gateway.cap(this.env, row.id, hand.name, Number(Memo.decimal(this.allowance(row, hand, amount))))
    }
  }

  allowance(row: Store.Row, hand: Gateway.Listed, perTurn: bigint) {
    const now = Date.now()
    const total = earned(hand)
    const known = this.kv.get<{ at: number; usd: string }>('handDay:' + hand.name)
    const day = known && now - known.at < dayMs ? known : { at: now, usd: String(total) }
    if (day !== known) this.kv.put('handDay:' + hand.name, day)
    const turn = total - BigInt(this.kv.get<string>('handTurn:' + hand.name) ?? String(total))
    const today = total - BigInt(day.usd)
    const left = Payer.min(perTurn - turn, BigInt(row.raised) / Hands.share - today)
    return left > 0n ? left : 0n
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
      `${dollars(Memo.units(note.weight))} behind it, ${percent(note.share)} of everything contributed`,
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
    if (fresh) return this.list(swarm, agent)
    const known = this.listing?.agent === agent ? this.listing : undefined
    if (known && !known.pending && Date.now() - known.at < listingMs) return known.value
    const kept = this.kv.get<{ agent: string; at: number; list: Gateway.Subagent[] }>('subagents')
    if (kept?.agent === agent && Date.now() - kept.at < keptMs) {
      if (!known?.pending) this.ctx.waitUntil(this.list(swarm, agent).catch(() => undefined))
      return { ok: true, value: { agent, list: kept.list } }
    }
    return known?.pending ? known.value : this.list(swarm, agent)
  }

  async list(swarm: string, agent: string): Promise<Gateway.Result<{ agent: string | null; list: Gateway.Subagent[] }>> {
    const value = Gateway.subagents(this.env, swarm, agent).then((listed): Gateway.Result<{ agent: string | null; list: Gateway.Subagent[] }> => (listed.ok ? { ok: true, value: { agent, list: listed.value } } : listed))
    const flight = { agent, at: Date.now(), pending: true, value }
    this.listing = flight
    const result = await value.catch((error: unknown) => ({ detail: error instanceof Error ? error.message : String(error), ok: false as const, status: 503 }))
    if (this.listing !== flight) return result
    this.listing = result.ok ? { ...flight, at: Date.now(), pending: false } : undefined
    if (result.ok && JSON.stringify(result.value.list).length < keptBytes) this.ctx.storage.kv.put('subagents', { agent, at: flight.at, list: result.value.list })
    return result
  }

  rebudget(swarm: string, agent: string, branch: number) {
    const run = this.budgeting.then(async () => {
      const money = await Store.funds(this.env, swarm, agent)
      const funded = [...(money.shares.get(branch)?.values() ?? [])].reduce((sum, amount) => sum + amount, 0n)
      const total = (money.bases.get(branch) ?? 0n) + funded
      return Gateway.budget(this.env, swarm, agent, branch, Number(total > 0n ? total : 1n) / 1_000_000)
    })
    this.budgeting = run.catch(() => undefined)
    return run
  }

  async direct(
    swarm: string,
    input: { agent: string; branch: number; previous: number | null; said: string | null; steer?: { note: string; text: string; who: string }; usd: number | null; wake: string | null },
  ): Promise<Gateway.Result<Gateway.Subagent | null>> {
    const agent = this.agent()?.id
    if (!agent) return { detail: 'The swarm has no agent yet: it starts once money arrives.', ok: false, status: 409 }
    if (agent !== input.agent) return { detail: "The swarm started a new agent since its branches were listed; list them again.", ok: false, status: 409 }
    const set = input.usd === null ? undefined : await this.rebudget(swarm, agent, input.branch)
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

  async settled(row: Store.Row) {
    const agent = this.agent()?.id
    if (!agent) return
    const listed = await Gateway.subagents(this.env, row.id, agent)
    if (!listed.ok) return
    const closed = listed.value.filter((found) => found.parent_agent_id === null && found.status.state === 'closed')
    if (!closed.length) return
    const { settled } = await Store.funds(this.env, row.id, agent)
    const claimed = await Store.claim(this.env, row.id, agent, closed.filter((branch) => !settled.has(branch.agent_id)).map((branch) => branch.agent_id))
    for (const branch of closed.filter((found) => claimed.has(found.agent_id))) {
      const returned = await Store.settle(this.env, { agent, branch: branch.agent_id, claimed: true, left: unspent(branch), swarm: row.id })
      const back = returned.reduce((sum, item) => sum + item.amount, 0n)
      if (back > 0n) this.announce(`${branch.role} (branch ${branch.agent_id}) closed with ${dollars(back)} of its backers' money unspent, which is theirs to put behind something else again.`)
    }
  }

  async release(swarm: string, current: string) {
    for (const old of await Store.replaced(this.env, swarm, current)) {
      const listed = old.agent ? await Gateway.subagents(this.env, swarm, old.agent).catch(() => undefined) : undefined
      let back = 0n
      const claimed = await Store.claim(this.env, swarm, old.agent, old.branches)
      for (const branch of old.branches.filter((id) => claimed.has(id))) {
        const found = listed?.ok ? listed.value.find((agent) => agent.agent_id === branch) : undefined
        const returned = await Store.settle(this.env, { agent: old.agent, branch, claimed: true, left: found ? unspent(found) : null, swarm })
        back += returned.reduce((sum, item) => sum + item.amount, 0n)
      }
      if (back > 0n) this.announce(`The swarm started a new agent, so ${dollars(back)} that backers had put behind the old agent's branches went back to them, to put behind the new agent's work.`)
    }
  }

  paced(address: Address) {
    const now = Date.now()
    const key = 'said:' + address.toLowerCase()
    const recent = (this.kv.get<number[]>(key) ?? []).filter((at) => at > now - minuteMs)
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
    const recent = (this.kv.get<number[]>(key) ?? []).filter((at) => at > now - hourMs)
    const oldest = recent[0]
    if (recent.length >= Btw.perHour && oldest !== undefined)
      return { detail: `At most ${Btw.perHour} side questions an hour; the next one opens at ${clock(oldest + hourMs)} UTC.`, ok: false, status: 429 }
    const everyone = (this.kv.get<number[]>('btw:*') ?? []).filter((at) => at > now - hourMs)
    const first = everyone[0]
    if (everyone.length >= Btw.perSwarmHour && first !== undefined)
      return { detail: `This swarm answers at most ${Btw.perSwarmHour} side questions an hour, from everyone; the next one opens at ${clock(first + hourMs)} UTC.`, ok: false, status: 429 }
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

  crew(): Crew {
    return this.kv.get<Crew>('crew') ?? crew()
  }

  digest(event: Gateway.Event, turn: string) {
    const outer = event.event
    if (!outer) return false
    if (outer.source === undefined) {
      if (outer.type !== 'result' || event.request_id !== turn) return false
      this.ended()
      return true
    }

    const at = event.created_at ?? Date.now()
    if (outer.source === 'subagent' && outer.update) {
      const known = this.crew()
      const found = subagent(this.buffers, known, outer.root_session_id ?? this.agent()?.id ?? 'session', outer.update)
      if (!found) return false
      this.kv.put('crew', known)
      const update = outer.update as { event?: { payload?: Record<string, unknown>; type?: string }; type?: string }
      if (update.type === 'added' || update.type === 'status' || update.type === 'completion') this.changed('branches')
      if (update.type === 'event') {
        if (update.event?.type === 'tool.call') for (const found of cues(update.event.payload ?? {})) this.cue(found)
        for (const delta of streamed(found.who, update.event?.type, update.event?.payload ?? {})) this.relay(delta)
      }
      for (const step of found.steps) this.log(step.kind, step.text, step.detail, { at, event: event.seq, who: found.who })
      return false
    }

    const inner = outer.event
    if (inner?.type === 'tool.call') for (const found of cues(inner.payload ?? {})) this.cue(found)
    for (const delta of streamed(null, inner?.type, inner?.payload ?? {})) this.relay(delta)
    this.record(null, inner?.type, inner?.payload ?? {}, event.seq, at)
    return false
  }

  record(who: string | null, type: string | undefined, payload: Record<string, unknown>, event: number, at: number) {
    for (const found of narrate(this.buffers, who, type, payload)) this.log(found.kind, found.text, found.detail, { at, event, who })
  }

  get buffers(): Buffers {
    const name = (who: string | null) => (who === null ? 'thinking' : `thinking:${who}`)
    return {
      add: (who, text) => this.kv.put(name(who), (this.kv.get<string>(name(who)) ?? '') + text),
      take: (who) => {
        const text = this.kv.get<string>(name(who)) ?? ''
        this.kv.delete(name(who))
        return text
      },
    }
  }

  flush() {
    const speakers = [null, ...[...this.kv.list({ prefix: 'thinking:' })].map(([name]) => name.slice('thinking:'.length))]
    for (const who of speakers) {
      const thinking = this.buffers.take(who).trim()
      if (thinking) this.log('thinking', clip(thinking, 1500), null, { who })
    }
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
    const bytes = encoded({ entry: { ...logged, seq: Number(row.seq) }, type: 'entry' })
    for (const watcher of this.watchers) if (watcher.follow || watcher.relaying) this.write(watcher, bytes)
  }
}

type Failed = { busy?: boolean; failed: string; price?: bigint; room: Room | undefined; small?: boolean }

function pool(): Source {
  return { currency: Chain.tokens.ousd.address, id: 'pool', label: "the swarm's wallet" }
}

function owing(payee: Address): Source {
  return { currency: Chain.tokens.ousd.address, id: 'hand:' + payee.toLowerCase(), label: `the swarm's wallet to hand owner ${short(payee)}` }
}

function owner(source: Source) {
  return source.id.startsWith('hand:') ? (source.id.slice('hand:'.length) as Address) : undefined
}

function sse(body: BodyInit) {
  return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'text/event-stream' } })
}

type Watcher = { follow: boolean; relaying: boolean; until: number; writer: WritableStreamDefaultWriter<Uint8Array> }

type Ring = { bytes: number; frames: Uint8Array[] }

type Cue = 'artifacts' | 'chain' | 'git' | 'hands' | 'sponsors' | 'turn'

type Pending = { at: number; parts: Set<Part>; pulse: Store.Row | undefined; timer: ReturnType<typeof setTimeout> | undefined }

type Plan = { chain: boolean; hands: boolean; sponsors: boolean }

const everything: Plan = { chain: true, hands: true, sponsors: true }

const ringBytes = 2_000_000

const maxWaitMs = 60_000

const streamFails = 2

const fallbackMs = 5 * 60_000

const cueMs = 5_000

const coalesceMs = 2_000

const viewKeys = new Set(['run', 'hands', 'repo', 'owner', 'id'])

type Attached = { address?: Address | null; hello?: number; typing?: number }

const helloMs = 10_000

const holderMs = 300_000

const typingMs = 2_000

const socketsMost = 500

const minuteMs = 60_000

const postsPerMinute = 10

const backlogSize = 500

const followForMs = 15 * 60_000

const beatMs = 25_000

const keepalive = new TextEncoder().encode(': keepalive\n\n')

function encoded(event: Live) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)
}

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

function frame(block: string) {
  const lines = block.split('\n')
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return undefined
  return { data, live: lines.some((line) => /^event:\s*live$/.test(line)) }
}

function streamed(who: string | null, type: string | undefined, payload: Record<string, unknown>): Live[] {
  const text = typeof payload['text'] === 'string' ? redact(payload['text']) : ''
  const offset = typeof payload['offset'] === 'number' ? payload['offset'] : null
  if (type === 'assistant.delta') return [{ channel: 'text', delta: text, item: String(payload['item_id'] ?? ''), offset, type: 'delta', who }]
  if (type === 'reasoning.summary.delta') return [{ channel: 'thinking', delta: text, item: `reasoning:${String(payload['model_call_index'] ?? '')}`, offset: null, type: 'delta', who }]
  if (type === 'tool.input.delta') return [{ channel: 'input', delta: text, item: String(payload['call_id'] ?? ''), offset: null, type: 'delta', who }]
  return []
}

function cues(payload: Record<string, unknown>): Cue[] {
  const said = `${tool(payload)} ${typeof payload['arguments'] === 'string' ? payload['arguments'] : JSON.stringify(payload['arguments'] ?? {})}`
  return [
    ...(/git_create|git_commit|git_remote|git push/.test(said) ? (['git'] as const) : []),
    ...(/kv_set|bucket_put/.test(said) && said.includes('artifacts/') ? (['artifacts'] as const) : []),
    ...(/compute_create|compute_hand|compute_terminate/.test(said) ? (['hands'] as const) : []),
  ]
}

function same(a: string, b: string) {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  return left.length === right.length && crypto.subtle.timingSafeEqual(left, right)
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function slug(title: string) {
  return (
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'swarm'
  )
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

function unspent(branch: Gateway.Subagent) {
  if (branch.budget_usd === undefined) return null
  const left = Memo.units(branch.budget_usd.toFixed(6)) - Memo.units((branch.spent_usd ?? 0).toFixed(6))
  return left > 0n ? left : 0n
}

function weighed(note: Note) {
  const backers = note.backers === 1 ? '1 backer' : `${note.backers} backers`
  return `[${dollars(Memo.units(note.weight))} behind this, from ${backers}] ${Mention.claimed(note.note)}`
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

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function trim(amount: string) {
  return amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

function dollars(atomics: bigint) {
  return '$' + trim(Memo.decimal(atomics))
}

function capital(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function clock(at: number) {
  return new Date(at).toISOString().slice(11, 16)
}

function percent(share: number) {
  return `${Math.round(share * 1000) / 10}%`
}
