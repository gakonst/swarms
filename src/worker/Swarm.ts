import { DurableObject } from 'cloudflare:workers'
import type { Account, Address, Hex } from 'viem'
import { isAddress, keccak256, stringToHex } from 'viem'
import { Challenge } from 'mppx'
import { Mppx, tempo } from 'mppx/client'
import type { Artifact, Chatter, Code, Currency, Entry, Hand, Kind, Live, Note, Said, Shown, Snapshot, Steer, Terms, Token, Update, Working } from '../shared/Api.ts'
import { type Buffers, type Crew, clip, crew, memory, narrate, redact, subagent } from '../shared/Trail.ts'
import * as Answer from '../shared/Answer.ts'
import * as Memo from '../shared/Memo.ts'
import * as Artifacts from './Artifacts.ts'
import * as Chain from './Chain.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Keys from './Keys.ts'
import * as Payer from './Payer.ts'
import * as Phase from './Phase.ts'
import type { Why } from '../shared/Api.ts'
import * as Seal from './Seal.ts'
import * as Search from './Search.ts'
import * as Sessions from './Sessions.ts'
import * as Store from './Store.ts'
import * as Vault from './Vault.ts'

export type Pledged = {
  amount: string
  id: string
  contributor: Address
  note: string | null
  noteId: string | null
  swarm: string
  token: Currency
}

export type Contributed = {
  amount: string
  contributor: Address
  hash: string
  note: string | null
  noteId: string | null
  swarm: string
  token: Token
}

export type Budgeted = {
  amount: string
  id: string
  contributor: Address
  note: string | null
  period: number
  swarm: string
  token: Currency
}

export type View = {
  code: Code | null
  feed: Entry[]
  hands: Hand[]
  left: string | null
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
  steer: { amount: string; note: string; noteId: string } | null
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

type Source = { currency: Address; id: string; label: string; row: Store.Allowance | null }

type Signer = { account: Account; key: Hex }

type Room = { amount: bigint; ended?: 'expired' | 'revoked' | 'spent'; resets: number | null; short?: boolean }

type Money = { biggest: bigint; left: bigint; row: Store.Row }

type Repo = { name: string; state: 'none' | 'ready' }

type Guest = { label: string; name: string; terms: Terms }

type Seen = { title: string; turn: number; version: number }

const schema = [
  'CREATE TABLE IF NOT EXISTS feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, round INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, detail TEXT)',
  "CREATE TABLE IF NOT EXISTS turns (n INTEGER PRIMARY KEY, turn TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL, message TEXT, spent_before TEXT NOT NULL, spent TEXT NOT NULL DEFAULT '0')",
  'CREATE TABLE IF NOT EXISTS steered (note TEXT PRIMARY KEY, at INTEGER NOT NULL)',
  "CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, author TEXT, text TEXT NOT NULL, mentions TEXT NOT NULL DEFAULT '[]', steer TEXT)",
]

const columns = [
  ['turns', 'commits', "ALTER TABLE turns ADD COLUMN commits TEXT NOT NULL DEFAULT '[]'"],
  ['turns', 'base', 'ALTER TABLE turns ADD COLUMN base TEXT'],
  ['feed', 'who', 'ALTER TABLE feed ADD COLUMN who TEXT'],
  ['feed', 'event', 'ALTER TABLE feed ADD COLUMN event INTEGER'],
  ['chat', 'artifact', 'ALTER TABLE chat ADD COLUMN artifact TEXT'],
] as const

const followMs = 2_000

const refreshMs = 10_000

const healMs = 5 * 60_000

const retryMs = 30_000

const maxFailures = 3

const settleMs = 15_000

const quickMs = 60_000

const vendorCap = 1_000_000n

const quietMs = 600_000
const snapshotMs = 60_000
const snapshotFiles = 2_000
const snapshotText = 64_000


const unfundedMs = 15 * 60_000

const restMs = 10 * 60_000

const refundMs = 60_000

const refundWaitMs = 20 * 60_000

const closeWaitMs = 30 * 60_000

const smallestSwap = 10_000n

const smallestPull = 30_000n

const chunk = 100_000n

const handChunk = 50_000n

const perCall = Store.perCall

const recentMs = 10_000

const holdMs = 90_000

const heldMs = 10 * 60_000

const confirmMs = 8_000

const shelfMs = 30_000

const rowMs = 10_000

const stillMs = 2_000

export class Swarm extends DurableObject<Cloudflare.Env> {
  stepping: Promise<number | null> | undefined
  paying: Promise<unknown> = Promise.resolve()
  funding: Promise<void> | undefined
  signers = new Map<string, Promise<Signer>>()
  clients = new Map<string, Payer.Client>()
  memos = new Map<string, { at: number; epoch: number; marked: number; value: unknown }>()
  marked = 0
  boot = crypto.randomUUID().slice(0, 8)
  touches = 0
  stamped = { at: 0, tuple: '' }
  kept: SyncKvStorage | undefined
  watchers = new Set<Watcher>()
  beating: ReturnType<typeof setInterval> | undefined

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
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  get kv(): SyncKvStorage {
    return (this.kept ??= touched(this.ctx.storage.kv, () => this.touch()))
  }

  touch() {
    this.touches += 1
  }

  stamp(): Stamp {
    const tuple = `${Store.epoch()}.${this.marked}.${this.touches}`
    const now = Date.now()
    if (tuple !== this.stamped.tuple) this.stamped = { at: now, tuple }
    return { quiet: now - this.stamped.at >= stillMs, version: `${this.boot}.${tuple}` }
  }

  version(): Stamp {
    this.ctx.waitUntil(this.heal())
    return this.stamp()
  }

  found(id: string) {
    return this.memo(`row:${id}`, () => Store.find(this.env, id), (row) => !!row?.wallet)
  }

  async memo<T>(key: string, read: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
    const held = this.memos.get(key)
    if (held && held.epoch === Store.epoch() && held.marked === this.marked && Date.now() - held.at < rowMs) return structuredClone(held.value) as T
    const at = Date.now()
    const epoch = Store.epoch()
    const marked = this.marked
    const value = await read()
    if (keep(value)) this.memos.set(key, { at, epoch, marked, value: structuredClone(value) })
    else this.memos.delete(key)
    return value
  }

  async pledged(input: Pledged) {
    this.marked += 1
    this.kv.put('id', input.swarm)
    this.log(
      'funds',
      `${short(input.contributor)} pledged ${trim(input.amount)} ${Chain.currencies[input.token].symbol}${input.note ? ' with a note' : ''}`,
      input.note,
    )
    this.announce(`@${(await Store.account(this.env, input.contributor)).handle} pledged ${trim(input.amount)} ${Chain.currencies[input.token].symbol}${input.note ? ` behind "${input.note}"` : ''}.`)
    const row = await this.found(input.swarm)
    if (row) await this.upfront(row, input.id, input.token, BigInt(Memo.units(input.amount)))
    if (input.noteId) await this.steer(input.swarm, input.noteId, `pledged ${trim(input.amount)} ${Chain.currencies[input.token].symbol}`)
    if (!this.kv.get<string>('turn')) await this.ctx.storage.setAlarm(Date.now())
  }

  async contributed(input: Contributed) {
    this.marked += 1
    this.kv.put('id', input.swarm)
    this.kv.delete('exhausted:pool')
    this.log(
      'funds',
      `${short(input.contributor)} sent ${trim(input.amount)} ${Chain.tokens[input.token].symbol}${input.note ? ' with a note' : ''}`,
      [input.note, input.hash].filter(Boolean).join('\n'),
    )
    this.announce(`@${(await Store.account(this.env, input.contributor)).handle} sent ${trim(input.amount)} ${Chain.tokens[input.token].symbol}${input.note ? ` behind "${input.note}"` : ''}.`)
    if (input.noteId) await this.steer(input.swarm, input.noteId, `sent ${trim(input.amount)} ${Chain.tokens[input.token].symbol}`)
    if (!this.kv.get<string>('turn')) await this.ctx.storage.setAlarm(Date.now())
  }

  async budgeted(input: Budgeted) {
    this.marked += 1
    this.kv.put('id', input.swarm)
    this.log(
      'funds',
      `${short(input.contributor)} set a budget of ${trim(input.amount)} ${Chain.currencies[input.token].symbol} ${per(input.period)}${input.note ? ' with a note' : ''}`,
      input.note,
    )
    const row = await this.found(input.swarm)
    if (row) await this.upfront(row, input.id, input.token, BigInt(Memo.units(input.amount)))
    this.announce(`@${(await Store.account(this.env, input.contributor)).handle} set a budget of ${trim(input.amount)} ${Chain.currencies[input.token].symbol} ${per(input.period)}${input.note ? ` behind "${input.note}"` : ''}.`)
    if (!this.kv.get<string>('turn')) await this.ctx.storage.setAlarm(Date.now())
  }

  async upfront(row: Store.Row, id: string, token: Currency, amount: bigint) {
    try {
      if (token !== 'mach') {
        await this.fund(row)
        return
      }
      const source = await this.source(row, id)
      if (!source || this.kv.get(`channel:${id}`)) return
      if (source.row && !source.row.period && (await this.sponsored(row, source))) return
      const init = { body: JSON.stringify({ key: 'probe' }), headers: { 'content-type': 'application/json', 'gateway-app': Gateway.app(row.id) }, method: 'POST' }
      const challenge = await fetch(this.env.GATEWAY_URL + '/v1/kv/get', init)
      const paid = await this.attempt(row, source, { challenge: challenge.headers.get('www-authenticate') ?? '', secret: '' }, [])
      if (!('authorization' in paid)) return this.log('error', `Could not open ${source.label}'s channel yet.`, 'failed' in paid ? paid.failed : 'The gateway cannot sponsor its network fee now.')
      await fetch(this.env.GATEWAY_URL + '/v1/kv/get', { ...init, headers: { ...init.headers, authorization: paid.authorization } })
      this.log('funds', `Opened ${source.label}'s channel with ${trim(Memo.decimal(BigInt(this.kv.get<Payer.Channel>(`channel:${id}`)?.deposit ?? String(amount))))} MACH, held in the escrow until the swarm spends it.`)
    } catch (error) {
      this.log('error', 'Charging the new money up front failed; it is charged on the first payment instead.', String(error))
    }
  }

  async sponsored(row: Store.Row, source: Source) {
    const terms = await Gateway.sponsorship(this.env)
    if (!terms) return false
    const room = await this.room(row, source)
    if (room.amount < Memo.units(terms.least)) return false
    const signer = await this.signer(row, source)
    const opened = await Payer.sponsored(this.env, signer.account, { deposit: room.amount, operator: terms.operator, signer: terms.signer, token: source.currency }).catch((error: unknown) => error as Error)
    if (opened instanceof Error) {
      this.log('error', `Could not open ${source.label}'s channel for the gateway, so the swarm pays from it itself.`, opened.message.split('\n')[0] ?? null)
      return false
    }
    const sent = await Gateway.sponsor(this.env, row.id, { descriptor: opened.descriptor, transaction: opened.transaction })
    const registered = sent.ok || !(await Payer.state(this.env, opened.id).then((state) => state.deposit > 0n).catch(() => false)) ? sent : await Gateway.sponsor(this.env, row.id, { descriptor: opened.descriptor })
    if (!registered.ok) {
      this.log('error', `The gateway did not take ${source.label}'s channel, so the swarm pays from it itself.`, registered.detail)
      return false
    }
    this.kv.put(`channel:${source.id}`, { at: Date.now(), confirmed: true, deposit: String(Memo.units(registered.value.deposit)), descriptor: opened.descriptor, id: opened.id, signed: '0', sponsored: true } satisfies Payer.Channel)
    this.kv.put('spent:' + source.id, String(Memo.units(registered.value.spent)))
    this.log('funds', `Opened ${source.label}'s channel with ${trim(registered.value.deposit)} MACH for the gateway, which spends it on the swarm's agent directly; what it does not spend goes back to its backer when the swarm is done.`, registered.value.tx ?? null)
    return true
  }

  async hand(swarm: string, name: string): Promise<Gateway.Result<Gateway.Minted>> {
    this.marked += 1
    this.kv.put('id', swarm)
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
    if (id && !this.kv.get<boolean>('open')) {
      const row = await this.found(id)
      if (row?.status === 'done' && (this.kv.get<boolean>('refunded') || this.kv.get<number>('refundAt') === undefined)) await this.reopen(row)
      if (row && (row.status !== 'done' || this.kv.get<number>('refundAt') === undefined)) this.kv.put('open', true)
    }
    if (id && !this.kv.get<number>('published') && now - (this.kv.get<number>('exposing') ?? 0) > 60_000) {
      this.kv.put('exposing', now)
      const row = await this.found(id)
      if (row) await this.expose(row).catch((error: unknown) => console.error('Making the swarm data public failed', error))
      this.kv.delete('exposing')
    }
    if (!this.kv.get<string>('paused') || this.kv.get<string>('turn') || now - (this.kv.get<number>('healed') ?? 0) < healMs) return
    const alarm = await this.ctx.storage.getAlarm()
    if (alarm !== null && alarm < now + healMs) return
    this.kv.put('healed', now)
    console.log(JSON.stringify({ alarm, heal: this.kv.get<string>('id') }))
    await this.ctx.storage.setAlarm(now)
  }

  view(shape: { feed?: number; texts?: boolean } = {}): View {
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
    const turns = this.turns()
    const paused = this.kv.get<string>('paused')
    return {
      code: id && repo && owner ? { app: Gateway.app(id), clone: `${this.env.GATEWAY_URL}/p/${owner}/${Gateway.app(id)}/git/${repo}.git`, name: repo, owner } : null,
      feed,
      hands: this.kv.get<Hand[]>('hands') ?? [],
      left: this.kv.get<string>('left') ?? null,
      reason: paused ? (Answer.spoken(paused) ?? 'Out of money. Adding money wakes it.') : null,
      stamp,
      why: paused ? known(this.kv.get<string>('why')) : null,
      steered: this.steered(),
      ended: turns.flatMap((turn) => (turn.endedAt === null ? [] : [{ endedAt: turn.endedAt, n: turn.n }])),
      updates: shape.texts === false ? updates(turns).map((update) => ({ ...update, text: '' })) : updates(turns),
      working: this.working(),
    }
  }

  pulse() {
    const turns = this.turns()
    return { turns, updates: updates(turns), working: this.working() }
  }

  working(): Working | null {
    const since = this.kv.get<number>('since')
    if (!this.kv.get<string>('turn') && !since) return null
    return { since: since ?? this.kv.get<number>('started') ?? Date.now() }
  }

  turns(): Search.Turn[] {
    return this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>('SELECT n, started_at, ended_at, status, message, spent, commits, base FROM turns ORDER BY n')
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
    filter: { before?: number | undefined; kind?: Kind | undefined; limit?: number | undefined; who?: string | undefined } = {},
  ): Entry[] {
    const where = [
      'seq > ?',
      ...(filter.before === undefined ? [] : ['seq < ?']),
      ...(filter.kind ? ['kind = ?'] : []),
      ...(filter.who === undefined ? [] : [filter.who === 'agent' ? 'who IS NULL' : 'who = ?']),
    ]
    const values = [
      after,
      ...(filter.before === undefined ? [] : [filter.before]),
      ...(filter.kind ? [filter.kind] : []),
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
    filter: { before?: number | undefined; kind?: Kind | undefined; limit?: number | undefined; who?: string | undefined } = {},
  ) {
    const last = this.ctx.storage.sql.exec<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM feed').one().seq ?? 0
    return { entries: this.feed(after, filter), last: Number(last) }
  }

  search(terms: string[], limit: number): Entry[] {
    if (!terms.length) return []
    const score = terms.map(() => "(instr(lower(text || ' ' || coalesce(detail, '')), ?) > 0)").join(' + ')
    return this.ctx.storage.sql
      .exec<Record<string, SqlStorageValue>>(
        `SELECT seq, at, kind, text, detail, who, event FROM (SELECT *, ${score} AS score FROM feed) WHERE score > 0 ORDER BY score DESC, seq DESC LIMIT ?`,
        ...terms,
        limit,
      )
      .toArray()
      .map(entry)
  }

  override async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === '/chat') return this.socket(request)
    const after = url.searchParams.get('after')
    const follow = after !== null && /^\d{1,15}$/.test(after)
    const streaming = this.streaming()
    if (!follow && !streaming) return sse(`data: ${JSON.stringify({ type: 'idle' } satisfies Live)}\n\n`)

    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const watcher: Watcher = { follow, relaying: false, signal: request.signal, until: Date.now() + followForMs, writer: writable.getWriter() }
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
    if (streaming) this.ctx.waitUntil(this.relay(watcher))
    this.beat()
    return sse(readable)
  }

  streaming() {
    return !!(this.kv.get<string>('id') && this.kv.get<string>('agent') && this.kv.get<string>('turn') && this.kv.get<string>('secret'))
  }

  async relay(watcher: Watcher, again = true): Promise<void> {
    const id = this.kv.get<string>('id') ?? ''
    const agent = this.kv.get<string>('agent') ?? ''
    const turn = this.kv.get<string>('turn') ?? ''
    if (watcher.relaying || !this.watchers.has(watcher) || !this.streaming()) return
    watcher.relaying = true
    let ended = false
    try {
      const upstream = await Gateway.stream(this.env, id, agent, this.kv.get<number>('cursor') ?? 0, watcher.signal).catch(() => undefined)
      if (!upstream?.ok || !upstream.body) {
        this.write(watcher, encoded({ type: 'idle' }))
        return
      }
      const reader = upstream.body
        .pipeThrough(live({ buffers: memory(), crew: this.crew(), ended: () => (ended = true), scope: agent, since: this.working()?.since ?? Date.now(), turn }))
        .getReader()
      for (;;) {
        const read = await reader.read().catch(() => ({ done: true as const, value: undefined }))
        if (read.done) break
        if (!this.write(watcher, read.value)) {
          await reader.cancel().catch(() => undefined)
          return
        }
      }
    } finally {
      watcher.relaying = false
      if (!watcher.follow) this.unwatch(watcher)
    }
    if (!ended && again && watcher.follow && this.kv.get<string>('turn') === turn) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      if (this.kv.get<string>('turn') === turn) return this.relay(watcher, false)
    }
  }

  attach() {
    for (const watcher of this.watchers) if (watcher.follow && !watcher.relaying) this.ctx.waitUntil(this.relay(watcher))
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
    this.stepping ??= this.step()
      .catch((error: unknown) => {
        this.log('error', 'The swarm hit an error and will retry.', String(error))
        return Date.now() + retryMs
      })
      .finally(() => {
        this.stepping = undefined
      })
    const next = await this.stepping
    if (next !== null) await this.ctx.storage.setAlarm(next)
  }

  async step() {
    const id = this.kv.get<string>('id')
    const row = id ? await this.found(id) : null
    if (!row) return null

    await this.upgrade(row)
    const phase = Phase.of(this.kv, row.status === 'done')
    if (phase === 'settled') return this.reopen(row).then(async () => {
      const fresh = await this.found(row.id)
      return fresh ? this.advance(fresh) : null
    })
    if (phase === 'working') return this.follow(row)
    if (phase === 'settling') return this.settle(row)
    return this.advance(row)
  }

  async upgrade(row: Store.Row) {
    if (this.kv.get<string>('secret')) return
    const pool = this.kv.get<string>('poolKey')
    const legacy = await Store.active(this.env, row.id)
    if (pool) {
      await Gateway.revoke(this.env, await Seal.open(this.env.SWARMS_SECRET, pool))
      this.kv.put('banked:pool', String(BigInt(this.kv.get<string>('poolSpent') ?? '0') + BigInt(this.kv.get<string>('poolChannel') ?? '0')))
      this.kv.put('returning', Date.now() + 2 * 60_000)
      this.log('funds', "Revoked the swarm's old gateway key, so its channel closes into the swarm's wallet, which pays from here on through the swarm's own channel.")
    }
    for (const backing of legacy) {
      await Gateway.revoke(this.env, await Seal.open(this.env.SWARMS_SECRET, backing.sealed_key ?? ''))
      await Store.spend(this.env, backing.id, BigInt(backing.spent), 'ended')
      this.log('funds', `${short(backing.contributor)}'s pledge was a gateway API key, which can only pay for its own agent, so it was revoked and its unspent money goes back to their wallet.`)
    }
    const turn = this.kv.get<string>('turn')
    if (turn) this.ctx.storage.sql.exec("UPDATE turns SET status = 'cancelled', ended_at = ? WHERE turn = ? AND status = 'running'", Date.now(), turn)
    this.touch()
    for (const key of ['poolKey', 'poolAgent', 'poolChannel', 'poolSpent', 'source', 'pledge', 'agent', 'cursor', 'turn', 'started'])
      this.kv.delete(key)
    for (const [key] of [...this.kv.list({ prefix: 'seen:' })]) this.kv.delete(key)
    this.kv.put('fresh', true)
    this.kv.put('secret', hex(crypto.getRandomValues(new Uint8Array(32))))
  }

  async advance(row: Store.Row) {
    const worked = this.kv.get<number>('n') ?? 0
    await this.fund(row)
    const money = await this.refresh(row)
    if (money.left < Store.reserve) {
      const wake = await this.wake(row.id)
      await this.pause(
        row,
        worked ? 'paused' : 'funding',
        worked || money.row.contributors
          ? broke(money.left, wake)
          : undefined,
      )
      return wake
    }
    const wanted = BigInt(this.kv.get<string>('wanted') ?? '0')
    if (wanted > money.biggest) {
      const wake = await this.wake(row.id)
      await this.pause(row, worked ? 'paused' : 'funding', costly(wanted), 'costly')
      return wake
    }
    const repo = await this.repo(row)

    const agent = await this.lead(row)
    if (!agent) return Date.now() + retryMs

    const n = worked + 1
    const resumed = !this.kv.get<number>('since')
    const notes = await this.notes(money.row)
    const base = repo.state === 'ready' ? await this.head(row.id, repo.name) : null
    if (base) this.kv.put('seen', base)
    else this.kv.delete('seen')
    const fresh = this.kv.get<boolean>('fresh')
    const told = new Set(this.steered())
    const text = fresh ? brief(money.row, notes) : next(notes.filter((note) => !told.has(note.id)))
    const sent = await Gateway.prompt(this.env, row.id, agent, { prompt: text, steer: false })
    if (!sent.ok) {
      this.log('error', 'The gateway did not take the next message for the agent.', sent.detail)
      if (sent.status === 404) this.kv.delete('agent')
      return Date.now() + retryMs
    }

    Phase.check(Phase.of(this.kv, row.status === 'done'), 'working')
    const now = Date.now()
    await this.cap(row, money.left / Hands.share)
    this.kv.put('fresh', false)
    this.kv.put('shelved', true)
    this.kv.put('turn', sent.value.request_id)
    this.attach()
    this.kv.delete('paused')
    this.kv.delete('why')
    this.kv.put('n', n)
    this.kv.put('started', now)
    if (resumed) this.kv.put('since', now)
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO turns (n, turn, started_at, status, spent_before, base) VALUES (?, ?, ?, 'running', ?, ?)",
      n,
      sent.value.request_id,
      now,
      String(money.row.spent),
      base,
    )
    for (const note of notes)
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO steered (note, at) VALUES (?, ?)', note.id, now)
    this.touch()
    await Store.update(this.env, row.id, { rounds: n, status: 'running', why: null })
    this.log('status', resumed ? `${worked ? 'Back at work' : 'Started working'}.` : 'Told the agent to keep going.', text)
    if (resumed) this.announce(`${worked ? 'Back at work' : 'Started working'}.`)
    return now + followMs
  }

  async lead(row: Store.Row) {
    const payer = { secret: this.kv.get<string>('secret') ?? '', url: `${this.env.SWARMS_URL}/api/swarms/${row.id}/pay` }
    const known = this.kv.get<string>('agent')
    if (known) {
      if (this.kv.get<string>('url') === payer.url) return known
      const patched = await Gateway.repay(this.env, row.id, known, payer)
      if (patched.ok) {
        this.kv.put('url', payer.url)
        return known
      }
      if (patched.status !== 404) return undefined
      this.kv.delete('agent')
    }

    const created = await Gateway.agent(this.env, row.id, { name: row.title.slice(0, 60), payer })
    if (!created.ok) {
      this.log('error', 'The gateway did not create the agent.', created.detail)
      return undefined
    }
    this.kv.put('agent', created.value.id)
    this.kv.put('url', payer.url)
    this.kv.put('cursor', 0)
    this.kv.put('fresh', true)
    this.log('status', "Created the swarm's agent on the gateway. Every model call, machine and tool it pays for is paid from the contributions, one at a time.", created.value.id)
    return created.value.id
  }

  async follow(row: Store.Row) {
    const agent = this.kv.get<string>('agent')
    const turn = this.kv.get<string>('turn')
    if (!agent || !turn) return turn ? this.finish(row, { error: 'The agent is gone.', request_id: turn, status: 'failed' }) : Date.now()

    let cursor = this.kv.get<number>('cursor') ?? 0
    let ended = false
    for (let page = 0; page < 5; page++) {
      const read = await Gateway.events(this.env, row.id, agent, cursor)
      if (!read.ok) break
      for (const event of read.value.events) ended = this.digest(event, turn) || ended
      cursor = read.value.next_cursor
      this.kv.put('cursor', cursor)
      if (!read.value.has_more) break
    }

    const now = Date.now()
    if (!ended && now - (this.kv.get<number>('checked') ?? 0) < refreshMs) return now + followMs

    this.kv.put('checked', now)
    const [report, money] = await Promise.all([Gateway.turn(this.env, row.id, agent, turn), this.refresh(row), this.watch(row), now - (this.kv.get<number>('shelvedAt') ?? 0) >= shelfMs ? this.publish(row.id) : undefined])
    if (report.ok && !['queued', 'running'].includes(report.value.status)) return this.finish(row, report.value)
    if (!report.ok && report.status !== 401 && report.status < 500)
      return this.finish(row, { error: report.detail, request_id: turn, status: 'failed' })
    if (money.left < Store.reserve + Store.headroom || BigInt(this.kv.get<string>('loose') ?? '0') >= smallestSwap) await this.fund(money.row)
    return now + followMs
  }

  async finish(row: Store.Row, report: Gateway.Report) {
    const n = this.kv.get<number>('n') ?? 0
    const error = typeof report.error === 'string' ? report.error : report.error?.message
    const message = report.ok?.message ?? error ?? null
    const status = report.status === 'completed' ? 'completed' : report.status === 'cancelled' ? 'cancelled' : 'failed'
    const started = this.kv.get<number>('started') ?? 0
    this.flush()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    for (const source of await this.sources(row)) await this.probe(row, source).catch(() => undefined)
    const money = await this.refresh(row)
    const found = this.ctx.storage.sql
      .exec<{ base: string | null; spent_before: string }>('SELECT spent_before, base FROM turns WHERE n = ?', n)
      .toArray()[0]
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
    this.kv.delete('turn')
    this.kv.delete('started')
    const answer = status === 'completed' && message ? Answer.parse(redact(message), Date.now()) : undefined
    if (answer?.text) await Store.update(this.env, row.id, { answer: JSON.stringify(answer) })
    const ended = this.turns().find((turn) => turn.n === n)
    if (ended) await Search.report(this.env, row.id, ended).catch((error: unknown) => console.error('Indexing the update failed', error))
    const pushed = commits.length ? ` and pushed ${commits.length} commit${commits.length === 1 ? '' : 's'} to ${repo.name}` : ''
    this.log(
      status === 'completed' ? 'status' : 'error',
      status === 'completed' ? `Posted an update after spending ${dollars(spent > 0n ? spent : 0n)}${pushed}.` : `The agent stopped with an error after spending ${dollars(spent > 0n ? spent : 0n)}${pushed}.`,
      status === 'completed' ? (commits.length ? commits.map((commit) => `${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0]}`).join('\n') : null) : message,
    )
    await this.publish(row.id)
    if (answer?.text) this.announce(`Update: ${Answer.excerpt(answer.text, 280)}`)

    const failures = status === 'completed' ? 0 : (this.kv.get<number>('failures') ?? 0) + 1
    this.kv.put('failures', failures)
    if (status === 'completed') this.kv.delete('wanted')
    const stored = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM feed WHERE at >= ? AND kind = 'tool' AND ((text || coalesce(detail, '')) LIKE '%kv_set%' OR (text || coalesce(detail, '')) LIKE '%bucket_put%' OR (text || coalesce(detail, '')) LIKE '%git_create%')", started).one().n
    if (stored > 0 || !this.kv.get<number>('published')) await this.expose(row).catch((error: unknown) => console.error('Making the swarm data public failed', error))
    const wanted = BigInt(this.kv.get<string>('wanted') ?? '0')
    if (status !== 'completed' && (money.left < Store.reserve || wanted > money.biggest)) {
      this.kv.put('failures', 0)
      const wake = await this.wake(row.id)
      await this.pause(
        row,
        'paused',
        wanted > money.biggest
          ? costly(wanted)
          : broke(money.left, wake),
        wanted > money.biggest ? 'costly' : 'money',
      )
      return wake
    }
    if (failures >= maxFailures) {
      this.kv.put('failures', 0)
      const wake = await this.wake(row.id)
      await this.pause(row, 'paused', `Stopped after ${failures} errors in a row. New money or a note restarts it.${wake ? ` More comes in at ${clock(wake)} UTC.` : ''}`, 'rest')
      return wake
    }
    return status === 'completed' ? Math.max(Date.now(), started + quickMs) : Date.now() + settleMs
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
    const account = await Vault.account(this.env, row)
    const held = await Vault.balances(this.env, row.wallet)
    if (held.usdce < amount) {
      const short = amount - held.usdce
      if (held.ousd < short + (short * Vault.slippage) / 10_000n + Vault.dust) return refused("The swarm's wallet cannot cover this service.")
      await Vault.buy(this.env, account, 'usdce', short)
    }
    const client = Mppx.create({ methods: [tempo.charge({ account })], polyfill: false })
    const authorization = await client.createCredential(new Response(null, { headers: { 'www-authenticate': serialized }, status: 402 })).catch((error: unknown) => error as Error)
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
    const started = this.ctx.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM feed WHERE at >= ? AND kind = 'machine' AND text LIKE 'Starting machine%'", this.kv.get<number>('swept') ?? 0).one().n
    if (!started && !(this.kv.get<Hand[]>('hands') ?? []).length) return
    const listed = await Gateway.sandboxes(this.env, row.id)
    if (!listed.ok) return
    this.kv.put('swept', Date.now())
    for (const sandbox of listed.value.sandboxes.filter((found) => found.status !== 'terminated')) {
      const ended = await Gateway.terminate(this.env, row.id, sandbox.sandboxId)
      if (ended.ok) this.log('machine', `Shut down ${sandbox.hand ?? sandbox.sandboxId}, which was still running when the swarm stopped.`)
    }
  }

  async sources(row: Store.Row, all = false): Promise<Source[]> {
    const keys = await this.memo(`keys:${row.id}`, () => Store.keys(this.env, row.id))
    return [...(row.wallet && (all || row.pool_left > 0 || this.kv.get('channel:pool')) ? [pool()] : []), ...keys.map((key) => held(key))]
  }

  async source(row: Store.Row, id: string) {
    if (id === 'pool') return row.wallet ? pool() : undefined
    if (id.startsWith('hand:')) return row.wallet ? owing(id.slice('hand:'.length) as Address) : undefined
    const key = await Store.allowance(this.env, row.id, id)
    return key ? held(key) : undefined
  }

  signer(row: Store.Row, source: Source): Promise<Signer> {
    const cached = this.signers.get(source.id)
    if (cached) return cached
    const created = source.row
      ? Keys.account(this.env, source.row)
      : Seal.open(this.env.SWARMS_SECRET, row.sealed_wallet ?? '').then(async (key) => ({ account: await Vault.account(this.env, row), key: key as Hex }))
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

  async room(row: Store.Row, source: Source): Promise<Room> {
    if (!source.row) {
      const balances = await Vault.balances(this.env, row.wallet as Address)
      return { amount: Payer.max(balances.ousd - Vault.dust, 0n), resets: null }
    }
    const key = source.row
    const state = await Keys.state(this.env, key)
    if (state.published && !key.published) {
      await Store.change(this.env, key.id, { published: 1 })
      key.published = 1
      this.signers.delete(key.id)
      this.clients.delete(key.id)
    }
    const ended = state.revoked ? 'revoked' : key.expires_at <= Date.now() ? 'expired' : !key.period && state.published && state.left < Keys.smallest ? 'spent' : undefined
    return {
      amount: Payer.min(state.left, state.balance),
      ...(ended ? { ended } : {}),
      resets: key.period ? state.periodEnd : null,
      short: state.balance < state.left,
    }
  }

  async channel(source: Source) {
    const channel = this.kv.get<Payer.Channel>(`channel:${source.id}`)
    if (!channel || channel.confirmed) return channel
    for (;;) {
      const state = await Payer.state(this.env, channel.id).catch(() => undefined)
      const deposit = state?.deposit ?? 0n
      if (deposit >= BigInt(channel.deposit) || (deposit > 0n && Date.now() - channel.at > confirmMs)) {
        const confirmed = { ...channel, confirmed: true, deposit: String(deposit) }
        this.kv.put(`channel:${source.id}`, confirmed)
        return confirmed
      }
      if (Date.now() - channel.at > confirmMs) {
        Payer.forget(this.kv, source.id)
        if (Date.now() - (this.kv.get<number>(`unopened:${source.id}`) ?? 0) > quietMs) this.log('error', `The channel for ${source.label} never opened on Tempo, so the next payment opens another.`)
        this.kv.put(`unopened:${source.id}`, Date.now())
        return undefined
      }
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }

  async budget(secret: string, app: string | undefined): Promise<Paid> {
    const known = this.kv.get<string>('secret')
    if (!known || !same(known, secret)) return { code: 'unauthorized', detail: 'Unknown payer secret.', status: 401 }
    const row = await Store.find(this.env, this.kv.get<string>('id') ?? '')
    if (!row) return { code: 'unauthorized', detail: 'No swarm has this id.', status: 401 }
    if (app !== undefined && app !== Gateway.app(row.id)) return { code: 'unauthorized', detail: 'This payer pays only for its own swarm.', status: 401 }
    const summary = Store.summary(row)
    return { daily: summary.daily, raised: summary.raised, spent: summary.spent, usd: summary.remaining }
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
    if (input.operation === 'vendor') return this.vendor(row, input)

    const snapshots = input.channels ?? []
    const known = [...this.kv.list<Payer.Channel>({ prefix: 'channel:' })]
    for (const [index, snapshot] of snapshots.entries())
      for (const [key, channel] of known) {
        if (channel.id.toLowerCase() !== snapshot.channelId.toLowerCase()) continue
        const id = key.slice('channel:'.length)
        this.kv.put('spent:' + id, snapshot.spent)
        if (snapshot.closing || (index === 0 && input.rejected?.status === 410)) this.drop(id)
        else if (!channel.confirmed && BigInt(snapshot.deposit) >= BigInt(channel.deposit)) this.kv.put(key, { ...channel, confirmed: true, deposit: snapshot.deposit })
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
    const open = (await this.sources(row)).filter(
      (source) => (this.kv.get<number>('exhausted:' + source.id) ?? 0) <= Date.now() && !this.kv.get<Payer.Channel>('channel:' + source.id)?.sponsored,
    )
    const ordered = [
      ...open.filter((source) => !source.row),
      ...open.filter((source) => source.row && source.id === current),
      ...open
        .filter((source) => source.row && source.id !== current)
        .sort((a, b) => Number(BigInt(this.kv.get<string>('available:' + b.id) ?? '0') - BigInt(this.kv.get<string>('available:' + a.id) ?? '0'))),
    ]
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
        return result
      }
      if (result.busy) busy = true
      if (result.busy || result.small) {
        small ||= !!result.small
        if (result.small && result.price) wanted = Payer.max(wanted, result.price)
        continue
      }
      if (result.room?.ended && source.row) {
        await this.end(source, result.room.ended)
        continue
      }
      const until = result.room?.resets ?? Date.now() + (result.room?.short ? unfundedMs : restMs)
      this.kv.put('exhausted:' + source.id, until)
      this.log('funds', `${capital(source.label)} cannot pay right now, so the swarm moves on until ${clock(until)} UTC.`, result.failed)
    }

    if (busy) return { code: 'busy', detail: "The swarm's contributions are holding other calls' reservations; try again shortly.", retry: 2, status: 429 }
    if (wanted) this.kv.put('wanted', String(wanted))
    const wake = await this.wake(row.id)
    return {
      code: 'limit_reached',
      detail: small
        ? 'No single contribution to this swarm can pay this much at once right now.'
        : wake
          ? `Every contribution to this swarm is spent for now; the next one comes back at ${new Date(wake).toISOString()}.`
          : 'Every contribution to this swarm is spent.',
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
        : { failed: `The gateway offered no ${source.row ? 'MACH' : 'OUSD'} session to its recipient for at most ${Memo.decimal(Chain.cap)}.`, room: undefined, small: true }
    const mppx = await this.client(row, source)
    const channel = await this.channel(source)
    const price = offered.amount
    const step = payee ? handChunk : chunk

    const unsponsored = async (): Promise<{ feeToken: Address } | Failed | undefined> => {
      if (offered.fee.feePayer || source.row?.token !== 'mach') return undefined
      const token = await Keys.feeToken(this.env, source.row)
      if (!token) return { failed: `The gateway cannot sponsor the network fee now, and ${source.label}'s key holds no stablecoin allowance for fees, or its wallet too little of it.`, room: undefined }
      return offered.fee.feeToken?.toLowerCase() === token.toLowerCase() ? undefined : { feeToken: token }
    }

    if (!channel) {
      const room = await this.room(row, source)
      const deposit = source.row ? room.amount : Payer.min(Payer.max(step, price), room.amount)
      if (deposit < price)
        return { failed: `It can put in ${Memo.decimal(room.amount)} now, less than the ${Memo.decimal(price)} this request holds.`, price, room, small: room.amount >= perCall }
      const fee = await unsponsored()
      if (fee) return fee
      const authorization = await mppx.createCredential(offered.response, { depositRaw: String(deposit) })
      const entry = Payer.opened(this.kv, source.id)
      if (!entry) throw new Error('mppx stored no channel for the open')
      this.kv.put(`channel:${source.id}`, { at: Date.now(), confirmed: false, deposit: String(deposit), descriptor: entry.descriptor, id: entry.channelId, signed: String(price) } satisfies Payer.Channel)
      this.kv.put('spent:' + source.id, String(price))
      this.kv.put('paid:' + source.id, Date.now())
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
    const deposit = BigInt(snapshot?.deposit ?? channel.deposit)
    let topUp: string | undefined
    let additional = 0n
    if (need > deposit) {
      const room = await this.room(row, source)
      const shortfall = need - deposit
      additional = source.row && room.amount >= shortfall ? room.amount : Payer.min(Payer.max(step, shortfall), room.amount)
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
      const fee = await unsponsored()
      if (fee) return fee
      topUp = await mppx.createCredential(offered.response, { action: 'topUp', additionalDepositRaw: String(additional), channelId: channel.id, descriptor: channel.descriptor })
    }
    const authorization = await mppx.createCredential(offered.response, { action: 'voucher', channelId: channel.id, cumulativeAmountRaw: String(need), descriptor: channel.descriptor })
    this.kv.put(`channel:${source.id}`, { ...channel, ...(topUp ? { at: Date.now(), confirmed: false } : {}), deposit: String(deposit + additional), signed: String(need) })
    this.kv.put('pending:' + source.id, [...recent, { amount: String(price), at: Date.now(), cumulative: String(need) }])
    this.kv.put('paid:' + source.id, Date.now())
    return topUp ? { authorization, topUp } : { authorization }
  }

  async probe(row: Store.Row, source: Source) {
    const channel = this.kv.get<Payer.Channel>(`channel:${source.id}`)
    if (!channel?.confirmed || channel.sponsored) return
    const init = { body: JSON.stringify({ key: 'probe' }), headers: { 'content-type': 'application/json', 'gateway-app': Gateway.app(row.id) }, method: 'POST' }
    const challenge = await fetch(this.env.GATEWAY_URL + '/v1/kv/get', init)
    const offered = Payer.offer(challenge.headers.get('www-authenticate') ?? '', source.currency)
    const deposit = BigInt(channel.deposit)
    const known = BigInt(this.kv.get<string>('spent:' + source.id) ?? channel.signed)
    const cumulative = Payer.min(deposit, Payer.max(BigInt(channel.signed) + 1n, known + (offered?.amount ?? 0n)))
    if (!offered || cumulative <= BigInt(channel.signed)) return
    const mppx = await this.client(row, source)
    const authorization = await mppx.createCredential(offered.response, { action: 'voucher', channelId: channel.id, cumulativeAmountRaw: String(cumulative), descriptor: channel.descriptor })
    const paid = await fetch(this.env.GATEWAY_URL + '/v1/kv/get', { ...init, headers: { ...init.headers, authorization } })
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

  async end(source: Source, reason: 'expired' | 'revoked' | 'spent') {
    await Store.change(this.env, source.id, { left_now: '0', next_at: null, pulled: String(this.used(source.id)), status: reason })
    if (this.kv.get<string>('payer') === source.id) this.kv.delete('payer')
    this.log(
      'funds',
      reason === 'spent'
        ? `${capital(source.label)} is used up: ${trim(Memo.decimal(this.used(source.id)))} of ${trim(Memo.decimal(BigInt(source.row?.amount ?? '0')))} MACH spent, and what its channel holds goes back when the swarm is done.`
        : `${capital(source.label)} ${reason === 'revoked' ? 'was revoked in Tempo Wallet' : 'expired'}, so the swarm stopped spending from it.`,
    )
  }

  async wake(swarm: string) {
    const now = Date.now()
    const times = [
      ...[...this.kv.list<number>({ prefix: 'exhausted:' })].map(([, until]) => until),
      this.kv.get<number>('returning') ?? 0,
      ...(await Store.allowances(this.env, swarm)).map((allowance) => allowance.next_at ?? 0),
    ].filter((at) => at > now && at < now + 8 * 86_400_000)
    return times.length ? Math.min(...times) + 2_000 : null
  }

  async refresh(row: Store.Row): Promise<Money> {
    await this.sponsorships(row)
    await this.revive(row)
    const [sources, hands, balances] = await Promise.all([
      this.sources(row, true),
      Gateway.hands(this.env, row.id),
      row.wallet ? Vault.balances(this.env, row.wallet) : Promise.resolve(undefined),
    ])
    let left = 0n
    let biggest = 0n
    let pooled = 0n
    for (const source of sources) {
      const channel = source.row ? await this.channel(source) : this.kv.get<Payer.Channel>(`channel:${source.id}`)
      const spent = BigInt(this.kv.get<string>('spent:' + source.id) ?? channel?.signed ?? '0')
      const inside = channel?.confirmed ? Payer.max(BigInt(channel.deposit) - spent, 0n) : 0n
      const room: Room | undefined = source.row
        ? await this.room(row, source).catch(() => undefined)
        : { amount: balances ? Payer.max(Vault.total(balances) - Vault.dust * 3n, 0n) : 0n, resets: null }
      if (!room) continue
      if (room.ended && source.row && inside < perCall) {
        await this.end(source, room.ended)
        continue
      }
      const available = inside + room.amount
      this.kv.put('available:' + source.id, String(available))
      if (room.amount >= perCall) this.kv.delete('exhausted:' + source.id)
      if (source.row) await Store.change(this.env, source.id, { left_now: String(available), pulled: String(this.used(source.id)) })
      else pooled = available
      if ((this.kv.get<number>('exhausted:' + source.id) ?? 0) > Date.now()) continue
      left += available
      biggest = Payer.max(biggest, available)
    }
    this.kv.put('loose', String(balances ? balances.pathusd + balances.usdce - Vault.dust * 2n : 0n))

    const connected = hands.ok ? hands.value.hands.filter((hand) => hand.connected) : []
    const previous = new Set((this.kv.get<Hand[]>('hands') ?? []).map((hand) => hand.name))
    const issued = new Map(connected.length ? (await Hands.list(this.env, row.id)).map((hand) => [hand.name, hand]) : [])
    const joined: Guest[] = []
    this.kv.put('terms', Object.fromEntries(connected.map((hand) => [hand.name, Hands.terms(hand)])))
    for (const hand of connected) {
      if (previous.has(hand.name)) continue
      const guest = issued.get(hand.name)
      if (guest) joined.push({ ...guest, terms: Hands.terms(hand) })
      if (guest && 'cap' in hand && this.kv.get<string>('turn')) await Gateway.cap(this.env, row.id, hand.name, Number(Memo.decimal(BigInt(this.kv.get<string>('handCap') ?? '0'))))
      this.log(
        'machine',
        guest
          ? `A contributor's machine joined the swarm as hand ${hand.name}${guest.label ? ` (${guest.label})` : ''}.`
          : `Machine ${hand.name} joined the swarm.`,
      )
    }
    for (const name of previous)
      if (!connected.some((hand) => hand.name === name)) this.log('machine', `Machine ${name} left.`)
    this.kv.put('hands', connected.map((hand) => ({ connected: true, name: hand.name })))

    this.kv.put('left', Memo.decimal(left))
    await Store.update(this.env, row.id, {
      machines: connected.length,
      pool_left: Number(pooled),
      pool_spent: Number(this.used('pool') + this.handsUsed()),
    })
    return { biggest, left, row: (await this.found(row.id)) ?? row }
  }

  async revive(row: Store.Row) {
    if (row.status === 'done') return
    for (const key of await Store.drained(this.env, row.id)) {
      const source = held(key)
      const channel = await this.channel(source)
      if (!channel || channel.sponsored) continue
      const chain = await Payer.state(this.env, channel.id).catch(() => undefined)
      if (!chain || chain.deposit === 0n || chain.closeRequestedAt !== 0) continue
      const inside = Payer.max(Payer.min(BigInt(channel.deposit), chain.deposit) - BigInt(this.kv.get<string>('spent:' + source.id) ?? channel.signed), 0n)
      if (inside < perCall) continue
      await Store.change(this.env, key.id, { status: 'active' })
      this.log('funds', `${capital(source.label)} still holds ${trim(Memo.decimal(inside))} MACH in its channel, so the swarm spends it again.`)
    }
  }

  async sponsorships(row: Store.Row) {
    const channels = [...this.kv.list<Payer.Channel>({ prefix: 'channel:' })].filter(([, channel]) => channel.sponsored)
    if (!channels.length) return
    const listed = await Gateway.sponsors(this.env, row.id)
    if (!listed.ok) return
    for (const [key, channel] of channels) {
      const found = listed.value.sponsors.find((item) => item.channel.toLowerCase() === channel.id.toLowerCase())
      if (!found) continue
      const id = key.slice('channel:'.length)
      this.kv.put('spent:' + id, String(Memo.units(found.spent)))
      if (found.closing || found.endedAt !== null) this.drop(id)
    }
  }

  fund(row: Store.Row) {
    this.funding ??= this.refill(row).finally(() => {
      this.funding = undefined
    })
    return this.funding
  }

  async refill(row: Store.Row) {
    if (!row.wallet || !row.sealed_wallet) return
    const owner = await Vault.account(this.env, row)
    const channel = this.kv.get<Payer.Channel>('channel:pool')
    const inside = channel ? Payer.max(BigInt(channel.deposit) - BigInt(this.kv.get<string>('spent:pool') ?? channel.signed), 0n) : 0n
    let balances = await Vault.balances(this.env, row.wallet)
    const have = inside + Vault.total(balances)
    if ((await this.pull(row, have < Store.stock ? Store.stock - have : 0n)) > 0n) balances = await Vault.balances(this.env, row.wallet)

    for (const id of ['pathusd', 'usdce'] as const) {
      const amount = balances[id] - Vault.dust
      if (amount < smallestSwap) continue
      const result = await Vault.swap(this.env, owner, id, amount).catch((error: unknown) => error as Error)
      if (result instanceof Error) {
        this.log('error', `Swapping ${Chain.tokens[id].symbol} to OUSD failed.`, result.message.split('\n')[0] ?? null)
        continue
      }
      this.kv.delete('exhausted:pool')
      this.log(
        'funds',
        `Swapped ${trim(Memo.decimal(amount))} ${Chain.tokens[id].symbol} to ${trim(Memo.decimal(result.received))} OUSD on the stablecoin DEX (quote ${trim(Memo.decimal(result.quote))}, at least ${trim(Memo.decimal(result.minimum))}, fee ${trim(Memo.decimal(result.fee))}).`,
        result.hash,
      )
    }
  }

  async pull(row: Store.Row, need: bigint) {
    if (!row.wallet) return 0n
    const now = Date.now()
    const ready: { allowance: Store.Allowance; room: bigint }[] = []
    for (const allowance of await Store.allowances(this.env, row.id)) {
      const label = `${short(allowance.contributor ?? '')}'s ${allowance.period ? 'budget' : 'pledge'}`
      if (allowance.expires_at <= now) {
        await Store.change(this.env, allowance.id, { detail: 'The key expired.', next_at: null, status: 'expired' })
        this.log('funds', `${label} expired.`)
        continue
      }
      if ((allowance.next_at ?? 0) > now) continue
      const state = await Keys.state(this.env, allowance).catch(() => undefined)
      if (!state) continue
      if (state.revoked) {
        await Store.change(this.env, allowance.id, { detail: 'Revoked in Tempo Wallet.', next_at: null, status: 'revoked' })
        this.log('funds', `${short(allowance.contributor ?? '')} revoked their ${allowance.period ? 'budget' : 'pledge'} in Tempo Wallet, so the swarm stopped pulling from it.`)
        continue
      }
      if (state.published && !allowance.published) allowance.published = 1
      const room = state.left < state.balance ? state.left : state.balance
      if (!allowance.period && state.left < Keys.smallest * 2n) {
        await Store.change(this.env, allowance.id, { detail: null, left_now: '0', next_at: null, status: 'spent' })
        this.log('funds', `${capital(label)} is used up: ${trim(Memo.decimal(BigInt(allowance.pulled)))} ${Chain.currencies[allowance.token].symbol} pulled.`)
        continue
      }
      const waiting =
        state.left < Keys.smallest * 2n
          ? { detail: 'Used up for this period.', next_at: state.periodEnd ?? now + allowance.period * 1000 }
          : state.balance < Keys.smallest * 2n
            ? { detail: `The wallet holds no ${Chain.currencies[allowance.token].symbol}.`, next_at: now + unfundedMs }
            : undefined
      await Store.change(this.env, allowance.id, {
        detail: waiting?.detail ?? null,
        left_now: String(state.left),
        next_at: waiting?.next_at ?? null,
        period_end: state.periodEnd,
        published: allowance.published,
      })
      if (!waiting) ready.push({ allowance, room })
    }
    if (!ready.length) return 0n

    const due = ready.filter((item) => item.allowance.period > 0)
    const pledged = ready.filter((item) => !item.allowance.period)
    const count = need > 0n ? Math.max(1, Math.min(pledged.length, Number(need / smallestPull))) : 0
    const chosen = [...due, ...pledged.slice(0, count).sort((a, b) => (a.room < b.room ? -1 : a.room > b.room ? 1 : 0))]
    let wanted = need
    let pulled = 0n
    for (const [index, { allowance, room }] of chosen.entries()) {
      const remaining = BigInt(chosen.length - index)
      const share = allowance.period > 0 ? room : (wanted + remaining - 1n) / remaining
      if (share <= 0n) continue
      const result = await Keys.pull(this.env, allowance, { amount: share, recipient: row.wallet, room })
      if (!result.ok) {
        await this.refused(allowance, result)
        continue
      }
      wanted -= result.amount
      pulled += result.amount
      const budget = allowance.period > 0
      await Store.give(this.env, {
        amount: String(result.amount),
        budget: allowance.id,
        contributor: allowance.contributor as Address,
        id: result.hash,
        kind: budget ? 'pull' : 'pledge',
        note: budget ? allowance.note : null,
        note_id: budget ? allowance.note_id : null,
        swarm: row.id,
        token: allowance.token as Token,
      })
      if (budget && allowance.note && allowance.note_id)
        await Search.note(this.env, row.id, allowance.note_id, allowance.note).catch((error: unknown) => console.error('Indexing the note failed', error))
      const left = room - result.amount - result.fee
      await Store.change(this.env, allowance.id, {
        detail: null,
        left_now: String(left),
        published: 1,
        pulled: String(BigInt(allowance.pulled) + result.amount),
        pulled_at: Date.now(),
      })
      this.log(
        'funds',
        `Pulled ${trim(Memo.decimal(result.amount))} ${Chain.currencies[allowance.token].symbol} from ${short(allowance.contributor ?? '')}'s ${budget ? 'budget' : 'pledge'} (fee ${trim(Memo.decimal(result.fee))}, ${trim(Memo.decimal(left))} left${budget ? ' this period' : ''}).`,
        result.hash,
      )
      if (budget && allowance.note_id && BigInt(allowance.pulled) === 0n)
        await this.steer(row.id, allowance.note_id, `put a budget of ${trim(Memo.decimal(BigInt(allowance.amount)))} ${Chain.currencies[allowance.token].symbol} ${per(allowance.period)}`)
      if (wanted <= 0n && chosen.slice(index + 1).every((item) => !item.allowance.period)) break
    }
    return pulled
  }

  async refused(allowance: Store.Allowance, result: Extract<Keys.Pulled, { ok: false }>) {
    const now = Date.now()
    const changes: Store.Changes =
      result.reason === 'revoked'
        ? { detail: 'Revoked in Tempo Wallet.', next_at: null, status: 'revoked' }
        : result.reason === 'expired'
          ? { detail: 'The key expired.', next_at: null, status: 'expired' }
          : result.reason === 'limit'
            ? allowance.period
              ? { detail: 'Used up for this period.', next_at: allowance.period_end ?? now + allowance.period * 1000 }
              : { detail: 'Used up.', next_at: null, status: 'spent' }
            : result.reason === 'balance'
              ? { detail: `The wallet holds too little ${Chain.currencies[allowance.token].symbol}.`, next_at: now + unfundedMs }
              : { detail: result.detail, next_at: now + retryMs * 10 }
    await Store.change(this.env, allowance.id, changes)
    this.log('funds', `The swarm could not pull from ${short(allowance.contributor ?? '')}'s ${allowance.period ? 'budget' : 'pledge'}: ${changes.detail ?? result.detail}`, result.detail)
  }

  async pause(row: Store.Row, status: 'funding' | 'paused', reason?: string, why: Why = status === 'funding' ? 'unfunded' : 'money') {
    if (Phase.of(this.kv, row.status === 'done') !== 'idle') return
    const text =
      reason ??
      (status === 'funding'
        ? 'Not started: nobody has funded it yet.'
        : 'Out of money. Adding money wakes it.')
    if (this.kv.get<number>('since')) {
      this.kv.delete('since')
      if (why === 'idle' || why === 'rest') await this.sweep(row)
      if (status === 'paused') this.announce(text)
    }
    if (row.status === status && this.kv.get<string>('paused') === text && this.kv.get<Why>('why') === why) return
    this.kv.put('paused', text)
    this.kv.put('why', why)
    await Store.update(this.env, row.id, { status, why })
    this.log('status', text)
  }

  async reopen(row: Store.Row) {
    this.kv.delete('refunded')
    this.kv.delete('refundAt')
    this.log('status', 'Open again: its agent carries on from where it stopped while it has money.')
  }

  async done(row: Store.Row, reason: string) {
    Phase.check(Phase.of(this.kv, row.status === 'done'), 'settling')
    this.kv.delete('turn')
    this.kv.delete('returning')
    this.kv.delete('paused')
    this.kv.delete('payer')
    this.kv.delete('since')
    await this.sweep(row)
    for (const hand of await Hands.list(this.env, row.id)) await Gateway.detach(this.env, row.id, hand.name)
    await Store.end(this.env, row.id)
    this.kv.put('refundAt', Date.now())
    await Store.update(this.env, row.id, { machines: 0, status: 'done' })
    this.announce(`Done. ${reason} What the swarm did not spend goes back to its backers.`)
    this.log(
      'status',
      `Done. ${reason} Every channel closes and returns what it did not spend, budgets and pledges stop, and what the swarm's wallet did not spend goes back to its contributors in proportion to what each put in.`,
    )
    return Date.now()
  }

  async settle(row: Store.Row) {
    const at = this.kv.get<number>('refundAt')
    if (!at || this.kv.get<boolean>('refunded')) return null
    const open = [...this.kv.list<Payer.Channel>({ prefix: 'channel:' })].sort(([a], [b]) => Number(a === 'channel:pool') - Number(b === 'channel:pool'))
    const failed: string[] = []
    for (const [key, channel] of open) {
      const source = await this.source(row, key.slice('channel:'.length))
      if (!source) Payer.forget(this.kv, key.slice('channel:'.length))
      else if (!(await this.close(row, source, channel))) failed.push(source.label)
    }
    if (failed.length && Date.now() - at < closeWaitMs) return Date.now() + retryMs
    if (failed.length)
      this.log('error', `Could not close ${failed.join(', ')} within 30 minutes. The payer can close it in Tempo Wallet, or the escrow's requestClose returns it.`)
    return this.refund(row, at)
  }

  async close(row: Store.Row, source: Source, channel: Payer.Channel) {
    const init = { body: JSON.stringify({ key: 'close' }), headers: { 'content-type': 'application/json', 'gateway-app': Gateway.app(row.id) }, method: 'POST' }
    const left = Payer.max(BigInt(channel.deposit) - BigInt(this.kv.get<string>('spent:' + source.id) ?? channel.signed), 0n)
    const signer = await this.signer(row, source)
    const mppx = await this.client(row, source)
    const cooperative = !owner(source) && !channel.sponsored
    const challenge = cooperative ? await fetch(this.env.GATEWAY_URL + '/v1/kv/get', init) : undefined
    const authorization = challenge
      ? await (source.row
          ? Payer.closing(mppx, challenge, channel, signer.key)
          : mppx.createCredential(challenge, { action: 'close', channelId: channel.id, cumulativeAmountRaw: channel.signed, descriptor: channel.descriptor })
        ).catch(() => undefined)
      : undefined
    const closed = authorization ? await fetch(this.env.GATEWAY_URL + '/v1/kv/get', { ...init, headers: { ...init.headers, authorization } }).catch(() => undefined) : undefined
    const returned = left > 0n ? `the ${dollars(left)} it did not spend` : 'nothing, since it spent its deposit in full'
    if (channel.sponsored) {
      const ended = await Gateway.unsponsor(this.env, row.id, channel.id)
      if ((ended.ok && ended.value.closed) || (!ended.ok && ended.status === 404)) {
        this.drop(source.id)
        this.log('funds', `The gateway closed the channel of ${source.label}, keeping what the swarm spent and returning ${returned}.`, ended.ok ? ended.value.tx : null)
        return true
      }
    }
    if (!source.row) this.kv.put(source.id === 'pool' ? 'closing' : 'closing:' + source.id, channel.id)
    if (closed?.ok) {
      this.drop(source.id)
      this.log('funds', `Closed the channel of ${source.label}, returning ${returned}.`)
      return true
    }

    const sponsor = await this.sponsor(row)
    if (!sponsor) return false
    const requested = await Payer.requestClose(this.env, channel, signer.account, sponsor).catch((error: unknown) => error as Error)
    if (requested instanceof Error) {
      this.log('error', `Could not ask the escrow to close the channel of ${source.label}.`, requested.message.split('\n')[0] ?? null)
      return false
    }
    this.drop(source.id)
    this.log(
      'funds',
      `Asked the escrow to close the channel of ${source.label}; the gateway closes it within about a minute and returns ${returned}.`,
      requested,
    )
    return true
  }

  async sponsor(row: Store.Row): Promise<{ account: Account; token: Address } | undefined> {
    if (!row.wallet || !row.sealed_wallet) return undefined
    const balances = await Vault.balances(this.env, row.wallet)
    const id = balances.ousd >= Vault.dust / 2n ? 'ousd' : balances.pathusd >= balances.usdce ? 'pathusd' : 'usdce'
    if (balances[id] < Vault.dust / 2n) return undefined
    return { account: await Vault.account(this.env, row), token: Chain.tokens[id].address as Address }
  }

  async refund(row: Store.Row, at: number) {
    if (!row.wallet || !row.sealed_wallet) {
      this.kv.put('refunded', true)
      return null
    }
    const owner = await Vault.account(this.env, row)
    const closing = [this.kv.get<Hex>('closing'), ...[...this.kv.list<Hex>({ prefix: 'closing:' })].map(([, id]) => id)].filter((id) => id !== undefined)
    const states = await Promise.all(closing.map((id) => Payer.state(this.env, id).catch(() => undefined)))
    const expected = BigInt(this.kv.get<string>('expected') ?? '0')
    let balances = await Vault.balances(this.env, row.wallet)
    if ((states.some((state) => !state || state.deposit > 0n) || balances.ousd < expected - expected / 10n) && Date.now() - at < refundWaitMs) return Date.now() + refundMs

    for (const id of ['pathusd', 'usdce'] as const) {
      const amount = balances[id] - Vault.dust
      if (amount >= smallestSwap) await Vault.swap(this.env, owner, id, amount).catch(() => undefined)
    }
    balances = await Vault.balances(this.env, row.wallet)
    const pot = balances.ousd - Vault.dust * 2n
    const shares = await Store.shares(this.env, row.id)
    const total = shares.reduce((sum, share) => sum + share.amount, 0n)
    this.kv.put('refunded', true)
    if (pot < smallestSwap || total <= 0n) {
      await Store.update(this.env, row.id, { pool_left: 0 })
      this.log('funds', `The swarm's wallet has ${dollars(balances.ousd)} left, too little to return.`)
      return null
    }

    const memo = keccak256(stringToHex(`refund:${row.id}`))
    for (const share of shares) {
      const amount = (pot * share.amount) / total
      if (amount < 1_000n) continue
      const sent = await Vault.send(this.env, owner, { amount, memo, to: share.contributor }).catch((error: unknown) => error as Error)
      if (sent instanceof Error) this.log('error', `Returning ${trim(Memo.decimal(amount))} OUSD to ${short(share.contributor)} failed.`, sent.message.split('\n')[0] ?? null)
      else this.log('funds', `Returned ${trim(Memo.decimal(amount))} OUSD to ${short(share.contributor)}, their share of what the swarm's wallet did not spend.`, sent.hash)
    }
    await Store.update(this.env, row.id, { pool_left: 0 })
    return null
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
    for (const hand of listed.value.hands.filter((found) => found.connected && 'cap' in found)) await Gateway.cap(this.env, row.id, hand.name, Number(Memo.decimal(amount)))
  }

  async steer(swarm: string, noteId: string, what: string): Promise<Note | undefined> {
    const row = await this.found(swarm)
    const agent = this.kv.get<string>('agent')
    const turn = this.kv.get<string>('turn')
    if (row?.status === 'running' && !turn) await this.ctx.storage.setAlarm(Date.now())
    if (!row || !agent || !turn || !this.kv.get<string>('secret')) return undefined

    const note = (await this.notes(row)).find((found) => found.id === noteId)
    if (!note) return undefined
    const sent = await Gateway.prompt(this.env, swarm, agent, {
      prompt: note.note,
      steer: true,
    })
    if (!sent.ok) return undefined

    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO steered (note, at) VALUES (?, ?)', note.id, Date.now())
    this.touch()
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
    const turn = this.kv.get<number>('n') ?? 0
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
    this.kv.put('artifacts', next)
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
    if (input.steer) {
      const spent = Memo.units(input.steer.amount)
      const sent = await this.steer(input.swarm, input.steer.noteId, `put ${dollars(spent)} of their backing, from the swarm's room,`)
      const row = sent ? null : await this.found(input.swarm)
      const note = sent ?? (row ? (await this.notes(row)).find((found) => found.id === input.steer?.noteId) : undefined)
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
    return this.speak(input.author, input.text, input.mentions, steer)
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
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ address: null })
    this.presence()
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
    if (event.type === 'hello') {
      const address = typeof event.token === 'string' ? await Sessions.holder(this.env, event.token.slice(0, 200)) : undefined
      socket.serializeAttachment({ address: address ?? null })
      this.presence()
    }
    if (event.type === 'typing') {
      const address = attached(socket)
      if (address) this.broadcast({ address, type: 'typing' }, socket)
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
    const sockets = this.ctx.getWebSockets().filter((socket) => socket !== gone)
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
    if (outer.source === undefined) return outer.type === 'result' && event.request_id === turn

    const at = event.created_at ?? Date.now()
    if (outer.source === 'subagent' && outer.update) {
      const known = this.crew()
      const found = subagent(this.buffers, known, outer.root_session_id ?? this.kv.get<string>('agent') ?? 'session', outer.update)
      if (!found) return false
      this.kv.put('crew', known)
      for (const step of found.steps) this.log(step.kind, step.text, step.detail, { at, event: event.seq, who: found.who })
      return false
    }

    const inner = outer.event
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
        'INSERT INTO feed (at, round, kind, text, detail, who, event) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING seq',
        logged.at,
        this.kv.get<number>('n') ?? 0,
        logged.kind,
        logged.text,
        logged.detail,
        logged.who,
        logged.event,
      )
      .one()
    this.touch()
    if (!this.watchers.size) return
    const bytes = encoded({ entry: { ...logged, seq: Number(row.seq) }, type: 'entry' })
    for (const watcher of this.watchers) if (watcher.follow) this.write(watcher, bytes)
  }
}

type Failed = { busy?: boolean; failed: string; price?: bigint; room: Room | undefined; small?: boolean }

function pool(): Source {
  return { currency: Chain.tokens.ousd.address, id: 'pool', label: "the swarm's wallet", row: null }
}

function owing(payee: Address): Source {
  return { currency: Chain.tokens.ousd.address, id: 'hand:' + payee.toLowerCase(), label: `the swarm's wallet to hand owner ${short(payee)}`, row: null }
}

function owner(source: Source) {
  return source.id.startsWith('hand:') ? (source.id.slice('hand:'.length) as Address) : undefined
}

function held(key: Store.Allowance): Source {
  return { currency: Chain.mach, id: key.id, label: `${short(key.contributor ?? '')}'s ${key.period ? 'budget' : 'pledge'}`, row: key }
}

function sse(body: BodyInit) {
  return new Response(body, { headers: { 'cache-control': 'no-store', 'content-type': 'text/event-stream' } })
}

type Viewing = { buffers: Buffers; crew: Crew; ended?: () => void; scope: string; since: number; turn: string }

type Watcher = { follow: boolean; relaying: boolean; signal: AbortSignal; until: number; writer: WritableStreamDefaultWriter<Uint8Array> }

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
      touch()
      return deleted
    },
    get: (key) => kv.get(key),
    list: (options) => kv.list(options),
    put(key, value) {
      kv.put(key, value)
      touch()
    },
  }
}

function live(context: Viewing) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const send = (event: Live) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
  let buffer = ''
  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      controller.enqueue(send({ at: context.since, type: 'start' }))
    },
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true })
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
          continue
        }
        for (const translated of translate(JSON.parse(data) as Gateway.Event, context)) {
          controller.enqueue(send(translated))
          if (translated.type === 'end') {
            context.ended?.()
            controller.terminate()
            return
          }
        }
      }
    },
  })
}

function translate(event: Gateway.Event, context: Viewing): Live[] {
  const outer = event.event
  if (!outer) return []
  if (outer.source === undefined) return outer.type === 'result' && event.request_id === context.turn ? [{ type: 'end' }] : []

  const at = event.created_at ?? Date.now()
  const said = (who: string | null, found: { detail: string | null; kind: Kind; text: string }): Live => ({
    entry: { at, detail: found.detail ? redact(found.detail) : null, event: event.seq, kind: found.kind, seq: 0, text: redact(found.text), who },
    type: 'entry',
  })
  const stream = (who: string | null, type: string | undefined, payload: Record<string, unknown>): Live[] => {
    const text = typeof payload['text'] === 'string' ? redact(payload['text']) : ''
    const offset = typeof payload['offset'] === 'number' ? payload['offset'] : null
    if (type === 'assistant.delta') return [{ channel: 'text', delta: text, item: String(payload['item_id'] ?? ''), offset, type: 'delta', who }]
    if (type === 'reasoning.summary.delta') return [{ channel: 'thinking', delta: text, item: `reasoning:${String(payload['model_call_index'] ?? '')}`, offset: null, type: 'delta', who }]
    if (type === 'tool.input.delta') return [{ channel: 'input', delta: text, item: String(payload['call_id'] ?? ''), offset: null, type: 'delta', who }]
    return []
  }

  if (outer.source === 'subagent' && outer.update) {
    const found = subagent(context.buffers, context.crew, outer.root_session_id ?? context.scope, outer.update)
    if (!found) return []
    const update = outer.update as { event?: { payload?: Record<string, unknown>; type?: string }; type?: string }
    return [...(update.type === 'event' ? stream(found.who, update.event?.type, update.event?.payload ?? {}) : []), ...found.steps.map((step) => said(found.who, step))]
  }

  const payload = outer.event?.payload ?? {}
  return [...stream(null, outer.event?.type, payload), ...narrate(context.buffers, null, outer.event?.type, payload).map((found) => said(null, found))]
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

function costly(wanted: bigint) {
  return `Out of money for its next step: it needs about ${Answer.cash(Number(Memo.decimal(wanted)))} at once, more than any one backer's funds can pay. Adding money wakes it.`
}

function broke(left: bigint, wake: number | null) {
  return `Out of money: ${Answer.cash(Number(Memo.decimal(left)))} left, less than its next step needs. Adding money wakes it.${wake ? ` More comes in at ${clock(wake)} UTC.` : ''}`
}

const whys = ['unfunded', 'money', 'costly', 'rest', 'idle'] as const satisfies readonly Why[]

function known(why: string | undefined): Why {
  return (whys as readonly string[]).includes(why ?? '') ? (why as Why) : 'money'
}

function brief(row: Store.Row, notes: Note[]) {
  return [row.title, row.goal, ...notes.map((note) => note.note)].filter(Boolean).join('\n\n')
}

function next(notes: Note[]) {
  return ['Keep going.', ...notes.map((note) => note.note)].join('\n\n')
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

function per(period: number) {
  return period === 2_592_000 ? 'a month' : period === 86_400 ? 'a day' : period % 3600 === 0 ? `every ${period / 3600} h` : `every ${period} s`
}

function percent(share: number) {
  return `${Math.round(share * 1000) / 10}%`
}
