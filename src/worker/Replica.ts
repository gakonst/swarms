export const cookie = 'swarms_d1'

export const header = 'x-d1-bookmark'

const primaries = new WeakMap<Cloudflare.Env, Cloudflare.Env>()

const swarm = /^\/(api|v1)\/swarms(\/[^/]+(\/(feed|code|git\/[^/]+|live|artifacts|chat|chat\/live|hands|answer|updates|search|wait|machines|backers|pledges|team|branches))?)?$/

const pages = /^\/(|join|new|about|docs|x|x\/s\/[^/]+|s\/[^/]+|s\/[^/]+\/code)$/

export function readable(method: string, path: string) {
  if (method !== 'GET' && method !== 'HEAD') return false
  return swarm.test(path) || pages.test(path) || /^\/(api|v1)\/me$/.test(path) || /^\/v1\/(search|problems)$/.test(path)
}

export function writes(method: string, path: string) {
  if (/^\/v1\/swarms\/[^/]+\/pledges\/[^/]+$/.test(path)) return true
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  return /^\/(api|v1)\//.test(path) && !/^\/api\/swarms\/[^/]+\/pay$/.test(path) && !path.startsWith('/v1/auth')
}

export function bookmark(request: Request) {
  const given = request.headers.get(header) ?? new RegExp(`(?:^|;\\s*)${cookie}=([^;]+)`).exec(request.headers.get('cookie') ?? '')?.[1]
  return given && /^[0-9a-f]{8}(-[0-9a-f]{8,64}){3}$/i.test(given) ? given : undefined
}

export function read(env: Cloudflare.Env, request: Request): Cloudflare.Env {
  const session = env.DB.withSession(bookmark(request) ?? 'first-unconstrained')
  const replica: Cloudflare.Env = { ...env, DB: database(session, env.DB) }
  primaries.set(replica, env)
  return replica
}

export function primary(env: Cloudflare.Env) {
  return primaries.get(env) ?? env
}

export function replicated(env: Cloudflare.Env) {
  return primaries.has(env)
}

export async function mark(env: Cloudflare.Env, response: Response) {
  const session = primary(env).DB.withSession('first-primary')
  await session.prepare('select 1').first()
  const bookmark = session.getBookmark()
  if (!bookmark) return response
  const marked = new Response(response.body, response)
  marked.headers.set(header, bookmark)
  marked.headers.append('set-cookie', `${cookie}=${bookmark}; Path=/; Max-Age=300; SameSite=Lax; Secure; HttpOnly`)
  return marked
}

function database(session: D1DatabaseSession, db: D1Database): D1Database {
  return {
    batch: <T>(statements: D1PreparedStatement[]) => session.batch<T>(statements),
    dump: () => db.dump(),
    exec: (query: string) => db.exec(query),
    prepare: (query: string) => session.prepare(query),
    withSession: (constraint?: string) => db.withSession(constraint),
  }
}
