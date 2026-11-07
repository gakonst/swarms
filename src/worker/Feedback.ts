import { Handler } from 'nanocode-ts/feedback/server'
import { z } from 'zod'
import * as Problem from './Problem.ts'
import * as Store from './Store.ts'

export const path = '/feedback'

let handler: Handler.Handler | undefined

export function feedback(env: Cloudflare.Env) {
  handler ??= Handler.feedback({
    accept: (context) => context.request.headers.get('origin') === new URL(context.request.url).origin,
    app: 'swarms-site',
    fetch: (request) => ('GATEWAY' in env && env.GATEWAY ? env.GATEWAY.fetch(request) : fetch(request)),
    gateway: env.GATEWAY_URL,
    key: env.SWARMS_GATEWAY_KEY,
    path,
    repo: 'swarms',
  })
  return handler
}

export const schema = z.object({
  context: z.string().trim().max(8000).optional().describe('What helps reproduce it: the calls made, ids, the exact error that came back. Never credentials.'),
  kind: z.enum(['bug', 'feature', 'question', 'other']).default('bug').describe('bug, feature, question or other.'),
  message: z.string().trim().min(3).max(4000).describe('What was tried, what was expected and what happened.'),
  swarm: z.string().trim().min(1).max(64).optional().describe('The swarm it is about, the last part of its page URL /s/<id>.'),
})

export async function file(env: Cloudflare.Env, input: unknown): Promise<Problem.Result<{ id: string; link: string }>> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) return Problem.invalid(parsed.error)
  const report = parsed.data
  if (report.swarm && !(await Store.exists(env, report.swarm))) return Problem.fail(404, 'not_found', 'No swarm has this id.')

  const origin = new URL(env.SWARMS_URL).origin
  const response = await feedback(env).fetch(
    new Request(origin + path, {
      body: JSON.stringify({
        comments: [{ note: report.context ? `${report.message}\n\n${report.context}` : report.message, rect: { height: 0, width: 0, x: 0, y: 0 }, selector: 'api', tag: report.kind, text: '' }],
        title: `${report.kind} sent over the API${report.swarm ? ` about swarm ${report.swarm}` : ''}`,
        url: report.swarm ? `${origin}/s/${report.swarm}` : origin + '/',
        viewport: { height: 0, width: 0 },
      }),
      headers: { 'content-type': 'application/json', origin },
      method: 'POST',
    }),
  )
  const answer = (await response.json().catch(() => ({}))) as { detail?: string; id?: string; link?: string; reason?: string }
  if (!response.ok || !answer.id || !answer.link)
    return Problem.fail(502, 'upstream_failed', `The report was not filed: ${answer.detail ?? answer.reason ?? `status ${response.status}`}`)
  return Problem.ok({ id: answer.id, link: answer.link })
}
