import assert from 'node:assert/strict'
import test from 'node:test'
import * as Filled from '../src/worker/Filled.ts'

const names = ['SWARMS_GATEWAY_KEY', 'SWARMS_GITHUB_WEBHOOK_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']

test('the site reads its secrets from the vault once per isolate', async () => {
  Filled.reset()
  let calls = 0
  const vault = { secrets: () => (calls++, { SWARMS_GATEWAY_KEY: 'k', TELEGRAM_BOT_TOKEN: 't' }) }
  const env = { DB: 'db' } as Record<string, unknown>
  const a = (await Filled.filled(env, vault, names)) as Record<string, unknown>
  const b = (await Filled.filled(env, vault, names)) as Record<string, unknown>
  assert.equal(a.SWARMS_GATEWAY_KEY, 'k')
  assert.equal(a.DB, 'db')
  assert.equal(b.TELEGRAM_BOT_TOKEN, 't')
  assert.equal(calls, 1)
  assert.equal(env.SWARMS_GATEWAY_KEY, undefined)
})

test('a site with its own secrets never calls the vault', async () => {
  Filled.reset()
  let calls = 0
  const env = Object.fromEntries(names.map((n) => [n, 'own']))
  const out = (await Filled.filled(env, { secrets: () => (calls++, {}) }, names)) as Record<string, unknown>
  assert.equal(out.SWARMS_GATEWAY_KEY, 'own')
  assert.equal(calls, 0)
})

test('a failed vault read is tried again on the next request', async () => {
  Filled.reset()
  let calls = 0
  const vault = {
    secrets: () => {
      calls++
      if (calls === 1) throw new Error('down')
      return { SWARMS_GATEWAY_KEY: 'k' }
    },
  }
  await assert.rejects(Filled.filled({}, vault, names))
  const out = (await Filled.filled({}, vault, names)) as Record<string, unknown>
  assert.equal(out.SWARMS_GATEWAY_KEY, 'k')
  assert.equal(calls, 2)
})
