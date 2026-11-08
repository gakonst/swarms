import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import * as Setup from '../src/shared/Setup.ts'
import type * as PersonaModule from '../src/worker/Persona.ts'
import type * as TurnsModule from '../src/worker/Turns.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Persona: typeof PersonaModule = await import('../src/worker/Persona.ts')
const Turns: typeof TurnsModule = await import('../src/worker/Turns.ts')

const prices = new Map<string, Setup.Price>([
  [Setup.opus, { cached: 0.2, id: Setup.opus, input: 4, output: 20 }],
  [Setup.sol, { cached: 0.1, id: Setup.sol, input: 2, output: 10 }],
  [Setup.astra, { cached: 1, id: Setup.astra, input: 10, output: 50 }],
  [Setup.flash, { cached: 0.0048, id: Setup.flash, input: 0.24, output: 0.96 }],
])

const mix = (() => {
  const resolved = Setup.resolve({ template: 'frontier-mix' })
  assert.notEqual(typeof resolved, 'string')
  const setup = Setup.priced(resolved as Exclude<typeof resolved, string>, prices)
  assert.notEqual(typeof setup, 'string')
  return setup as Setup.Setup
})()

function store(entries: [string, unknown][] = []) {
  const map = new Map<string, unknown>(entries)
  return {
    delete: (key: string) => map.delete(key),
    get: <value>(key: string) => map.get(key) as value | undefined,
    map,
    put: (key: string, value: unknown) => void map.set(key, value),
  }
}

function swarm(kv: ReturnType<typeof store>, answer: (request: Request, body: unknown) => Response) {
  const sent: { body: unknown; method: string; path: string }[] = []
  const self = {
    agent: () => kv.get('agent'),
    env: {
      GATEWAY: {
        fetch: async (request: Request) => {
          const body = request.method === 'GET' ? undefined : await request.json()
          sent.push({ body, method: request.method, path: new URL(request.url).pathname })
          return answer(request, body)
        },
      },
      GATEWAY_URL: 'https://gateway.test',
      SWARMS_GATEWAY_KEY: 'test',
      SWARMS_URL: 'https://swarms.test',
    },
    kv,
    log: () => undefined,
  }
  return { self: self as never, sent }
}

const row = { id: 'abc123def456', setup: JSON.stringify(mix), title: 'A test swarm' } as never

test("a swarm's instructions name its template's models and every section", () => {
  const text = Persona.render(mix)
  for (const heading of ['# The work', '# Models', '# Tools and services', '# Wishlist', '# Money behind every request', '# Branches', '# Artifacts', '# Autoresearch'])
    assert.ok(text.includes(heading + (heading === '# Autoresearch' ? ' (' : '\n')), heading)
  assert.ok(text.includes(Setup.told(mix)))
  assert.ok(text.includes('A spawn with any other model is refused'))
  assert.ok(!text.includes('Your first message names'))
  assert.ok(Persona.render(null).includes('Your first message names'))
  assert.ok(text.length < 32_768)
})

test("a swarm keeps the instructions it first got, whatever the template says later", () => {
  const kv = store([['personaSet', 'abc']])
  const first = Persona.frozen(kv as never, mix)
  assert.equal(first, Persona.render(mix))
  assert.equal(kv.get('personaSet'), undefined)
  kv.put('instructions', 'an older text')
  assert.equal(Persona.frozen(kv as never, mix), 'an older text')
  assert.equal(Persona.frozen(kv as never, null), 'an older text')
})

test('a new lead is created with the swarm\'s own instructions and no persona', async () => {
  const kv = store([['secret', 's'.repeat(64)]])
  const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_new' }))
  const lead = await Turns.lead(self, row)
  assert.ok(!('error' in lead))
  assert.equal(lead.instructed, true)
  const created = sent.find((request) => request.path === '/v1/agents')
  const body = created?.body as Record<string, unknown>
  assert.equal(body['instructions'], Persona.render(mix))
  assert.equal(body['persona'], undefined)
  assert.equal(body['model'], Setup.opus)
  assert.ok(!sent.some((request) => request.path.startsWith('/v1/personas')))
})

test('a lead re-created later gets the text the swarm froze, not a newer one', async () => {
  const kv = store([['instructions', 'the text frozen at creation'], ['secret', 's'.repeat(64)]])
  const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_again' }))
  await Turns.lead(self, row)
  assert.equal((sent.find((request) => request.path === '/v1/agents')?.body as Record<string, unknown>)['instructions'], 'the text frozen at creation')
})

test('a lead on the shared persona gets the frozen text once, on its next turn, and the shared persona is never set', async () => {
  const url = 'https://swarms.test/api/swarms/abc123def456/pay'
  const kv = store([['agent', { briefed: true, cursor: 7, id: 'agt_old', persona: true, unreachable: null, url }], ['secret', 's'.repeat(64)]])
  const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_old' }))
  const lead = await Turns.lead(self, row)
  assert.ok(!('error' in lead))
  assert.equal(lead.instructed, true)
  assert.deepEqual(sent, [{ body: { instructions: Persona.render(mix) }, method: 'PATCH', path: '/v1/agents/agt_old' }])
  await Turns.lead(self, row)
  assert.equal(sent.length, 1)
})

test('a lead whose instructions the gateway refuses to give tries again next turn', async () => {
  const url = 'https://swarms.test/api/swarms/abc123def456/pay'
  const kv = store([['agent', { briefed: true, cursor: 7, id: 'agt_old', persona: true, unreachable: null, url }], ['secret', 's'.repeat(64)]])
  const { self, sent } = swarm(kv, () => Response.json({ detail: 'down' }, { status: 503 }))
  const lead = await Turns.lead(self, row)
  assert.ok(!('error' in lead))
  assert.notEqual(lead.instructed, true)
  await Turns.lead(self, row)
  assert.equal(sent.length, 2)
})
