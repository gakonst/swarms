import { AsyncLocalStorage } from 'node:async_hooks'
import { waitUntil } from 'cloudflare:workers'
import { render } from '#ssr'
import type { Boot, Face } from '../shared/Boot.ts'
import * as Site from '../shared/Site.ts'
import * as Surface from '../shared/Surface.ts'
import * as Artifacts from './Artifacts.ts'
import * as Edge from './Edge.ts'
import * as Og from './Og.ts'
import * as Operations from './Operations.ts'
import * as Share from './Share.ts'
import * as Store from './Store.ts'

const store = new AsyncLocalStorage<Boot>()

globalThis.__swarmsServer = { boot: () => store.getStore() }

const firstChat = 30

const listed = new Set(['/', '/ideas', '/new', '/about', '/docs', '/board'])

export function rendered(path: string) {
  return listed.has(path) || /^\/s\/[^/]+(\/chat|\/code|\/results)?\/?$/.test(path)
}

export function moved(url: URL) {
  if (url.pathname === '/join' || url.pathname === '/join/') return `/ideas${url.search}`
  return undefined
}

let template: string | undefined

async function shell(env: Cloudflare.Env, origin: string) {
  if (template !== undefined) return template
  const response = await env.ASSETS.fetch(new Request(`${origin}/index.html`))
  if (!response.ok) throw new Error(`index.html answered ${response.status}`)
  const html = await response.text()
  if (!import.meta.env?.DEV) template = html
  return html
}

function escape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function json(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

function face(cookie: string | null): Face | undefined {
  const raw = /(?:^|;\s*)swarms_face=([^;]+)/.exec(cookie ?? '')?.[1]
  if (!raw) return undefined
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Face
    if (!/^0x[0-9a-fA-F]{40}$/.test(value.address)) return undefined
    const handle = value.account?.handle
    return {
      address: value.address,
      ...(value.account && typeof handle === 'string' && handle.length <= 40 ? { account: { address: value.address, handle, name: typeof value.account.name === 'string' ? value.account.name.slice(0, 40) : null } } : {}),
      ...(typeof value.balance === 'string' && /^\d{1,30}$/.test(value.balance) ? { balance: value.balance } : {}),
    }
  } catch {
    return undefined
  }
}

function zone(cookie: string | null) {
  const raw = /(?:^|;\s*)swarms_tz=([^;]+)/.exec(cookie ?? '')?.[1]
  if (!raw) return undefined
  try {
    const value = decodeURIComponent(raw)
    new Intl.DateTimeFormat('en-GB', { timeZone: value })
    return value
  } catch {
    return undefined
  }
}

function within<T>(work: Promise<T>, ms: number) {
  return Promise.race([work, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]).catch(() => undefined)
}

type Head = Share.Share

async function gather(env: Cloudflare.Env, url: URL): Promise<{ data: Record<string, unknown>; head: Head; status: number; whole: boolean }> {
  const path = url.pathname.replace(/\/$/, '') || '/'
  const site = Site.url(env, url)
  const lost = Share.share(site, Share.listing('home', []), { title: 'Not found · Swarms' })
  const data: Record<string, unknown> = {}
  if (path === '/' || path === '/ideas' || path === '/new') {
    const list = await within(Operations.list(env, {}), 1500)
    if (list?.ok) data['swarms'] = Operations.listed(list.value)
    const problem = path === '/new' ? Share.problem(url.searchParams.get('q')) : undefined
    const subject = problem ? Share.idea(problem) : Share.listing(path === '/ideas' ? 'ideas' : path === '/new' ? 'new' : 'home', list?.ok ? list.value.swarms : [])
    return { data, head: Share.share(site, subject), status: 200, whole: !!list?.ok }
  }
  if (path === '/about' || path === '/docs') return { data, head: Share.share(site, Share.plain(path === '/about' ? 'about' : 'docs')), status: 200, whole: true }
  if (!rendered(path)) return { data, head: lost, status: 404, whole: false }
  const [, raw = '', tail] = /^\/s\/([^/]+)(\/chat|\/code|\/results)?\/?$/.exec(path) ?? []
  const id = decodeURIComponent(raw)
  const shelved = within(Operations.artifacts(env, { swarm: id }, site), 2500)
  const laid = shelved.then((read) => {
    const found = read?.ok ? read.value.artifacts.find(Surface.is) : undefined
    return found ? within(Artifacts.read(env, id, found.slug, found.entry).catch(() => undefined), 1500) : undefined
  })
  const [detail, room, updates, shelf, branched, progressed, snapshot, surface, team] = await Promise.all([
    within(Operations.detail(env, { swarm: id }, false), 2500),
    within(Operations.room(env, { swarm: id }), 2500),
    within(Operations.updates(env, { limit: 30, swarm: id }), 2500),
    shelved,
    within(Operations.branches(env, { swarm: id }), 2500),
    within(Operations.progress(env, { swarm: id }), 2500),
    tail === '/code' ? within(Operations.code(env, { swarm: id }), 2500) : undefined,
    laid,
    within(Operations.team(env, { swarm: id }), 2500),
  ])
  if (!detail) return { data, head: Share.share(site, Share.listing('home', [])), status: 200, whole: false }
  if (!detail.ok) {
    data[`!${id}`] = detail.detail
    return { data, head: lost, status: detail.status === 404 ? 404 : 200, whole: false }
  }
  data[id] = { ...detail.value, feed: [], updates: [] }
  if (room?.ok) data[`room:${id}`] = { ...room.value, messages: room.value.messages.slice(-firstChat) }
  if (updates?.ok) data[`updates:${id}`] = { updates: updates.value.updates }
  if (shelf?.ok) data[`artifacts:${id}`] = shelf.value
  if (typeof surface === 'string') data[`surface:${id}`] = surface
  if (branched?.ok) data[`branches:${id}`] = branched.value
  if (progressed?.ok) data[`progress:${id}`] = progressed.value
  if (snapshot?.ok && snapshot.value.snapshot) data[`code:${id}`] = snapshot.value.snapshot
  if (team?.ok) data[`team:${id}`] = team.value
  return {
    data,
    head: Share.share(site, Share.swarm(detail.value)),
    status: 200,
    whole: !!room?.ok && !!updates?.ok,
  }
}

export async function lost(request: Request, env: Cloudflare.Env) {
  return (await draw(request, env)).response
}

export async function page(request: Request, env: Cloudflare.Env) {
  if (Share.bot(request)) waitUntil(Og.warm(env, new URL(request.url)).catch((error: unknown) => console.error('Preview warm-up failed', error)))
  const cookie = request.headers.get('cookie')
  const build = await built(env, new URL(request.url).origin).catch(() => '')
  return Edge.page(request, `${build}|${mobile(request) ? 'm' : 'd'}|${zone(cookie) ?? ''}`, (given) => draw(given, env))
}

let build: { html: string; value: string } | undefined

async function built(env: Cloudflare.Env, origin: string) {
  const html = await shell(env, origin)
  if (build?.html === html) return build.value
  let hash = 0x811c9dc5
  for (let index = 0; index < html.length; index++) hash = Math.imul(hash ^ html.charCodeAt(index), 0x01000193)
  build = { html, value: (hash >>> 0).toString(36) }
  return build.value
}

function mobile(request: Request) {
  return /Mobi|Android|iPhone|iPad/i.test(request.headers.get('user-agent') ?? '')
}

async function draw(request: Request, env: Cloudflare.Env) {
  const url = new URL(request.url)
  const html = await shell(env, url.origin)
  if (url.searchParams.has('fixture') || url.searchParams.has('scene') || url.pathname === '/board') return { response: new Response(html.replace('</head>', '<title>Swarms</title></head>'), { headers: { 'cache-control': 'no-store', 'content-type': 'text/html; charset=utf-8' }, status: rendered(url.pathname) ? 200 : 404 }), whole: Promise.resolve(false) }
  const [before = '', after = ''] = html.split('<div id="root"></div>')
  const encoder = new TextEncoder()
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()
  const gathering = gather(env, url)
  const configuring = Operations.config(env)
  const top = before.replace(/<title>[^<]*<\/title>/, '').replace('</head>', '§HEAD§</head>')
  const [opening = '', closing = ''] = top.split('§HEAD§')
  void writer.write(encoder.encode(opening))

  const work = (async () => {
    const { data, head, whole } = await gathering
    const boot: Boot = { config: await configuring, data, face: face(request.headers.get('cookie')), mobile: mobile(request), now: Date.now(), site: Site.url(env, url), socket: `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}${Site.base}`, url: url.href, zone: zone(request.headers.get('cookie')) }
    await writer.write(encoder.encode(`<title>${escape(head.title)}</title><meta name="description" content="${escape(head.description)}">${Share.tags(head)}${closing}<div id="root">`))
    try {
      const stream = await store.run(boot, () => render(request.signal))
      const reader = stream.getReader()
      for (;;) {
        const chunk = await store.run(boot, () => reader.read())
        if (chunk.done) break
        await writer.write(chunk.value)
      }
    } catch (error) {
      console.error('Server render failed', error)
      await writer.write(encoder.encode(`</div><script>window.__SWARMS_BOOT__=${json({ ...boot, data: {} })}</script>${after}`))
      await writer.close()
      return false
    }
    await writer.write(encoder.encode(`</div><script>window.__SWARMS_BOOT__=${json(boot)}</script>${after}`))
    await writer.close()
    return whole
  })()
  const whole = work.catch(() => {
    void writer.abort().catch(() => {})
    return false
  })
  const id = /^\/s\/([^/]+)/.exec(url.pathname)?.[1]
  const status = !rendered(url.pathname) ? 404 : id ? ((await Store.exists(env, decodeURIComponent(id)).catch(() => true)) ? 200 : 404) : 200
  return { response: new Response(readable, { headers: { 'cache-control': 'private, no-cache', 'content-type': 'text/html; charset=utf-8', link: `<${Site.base}/fonts/ParadigmSerif-BetaRegular.woff2>; rel=preload; as=font; crossorigin` }, status }), whole }
}
