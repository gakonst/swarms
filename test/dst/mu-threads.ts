import type { Chatter } from '../../src/shared/Api.ts'
import type * as Credit from '../../src/shared/Credit.ts'
import type * as M1 from '../../src/shared/Credit.ts'
import type * as Reaction from '../../src/shared/Reaction.ts'
import type * as M2 from '../../src/shared/Reaction.ts'
import type * as Setup from '../../src/shared/Setup.ts'
import type * as M3 from '../../src/shared/Setup.ts'
import type * as M4 from '../dispatch.ts'
import type * as M5 from '../run.ts'
import type * as NodesModule from '../../src/worker/Nodes.ts'
import type * as OperationsModule from '../../src/worker/Operations.ts'
import type * as RunnerModule from '../../src/worker/Runner.ts'
import { applied, load, mutant } from './mh-kit.ts'
import { checker, recorder, rng, type Checker, type Outcome } from './mi.ts'

async function threads(seed: string): Promise<Outcome> {
  const random = rng('threads', seed)
  const { fail, steps, violations } = recorder()
  let checked = 0
  const a: Checker = checker(fail, () => void checked++)
  const afters: (() => unknown)[] = []
  const Credit = await load<typeof M1>('src/shared/Credit.ts')
  const Reaction = await load<typeof M2>('src/shared/Reaction.ts')
  const Setup = await load<typeof M3>('src/shared/Setup.ts')
  const { github } = await load<typeof M4>('test/dispatch.ts')
  const { id, rider, world } = await load<typeof M5>('test/run.ts')

  const Nodes = await load<typeof NodesModule>('src/worker/Nodes.ts')
  const Operations = await load<typeof OperationsModule>('src/worker/Operations.ts')
  const Runner = await load<typeof RunnerModule>('src/worker/Runner.ts')

  const owner = '0x00000000000000000000000000000000000000ee'
  const ana = ('0x' + 'a'.repeat(40)) as `0x${string}`
  const bo = ('0x' + 'b'.repeat(40)) as `0x${string}`

  function heard(w: ReturnType<typeof world>) {
    const events: Chatter[] = []
    Object.assign(w.swarm.ctx, { getWebSockets: () => [{ send: (data: string) => events.push(JSON.parse(data) as Chatter) }] })
    return events
  }

  async function named(w: ReturnType<typeof world>, address: string, name: string) {
    await w.env.DB.prepare('insert into names (address, name, updated_at) values (?, ?, 1)').bind(address.toLowerCase(), name).run()
  }

  async function room(t: { after: (done: () => void | Promise<void>) => void }) {
    const w = world(() => undefined)
    ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
    t.after(() => w.restore())
    await w.seed()
    await named(w, rider, 'ada')
    await named(w, bo, 'bo')
    return w
  }

  function tree(t: { after: (done: () => void | Promise<void>) => void }) {
    const deposits = new Map<string, { amount: string; from: string; tag: string }>()
    const w = world(async (request, url) => {
      if (url.pathname === '/v1/models')
        return Response.json({
          data: [Setup.flash, Setup.glmFlash, Setup.fable, Setup.sol].map((model) => ({
            id: model,
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
      if (url.pathname === '/v1/agents' && request.method === 'POST') return Response.json({ id: 'agt_d' })
      if (url.pathname.startsWith('/v1/agents/agt_d'))
        return Response.json(url.pathname.endsWith('/subagents') ? { agents: [] } : { request_id: 'x', status: 'queued' })
      return undefined
    })
    ;(w.env as unknown as Record<string, unknown>)['SWARMS'] = { get: () => w.swarm, idFromName: (name: string) => name }
    github(w.env)
    t.after(async () => {
      await Runner.stop(w.swarm)
      w.restore()
    })
    return { deposits, w }
  }

  applied()
  const dstCases: [string, (t: { after: (fn: () => unknown) => void }) => Promise<void> | void][] = [
    [
      'a reply goes in its thread, a reply to a reply in the same one, and the room lists only first messages with their thread',
      async (t) => {
        const w = await room(t)
        const events = heard(w)
        const first = await Operations.say(w.env, { swarm: id, text: 'what next?' }, rider)
        a.ok(first.ok, JSON.stringify(first))
        const reply = await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'try the cold cache run' }, rider)
        a.ok(reply.ok, JSON.stringify(reply))
        a.equal(reply.value.message.parent, first.value.message.id)
        const deeper = await Operations.say(w.env, { parent: reply.value.message.id, swarm: id, text: 'agreed' }, rider)
        a.ok(deeper.ok)
        a.equal(deeper.value.message.parent, first.value.message.id)
        a.ok((await Operations.say(w.env, { swarm: id, text: 'unrelated' }, rider)).ok)

        const read = await Operations.room(w.env, { swarm: id })
        a.ok(read.ok)
        a.deepEqual(
          read.value.messages.filter((said) => said.author).map((said) => said.text),
          ['what next?', 'unrelated'],
        )
        a.deepEqual(read.value.messages.find((said) => said.id === first.value.message.id)?.replies, { at: deeper.value.message.at, count: 2, who: [rider] })

        const thread = await Operations.replies(w.env, { message: deeper.value.message.id, swarm: id })
        a.ok(thread.ok, JSON.stringify(thread))
        a.equal(thread.value.parent.id, first.value.message.id)
        a.deepEqual(
          thread.value.replies.map((said) => said.text),
          ['try the cold cache run', 'agreed'],
        )
        a.equal(thread.value.next, deeper.value.message.id)
        const later = await Operations.replies(w.env, { after: reply.value.message.id, message: first.value.message.id, swarm: id })
        a.ok(later.ok)
        a.deepEqual(
          later.value.replies.map((said) => said.text),
          ['agreed'],
        )

        const counts = events.flatMap((event) => (event.type === 'replies' ? [[event.id, event.replies.count]] : []))
        a.deepEqual(counts, [
          [first.value.message.id, 1],
          [first.value.message.id, 2],
        ])
        a.ok(events.some((event) => event.type === 'said' && event.message.parent === first.value.message.id))
      },
    ],
    [
      'a thread refuses a missing message and an @swarm steer, and replies are redacted and paced with the room',
      async (t) => {
        const w = await room(t)
        const missing = await Operations.say(w.env, { parent: 999, swarm: id, text: 'hello' }, rider)
        a.ok(!missing.ok && missing.status === 404)
        a.ok(!(await Operations.replies(w.env, { message: 999, swarm: id })).ok)
        const first = await Operations.say(w.env, { swarm: id, text: 'start' }, rider)
        a.ok(first.ok)
        const steer = await Operations.say(w.env, { parent: first.value.message.id, steer: '0.5', swarm: id, text: '@swarm try harder' }, rider)
        a.ok(!steer.ok && steer.status === 400, JSON.stringify(steer))
        const outsider = await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'hi' }, bo)
        a.ok(!outsider.ok && outsider.status === 403)
        const secret = await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'git clone https://user:token@code.storage/repo' }, rider)
        a.ok(secret.ok)
        a.equal(secret.value.message.text, 'git clone https://***@code.storage/repo')
        for (let n = 0; n < 7; n++) a.ok((await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'r' + n }, rider)).ok)
        const paced = await Operations.say(w.env, { parent: first.value.message.id, swarm: id, text: 'one too many' }, rider)
        a.ok(!paced.ok && paced.status === 429)
      },
    ],
    [
      'reactions toggle idempotently per person and emoji, list who reacted, stream live and need a rider',
      async (t) => {
        const w = await room(t)
        const events = heard(w)
        const first = await Operations.say(w.env, { swarm: id, text: 'shipped' }, rider)
        a.ok(first.ok)
        const message = first.value.message.id
        const on = await Operations.react(w.env, { emoji: '🎉', message, swarm: id }, rider)
        a.ok(on.ok, JSON.stringify(on))
        a.deepEqual(on.value, { id: message, reactions: [{ emoji: '🎉', who: [rider.toLowerCase()] }] })
        const twice = await Operations.react(w.env, { emoji: '🎉', message, on: true, swarm: id }, rider)
        a.ok(twice.ok)
        a.deepEqual(twice.value.reactions, [{ emoji: '🎉', who: [rider.toLowerCase()] }])
        a.ok((await Operations.react(w.env, { emoji: '👍', message, swarm: id }, rider)).ok)
        const read = await Operations.room(w.env, { swarm: id })
        a.ok(read.ok)
        a.deepEqual(
          read.value.messages.find((said) => said.id === message)?.reactions?.map((reaction) => reaction.emoji),
          ['🎉', '👍'],
        )
        const off = await Operations.react(w.env, { emoji: '🎉', message, on: false, swarm: id }, rider)
        a.ok(off.ok)
        a.deepEqual(off.value.reactions, [{ emoji: '👍', who: [rider.toLowerCase()] }])
        a.deepEqual(
          events.flatMap((event) => (event.type === 'reacted' ? [event.reactions.map((reaction) => reaction.emoji).join('')] : [])),
          ['🎉', '🎉', '🎉👍', '👍'],
        )

        const reply = await Operations.say(w.env, { parent: message, swarm: id, text: 'nice' }, rider)
        a.ok(reply.ok)
        a.ok((await Operations.react(w.env, { emoji: '❤️', message: reply.value.message.id, swarm: id }, rider)).ok)
        const thread = await Operations.replies(w.env, { message, swarm: id })
        a.ok(thread.ok)
        a.deepEqual(thread.value.replies[0]?.reactions, [{ emoji: '❤️', who: [rider.toLowerCase()] }])

        const odd = await Operations.react(w.env, { emoji: '🦄', message, swarm: id }, rider)
        a.ok(!odd.ok && odd.status === 400)
        const gone = await Operations.react(w.env, { emoji: '👍', message: 999, swarm: id }, rider)
        a.ok(!gone.ok && gone.status === 404)
        const outsider = await Operations.react(w.env, { emoji: '👍', message, swarm: id }, bo)
        a.ok(!outsider.ok && outsider.status === 403)
        const anonymous = await Operations.react(w.env, { emoji: '👍', message, swarm: id })
        a.ok(!anonymous.ok && anonymous.status === 401)
      },
    ],
    [
      'reactions are paced per person',
      async (t) => {
        const w = await room(t)
        const first = await Operations.say(w.env, { swarm: id, text: 'react to me' }, rider)
        a.ok(first.ok)
        for (let n = 0; n < Reaction.perMinute; n++)
          a.ok(
            (
              await Operations.react(
                w.env,
                { emoji: Reaction.emojis[n % Reaction.emojis.length]!, message: first.value.message.id, on: n % 2 === 0, swarm: id },
                rider,
              )
            ).ok,
          )
        const paced = await Operations.react(w.env, { emoji: '👍', message: first.value.message.id, swarm: id }, rider)
        a.ok(!paced.ok && paced.status === 429)
        w.pass(61_000)
        a.ok((await Operations.react(w.env, { emoji: '👍', message: first.value.message.id, swarm: id }, rider)).ok)
      },
    ],
    [
      'a message to the swarm becomes a board item once paid, and the item posts its run updates in its thread',
      async (t) => {
        const { deposits, w } = tree(t)
        const made = await Operations.create(
          w.env,
          { form: 'tree', goal: 'Settle whether P equals NP, checked in Lean.', seed: [], statement: 'P = NP ∨ P ≠ NP', template: 'cheap', title: 'P vs NP' },
          ana,
        )
        a.ok(made.ok, JSON.stringify(made))
        const swarm = made.value.id
        await named(w, bo, 'bo')
        const said = 'Try restrictions first, @ada'
        const proposed = await Operations.propose(
          w.env,
          { parent: 'root', said, spec: said, swarm, title: 'Try restrictions first', token: 'pathusd' },
          'https://swarms.test',
          bo,
        )
        a.ok(proposed.ok, JSON.stringify(proposed))
        let read = await Operations.room(w.env, { swarm })
        a.ok(read.ok)
        a.equal(read.value.messages.filter((message) => message.author).length, 0)

        const hash = '0x' + '3'.repeat(64)
        deposits.set(hash, { amount: '1', from: bo, tag: Credit.tag(swarm, 'n:' + proposed.value.nid) })
        a.ok((await Operations.contribute(w.env, { hash, node: proposed.value.nid, swarm })).ok)
        read = await Operations.room(w.env, { swarm })
        a.ok(read.ok)
        const top = read.value.messages.find((message) => message.author)
        a.equal(top?.author, bo)
        a.equal(top?.text, said)
        a.equal(top?.node, proposed.value.nid)

        Nodes.emit(w.swarm, proposed.value.nid, 'progress', 'Restricted 3 of 5 gates, see https://user:token@code.storage/repo')
        Nodes.emit(w.swarm, proposed.value.nid, 'doing', 'thinking')
        const thread = await Operations.replies(w.env, { message: top!.id, swarm })
        a.ok(thread.ok, JSON.stringify(thread))
        const updates = thread.value.replies.map((reply) => [reply.author, reply.text])
        a.ok(updates.every(([author]) => author === null))
        a.ok(
          updates.some(([, text]) => String(text).startsWith('@bo rode it with $1')),
          JSON.stringify(updates),
        )
        a.ok(updates.some(([, text]) => String(text).startsWith('Restricted 3 of 5 gates')))
        a.ok(updates.every(([, text]) => !String(text).includes('user:token') && text !== 'thinking'))
        read = await Operations.room(w.env, { swarm })
        a.ok(read.ok)
        a.deepEqual(read.value.messages.find((message) => message.id === top!.id)?.replies?.who, [null])
      },
    ],
    [
      'an unpaid proposal posts nothing to the room',
      async (t) => {
        const { w } = tree(t)
        const made = await Operations.create(
          w.env,
          { form: 'tree', goal: 'Settle whether P equals NP, checked in Lean.', seed: [], statement: 'P = NP ∨ P ≠ NP', template: 'cheap', title: 'P vs NP' },
          ana,
        )
        a.ok(made.ok, JSON.stringify(made))
        const proposed = await Operations.propose(
          w.env,
          { parent: 'root', said: 'do this', swarm: made.value.id, title: 'Do this', token: 'pathusd' },
          'https://swarms.test',
          bo,
        )
        a.ok(proposed.ok)
        Nodes.emit(w.swarm, 'root', 'progress', 'root moved')
        const read = await Operations.room(w.env, { swarm: made.value.id })
        a.ok(read.ok)
        a.ok(read.value.messages.every((message) => !message.node && !message.replies))
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

export const scenarios: Record<string, (seed: string) => Promise<Outcome>> = { threads }

export const canaries: { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }[] = [
  {
    flip: mutant(
      'threads.operations',
      'src/worker/Operations.ts',
      "return Memo.units(typeof value === 'number' ? value.toFixed(Limits.SharedMemo.decimals) : value)",
      "return Memo.units(typeof value !== 'number' ? value.toFixed(Limits.SharedMemo.decimals) : value)",
    ),
    invariant: 'a thread refuses a missing message and an @swarm steer, and replies are redacted and paced with the room',
    name: 'threads.operations',
    scenario: 'threads',
    seeds: ['1', '2', '3'],
  },
]
