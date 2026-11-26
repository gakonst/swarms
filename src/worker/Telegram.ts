import { z } from 'zod'
import * as Site from '../shared/Site.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Filled from './Filled.ts'
import * as Share from './Share.ts'
import * as Words from './Words.ts'
import * as Limits from '../shared/Limits.ts'

type Hooked = Cloudflare.Env & { TELEGRAM_WEBHOOK_SECRET?: string }

type Posting = Cloudflare.Env & { TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHANNEL?: string }

const views = ['join', 'start']

const update = z.object({
  message: z
    .object({
      chat: z.object({ id: z.number(), type: z.string() }),
      text: z.string().optional(),
    })
    .optional(),
})

export function opened(given: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(given) || views.includes(given)) return undefined
  const leaf = /^(.+?)__([a-z0-9]{1,16})$/.exec(given)
  return leaf ? { node: leaf[2], swarm: leaf[1] ?? '' } : { node: undefined, swarm: given }
}

export function started(url: URL) {
  return opened(url.searchParams.get('tgWebAppStartParam') ?? '')?.swarm
}

export function node(url: URL) {
  return opened(url.searchParams.get('tgWebAppStartParam') ?? '')?.node
}

export function answer(body: unknown, origin: string) {
  const parsed = update.safeParse(body)
  const message = parsed.success ? parsed.data.message : undefined
  if (!message || message.chat.type !== 'private') return undefined
  const [, given = ''] = (message.text ?? '').trim().split(/\s+/)
  const asked = opened(given)
  const path = asked?.node ? `/tg/s/${encodeURIComponent(asked.swarm)}/n/${asked.node}` : asked ? `/tg/s/${encodeURIComponent(asked.swarm)}` : views.includes(given) ? `/tg?view=${given}` : '/tg'
  return {
    chat_id: message.chat.id,
    method: 'sendMessage',
    reply_markup: { inline_keyboard: [[{ text: asked?.node ? 'Open this node' : asked ? 'Open this swarm' : 'Open Swarms', web_app: { url: `${origin}${path}` } }]] },
    text: asked?.node
      ? 'See where this node stands, what it spent and, once Lean checks it, its proof. Ride it with a few dollars.'
      : asked
        ? 'Watch this swarm work live, and ride it with a few dollars.'
        : 'Swarms are AI agents that research and build in the open, paid for by the riders who want the result. Ride a lemma, a program or a whole swarm.',
  }
}

export function notice(origin: string, bot: string | undefined, swarm: string, title: string, delta: Tree.Delta) {
  const found = Share.announce(origin, swarm, title, delta)
  if (!found) return undefined
  const open = bot ? `https://t.me/${bot}?startapp=${encodeURIComponent(swarm)}__${delta.node.id}` : found.url
  return {
    disable_web_page_preview: false,
    reply_markup: { inline_keyboard: [[{ text: delta.node.status === 'proven' ? 'See the proof' : 'See the dead end', url: open }]] },
    text: `${found.text}\n${found.url}`,
  }
}

export async function announce(env: Posting, swarm: string, title: string, delta: Tree.Delta) {
  const token = await Filled.secret(env, 'TELEGRAM_BOT_TOKEN')
  const channel = env.TELEGRAM_CHANNEL
  if (!token || !channel) return false
  const message = notice(Site.home(env), env.TELEGRAM_BOT, swarm, title, delta)
  if (!message) return false
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { body: JSON.stringify({ chat_id: channel, ...message }), headers: { 'content-type': 'application/json' }, method: 'POST' }).catch(() => undefined)
  return response?.ok ?? false
}

export async function hook(env: Hooked, request: Request) {
  const secret = await Filled.secret(env, 'TELEGRAM_WEBHOOK_SECRET')
  if (!secret || !Words.same(request.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) return new Response('Forbidden', { status: Limits.Http.forbidden })
  const reply = answer(await request.json().catch(() => null), Site.home(env))
  return reply ? Response.json(reply) : new Response(null, { status: Limits.Http.ok })
}
