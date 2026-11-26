import type * as M1 from '../run.ts'
import type * as M2 from '../dispatch.ts'
import type * as Credit from '../../src/shared/Credit.ts'
import type * as M3 from '../../src/shared/Credit.ts'
import type * as Setup from '../../src/shared/Setup.ts'
import type * as M4 from '../../src/shared/Setup.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as RunnerModule from '../../src/worker/Runner.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function riders(seed: string): Promise<Outcome> {
  const random = rng('riders', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const { world } = await load<typeof M1>('test/run.ts')
  const { github } = await load<typeof M2>('test/dispatch.ts')
  const Credit = await load<typeof M3>('src/shared/Credit.ts')
  const Setup = await load<typeof M4>('src/shared/Setup.ts')

  const Operations = await load<typeof OperationsModule>('src/worker/Operations.ts')
  const Runner = await load<typeof RunnerModule>('src/worker/Runner.ts')

  Runner.timing.pollMs = 10
  Runner.timing.listMs = 0
  Runner.timing.streamDownMs = 10

  const owner = '0x00000000000000000000000000000000000000ee'
  const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
  const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

  function setup() {
    const deposits = new Map<string, { amount: string; from: string; tag: string }>()
    const w = world(async (request, url) => {
      if (url.pathname === '/v1/models')
        return Response.json({
          data: [Setup.flash, Setup.glmFlash, Setup.fable, Setup.sol, 'vercel/google/gemini-3.8-flash'].map((id) => ({
            id,
            kind: 'generate',
            pricing: { cached: 0.01, input: 0.1, output: 0.4 },
          })),
        })
      if (url.pathname === '/api/keys/me') return Response.json({ wallet: owner })
      if (url.pathname === '/api/keys/credit' && request.method === 'POST') {
        const { hash } = (await request.json()) as { hash: string }
        const found = deposits.get(hash)
        if (!found) return Response.json({ error: 'no receipt' }, { status: 404 })
        return Response.json({
          created: true,
          credit: { deposited: found.amount, left: found.amount, spent: '0' },
          deposits: [{ ...found, log: 0, token: 'pathusd' }],
        })
      }
      if (url.pathname === '/api/keys/credit') {
        const total = [...deposits.values()].reduce((sum, one) => sum + Number(one.amount), 0)
        return Response.json({ deposited: String(total), left: String(total), spent: '0' })
      }
      if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_d' })
      if (url.pathname.startsWith('/v1/agents/agt_d'))
        return Response.json(url.pathname.endsWith('/subagents') ? { agents: [] } : { request_id: 'x', status: 'queued' })
      return undefined
    })
    ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
    github(w.env)
    return { deposits, w }
  }

  async function tree(w: ReturnType<typeof world>, reviewed = false) {
    const made = await Operations.create(
      w.env,
      {
        form: 'tree',
        goal: 'Settle whether P equals NP, checked in Lean.',
        seed: [
          { form: 'program', key: 'lower', title: 'Lower bounds' },
          { form: 'lemma', key: 'switch', parent: 'lower', statement: 'True', title: 'Switching lemma' },
          { form: 'lemma', key: 'parity', needs: ['switch'], parent: 'lower', statement: 'True ∧ True', title: 'Parity is not in AC0' },
        ],
        statement: 'P = NP ∨ P ≠ NP',
        reviewed,
        template: 'cheap',
        title: 'P vs NP',
      },
      ana,
    )
    a.ok(made.ok, JSON.stringify(made))
    return made.value.id
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      "a rider's profile lists the swarms they rode with their dollars and the items they created or rode",
      async (t) => {
        const { deposits, w } = setup()
        t.after(async () => {
          await Runner.stop(w.swarm)
          w.restore()
        })
        const id = await tree(w)
        const shown = await Operations.tree(w.env, { swarm: id })
        a.ok(shown.ok)
        const lemma = shown.value.nodes.find((node) => node.title === 'Switching lemma')?.id ?? ''
        const pay = async (hash: string, from: string, amount: string, node: string) => {
          deposits.set(hash, { amount, from, tag: Credit.tag(id, 'n:' + node) })
          const counted = await Operations.contribute(w.env, { hash, node, swarm: id })
          a.ok(counted.ok, JSON.stringify(counted))
        }
        await pay('0x' + '1'.repeat(64), ana, '2', lemma)
        await pay('0x' + '2'.repeat(64), bo, '3', 'root')
        const proposed = await Operations.propose(
          w.env,
          { parent: lemma, spec: 'Use restrictions.', swarm: id, title: 'Restrictions', token: 'pathusd' },
          'https://swarms.test',
          ana,
        )
        a.ok(proposed.ok, JSON.stringify(proposed))
        await pay('0x' + '3'.repeat(64), ana, '1.5', proposed.value.nid)
        a.ok((await Operations.rename(w.env, { name: 'ana' }, ana)).ok)

        const named = await Operations.rider(w.env, { who: '@Ana' })
        a.ok(named.ok, JSON.stringify(named))
        a.deepEqual([named.value.rider.address, named.value.rider.handle, named.value.ridden], [ana, 'ana', '3.500000'])
        a.deepEqual(
          named.value.swarms.map((one) => [one.id, one.title, one.ridden, one.riders, one.started]),
          [[id, 'P vs NP', '3.500000', 2, true]],
        )
        a.deepEqual(
          named.value.items.map((item) => [item.title, item.ridden, item.created]),
          [
            ['Switching lemma', '2.000000', false],
            ['Restrictions', '1.500000', true],
          ],
        )

        const by = await Operations.rider(w.env, { who: bo })
        a.ok(by.ok)
        a.deepEqual([by.value.ridden, by.value.swarms.map((one) => [one.ridden, one.started]), by.value.items], ['3.000000', [['3.000000', false]], []])

        const nobody = await Operations.rider(w.env, { who: 'nobody' })
        a.deepEqual([nobody.ok, !nobody.ok && nobody.status], [false, 404])
        const stranger = await Operations.rider(w.env, { who: '0x' + 'c'.repeat(40) })
        a.ok(stranger.ok)
        a.deepEqual([stranger.value.ridden, stranger.value.swarms, stranger.value.items], ['0.000000', [], []])
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { riders }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'riders.operations',
      'src/worker/Operations.ts',
      "return Memo.units(typeof value === 'number' ? value.toFixed(6) : value)",
      "return Memo.units(typeof value !== 'number' ? value.toFixed(6) : value)",
    ),
    invariant: "a rider's profile lists the swarms they rode with their dollars and the items they created or rode",
    name: 'riders.operations',
    scenario: 'riders',
    seeds: ['1', '2', '3'],
  },
]
