import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh, preload } from '../src/web/pages.ts'

const stored = new Map<string, string>()

let reloads = 0

Object.assign(globalThis, {
  location: { pathname: '/swarms/new', reload: () => void reloads++ },
  sessionStorage: { getItem: (key: string) => stored.get(key) ?? null, removeItem: (key: string) => void stored.delete(key), setItem: (key: string, value: string) => void stored.set(key, value) },
})

const gone = () => Promise.reject(new Error('Failed to fetch dynamically imported module'))

function settled(promise: Promise<unknown>) {
  return Promise.race([promise.then(() => 'loaded', (error: Error) => `failed: ${error.message}`), new Promise((resolve) => setTimeout(() => resolve('reloading'), 10))])
}

test('a page chunk that fails to load reloads the tab once for every deploy, not once for the whole session', async () => {
  assert.equal(await settled(fresh('new', gone)), 'reloading')
  assert.equal(reloads, 1)

  assert.equal(await settled(fresh('new', gone)), 'failed: Failed to fetch dynamically imported module')
  assert.equal(reloads, 1)

  preload('new', () => null)
  assert.deepEqual([...stored], [])

  assert.equal(await settled(fresh('new', gone)), 'reloading')
  assert.equal(reloads, 2)

  assert.equal(await settled(fresh('new', async () => 'New')), 'loaded')
  assert.equal(await settled(fresh('docs', gone)), 'reloading')
  assert.equal(reloads, 3)
})
