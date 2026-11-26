import { registerHooks } from 'node:module'
import type * as Setup from '../../src/shared/Setup.ts'
import type * as M1 from '../../src/shared/Setup.ts'
import type * as PersonaModule from '../../src/worker/Persona.ts'
import type * as TurnsModule from '../../src/worker/Turns.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function instructions(seed: string): Promise<Outcome> {
  const random = rng('instructions', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const Setup = await load<typeof M1>('src/shared/Setup.ts')
  await load('test/host.ts')

  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'cloudflare:workers'
        ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' }
        : next(specifier, context),
  })

  const Persona = await load<typeof PersonaModule>('src/worker/Persona.ts')
  const Turns = await load<typeof TurnsModule>('src/worker/Turns.ts')

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
    a.notEqual(typeof resolved, 'string')
    const setup = Setup.priced(resolved as Exclude<typeof resolved, string>, prices)
    a.notEqual(typeof setup, 'string')
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

  const lemma = {
    form: 'lemma',
    nid: '2f7a140626',
    spec: 'Majority vote is not a SAT algorithm\n\nA checked counterexample.',
    statement: '∃ φ : CNF, φ.Satisfiable ∧ φ.eval (majorityAssignment φ) = false',
    title: 'Majority vote is not a SAT algorithm',
  }

  const context = {
    ancestors: ['Does P = NP?', 'Upper bounds: toward P = NP'],
    failures: ['axioms outside the allowlist: [sorryAx]'],
    siblings: ['2-SAT is in P: progress, implication graph built'],
    steers: ['[$4 behind this, from @ana] Try three variables.'],
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      "a swarm's instructions name its template's models and every section",
      async (_t) => {
        const text = Persona.render(mix)
        for (const heading of [
          '# The work',
          '# Models',
          '# Tools and services',
          '# Wishlist',
          '# Money behind every request',
          '# Branches',
          '# Artifacts',
          '# Autoresearch',
        ])
          a.ok(text.includes(heading + (heading === '# Autoresearch' ? ' (' : '\n')), heading)
        a.ok(text.includes(Setup.told(mix)))
        a.ok(text.includes('A spawn with any other model is refused'))
        a.ok(!text.includes('Your first message names'))
        a.ok(Persona.render(null).includes('Your first message names'))
        a.ok(text.length < 32_768)
      },
    ],
    [
      'a swarm keeps the instructions its lead first got, whatever the template says later',
      async (_t) => {
        const kv = store([['personaSet', 'abc']])
        a.equal(Persona.frozen(kv as never, mix), Persona.render(mix))
        a.equal(kv.get('instructions'), undefined)
        Persona.keep(kv as never, 'an older text')
        a.equal(kv.get('personaSet'), undefined)
        a.equal(Persona.frozen(kv as never, mix), 'an older text')
        a.equal(Persona.frozen(kv as never, null), 'an older text')
      },
    ],
    [
      "a new lead is created with the swarm's own instructions and no persona",
      async (_t) => {
        const kv = store([['secret', 's'.repeat(64)]])
        const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_new' }))
        const lead = await Turns.lead(self, row)
        a.ok(!('error' in lead))
        a.equal(lead.instructed, true)
        const created = sent.find((request) => request.path === '/v1/agents')
        const body = created?.body as Record<string, unknown>
        a.equal(body['instructions'], Persona.render(mix))
        a.equal(body['persona'], undefined)
        a.equal(body['payer'], 'backers')
        a.equal(body['model'], Setup.opus)
        a.ok(!sent.some((request) => request.path.startsWith('/v1/personas')))
        a.equal(kv.get('instructions'), Persona.render(mix))
      },
    ],
    [
      'a lead re-created later gets the text the swarm froze, not a newer one',
      async (_t) => {
        const kv = store([
          ['instructions', 'the text frozen at creation'],
          ['secret', 's'.repeat(64)],
        ])
        const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_again' }))
        await Turns.lead(self, row)
        a.equal((sent.find((request) => request.path === '/v1/agents')?.body as Record<string, unknown>)['instructions'], 'the text frozen at creation')
      },
    ],
    [
      "a lead that still has a payer route is moved to the swarm's backers once",
      async (_t) => {
        const url = 'https://swarms.test/api/swarms/abc123def456/pay'
        const kv = store([['agent', { briefed: true, cursor: 7, id: 'agt_old', instructed: true, url }]])
        const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_old' }))
        const lead = await Turns.lead(self, row)
        a.ok(!('error' in lead))
        a.equal(lead.url, 'backers')
        a.deepEqual(sent, [{ body: { payer: 'backers' }, method: 'PATCH', path: '/v1/agents/agt_old' }])
        await Turns.lead(self, row)
        a.equal(sent.length, 1)
      },
    ],
    [
      'a lead on the shared persona gets the frozen text once, on its next turn, and the shared persona is never set',
      async (_t) => {
        const url = 'backers'
        const kv = store([
          ['agent', { briefed: true, cursor: 7, id: 'agt_old', persona: true, url }],
          ['secret', 's'.repeat(64)],
        ])
        const { self, sent } = swarm(kv, () => Response.json({ id: 'agt_old' }))
        const lead = await Turns.lead(self, row)
        a.ok(!('error' in lead))
        a.equal(lead.instructed, true)
        a.deepEqual(sent, [{ body: { instructions: Persona.render(mix) }, method: 'PATCH', path: '/v1/agents/agt_old' }])
        await Turns.lead(self, row)
        a.equal(sent.length, 1)
        a.equal(kv.get('instructions'), Persona.render(mix))
      },
    ],
    [
      'a lead whose instructions the gateway refuses to give tries again next turn',
      async (_t) => {
        const url = 'backers'
        const kv = store([
          ['agent', { briefed: true, cursor: 7, id: 'agt_old', persona: true, url }],
          ['secret', 's'.repeat(64)],
        ])
        const { self, sent } = swarm(kv, () => Response.json({ detail: 'down' }, { status: 503 }))
        const lead = await Turns.lead(self, row)
        a.ok(!('error' in lead))
        a.notEqual(lead.instructed, true)
        await Turns.lead(self, row)
        a.equal(sent.length, 2)
        a.equal(kv.get('instructions'), undefined)
      },
    ],
    [
      "a node worker's task is the frozen rules, then the node's own words and context",
      async (_t) => {
        const text = Persona.node(mix, lemma, context)
        for (const heading of [
          '# How a node is worked',
          '# Think on paper first',
          '# Lean decides what is proven',
          '# Git',
          '# Split rather than sprawl',
          '# Keep every dead end, with why',
          '# Money behind every note',
          '# Models',
          '# What you return',
          '# Your node',
        ])
          a.ok(text.includes(heading + '\n'), heading)
        a.ok(!text.includes('<nid>'))
        a.ok(text.includes('node/2f7a140626'))
        a.ok(text.includes('theorem Pnp.N2f7a140626'))
        a.ok(text.includes('Pnp/Proofs/N2f7a140626.lean'))
        a.ok(text.includes('git merge --no-ff node/2f7a140626'))
        a.ok(text.includes('Never delete or force-push a branch'))
        a.ok(text.includes('anything in Pnp/Statements/'))
        a.ok(text.includes('propext, Classical.choice and Quot.sound'))
        a.ok(text.includes('{ outcome, summary, commit, theorem, children, why }'))
        a.ok(text.includes('"[$4 behind this, from @ana]"'))
        a.ok(text.includes(Setup.told(mix)))
        a.ok(text.includes(lemma.spec))
        const order = [
          '# Your node',
          '# Notes from riders, heed these first',
          '# Where it sits (root first)',
          '# What its siblings found',
          '# Why earlier attempts failed',
        ].map((heading) => text.indexOf(heading))
        a.deepEqual(
          [...order].sort((a, b) => a - b),
          order,
        )
        a.ok(order.every((at) => at > 0))
        a.ok(text.includes('- [$4 behind this, from @ana] Try three variables.'))
        a.ok(text.length < 32_768)
      },
    ],
    [
      'a node worker gets the rules its swarm froze, and only the sections that have something in them',
      async (_t) => {
        const text = Persona.node(
          null,
          { ...lemma, form: 'program', statement: null },
          { ancestors: [], failures: [], siblings: [], steers: [] },
          'Frozen for <nid>.',
        )
        a.ok(text.startsWith('Frozen for 2f7a140626.\n'))
        a.ok(text.includes('This node has no Lean statement'))
        for (const heading of ['# Notes from riders', '# Where it sits', '# What its siblings found', '# Why earlier attempts failed'])
          a.ok(!text.includes(heading), heading)
        a.ok(!Persona.rules(null).includes('# Models'))
        a.equal(Persona.node(mix, lemma, context, Persona.rules(mix)), Persona.node(mix, lemma, context))
      },
    ],
    [
      'a run returns the output schema of DESIGN 6.3',
      async (_t) => {
        a.deepEqual([...Persona.output.required], ['outcome', 'summary', 'commit', 'theorem', 'children', 'why'])
        a.deepEqual([...Persona.output.properties.outcome.enum], ['proved', 'refuted', 'split', 'progress', 'stuck'])
        a.deepEqual([...Persona.output.properties.children.items.required], ['title', 'spec', 'statement', 'needs'])
      },
    ],
    [
      'the dispatcher spawns exactly the subagent it is given and nothing else',
      async (_t) => {
        const text = Persona.dispatcher()
        a.ok(text.includes('call spawn_agent exactly once with exactly those arguments, copied unchanged'))
        a.ok(text.includes('never spawn a subagent nobody asked for'))
        a.ok(text.includes('never change the budget or the model'))
        a.ok(!text.includes('Pnp'))
        const request = JSON.parse(
          Persona.spawn({ budget_usd: 5, harness: 'claude', model: Setup.flash, role: 'n:2f7a140626#1', task: Persona.node(mix, lemma, context) }),
        ) as Record<string, unknown>
        a.deepEqual(Object.keys(request).sort(), ['budget_usd', 'harness', 'model', 'output_schema', 'role', 'task'])
        a.deepEqual(request['output_schema'], JSON.parse(JSON.stringify(Persona.output)))
        a.equal(request['budget_usd'], 5)
      },
    ],
    [
      'triage returns the bounded actions of DESIGN 7.2',
      async (_t) => {
        const text = Persona.triage(mix)
        for (const action of ['approve', 'adopt', 'merge', 'reject', 'grant', 'restate'].map((kind) => '"kind": "' + kind + '"'))
          a.ok(text.includes(action), action)
        a.ok(text.includes('at most a quarter of it in one triage run'))
        a.ok(text.includes(Persona.money))
      },
    ],
  ]
  for (const [dstName, dstRun] of [...dstCases].sort(() => random.next() - 0.5)) {
    a.as(dstName)
    try {
      await dstRun({ after: (fn) => void afters.push(fn) })
    } catch (error) {
      fail(dstName, String((error as Error)?.stack ?? error).slice(0, 400))
    } finally {
      for (const fn of afters.splice(0).reverse()) await fn()
    }
  }
  return { steps: steps() + checked, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { instructions }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'instructions.turns',
      'src/worker/Turns.ts',
      'if (!patched.ok && patched.status !== Limits.Http.conflict) {',
      'if (!patched.ok && patched.status === Limits.Http.conflict) {',
    ),
    invariant: 'a lead whose instructions the gateway refuses to give tries again next turn',
    name: 'instructions.turns',
    scenario: 'instructions',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant('instructions.setup', 'src/shared/Setup.ts', "if (choice.template !== 'custom') {", "if (choice.template === 'custom') {"),
    invariant: 'check',
    name: 'instructions.setup',
    scenario: 'instructions',
    seeds: ['1', '2', '3'],
  },
]
