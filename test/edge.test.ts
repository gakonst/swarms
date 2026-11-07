import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as EdgeModule from '../src/worker/Edge.ts'

const waited: Promise<unknown>[] = []
const stored = new Map<string, Response>()

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = (task) => globalThis.__waited.push(task)' } : next(specifier, context),
})
Object.assign(globalThis, {
  __waited: waited,
  caches: { default: { match: async (request: Request) => stored.get(request.url)?.clone(), put: async (request: Request, response: Response) => void stored.set(request.url, response) } },
})

const Edge: typeof EdgeModule = await import('../src/worker/Edge.ts')
const env = { SWARMS_URL: 'https://swarms.test' } as never
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('requests without a cached value each read for themselves instead of awaiting another request’s read', async () => {
  let reads = 0
  const read = async () => {
    const n = ++reads
    await sleep(20)
    return n
  }
  const [a, b] = await Promise.all([Edge.cached(env, 'cold', 5, read), Edge.cached(env, 'cold', 5, read)])
  assert.equal(reads, 2)
  assert.deepEqual([a, b].sort(), [1, 2])
})

test('while one request refreshes a stale value in the background, the others answer the stale value without waiting on it', async () => {
  Edge.put(env, 'stale', 'old', 60)
  await Promise.all(waited.splice(0))
  stored.delete('https://swarms.test/__cache/stale')
  await sleep(1100)
  let reads = 0
  const read = async () => {
    reads += 1
    await sleep(200)
    return 'new'
  }
  const started = Date.now()
  const answers = await Promise.all([Edge.cached(env, 'stale', 1, read, 60), Edge.cached(env, 'stale', 1, read, 60), Edge.cached(env, 'stale', 1, read, 60, 50)])
  assert.deepEqual(answers, ['old', 'old', 'old'])
  assert.ok(Date.now() - started < 150)
  assert.equal(reads, 1)
  await Promise.all(waited.splice(0))
  assert.equal(await Edge.cached(env, 'stale', 1, read, 60), 'new')
  assert.equal(reads, 1)
})
