import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as RepoModule from '../src/worker/Repo.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Repo: typeof RepoModule = await import('../src/worker/Repo.ts')

function swarm() {
  const kv = new Map<string, unknown>()
  const logged: string[] = []
  const d1 = { failing: false, repo: null as string | null }
  const self = {
    born: 0,
    changed: () => undefined,
    cues: new Map<string, number>(),
    env: {
      DB: {
        prepare: () => ({
          bind: (...args: unknown[]) => ({
            run: async () => {
              if (d1.failing) throw new Error('D1_ERROR: network connection lost')
              d1.repo = String(args[0])
              return {}
            },
          }),
        }),
      },
      GATEWAY: { fetch: async (request: Request) => (new URL(request.url).pathname === '/api/keys/me' ? Response.json({ wallet: '0xAB' }) : Response.json({ repos: [{ name: 'my-swarm' }] })) },
      GATEWAY_URL: 'https://gateway.test',
      SWARMS_GATEWAY_KEY: 'test',
    },
    kv: { delete: (key: string) => kv.delete(key), get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value) },
    log: (_kind: string, text: string) => void logged.push(text),
  }
  return { d1, kv, logged, self }
}

const row = { id: 'abc123abc123', repo: null, title: 'My swarm' } as never

test('a repository is ready in the swarm object only once the database has it', async () => {
  const { d1, kv, logged, self } = swarm()
  d1.failing = true
  await assert.rejects(Repo.located(self as never, row))
  assert.equal(kv.get('repo'), undefined)
  assert.deepEqual(await Repo.located(self as never, row), { name: 'my-swarm', state: 'none' })

  d1.failing = false
  self.cues.set('git', Date.now() + 1)
  assert.deepEqual(await Repo.located(self as never, row), { name: 'my-swarm', state: 'ready' })
  assert.deepEqual([kv.get('repo'), d1.repo], ['my-swarm', 'my-swarm'])
  assert.deepEqual(logged, ["The swarm's code now lives in its public repository my-swarm, which its page shows."])
})

test('a repository an older object held without the database having it is written there on the next look', async () => {
  const { d1, kv, self } = swarm()
  kv.set('repo', 'my-swarm')
  assert.deepEqual(await Repo.located(self as never, row), { name: 'my-swarm', state: 'ready' })
  assert.equal(d1.repo, 'my-swarm')
})
