import { waitUntil } from 'cloudflare:workers'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvg from '@resvg/resvg-wasm/index_bg.wasm'
import * as Cards from './Cards.ts'
import type * as Edge from './Edge.ts'
import * as Film from './Film.ts'
import mono from './fonts/mono.bin'
import serif from './fonts/serif.bin'
import * as Glyphs from './Glyphs.ts'
import encoder from './h264/encoder.wasm'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Share from './Share.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Site from '../shared/Site.ts'
import * as Store from './Store.ts'
import * as XFrames from './XFrames.ts'

type Name = 'card.png' | 'poster.png' | 'video.mp4'

type Made = { at: number; body: Uint8Array; lasting: boolean; type: string; version: string }

const fresh = 300_000

let kit: Promise<{ fonts: Cards.Fonts; kit: Film.Kit }> | undefined

const made = new Map<string, Made>()

const making = new Map<string, Promise<Made | undefined>>()

function ready() {
  kit ??= initWasm(resvg).then(() => {
    const buffers = [new Uint8Array(serif), new Uint8Array(mono)]
    const raster: Film.Raster = (svg) => {
      const drawn = new Resvg(svg, { font: { defaultFontFamily: 'Paradigm Serif', fontBuffers: buffers } })
      const image = drawn.render()
      const pixels = image.pixels
      image.free()
      drawn.free()
      return pixels
    }
    return { fonts: { mono: Glyphs.face(mono, 'Paradigm Semi Mono Beta'), serif: Glyphs.face(serif, 'Paradigm Serif') }, kit: { encoder: Film.encoder(encoder), raster } }
  })
  kit.catch(() => {
    kit = undefined
  })
  return kit
}

export function parse(path: string): { key: string; name: Name } | undefined {
  const found = /^\/og\/(.+)\/(card\.png|poster\.png|video\.mp4)$/.exec(path)
  if (!found) return undefined
  const [, key = '', name] = found
  if (!/^(home|ideas|new|about|docs|new\/[a-z0-9-]{1,64}|s\/[A-Za-z0-9_-]{1,64}(\/n\/[a-z0-9]{1,16})?)$/.test(key)) return undefined
  return { key, name: name as Name }
}

export async function grove(env: Cloudflare.Env, swarm: string) {
  const found = await Operations.tree(env, { depth: 64, swarm }).catch(() => undefined)
  return found?.ok ? found.value : undefined
}

export async function leaf(env: Cloudflare.Env, swarm: string, nid: string) {
  const [found, root, view] = await Promise.all([Operations.node(env, { node: nid, swarm }), nid === 'root' ? undefined : Operations.node(env, { node: 'root', swarm }), grove(env, swarm)])
  if (!found.ok) return undefined
  return { node: found.value, title: nid === 'root' ? found.value.title : root?.ok ? root.value.title : 'Swarm', view }
}

async function tree(env: Cloudflare.Env, key: string): Promise<Share.Subject | undefined> {
  const [swarm = '', , nid] = key.slice(2).split('/')
  const naming = Store.nicknamed(env, swarm).catch(() => null)
  if (nid) {
    const found = await leaf(env, swarm, nid)
    return found && Share.node(swarm, found.title, found.node, found.view, await naming)
  }
  const found = await grove(env, swarm)
  return found && Share.tree(swarm, found, await naming)
}

export async function keyed(env: Cloudflare.Env, url: URL) {
  const key = Share.page(url)
  if (key) return key
  const named = Nickname.parse(url.pathname)
  if (!named) return undefined
  const found = await Store.called(env, named.name).catch(() => undefined)
  if (found) return `s/${found.swarm}${/^\/[nt]\//.test(named.tail) ? `/n/${named.tail.slice(3)}` : ''}`
  return found === null && !named.tail ? (Share.problem(named.name) ? `new/${named.name}` : 'new') : undefined
}

async function subject(env: Cloudflare.Env, key: string): Promise<Share.Subject | undefined> {
  if (key === 'about' || key === 'docs') return Share.plain(key)
  if (key.startsWith('new/')) {
    const problem = Share.problem(key.slice(4))
    return problem && Share.idea(problem)
  }
  if (key.startsWith('s/')) {
    const grown = await tree(env, key)
    if (grown || key.includes('/n/')) return grown
    const found = await Operations.detail(env, { swarm: key.slice(2) }, false)
    return found.ok ? Share.swarm(found.value) : undefined
  }
  const listed = await Operations.list(env, {})
  if (!listed.ok) throw new Error(listed.detail)
  return Share.listing(key === 'ideas' ? 'ideas' : key === 'new' ? 'new' : 'home', listed.value.swarms)
}

export type Embed = {
  cache_age: number
  height?: number
  html?: string
  provider_name: string
  provider_url: string
  thumbnail_height: number
  thumbnail_url: string
  thumbnail_width: number
  title: string
  type: 'link' | 'video'
  version: '1.0'
  width?: number
}

export async function embed(env: Cloudflare.Env, given: string, origin: string, self: string, maxwidth?: string, maxheight?: string): Promise<Problem.Result<Embed>> {
  let url: URL
  try {
    url = new URL(given)
  } catch {
    return Problem.fail(400, 'invalid_request', 'url must be a link to a Swarms page.')
  }
  if (url.origin !== new URL(origin).origin && url.origin !== self && url.origin !== new URL(env.SWARMS_URL).origin && url.hostname !== Site.domain) return Problem.fail(404, 'not_found', 'url is not a Swarms page.')
  const key = await keyed(env, new URL(`${Site.strip(url.pathname, Site.prefix(url)).replace(/^\/(x|tg)(?=\/|$)/, '') || '/'}${url.search}`, self))
  const found = key && (await subject(env, key))
  if (!found) return Problem.fail(404, 'not_found', 'url is not a Swarms page or no longer exists.')
  const title = Share.title(found)
  const base = { cache_age: 300, provider_name: 'Swarms', provider_url: origin, thumbnail_height: Share.card.height, thumbnail_url: Share.asset(origin, found, 'card.png'), thumbnail_width: Share.card.width, title, version: '1.0' as const }
  const card = Share.playing(origin, found)
  if (!card) return Problem.ok({ ...base, type: 'link' })
  const fit = Math.min(1, Number(maxwidth) / Share.player.width || 1, Number(maxheight) / Share.player.height || 1)
  const width = Math.round(Share.player.width * fit)
  const height = Math.round(Share.player.height * fit)
  const html = `<iframe src="${card}" width="${width}" height="${height}" style="border:0;border-radius:12px;max-width:100%" allow="clipboard-write" allowfullscreen title="${title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"></iframe>`
  return Problem.ok({ ...base, height, html, type: 'video', width })
}

function scene(fonts: Cards.Fonts, subject: Share.Subject, width: number, height: number) {
  if (subject.kind === 'tree') return Cards.tree(fonts, subject.item, width, height)
  if (subject.kind === 'node') return Cards.node(fonts, subject.item, width, height)
  if (subject.kind === 'swarm') return Cards.swarm(fonts, subject.item, width, height)
  if (subject.kind === 'idea') return Cards.swarm(fonts, subject.item, width, height)
  if (subject.kind === 'home') return Cards.home(fonts, subject.field, width, height)
  if (subject.kind === 'ideas') return Cards.ideas(fonts, subject.field, width, height)
  if (subject.kind === 'new') return Cards.start(fonts, subject.field, width, height)
  if (subject.kind === 'about') return Cards.about(fonts, width, height)
  return Cards.docs(fonts, width, height)
}

async function render(found: Share.Subject, name: Name): Promise<Made | undefined> {
  if (name === 'video.mp4' && !Share.moving(found)) return undefined
  const tools = await ready()
  const version = Share.version(found)
  if (name === 'video.mp4') return { at: Date.now(), body: await Film.film(tools.kit, scene(tools.fonts, found, Share.video.width, Share.video.height)), lasting: true, type: 'video/mp4', version }
  const size = name === 'card.png' ? Share.card : Share.poster
  return { at: Date.now(), body: await Film.picture(tools.kit, scene(tools.fonts, found, size.width, size.height)), lasting: true, type: 'image/png', version }
}

function served(request: Request, item: Made) {
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'access-control-allow-origin': '*',
    'cache-control': item.lasting ? 'public, max-age=31536000, immutable' : `public, max-age=${fresh / 1000}`,
    'content-type': item.type,
    etag: `"${item.version}"`,
    'x-content-type-options': 'nosniff',
  })
  if ((request.headers.get('if-none-match') ?? '').includes(`"${item.version}"`)) return new Response(null, { headers, status: 304 })
  const size = item.body.length
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1
    if (start >= size || start > end) {
      headers.set('content-range', `bytes */${size}`)
      return new Response(null, { headers, status: 416 })
    }
    headers.set('content-range', `bytes ${start}-${end}/${size}`)
    headers.set('content-length', String(end - start + 1))
    return new Response(item.body.slice(start, end + 1), { headers, status: 206 })
  }
  headers.set('content-length', String(size))
  return new Response(item.body, { headers, status: 200 })
}

function remember(url: string, item: Made) {
  made.delete(url)
  made.set(url, item)
  let total = 0
  for (const kept of made.values()) total += kept.body.length
  for (const [old, kept] of made) {
    if (total <= 12_000_000 && made.size <= 48) break
    made.delete(old)
    total -= kept.body.length
  }
}

function address(origin: string, key: string, name: Name, version: string) {
  return `${origin}/og/${key}/${name}?v=${encodeURIComponent(version)}`
}

async function recall(url: string): Promise<Made | undefined> {
  const kept = made.get(url)
  if (kept && (kept.lasting || Date.now() - kept.at < fresh)) return kept
  const hit = await caches.default.match(url).catch(() => undefined)
  if (!hit?.ok) return undefined
  const item = { at: Date.now(), body: new Uint8Array(await hit.arrayBuffer()), lasting: (hit.headers.get('cache-control') ?? '').includes('immutable'), type: hit.headers.get('content-type') ?? 'application/octet-stream', version: (hit.headers.get('etag') ?? '').replace(/"/g, '') }
  remember(url, item)
  return item
}

function produce(url: string, work: () => Promise<Made | undefined>) {
  let task = making.get(url)
  if (!task) {
    task = work()
      .then((item) => {
        if (item) {
          remember(url, item)
          waitUntil(caches.default.put(url, served(new Request(url), item)).catch(() => undefined))
        }
        return item
      })
      .finally(() => making.delete(url))
    making.set(url, task)
  }
  return task
}

export async function serve(env: Cloudflare.Env, request: Request) {
  const url = new URL(request.url)
  const asked = parse(url.pathname)
  if (!asked) return new Response('Not found', { status: 404 })
  const wanted = url.searchParams.get('v') ?? ''
  const where = address(url.origin, asked.key, asked.name, wanted)
  const item =
    (await recall(where)) ??
    (await produce(where, async () => {
      const found = await subject(env, asked.key)
      const drawn = found && (await render(found, asked.name))
      return drawn && { ...drawn, lasting: drawn.version === wanted }
    }))
  if (!item) return new Response('Not found', { headers: { 'cache-control': 'public, max-age=60' }, status: 404 })
  return served(request, item)
}

export async function head(env: Cloudflare.Env, site: string, url: URL): Promise<Share.Share | undefined> {
  const key = await keyed(env, url)
  if (!key?.startsWith('s/')) return undefined
  const found = await tree(env, key)
  return found && Share.share(site, found)
}

export function frame(env: Cloudflare.Env, id: string | undefined, nid?: string): Edge.Draw {
  return async (request) => {
    const url = new URL(request.url)
    const site = Site.url(env, url)
    if (id === undefined) {
      const listed = await Operations.list(env, {}).catch(() => undefined)
      return { response: XFrames.start(site, listed?.ok ? listed.value.swarms : [], url, env.TELEGRAM_BOT), whole: Promise.resolve(!!listed?.ok) }
    }
    if (nid !== undefined) {
      const found = /^[a-z0-9]{1,16}$/.test(nid) ? await leaf(env, id, nid) : undefined
      return { response: found ? XFrames.node(site, id, found.title, found.node, url, env.TELEGRAM_BOT, found.view) : XFrames.lost(site, url, env.TELEGRAM_BOT), whole: Promise.resolve(!!found) }
    }
    const grown = await grove(env, id)
    if (grown) return { response: XFrames.tree(site, id, grown, url, env.TELEGRAM_BOT), whole: Promise.resolve(true) }
    const result = await Operations.get(env, { swarm: id })
    return { response: result.ok ? XFrames.swarm(site, result.value, url, env.TELEGRAM_BOT) : result.status === 404 ? XFrames.lost(site, url, env.TELEGRAM_BOT) : Problem.json(result), whole: Promise.resolve(result.ok) }
  }
}

export async function warm(env: Cloudflare.Env, url: URL) {
  const key = await keyed(env, url)
  if (!key) return
  const found = await subject(env, key)
  if (!found) return
  const version = Share.version(found)
  for (const name of ['card.png', 'poster.png', 'video.mp4'] as const) {
    const where = address(url.origin, key, name, version)
    if (!(await recall(where))) await produce(where, () => render(found, name))
  }
}