import type { Snapshot } from '../shared/Api.ts'
import * as Gateway from './Gateway.ts'
import * as Storage from './Storage.ts'
import * as Store from './Store.ts'
import * as Timing from './Timing.ts'
import * as Limits from '../shared/Limits.ts'

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
  if (!repo || !owner) return Response.json({ code: 'not_found', detail: 'This swarm has no repository yet.', status: Limits.Http.missing }, { status: Limits.Http.missing })
  const [upstream, body] = await Timing.span(
    'gw.p.git',
    Gateway.call(env, `/p/${owner}/${Gateway.app(swarm)}/git/${encodeURIComponent(repo)}/${read}?${query}${forever ? '' : `&at=${Math.floor(Date.now() / Limits.WorkerCode.bucketMs)}`}`, { headers: { accept: 'application/json', ...(request.headers.get('cf-connecting-ip') ? { 'cf-connecting-ip': request.headers.get('cf-connecting-ip') ?? '' } : {}) } }).then(async (response) => [response, await response.arrayBuffer()] as const),
  )
  if (upstream.status === Storage.status) {
    const text = new TextDecoder().decode(body)
    const snapshot = Storage.unpaid(upstream.status, text) ? ((await Timing.object(env.SWARMS.get(env.SWARMS.idFromName(swarm))).code()) as Snapshot | null) : null
    const degraded = Storage.degraded(read, query, snapshot, upstream.status, text)
    if (degraded) return Response.json(degraded.body, { headers: { 'cache-control': 'no-store', [Storage.header]: degraded.snapshot ? 'treasury; snapshot' : 'treasury' } })
  }
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
