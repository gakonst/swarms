import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import type { Plan } from '../../src/shared/Api.ts'
import type * as SharedDrive from '../../src/shared/Drive.ts'
import type * as DriveModule from '../../src/worker/Drive.ts'
import * as Machine from '../../src/worker/machines/Drive.ts'
import * as Limits from '../../src/shared/Limits.ts'
import { applied, limits as kit, load, mutant, pin, recorder, rng, type Canary, type Outcome, type Rng } from './mh-kit.ts'

type Halt = SharedDrive.Halt

const limits = {
  backfillMessages: 6,
  dayMs: 24 * 60 * 60_000,
  dupeChance: 0.3,
  emptyChance: 0.05,
  ensureTries: 5,
  failChance: 0.05,
  flowHoursPerDone: 2,
  humanChance: 0.25,
  humansMost: 24,
  limitChance: 0.05,
  missChance: 0.3,
  probeEvery: 7,
  proposeMost: 4,
  quietMs: 60_000,
  refuseChance: 0.03,
  resetMostMs: 3 * 60 * 60_000,
  resetLeastMs: 10 * 60_000,
  retryLeastS: 60,
  retryMostS: 7200,
  revokeFromMs: 4 * 60 * 60_000,
  revokeLeastMs: 60 * 60_000,
  revokeMostMs: 4 * 60 * 60_000,
  revokeToMs: 16 * 60 * 60_000,
  steerCap: 30,
  steerRaise: 12,
  stuckTurnsMost: 40,
  turnLeastMs: 2 * 60_000,
  turnMostMs: 15 * 60_000,
}

const topics = ['tokenizer', 'kernel', 'cache', 'parser', 'scheduler', 'allocator', 'benchmark', 'index', 'compiler', 'planner', 'decoder', 'sampler']

const verbs = ['Measure', 'Profile', 'Rewrite', 'Bench', 'Port', 'Trace']

const named = {
  board: 'one Board thread',
  cap: 'spend stays within the plan or cap',
  dedupe: 'no generated item repeats an item or a dead end',
  fence: 'a stale Board write is refused',
  flight: Machine.flying,
  flow: 'items keep flowing',
  hourly: 'generated items stay within Drive.generatedPerHour an hour',
  legal: 'an illegal Board transition is refused',
  limit: 'a rate limit pauses and resumes at its reset',
  post: 'every pause posts its reason in the Board thread',
  priority: 'human items go first',
  revoke: 'a revoke pauses and resumes',
  stuck: 'stops after Drive.stuckAfter items without progress',
}

function hooked() {
  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'cloudflare:workers'
        ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}; export class WorkerEntrypoint {}' }
        : next(specifier, context),
  })
}

type Cursor = { one: () => Record<string, unknown>; toArray: () => Record<string, unknown>[]; [Symbol.iterator]: () => Iterator<Record<string, unknown>> }

function host(Drive: typeof DriveModule) {
  const db = new DatabaseSync(':memory:')
  db.exec(
    "CREATE TABLE chat (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, author TEXT, text TEXT NOT NULL, mentions TEXT NOT NULL DEFAULT '[]', steer TEXT, artifact TEXT, parent INTEGER, node TEXT)",
  )
  for (const statement of [...Drive.schema, ...Drive.indexes]) db.exec(statement)
  const kept = new Map<string, unknown>()
  const sql = {
    exec: (query: string, ...values: unknown[]): Cursor => {
      const rows = db.prepare(query).all(...(values as never[])) as Record<string, unknown>[]
      return {
        one: () => {
          if (rows.length !== 1) throw new Error('one() read ' + rows.length + ' rows: ' + query)
          return rows[0] as Record<string, unknown>
        },
        toArray: () => rows,
        [Symbol.iterator]: () => rows[Symbol.iterator](),
      }
    },
  }
  const kv = {
    delete: (key: string) => kept.delete(key),
    get: (key: string) => (kept.has(key) ? structuredClone(kept.get(key)) : undefined),
    put: (key: string, value: unknown) => void kept.set(key, structuredClone(value)),
  }
  const self = { ctx: { getWebSockets: () => [], storage: { kv, sql } }, env: {}, kv, touch: () => undefined }
  return { db, kept, self: self as never, sql }
}

type World = ReturnType<typeof host>

function roots(world: World) {
  return Number(world.sql.exec("SELECT COUNT(*) AS n FROM chat WHERE node = 'board' AND parent IS NULL").one()['n'])
}

function replies(world: World, root: number) {
  return world.sql.exec('SELECT id, author, text FROM chat WHERE parent = ? ORDER BY id', root).toArray()
}

function rows(world: World) {
  return world.sql.exec('SELECT id, at, key, title, source, state, turn, attempts FROM board_items ORDER BY id').toArray() as {
    at: number
    attempts: number
    id: number
    key: string
    source: string
    state: string
    title: string
    turn: number | null
  }[]
}

function expected(message: string, now: number, tries: number) {
  const after = /retry-after: (\d+)/.exec(message)
  const stamp = /resets_at: (\d+)/.exec(message)
  const iso = /resets at (\S+Z)/.exec(message)
  const at = after
    ? now + Number(after[1]) * 1000
    : stamp
      ? Number(stamp[1]) < Limits.Drive.resetSecondsBelow
        ? Number(stamp[1]) * 1000
        : Number(stamp[1])
      : iso
        ? Date.parse(iso[1] as string)
        : now + Machine.backoff(tries)
  return Math.max(now, Math.min(at, now + Limits.Drive.limitMostMs))
}

function limitMessage(random: Rng, now: number) {
  const ahead = random.int(limits.resetLeastMs, limits.resetMostMs)
  switch (random.int(0, 4)) {
    case 0:
      return (
        'Messages HTTP 429: {"error":{"type":"rate_limit_error","message":"Rate limited"}} retry-after: ' + random.int(limits.retryLeastS, limits.retryMostS)
      )
    case 1:
      return 'Messages HTTP 429: usage limit reached, resets_at: ' + Math.floor((now + ahead) / 1000)
    case 2:
      return 'Messages HTTP 429: usage limit reached, resets_at: ' + (now + ahead)
    case 3:
      return 'Messages HTTP 429: plan usage limit, resets at ' + new Date(now + ahead).toISOString()
    default:
      return 'Messages HTTP 429: Too Many Requests'
  }
}

function freshTitle(random: Rng, counter: number) {
  return random.pick(verbs) + ' the ' + random.pick(topics) + ' variant ' + counter
}

function rephrase(random: Rng, title: string) {
  const words = title.split(' ')
  return random.chance(0.5) ? title.toUpperCase() + '.' : [...words].reverse().join('  ') + '!'
}

type Run = {
  creditSpent: number
  done: number
  halts: Halt[]
  pausedMs: number
  turns: number
}

async function drive(seed: string, mode: 'day' | 'stuck' | 'steer'): Promise<Outcome> {
  const random = rng('drive', mode, seed)
  const { fail, violations } = recorder()
  hooked()
  const restore = pin(random, kit.start)
  let now = kit.start
  Date.now = () => now
  let steps = 0
  try {
    const Drive = await load<typeof DriveModule>('src/worker/Drive.ts')
    const Shared = await load<typeof SharedDrive>('src/shared/Drive.ts')
    const M = await load<typeof Machine>('src/worker/machines/Drive.ts')
    applied()
    const world = host(Drive)
    const self = world.self
    const sql = world.sql
    for (let k = 0; k < limits.backfillMessages; k++) sql.exec('INSERT INTO chat (at, author, text) VALUES (?, ?, ?)', now, '0xabc', 'earlier ' + k)
    try {
      for (let k = 0; k < limits.ensureTries; k++) Drive.ensure(self)
      world.kept.delete('board')
      Drive.ensure(self)
      Drive.ensure(self)
    } catch (error) {
      fail(named.board, 'ensure threw: ' + String((error as Error).message).slice(0, 200))
    }
    if (roots(world) !== 1) fail(named.board, roots(world) + ' Board roots after backfill')
    const first = Drive.lifecycle(self)
    if (first.state === 'unboarded') {
      fail(named.board, 'no Board after ensure')
      return { steps, violations }
    }
    const root = first.board.root
    const signed = new Set<Plan>(['claude'])
    const revokeAt = now + random.int(limits.revokeFromMs, limits.revokeToMs)
    const reconnectAt = revokeAt + random.int(limits.revokeLeastMs, limits.revokeMostMs)
    const end = now + limits.dayMs
    const run: Run = { creditSpent: 0, done: 0, halts: [], pausedMs: 0, turns: 0 }
    const held: { paused: Halt | null } = { paused: null }
    let pausedAt = 0
    let streak = 0
    let counter = 0
    let humans = 0
    let cap: number | null = null
    let revokeSeen = false
    let exposed = false
    let resumedAfterRevoke = false
    const plans = (): Machine.Plans => {
      if (mode === 'day' && now >= revokeAt && now < reconnectAt) return { known: true, signed: new Set() }
      return { known: true, signed: new Set(signed) }
    }
    const halt = (found: Halt) => {
      Drive.halted(self, found)
      held.paused = found
      pausedAt = now
      run.halts.push(found)
      if (found.why === 'revoked') revokeSeen = true
      const last = replies(world, root).at(-1)
      if (String(last?.['text'] ?? '') !== Shared.reason(found)) fail(named.post, found.why + ' posted ' + JSON.stringify(last?.['text'] ?? null).slice(0, 160))
      const life = Drive.lifecycle(self)
      if (life.state !== 'paused') fail(named.post, 'halted ' + found.why + ' but the Board reads ' + life.state)
    }
    const probe = () => {
      const life = Drive.lifecycle(self)
      if (life.state === 'unboarded') return
      const counts = { flying: 0, open: 0 }
      let stale = false
      try {
        Machine.write(
          { get: () => world.kept.get('board'), put: (board) => void world.kept.set('board', structuredClone(board)) },
          counts,
          Machine.fields(life.board),
          counts,
          Machine.rev(life) - 1,
        )
      } catch (error) {
        stale = error instanceof Error && /Stale/.test(error.message)
      }
      if (!stale) fail(named.fence, 'a write at rev ' + (Machine.rev(life) - 1) + ' was taken over rev ' + Machine.rev(life))
      const scratch = new Map<string, unknown>()
      let illegal = false
      try {
        Machine.write(
          { get: () => scratch.get('board'), put: (board) => void scratch.set('board', board) },
          counts,
          { ...Machine.fresh(root), halt: { why: 'met' } },
          counts,
          0,
        )
      } catch (error) {
        illegal = error instanceof Error && /Illegal/.test(error.message)
      }
      if (!illegal) fail(named.legal, 'a new Board went straight to paused')
    }
    const ended = new Set<number>()
    let n = 1
    const stopAt = mode === 'day' ? end : now + limits.stuckTurnsMost * limits.turnMostMs * 2
    while (now < stopAt) {
      steps += 1
      if (steps % limits.probeEvery === 0) probe()
      if (mode === 'steer' && humans < limits.humansMost && random.chance(limits.humanChance)) {
        humans += 1
        const text = random.chance(0.2) && cap === null ? '/cap ' + (run.turns + limits.steerCap) : 'Please ' + freshTitle(random, ++counter).toLowerCase()
        const said = {
          at: now,
          author: '0x00000000000000000000000000000000000000aa' as const,
          id: 0,
          artifact: null,
          mentions: [],
          parent: root,
          steer: null,
          text,
        }
        const cmd = Drive.command(text)
        if (cmd !== undefined) {
          cap = cmd
          Drive.capped(self, cmd)
        } else {
          const id = sql.exec('INSERT INTO chat (at, author, text, parent) VALUES (?, ?, ?, ?) RETURNING id', now, said.author, text, root).one()['id']
          Drive.human(self, { ...said, id: Number(id) })
          if (held.paused && M.wakes(held.paused, 'note')) held.paused = null
        }
      }
      if (held.paused) {
        const due = M.due(held.paused, now)
        if (due === null) {
          if (mode === 'steer' && held.paused.why === 'capped' && cap !== null) {
            cap += limits.steerRaise
            if (Drive.capped(self, cap)) held.paused = null
            continue
          }
          if (mode === 'stuck' && held.paused.why === 'stuck') break
          if (mode === 'steer' && held.paused.why === 'stuck') {
            const text = 'Try a smaller ' + random.pick(topics) + ' first ' + ++counter
            const id = sql
              .exec(
                'INSERT INTO chat (at, author, text, parent) VALUES (?, ?, ?, ?) RETURNING id',
                now,
                '0x00000000000000000000000000000000000000aa',
                text,
                root,
              )
              .one()['id']
            const added = Drive.human(self, {
              at: now,
              author: '0x00000000000000000000000000000000000000aa',
              id: Number(id),
              artifact: null,
              mentions: [],
              parent: root,
              steer: null,
              text,
            })
            if (added === undefined || Drive.lifecycle(self).state === 'paused') fail(named.stuck, 'the creator answered but the swarm stayed stuck')
            held.paused = null
            continue
          }
          if (mode === 'steer' && held.paused.why === 'met') break
          fail(named.flow, 'paused on ' + held.paused.why + ' with nothing that resumes it, ' + Math.round((end - now) / 60_000) + ' minutes before the end')
          break
        }
        const wake = Math.max(now, due)
        run.pausedMs += wake - now
        now = wake
        const resumed = M.resumes(held.paused, { funded: false, now, plans: plans() })
        if (!resumed) continue
        if (held.paused.why === 'limited' && now < held.paused.until) fail(named.limit, 'resumed ' + (held.paused.until - now) + ' ms before its reset')
        if (held.paused.why === 'revoked') resumedAfterRevoke = true
        if (held.paused.why === 'revoked' && now - Math.max(reconnectAt, pausedAt) > Limits.Drive.revokedReadMs)
          fail(named.revoke, 'resumed ' + (now - reconnectAt) + ' ms after the plan came back')
        Drive.resume(self, resumed)
        held.paused = null
        continue
      }
      const life = Drive.lifecycle(self)
      if (life.state === 'unboarded') break
      if (now >= revokeAt && now < reconnectAt) exposed = true
      const choice = M.choose({ funded: false, harness: 'claude', hosted: false, last: life.board.source, plans: plans() })
      if ('halt' in choice) {
        revokeSeen = true
        if (mode === 'day' && !(now >= revokeAt && now < reconnectAt)) fail(named.revoke, 'paused on a revoke while the plan was signed in')
        halt(choice.halt)
        continue
      }
      if (mode === 'day' && now >= revokeAt && now < reconnectAt)
        fail(named.revoke, 'a turn started at ' + (now - revokeAt) + ' ms into the revoke, on ' + choice.source)
      const before = rows(world)
      const order = Drive.order(self, { choice, n, now })
      if ('halt' in order) {
        if (order.halt.why === 'capped' && cap !== null && run.turns < cap) fail(named.cap, 'capped at ' + run.turns + ' turns under a cap of ' + cap)
        halt(order.halt)
        continue
      }
      const after = rows(world)
      const flying = after.filter((one) => one.state === 'flying')
      if (flying.length > Limits.Drive.inFlightMost) fail(named.flight, flying.length + ' items in flight')
      const openHumans = before.filter((one) => one.state === 'open' && one.source === 'human').map((one) => one.id)
      const reused = before.some((one) => one.state === 'flying' && one.turn === n)
      const tookLead = !reused && order.items.some((one) => one.source === 'lead')
      const left = openHumans.filter((id) => !order.items.some((one) => one.id === id))
      if (tookLead && left.length) fail(named.priority, 'took a lead item while rider items ' + left.join(',') + ' waited')
      const openBefore = before.filter((one) => one.state === 'open' || one.state === 'flying').length
      const recent = after.filter((one) => one.source === 'lead' && one.at > now - Limits.Drive.hourMs).length
      const planningTurn = !order.items.length && order.text.includes('Next items')
      if (mode === 'day' && openBefore === 0 && recent < Limits.Drive.generatedPerHour && !planningTurn)
        fail(named.flow, 'turn ' + n + ' had an empty board and room to plan, but did not plan')
      if (cap !== null && run.turns + 1 > cap && !ended.has(n)) fail(named.cap, 'turn ' + n + ' ran past the cap of ' + cap)
      if (choice.source === 'credit') run.creditSpent += 1
      if (random.chance(limits.refuseChance) && choice.source === 'plan') {
        const message = limitMessage(random, now)
        const tries = life.board.limits + 1
        const found = Drive.refused(self, { detail: message, now, status: Limits.Http.tooMany })
        if (!found || found.why !== 'limited') fail(named.limit, 'a refused 429 prompt did not pause on the limit')
        else {
          if (found.until !== expected(message, now, tries))
            fail(named.limit, 'until ' + found.until + ', want ' + expected(message, now, tries) + ' for ' + message)
          halt(found)
        }
        continue
      }
      const turnMs = random.int(limits.turnLeastMs, limits.turnMostMs)
      now += turnMs
      run.turns += 1
      ended.add(n)
      let status: 'completed' | 'failed' = 'completed'
      let message: string | null = null
      let text = ''
      const limitedNow = mode === 'day' && random.chance(limits.limitChance)
      const revokedNow = mode === 'day' && now >= revokeAt && now - turnMs < revokeAt
      if (revokedNow) {
        exposed = true
        status = 'failed'
        message = 'Messages HTTP 401: {"error":{"message":"OAuth token revoked"}}'
      } else if (limitedNow) {
        status = 'failed'
        message = limitMessage(random, now)
      } else if (random.chance(limits.failChance)) {
        status = 'failed'
        message = 'vercel failed upstream'
      } else if (order.items.length) {
        const lines: string[] = []
        for (const one of order.items) {
          const forced = mode === 'day' && streak >= Limits.Drive.stuckAfter - 2
          if (mode !== 'stuck' && (forced || !random.chance(limits.missChance))) {
            lines.push('Done: #' + one.id)
            streak = 0
            run.done += 1
          } else {
            streak += 1
            if (random.chance(0.5)) lines.push('Dead end: #' + one.id + ' it did not hold')
          }
        }
        text = 'Worked the board.\n' + lines.join('\n')
      } else if (planningTurn) {
        const all = rows(world)
        const pressed = mode === 'day' && streak >= Limits.Drive.stuckAfter - 2
        const count = !pressed && random.chance(limits.emptyChance) ? 0 : random.int(1, limits.proposeMost)
        const proposed: string[] = []
        for (let k = 0; k < count; k++) {
          const old = all.length && !pressed && random.chance(limits.dupeChance) ? random.pick(all) : undefined
          proposed.push(old ? rephrase(random, old.title) : freshTitle(random, ++counter))
        }
        const fresh = new Set(proposed.filter((one) => !all.some((old) => Machine.key(old.title) === Machine.key(one))).map((one) => Machine.key(one)))
        if (!fresh.size) streak += 1
        text = 'Planned.\n\nNext items:\n' + proposed.map((one) => '- ' + one).join('\n')
      } else text = 'Kept going.'
      if (mode === 'steer' && now > end - limits.dayMs / 2 && random.chance(0.1)) text += '\nGoal met'
      const tries = Drive.lifecycle(self).state === 'unboarded' ? 0 : (Drive.lifecycle(self) as { board: Machine.Stored }).board.limits + 1
      const found = Drive.ended(self, { creator: '@creator', message, n, now, status, text })
      if (Drive.ended(self, { creator: '@creator', message, n, now, status, text }) !== null) fail(named.stuck, 'turn ' + n + ' settled twice')
      n += 1
      const all = rows(world)
      const leads = all.filter((one) => one.source === 'lead')
      for (const one of leads) {
        const window = leads.filter((other) => other.at > one.at - Limits.Drive.hourMs && other.at <= one.at).length
        if (window > Limits.Drive.generatedPerHour) fail(named.hourly, window + ' items generated in the hour before ' + one.at)
      }
      const keys = new Map<string, number>()
      for (const one of all) {
        const prior = keys.get(one.key)
        if (prior !== undefined && one.source === 'lead') fail(named.dedupe, '#' + one.id + ' repeats #' + prior + ' (' + one.key + ')')
        if (prior === undefined) keys.set(one.key, one.id)
      }
      if (limitedNow && !revokedNow && message) {
        if (!found || found.why !== 'limited') fail(named.limit, 'a 429 turn did not pause on the limit: ' + JSON.stringify(found))
        else if (found.until !== expected(message, now, tries))
          fail(named.limit, 'until ' + found.until + ', want ' + expected(message, now, tries) + ' for ' + message)
      }
      if (revokedNow && (!found || found.why !== 'revoked')) fail(named.revoke, 'a revoked turn did not pause: ' + JSON.stringify(found))
      const misses = Drive.lifecycle(self)
      const counted = misses.state === 'unboarded' ? 0 : misses.board.misses
      if (counted >= Limits.Drive.stuckAfter && found?.why !== 'stuck' && found?.why !== 'met')
        fail(named.stuck, counted + ' items without progress and no stuck pause')
      if (found?.why === 'stuck' && !/Stuck, here's why/.test(found.question)) fail(named.stuck, 'the stuck pause asks no question')
      if (found) halt(found)
      now += limits.quietMs
    }
    if (mode === 'day') {
      if (run.creditSpent > 0) fail(named.cap, run.creditSpent + ' turns ran on credit with no credit')
      const awake = (now - kit.start - run.pausedMs) / (60 * 60_000)
      if (run.done < Math.floor(awake / limits.flowHoursPerDone)) fail(named.flow, run.done + ' items done in ' + awake.toFixed(1) + ' working hours')
      if (exposed && !revokeSeen) fail(named.revoke, 'the plan was revoked but the swarm never paused')
      else if (revokeSeen && !resumedAfterRevoke) fail(named.revoke, 'the swarm never resumed after the plan came back')
    }
    if (mode === 'stuck') {
      const last = run.halts.at(-1)
      if (last?.why !== 'stuck') fail(named.stuck, 'a lead with no progress ran ' + run.turns + ' turns and never stopped')
      else {
        const said = {
          at: now,
          author: '0x00000000000000000000000000000000000000aa' as const,
          id: 0,
          artifact: null,
          mentions: [],
          parent: root,
          steer: null,
          text: 'Try the smaller kernel first',
        }
        const id = Number(
          sql.exec('INSERT INTO chat (at, author, text, parent) VALUES (?, ?, ?, ?) RETURNING id', now, said.author, said.text, root).one()['id'],
        )
        const item = Drive.human(self, { ...said, id })
        const life = Drive.lifecycle(self)
        if (item === undefined || life.state === 'paused') fail(named.stuck, 'the creator answered but the swarm stayed stuck')
        const choice = M.choose({ funded: false, harness: 'claude', hosted: false, last: 'plan', plans: plans() })
        const order = Drive.order(self, { choice, n, now })
        if ('halt' in order || order.items[0]?.id !== item)
          fail(
            named.priority,
            'the answer was not the first item after stuck: ' + JSON.stringify('halt' in order ? order.halt : order.items.map((one) => one.id)),
          )
      }
    }
    if (mode === 'steer' && cap !== null && run.turns > cap + limits.steerRaise * limits.humansMost) fail(named.cap, run.turns + ' turns')
    if (roots(world) !== 1) fail(named.board, roots(world) + ' Board roots at the end')
  } catch (error) {
    const message = String((error as Error)?.message ?? error)
    const invariant = Object.values(named).find((one) => message.includes(one)) ?? 'crashed'
    fail(invariant, message.slice(0, 300))
  } finally {
    restore()
  }
  return { steps, violations }
}

const flip = (key: keyof typeof Machine.guards) => () => {
  Machine.guards[key] = false
  return () => void (Machine.guards[key] = true)
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = {
  drive_day: (seed) => drive(seed, 'day'),
  drive_steer: (seed) => drive(seed, 'steer'),
  drive_stuck: (seed) => drive(seed, 'stuck'),
}

const seeds = ['1', '2', '3', '4', '5', '6', '7', '8']

export const canaries: Canary[] = [
  { flip: flip('flight'), invariant: named.flight, name: 'drive.flight', scenario: 'drive_steer', seeds },
  { flip: flip('hourly'), invariant: named.hourly, name: 'drive.hourly', scenario: 'drive_day', seeds },
  { flip: flip('dedupe'), invariant: named.dedupe, name: 'drive.dedupe', scenario: 'drive_day', seeds },
  { flip: flip('stuck'), invariant: named.stuck, name: 'drive.stuck', scenario: 'drive_stuck', seeds },
  { flip: flip('reset'), invariant: named.limit, name: 'drive.reset', scenario: 'drive_day', seeds },
  { flip: flip('priority'), invariant: named.priority, name: 'drive.priority', scenario: 'drive_steer', seeds },
  { flip: flip('fence'), invariant: named.fence, name: 'drive.fence', scenario: 'drive_day', seeds },
  { flip: flip('legal'), invariant: named.legal, name: 'drive.legal', scenario: 'drive_day', seeds },
  {
    flip: mutant(
      'drive.revoke',
      'src/worker/machines/Drive.ts',
      "return input.funded ? { lost: plan, source: 'credit' } : { halt: { plan, why: 'revoked' } }",
      "return { lost: plan, source: 'credit' }",
    ),
    invariant: named.revoke,
    name: 'drive.revoke',
    scenario: 'drive_day',
    seeds,
  },
  {
    flip: mutant(
      'drive.cap',
      'src/worker/Drive.ts',
      'fields.turns >= fields.cap && fields.counted < input.n',
      'fields.turns > fields.cap + 1 && fields.counted < input.n',
    ),
    invariant: named.cap,
    name: 'drive.cap',
    scenario: 'drive_steer',
    seeds,
  },
  {
    flip: mutant('drive.flow', 'src/worker/Drive.ts', '(fields.planned === input.n || room > 0)', '(fields.planned === input.n && room > 0)'),
    invariant: named.flow,
    name: 'drive.flow',
    scenario: 'drive_day',
    seeds,
  },
  {
    flip: mutant('drive.post', 'src/worker/Drive.ts', '  post(self, Shared.reason(halt))\n', "  post(self, 'Paused.')\n"),
    invariant: named.post,
    name: 'drive.post',
    scenario: 'drive_day',
    seeds,
  },
  {
    flip: mutant(
      'drive.board',
      'src/worker/Drive.ts',
      'const root = existing ? Number(existing.id) :',
      'const root = existing && !existing ? Number(existing.id) :',
    ),
    invariant: named.board,
    name: 'drive.board',
    scenario: 'drive_day',
    seeds,
  },
]
