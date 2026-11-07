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
