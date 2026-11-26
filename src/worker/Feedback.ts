import { Handler } from 'nanocode-ts/feedback/server'
import { z } from 'zod'
import { assert, never } from '../shared/Assert.ts'
import * as Limits from '../shared/Limits.ts'
import * as Site from '../shared/Site.ts'
import * as Gateway from './Gateway.ts'
import * as Problem from './Problem.ts'
import * as Store from './Store.ts'

export const path = '/feedback'

export async function feedback(env: Cloudflare.Env) {
  const key = await Gateway.key(env)
  return Handler.feedback({
    accept: (context) => [new URL(context.request.url).origin, new URL(Site.url(env, context.request.url)).origin].includes(context.request.headers.get('origin') ?? ''),
    app: 'swarms-site',
    fetch: (request) => send(env, request),
    gateway: env.GATEWAY_URL,
    key,
    path,
    repo: 'swarms',
  })
}

async function send(env: Cloudflare.Env, request: Request) {
  const wallet = new URL(request.url).pathname === '/api/keys/me' ? await Gateway.wallet(env) : undefined
  if (wallet) return Response.json({ wallet })
  return 'GATEWAY' in env && env.GATEWAY ? env.GATEWAY.fetch(request) : fetch(request)
}

export const schema = z.object({
  context: z.string().trim().max(Limits.Feedback.contextMost).optional().describe('What helps reproduce it: the calls made, ids, the exact error that came back. Never credentials.'),
  kind: z.enum(['bug', 'feature', 'question', 'other']).default('bug').describe('bug, feature, question or other.'),
  message: z.string().trim().min(Limits.Feedback.messageLeast).max(Limits.Feedback.messageMost).describe('What was tried, what was expected and what happened.'),
  swarm: z.string().trim().min(1).max(Limits.Feedback.swarmMost).optional().describe('The swarm it is about, the last part of its page URL /s/<id>.'),
})

const answer = z
  .object({
    detail: z.string().optional().catch(undefined),
    id: z.string().optional().catch(undefined),
    link: z.string().optional().catch(undefined),
    reason: z.string().optional().catch(undefined),
  })
  .catch({})

export type Filing = { at: 'filed'; id: string; link: string } | { at: 'failed'; why: string }

export function filing(ok: boolean, status: number, raw: unknown): Filing {
  const found = answer.parse(raw)
  if (!ok || !found.id || !found.link) return { at: 'failed', why: found.detail ?? found.reason ?? `status ${status}` }
  assert(found.id.length > 0 && found.link.length > 0, 'a filed report has an id and a link', found)
  return { at: 'filed', id: found.id, link: found.link }
}

export async function file(env: Cloudflare.Env, input: unknown): Promise<Problem.Result<{ id: string; link: string }>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return Problem.invalid(parsed.error)
  const report = parsed.data
  if (report.swarm && !(await Store.exists(env, report.swarm))) return Problem.fail(Limits.Http.missing, 'not_found', 'No swarm has this id.')

  const origin = new URL(env.SWARMS_URL).origin
  const response = await (await feedback(env)).fetch(
    new Request(origin + path, {
      body: JSON.stringify({
        comments: [{ note: report.context ? `${report.message}\n\n${report.context}` : report.message, rect: { height: 0, width: 0, x: 0, y: 0 }, selector: 'api', tag: report.kind, text: '' }],
        title: `${report.kind} sent over the API${report.swarm ? ` about swarm ${report.swarm}` : ''}`,
        url: report.swarm ? `${Site.home(env)}/s/${report.swarm}` : Site.home(env) + '/',
        viewport: { height: 0, width: 0 },
      }),
      headers: { 'content-type': 'application/json', origin },
      method: 'POST',
    }),
  )
  const filed = filing(response.ok, response.status, await response.json().catch(() => ({})))
  switch (filed.at) {
    case 'failed':
      return Problem.fail(Limits.Http.upstream, 'upstream_failed', `The report was not filed: ${filed.why}`)
    case 'filed':
      return Problem.ok({ id: filed.id, link: new URL(filed.link, origin).href })
    default:
      return never(filed, 'feedback filing')
  }
}
