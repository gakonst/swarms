import assert from 'node:assert/strict'
import * as Http from 'node:http'
import test from 'node:test'
import * as Endpoints from './e2e/endpoints.ts'

test('a cold run opens a new connection for every request and reads server-timing', async () => {
  const paths: string[] = []
  let connections = 0
  const server = Http.createServer((request, response) => {
    paths.push(request.url ?? '')
    response.setHeader('server-timing', 'do.viewed;dur=7, total;dur=12')
    response.setHeader('cf-ray', 'ray-1')
    response.end('ok')
  })
  server.on('connection', () => (connections += 1))
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const pauses: number[] = []
  try {
    const report = await Endpoints.cold(root, { idle: 60, pause: async (ms) => void pauses.push(ms), rounds: 2, routes: ['/', '/v1/health', '/x/card.svg'], samples: 3 })
    assert.equal(report.runs.length, 2 * 3 + 3 * 3)
    assert.equal(connections, report.runs.length)
    assert.deepEqual(pauses, [60_000, 60_000])
    assert.deepEqual(paths.slice(0, 6), ['/', '/v1/health', '/x/card.svg', '/v1/health', '/x/card.svg', '/'])
    assert.deepEqual(report.runs.filter((run) => run.first).map((run) => run.route), ['/', '/v1/health'])
    for (const run of report.runs) {
      assert.equal(run.phases.status, 200)
      assert.equal(run.phases.server, 12)
      assert.equal(run.phases.ray, 'ray-1')
      assert.ok(run.phases.connect <= run.phases.ttfb && run.phases.ttfb <= run.phases.total)
    }
    const table = Endpoints.coldTable(report)
    assert.match(table, /\| \/v1\/health \| fresh \| 3 \|/)
    assert.match(table, /\| any \(first after idle\) \| idle \| 2 \|/)
  } finally {
    server.close()
  }
})
