import * as assert from 'node:assert/strict'
import { after, test } from 'node:test'
import * as Credit from '../../src/shared/Credit.ts'
import type * as Chain from '../mock/chain.ts'
import * as Dev from './dev.ts'
import * as Endpoints from './endpoints.ts'
import { rider } from './rider.ts'

const local = process.env['SWARMS_BASE'] === 'local'

let dev: Dev.Dev | undefined

after(async () => {
  await dev?.stop()
})

async function seed() {
  dev = await Dev.start({ gateway: { port: 6620 }, port: Number(process.env['SWARMS_PORT'] ?? 5620) })
  const ana = await rider(dev, 'ana')
  assert.equal((await ana.call('POST', '/v1/me', { name: 'ana' })).status, 200)
  const made = await ana.call<{ id: string }>('POST', '/v1/swarms', { goal: 'Answer every route the site serves, on mocks.', nickname: 'every-route', template: 'cheap', title: 'Every route (e2e)' })
  assert.equal(made.status, 201, JSON.stringify(made.body))
  const tree = await ana.call<{ id: string }>('POST', '/v1/swarms', { form: 'tree', goal: 'A tree swarm for the route sweep.', template: 'cheap', title: 'Route tree (e2e)' })
  assert.equal(tree.status, 201, JSON.stringify(tree.body))
  for (const [id, note] of [[made.body.id, null], [tree.body.id, 'n:root']] as const) {
    const paid = dev.gateway.chain.transfer({ amount: '3', from: ana.address, memo: Credit.memo(dev.gateway.wallet, id, note) as Chain.Hex })
    assert.equal((await ana.call('POST', `/v1/swarms/${id}/contributions`, { hash: paid.hash })).status, 201)
  }
  assert.equal((await ana.call('POST', `/v1/swarms/${made.body.id}/chat`, { text: 'hello from the route sweep' })).status, 201)
  return { operator: String(dev.env['SWARMS_GATEWAY_KEY']), root: dev.url, token: ana.token, writes: true }
}

test('every route answers as documented', { timeout: 900_000 }, async () => {
  const given = local ? await seed() : { root: Endpoints.base(), token: process.env['SWARMS_TOKEN'] }
  const report = await Endpoints.run(given)
  if (local) assert.ok(report.world.made && report.rows.some((row) => row.route === '/v1/swarms/:made/archive' && row.ok), 'the local sweep makes, writes to and archives a throwaway swarm')
  console.log(Endpoints.summary(report))
  assert.deepEqual(report.rows.filter((row) => !row.ok).map((row) => `${row.method} ${row.route} (${row.signed}) answered ${row.status}: ${row.note}`), [])
})
