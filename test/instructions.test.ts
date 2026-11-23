import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import * as Setup from '../src/shared/Setup.ts'
import type * as PersonaModule from '../src/worker/Persona.ts'
import type * as TurnsModule from '../src/worker/Turns.ts'
import './host.ts'

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
  [Setup.glm, { cached: 0.14, id: Setup.glm, input: 1.12, output: 3.52 }],
  [Setup.kimi, { cached: 0.2, id: Setup.kimi, input: 1.7, output: 8.5 }],
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

test('a swarm keeps the instructions its lead first got, whatever the template says later', () => {
  const kv = store([['personaSet', 'abc']])
  assert.equal(Persona.frozen(kv as never, mix), Persona.render(mix))
  assert.equal(kv.get('instructions'), undefined)
  Persona.keep(kv as never, 'an older text')
  assert.equal(kv.get('personaSet'), undefined)
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
  assert.equal(body['payer'], 'backers')
  assert.equal(body['model'], Setup.opus)
  assert.ok(!sent.some((request) => request.path.startsWith('/v1/personas')))
  assert.equal(kv.get('instructions'), Persona.render(mix))
})

test('a lead re-created later gets the text the swarm froze, not a newer one', async () => {
  const kv = store([['instructions', 'the text frozen at creation'], ['secret', 's'.repeat(64)]])
  const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_again' }))
  await Turns.lead(self, row)
  assert.equal((sent.find((request) => request.path === '/v1/agents')?.body as Record<string, unknown>)['instructions'], 'the text frozen at creation')
})

test("a lead that still has a payer route is moved to the swarm's backers once", async () => {
  const url = 'https://swarms.test/api/swarms/abc123def456/pay'
  const kv = store([['agent', { briefed: true, cursor: 7, id: 'agt_old', instructed: true, url }]])
  const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_old' }))
  const lead = await Turns.lead(self, row)
  assert.ok(!('error' in lead))
  assert.equal(lead.url, 'backers')
  assert.deepEqual(sent, [{ body: { payer: 'backers' }, method: 'PATCH', path: '/v1/agents/agt_old' }])
  await Turns.lead(self, row)
  assert.equal(sent.length, 1)
})

test('a lead on the shared persona gets the frozen text once, on its next turn, and the shared persona is never set', async () => {
  const url = 'backers'
  const kv = store([['agent', { briefed: true, cursor: 7, id: 'agt_old', persona: true, url }], ['secret', 's'.repeat(64)]])
  const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_old' }))
  const lead = await Turns.lead(self, row)
  assert.ok(!('error' in lead))
  assert.equal(lead.instructed, true)
  assert.deepEqual(sent, [{ body: { instructions: Persona.render(mix) }, method: 'PATCH', path: '/v1/agents/agt_old' }])
  await Turns.lead(self, row)
  assert.equal(sent.length, 1)
  assert.equal(kv.get('instructions'), Persona.render(mix))
})

test('a lead whose instructions the gateway refuses to give tries again next turn', async () => {
  const url = 'backers'
  const kv = store([['agent', { briefed: true, cursor: 7, id: 'agt_old', persona: true, url }], ['secret', 's'.repeat(64)]])
  const { self, sent } = swarm(kv, () => Response.json({ detail: 'down' }, { status: 503 }))
  const lead = await Turns.lead(self, row)
  assert.ok(!('error' in lead))
  assert.notEqual(lead.instructed, true)
  await Turns.lead(self, row)
  assert.equal(sent.length, 2)
  assert.equal(kv.get('instructions'), undefined)
})


const lemma = { form: 'lemma', nid: '2f7a140626', spec: 'Majority vote is not a SAT algorithm\n\nA checked counterexample.', statement: '∃ φ : CNF, φ.Satisfiable ∧ φ.eval (majorityAssignment φ) = false', title: 'Majority vote is not a SAT algorithm' }

const context = { ancestors: ['Does P = NP?', 'Upper bounds: toward P = NP'], failures: ['axioms outside the allowlist: [sorryAx]'], siblings: ['2-SAT is in P: progress, implication graph built'], steers: ['[$4 behind this, from @ana] Try three variables.'] }

test("a node worker's task is the frozen rules, then the node's own words and context", () => {
  const text = Persona.node(mix, lemma, context)
  for (const heading of ['# How a node is worked', '# Think on paper first', '# Lean decides what is proven', '# Git', '# Split rather than sprawl', '# Keep every dead end, with why', '# Money behind every note', '# Models', '# What you return', '# Your node'])
    assert.ok(text.includes(heading + '\n'), heading)
  assert.ok(!text.includes('<nid>'))
  assert.ok(text.includes('node/2f7a140626'))
  assert.ok(text.includes('theorem Pnp.N2f7a140626'))
  assert.ok(text.includes('Pnp/Proofs/N2f7a140626.lean'))
  assert.ok(text.includes('git merge --no-ff node/2f7a140626'))
  assert.ok(text.includes('Never delete or force-push a branch'))
  assert.ok(text.includes('anything in Pnp/Statements/'))
  assert.ok(text.includes('propext, Classical.choice and Quot.sound'))
  assert.ok(text.includes('{ outcome, summary, commit, theorem, children, why }'))
  assert.ok(text.includes('"[$4 behind this, from @ana]"'))
  assert.ok(text.includes(Setup.told(mix)))
  assert.ok(text.includes(lemma.spec))
  const order = ['# Your node', '# Notes from riders, heed these first', '# Where it sits (root first)', '# What its siblings found', '# Why earlier attempts failed'].map((heading) => text.indexOf(heading))
  assert.deepEqual([...order].sort((a, b) => a - b), order)
  assert.ok(order.every((at) => at > 0))
  assert.ok(text.includes('- [$4 behind this, from @ana] Try three variables.'))
  assert.ok(text.length < 32_768)
})

test('a node worker gets the rules its swarm froze, and only the sections that have something in them', () => {
  const text = Persona.node(null, { ...lemma, form: 'program', statement: null }, { ancestors: [], failures: [], siblings: [], steers: [] }, 'Frozen for <nid>.')
  assert.ok(text.startsWith('Frozen for 2f7a140626.\n'))
  assert.ok(text.includes('This node has no Lean statement'))
  for (const heading of ['# Notes from riders', '# Where it sits', '# What its siblings found', '# Why earlier attempts failed']) assert.ok(!text.includes(heading), heading)
  assert.ok(!Persona.rules(null).includes('# Models'))
  assert.equal(Persona.node(mix, lemma, context, Persona.rules(mix)), Persona.node(mix, lemma, context))
})

test('a run returns the output schema of DESIGN 6.3', () => {
  assert.deepEqual([...Persona.output.required], ['outcome', 'summary', 'commit', 'theorem', 'children', 'why'])
  assert.deepEqual([...Persona.output.properties.outcome.enum], ['proved', 'refuted', 'split', 'progress', 'stuck'])
  assert.deepEqual([...Persona.output.properties.children.items.required], ['title', 'spec', 'statement', 'needs'])
})

test('the dispatcher spawns exactly the subagent it is given and nothing else', () => {
  const text = Persona.dispatcher()
  assert.ok(text.includes('call spawn_agent exactly once with exactly those arguments, copied unchanged'))
  assert.ok(text.includes('never spawn a subagent nobody asked for'))
  assert.ok(text.includes('never change the budget or the model'))
  assert.ok(!text.includes('Pnp'))
  const request = JSON.parse(Persona.spawn({ budget_usd: 5, harness: 'claude', model: Setup.flash, role: 'n:2f7a140626#1', task: Persona.node(mix, lemma, context) })) as Record<string, unknown>
  assert.deepEqual(Object.keys(request).sort(), ['budget_usd', 'harness', 'model', 'output_schema', 'role', 'task'])
  assert.deepEqual(request['output_schema'], JSON.parse(JSON.stringify(Persona.output)))
  assert.equal(request['budget_usd'], 5)
})

test('triage returns the bounded actions of DESIGN 7.2', () => {
  const text = Persona.triage(mix)
  for (const action of ['approve', 'adopt', 'merge', 'reject', 'grant', 'restate'].map((kind) => '"kind": "' + kind + '"')) assert.ok(text.includes(action), action)
  assert.ok(text.includes('at most a quarter of it in one triage run'))
  assert.ok(text.includes(Persona.money))
})

