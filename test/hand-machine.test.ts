import assert from 'node:assert/strict'
import test from 'node:test'
import { world } from './run.ts'
import type * as HandMachine from '../src/worker/machines/Hand.ts'
import type * as SwarmModule from '../src/worker/Swarm.ts'

const Machine: typeof HandMachine = await import('../src/worker/machines/Hand.ts')

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const id = 'abc123abc123'

type Swarm = InstanceType<typeof SwarmModule.Swarm>

async function simulate(seed: number) {
  const random = rng(seed)
  const minted = new Map<string, number>()
  const listed = new Set<string>()
  let crashes = 0
  let armed = false
  let die = () => undefined as void
  const hang = new Promise<never>(() => undefined)
  const fault = () => {
    if (!armed || crashes >= 3 || random() >= 0.06) return false
    crashes += 1
    die()
    return true
  }
  const w = world(async (request, url) => {
    if (url.pathname === '/v1/hands' && request.method === 'POST') {
      if (fault()) return hang
      if (random() < 0.1) return Response.json({ detail: 'down' }, { status: 500 })
      const name = url.searchParams.get('name') ?? ''
      minted.set(name, (minted.get(name) ?? 0) + 1)
      listed.add(name)
      if (fault()) return hang
      return Response.json({ command: 'nc hand', short: 'nc', token: 'hand_' + name, url: 'wss://gateway.test/v1/hands/' + name })
    }
    if (url.pathname === '/v1/hands') return Response.json({ hands: [...listed].map((name) => ({ connected: true, name, requests: 1 })) })
    const named = /^\/v1\/hands\/([^/]+)$/.exec(url.pathname)
    if (named && request.method === 'DELETE') {
      if (fault()) return hang
      const name = decodeURIComponent(named[1] ?? '')
      if (armed && random() < 0.1) return Response.json({ detail: 'down' }, { status: 500 })
      if (!listed.delete(name)) return Response.json({ detail: 'No such hand' }, { status: 404 })
      if (fault()) return hang
      return Response.json({ disconnected: true })
    }
    return undefined
  })
  const db = w.env.DB
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement =>
    new Proxy(statement, {
      get(target, key) {
        if (key === 'inner') return target
        if (key === 'bind') return (...values: unknown[]) => wrap(target.bind(...values))
        if (key === 'run' || key === 'all' || key === 'first')
          return async (...args: unknown[]) => {
            const writes = /^\s*(insert|update|delete)/i.test(String((target as unknown as { query?: string }).query ?? ''))
            if (fault()) return hang
            const answer = await (target[key] as (...args: unknown[]) => Promise<unknown>)(...args)
            if (writes && fault()) return hang
            return answer
          }
        return Reflect.get(target, key)
      },
    })
  ;(w.env as unknown as { DB: D1Database }).DB = {
    ...db,
    batch: async (statements: D1PreparedStatement[]) => {
      if (fault()) return hang
      const answer = await db.batch(statements.map((one) => (one as unknown as { inner?: D1PreparedStatement }).inner ?? one))
      if (fault()) return hang
      return answer
    },
    prepare: (query: string) => {
      const statement = wrap(db.prepare(query))
      ;(statement as unknown as { query?: string }).query = query
      return statement
    },
  } as unknown as D1Database
  await w.seed('0')
  armed = true
  const Life = w.swarm.constructor as new (ctx: unknown, env: unknown) => Swarm
  let swarm: Swarm = w.swarm
  const restart = () => {
    swarm = new Life(swarm.ctx, swarm.env)
  }
  const issued = new Set<string>()
  const removed = new Set<string>()
  const kept = new Set<string>()
  const maybe = new Set<string>()
  const bad: string[] = []
  const attempt = async <T>(work: () => Promise<T>) => {
    const crashed = new Promise<undefined>((resolve) => void (die = () => resolve(undefined)))
    const answer = await Promise.race([work(), crashed])
    if (answer === undefined) restart()
    return answer
  }
  for (let op = 0; op < 14; op++) {
    const pick = random()
    const names = [...issued]
    if (pick < 0.5 || !names.length) {
      const lent = await attempt(() => swarm.lend(id, 'box', null))
      if (lent?.ok) {
        if (issued.has(lent.name)) bad.push('seed ' + seed + ': ' + lent.name + ' issued twice')
        issued.add(lent.name)
      }
    } else if (pick < 0.85) {
      const name = names[Math.floor(random() * names.length)] as string
      const was = removed.has(name)
      const answer = await attempt(() => swarm.unlend(id, name))
      if (answer === undefined) {
        kept.delete(name)
        if (!was) maybe.add(name)
      } else if (answer.ok) {
        if (was) bad.push('seed ' + seed + ': a duplicate removal of ' + name + ' answered ok')
        removed.add(name)
        maybe.delete(name)
        kept.delete(name)
      } else if (answer && !answer.ok && answer.reason === 'upstream' && !maybe.has(name)) kept.add(name)
      else if (answer && !answer.ok && answer.reason === 'missing' && !was && !maybe.has(name)) bad.push('seed ' + seed + ': ' + name + ' missing before it was removed')
    } else await attempt(() => swarm.lent(id))
  }
  armed = false
  restart()
  await swarm.lend(id, 'final', null)
  const rows = (await db.prepare('select name, returned_at from hands where swarm = ?').bind(id).all<{ name: string; returned_at: number | null }>()).results
  const live = new Set(rows.filter((row) => row.returned_at === null).map((row) => row.name))
  const now = Date.now()
  for (const task of await swarm.board.tasks()) {
    if (task.labels['hands'] !== 'lent') continue
    const name = task.id.slice('hand:'.length)
    if (task.phase === 'claimed' && (task.untilMs ?? 0) > now && !live.has(name)) bad.push('seed ' + seed + ': ' + name + ' holds a slot with no row ' + JSON.stringify(swarm.kv.get('lent:' + name)) + ' ' + JSON.stringify(rows.filter((row) => row.name === name)))
    if ((task.phase === 'done' || task.phase === 'failed') && live.has(name)) bad.push('seed ' + seed + ': ' + name + ' has a live row but its task ended')
  }
  for (const name of listed) if (!live.has(name)) bad.push('seed ' + seed + ': ' + name + ' is still at the gateway with no row')
  for (const name of removed) {
    if (listed.has(name)) bad.push('seed ' + seed + ': removed ' + name + ' is still at the gateway')
    if (rows.some((row) => row.name === name)) bad.push('seed ' + seed + ': removed ' + name + ' still has a row')
    if (swarm.fleet().some((machine) => machine.name === name)) bad.push('seed ' + seed + ': removed ' + name + ' is still a machine')
    const again = await swarm.unlend(id, name)
    if (again.ok || again.reason !== 'missing') bad.push('seed ' + seed + ': removing ' + name + ' again answered ' + JSON.stringify(again))
  }
  for (const name of maybe) {
    const gone = !listed.has(name) && !rows.some((row) => row.name === name) && !swarm.fleet().some((machine) => machine.name === name)
    const there = listed.has(name) && live.has(name)
    if (!gone && !there) bad.push('seed ' + seed + ': ' + name + ', whose removal stopped half way, is neither removed nor lent')
  }
  for (const name of kept) if (!listed.has(name)) bad.push('seed ' + seed + ': ' + name + ', whose removal failed, was revoked anyway')
  for (const [name, count] of minted) if (count > 1) bad.push('seed ' + seed + ': ' + name + ' minted ' + count + ' times')
  for (const raw of swarm.kv.list({ prefix: 'lent:' })) {
    const at = Machine.read(raw[1])
    if (at && (at.state === 'issued' || at.state === 'revoking')) bad.push('seed ' + seed + ': ' + raw[0] + ' left ' + at.state)
  }
  w.restore()
  return bad
}

async function sweep(seeds = 60, early = false) {
  const bad: string[] = []
  for (let seed = 1; seed <= seeds && !(early && bad.length); seed++) bad.push(...(await simulate(seed)))
  return bad
}

test('lent hands, issued, seen and removed with crashes before and after every gateway call and D1 write and the object restarted on the same storage, never hold a slot without a row, never leak a gateway hand, and a removal answers once', async () => {
  assert.deepEqual(await sweep(), [])
})

test('the hand machine covers every transition and refuses stale and replayed ones', () => {
  const issued = Machine.hand(undefined, { at: 0, kind: 'issue', life: 'a' })
  assert.ok(issued.ok && issued.state.state === 'issued')
  assert.deepEqual(Machine.hand(issued.state, { at: 0, kind: 'issue', life: 'a' }), { ok: false, why: 'replayed' })
  const minted = Machine.hand(issued.state, { at: 1, kind: 'mint' })
  assert.ok(minted.ok && minted.state.state === 'minted')
  assert.deepEqual(Machine.hand(minted.state, { at: 1, kind: 'mint' }), { ok: false, why: 'replayed' })
  assert.deepEqual(Machine.hand(minted.state, { at: 1, kind: 'return' }), { ok: false, why: 'illegal' })
  const revoking = Machine.hand(minted.state, { at: 2, by: 'owner', kind: 'revoke', life: 'b' })
  assert.ok(revoking.ok && revoking.state.state === 'revoking' && revoking.state.life === 'b')
  const kept = Machine.hand(revoking.state, { at: 3, kind: 'kept' })
  assert.ok(kept.ok && kept.state.state === 'minted')
  assert.deepEqual(Machine.hand(revoking.state, { at: 3, kind: 'mint' }), { ok: false, why: 'stale' })
  const returned = Machine.hand(revoking.state, { at: 4, kind: 'return' })
  assert.ok(returned.ok && returned.state.state === 'returned')
  for (const event of [{ at: 5, kind: 'return' }, { at: 5, by: 'owner', kind: 'revoke', life: 'c' }] as HandMachine.HandEvent[]) assert.deepEqual(Machine.hand(returned.state, event), { ok: false, why: 'replayed' })
  for (const event of [{ at: 5, kind: 'mint' }, { at: 5, kind: 'kept' }] as HandMachine.HandEvent[]) assert.deepEqual(Machine.hand(returned.state, event), { ok: false, why: 'stale' })
  const failed = Machine.hand(issued.state, { at: 1, kind: 'return' })
  assert.ok(failed.ok && failed.state.state === 'returned')
  assert.deepEqual(Machine.hand(undefined, { at: 0, kind: 'mint' }), { ok: false, why: 'illegal' })
  assert.ok(Machine.unfinished(issued.state, false) && !Machine.unfinished(issued.state, true) && !Machine.unfinished(minted.state, false) && Machine.unfinished(revoking.state, false))
})

const mutants: [string, Partial<typeof Machine.machine>][] = [
  ['an earlier life left half way is never repaired', { unfinished: () => false }],
  ['a removal the gateway refused does not keep the hand', { step: (at, event) => (event.kind === 'kept' ? { ok: false, why: 'stale' } : Machine.hand(at, event)) }],
  ['a claimed slot is not written as issued', { step: (at, event) => (event.kind === 'issue' ? { ok: false, why: 'illegal' } : Machine.hand(at, event)) }],
]

for (const [name, patch] of mutants)
  test('mutant: ' + name + ' turns the hand simulation red', async (t) => {
    const saved = { ...Machine.machine }
    Object.assign(Machine.machine, patch)
    t.after(() => void Object.assign(Machine.machine, saved))
    assert.notDeepEqual(await sweep(60, true), [])
  })
