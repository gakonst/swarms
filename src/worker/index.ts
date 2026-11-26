import * as Posters from './Posters.ts'
import * as Site from '../shared/Site.ts'
import * as Signin from './Signin.ts'
import * as Timing from './Timing.ts'

export { Lobby } from './Lobby.ts'
export { Swarm } from './Swarm.ts'
export { Vault } from './Vault.ts'

export default {
  fetch(request: Request, env: Cloudflare.Env) {
    const url = new URL(request.url)
    const { path } = Site.place(url)
    if ((request.method === 'GET' || request.method === 'HEAD') && path.startsWith('/og/') && !Site.www(url)) {
      url.pathname = path
      return measured('og', () => Posters.serve(env, new Request(url, request)), request)
    }
    if (Signin.routed(request.method, path) && !Site.www(url)) return measured('signin', () => Signin.serve(env, request, path), request)
    return env.SITE.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>

function measured(name: string, work: () => Promise<Response>, request: Request) {
  return Timing.run(async () => {
    const response = await work()
    Timing.report('swarms', request.method + ' /' + name, response.status)
    const timing = Timing.header()
    if (!timing) return response
    const headers = new Headers(response.headers)
    headers.set('server-timing', timing)
    return new Response(response.body, { headers, status: response.status, statusText: response.statusText })
  }, request.headers.get('traceparent'))
}
