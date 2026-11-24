import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as FollowModule from '../src/worker/Follow.ts'
import './host.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Follow: typeof FollowModule = await import('../src/worker/Follow.ts')

const self = { kv: { get: () => undefined } } as never

const sub = (type: string, payload: Record<string, unknown>) => ({ event: { root_session_id: 'agt_1', source: 'subagent', update: { event: { payload, type }, id: 2, type: 'event' } }, seq: 1 }) as never

function shown(frames: ReturnType<typeof Follow.deltas>) {
  let text = ''
  for (const frame of frames) if (frame.type === 'delta') text = frame.offset === null ? text + frame.delta : text.slice(0, frame.offset) + frame.delta
  return text
}

test('a subagent thinking or tool input stream resent from an offset after a reconnect shows its text once', () => {
  const thinking = [sub('reasoning.summary.delta', { item_id: 'rs_1', model_call_index: 3, offset: 0, text: 'Checking the ' }), sub('reasoning.summary.delta', { item_id: 'rs_1', model_call_index: 3, offset: 13, text: 'primes' })]
  const resent = sub('reasoning.summary.delta', { item_id: 'rs_1', model_call_index: 3, offset: 0, text: 'Checking the primes' })
  const frames = [...thinking, resent].flatMap((event) => Follow.deltas(self, event, 'agt_1'))
  assert.equal(shown(frames), 'Checking the primes')
  assert.deepEqual(frames.map((frame) => frame.type === 'delta' && [frame.channel, frame.item, frame.who]), [['thinking', 'reasoning:rs_1', 'subagent 2'], ['thinking', 'reasoning:rs_1', 'subagent 2'], ['thinking', 'reasoning:rs_1', 'subagent 2']])
  const input = [sub('tool.input.delta', { call_id: 'c1', offset: 0, text: '{"code":' }), sub('tool.input.delta', { call_id: 'c1', offset: 0, text: '{"code":"x"}' })].flatMap((event) => Follow.deltas(self, event, 'agt_1'))
  assert.equal(shown(input), '{"code":"x"}')
})

test('thinking that arrives only as live frames is kept by offset and taken as one thought when its model call ends', () => {
  const kept = new Map<string, unknown>()
  const object = { kv: { delete: (key: string) => kept.delete(key), get: (key: string) => kept.get(key), put: (key: string, value: unknown) => kept.set(key, structuredClone(value)) } } as never
  const frames = [
    sub('reasoning.summary.delta', { item_id: 'rs_1', offset: 0, text: 'Weighing ' }),
    sub('reasoning.summary.delta', { item_id: 'rs_1', offset: 9, text: 'two plans.' }),
    sub('reasoning.summary.delta', { item_id: 'rs_1', offset: 0, text: 'Weighing two plans.' }),
    sub('reasoning.summary.delta', { item_id: 'rs_2', offset: 0, text: ' Picking one.' }),
  ]
  for (const frame of frames.flatMap((event) => Follow.deltas(object, event, 'agt_1'))) if (frame.type === 'delta') Follow.pondered(object, frame.who, frame.item, frame.offset, frame.delta)
  assert.equal(Follow.buffers(object).take('subagent 2'), 'Weighing two plans. Picking one.')
  assert.equal(kept.size, 0)
  kept.set('thinking', 'an older ')
  Follow.pondered(object, null, 'reasoning:3', 0, 'thought')
  assert.equal(Follow.buffers(object).take(null), 'an older thought')
})

test('a working agent with no model or tool call for twenty minutes is noted stalled once in the logs and never in the feed, and progress renews its lease and clears it', async () => {
  const Work = await import('../src/worker/Work.ts')
  const Turns = await import('../src/worker/Turns.ts')
  const { fresh } = await import('./board.ts')
  const kept = new Map<string, unknown>()
  const logged: string[] = []
  const board = fresh('swarm:abc')
  const started = Date.now() - 30 * 60_000
  await Work.ensure(board, { id: 'turn:1', spec: 'turn 1', terms: { retry: Turns.retry } })
  const claimed = await board.claim('turn:1', { leaseMs: 1_000 })
  assert.ok(claimed.ok)
  kept.set('lease', { task: 'turn:1', untilMs: claimed.untilMs })
  const run = { claim: claimed.claim, from: 0, n: 1, since: started, started, state: 'working', task: 'turn:1', turn: 'agt_1:1' } as const
  const object: never = {
    board,
    kv: { get: (key: string) => kept.get(key), put: (key: string, value: unknown) => kept.set(key, value) },
    log: (_kind: string, text: string) => logged.push(text),
    run: () => run,
    working: () => ({ ...Turns.progress(object, run), since: started }),
  } as never
  Follow.advanced(object, 'subagent.added', Date.now())
  await Turns.progressed(object)
  Follow.stalled(object, Date.now())
  Follow.stalled(object, Date.now())
  assert.equal(logged.length, 0)
  const noted = kept.get('stallNoted')
  assert.equal(typeof noted, 'number')
  Follow.advanced(object, 'model.call.completed', Date.now())
  await Turns.progressed(object)
  assert.ok(((await board.task('turn:1'))?.untilMs ?? 0) >= Date.now() + Turns.leaseMs - 1_000)
  Follow.stalled(object, Date.now())
  assert.deepEqual([logged.length, kept.get('stallNoted')], [0, noted])
})

test('eight model calls in a row that nothing could pay for starve the turn, and one that went through clears the count', () => {
  const kept = new Map<string, unknown>()
  const object = { kv: { delete: (key: string) => kept.delete(key), get: (key: string) => kept.get(key), put: (key: string, value: unknown) => kept.set(key, value) } } as never
  const failed = { error: 'Messages stream error api_error: Boundless was not paid: No method found for challenges: tempo.session. Available: tempo.session' }
  for (let count = 0; count < 7; count++) Follow.refused(object, 'model.call.failed', failed)
  Follow.refused(object, 'run.failed', { status: 'failed' })
  Follow.refused(object, 'model.call.failed', { error: 'HTTP 529 overloaded' })
  assert.equal(Follow.starved(object), undefined)
  Follow.refused(object, 'model.call.completed', {})
  assert.equal(kept.has('unpaid'), false)
  for (let count = 0; count < 8; count++) Follow.refused(object, 'model.call.failed', failed)
  assert.match(Follow.starved(object) ?? '', /Boundless was not paid/)
})

test("the last model call the gateway failed is kept with its route, status, code and message, and a cancelled call does not replace it", () => {
  const kept = new Map<string, unknown>()
  const object = { kv: { delete: (key: string) => kept.delete(key), get: (key: string) => kept.get(key), put: (key: string, value: unknown) => kept.set(key, value) } } as never
  const error = 'Messages HTTP 503: {"error":{"message":"Tempo Agents cannot pay the network fee to open your key\'s channel right now: its fee sponsor is out of funds.","type":"api_error"},"type":"error"}'
  Follow.refused(object, 'model.call.failed', { error }, 1_000)
  Follow.refused(object, 'model.call.failed', { error: 'the turn was cancelled' }, 2_000)
  assert.deepEqual(kept.get('failure'), { at: 1_000, code: 'api_error', message: "Tempo Agents cannot pay the network fee to open your key's channel right now: its fee sponsor is out of funds.", route: 'Messages', status: 503 })
  assert.match(Follow.starved(object) ?? 'none', /none/)
  assert.deepEqual(Follow.failure('Messages stream error api_error: Boundless was not paid: fetch failed', 3), { at: 3, code: 'api_error', message: 'Boundless was not paid: fetch failed', route: 'Messages', status: null })
  assert.deepEqual(Follow.failure('Responses HTTPS request was rejected with HTTP 402: {"title":"x","code":"payment_failed","detail":"No money."}', 4), { at: 4, code: 'payment_failed', message: 'No money.', route: 'Responses', status: 402 })
})
