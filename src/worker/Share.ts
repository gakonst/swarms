import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import { open, problems } from '../shared/ResearchBrief.ts'
import * as Status from '../shared/Status.ts'
import * as Cards from './Cards.ts'

export const look = 1

export type Subject =
  | { field: Cards.Field; kind: 'home' }
  | { field: Cards.Field; kind: 'ideas' }
  | { field: Cards.Field; kind: 'new' }
  | { item: Cards.Swarm; kind: 'idea'; problem: string }
  | { item: Cards.Swarm; kind: 'swarm'; swarm: string }
  | { kind: 'about' }
  | { kind: 'docs' }

export type Share = {
  description: string
  image: { alt: string; card: string; poster: string }
  labels: [string, string][]
  oembed: string
  player: string | null
  title: string
  url: string
  video: string | null
}

export const card = { height: 630, width: 1200 }

export const poster = { height: 720, width: 1280 }

export const player = { height: 450, width: 800 }

const blurb = 'Back an idea with a few dollars and a team of AI agents researches and builds it, in public.'

function backers(count: number) {
  return `${count} backer${count === 1 ? '' : 's'}`
}

export function field(given: readonly Summary[], now = Date.now()): Cards.Field {
  const swarms = given.filter((swarm) => !Status.test(swarm))
  const live = Status.ranked(
    swarms.filter((swarm) => swarm.status !== 'done'),
    now,
  )
  return {
    balance: live.reduce((sum, swarm) => sum + Number(swarm.balance), 0),
    ideas: open(swarms).map((problem) => ({ id: problem.id, title: problem.title })),
    open: live.length,
    swarms: live.slice(0, 12).map((swarm) => ({ ...Cards.item(swarm), left: 0, pitch: '' })),
    working: swarms.filter((swarm) => swarm.status === 'running').length,
  }
}

export function problem(id: string | null) {
  return problems.find((problem) => problem.id === id)
}

export function swarm(value: Summary): Subject {
  return { item: Cards.item(value), kind: 'swarm', swarm: value.id }
}

export function idea(value: Problem): Subject {
  return { item: Cards.idea(value), kind: 'idea', problem: value.id }
}

export function listing(kind: 'home' | 'ideas' | 'new', swarms: readonly Summary[]): Subject {
  return { field: field(swarms), kind }
}

export function plain(kind: 'about' | 'docs'): Subject {
  return { kind }
}

export function page(url: URL) {
  const path = url.pathname.replace(/\/$/, '') || '/'
  const id = /^\/s\/([A-Za-z0-9_-]{1,64})(?:\/chat|\/code|\/results)?$/.exec(path)?.[1]
  if (id) return `s/${id}`
  if (path === '/new' && url.searchParams.has('q')) return problem(url.searchParams.get('q')) ? `new/${url.searchParams.get('q')}` : undefined
  return ({ '/': 'home', '/about': 'about', '/docs': 'docs', '/ideas': 'ideas', '/new': 'new' } as Record<string, string>)[path]
}

export function bot(request: Request) {
  return /bot|crawl|spider|preview|facebookexternalhit|facebot|whatsapp|mastodon|bluesky|embedly|iframely|skypeuripreview|vkshare|pinterest|tumblr|snapchat|linkedin/i.test(request.headers.get('user-agent') ?? '')
}

export function key(subject: Subject) {
  if (subject.kind === 'swarm') return `s/${encodeURIComponent(subject.swarm)}`
  if (subject.kind === 'idea') return `new/${subject.problem}`
  return subject.kind
}

export function moving(subject: Subject) {
  return subject.kind !== 'about' && subject.kind !== 'docs'
}

function steady(subject: Subject) {
  if (subject.kind !== 'swarm') return subject
  const item = subject.item
  const fill = item.balance > 0 ? Math.round(Math.min(1, Math.max(0, item.left / item.balance)) * 20) : 0
  return { ...subject, item: { ...item, left: fill } }
}

export function version(subject: Subject) {
  let hash = 0x811c9dc5
  for (const char of `${look}|${JSON.stringify(steady(subject))}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
  return (hash >>> 0).toString(36)
}

export function asset(origin: string, subject: Subject, name: 'card.png' | 'poster.png' | 'video.mp4') {
  return `${origin}/og/${key(subject)}/${name}?v=${version(subject)}`
}

function alt(subject: Subject) {
  if (subject.kind === 'swarm' || subject.kind === 'idea') {
    const item = subject.item
    const money = item.balance > 0 ? `${Answer.cash(item.balance)} balance from ${backers(item.backers)}` : 'no backers yet'
    return `${item.title}. ${Status.pill(item.word)}, ${money}.`
  }
  if (subject.kind === 'about') return 'How Swarms works: pick an idea, chip in a few dollars, AI agents work on it, read what they find.'
  if (subject.kind === 'docs') return 'Use swarms from code: a public REST API and an MCP server.'
  if (subject.kind === 'ideas') return `All ideas on Swarms: ${subject.field.swarms.slice(0, 3).map((item) => item.title).join(', ')}.`
  if (subject.kind === 'new') return 'What should AI figure out or build? Start an idea on Swarms.'
  return `Swarms: back an idea, AI builds it. ${subject.field.working} working now, ${subject.field.open + subject.field.ideas.length} ideas.`
}

export function title(subject: Subject) {
  if (subject.kind === 'swarm' || subject.kind === 'idea') return `${subject.item.title} · Swarms`
  return { about: 'How it works · Swarms', docs: 'API and MCP · Swarms', home: 'Swarms · Back an idea. AI builds it.', ideas: 'All ideas · Swarms', new: 'Start an idea · Swarms' }[subject.kind]
}

export function playing(origin: string, subject: Subject) {
  if (subject.kind === 'swarm') return `${origin}/x/s/${encodeURIComponent(subject.swarm)}`
  if (subject.kind === 'ideas') return `${origin}/x?view=join`
  if (subject.kind === 'new' || subject.kind === 'idea') return `${origin}/x?view=start`
  if (subject.kind === 'home') return `${origin}/x`
  return null
}

export function path(subject: Subject) {
  if (subject.kind === 'swarm') return `/s/${encodeURIComponent(subject.swarm)}`
  if (subject.kind === 'idea') return `/new?q=${subject.problem}`
  return subject.kind === 'home' ? '/' : `/${subject.kind}`
}

export function share(origin: string, subject: Subject, given: { description?: string; title?: string } = {}): Share {
  return {
    description: given.description ?? describe(subject),
    image: { alt: alt(subject), card: asset(origin, subject, 'card.png'), poster: asset(origin, subject, 'poster.png') },
    labels: labels(subject),
    oembed: `${origin}/oembed?url=${encodeURIComponent(`${origin}${path(subject)}`)}`,
    player: playing(origin, subject),
    title: given.title ?? title(subject),
    url: `${origin}${path(subject)}`,
    video: moving(subject) ? asset(origin, subject, 'video.mp4') : null,
  }
}

function labels(subject: Subject): [string, string][] {
  if (subject.kind === 'swarm') {
    const item = subject.item
    return [
      ['Status', Status.pill(item.word)],
      ['Balance', item.balance > 0 ? `${Answer.cash(item.balance)} from ${backers(item.backers)}` : 'Be the first backer'],
    ]
  }
  if (subject.kind === 'idea') return [['Status', 'New idea'], ['Balance', 'Be the first backer']]
  if (subject.kind === 'home' || subject.kind === 'ideas' || subject.kind === 'new')
    return [
      ['Working now', String(subject.field.working)],
      ['Ideas', String(subject.field.open + subject.field.ideas.length)],
    ]
  return []
}

export function describe(subject: Subject) {
  if (subject.kind === 'swarm') {
    const item = subject.item
    const money = item.balance > 0 ? `${Answer.cash(item.balance)} balance from ${backers(item.backers)}` : 'No backers yet'
    return `${Status.pill(item.word)} · ${money}. ${item.pitch || Status.line(item.word)}`.slice(0, 300)
  }
  if (subject.kind === 'idea') return `${subject.item.pitch} Back it with a few dollars and AI agents start on it, in public.`
  if (subject.kind === 'new') return 'Ask AI to figure out or build anything. Chip in a few dollars and AI agents work on it, in public.'
  if (subject.kind === 'about') return 'Pick an idea, chip in a few dollars, and AI agents work on it until the money runs out. Read what they find and chat with other backers.'
  if (subject.kind === 'docs') return 'Everything on Swarms is a public REST API and an MCP server. Reading is free and needs no account.'
  return blurb
}

function escape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function tags(share: Share) {
  const meta = (kind: 'name' | 'property', key: string, value: string | number) => `<meta ${kind}="${key}" content="${escape(String(value))}">`
  return [
    `<link rel="canonical" href="${escape(share.url)}">`,
    `<link rel="alternate" type="application/json+oembed" href="${escape(share.oembed)}" title="${escape(share.title)}">`,
    meta('property', 'og:site_name', 'Swarms'),
    meta('property', 'og:type', share.video ? 'video.other' : 'website'),
    meta('property', 'og:locale', 'en_US'),
    meta('property', 'og:url', share.url),
    meta('property', 'og:title', share.title),
    meta('property', 'og:description', share.description),
    meta('property', 'og:image', share.image.card),
    meta('property', 'og:image:secure_url', share.image.card),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', card.width),
    meta('property', 'og:image:height', card.height),
    meta('property', 'og:image:alt', share.image.alt),
    ...(share.video
      ? [
          meta('property', 'og:video', share.video),
          meta('property', 'og:video:secure_url', share.video),
          meta('property', 'og:video:type', 'video/mp4'),
          meta('property', 'og:video:width', poster.width),
          meta('property', 'og:video:height', poster.height),
        ]
      : []),
    meta('name', 'twitter:card', share.player ? 'player' : 'summary_large_image'),
    meta('name', 'twitter:title', share.title),
    meta('name', 'twitter:description', share.description),
    meta('name', 'twitter:image', share.player ? share.image.poster : share.image.card),
    meta('name', 'twitter:image:alt', share.image.alt),
    ...(share.player
      ? [
          meta('name', 'twitter:player', share.player),
          meta('name', 'twitter:player:width', player.width),
          meta('name', 'twitter:player:height', player.height),
          ...(share.video ? [meta('name', 'twitter:player:stream', share.video), meta('name', 'twitter:player:stream:content_type', 'video/mp4')] : []),
        ]
      : []),
    ...share.labels.flatMap(([label, data], index) => [meta('name', `twitter:label${index + 1}`, label), meta('name', `twitter:data${index + 1}`, data)]),
  ].join('')
}
