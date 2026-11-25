import * as Posters from './Posters.ts'
import * as Site from '../shared/Site.ts'

export { Lobby } from './Lobby.ts'
export { Swarm } from './Swarm.ts'

export default {
  fetch(request: Request, env: Cloudflare.Env) {
    const url = new URL(request.url)
    const { path } = Site.place(url)
    if ((request.method === 'GET' || request.method === 'HEAD') && path.startsWith('/og/') && !Site.www(url)) {
      url.pathname = path
      return Posters.serve(env, new Request(url, request))
    }
    return env.SITE.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>
