import { AsyncLocalStorage } from 'node:async_hooks'
import { render } from '#ssr'
import * as Answer from '../shared/Answer.ts'
import type { Entry } from '../shared/Api.ts'
import type { Boot, Face } from '../shared/Boot.ts'
import * as Edge from './Edge.ts'
import * as Operations from './Operations.ts'
import * as Store from './Store.ts'

const store = new AsyncLocalStorage<Boot>()

globalThis.__swarmsServer = { boot: () => store.getStore() }

const firstFeed = 30

const firstChat = 30

const listed = new Set(['/', '/join', '/new', '/about', '/docs', '/board'])

export function rendered(path: string) {
  return listed.has(path) || /^\/s\/[^/]+(\/code)?\/?$/.test(path)
}

let template: string | undefined

let chunks: { code: string[]; repo: string[] } | undefined

async function preloads(env: Cloudflare.Env, origin: string) {
  if (chunks) return chunks
  chunks = await env.ASSETS.fetch(new Request(`${origin}/preload.json`))
    .then((response) => (response.ok ? (response.json() as Promise<{ code: string[]; repo: string[] }>) : { code: [], repo: [] }))
    .catch(() => ({ code: [], repo: [] }))
  return chunks
}

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

type Head = { description: string; image: string; player?: string; title: string }

async function gather(env: Cloudflare.Env, url: URL): Promise<{ data: Record<string, unknown>; head: Head; status: number; whole: boolean }> {
  const path = url.pathname.replace(/\/$/, '') || '/'
  const head: Head = { description: 'Fund breakthroughs. Start or back swarms, AI agents that research and build in the open, watch them work live and steer them together.', image: `${url.origin}/xframe-card.jpg?v=3`, title: 'Swarms · Fund breakthroughs' }
  const data: Record<string, unknown> = {}
  if (path === '/' || path === '/join' || path === '/new') {
    const list = await within(Operations.list(env, {}), 1500)
    if (list?.ok) data['swarms'] = Operations.listed(list.value)
    if (path === '/join') head.title = 'Be part of the future · Swarms'
    if (path === '/new') head.title = 'Start a breakthrough · Swarms'
    head.player = `${url.origin}/x${path === '/join' ? '?view=join' : path === '/new' ? '?view=start' : ''}`
    return { data, head, status: 200, whole: !!list?.ok }
  }
  if (path === '/about') return { data, head: { ...head, title: 'About · Swarms' }, status: 200, whole: true }
  if (path === '/docs') return { data, head: { ...head, title: 'API and MCP · Swarms' }, status: 200, whole: true }
  if (!rendered(path)) return { data, head: { ...head, title: 'Not found · Swarms' }, status: 404, whole: false }
  const [, raw = '', browsing] = /^\/s\/([^/]+)(\/code)?$/.exec(path) ?? []
  const id = decodeURIComponent(raw)
  const [detail, room, code] = await Promise.all([
    within(Operations.detail(env, { swarm: id }), 2500),
    browsing ? undefined : within(Operations.room(env, { swarm: id }), 2500),
    browsing ? within(Operations.code(env, { swarm: id }), 2500) : undefined,
  ])
  if (!detail) return { data, head, status: 200, whole: false }
  if (!detail.ok) {
    data[`!${id}`] = detail.detail
    return { data, head: { ...head, title: 'Not found · Swarms' }, status: detail.status === 404 ? 404 : 200, whole: false }
  }
  data[id] = { ...detail.value, feed: browsing ? [] : await shown(env, id, detail.value.feed), updates: detail.value.updates.filter((update, index, all) => update.commits.length > 0 || index === all.length - 1) }
  if (room?.ok) data[`room:${id}`] = { ...room.value, messages: room.value.messages.slice(-firstChat) }
  if (code?.ok && code.value.snapshot) data[`code:${id}`] = code.value.snapshot
  const latest = detail.value.answer?.text
  return {
    data,
    head: { description: (latest ?? detail.value.goal).replace(/\s+/g, ' ').slice(0, 200), image: head.image, player: `${url.origin}/x/s/${encodeURIComponent(id)}`, title: `${browsing ? 'Code · ' : ''}${detail.value.title} · Swarms` },
    status: 200,
    whole: browsing ? !!code?.ok : !!room?.ok,
  }
}

async function shown(env: Cloudflare.Env, id: string, feed: readonly Entry[]) {
  const visible = (entries: readonly Entry[]) => entries.filter((entry) => !(entry.kind === 'status' && Answer.settled(entry.text)))
  const kept = visible(feed)
  const first = feed[0]?.seq ?? 0
  if (kept.length >= 10 || first <= 1) return kept.slice(-firstFeed)
  const earlier = await within(Operations.feed(env, { before: first, limit: 200, swarm: id }), 1000)
  return [...(earlier?.ok ? visible(earlier.value.entries) : []), ...kept].slice(-firstFeed)
}

function meta(head: Head, url: URL) {
  const tags = [
    `<meta property="og:title" content="${escape(head.title)}">`,
    `<meta property="og:description" content="${escape(head.description)}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:image" content="${escape(head.image)}">`,
    '<meta property="og:image:width" content="800">',
    '<meta property="og:image:height" content="450">',
    `<meta property="og:url" content="${escape(url.origin + url.pathname)}">`,
    `<meta name="twitter:card" content="${head.player ? 'player' : 'summary_large_image'}">`,
    `<meta name="twitter:title" content="${escape(head.title)}">`,
    `<meta name="twitter:description" content="${escape(head.description)}">`,
    `<meta name="twitter:image" content="${escape(head.image)}">`,
    ...(head.player ? [`<meta name="twitter:player" content="${escape(head.player)}">`, '<meta name="twitter:player:width" content="800">', '<meta name="twitter:player:height" content="450">'] : []),
  ]
  return tags.join('')
}

export async function lost(request: Request, env: Cloudflare.Env) {
  return (await draw(request, env)).response
}

export async function page(request: Request, env: Cloudflare.Env) {
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
  const browsing = /^\/s\/[^/]+\/code\/?$/.test(url.pathname)
  const hinted = browsing ? (await preloads(env, url.origin)).repo.filter((file) => !opening.includes(file)) : []
  void writer.write(encoder.encode(opening + hinted.map((file) => `<link rel="modulepreload" crossorigin href="/${file}">`).join('')))

  const work = (async () => {
    const { data, head, whole } = await gathering
    const boot: Boot = { config: await configuring, data, face: face(request.headers.get('cookie')), mobile: mobile(request), now: Date.now(), url: url.href, zone: zone(request.headers.get('cookie')) }
    await writer.write(encoder.encode(`<title>${escape(head.title)}</title><meta name="description" content="${escape(head.description)}">${meta(head, url)}${closing}<div id="root">`))
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
  return { response: new Response(readable, { headers: { 'cache-control': 'private, no-cache', 'content-type': 'text/html; charset=utf-8', link: '</fonts/ParadigmSerif-BetaRegular.woff2>; rel=preload; as=font; crossorigin' }, status }), whole }
}
