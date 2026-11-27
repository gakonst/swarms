import { plans as named, type Plan, type Said } from '../shared/Api.ts'
import * as Shared from '../shared/Drive.ts'
import type { Board, Halt, Item, ItemState, Origin } from '../shared/Drive.ts'
import { redact } from '../shared/Trail.ts'
import * as Chat from './Chat.ts'
import * as Gateway from './Gateway.ts'
import * as Key from './machines/Key.ts'
import * as Machine from './machines/Drive.ts'
import type * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'
import * as Limits from '../shared/Limits.ts'

export const schema = [
  'CREATE TABLE IF NOT EXISTS board_items (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, source TEXT NOT NULL, state TEXT NOT NULL, message INTEGER, turn INTEGER, why TEXT, attempts INTEGER NOT NULL DEFAULT 0, ended_at INTEGER)',
]

export const indexes = [
  'CREATE INDEX IF NOT EXISTS board_items_state ON board_items (state, id)',
  'CREATE INDEX IF NOT EXISTS board_items_key ON board_items (key)',
  "CREATE UNIQUE INDEX IF NOT EXISTS chat_board ON chat (node) WHERE node = 'board' AND parent IS NULL",
]

export const opening =
  'Board: the goal, the plan and the backlog. The lead posts the next items here and works them without waiting for anyone. Reply in this thread to add an item or steer: your items go first.'

export type Order = { halt: Halt } | { items: Item[]; text: string }

const columns = 'SELECT id, at, title, source, state, message, turn, why, attempts FROM board_items'

type Row = {
  at: number
  attempts: number
  id: number
  message: number | null
  source: string
  state: string
  title: string
  turn: number | null
  why: string | null
}

function item(row: Row): Item & { attempts: number } {
  return {
    at: Number(row.at),
    attempts: Number(row.attempts),
    id: Number(row.id),
    message: row.message === null ? null : Number(row.message),
    source: row.source === 'human' ? 'human' : 'lead',
    state: Shared.itemStates.find((state) => state === row.state) ?? 'dead',
    title: String(row.title),
    turn: row.turn === null ? null : Number(row.turn),
    why: row.why === null ? null : String(row.why),
  }
}

function store(self: Swarm): Machine.Store {
  return { get: () => self.kv.get<unknown>('board'), put: (board) => self.kv.put('board', board) }
}

export function counts(self: Swarm): Record<ItemState, number> {
  const out: Record<ItemState, number> = { dead: 0, done: 0, flying: 0, open: 0 }
  for (const row of self.ctx.storage.sql.exec<{ n: number; state: string }>('SELECT state, COUNT(*) AS n FROM board_items GROUP BY state')) {
    const state = Shared.itemStates.find((one) => one === row.state)
    if (state) out[state] = Number(row.n)
  }
  return out
}

function live(self: Swarm): Machine.Counts {
  const found = counts(self)
  return { flying: found.flying, open: found.open }
}

export function lifecycle(self: Swarm): Machine.Lifecycle {
  return Machine.read(store(self), live(self))
}

export function items(self: Swarm, limit: number = Limits.Drive.shownItems) {
  return self.ctx.storage.sql
    .exec<Row>(
      `${columns} ORDER BY CASE state WHEN 'flying' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, CASE WHEN state IN ('open', 'flying') AND source = 'lead' THEN 1 ELSE 0 END, CASE WHEN state IN ('open', 'flying') THEN id ELSE -id END LIMIT ?`,
      limit,
    )
    .toArray()
    .map(item)
}

function where(self: Swarm, clause: string, ...values: SqlStorageValue[]) {
  return self.ctx.storage.sql
    .exec<Row>(`${columns} WHERE ${clause}`, ...values)
    .toArray()
    .map(item)
}

export function ensure(self: Swarm): Machine.Stored | undefined {
  if (self.kv.get<string>('form') === 'tree') return undefined
  const found = lifecycle(self)
  if (found.state !== 'unboarded') return found.board
  const existing = self.ctx.storage.sql
    .exec<{ id: number }>('SELECT id FROM chat WHERE node = ? AND parent IS NULL ORDER BY id LIMIT 1', Shared.node)
    .toArray()[0]
  const root = existing ? Number(existing.id) : Chat.speak(self, null, opening, [], null, null, { node: Shared.node }).id
  const now = live(self)
  return Machine.write(store(self), now, Machine.fresh(root), now, 0)
}

export function post(self: Swarm, text: string) {
  const found = lifecycle(self)
  if (found.state === 'unboarded') return null
  return Chat.speak(self, null, redact(text), [], null, null, { parent: found.board.root }).id
}

function insert(self: Swarm, input: { message: number | null; source: Origin; title: string }) {
  return self.ctx.storage.sql
    .exec<{ id: number }>(
      "INSERT INTO board_items (at, key, title, source, state, message) VALUES (?, ?, ?, ?, 'open', ?) RETURNING id",
      Date.now(),
      Machine.key(input.title),
      input.title,
      input.source,
      input.message,
    )
    .one().id
}

export function human(self: Swarm, said: Said): number | undefined {
  if (!said.author || said.parent === undefined) return undefined
  const found = lifecycle(self)
  if (found.state === 'unboarded' || said.parent !== found.board.root) return undefined
  const named = Machine.title(said.text)
  if (!named) return undefined
  const before = live(self)
  const taken =
    self.ctx.storage.sql.exec("SELECT 1 FROM board_items WHERE key = ? AND state IN ('open', 'flying') LIMIT 1", Machine.key(named)).toArray().length > 0
  if (Machine.guards.dedupe && taken) return undefined
  const id = insert(self, { message: said.id, source: 'human', title: named })
  const lifted = found.board.halt !== null && Machine.wakes(found.board.halt, 'note')
  Machine.write(store(self), before, { ...Machine.fields(found.board), ...(lifted ? { halt: null, misses: 0 } : {}) }, live(self), Machine.rev(found))
  return id
}

function made(self: Swarm) {
  return self.ctx.storage.sql
    .exec<{ at: number }>("SELECT at FROM board_items WHERE source = 'lead' AND at > ?", Date.now() - Limits.Drive.hourMs)
    .toArray()
    .map((row) => Number(row.at))
}

export function order(self: Swarm, input: { choice: Machine.Choice; n: number; now: number }): Order {
  if (!ensure(self)) return { items: [], text: '' }
  const found = lifecycle(self)
  if (found.state === 'unboarded') return { items: [], text: '' }
  if ('halt' in input.choice) return { halt: input.choice.halt }
  let fields = Machine.fields(found.board)
  const held = fields.halt
  if (held?.why === 'limited' && input.now < held.until && input.choice.source === 'plan') return { halt: held }
  if (fields.cap !== null && fields.turns >= fields.cap && fields.counted < input.n) return { halt: { cap: fields.cap, turns: fields.turns, why: 'capped' } }
  fields = { ...fields, halt: null }
  const before = live(self)
  const sql = self.ctx.storage.sql
  if (!where(self, "state = 'flying' AND turn = ?", input.n).length) {
    sql.exec("UPDATE board_items SET state = 'open', turn = NULL WHERE state = 'flying' AND turn != ?", input.n)
    const ids = Machine.pick(where(self, "state IN ('open', 'flying')"))
    for (const id of ids) sql.exec("UPDATE board_items SET state = 'flying', turn = ? WHERE id = ? AND state = 'open'", input.n, id)
  }
  const taken = where(self, "state = 'flying' AND turn = ? ORDER BY CASE source WHEN 'human' THEN 0 ELSE 1 END, id", input.n)
  const room = Machine.room(made(self), input.now)
  const planning = !taken.length && (fields.planned === input.n || room > 0)
  const plan = input.choice.source === 'plan' ? input.choice.plan : null
  if (input.choice.source === 'credit' && input.choice.lost && fields.source === 'plan')
    post(
      self,
      `The creator's ${Shared.planName(input.choice.lost)} plan is signed out, so the swarm runs on its riders' credit now. Reconnect the plan on /me/ai to move it back.`,
    )
  Machine.write(
    store(self),
    before,
    {
      ...fields,
      counted: Math.max(fields.counted, input.n),
      plan,
      planned: planning ? input.n : fields.planned,
      source: input.choice.source,
      turns: fields.counted < input.n ? fields.turns + 1 : fields.turns,
    },
    live(self),
    Machine.rev(found),
  )
  if (taken.length) return { items: taken, text: Machine.dispatched(taken) }
  if (!planning) return { items: [], text: '' }
  const results = where(self, "state = 'done' ORDER BY id DESC LIMIT ?", Limits.Drive.contextItems)
  const ends = where(self, "state = 'dead' ORDER BY id DESC LIMIT ?", Limits.Drive.contextItems)
  return { items: [], text: Machine.planning(Math.max(1, room), results, ends) }
}

export function ended(
  self: Swarm,
  input: { creator: string | null; message: string | null; n: number; now: number; status: 'cancelled' | 'completed' | 'failed'; text: string },
): Halt | null {
  const found = lifecycle(self)
  if (found.state === 'unboarded') return null
  if (found.board.settled >= input.n) return null
  const before = live(self)
  const sql = self.ctx.storage.sql
  const mine = where(self, "state = 'flying' AND turn = ? ORDER BY CASE source WHEN 'human' THEN 0 ELSE 1 END, id", input.n)
  let fields = { ...Machine.fields(found.board), settled: input.n }
  let halt: Halt | null = null
  if (input.status !== 'completed') {
    sql.exec("UPDATE board_items SET state = 'open', turn = NULL WHERE state = 'flying' AND turn = ?", input.n)
    const plan = fields.source === 'plan' ? fields.plan : null
    if (plan && Machine.limited(input.message)) {
      fields = { ...fields, limits: fields.limits + 1 }
      halt = Machine.limit(input.message ?? '', input.now, fields.limits, plan)
    } else if (plan && Machine.revoked(input.message)) halt = { plan, why: 'revoked' }
  } else {
    let misses = fields.misses
    const said = Machine.outcomes(input.text)
    for (const one of mine) {
      const told = said.get(one.id)
      if (told?.done) {
        sql.exec("UPDATE board_items SET state = 'done', why = ?, ended_at = ? WHERE id = ?", told.why || null, input.now, one.id)
        misses = 0
        continue
      }
      misses += 1
      if (told || one.attempts + 1 >= Limits.Drive.attemptsMost)
        sql.exec(
          "UPDATE board_items SET state = 'dead', why = ?, attempts = attempts + 1, ended_at = ? WHERE id = ?",
          told?.why || 'No turn reported progress on it.',
          input.now,
          one.id,
        )
      else sql.exec("UPDATE board_items SET state = 'open', turn = NULL, attempts = attempts + 1 WHERE id = ?", one.id)
    }
    if (fields.planned === input.n && !mine.length) {
      const known = new Set(
        self.ctx.storage.sql
          .exec<{ key: string }>('SELECT key FROM board_items')
          .toArray()
          .map((row) => String(row.key)),
      )
      const fresh = Machine.unseen(Machine.proposals(input.text), known).slice(0, Machine.room(made(self), input.now))
      for (const one of fresh) insert(self, { message: post(self, 'Next: ' + one), source: 'lead', title: one })
      misses = fresh.length ? misses : misses + 1
    }
    fields = { ...fields, limits: 0, misses }
    if (Machine.met(input.text)) halt = { why: 'met' }
    else if (Machine.guards.stuck && misses >= Limits.Drive.stuckAfter) {
      const missed = where(self, "attempts > 0 OR state = 'dead' ORDER BY COALESCE(ended_at, at) DESC LIMIT ?", Limits.Drive.missesShown).reverse()
      halt = { misses, question: Machine.question(missed, input.creator), why: 'stuck' }
    }
  }
  Machine.write(store(self), before, fields, live(self), Machine.rev(found))
  return halt
}

export function planned(self: Swarm) {
  const found = lifecycle(self)
  return found.state !== 'unboarded' && found.board.source === 'plan'
}

export function refused(self: Swarm, input: { detail: string; now: number; status: number }): Halt | null {
  const found = lifecycle(self)
  if (found.state === 'unboarded' || found.board.source !== 'plan' || !found.board.plan) return null
  const plan = found.board.plan
  if (input.status === Limits.Http.tooMany || Machine.limited(input.detail)) {
    const fields = { ...Machine.fields(found.board), limits: found.board.limits + 1 }
    const now = live(self)
    Machine.write(store(self), now, fields, now, Machine.rev(found))
    return Machine.limit(input.detail, input.now, fields.limits, plan)
  }
  const signedOut = input.status === Limits.Http.unauthorized || input.status === Limits.Http.forbidden || Machine.revoked(input.detail)
  return signedOut ? { plan, why: 'revoked' } : null
}

export function halted(self: Swarm, halt: Halt) {
  const found = lifecycle(self)
  if (found.state === 'unboarded') return
  if (JSON.stringify(found.board.halt) === JSON.stringify(halt)) return
  const now = live(self)
  Machine.write(store(self), now, { ...Machine.fields(found.board), halt }, now, Machine.rev(found))
  post(self, Shared.reason(halt))
}

export function resume(self: Swarm, why: 'credit' | 'plan' | 'reset') {
  const found = lifecycle(self)
  if (found.state !== 'paused') return false
  const now = live(self)
  Machine.write(
    store(self),
    now,
    { ...Machine.fields(found.board), halt: null, ...(why === 'credit' ? { plan: null, source: 'credit' } : {}) },
    now,
    Machine.rev(found),
  )
  post(
    self,
    why === 'reset'
      ? "The plan's rate limit reset, so the swarm is back at work."
      : why === 'plan'
        ? 'The plan is connected again, so the swarm is back at work on it.'
        : "The swarm runs on its riders' credit now.",
  )
  return true
}

export function noted(self: Swarm, text: string) {
  if (self.kv.get<string>('board:noted') === text) return
  self.kv.put('board:noted', text)
  post(self, text)
}

export function command(text: string): number | null | undefined {
  const found = /^\s*\/cap\s+(\d+|off)\s*$/i.exec(text)
  if (!found?.[1]) return undefined
  if (found[1].toLowerCase() === 'off') return null
  const cap = Number(found[1])
  return cap <= Limits.Drive.capMost ? cap : undefined
}

export function capped(self: Swarm, cap: number | null) {
  const found = lifecycle(self)
  if (found.state === 'unboarded') return false
  const now = live(self)
  const lifted = found.board.halt?.why === 'capped' && (cap === null || cap > found.board.turns)
  Machine.write(store(self), now, { ...Machine.fields(found.board), cap, ...(lifted ? { halt: null } : {}) }, now, Machine.rev(found))
  post(self, cap === null ? 'The creator removed the turn cap.' : `The creator set a cap of ${cap} turns; the swarm has run ${found.board.turns}.`)
  return lifted
}

export function view(self: Swarm): Board | null {
  const found = lifecycle(self)
  if (found.state === 'unboarded') return null
  const board = found.board
  return {
    cap: board.cap,
    counts: counts(self),
    halt: board.halt,
    items: items(self).map(({ attempts: _attempts, ...shown }) => shown),
    plan: board.plan,
    root: board.root,
    source: board.source,
    state: found.state,
    turns: board.turns,
  }
}

type Kept = { at: number; signed: Plan[] }

export async function plans(self: Swarm, row: Pick<Store.Row, 'creator'>, fresh = false): Promise<Machine.Plans | undefined> {
  if (!row.creator) return undefined
  const kept = self.kv.get<Kept>('board:plans')
  if (!fresh && kept && Date.now() - kept.at < Limits.Drive.planReadMs) return { known: true, signed: new Set(kept.signed) }
  const own = await Gateway.ai(self.env, row.creator)
  if (!own.ok) return { known: false, signed: new Set() }
  const access = Key.access(own.value)
  const signed = named.filter((plan) => access.plans.get(plan)?.at === 'signed-in')
  self.kv.put('board:plans', { at: Date.now(), signed } satisfies Kept)
  return { known: true, signed: new Set(signed) }
}
