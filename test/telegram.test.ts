import assert from 'node:assert/strict'
import { timingSafeEqual } from 'node:crypto'
import test from 'node:test'
import * as Telegram from '../src/worker/Telegram.ts'

Object.assign(crypto.subtle, { timingSafeEqual: (a: Uint8Array, b: Uint8Array) => timingSafeEqual(a, b) })

test('a start parameter names a swarm unless it names a view', () => {
  assert.equal(Telegram.started(new URL('https://swarms.example/tg?tgWebAppStartParam=abc123')), 'abc123')
  assert.equal(Telegram.started(new URL('https://swarms.example/tg?tgWebAppStartParam=join')), undefined)
  assert.equal(Telegram.started(new URL('https://swarms.example/tg?tgWebAppStartParam=a/b')), undefined)
  assert.equal(Telegram.started(new URL('https://swarms.example/tg')), undefined)
})

test('/start answers with a button that opens the Mini App', () => {
  const chat = { id: 7, type: 'private' }
  const plain = Telegram.answer({ message: { chat, text: '/start' } }, 'https://swarms.example')
  assert.equal(plain?.method, 'sendMessage')
  assert.equal(plain?.chat_id, 7)
  assert.deepEqual(plain?.reply_markup.inline_keyboard[0]?.[0]?.web_app, { url: 'https://swarms.example/tg' })

  const swarm = Telegram.answer({ message: { chat, text: '/start abc123' } }, 'https://swarms.example')
  assert.deepEqual(swarm?.reply_markup.inline_keyboard[0]?.[0], { text: 'Open this swarm', web_app: { url: 'https://swarms.example/tg/s/abc123' } })

  const join = Telegram.answer({ message: { chat, text: '/start join' } }, 'https://swarms.example')
  assert.equal(join?.reply_markup.inline_keyboard[0]?.[0]?.web_app.url, 'https://swarms.example/tg?view=join')

  assert.equal(Telegram.answer({ message: { chat: { id: 8, type: 'group' }, text: '/start' } }, 'https://swarms.example'), undefined)
  assert.equal(Telegram.answer({ edited_message: {} }, 'https://swarms.example'), undefined)
})

test('the webhook refuses a request without the secret', async () => {
  const env = { SWARMS_URL: 'https://swarms.example', TELEGRAM_WEBHOOK_SECRET: 'shh' } as unknown as Cloudflare.Env
  const body = JSON.stringify({ message: { chat: { id: 7, type: 'private' }, text: '/start' } })
  assert.equal((await Telegram.hook(env, new Request('https://swarms.example/telegram', { body, method: 'POST' }))).status, 403)
  assert.equal((await Telegram.hook(env, new Request('https://swarms.example/telegram', { body, headers: { 'x-telegram-bot-api-secret-token': 'nope' }, method: 'POST' }))).status, 403)
  const ok = await Telegram.hook(env, new Request('https://swarms.example/telegram', { body, headers: { 'x-telegram-bot-api-secret-token': 'shh' }, method: 'POST' }))
  assert.equal(ok.status, 200)
  assert.equal(((await ok.json()) as { method: string }).method, 'sendMessage')
})

test('a start parameter can name a node of a swarm', () => {
  assert.equal(Telegram.started(new URL('https://swarms.example/tg?tgWebAppStartParam=pnp__3fa91c2b0d')), 'pnp')
  assert.equal(Telegram.node(new URL('https://swarms.example/tg?tgWebAppStartParam=pnp__3fa91c2b0d')), '3fa91c2b0d')
  assert.equal(Telegram.node(new URL('https://swarms.example/tg?tgWebAppStartParam=pnp')), undefined)
  const chat = { id: 7, type: 'private' }
  const leaf = Telegram.answer({ message: { chat, text: '/start pnp__root' } }, 'https://swarms.example')
  assert.deepEqual(leaf?.reply_markup.inline_keyboard[0]?.[0], { text: 'Open this node', web_app: { url: 'https://swarms.example/tg/s/pnp/n/root' } })
  assert.doesNotMatch(leaf?.text ?? '', /fund/i)
})

const node = (status: 'proven' | 'in flight') => ({
  by: { address: null, agent: null, handle: 'ana' },
  children: [],
  counts: { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 1 },
  createdAt: 1,
  end: null,
  form: 'lemma' as const,
  funders: [],
  id: '3fa91c2b0d',
  money: { committed: '0.000000', granted: '0.000000', inherited: '0.000000', left: '0.000000', pledged: '0.000000', spent: '1.000000', subtree: { left: '0.000000', pledged: '0.000000', spent: '1.000000' } },
  needs: [],
  parent: 'root',
  proof: { at: 5, axioms: [], checker: 'lean4checker', command: 'lake build', commit: 'abc1234def', contentHash: 'x', durationMs: 1, exitCode: 0, mathlib: 'm', repo: 'r', run: '1', statement: 's', theorem: 't', toolchain: 'l', url: 'https://github.com/example/proofs/actions/runs/1' },
  riders: 0,
  run: null,
  spec: '',
  statement: null,
  status,
  title: 'Parity is not in AC0',
  updatedAt: 1,
})

test('a proof is announced to the channel with a button that opens its node', async () => {
  const message = Telegram.notice('https://swarms.example', 'TempoSwarmsBot', 'pnp', 'Does P = NP?', { at: 1, event: 'proven', node: node('proven'), seq: 1, text: '' })
  assert.equal(message?.text, 'Does P = NP?\nProven, checked by Lean at abc1234: Parity is not in AC0\nhttps://swarms.example/s/pnp/n/3fa91c2b0d')
  assert.deepEqual(message?.reply_markup.inline_keyboard[0]?.[0], { text: 'See the proof', url: 'https://t.me/TempoSwarmsBot?startapp=pnp__3fa91c2b0d' })
  assert.equal(Telegram.notice('https://swarms.example', undefined, 'pnp', 'Does P = NP?', { at: 1, event: 'progress', node: node('in flight'), seq: 2, text: '' }), undefined)
  const env = { SWARMS_URL: 'https://swarms.example' } as unknown as Cloudflare.Env
  assert.equal(await Telegram.announce(env, 'pnp', 'Does P = NP?', { at: 1, event: 'proven', node: node('proven'), seq: 1, text: '' }), false)
})

