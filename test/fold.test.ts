import assert from 'node:assert/strict'
import test from 'node:test'
import { Board } from 'nanocode-ts'
import { ana, gateway, id, planted, until, type Sub } from './dispatch.ts'
import { world } from './run.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'

const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')

const counted = (w: { swarm: { ctx: { storage: { sql: SqlStorage } } } }, query: string) => Number(w.swarm.ctx.storage.sql.exec<{ n: number }>(query).one().n)

test("a run's result whose fold stopped half way, as when the object restarts or its lease is lost, is folded again in full but tells it once", async (t) => {
  const g = gateway()
  const w = await planted(g.route)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const board = w.swarm.board
  const post = board.post
  let cut = 0
  board.post = async (task, options) => {
    if (task.labels['kind'] === 'node' && task.parent === 'n:root' && cut++ === 1) throw new Board.LeaseLost('r:root:1')
    return post(task, options)
  }
  await w.swarm.treePledge(id, { amount: '5', contributor: ana, hash: '0x' + '9'.repeat(64), nid: null })
  await until(() => g.subs.length === 1)
  const sub = g.subs[0] as Sub
  sub.spent_usd = 1
  sub.status = { output: { children: [{ needs: [], spec: 'A.', statement: null, title: 'Lemma A' }, { needs: [], spec: 'B.', statement: null, title: 'Lemma B' }], commit: null, outcome: 'split', summary: 'Split in two', theorem: null, why: null }, state: 'completed' }
  Runner.wake(w.swarm)
  await until(() => cut >= 2)
  await Runner.stop(w.swarm)
  w.swarm.runtime = undefined
  await Runner.tick(w.swarm)
  await until(async () => (await w.swarm.board.task('r:root:1'))?.phase === 'done')
  assert.equal(counted(w, "SELECT COUNT(*) AS n FROM tree_deltas WHERE node = 'root' AND event = 'progress'"), 1)
  assert.equal(counted(w, "SELECT COUNT(*) AS n FROM tree_deltas WHERE event = 'posted' AND node NOT IN ('root', 'triage')"), 2)
  assert.equal(w.swarm.kv.get('quiet:root'), undefined)
})

test("a turn whose end stopped half way, as when the object restarts, is folded once: its update is posted and announced once", async (t) => {
  let report = { request_id: 'agt_1:1', status: 'running' } as Record<string, unknown>
  let hung = 0
  let wake = () => undefined as void
  const w = world((_request, url) => {
    if (url.pathname === '/v1/agents/agt_1/turns/agt_1:1') return Response.json(report)
    if (url.pathname === '/v1/kv/list' && report['status'] === 'completed' && hung++ === 0) return new Promise<Response>((resolve) => void (wake = () => resolve(Response.json({ error: 'gone' }, { status: 503 }))))
    return undefined
  })
  let first: Promise<void> = Promise.resolve()
  t.after(async () => {
    wake()
    await first
    w.restore()
  })
  await w.seed()
  await w.swarm.wake('money')
  await w.ring()
  assert.equal(w.swarm.run().state, 'working')
  report = { ok: { message: 'Did a step' }, request_id: 'agt_1:1', status: 'completed' }
  w.swarm.checked = 0
  first = w.swarm.alarm()
  await until(() => hung === 1)
  const Life = w.swarm.constructor as new (ctx: unknown, env: unknown) => typeof w.swarm
  const again = new Life(w.swarm.ctx, w.swarm.env)
  await again.alarm()
  assert.equal(again.run().state, 'waiting')
  assert.equal(counted(w, "SELECT COUNT(*) AS n FROM feed WHERE text LIKE 'Posted an update%'"), 1)
  assert.equal(counted(w, "SELECT COUNT(*) AS n FROM chat WHERE text LIKE 'Update:%'"), 1)
})
