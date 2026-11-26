import { AsyncLocalStorage } from 'node:async_hooks'
import { waitUntil } from 'cloudflare:workers'
import { render } from '#ssr'
import type { Boot, Face } from '../shared/Boot.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Hello from '../shared/Hello.ts'
import * as Rail from '../shared/Rail.ts'
import * as Site from '../shared/Site.ts'
import * as Surface from '../shared/Surface.ts'
import * as Artifacts from './Artifacts.ts'
import { within } from './Clock.ts'
import * as Edge from './Edge.ts'
import * as Og from './Og.ts'
import * as Operations from './Operations.ts'
import * as Share from './Share.ts'
import * as Store from './Store.ts'
import * as Limits from '../shared/Limits.ts'

const store = new AsyncLocalStorage<Boot>()

globalThis.__swarmsServer = { boot: () => store.getStore() }

const firstChat = Limits.Page.firstChat

const listed = new Set(['/', '/ideas', '/new', '/about', '/docs', '/faq', '/board', '/oauth/authorize'])

const ridered = /^\/(u\/[^/]+|me|me\/ai|cli\/login)\/?$/

const swarmed = /^\/s\/([^/]+)(\/chat|\/code|\/results|\/board|\/about|\/[ntc]\/[0-9a-z]+)?\/?$/

export function rendered(path: string) {
  return listed.has(path) || swarmed.test(path) || ridered.test(path) || Nickname.parse(path) !== undefined
}

export function moved(url: URL) {
  if (url.pathname === '/join' || url.pathname === '/join/') return `/ideas${url.search}`
  return undefined
}

const looked = new WeakMap<Request, Promise<Store.Called | null | undefined>>()

function lookup(env: Cloudflare.Env, request: Request, name: string) {
  const held = looked.get(request)
  if (held) return held
  const found = within(Store.calledRecently(env, name), 1500)
  looked.set(request, found)
  return found
}

export async function renamed(env: Cloudflare.Env, request: Request) {
  const url = new URL(request.url)
  const path = url.pathname
  if ((path === '/new' || path === '/new/') && !url.searchParams.has('fixture') && !url.searchParams.has('scene')) {
    const asked = url.searchParams.get('q')
    const name = asked === null ? '' : Nickname.slug(asked)
    if (!Nickname.usable(name)) return undefined
    const search = new URLSearchParams(url.search)
    search.delete('q')
    const rest = search.toString()
    return `/${name}${rest ? `?${rest}` : ''}`
  }
  const [, raw, tail = ''] = swarmed.exec(path) ?? []
  if (raw) {
    const name = await within(Store.nicknamedRecently(env, decodeURIComponent(raw)), 1500)
    return name ? `/${name}${tail}${url.search}` : undefined
  }
  const named = Nickname.parse(path)
  if (!named) return undefined
  const found = await lookup(env, request, named.name)
  if (!found || found.current === named.name) return undefined
  return `${Nickname.path({ id: found.swarm, nickname: found.current })}${named.tail}${url.search}`
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
      ...(typeof value.email === 'string' && value.email.length <= 254 && value.email.includes('@') ? { email: value.email } : {}),
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

type Head = Share.Share

type Calling = Promise<Store.Called | null | undefined> | undefined

async function gather(env: Cloudflare.Env, url: URL, calling: Calling): Promise<{ data: Record<string, unknown>; head: Head; status: number; whole: boolean }> {
  const path = url.pathname.replace(/\/$/, '') || '/'
  const site = Site.url(env, url)
  const lost = Share.share(site, Share.listing('home', []), { title: 'Not found · Swarms' })
  const data: Record<string, unknown> = {}
  if (path === '/' || path === '/ideas' || path === '/new') {
    const [list, hall] = await Promise.all([within(Operations.list(env, {}), 1500), path === '/' ? within(Operations.general(env, { limit: firstChat }), 1500) : undefined])
    if (list?.ok) data['swarms'] = Operations.listed(list.value)
    if (hall?.ok) data['general'] = hall.value
    const problem = path === '/new' ? Share.problem(url.searchParams.get('q')) : undefined
    const subject = problem ? Share.idea(problem) : Share.listing(path === '/ideas' ? 'ideas' : path === '/new' ? 'new' : 'home', list?.ok ? list.value.swarms : [])
    return { data, head: Share.share(site, subject), status: 200, whole: !!list?.ok && (path !== '/' || !!hall?.ok) }
  }
  if (path === '/about' || path === '/docs') return { data, head: Share.share(site, Share.plain(path === '/about' ? 'about' : 'docs')), status: 200, whole: true }
  if (path === '/faq') return { data, head: Share.share(site, Share.plain('about'), { description: Share.faq, path: '/faq', title: 'Questions · Swarms' }), status: 200, whole: true }
  if (!rendered(path)) return { data, head: lost, status: 404, whole: false }
  if (path === '/me') return { data, head: Share.share(site, Share.listing('home', []), { path, title: 'Your profile · Swarms' }), status: 200, whole: true }
  if (path === '/cli/login') return { data, head: Share.share(site, Share.listing('home', []), { path, title: 'Sign in to the CLI · Swarms' }), status: 200, whole: true }
  if (path === '/me/ai') return { data, head: Share.share(site, Share.listing('home', []), { path, title: 'Your own AI · Swarms' }), status: 200, whole: true }
  const profiled = /^\/u\/([^/]+)$/.exec(path)?.[1]
  if (profiled) {
    const who = decodeURIComponent(profiled).trim().replace(/^@/, '').toLowerCase()
    const read = await within(Operations.rider(env, { who }), 2500)
    if (read?.ok) data[`rider:${who}`] = read.value
    else if (read) data[`!rider:${who}`] = read.detail
    const handle = read?.ok ? (read.value.rider.name ? `@${read.value.rider.name}` : read.value.rider.handle) : `@${who}`
    return { data, head: Share.share(site, Share.listing('home', []), { description: read?.ok ? `Rode ${read.value.swarms.length} swarm${read.value.swarms.length === 1 ? '' : 's'} with $${Number(read.value.ridden).toFixed(2)}.` : 'A rider on Swarms.', path, title: `${handle} · Swarms` }), status: read && !read.ok && read.status === 404 ? 404 : 200, whole: false }
  }
  const named = Nickname.parse(path)
  const found = named && (await calling)
  if (named && !found) return found === null && !named.tail ? unclaimed(env, site, named.name) : { data, head: lost, status: found === null ? 404 : 200, whole: false }
  const [, raw = '', tail] = named ? [path, '', named.tail] : (swarmed.exec(path) ?? [])
  const picked = /^\/[nt]\/([0-9a-z]+)$/.exec(tail ?? '')?.[1]
  const id = found ? found.swarm : decodeURIComponent(raw)
  if (named && found) data[`name:${named.name}`] = { name: named.name, nickname: found.current, swarm: id }
  const listing = within(Operations.list(env, {}), 1500).then((list) => {
    if (list?.ok) data['swarms'] = Operations.listed(list.value)
  })
  const row = await within(Store.find(env, id), 1500)
  if (row?.form === 'tree' && !row.archived_at) {
    const drawn = await grove(env, site, url, id, picked ?? 'root', lost, data)
    await listing
    return drawn
  }
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
  await listing
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

async function unclaimed(env: Cloudflare.Env, site: string, name: string): Promise<{ data: Record<string, unknown>; head: Head; status: number; whole: boolean }> {
  const data: Record<string, unknown> = { [`name:${name}`]: null }
  const list = await within(Operations.list(env, {}), 1500)
  if (list?.ok) data['swarms'] = Operations.listed(list.value)
  const problem = Share.problem(name)
  const subject = problem ? Share.idea(problem) : Share.listing('new', list?.ok ? list.value.swarms : [])
  return { data, head: Share.share(site, subject, { path: `/${name}`, ...(problem ? {} : { title: `Start a swarm on ${Nickname.topic(name)} · Swarms` }) }), status: 200, whole: false }
}

async function grove(env: Cloudflare.Env, site: string, url: URL, id: string, nid: string, lost: Head, data: Record<string, unknown>): Promise<{ data: Record<string, unknown>; head: Head; status: number; whole: boolean }> {
  const [detail, tree, node, burn, proofs, room, headed] = await Promise.all([
    within(Operations.detail(env, { swarm: id }, false), 2500),
    within(Operations.tree(env, { depth: 2, swarm: id }), 2500),
    within(Operations.node(env, { node: nid, swarm: id }), 2500),
    within(Operations.burn(env, { every: 'hour', swarm: id }), 2500),
    within(Operations.proofs(env, { swarm: id }), 2500),
    within(Operations.room(env, { swarm: id }), 2500),
    within(Og.head(env, site, url).catch(() => undefined), 2500),
  ])
  if (!detail) return { data, head: Share.share(site, Share.listing('home', [])), status: 200, whole: false }
  if (!detail.ok) {
    data['!' + id] = detail.detail
    return { data, head: lost, status: detail.status === 404 ? 404 : 200, whole: false }
  }
  data[id] = { ...detail.value, feed: [], updates: [] }
  if (tree?.ok) data['tree:' + id] = tree.value
  else if (tree) data['!tree:' + id] = tree.detail
  if (node?.ok) data['node:' + id + ':' + nid] = node.value
  if (burn?.ok) data['burn:' + id] = burn.value
  if (proofs?.ok) data['proofs:' + id] = proofs.value
  if (room?.ok) data['room:' + id] = { ...room.value, messages: room.value.messages.slice(-firstChat) }
  return { data, head: headed ?? Share.share(site, Share.swarm(detail.value)), status: node && !node.ok && node.status === 404 ? 404 : 200, whole: !!tree?.ok && !!node?.ok }
}

export async function lost(request: Request, env: Cloudflare.Env) {
  return (await draw(request, env)).response
}

export async function page(request: Request, env: Cloudflare.Env) {
  const url = new URL(request.url)
  const own = url.pathname.replace(/\/$/, '') === '/me' ? face(request.headers.get('cookie')) : undefined
  if (own) return new Response(null, { headers: { 'cache-control': 'no-store', location: Site.at(`/u/${own.account?.name ?? own.address.toLowerCase()}`, Site.prefix(url)) }, status: 302 })
  if (Share.bot(request)) waitUntil(Og.warm(env, url).catch((error: unknown) => console.error('Preview warm-up failed', error)))
  const cookie = request.headers.get('cookie')
  const build = await built(env, url.origin).catch(() => '')
  const named = Nickname.parse(url.pathname)
  const swarm = named ? ((await lookup(env, request, named.name))?.swarm ?? '') : ''
  return Edge.page(request, `${build}|${mobile(request) ? 'm' : 'd'}|${zone(cookie) ?? ''}|${Rail.parse(cookie)}|${swarm}|${url.pathname === '/' ? Hello.parse(cookie) : ''}`, (given) => draw(given, env))
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
  const named = Nickname.parse(url.pathname)
  const calling: Calling = named && lookup(env, request, named.name)
  const gathering = gather(env, url, calling)
  const configuring = within(Operations.config(env), 2500)
  const top = before.replace(/<title>[^<]*<\/title>/, '').replace('</head>', '§HEAD§</head>')
  const [opening = '', closing = ''] = top.split('§HEAD§')
  void writer.write(encoder.encode(opening))

  const work = (async () => {
    const { data, head, whole } = await gathering
    const boot: Boot = { base: Site.prefix(url), config: await configuring, data, face: face(request.headers.get('cookie')), hello: Hello.parse(request.headers.get('cookie')), mobile: mobile(request), now: Date.now(), rail: Rail.parse(request.headers.get('cookie')), site: Site.url(env, url), socket: `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}${Site.prefix(url)}`, url: url.href, zone: zone(request.headers.get('cookie')) }
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
  const status = !rendered(url.pathname) ? 404 : id ? ((await Store.exists(env, decodeURIComponent(id)).catch(() => true)) ? 200 : 404) : named?.tail && (await calling) === null ? 404 : 200
  return { response: new Response(readable, { headers: { 'cache-control': 'private, no-cache', 'content-type': 'text/html; charset=utf-8', link: `<${Site.base}/fonts/ParadigmSerif-BetaRegular.woff2>; rel=preload; as=font; crossorigin` }, status }), whole }
}
