import { registerHooks } from 'node:module'
import type * as M1 from '../board.ts'
import type * as BranchingModule from '../../src/worker/Branching.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as StoreModule from '../../src/worker/Store.ts'
import type * as Credit from '../../src/shared/Credit.ts'
import type * as M2 from '../../src/shared/Credit.ts'
import type * as M3 from '../d1.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function funding(seed: string): Promise<Outcome> {
  const random = rng('funding', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const { fresh } = await load<typeof M1>('test/board.ts')
  const Credit = await load<typeof M2>('src/shared/Credit.ts')
  const { open } = await load<typeof M3>('test/d1.ts')
  await load('test/host.ts')

  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'cloudflare:workers'
        ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' }
        : next(specifier, context),
  })

  const Operations = await load<typeof OperationsModule>('src/worker/Operations.ts')
  const Branching = await load<typeof BranchingModule>('src/worker/Branching.ts')
  const Store = await load<typeof StoreModule>('src/worker/Store.ts')
  const { Swarm } = await import('../../src/worker/Swarm.ts')

  const id = 'abc123abc123'
  const rider = '0x00000000000000000000000000000000000000a1'
  const owner = '0x00000000000000000000000000000000000000ee'

  type Listed = { agent_id: number; budget_usd?: number; parent_agent_id: null; role: string; spent_usd?: number; status: { state: string }; task: string }

  function world(gateway: (path: string, body: unknown) => unknown = () => ({}), listed: Listed[] = []) {
    const db = open()
    db.sqlite
      .prepare(
        "insert into swarms (id, title, goal, status, rounds, hidden, created_at, updated_at) values (?, 'Swarm', 'The goal of the swarm', 'paused', 0, 0, 1, 1)",
      )
      .run(id)
    db.sqlite.prepare("insert into names (address, name, updated_at) values (?, 'ada', 1)").run(rider)
    const calls: [string, ...unknown[]][] = []
    const said =
      (name: string) =>
      async (...args: unknown[]) => (calls.push([name, ...args]), { ok: true, value: null })
    const self = {
      agent: () => ({ id: 'agt' }),
      board: fresh('swarm:test'),
      changed: () => undefined,
      get env() {
        return env
      },
      log: () => undefined,
      touch: () => undefined,
    }
    const object = {
      contributed: said('contributed'),
      direct: (...args: Parameters<InstanceType<typeof Swarm>['direct']>) => Swarm.prototype.direct.apply(self as never, args),
      subagents: async () => ({ ok: true, value: { agent: 'agt', list: listed } }),
      voice: said('voice'),
      funded: said('funded'),
      settle: (input: StoreModule.Settlement) => Branching.settle(self as never, input),
      wake: said('wake'),
    }
    const env: Cloudflare.Env = {
      ...db.env,
      GATEWAY: {
        fetch: async (request: Request) => {
          const path = new URL(request.url).pathname
          const answer = path === '/api/keys/me' ? { wallet: owner } : gateway(path, request.method === 'POST' ? await request.json() : undefined)
          return answer instanceof Response ? answer : Response.json(answer)
        },
      },
      GATEWAY_URL: 'https://gateway.test',
      SWARMS: { get: () => object, idFromName: (name: string) => name },
      SWARMS_GATEWAY_KEY: 'test',
      SWARMS_URL: 'https://swarms.test',
    } as unknown as Cloudflare.Env
    const member = async () => {
      const found = (await Store.members(env, id)).find((each) => each.address === rider)
      return [found?.backed, found?.steered, found?.available]
    }
    return { calls, db, env, member }
  }

  async function funded(env: Cloudflare.Env, branch: number, amount: bigint) {
    await Store.give(env, { amount: String(amount), channel: null, contributor: rider, id: '0xfeed', note: null, note_id: null, swarm: id, token: 'ousd' })
    a.equal(
      await Store.steer(env, {
        amount,
        branch: { agent: 'agt', id: branch },
        contributor: rider,
        id: 'f1',
        note: `branch ${branch}`,
        note_id: `branch:${branch}`,
        swarm: id,
      }),
      true,
    )
  }

  const closed: Listed = { agent_id: 1, budget_usd: 5, parent_agent_id: null, role: 'tester', spent_usd: 2, status: { state: 'closed' }, task: 'Test it' }
  const running: Listed = { agent_id: 2, budget_usd: 1, parent_agent_id: null, role: 'writer', spent_usd: 0, status: { state: 'running' }, task: 'Write it' }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'a branch the lead closed is settled when the gateway lists it, and looked for again at the next turn end until it does',
      async (_t) => {
        let listing = false
        const { db, env, member } = world(() => (listing ? { agents: [closed, running] } : new Response('down', { status: 503 })))
        await funded(env, 1, 3_000_000n)
        const kv = new Map<string, unknown>()
        const self = {
          agent: () => ({ id: 'agt' }),
          board: fresh('swarm:test'),
          env,
          kv: { get: (key: string) => kv.get(key), put: (key: string, value: unknown) => void kv.set(key, value) },
        } as never
        const row = { id } as never

        await Branching.settled(self, row)
        a.equal(kv.get('settledAt'), undefined)
        a.deepEqual(await member(), ['3.000000', '3.000000', '0.000000'])

        listing = true
        await Branching.settled(self, row)
        a.equal(typeof kv.get('settledAt'), 'number')
        a.deepEqual(await member(), ['3.000000', '0.000000', '3.000000'])
        a.equal(db.sqlite.prepare('select count(*) as n from branches where settled_at is not null').get()?.['n'], 1)
      },
    ],
    [
      "a branch is settled once on the swarm's board: a settle whose write failed is released and the next one writes it, and later ones return nothing",
      async (_t) => {
        const { db, env, member } = world()
        await funded(env, 1, 3_000_000n)
        const board = fresh('swarm:test')
        const self = { board, env } as never
        const input = { agent: 'agt', branch: 1, left: null, swarm: id }
        const batch = env.DB.batch.bind(env.DB)
        ;(env.DB as { batch: unknown }).batch = async () => Promise.reject(new Error('D1 is down'))
        await a.rejects(Branching.settle(self, input), /D1 is down/)
        a.equal((await board.task('settle:agt:1'))?.phase, 'open')
        ;(env.DB as { batch: unknown }).batch = batch

        a.deepEqual(await Branching.settle(self, input), [{ amount: 3_000_000n, budget: 0, contributor: rider }])
        a.equal((await board.task('settle:agt:1'))?.phase, 'done')
        a.deepEqual(await Promise.all([Branching.settle(self, input), Branching.settle(self, { ...input, left: 0n })]), [[], []])
        a.deepEqual(await member(), ['3.000000', '0.000000', '3.000000'])
        a.equal(db.sqlite.prepare("select count(*) as n from steers where id like 'settle:agt:1:%'").get()?.['n'], 1)
      },
    ],
    [
      'money behind a branch the lead closed goes back to its riders before a move from it or a stop is refused',
      async (_t) => {
        const { calls, env, member } = world(undefined, [closed, running])
        await funded(env, 1, 3_000_000n)
        const moved = await Operations.move(env, { amount: '1', branch: 1, swarm: id, to: 2 }, rider)
        a.deepEqual([moved.ok, moved.ok ? null : moved.status], [false, 409])
        a.deepEqual(await member(), ['3.000000', '0.000000', '3.000000'])
        a.deepEqual(
          calls.map(([name, , text]) => [name, text]),
          [['voice', '$3 that tester had not spent went back to its backers, to put behind something else.']],
        )

        const stopped = await Operations.stop(env, { branch: 1, swarm: id }, rider)
        a.deepEqual([stopped.ok, stopped.ok ? null : stopped.status], [false, 409])
        a.equal(calls.length, 1)
        a.deepEqual(await member(), ['3.000000', '0.000000', '3.000000'])
      },
    ],
    [
      "a fund the branch could not be told about is undone and the budget set from what is still behind the branch, another rider's fund included",
      async (_t) => {
        const other = '0x00000000000000000000000000000000000000b2'
        const budgets: unknown[] = []
        const { env, member } = world(
          (path, body) => {
            if (path.endsWith('/messages')) return new Response('down', { status: 503 })
            if (path.endsWith('/budget')) budgets.push((body as { budget_usd: number }).budget_usd)
            return { agent: { ...running, agent_id: 2 } }
          },
          [closed, { ...running, budget_usd: 5 }],
        )
        await Store.give(env, { amount: '2000000', channel: null, contributor: rider, id: '0xfeed', note: null, note_id: null, swarm: id, token: 'ousd' })
        await Store.give(env, { amount: '1000000', channel: null, contributor: other, id: '0xbeef', note: null, note_id: null, swarm: id, token: 'ousd' })
        await Store.base(env, id, 'agt', 2, 5_000_000n)
        a.equal(
          await Store.steer(env, {
            amount: 1_000_000n,
            branch: { agent: 'agt', id: 2 },
            contributor: other,
            id: 'f2',
            note: 'branch 2',
            note_id: 'branch:2',
            swarm: id,
          }),
          true,
        )

        const refused = await Operations.fund(env, { amount: '2', branch: 2, message: 'Write the proof first', swarm: id }, rider)
        a.deepEqual([refused.ok, refused.ok ? null : refused.status], [false, 502])
        a.deepEqual(budgets, [8, 6])
        a.deepEqual(await member(), ['2.000000', '0.000000', '2.000000'])
        a.equal((await Store.funds(env, id, 'agt')).shares.get(2)?.get(other), 1_000_000n)
      },
    ],
    [
      'a transfer already counted is refused, and still wakes a swarm that missed it; its note is refused once its money is behind something else',
      async (_t) => {
        const hash = '0x' + 'ab'.repeat(32)
        const { calls, env, member } = world((path) =>
          path === '/api/keys/credit'
            ? { created: true, credit: {}, deposits: [{ amount: '10', from: rider, log: 0, tag: Credit.tag(id, 'idea two'), token: 'ousd' }] }
            : {},
        )
        const first = await Operations.contribute(env, { hash, swarm: id })
        a.deepEqual([first.ok && first.value.created, calls.map(([name]) => name)], [true, ['contributed']])

        const repeated = await Operations.contribute(env, { hash, swarm: id })
        a.deepEqual([repeated.ok, repeated.ok ? null : repeated.status, calls.slice(1)], [false, 409, [['funded', id]]])

        a.equal(await Store.steer(env, { amount: 10_000_000n, contributor: rider, id: 's1', note: 'idea one', note_id: 'n1', swarm: id }), true)
        const noted = await Operations.contribute(env, { hash, note: 'idea two', swarm: id })
        a.deepEqual(
          [noted.ok, noted.ok ? null : noted.detail, calls.slice(2)],
          [false, 'This transaction is already counted, and its money is already behind another idea or a branch.', [['funded', id]]],
        )
        a.deepEqual(await member(), ['10.000000', '10.000000', '0.000000'])
      },
    ],
    [
      'a transfer Swarms recovered from the gateway while its page was counting it keeps the note the page sent',
      async (_t) => {
        const hash = '0x' + 'cd'.repeat(32)
        const recovered: { db?: ReturnType<typeof open> } = {}
        const { calls, db, env } = world((path) => {
          if (path !== '/api/keys/credit') return {}
          recovered.db?.sqlite
            .prepare(
              "insert into contributions (id, swarm, channel, contributor, token, amount, note, note_id, created_at) values (?, ?, null, ?, 'ousd', '10000000', null, null, 1)",
            )
            .run(hash, id, rider)
          return { created: false, credit: {}, deposits: [{ amount: '10', from: rider, log: 0, tag: Credit.tag(id, 'idea two'), token: 'ousd' }] }
        })
        recovered.db = db
        const raced = await Operations.contribute(env, { hash, note: 'idea two', swarm: id })
        a.ok(raced.ok)
        a.deepEqual([raced.value.created, raced.value.contributed.contribution.note], [false, 'idea two'])
        a.deepEqual(
          calls.map(([name, input]) => [name, (input as { kind?: string }).kind]),
          [['contributed', 'noted']],
        )
      },
    ],
    [
      'a swarm told of money wakes before it logs and announces it, so a failed announcement leaves it awake',
      async (_t) => {
        const woken: string[] = []
        const self = {
          env: { DB: { prepare: () => ({ bind: () => ({ first: async () => Promise.reject(new Error('D1 is down')) }) }) } },
          kv: { put: () => undefined },
          log: () => undefined,
          marked: 0,
          wake: async (reason: string) => void woken.push(reason),
        }
        const input = { amount: '5', contributor: rider, hash: '0x' + 'ab'.repeat(32), note: null, noteId: null, swarm: id, token: 'ousd' } as const
        await a.rejects(Swarm.prototype.contributed.call(self as never, { ...input, kind: 'new' }), /D1 is down/)
        await a.rejects(Swarm.prototype.contributed.call(self as never, { ...input, kind: 'noted', note: 'idea', noteId: 'n1' }), /D1 is down/)
        a.deepEqual(woken, ['money', 'money'])
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { funding }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant('funding.store', 'src/worker/Store.ts', 'if (!known.has(id) && missed(id)) return null', 'if (!known.has(id) || missed(id)) return null'),
    invariant: 'a transfer Swarms recovered from the gateway while its page was counting it keeps the note the page sent',
    name: 'funding.store',
    scenario: 'funding',
    seeds: ['1', '2', '3'],
  },
  {
    flip: mutant(
      'funding.branching',
      'src/worker/Branching.ts',
      "const closed = listed.value.filter((found) => found.parent_agent_id === null && found.status.state === 'closed')",
      "const closed = listed.value.filter((found) => found.parent_agent_id !== null && found.status.state === 'closed')",
    ),
    invariant: 'a branch the lead closed is settled when the gateway lists it, and looked for again at the next turn end until it does',
    name: 'funding.branching',
    scenario: 'funding',
    seeds: ['1', '2', '3'],
  },
]
