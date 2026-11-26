import type * as M1 from '../dispatch.ts'
import type * as NodesModule from '../../src/worker/Nodes.ts'
import type * as RunnerModule from '../../src/worker/Runner.ts'
import type * as TriageModule from '../../src/worker/Triage.ts'
import type * as FlowModule from '../../src/worker/Flow.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function triage(seed: string): Promise<Outcome> {
  const random = rng('triage', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const { ana, bo, gateway, id, planted, until } = await load<typeof M1>('test/dispatch.ts')

  const Nodes = await load<typeof NodesModule>('src/worker/Nodes.ts')
  const Runner = await load<typeof RunnerModule>('src/worker/Runner.ts')
  const Triage = await load<typeof TriageModule>('src/worker/Triage.ts')
  const Flow = await load<typeof FlowModule>('src/worker/Flow.ts')

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'triage actions parse strictly and drop anything malformed',
      async (_t) => {
        const actions = Triage.parse(
          JSON.stringify({
            actions: [
              { kind: 'approve', node: 'abc', weight: 42 },
              { kind: 'grant', node: 'abc', amount: '-1' },
              { kind: 'explode' },
              { into: 'abc', kind: 'merge', node: 'abc' },
              { kind: 'restate', node: 'abc', statement: 'True' },
            ],
          }),
        )
        a.deepEqual(actions, [
          { kind: 'approve', node: 'abc', weight: 10 },
          { kind: 'restate', node: 'abc', statement: 'True' },
        ])
        a.deepEqual(Triage.parse('no json'), [])
      },
    ],
    [
      'triage runs on its share of the root when there is something new, and its bounded actions apply',
      async (t) => {
        const g = gateway()
        const w = await planted(g.route, 0.05)
        t.after(async () => {
          await Runner.stop(w.swarm)
          w.restore()
        })
        const proposal = await Nodes.post(w.swarm, { by: bo, form: 'lemma', needs: [], parent: 'root', statement: 'True', title: 'A rider idea', words: '' })
        await w.env.DB.prepare("insert into ideas (id, swarm, parent, author, text, created_at) values ('i1', ?, 'root', ?, 'Try the other way', ?)")
          .bind(id, ana, Date.now())
          .run()
        await w.swarm.treePledge(id, { amount: '100', contributor: ana, hash: '0x' + '1'.repeat(64), nid: null })
        await until(() => g.subs.length === 1)
        const run = g.subs[0]
        a.equal(run?.role, 'n:triage#1')
        a.equal(run?.budget_usd, 5)
        a.match(run?.task ?? '', /A rider idea/)
        a.match(run?.task ?? '', /Try the other way/)
        run!.spent_usd = 0.2
        run!.status = {
          output: {
            actions: [
              { kind: 'approve', node: proposal.nid, weight: 3 },
              { idea: 'i1', kind: 'adopt', spec: 'From a rider.', statement: null, title: 'Adopted idea' },
              { amount: '30', kind: 'grant', node: proposal.nid },
              { amount: '10', kind: 'grant', node: proposal.nid },
            ],
          },
          state: 'completed',
        }
        Runner.wake(w.swarm)
        await until(() => g.subs.some((sub) => sub.role === 'n:' + proposal.nid + '#1'))
        const done = await w.swarm.board.task('r:triage:1')
        const applied = JSON.parse(done?.outcome && 'done' in done.outcome ? done.outcome.done : '{}') as { actions: { ok: boolean }[] }
        a.deepEqual(
          applied.actions.map((one) => one.ok),
          [true, true, false, true],
        )
        const view = await w.swarm.treeRead(id, { depth: 3, root: 'root', status: undefined })
        a.ok(view.ok)
        const adopted = view.value.nodes.find((node) => node.title === 'Adopted idea')
        a.equal(adopted?.by.address, ana)
        const ledger = Flow.fold(await Flow.rows(w.env, id))
        a.equal(ledger.inherited.get(proposal.nid), 10_000_000n)
        a.equal(ledger.spent.get('triage'), 200_000n)
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { triage }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('triage.flow', 'src/worker/Flow.ts', 'if (want <= 0n || total === 0n) return []', 'if (want <= 0n || total !== 0n) return []'),
    invariant: 'triage runs on its share of the root when there is something new, and its bounded actions apply',
    name: 'triage.flow',
    scenario: 'triage',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'triage.triage',
      'src/worker/Triage.ts',
      "return typeof value === 'string' && value.trim() ? clip(value.trim(), most) : null",
      "return typeof value !== 'string' && value.trim() ? clip(value.trim(), most) : null",
    ),
    invariant: 'triage runs on its share of the root when there is something new, and its bounded actions apply',
    name: 'triage.triage',
    scenario: 'triage',
    seeds: ['1', '2', '3'],
  },
]
