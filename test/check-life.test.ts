import assert from 'node:assert/strict'
import test from 'node:test'
import { gateway, planted, proof, until } from './dispatch.ts'
import type * as NodesModule from '../src/worker/Nodes.ts'
import type * as RunnerModule from '../src/worker/Runner.ts'

const Runner: typeof RunnerModule = await import('../src/worker/Runner.ts')
const Nodes: typeof NodesModule = await import('../src/worker/Nodes.ts')

const statement = 'theorem P : True := trivial'

const passed = async () => proof(sha, await Nodes.stmt(statement))

const sha = 'a'.repeat(40)

test("a check this life's pool claimed before the first tick keeps its claim through the tick's release of an older life's claims", async (t) => {
  const g = gateway()
  const w = await planted(g.route, 0, statement)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  const runtime = Runner.runtime(w.swarm)
  runtime.first = true
  await Runner.postVerify(w.swarm, 'root', sha, 'Pnp.Nroot', false)
  await until(async () => (await w.swarm.board.task('v:root:' + sha.slice(0, 12)))?.phase === 'claimed')
  const claim = (await w.swarm.board.task('v:root:' + sha.slice(0, 12)))?.claim
  assert.ok(claim && runtime.claims.has(claim))
  await Runner.tick(w.swarm)
  const after = await w.swarm.board.task('v:root:' + sha.slice(0, 12))
  assert.equal(after?.phase, 'claimed')
  assert.equal(after?.claim, claim)
  await Runner.verified(w.swarm, 'root', sha, await passed())
  await until(async () => (await w.swarm.board.task('n:root'))?.phase === 'done')
})

test('a check whose result never comes back expires at its deadline, frees its verifier slot and tells the node once', async (t) => {
  const g = gateway()
  const w = await planted(g.route, 0, statement)
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  await Runner.postVerify(w.swarm, 'root', sha, 'Pnp.Nroot', false)
  const vid = 'v:root:' + sha.slice(0, 12)
  await until(() => w.swarm.kv.get<{ state: string }>(Runner.checkKey(vid))?.state === 'waiting')
  w.pass(Runner.timing.checkMs)
  Runner.wake(w.swarm)
  await until(async () => (await w.swarm.board.task(vid))?.phase === 'failed')
  assert.equal(w.swarm.kv.get<{ state: string }>(Runner.checkKey(vid))?.state, 'expired')
  assert.equal((await w.swarm.board.steers('n:root')).filter((steer) => steer.body.includes('did not come back')).length, 1)
  await Runner.verified(w.swarm, 'root', sha, await passed())
  assert.equal(w.swarm.kv.get('verified:' + vid), undefined)
  assert.notEqual((await w.swarm.board.task('n:root'))?.phase, 'done')
})

test('a check whose object restarts while it waits does not ask the verifier again, and the first result to come back is the one taken', async (t) => {
  const g = gateway()
  const w = await planted(g.route, 0, statement)
  let dispatched = 0
  const github = (w.env as unknown as { GITHUB: { fetch: (request: Request) => Promise<Response> } }).GITHUB
  const inner = github.fetch
  github.fetch = async (request) => {
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/dispatches')) dispatched += 1
    return inner(request)
  }
  t.after(async () => {
    await Runner.stop(w.swarm)
    w.restore()
  })
  await Runner.postVerify(w.swarm, 'root', sha, 'Pnp.Nroot', false)
  const vid = 'v:root:' + sha.slice(0, 12)
  await until(() => w.swarm.kv.get<{ state: string }>(Runner.checkKey(vid))?.state === 'waiting')
  assert.equal(dispatched, 1)
  await Runner.stop(w.swarm)
  w.swarm.runtime = undefined
  await Runner.tick(w.swarm)
  await until(async () => (await w.swarm.board.task(vid))?.phase === 'claimed')
  await Runner.verified(w.swarm, 'root', sha, await passed())
  await Runner.verified(w.swarm, 'root', sha, { failed: 'a later, different answer' })
  await until(async () => (await w.swarm.board.task('n:root'))?.phase === 'done')
  assert.equal(dispatched, 1)
  assert.equal((w.swarm.kv.get('verified:' + vid) as { commit?: string }).commit, sha)
})
