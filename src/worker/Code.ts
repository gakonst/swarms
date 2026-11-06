import * as Gateway from './Gateway.ts'
import * as Store from './Store.ts'
import * as Timing from './Timing.ts'

const sha = /^[0-9a-f]{40}$/

const reads = ['diff', 'files', 'log', 'read'] as const

export type Read = (typeof reads)[number]

export function readable(value: string): value is Read {
  return (reads as readonly string[]).includes(value)
}

export function lasting(read: Read, query: URLSearchParams) {
  if (read === 'log') return false
  const ref = query.get('ref') ?? ''
  const base = query.get('base')
  return sha.test(ref) && (base === null || sha.test(base))
}

export async function proxy(env: Cloudflare.Env, context: Pick<ExecutionContext, 'waitUntil'>, request: Request, swarm: string, read: Read) {
  const url = new URL(request.url)
  const query = new URLSearchParams([...url.searchParams].filter(([name]) => name !== 'at' && name !== 'v').sort(([a], [b]) => a.localeCompare(b)))
  const forever = lasting(read, query)
  const key = new Request(`${url.origin}/api/swarms/${encodeURIComponent(swarm)}/git/${read}?${query}`)
  const cache = caches.default
  const hit = await cache.match(key).catch(() => undefined)
  if (hit) return hit

  const [repo, owner] = await Promise.all([Store.repo(env, swarm), Gateway.wallet(env)])
  if (!repo || !owner) return Response.json({ code: 'not_found', detail: 'This swarm has no repository yet.', status: 404 }, { status: 404 })
  const [upstream, body] = await Timing.span(
    'gw.p.git',
    fetch(`${env.GATEWAY_URL}/p/${owner}/${Gateway.app(swarm)}/git/${encodeURIComponent(repo)}/${read}?${query}${forever ? '' : `&at=${Math.floor(Date.now() / 5000)}`}`, { headers: { accept: 'application/json' } }).then(async (response) => [response, await response.arrayBuffer()] as const),
  )
  const response = new Response(body, {
    headers: {
      'cache-control': upstream.ok ? (forever ? 'public, max-age=31536000, immutable' : 'public, max-age=5') : 'no-store',
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
    status: upstream.status,
  })
  if (upstream.ok) context.waitUntil(cache.put(key, response.clone()).catch(() => undefined))
  return response
}
