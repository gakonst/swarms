import type * as BtwModule from '../../src/shared/Btw.ts'
import type * as M5 from '../run.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as PersonaModule from '../../src/worker/Persona.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

export const limits = { messageWords: 4_000, noteWords: 600, specWords: 1_500 }

const words = ['lemma', 'cache', 'proof', 'graph', 'bound', 'é', '中', '😀', 'try', 'the']

async function whole(seed: string): Promise<Outcome> {
  const random = rng('whole', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const Btw = await load<typeof BtwModule>('src/shared/Btw.ts')
  const { id, rider, world } = await load<typeof M5>('test/run.ts')
  const Operations = await load<typeof OperationsModule>('src/worker/Operations.ts')
  const Persona = await load<typeof PersonaModule>('src/worker/Persona.ts')
  const written = (count: number) => Array.from({ length: count }, () => random.pick(words)).join(' ')

  async function room(t: { after: (done: () => void | Promise<void>) => void }) {
    const w = world(() => undefined)
    ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
    t.after(() => w.restore())
    await w.seed()
    await w.env.DB.prepare('insert into names (address, name, updated_at) values (?, ?, 1)').bind(rider.toLowerCase(), 'ada').run()
    return w
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'a room message is stored and read back whole, however long',
      async (t) => {
        const w = await room(t)
        const text = written(limits.messageWords)
        const said = await Operations.say(w.env, { swarm: id, text }, rider)
        a.ok(said.ok, said.ok ? '' : said.detail)
        const read = await Operations.room(w.env, { swarm: id }, rider)
        a.ok(read.ok)
        a.ok(read.ok && read.value.messages.some((message) => message.text === text), 'the room holds the message whole')
      },
    ],
    [
      'a /btw collapse note keeps the whole first question',
      () => {
        const question = written(limits.noteWords)
        a.ok(Btw.note([{ answer: 'yes', question }]).endsWith(question), 'the note ends with the whole question')
        a.ok(Btw.note([{ answer: 'yes', question }], true).endsWith(question), 'the artifact note ends with the whole question')
      },
    ],
    [
      "an agent reads a node's whole spec and a swarm's whole goal",
      () => {
        const spec = written(limits.specWords)
        a.ok(Persona.pick({ budget: '1', models: [], nid: 'n1', notes: [], spec, title: 't' }).includes(spec), 'the model pick prompt holds the whole spec')
        const goal = written(limits.specWords)
        a.ok(Persona.about(goal).includes(goal), 'the about prompt holds the whole goal')
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { whole }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('whole.room', 'src/worker/Operations.ts', '    text: request.text,\n  })', '    text: request.text.slice(0, 1000),\n  })'),
    invariant: 'a room message is stored and read back whole, however long',
    name: 'whole.room',
    scenario: 'whole',
    seeds: ['1'],
  },
  {
    flip: mutant(
      'whole.btw',
      'src/shared/Btw.ts',
      'return `${asked ? requested : collapsed}: ${first}`',
      'return `${asked ? requested : collapsed}: ${first}`.slice(0, 280)',
    ),
    invariant: 'a /btw collapse note keeps the whole first question',
    name: 'whole.btw',
    scenario: 'whole',
    seeds: ['1'],
  },
  {
    flip: mutant('whole.spec', 'src/worker/Persona.ts', '    input.spec,\n', '    input.spec.slice(0, 2000),\n'),
    invariant: "an agent reads a node's whole spec and a swarm's whole goal",
    name: 'whole.spec',
    scenario: 'whole',
    seeds: ['1'],
  },
  {
    flip: mutant('whole.goal', 'src/worker/Persona.ts', '    goal,\n', '    goal.slice(0, 2000),\n'),
    invariant: "an agent reads a node's whole spec and a swarm's whole goal",
    name: 'whole.goal',
    scenario: 'whole',
    seeds: ['1'],
  },
]
