import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Pieces from '../shared/Pieces.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import { open, problems } from '../shared/ResearchBrief.ts'
import * as Status from '../shared/Status.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Cards from './Cards.ts'
import * as Limits from '../shared/Limits.ts'

export const look = Limits.Share.look

export type Subject =
  | { field: Cards.Field; kind: 'home' }
  | { field: Cards.Field; kind: 'ideas' }
  | { field: Cards.Field; kind: 'new' }
  | { item: Cards.Swarm; kind: 'idea'; problem: string }
  | { item: Cards.Swarm; kind: 'swarm'; name: string | null; swarm: string }
  | { item: Cards.Grove; kind: 'tree'; name: string | null; swarm: string }
  | { item: Cards.Leaf; kind: 'node'; name: string | null; node: string; swarm: string }
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

export const card = Limits.Share.card

export const poster = Limits.Share.poster

export const video = Limits.Share.video

export const player = Limits.Share.player

const blurb = 'Make a breakthrough. Ride a swarm: put a few dollars on a lemma, a program or a whole hard problem, and AI agents work on it in public. Lean decides what is proven.'

function backers(count: number) {
  return `${count} rider${count === 1 ? '' : 's'}`
}

export function field(given: readonly Summary[], now = Date.now()): Cards.Field {
  const swarms = given.filter((swarm) => !Status.test(swarm))
  const live = Status.ranked(swarms, now)
  return {
    balance: live.reduce((sum, swarm) => sum + Math.max(0, Number(swarm.remaining)), 0),
    ideas: open(swarms).map((problem) => ({ id: problem.id, title: problem.title })),
    open: live.length,
    swarms: live.slice(0, Limits.Share.listed).map((swarm) => ({ ...Cards.item(swarm), left: 0, pitch: '' })),
    working: swarms.filter((swarm) => swarm.status === 'running').length,
  }
}

export function problem(id: string | null) {
  return problems.find((problem) => problem.id === id)
}

export function swarm(value: Summary): Subject {
  return { item: Cards.item(value), kind: 'swarm', name: value.nickname, swarm: value.id }
}

export function tree(swarm: string, view: { headline: Tree.Headline; nodes: readonly Tree.Node[] }, name: string | null = null): Subject {
  return { item: Cards.grove(swarm, view), kind: 'tree', name, swarm }
}

export function node(swarm: string, title: string, value: Tree.Node & { review?: boolean }, view?: { nodes: readonly Tree.Node[] }, name: string | null = null): Subject {
  return { item: Cards.leaf(title, value, view), kind: 'node', name, node: value.id, swarm }
}

export function idea(value: Problem): Subject {
  return { item: Cards.idea(value), kind: 'idea', problem: value.id }
}

export function listing(kind: 'home' | 'ideas' | 'new', swarms: readonly Summary[]): Subject {
  return { field: field(swarms), kind }
}

export const faq = 'What a swarm is, where your dollars go, who picks the models and how Lean checks a proof.'

export function plain(kind: 'about' | 'docs'): Subject {
  return { kind }
}

export function page(url: URL) {
  const path = url.pathname.replace(/\/$/, '') || '/'
  const leaf = /^\/s\/([A-Za-z0-9_-]{1,64})\/[nt]\/([a-z0-9]{1,16})$/.exec(path)
  if (leaf) return `s/${leaf[1]}/n/${leaf[2]}`
  const id = /^\/s\/([A-Za-z0-9_-]{1,64})(?:\/chat|\/code|\/results|\/board|\/about|\/c\/[a-z0-9]{1,16})?$/.exec(path)?.[1]
  if (id) return `s/${id}`
  if (path === '/new' && url.searchParams.has('q')) return problem(url.searchParams.get('q')) ? `new/${url.searchParams.get('q')}` : undefined
  return ({ '/': 'home', '/about': 'about', '/docs': 'docs', '/ideas': 'ideas', '/new': 'new' } as Record<string, string>)[path]
}

export function bot(request: Request) {
  return /bot|crawl|spider|preview|facebookexternalhit|facebot|whatsapp|mastodon|bluesky|embedly|iframely|skypeuripreview|vkshare|pinterest|tumblr|snapchat|linkedin/i.test(request.headers.get('user-agent') ?? '')
}

export function key(subject: Subject) {
  if (subject.kind === 'node') return `s/${encodeURIComponent(subject.swarm)}/n/${subject.node}`
  if (subject.kind === 'swarm' || subject.kind === 'tree') return `s/${encodeURIComponent(subject.swarm)}`
  if (subject.kind === 'idea') return `new/${subject.problem}`
  return subject.kind
}

export function moving(subject: Subject) {
  return subject.kind !== 'about' && subject.kind !== 'docs' && subject.kind !== 'tree' && subject.kind !== 'node'
}

function steady(subject: Subject) {
  if (subject.kind === 'tree') return { ...subject, item: { ...subject.item, perProven: subject.item.perProven === null ? null : Math.round(subject.item.perProven), ridden: Math.round(subject.item.ridden), spent: Math.round(subject.item.spent) } }
  if (subject.kind === 'node') return { ...subject, item: { ...subject.item, ridden: Math.round(subject.item.ridden), spent: Math.round(subject.item.spent) } }
  if (subject.kind !== 'swarm') return subject
  const item = subject.item
  const fill = item.balance > 0 ? Math.round(Math.min(1, Math.max(0, item.left / item.balance)) * Limits.Share.fillSteps) : 0
  return { ...subject, item: { ...item, left: fill } }
}

export function version(subject: Subject) {
  let hash: number = Limits.Share.fnvOffset
  for (const char of `${look}|${JSON.stringify(steady(subject))}`) hash = Math.imul(hash ^ char.charCodeAt(0), Limits.Share.fnvPrime)
  return (hash >>> 0).toString(Limits.Share.hashRadix)
}

export function asset(origin: string, subject: Subject, name: 'card.png' | 'poster.png' | 'video.mp4') {
  return `${origin}/og/${key(subject)}/${name}?v=${version(subject)}`
}

function alt(subject: Subject) {
  if (subject.kind === 'tree') return `${subject.item.title} ${headline(subject.item)}`
  if (subject.kind === 'node') return `${subject.item.title}. ${Cards.words[subject.item.status]}. ${subject.item.why}`
  if (subject.kind === 'swarm' || subject.kind === 'idea') {
    const item = subject.item
    const money = item.balance > 0 ? `${Answer.cash(item.balance)} balance from ${backers(item.backers)}` : 'no riders yet'
    return `${item.title}. ${Status.pill(item.word)}, ${money}.`
  }
  if (subject.kind === 'about') return 'How it works: ride a lemma, a program or the whole swarm; dollars flow down to work that can start now; Lean decides what is proven; every dead end is kept.'
  if (subject.kind === 'docs') return 'Use swarms from code: a public REST API and an MCP server.'
  if (subject.kind === 'ideas') return `All ideas on Swarms: ${subject.field.swarms.slice(0, Limits.Share.named).map((item) => item.title).join(', ')}.`
  if (subject.kind === 'new') return 'What breakthrough are you after? Start a swarm.'
  return `Swarms: back an idea, AI builds it. ${subject.field.working} working now, ${subject.field.open + subject.field.ideas.length} ideas.`
}

export function title(subject: Subject) {
  if (subject.kind === 'swarm' || subject.kind === 'idea' || subject.kind === 'tree' || subject.kind === 'node') return `${subject.item.title} · Swarms`
  return { about: 'Swarm riders · Swarms', docs: 'API and MCP · Swarms', home: 'Swarms · Make a breakthrough. Ride a swarm.', ideas: 'All swarms · Swarms', new: 'Start a swarm · Swarms' }[subject.kind]
}

export function playing(origin: string, subject: Subject) {
  if (subject.kind === 'node') return `${origin}/x${Nickname.path({ id: subject.swarm, nickname: subject.name })}/n/${subject.node}`
  if (subject.kind === 'swarm' || subject.kind === 'tree') return `${origin}/x/s/${encodeURIComponent(subject.swarm)}`
  if (subject.kind === 'ideas') return `${origin}/x?view=join`
  if (subject.kind === 'new' || subject.kind === 'idea') return `${origin}/x?view=start`
  if (subject.kind === 'home') return `${origin}/x`
  return null
}

export function path(subject: Subject) {
  if (subject.kind === 'node') return `${Nickname.path({ id: subject.swarm, nickname: subject.name })}/t/${subject.node}`
  if (subject.kind === 'swarm' || subject.kind === 'tree') return Nickname.path({ id: subject.swarm, nickname: subject.name })
  if (subject.kind === 'idea') return Nickname.usable(subject.problem) ? `/${subject.problem}` : `/new?q=${subject.problem}`
  return subject.kind === 'home' ? '/' : `/${subject.kind}`
}

export function share(origin: string, subject: Subject, given: { description?: string; path?: string; title?: string } = {}): Share {
  const at = given.path ?? path(subject)
  return {
    description: given.description ?? describe(subject),
    image: { alt: alt(subject), card: asset(origin, subject, 'card.png'), poster: asset(origin, subject, 'poster.png') },
    labels: labels(subject),
    oembed: `${origin}/oembed?url=${encodeURIComponent(`${origin}${at}`)}`,
    player: playing(origin, subject),
    title: given.title ?? title(subject),
    url: `${origin}${at}`,
    video: moving(subject) ? asset(origin, subject, 'video.mp4') : null,
  }
}

function labels(subject: Subject): [string, string][] {
  if (subject.kind === 'tree')
    return [
      ['Proven', subject.item.proven.toLocaleString('en-US')],
      ['Spent', Answer.cash(subject.item.spent)],
    ]
  if (subject.kind === 'node')
    return [
      ['Status', subject.item.checked ? `Proven, checked by Lean at ${subject.item.checked}` : Cards.words[subject.item.status]],
      ['Spent', Answer.cash(subject.item.spent)],
    ]
  if (subject.kind === 'swarm') {
    const item = subject.item
    return [
      ['Status', Status.pill(item.word)],
      ['Balance', item.balance > 0 ? `${Answer.cash(item.balance)} from ${backers(item.backers)}` : 'Be the first rider'],
    ]
  }
  if (subject.kind === 'idea') return [['Status', 'No riders yet'], ['Balance', 'Be the first rider']]
  if (subject.kind === 'home' || subject.kind === 'ideas' || subject.kind === 'new')
    return [
      ['Working now', String(subject.field.working)],
      ['Ideas', String(subject.field.open + subject.field.ideas.length)],
    ]
  return []
}

export function headline(item: Cards.Grove) {
  return `${item.proven.toLocaleString('en-US')} proven · ${Cards.tally(item).join(' · ')} · ${Answer.cash(item.spent)} spent.`
}

export function describe(subject: Subject) {
  if (subject.kind === 'tree') return `${headline(subject.item)} Ride a lemma, a program or the whole swarm. Lean decides what is proven, and every dead end is kept.`
  if (subject.kind === 'node') {
    const item = subject.item
    const money = item.ridden > 0 ? `${Answer.cash(item.ridden)} ridden, ${Answer.cash(item.spent)} spent.` : 'No riders yet.'
    return `${Cards.words[item.status]}. ${item.why} ${money}`.slice(0, Limits.Share.descriptionChars)
  }
  if (subject.kind === 'swarm') {
    const item = subject.item
    const money = item.balance > 0 ? `${Answer.cash(item.balance)} balance from ${backers(item.backers)}` : 'No riders yet'
    return `${Status.pill(item.word)} · ${money}. ${item.pitch || Status.line(item.word)}`.slice(0, Limits.Share.descriptionChars)
  }
  if (subject.kind === 'idea') return `${subject.item.pitch} Ride it with a few dollars and AI agents start on it, in public.`
  if (subject.kind === 'new') return 'Ask AI to figure out or build anything. Chip in a few dollars and AI agents work on it, in public.'
  if (subject.kind === 'about') return 'Ride a lemma, a program or the whole swarm. Your dollars flow down the tree to work that can start now, Lean decides what is proven, and every dead end is kept.'
  if (subject.kind === 'docs') return 'Everything on Swarms is a public REST API and an MCP server. Reading is free and needs no account.'
  return blurb
}

export type Notice = { frame: string; intent: string; text: string; url: string; whole: string }

function clip(text: string, most: number) {
  return text.length > most ? `${Pieces.head(text, most - 1).trimEnd()}…` : text
}

export function announce(origin: string, swarm: string, title: string, delta: Tree.Delta): Notice | undefined {
  if (!((delta.event === 'proven' && delta.node.status === 'proven') || (delta.event === 'ended' && delta.node.status === 'dead end'))) return undefined
  return notice(origin, swarm, title, delta.node)
}

export function notice(origin: string, swarm: string, title: string, value: Tree.Node): Notice | undefined {
  if (value.status !== 'proven' && value.status !== 'dead end') return undefined
  const subject = node(swarm, title, value)
  if (subject.kind !== 'node') return undefined
  const said = value.status === 'proven' ? `Proven, checked by Lean${subject.item.checked ? ` at ${subject.item.checked}` : ''}: ${value.title}` : `Dead end, kept in the tree: ${value.title}. ${subject.item.why}`
  const whole = `${title}\n${said}`
  const text = clip(whole, Limits.Share.textChars)
  const frame = playing(origin, subject) ?? `${origin}${path(subject)}`
  return { frame, intent: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(frame)}`, text, url: `${origin}${path(subject)}`, whole }
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
          meta('property', 'og:video:width', video.width),
          meta('property', 'og:video:height', video.height),
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
