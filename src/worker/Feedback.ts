import { Handler } from 'nanocode-ts/feedback/server'

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
