import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import type * as HandsModule from '../src/worker/Hands.ts'
import './host.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Hands: typeof HandsModule = await import('../src/worker/Hands.ts')

test('a priced hand shows its owner, charges and earnings as the gateway reports them', () => {
  const terms = Hands.terms({
    cap: { operation: null, since: 0, spent: 0.01, usd: 0.015 },
    charges: { count: 2, usd: 0.02 },
    connected: true,
    earned: 0.02,
    name: 'data-room-553b00',
    paid: 0,
    pricing: { describe: 'Q3 data, $0.01 a file', payee: '0x975937feafc6869a260c176854dda8764a78e122' },
    requests: 5,
  })
  assert.deepEqual(terms, {
    channels: null,
    charged: '$0.02 for 2 operations',
    earned: '$0.02, $0 paid out',
    price: 'Q3 data, $0.01 a file (paid to 0x9759…e122)',
    requests: 5,
  })
})

test('a hand paid over its own channels shows what they carried and what settled', () => {
  const terms = Hands.terms({
    channels: [
      { accepted: 0.03, currency: '0x20c0000000000000000000006a37da5c996874be', deposit: 0.05, id: '0x01', open: true, payee: '0x4011ff5961d8573c5d8fcba00253c6229e2ac826', settled: 0.02 },
      { accepted: 0.01, currency: '0x20c0000000000000000000006a37da5c996874be', deposit: 0.05, id: '0x02', open: false, payee: '0x4011ff5961d8573c5d8fcba00253c6229e2ac826', settled: 0.01 },
    ],
    charges: { count: 5, usd: 0.05 },
    connected: true,
    earned: 0.05,
    name: 'data-room-553b00',
    paid: 0.04,
    pricing: { currency: 'ousd', payee: '0x4011ff5961d8573c5d8fcba00253c6229e2ac826' },
    requests: 7,
  })
  assert.deepEqual(terms, {
    channels: '$0.04 paid straight to its owner over 2 channels, $0.03 settled on Tempo',
    charged: '$0.05 for 5 operations',
    earned: '$0.05, $0.04 paid out',
    price: 'priced by its owner (paid to 0x4011…c826 in OUSD)',
    requests: 7,
  })
})

test('a free hand on a gateway without pricing shows only its requests', () => {
  assert.deepEqual(Hands.terms({ connected: true, name: 'laptop-1a2b3c', requests: 3 }), { channels: null, charged: null, earned: null, price: null, requests: 3 })
  assert.deepEqual(Hands.terms(undefined), { channels: null, charged: null, earned: null, price: null, requests: 0 })
})
