import { z } from 'zod'
import * as Words from './Words.ts'

type Hooked = Cloudflare.Env & { TELEGRAM_WEBHOOK_SECRET?: string }

const views = ['join', 'start']

const update = z.object({
  message: z
    .object({
      chat: z.object({ id: z.number(), type: z.string() }),
      text: z.string().optional(),
    })
    .optional(),
})

export function started(url: URL) {
  const given = url.searchParams.get('tgWebAppStartParam') ?? ''
  return /^[A-Za-z0-9_-]{1,64}$/.test(given) && !views.includes(given) ? given : undefined
}

export function answer(body: unknown, origin: string) {
  const parsed = update.safeParse(body)
  const message = parsed.success ? parsed.data.message : undefined
  if (!message || message.chat.type !== 'private') return undefined
  const [, given = ''] = (message.text ?? '').trim().split(/\s+/)
  const swarm = /^[A-Za-z0-9_-]{1,64}$/.test(given) && !views.includes(given) ? given : undefined
  const path = swarm ? `/tg/s/${encodeURIComponent(swarm)}` : views.includes(given) ? `/tg?view=${given}` : '/tg'
  return {
    chat_id: message.chat.id,
    method: 'sendMessage',
    reply_markup: { inline_keyboard: [[{ text: swarm ? 'Open this swarm' : 'Open Swarms', web_app: { url: `${origin}${path}` } }]] },
    text: swarm
      ? 'Watch this swarm work live, steer it, or fund it.'
      : 'Swarms are research projects an AI works on in the open, funded by the people who want the answer. Start a breakthrough, or be part of one already running.',
  }
}

export async function hook(env: Hooked, request: Request) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || !Words.same(request.headers.get('x-telegram-bot-api-secret-token') ?? '', secret)) return new Response('Forbidden', { status: 403 })
  const reply = answer(await request.json().catch(() => null), env.SWARMS_URL)
  return reply ? Response.json(reply) : new Response(null, { status: 200 })
}
