import { registerHooks } from 'node:module'
import type * as Phase from '../../src/worker/Phase.ts'
import type * as TurnsModule from '../../src/worker/Turns.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function turns(seed: string): Promise<Outcome> {
  const random = rng('turns', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  await load('test/host.ts')

  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'cloudflare:workers'
        ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' }
        : next(specifier, context),
  })

  const Turns = await load<typeof TurnsModule>('src/worker/Turns.ts')

  function left(usd: string) {
    return BigInt(Math.round(Number(usd) * 1_000_000))
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      "failed turns never stop the swarm: the board opens each again after its retry's backoff, doubling from 15 s, eight times before the agent is replaced",
      async (_t) => {
        const Work = await import('../../src/worker/Work.ts')
        a.deepEqual(
          [1, 2, 3, 4, 8].map((attempts) => Work.delay(Turns.retry, attempts)),
          [15_000, 30_000, 60_000, 120_000, 1_920_000],
        )
        a.equal(Turns.retry.maxAttempts, 8)
      },
    ],
    [
      'two turns in a row ending in a session reset replace the agent once, and the new agent is not replaced for the old one',
      async (_t) => {
        const said = 'The session was reset after its host crashed four times in a row while running a code cell.'
        a.ok(Turns.reset(said))
        a.ok(!Turns.reset('vercel failed upstream'))
        a.ok(!Turns.reset(null))
        const kv = new Map<string, unknown>()
        const turns = [
          { message: said, started_at: 20, status: 'failed' },
          { message: said, started_at: 10, status: 'failed' },
          { message: null, started_at: 5, status: 'completed' },
        ]
        const self = {
          ctx: {
            storage: {
              sql: {
                exec: (_query: string, since: number, limit: number) => ({ toArray: () => turns.filter((turn) => turn.started_at >= since).slice(0, limit) }),
              },
            },
          },
          kv: { get: (key: string) => kv.get(key) },
        } as never
        a.equal(Turns.resets(self), 2)
        a.equal(
          Turns.resets({
            ...(self as object),
            ctx: { storage: { sql: { exec: (_q: string, _s: number, limit: number) => ({ toArray: () => [turns[0], turns[2]].slice(0, limit) }) } } },
          } as never),
          1,
        )
        kv.set('renewedAt', 15)
        a.equal(Turns.resets(self), 1)
      },
    ],
    [
      "a turn the gateway refused because the swarm's credit ran out counts as out of money",
      async (_t) => {
        a.ok(
          Turns.broke(
            'Responses HTTPS request was rejected with HTTP 402: {"error":{"message":"This app\'s credit has $0 left and this request holds $0.002325. Send MACH"}}',
          ),
        )
        a.ok(!Turns.broke('vercel/openai/gpt-6-luna failed upstream at vercel with HTTP 402'))
        a.ok(Turns.broke('Boundless was not paid: fetch failed'))
        a.ok(!Turns.broke(null))
        a.ok(Turns.broke('Messages stream error api_error: Boundless was not paid: No method found for challenges: tempo.session'))
        a.ok(
          Turns.broke(
            'Messages HTTP 503: {"error":{"message":"Tempo Agents cannot pay the network fee to open your key\'s channel right now: its fee sponsor is out of funds.","type":"api_error"},"type":"error"}',
          ),
        )
        a.ok(
          Turns.sponsorless(
            "Messages HTTP 503: Tempo Agents cannot pay the network fee to open your key's channel right now: its fee sponsor is out of funds.",
          ),
        )
        a.ok(!Turns.sponsorless('Boundless was not paid: fetch failed'))
      },
    ],
    [
      "a refused payment's wake doubles from 10 minutes, but a fee-sponsor outage retries every 15 minutes at most",
      async (_t) => {
        a.deepEqual(
          [1, 2, 3, 8].map((attempts) => Turns.wakeIn(attempts, false) / 60_000),
          [10, 20, 40, 1280],
        )
        a.deepEqual(
          [1, 2, 3, 8, 50].map((attempts) => Turns.wakeIn(attempts, true) / 60_000),
          [10, 15, 15, 15, 15],
        )
      },
    ],
    [
      'a swarm paused for money reads its credit once its calls are over, and goes on when enough came back',
      async (_t) => {
        const now = Date.now()
        const swarm = (left: string, pause: Phase.Pause, at = now - 60_000, settled?: number) => {
          let run: Phase.Run = { at, pause, settled, state: 'paused' }
          const requests: string[] = []
          const self = {
            agent: () => undefined,
            beacon: () => undefined,
            env: {
              DB: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) },
              GATEWAY: {
                fetch: async (request: Request) => {
                  requests.push(new URL(request.url).pathname)
                  const path = new URL(request.url).pathname
                  if (path === '/api/keys/backings') return Response.json({ backings: [], left: '0', spent: '0' })
                  if (path === '/api/keys/credit/deposits') return Response.json({ deposits: [] })
                  return Response.json(path === '/api/keys/credit' ? { deposited: '1', left, spent: '0' } : { hands: [] })
                },
              },
              GATEWAY_URL: 'https://gateway.test',
              SWARMS_GATEWAY_KEY: 'test',
            },
            kv: { get: () => undefined, put: () => undefined },
            remember: () => undefined,
            run: () => run,
            set: (next: Phase.Run) => void (run = next),
          }
          return { requests, run: () => run, settle: () => Turns.settle(self as never, row, run as Phase.Paused) }
        }
        const row = {
          balance: 10_000_000,
          id: 'abc123abc123',
          machines: 0,
          pool_left: Number(left('0.03')),
          pool_spent: 0,
          setup: null,
          sponsor_left: 0,
          sponsor_spent: 0,
          spent: 0,
        } as never
        const pause = { left: '30000', wake: null, why: 'money' } as const

        const early = swarm('0.03', pause, now - 5_000)
        const waited = await early.settle()
        a.ok(waited !== null && waited >= now + 9_000 && waited <= now + 11_000)
        a.equal(early.requests.length, 0)

        const short = swarm('0.03', pause)
        a.equal(await short.settle(), null)
        a.ok(short.requests.includes('/api/keys/credit'))
        const settled = short.run()
        a.ok(settled.state === 'paused' && settled.settled !== undefined && settled.settled >= now)
        a.equal(await short.settle(), null)
        a.equal(short.requests.filter((path) => path === '/api/keys/credit').length, 1)

        const back = swarm('0.40', pause)
        a.equal(await back.settle(), null)
        a.equal(back.run().state, 'waiting')

        for (const balance of [undefined, '10000000']) {
          const refused = swarm('9.76', { balance, left: '9760000', needs: '440960', wake: null, why: 'money' })
          a.equal(await refused.settle(), now - 60_000 + 600_000)
          a.equal(refused.run().state, 'paused')
          const old = swarm('9.76', { balance, left: '9760000', needs: '440960', wake: null, why: 'money' }, now - 600_000)
          a.equal(await old.settle(), null)
          a.equal(old.run().state, 'waiting')
        }

        const ridden = swarm('9.76', { balance: '9000000', left: '9760000', needs: '440960', wake: null, why: 'money' })
        a.equal(await ridden.settle(), null)
        a.equal(ridden.run().state, 'waiting')

        const unfunded = swarm('5', { why: 'unfunded' }, now - 60_000, now - 60_000)
        a.equal(await unfunded.settle(), null)
        a.equal(unfunded.requests.length, 0)

        const later = swarm('0.03', pause, now - 3_600_000, now - 660_000)
        a.equal(await later.settle(), null)
        a.deepEqual(later.requests.sort(), ['/api/keys/backings', '/api/keys/credit', '/api/keys/credit/deposits'])
        const read = later.run()
        a.ok(read.state === 'paused' && read.settled !== undefined && read.settled >= now)

        const found = swarm('5', { why: 'unfunded' }, now - 3_600_000, now - 660_000)
        a.equal(await found.settle(), null)
        a.equal(found.run().state, 'waiting')
      },
    ],
    [
      "settledUsd reads the turn's settled spend from the gateway's turn report",
      async (_t) => {
        a.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: 0.092138, status: 'completed' }), 92138n)
        a.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: 0, status: 'completed' }), 0n)
        a.equal(Turns.settledUsd({ request_id: 'agt_1:10', status: 'completed' }), undefined)
        a.equal(Turns.settledUsd({ request_id: 'agt_1:10', spent_usd: -1, status: 'completed' }), undefined)
        a.equal(Turns.settledUsd(undefined), undefined)
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { turns }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'turns.turns',
      'src/worker/Turns.ts',
      "return typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? Memo.units(usd.toFixed(Limits.SharedMemo.decimals)) : undefined",
      "return typeof usd !== 'number' && Number.isFinite(usd) && usd >= 0 ? Memo.units(usd.toFixed(Limits.SharedMemo.decimals)) : undefined",
    ),
    invariant: "settledUsd reads the turn's settled spend from the gateway's turn report",
    name: 'turns.turns',
    scenario: 'turns',
    seeds: ['1', '2', '3'],
  },
]
