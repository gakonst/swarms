import type { Artifact } from '../shared/Api.ts'
import * as Shelf from '../shared/Artifact.ts'
import * as Gateway from './Gateway.ts'
import * as Timing from './Timing.ts'

const fresh = 15_000

const cdns = ['https://cdn.jsdelivr.net', 'https://unpkg.com', 'https://cdnjs.cloudflare.com', 'https://esm.sh']

const listed = new Map<string, { at: number; artifacts: Artifact[] }>()

type Entry = { key: string; value: unknown; version: number }

export function base(swarm: string) {
  return `/a/${encodeURIComponent(swarm)}`
}

export async function list(env: Cloudflare.Env, swarm: string, cached = true): Promise<Artifact[] | undefined> {
  const memo = listed.get(swarm)
  if (cached && memo && Date.now() - memo.at < fresh) return memo.artifacts
  const key = new Request(`https://swarms.cache/artifacts/${swarm}`)
  const shared = cached ? await Timing.span('cache', caches.default.match(key).catch(() => undefined)) : undefined
  if (shared) {
    const artifacts = (await shared.json()) as Artifact[]
    listed.set(swarm, { artifacts, at: Number(shared.headers.get('x-listed-at')) || Date.now() - fresh / 2 })
    return artifacts
  }
  const owner = await Gateway.wallet(env)
  if (!owner) return undefined
  const entries: Entry[] = []
  let cursor: string | null = null
  for (let page = 0; page < 3; page++) {
    const query: URLSearchParams = new URLSearchParams({ prefix: Shelf.prefix, ...(cursor ? { cursor } : {}) })
    const [response, body]: readonly [Response, { cursor: string | null; entries: Entry[] } | undefined] = await Timing.span(
      'gw.p.kv',
      Gateway.call(env, `/p/${owner}/${Gateway.app(swarm)}/kv?${query}`, { headers: { accept: 'application/json' } }).then(
        async (response) => [response, response.ok ? ((await response.json()) as { cursor: string | null; entries: Entry[] }) : undefined] as const,
      ),
    )
    if (!response.ok || !body) return response.status === 404 ? [] : undefined
    entries.push(...body.entries)
    cursor = body.cursor
    if (!cursor) break
  }
  const artifacts = entries.flatMap((entry) => Shelf.read(entry.key, entry.value, entry.version, base(swarm)) ?? [])
  listed.set(swarm, { artifacts, at: Date.now() })
  await caches.default.put(key, new Response(JSON.stringify(artifacts), { headers: { 'cache-control': `max-age=${fresh / 1000}`, 'content-type': 'application/json', 'x-listed-at': String(Date.now()) } })).catch(() => undefined)
  return artifacts
}

export function policy(origin: string, gateway: string) {
  const sources = [origin, gateway].join(' ')
  return [
    'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals',
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${sources} ${cdns.join(' ')}`,
    `style-src 'unsafe-inline' ${sources} ${cdns.join(' ')} https://fonts.googleapis.com`,
    `font-src data: ${sources} ${cdns.join(' ')} https://fonts.gstatic.com`,
    `img-src data: blob: ${sources}`,
    `media-src data: blob: ${sources}`,
    `connect-src ${sources}`,
    `worker-src blob:`,
    `frame-ancestors ${origin}`,
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ')
}

export async function serve(env: Cloudflare.Env, request: Request, swarm: string, name: string, rest: string) {
  const origin = new URL(request.url).origin
  const file = Shelf.path(rest || 'index.html')
  if (!Shelf.slug.test(name) || !file) return text(404, 'No such artifact file.')
  const owner = await Gateway.wallet(env)
  if (!owner) return text(502, 'The gateway did not say whose artifacts these are.')

  const headers = new Headers()
  for (const header of ['if-none-match', 'range', 'cf-connecting-ip']) {
    const value = request.headers.get(header)
    if (value) headers.set(header, value)
  }
  const key = [Shelf.prefix + name, ...file.split('/')].map(encodeURIComponent).join('/')
  const upstream = await Timing.span('gw.p.bucket', Gateway.call(env, `/p/${owner}/${Gateway.app(swarm)}/bucket/${key}`, { headers, method: request.method === 'HEAD' ? 'HEAD' : 'GET' }))
  if (upstream.status === 404) return text(404, 'No such artifact file, or it is not public.')
  if (upstream.status === 429) return text(429, 'Too many artifact reads right now. Try again in a minute.')
  if (!upstream.ok && upstream.status !== 304 && upstream.status !== 206) return text(502, `The gateway answered ${upstream.status}.`)

  const answer = new Headers({
    'access-control-allow-origin': '*',
    'cache-control': 'public, max-age=60',
    'content-security-policy': policy(origin, new URL(env.GATEWAY_URL).origin),
    'cross-origin-resource-policy': 'cross-origin',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
  })
  for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified'])
    if (upstream.headers.get(header)) answer.set(header, upstream.headers.get(header) ?? '')
  return new Response(upstream.status === 304 ? null : upstream.body, { headers: answer, status: upstream.status })
}

function text(status: number, detail: string) {
  return new Response(detail, { headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' }, status })
}
