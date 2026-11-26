import { waitUntil } from 'cloudflare:workers'
import { Held, limits } from './Held.ts'
import * as Timing from './Timing.ts'
import * as Limits from '../shared/Limits.ts'

const memory = new Held<unknown>(limits.edge)

const refreshing = new Held<true>(limits.refreshes)

export async function cached<T>(env: Cloudflare.Env, key: string, seconds: number, read: () => Promise<T>, stale: number = seconds * Limits.Edge.staleFactor, patience = 0): Promise<T> {
  const now = Date.now()
  const local = memory.entry(key, now)
  if (local && now - local.at < seconds * 1000) return local.value as T
  const request = new Request(new URL(`/__cache/${key}`, env.SWARMS_URL))
  const colo = await shared(request)
  const kept = local && (!colo || local.at >= colo.at) ? local : colo
  if (kept && now - kept.at < seconds * 1000) {
    memory.set(key, kept.value, kept.at)
    return kept.value as T
  }
  if (kept && now - kept.at < stale * 1000) {
    memory.set(key, kept.value, kept.at)
    if (refreshing.has(key, now)) return kept.value as T
    refreshing.set(key, true, now)
    const task = refresh(key, request, stale, read).finally(() => refreshing.delete(key))
    const raced = patience > 0 ? await Promise.race([task.then((value) => ({ value }), () => undefined), new Promise<undefined>((resolve) => setTimeout(resolve, patience))]) : undefined
    if (raced) return raced.value as T
    waitUntil(task.catch(() => undefined))
    return kept.value as T
  }
  return (await refresh(key, request, stale, read)) as T
}

export async function held<T>(env: Cloudflare.Env, key: string): Promise<T | undefined> {
  const hit = await Timing.span('cache', caches.default.match(new Request(new URL(`/__cache/${key}`, env.SWARMS_URL))).catch(() => undefined))
  return hit ? ((await hit.json().catch(() => undefined)) as T | undefined) : undefined
}

export function hold<T>(env: Cloudflare.Env, key: string, value: T, seconds: number) {
  waitUntil(caches.default.put(new Request(new URL(`/__cache/${key}`, env.SWARMS_URL)), Response.json(value, { headers: { 'cache-control': `public, max-age=${seconds}` } })).catch(() => undefined))
}

export function put<T>(env: Cloudflare.Env, key: string, value: T, stale: number) {
  const at = Date.now()
  memory.set(key, value, at)
  waitUntil(
    caches.default
      .put(new Request(new URL(`/__cache/${key}`, env.SWARMS_URL)), Response.json(value, { headers: { 'cache-control': `public, max-age=${stale}`, 'x-cached-at': String(at) } }))
      .catch(() => undefined),
  )
}

export function tag(kind: string, request: Request, version: string, salt = '') {
  const url = new URL(request.url)
  let hash: number = Limits.Edge.fnvOffset
  for (const char of `${url.pathname}${url.search}|${salt}`) hash = Math.imul(hash ^ char.charCodeAt(0), Limits.Edge.fnvPrime)
  return `W/"${kind}${(hash >>> 0).toString(Limits.Edge.tagRadix)}.${version}"`
}

export function asked(request: Request, kind: string) {
  return (request.headers.get('if-none-match') ?? '').includes(`W/"${kind}`)
}

export function matches(request: Request, tag: string) {
  return (request.headers.get('if-none-match') ?? '').split(',').some((given) => given.trim() === tag)
}

export function unchanged(tag: string) {
  return new Response(null, { headers: { 'cache-control': 'no-cache', etag: tag }, status: Limits.Http.notModified })
}

export function tagged(response: Response, tag: string | undefined) {
  if (!tag || response.status !== Limits.Http.ok) return response
  response.headers.set('etag', tag)
  response.headers.set('cache-control', 'no-cache')
  return response
}

export function minute() {
  return String(Math.floor(Date.now() / Limits.Clock.minuteMs))
}

async function shared(request: Request) {
  const hit = await Timing.span('cache', caches.default.match(request).catch(() => undefined))
  if (!hit) return undefined
  return { at: Number(hit.headers.get('x-cached-at') ?? 0), value: await hit.json() }
}

function refresh<T>(key: string, request: Request, stale: number, read: () => Promise<T>) {
  return read().then((value) => {
    const at = Date.now()
    memory.set(key, value, at)
    waitUntil(
      caches.default
        .put(request, Response.json(value, { headers: { 'cache-control': `public, max-age=${stale}`, 'x-cached-at': String(at) } }))
        .catch(() => undefined),
    )
    return value
  })
}
const drawn = new Held<Drawn>(limits.pages)

const drawing = new Held<true>(limits.draws)

const pageFresh = Limits.Edge.pageFresh

const pageStale = limits.pages.ms

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
  const kept = drawn.get(key.url, now) ?? (await recall(key))
  if (kept && now - kept.at < pageStale) {
    if (now - kept.at >= pageFresh && !drawing.has(key.url, now)) {
      const again = new Request(request.url, { headers: request.headers })
      const task = draw(again)
        .then(({ response, whole }) => keepPage(key, response, whole))
        .catch(() => undefined)
        .finally(() => drawing.delete(key.url))
      drawing.set(key.url, true, now)
      waitUntil(task)
    }
    return served(kept, now - kept.at < pageFresh ? 'hit' : 'stale')
  }
  const { response, whole } = await draw(request)
  if (response.status !== Limits.Http.ok || !response.body) return response
  const [mine, theirs] = response.body.tee()
  waitUntil(keepPage(key, new Response(theirs, response), whole).catch(() => undefined))
  const fresh = new Response(mine, response)
  fresh.headers.set('x-page-cache', 'miss')
  return fresh
}

function served(kept: Drawn, state: string) {
  const headers = new Headers(kept.headers)
  headers.set('x-page-cache', state)
  return new Response(kept.body, { headers, status: Limits.Http.ok })
}

async function keepPage(key: Request, response: Response, whole: Promise<boolean>) {
  const body = await response.arrayBuffer()
  if (response.status !== Limits.Http.ok || !(await whole)) return
  const at = Date.now()
  const headers = [...response.headers].filter(([name]) => name !== 'set-cookie' && name !== 'x-page-cache')
  drawn.set(key.url, { at, body, headers }, at)
  const copy = new Headers(headers)
  copy.set('cache-control', `public, max-age=${pageStale / 1000}`)
  copy.set('x-drawn-at', String(at))
  await caches.default.put(key, new Response(body, { headers: copy })).catch(() => undefined)
}

async function recall(key: Request): Promise<Drawn | undefined> {
  const hit = await Timing.span('cache', caches.default.match(key).catch(() => undefined))
  if (!hit) return undefined
  const at = Number(hit.headers.get('x-drawn-at') ?? 0)
  const headers = [...hit.headers].filter(([name]) => !['age', 'cache-control', 'cf-cache-status', 'content-encoding', 'content-length', 'expires', 'x-drawn-at'].includes(name))
  const kept = { at, body: await hit.arrayBuffer(), headers: [...headers, ['cache-control', 'private, no-cache'] as [string, string]] }
  if (Date.now() - at < pageStale) drawn.set(key.url, kept, at)
  return kept
}
