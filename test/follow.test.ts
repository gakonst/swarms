import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as FollowModule from '../src/worker/Follow.ts'

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

test('a working agent with no model or tool call for twenty minutes is reported stalled once, and progress clears it', () => {
  const kept = new Map<string, unknown>()
  const logged: string[] = []
  const started = Date.now() - 30 * 60_000
  const object = {
    kv: { get: (key: string) => kept.get(key), put: (key: string, value: unknown) => kept.set(key, value) },
    log: (_kind: string, text: string) => logged.push(text),
    working: () => {
      const progressed = Math.max((kept.get('progressed') as number | undefined) ?? 0, started)
      return { progressed, since: started, stalled: Date.now() - progressed >= 20 * 60_000 }
    },
  } as never
  Follow.advanced(object, 'subagent.added', Date.now())
  Follow.stalled(object, Date.now())
  Follow.stalled(object, Date.now())
  assert.equal(logged.length, 1)
  assert.match(logged[0] ?? '', /no model call or tool call for 30 minutes/)
  Follow.advanced(object, 'model.call.completed', Date.now())
  Follow.stalled(object, Date.now())
  assert.equal(logged.length, 1)
})

test('five model calls in a row that nothing could pay for starve the turn, and one that went through clears the count', () => {
  const kept = new Map<string, unknown>()
  const object = { kv: { delete: (key: string) => kept.delete(key), get: (key: string) => kept.get(key), put: (key: string, value: unknown) => kept.set(key, value) } } as never
  const failed = { error: 'Messages stream error api_error: Boundless was not paid: No method found for challenges: tempo.session. Available: tempo.session' }
  for (let count = 0; count < 4; count++) Follow.refused(object, 'model.call.failed', failed)
  Follow.refused(object, 'run.failed', { status: 'failed' })
  Follow.refused(object, 'model.call.failed', { error: 'HTTP 529 overloaded' })
  assert.equal(Follow.starved(object), undefined)
  Follow.refused(object, 'model.call.completed', {})
  assert.equal(kept.size, 0)
  for (let count = 0; count < 5; count++) Follow.refused(object, 'model.call.failed', failed)
  assert.match(Follow.starved(object) ?? '', /Boundless was not paid/)
})
