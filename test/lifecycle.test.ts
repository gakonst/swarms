// The agent swarm's lifecycle against the object itself: a turn's end across
// a restart, and event pages read again.
// Each test has a mutant beside it that turns the guard off and checks the
// test goes red.

import assert from 'node:assert/strict'
import test from 'node:test'
import { until } from './dispatch.ts'
import { world } from './run.ts'
import * as Run from '../src/worker/machines/Run.ts'
import * as Cursor from '../src/worker/machines/Cursor.ts'

const counted = (w: { swarm: { ctx: { storage: { sql: SqlStorage } } } }, query: string, ...values: unknown[]) => Number(w.swarm.ctx.storage.sql.exec<{ n: number }>(query, ...values).one().n)

// A turn whose end hangs in its last effect while a second life of the object
// rings the alarm over the same storage (as fold.test.ts), then the first life
// wakes and carries on.
async function restartedEnd(t: test.TestContext) {
  let report = { request_id: 'agt_1:1', status: 'running' } as Record<string, unknown>
  let hung = 0
  let wake = () => undefined as void
  const w = world((_request, url) => {
    if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json(report)
    if (url.pathname === '/v1/kv/list' && report['status'] === 'completed' && hung++ === 0) return new Promise<Response>((resolve) => void (wake = () => resolve(Response.json({ error: 'gone' }, { status: 503 }))))
    return undefined
  })
  t.after(() => w.restore())
  await w.seed()
  await w.swarm.wake('money')
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
  report = { ok: { message: 'Did a step' }, request_id: 'agt_1:1', status: 'completed' }
  w.swarm.checked = 0
  const first = w.swarm.alarm()
  await until(() => hung === 1)
  const Life = w.swarm.constructor as new (ctx: unknown, env: unknown) => typeof w.swarm
  const again = new Life(w.swarm.ctx, w.swarm.env)
  await again.alarm()
  const state = again.run().state
  wake()
  await first
  return { again, state, updates: counted(w, "SELECT COUNT(*) AS n FROM feed WHERE text LIKE 'Posted an update%'"), lines: counted(w, "SELECT COUNT(*) AS n FROM chat WHERE text LIKE 'Update:%'") }
}

test('a turn whose end hangs, with a second life finishing it and the first waking late, is folded once and stays closed', async (t) => {
  const { again, lines, state, updates } = await restartedEnd(t)
  assert.equal(state, 'waiting')
  assert.equal(again.run().state, 'waiting', 'the first life, waking late, does not move the run back')
  assert.equal(updates, 1)
  assert.equal(lines, 1)
})

test('mutant: a turn end without its done marks posts and announces its update twice', async (t) => {
  Run.guards.once = false
  t.after(() => void (Run.guards.once = true))
  const { lines, updates } = await restartedEnd(t)
  assert.ok(updates > 1 || lines > 1)
})

// An agent that answers its events page again: the second page overlaps the
// first, as a page read again after a restart or a gateway retry does.
async function overlapping(t: test.TestContext) {
  const tool = (seq: number) => ({ created_at: seq * 1000, event: { event: { payload: { arguments: '{}', call_id: 'c' + seq, name: 'kv_get' }, type: 'tool.call' }, source: 'agent' }, seq })
  let serving = false
  const w = world((_request, url) => {
    if (!serving || url.pathname !== '/v1/agents/agt_1/events' || url.searchParams.get('live') === '1') return undefined
    const after = Number(url.searchParams.get('after') ?? 0)
    if (after < 2) return Response.json({ events: [tool(1), tool(2)], has_more: true, next_cursor: 2 })
    if (after < 3) return Response.json({ events: [tool(1), tool(2), tool(3)], has_more: false, next_cursor: 3 })
    return Response.json({ events: [], has_more: false, next_cursor: after })
  })
  t.after(() => w.restore())
  await w.seed()
  await w.swarm.wake('money')
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
  serving = true
  w.swarm.stream = { retry: Date.now() + 3_600_000, state: 'polling' }
  w.swarm.checked = Date.now()
  await w.ring()
  return [1, 2, 3].map((seq) => counted(w, 'SELECT COUNT(*) AS n FROM feed WHERE event = ?', seq))
}

test('events read again in an overlapping page are folded once, by seq', async (t) => {
  const rows = await overlapping(t)
  assert.ok(rows[0] && rows[0] > 0, 'the first event wrote a row')
  assert.deepEqual(rows, [rows[0], rows[0], rows[0]])
})

test('mutant: without the seq check, an overlapping page folds its events twice', async (t) => {
  Cursor.guards.seq = false
  t.after(() => void (Cursor.guards.seq = true))
  const rows = await overlapping(t)
  assert.ok((rows[1] ?? 0) > (rows[2] ?? 0))
})
