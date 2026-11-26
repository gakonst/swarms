import type * as PayModule from '../../src/web/pay.ts'
import { applied, mutant, reload } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function pay(seed: string): Promise<Outcome> {
  const random = rng('pay', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []

  const stored = new Map<string, string>()

  Object.assign(globalThis, {
    localStorage: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) },
  })

  let loads = 0

  function loaded(): Promise<typeof PayModule> {
    return reload<typeof PayModule>('src/web/pay.ts', String(loads++))
  }

  const Pay = await loaded()

  const sent: PayModule.Owed = { amount: '5.000000', hash: '0xabc', note: '', swarm: 's1' }

  function answering(...answers: (Response | Error | Promise<Response>)[]) {
    const asked: { body: unknown; url: string }[] = []
    globalThis.fetch = async (url, init) => {
      asked.push({ body: JSON.parse(String(init?.body ?? 'null')), url: String(url) })
      const answer = await answers[Math.min(asked.length, answers.length) - 1]!
      if (answer instanceof Error) throw answer
      return answer.clone()
    }
    return asked
  }

  function problem(status: number, code: string, detail: string) {
    return Response.json({ code, detail, status }, { status })
  }

  const counted = Response.json({ contribution: { hash: '0xabc' }, swarm: {} })

  const owed = () => JSON.parse(stored.get('swarms.owed') ?? '[]') as PayModule.Owed[]

  const every: Record<PayModule.Act['at'], PayModule.Act> = {
    counted: { amount: '5.000000', at: 'counted', swarm: 's1' },
    counting: { at: 'counting', owed: sent, tries: 0 },
    creating: { at: 'creating' },
    failed: { at: 'failed', error: 'You declined the request in Tempo ID.', why: 'cancelled' },
    idle: { at: 'idle' },
    owed: { at: 'owed', owed: sent, tries: 1 },
    paying: { at: 'paying' },
    refused: { at: 'refused', error: 'This node is not open.', owed: sent },
    signing: { at: 'signing' },
  }

  const events: Record<PayModule.Event['type'], PayModule.Event> = {
    counted: { type: 'counted' },
    created: { type: 'created' },
    failed: { error: 'Your wallet holds less than this.', type: 'failed' },
    later: { type: 'later' },
    refused: { error: 'This node is not open.', type: 'refused' },
    reset: { type: 'reset' },
    retry: { type: 'retry' },
    sent: { owed: sent, type: 'sent' },
    signed: { type: 'signed' },
    start: { creates: false, signed: true, type: 'start' },
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'each act moves only along its lifecycle',
      async (_t) => {
        const allowed: Record<PayModule.Act['at'], readonly PayModule.Event['type'][]> = {
          counted: ['reset', 'start'],
          counting: ['counted', 'later', 'refused'],
          creating: ['created', 'failed'],
          failed: ['reset', 'start'],
          idle: ['start'],
          owed: ['retry'],
          paying: ['failed', 'sent'],
          refused: ['reset', 'start'],
          signing: ['failed', 'signed'],
        }
        for (const [at, act] of Object.entries(every)) {
          const moves = Object.values(events)
            .filter((event) => Pay.next(act, event) !== null)
            .map((event) => event.type)
            .sort()
          a.deepEqual(moves, [...allowed[at as PayModule.Act['at']]].sort(), at)
        }
      },
    ],
    [
      'a ride goes straight to the wallet; a proposal signs in first when signed out, then creates, then pays',
      async (_t) => {
        a.deepEqual(Pay.next(Pay.idle, { creates: false, signed: false, type: 'start' }), { at: 'paying' })
        a.deepEqual(Pay.next(Pay.idle, { creates: true, signed: false, type: 'start' }), { at: 'signing' })
        a.deepEqual(Pay.next(Pay.idle, { creates: true, signed: true, type: 'start' }), { at: 'creating' })
        a.deepEqual(Pay.next({ at: 'signing' }, { type: 'signed' }), { at: 'creating' })
        a.deepEqual(Pay.next({ at: 'creating' }, { type: 'created' }), { at: 'paying' })
        a.deepEqual(Pay.next({ at: 'paying' }, { owed: sent, type: 'sent' }), { at: 'counting', owed: sent, tries: 0 })
        a.deepEqual(Pay.next({ at: 'counting', owed: { ...sent, node: 'n1' }, tries: 2 }, { type: 'counted' }), {
          amount: '5.000000',
          at: 'counted',
          node: 'n1',
          parent: undefined,
          started: undefined,
          swarm: 's1',
          title: undefined,
        })
        a.deepEqual(Pay.next({ at: 'counting', owed: sent, tries: 2 }, { type: 'later' }), { at: 'owed', owed: sent, tries: 2 })
        a.deepEqual(Pay.next({ at: 'owed', owed: sent, tries: 2 }, { type: 'retry' }), { at: 'counting', owed: sent, tries: 3 })
        a.equal(Pay.next({ at: 'counting', owed: sent, tries: 0 }, { creates: false, signed: true, type: 'start' }), null)
      },
    ],
    [
      'a failure before anything is sent says why',
      async (_t) => {
        const failed = (error: string) => Pay.next({ at: 'paying' }, { error, type: 'failed' })
        a.deepEqual(failed('You declined the request in Tempo ID.'), { at: 'failed', error: 'You declined the request in Tempo ID.', why: 'cancelled' })
        a.equal(Pay.why('Your wallet holds less than this.'), 'broke')
        a.equal(Pay.why('Swarms is not answering right now.'), 'offline')
        a.equal(Pay.why('The parent node is not open.'), 'other')
        a.ok(Pay.busy({ at: 'signing' }) && Pay.busy({ at: 'counting', owed: sent, tries: 0 }))
        a.ok(!Pay.busy({ at: 'owed', owed: sent, tries: 0 }) && !Pay.busy(Pay.idle))
      },
    ],
    [
      'a transfer the server refuses to count is refused with its reason, not kept to try again',
      async (_t) => {
        const asked = answering(problem(400, 'invalid_request', 'That transaction is not a transfer to the gateway for this swarm: memo names another app'))
        Pay.move('s1', events.start)
        a.deepEqual(await Pay.record(sent), {
          at: 'refused',
          reason: 'That transaction is not a transfer to the gateway for this swarm: memo names another app',
        })
        a.equal(asked.length, 1)
        a.equal(asked[0]?.url, '/swarms/api/swarms/s1/contributions')
        a.deepEqual(Pay.flow('s1'), {
          at: 'refused',
          error: 'That transaction is not a transfer to the gateway for this swarm: memo names another app',
          owed: sent,
        })
        a.deepEqual(owed(), [])
        Pay.forget('s1')
        a.deepEqual(Pay.flow('s1'), Pay.idle)
      },
    ],
    [
      'a transfer the server could not count yet stays owed, a retry counts it, and one already counted is counted',
      async (_t) => {
        for (const answer of [
          problem(502, 'upstream_failed', 'The gateway did not credit the transfer: timeout'),
          problem(429, 'rate_limited', 'Too many at once.'),
          new TypeError('fetch failed'),
        ]) {
          answering(answer)
          Pay.move('s1', events.start)
          a.deepEqual(await Pay.record(sent), { at: 'later' })
          a.deepEqual(Pay.flow('s1'), { at: 'owed', owed: sent, tries: 0 })
          answering(problem(409, 'conflict', 'This transaction is already counted.'))
          a.deepEqual(await Pay.retry('s1'), { at: 'counted' })
          a.deepEqual(Pay.flow('s1'), {
            amount: '5.000000',
            at: 'counted',
            node: undefined,
            parent: undefined,
            started: undefined,
            swarm: 's1',
            title: undefined,
          })
        }
        const asked = answering(counted)
        Pay.move('s1', events.start)
        a.deepEqual(await Pay.record({ ...sent, note: 'try rust' }), { at: 'counted' })
        a.deepEqual(asked[0]?.body, { hash: '0xabc', note: 'try rust' })
        Pay.move('s1', events.reset)
      },
    ],
    [
      'a sent transfer is kept before it is counted, survives a reload, and locks its slot until it is counted',
      async (_t) => {
        let answer = (_: Response) => {}
        answering(new Promise<Response>((resolve) => (answer = resolve)))
        Pay.move('s1', events.start)
        const counting = Pay.record(sent)
        a.deepEqual(owed(), [sent])
        a.deepEqual(Pay.flow('s1'), { at: 'counting', owed: sent, tries: 0 })
        a.ok(!Pay.can('s1', events.start))
        answer(problem(502, 'upstream_failed', 'The gateway did not credit the transfer: timeout'))
        a.deepEqual(await counting, { at: 'later' })
        a.deepEqual(owed(), [sent])

        const reloaded = await loaded()
        a.deepEqual(reloaded.flow('s1'), { at: 'owed', owed: sent, tries: 0 })
        a.equal(reloaded.flow('s1'), reloaded.flow('s1'))
        a.deepEqual(reloaded.flow('s2'), { at: 'idle' })
        a.ok(!reloaded.can('s1', events.start))
        a.throws(() => reloaded.move('s1', events.start), /cannot go from owed on start/)

        const asked = answering(counted)
        a.deepEqual(await reloaded.retry('s1'), { at: 'counted' })
        a.deepEqual(
          asked.map((each) => each.body),
          [{ hash: '0xabc' }],
        )
        a.deepEqual(reloaded.flow('s1'), {
          amount: '5.000000',
          at: 'counted',
          node: undefined,
          parent: undefined,
          started: undefined,
          swarm: 's1',
          title: undefined,
        })
        a.deepEqual(owed(), [])
        a.deepEqual(Pay.flow('s1'), { at: 'idle' })
      },
    ],
    [
      'money sent from the start page belongs to the swarm it created',
      async (_t) => {
        const Pay = await loaded()
        let answer = (_: Response) => {}
        answering(new Promise<Response>((resolve) => (answer = resolve)))
        Pay.move('own', { creates: true, signed: true, type: 'start' })
        Pay.move('own', { type: 'created' })
        const counting = Pay.record(sent, 'own')
        a.deepEqual(Pay.flow('own'), { at: 'idle' })
        a.deepEqual(Pay.flow('s1'), { at: 'counting', owed: sent, tries: 0 })
        answer(problem(503, 'unavailable', 'Try again in a moment.'))
        await counting
        a.deepEqual(Pay.flow('own'), { at: 'idle' })
        a.deepEqual(Pay.flow('s1'), { at: 'owed', owed: sent, tries: 0 })
        answering(counted)
        await Pay.retry('s1')
        a.deepEqual(owed(), [])
      },
    ],
    [
      'a proposal is counted on its new node, and shows under its parent until it is',
      async (_t) => {
        const Pay = await loaded()
        const made: PayModule.Owed = { amount: '1.000000', hash: '0xdef', node: 'n9', note: '', parent: 'root', swarm: 's1', title: 'A new lemma' }
        const heard: string[] = []
        const stop = Pay.listen((slot, act) => heard.push(`${slot} ${act.at}`))
        let answer = (_: Response) => {}
        const asked = answering(new Promise<Response>((resolve) => (answer = resolve)))
        const from = Pay.proposing('s1', 'root')
        Pay.move(from, { creates: true, signed: false, type: 'start' })
        Pay.move(from, { type: 'signed' })
        Pay.move(from, { type: 'created' })
        const counting = Pay.record(made, from)
        a.deepEqual(Pay.flow(from), Pay.idle)
        a.deepEqual(Pay.ghosts('s1', 'root'), [{ act: { at: 'counting', owed: made, tries: 0 }, owed: made }])
        a.deepEqual(Pay.ghosts('s1', 'other'), [])
        answer(counted)
        a.deepEqual(await counting, { at: 'counted' })
        a.equal(asked[0]?.url, '/swarms/v1/swarms/s1/contributions')
        a.deepEqual(asked[0]?.body, { hash: '0xdef', node: 'n9' })
        a.deepEqual(Pay.flow(Pay.slot('s1', 'n9')), {
          amount: '1.000000',
          at: 'counted',
          node: 'n9',
          parent: 'root',
          started: undefined,
          swarm: 's1',
          title: 'A new lemma',
        })
        a.deepEqual(Pay.ghosts('s1', 'root'), [])
        a.deepEqual(heard, ['s1/propose/root signing', 's1/propose/root creating', 's1/propose/root paying', 's1/n/n9 counting', 's1/n/n9 counted'])
        stop()
      },
    ],
    [
      'a payment in flight outlives the box that started it, and a settled one is forgotten with it',
      async (_t) => {
        const Pay = await loaded()
        let told = 0
        const leave = Pay.watch('s1', () => told++)
        Pay.move('s1', events.start)
        a.equal(told, 1)
        leave()
        a.deepEqual(Pay.flow('s1'), { at: 'paying' })
        Pay.move('s1', { error: 'You declined the request in Tempo Wallet.', type: 'failed' })
        a.deepEqual(Pay.flow('s1'), { at: 'failed', error: 'You declined the request in Tempo Wallet.', why: 'cancelled' })
        Pay.watch('s1', () => {})()
        a.deepEqual(Pay.flow('s1'), { at: 'idle' })
        a.throws(() => Pay.move('s1', { type: 'counted' }), /cannot go from idle on counted/)
        Pay.move('s1', events.start)
        Pay.move('s1', { error: 'Your wallet holds less than this.', type: 'failed' })
        a.deepEqual(Pay.flow('s1'), { at: 'failed', error: 'Your wallet holds less than this.', why: 'broke' })
        Pay.move('s1', events.start)
        a.deepEqual(Pay.flow('s1'), { at: 'paying' })
        Pay.move('s1', { error: 'x', type: 'failed' })
        Pay.move('s1', events.reset)
      },
    ],
    [
      'a transfer the server could not count yet is tried again by itself, with nothing on screen',
      async (_t) => {
        const Pay = await loaded()
        const made: PayModule.Owed = { amount: '1.000000', hash: '0xfed', node: 'n7', note: '', parent: 'root', swarm: 's1', title: 'A late lemma' }
        const from = Pay.proposing('s1', 'root')
        const asked = answering(problem(502, 'upstream_failed', 'The gateway did not credit the transfer: timeout'), counted)
        Pay.move(from, { creates: true, signed: true, type: 'start' })
        Pay.move(from, { type: 'created' })
        a.deepEqual(await Pay.record(made, from), { at: 'later' })
        a.deepEqual(Pay.flow(Pay.slot('s1', 'n7')), { at: 'owed', owed: made, tries: 0 })
        await new Promise((resolve) => setTimeout(resolve, Pay.retries[0] + 300))
        a.equal(asked.length, 2)
        a.deepEqual(Pay.flow(Pay.slot('s1', 'n7')), {
          amount: '1.000000',
          at: 'counted',
          node: 'n7',
          parent: 'root',
          started: undefined,
          swarm: 's1',
          title: 'A late lemma',
        })
        a.deepEqual(owed(), [])
      },
    ],
    [
      'an approval an older page left owed is dropped: approvals are gone, and only a sent transfer is owed',
      async (_t) => {
        stored.set(
          'swarms.owed',
          JSON.stringify([
            { amount: '2.000000', id: 'backing_1', keyAuthorization: {}, note: '', swarm: 's9', way: 'approved' },
            { ...sent, swarm: 's9' },
          ]),
        )
        const Pay = await loaded()
        a.deepEqual(Pay.flow('s9'), { at: 'owed', owed: { ...sent, swarm: 's9' }, tries: 0 })
        answering(counted)
        a.deepEqual(await Pay.retry('s9'), { at: 'counted' })
        a.deepEqual(owed(), [])
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { pay }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'pay.signed',
      'src/web/pay.ts',
      "return act.at === 'signing' ? { at: 'creating' } : null",
      "return act.at !== 'signing' ? { at: 'creating' } : null",
    ),
    invariant: 'each act moves only along its lifecycle',
    name: 'pay.signed',
    scenario: 'pay',
    seeds: ['1', '2', '3'],
  },
]
