import { waitUntil } from 'cloudflare:workers'

const memory = new Map<string, { at: number; value: unknown }>()

const refreshing = new Map<string, Promise<unknown>>()

export async function cached<T>(env: Cloudflare.Env, key: string, seconds: number, read: () => Promise<T>, stale = seconds * 3): Promise<T> {
  const now = Date.now()
  const local = memory.get(key)
  if (local && now - local.at < seconds * 1000) return local.value as T
  const request = new Request(new URL(`/__cache/${key}`, env.SWARMS_URL))
  const kept = local ?? (await shared(request))
  if (kept && now - kept.at < seconds * 1000) {
    memory.set(key, kept)
    return kept.value as T
  }
  if (kept && now - kept.at < stale * 1000) {
    memory.set(key, kept)
    waitUntil(refresh(key, request, stale, read).catch(() => undefined))
    return kept.value as T
  }
  return (await refresh(key, request, stale, read)) as T
}

export function put<T>(env: Cloudflare.Env, key: string, value: T, stale: number) {
  const at = Date.now()
  memory.set(key, { at, value })
  waitUntil(
    caches.default
      .put(new Request(new URL(`/__cache/${key}`, env.SWARMS_URL)), Response.json(value, { headers: { 'cache-control': `public, max-age=${stale}`, 'x-cached-at': String(at) } }))
      .catch(() => undefined),
  )
}

export function tag(kind: string, request: Request, version: string, salt = '') {
  const url = new URL(request.url)
  let hash = 0x811c9dc5
  for (const char of `${url.pathname}${url.search}|${salt}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  return `W/"${kind}${(hash >>> 0).toString(36)}.${version}"`
}

export function asked(request: Request, kind: string) {
  return (request.headers.get('if-none-match') ?? '').includes(`W/"${kind}`)
}

export function matches(request: Request, tag: string) {
  return (request.headers.get('if-none-match') ?? '').split(',').some((given) => given.trim() === tag)
}

export function unchanged(tag: string) {
  return new Response(null, { headers: { 'cache-control': 'no-cache', etag: tag }, status: 304 })
}

export function tagged(response: Response, tag: string | undefined) {
  if (!tag || response.status !== 200) return response
  response.headers.set('etag', tag)
  response.headers.set('cache-control', 'no-cache')
  return response
}

export function minute() {
  return String(Math.floor(Date.now() / 60_000))
}

async function shared(request: Request) {
  const hit = await caches.default.match(request).catch(() => undefined)
  if (!hit) return undefined
  return { at: Number(hit.headers.get('x-cached-at') ?? 0), value: await hit.json() }
}

function refresh<T>(key: string, request: Request, stale: number, read: () => Promise<T>) {
  const running = refreshing.get(key)
  if (running) return running as Promise<T>
  const task = read()
    .then((value) => {
      const at = Date.now()
      memory.set(key, { at, value })
      waitUntil(
        caches.default
          .put(request, Response.json(value, { headers: { 'cache-control': `public, max-age=${stale}`, 'x-cached-at': String(at) } }))
          .catch(() => undefined),
      )
      return value
    })
    .finally(() => refreshing.delete(key))
  refreshing.set(key, task)
  return task
}
const drawn = new Map<string, Drawn>()

const drawing = new Map<string, Promise<void>>()

const pageFresh = 5_000

const pageStale = 600_000

type Drawn = { at: number; body: ArrayBuffer; headers: [string, string][] }

export type Draw = (request: Request) => Promise<{ response: Response; whole: Promise<boolean> }>

export function anonymous(request: Request) {
  if (request.headers.has('authorization')) return false
  if (/(?:^|;\s*)(swarms_face|swarms_d1)=/.test(request.headers.get('cookie') ?? '')) return false
  const url = new URL(request.url)
  return !url.searchParams.has('fixture') && !url.searchParams.has('scene')
}

export async function page(request: Request, variant: string, draw: Draw): Promise<Response> {
  if ((request.method !== 'GET' && request.method !== 'HEAD') || !anonymous(request)) return (await draw(request)).response
  const url = new URL(request.url)
  const search = new URLSearchParams(url.search)
  search.set('__variant', variant)
  search.sort()
  const key = new Request(new URL(`/__page${url.pathname}?${search}`, url.origin))
  const now = Date.now()
  const kept = drawn.get(key.url) ?? (await recall(key))
  if (kept && now - kept.at < pageStale) {
    if (now - kept.at >= pageFresh && !drawing.has(key.url)) {
      const again = new Request(request.url, { headers: request.headers })
      const task = draw(again)
        .then(({ response, whole }) => keepPage(key, response, whole))
        .catch(() => undefined)
        .finally(() => drawing.delete(key.url))
      drawing.set(key.url, task)
      waitUntil(task)
    }
    return served(kept, now - kept.at < pageFresh ? 'hit' : 'stale')
  }
  const { response, whole } = await draw(request)
  if (response.status !== 200 || !response.body) return response
  const [mine, theirs] = response.body.tee()
  waitUntil(keepPage(key, new Response(theirs, response), whole).catch(() => undefined))
  const fresh = new Response(mine, response)
  fresh.headers.set('x-page-cache', 'miss')
  return fresh
}

function served(kept: Drawn, state: string) {
  const headers = new Headers(kept.headers)
  headers.set('x-page-cache', state)
  return new Response(kept.body, { headers, status: 200 })
}

async function keepPage(key: Request, response: Response, whole: Promise<boolean>) {
  const body = await response.arrayBuffer()
  if (response.status !== 200 || !(await whole)) return
  const at = Date.now()
  const headers = [...response.headers].filter(([name]) => name !== 'set-cookie' && name !== 'x-page-cache')
  drawn.delete(key.url)
  drawn.set(key.url, { at, body, headers })
  for (const old of drawn.keys()) {
    if (drawn.size <= 48) break
    drawn.delete(old)
  }
  const copy = new Headers(headers)
  copy.set('cache-control', `public, max-age=${pageStale / 1000}`)
  copy.set('x-drawn-at', String(at))
  await caches.default.put(key, new Response(body, { headers: copy })).catch(() => undefined)
}

async function recall(key: Request): Promise<Drawn | undefined> {
  const hit = await caches.default.match(key).catch(() => undefined)
  if (!hit) return undefined
  const at = Number(hit.headers.get('x-drawn-at') ?? 0)
  const headers = [...hit.headers].filter(([name]) => !['age', 'cache-control', 'cf-cache-status', 'content-encoding', 'content-length', 'expires', 'x-drawn-at'].includes(name))
  const kept = { at, body: await hit.arrayBuffer(), headers: [...headers, ['cache-control', 'private, no-cache'] as [string, string]] }
  drawn.set(key.url, kept)
  return kept
}
