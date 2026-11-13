import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import type { Mood } from '../shared/Status.ts'
import * as Status from '../shared/Status.ts'
import * as Glyphs from './Glyphs.ts'
import type { Face } from './Glyphs.ts'

export type Fonts = { mono: Face; serif: Face }

export type Kind = 'cover' | 'burst' | 'smudge' | 'seed'

export type Hive = { kind: Kind; mood: Mood; reach: number; seed: string; x: number; y: number }

export type Line = { high: number; left: number; top: number; wide: number }

export type Gauge = { color: string; fill: number; high: number; left: number; top: number; wide: number }

export type Pulse = { color: string; radius: number; x: number; y: number }

export type Link = { ax: number; ay: number; bx: number; by: number }

export type Scene = { gauge: Gauge | null; height: number; hives: Hive[]; lines: Line[]; links: Link[]; parts: string; pulse: Pulse | null; typed: string; width: number }

export type Swarm = { backers: number; balance: number; id: string; left: number; mood: Mood; pitch: string; title: string; word: Status.Word }

export type Field = { balance: number; ideas: { id: string; title: string }[]; open: number; swarms: Swarm[]; working: number }

export const ink = '#000000'
export const soft = '#3d5232'
export const quiet = '#5c7350'
export const deep = '#1a3d2c'
export const line = '#e3e9dd'

export const tones: Record<Mood, readonly [string, string, string]> = {
  live: ['#e6f3df', '#bfe0ad', '#1a7a3c'],
  money: ['#fbf3e1', '#f1d9a6', '#b8801a'],
  new: ['#f3f6ee', '#e1e9d6', '#6d8e52'],
}

export const dots: Record<Mood, string> = { live: '#2fae5a', money: '#e0a43c', new: '#6d8e52' }

export function item(swarm: Summary): Swarm {
  const stood = Status.standing(swarm)
  const pitch = Answer.opening(swarm.goal, swarm.title) || Status.line(stood.word)
  return { backers: swarm.contributors, balance: Number(swarm.balance), id: swarm.id, left: Number(swarm.remaining), mood: stood.mood, pitch, title: swarm.title, word: stood.word }
}

export function idea(problem: Problem): Swarm {
  return { backers: 0, balance: 0, id: `idea:${problem.id}`, left: 0, mood: 'new', pitch: problem.hint, title: problem.title, word: 'Not started' }
}

function escape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

type Say = { anchor?: 'start' | 'middle' | 'end'; fill?: string; opacity?: number; spacing?: number }

function say(face: Face, x: number, y: number, content: string, size: number, options: Say = {}) {
  const spacing = options.spacing ? ` letter-spacing="${options.spacing.toFixed(2)}"` : ''
  const anchor = options.anchor && options.anchor !== 'start' ? ` text-anchor="${options.anchor}"` : ''
  const opacity = options.opacity !== undefined ? ` fill-opacity="${options.opacity}"` : ''
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${face.family}" font-size="${size.toFixed(1)}"${spacing}${anchor}${opacity} fill="${options.fill ?? ink}">${escape(content)}</text>`
}

function box(x: number, y: number, wide: number, high: number, radius: number, fill: string, extra = '') {
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${wide.toFixed(1)}" height="${high.toFixed(1)}" rx="${radius.toFixed(1)}" fill="${fill}"${extra}/>`
}

function gradient(id: string, mood: Mood) {
  const [from, to] = tones[mood]
  return `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`
}

function hash(text: string, seed: number) {
  let value = 2166136261 ^ seed
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  return ((value >>> 0) % 100000) / 100000
}

function scale(width: number, height: number) {
  const k = Math.min(width / 1200, height / 630)
  return { k, margin: Math.round(56 * k) }
}

function brand(fonts: Fonts, x: number, y: number, k: number) {
  return say(fonts.serif, x, y, 'Swarms', 34 * k, { spacing: -0.6 * k })
}

function block(fonts: Fonts, face: Face, text: string, size: number, room: number, most: number, spacing = 0) {
  return Glyphs.wrap(face, text, size, room, most, spacing)
}

function stack(face: Face, lines: string[], x: number, first: number, size: number, leading: number, options: Say) {
  return lines.map((row, index) => say(face, x, first + index * size * leading, row, size, options)).join('')
}

function far(hive: Hive, panel: { h: number; w: number; x: number; y: number }, color: string) {
  return Array.from({ length: 3 }, (_, index) => {
    const x = panel.x + 30 + hash(hive.seed, 200 + index) * (panel.w - 60)
    const y = panel.y + 30 + hash(hive.seed, 210 + index) * (panel.h - 60)
    return `<line x1="${hive.x.toFixed(1)}" y1="${hive.y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-opacity=".25" stroke-width="1.4" stroke-dasharray="3 7"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="none" stroke="${color}" stroke-opacity=".4" stroke-width="1.6"/>`
  }).join('')
}

function chip(fonts: Fonts, x: number, y: number, word: Status.Word, mood: Mood, k: number, fill = '#ffffff') {
  const size = 17 * k
  const label = Status.pill(word)
  const wide = Glyphs.width(fonts.mono, label, size) + 52 * k
  const high = 40 * k
  const dot = { color: dots[mood], radius: 5.5 * k, x: x + 22 * k, y: y + high / 2 }
  const mark =
    mood === 'money'
      ? `<rect x="${(dot.x - 4.5 * k).toFixed(1)}" y="${(dot.y - 4.5 * k).toFixed(1)}" width="${(9 * k).toFixed(1)}" height="${(9 * k).toFixed(1)}" rx="${k.toFixed(1)}" fill="${dot.color}" transform="rotate(45 ${dot.x.toFixed(1)} ${dot.y.toFixed(1)})"/>`
      : mood === 'new'
        ? `<circle cx="${dot.x.toFixed(1)}" cy="${dot.y.toFixed(1)}" r="${(4.6 * k).toFixed(1)}" fill="none" stroke="${dot.color}" stroke-width="${(1.8 * k).toFixed(1)}"/>`
        : ''
  return {
    pulse: mood === 'live' ? dot : null,
    svg: box(x, y, wide, high, high / 2, fill, fill === '#ffffff' ? ' fill-opacity=".94"' : '') + mark + say(fonts.mono, x + 38 * k, y + high / 2 + size * 0.36, label, size, { fill: '#26391e', spacing: 0.3 * k }),
    wide,
  }
}

export function swarm(fonts: Fonts, item: Swarm, width: number, height: number, cta = 'Ride it'): Scene {
  const { k, margin } = scale(width, height)
  const inset = Math.round(margin / 2)
  const panel = { h: height - inset * 2, w: Math.round(width * 0.4), x: 0, y: inset }
  panel.x = width - inset - panel.w
  const right = panel.x - margin * 0.85
  const room = right - margin
  const hive: Hive = { kind: 'cover', mood: item.mood, reach: Math.min(panel.w, panel.h) * 0.3, seed: item.id, x: panel.x + panel.w * (0.42 + hash(item.id, 1) * 0.16), y: panel.y + panel.h * (0.44 + hash(item.id, 2) * 0.14) }
  const tag = chip(fonts, panel.x + 24 * k, panel.y + 24 * k, item.word, item.mood, k)
  const sizes = [64, 56, 48].map((size) => size * k)
  let size = sizes[0] ?? 64
  let title = block(fonts, fonts.serif, item.title, size, room, 3, -0.035 * size)
  for (const next of sizes) {
    size = next
    title = block(fonts, fonts.serif, item.title, size, room, next === sizes.at(-1) ? 4 : 3, -0.035 * size)
    if (Glyphs.wrap(fonts.serif, item.title, size, room, 9, -0.035 * size).length <= (next === sizes.at(-1) ? 4 : 3)) break
  }
  const top = margin + 36 * k
  const first = top + 58 * k + size * 0.8
  const leading = 1.06
  const after = first + (title.length - 1) * size * leading + size * 0.28
  const foot = height - margin
  const gaugeTop = foot - 92 * k
  const pitchSize = 25 * k
  const pitchLeading = 1.42
  const pitchFirst = after + 22 * k + pitchSize
  const fit = Math.max(0, Math.floor((gaugeTop - 30 * k - pitchFirst) / (pitchSize * pitchLeading)) + 1)
  const pitch = item.pitch ? block(fonts, fonts.serif, item.pitch, pitchSize, room, Math.min(4, fit)) : []
  const lines = pitch.map((row, index) => ({
    high: pitchSize * 1.32,
    left: margin - 2,
    top: pitchFirst + index * pitchSize * pitchLeading - pitchSize * 0.98,
    wide: Glyphs.width(fonts.serif, row, pitchSize) + 6,
  }))
  const fill = item.balance > 0 ? Math.min(1, Math.max(0, item.left / item.balance)) : 0
  const leftLabel = item.balance > 0 ? `${Answer.cash(item.left)} left` : ''
  const labelWide = leftLabel ? Glyphs.width(fonts.mono, leftLabel, 17 * k) + 16 * k : 0
  const gauge = { color: fill < 0.15 ? '#e0a43c' : '#3f8a4e', fill, high: 8 * k, left: margin, top: gaugeTop, wide: room - labelWide }
  const track =
    item.balance > 0
      ? box(gauge.left, gauge.top, gauge.wide, gauge.high, gauge.high / 2, '#eef2ea')
      : `<line x1="${gauge.left}" y1="${(gauge.top + gauge.high / 2).toFixed(1)}" x2="${gauge.left + room}" y2="${(gauge.top + gauge.high / 2).toFixed(1)}" stroke="#d9e2cf" stroke-width="${gauge.high.toFixed(1)}" stroke-dasharray="${(9 * k).toFixed(1)} ${(7 * k).toFixed(1)}"/>`
  const button = Glyphs.width(fonts.mono, `${cta} →`, 19 * k) + 56 * k
  const money =
    item.balance > 0
      ? say(fonts.serif, margin, foot, Answer.cash(item.balance), 52 * k, { spacing: -1.8 * k }) +
        say(fonts.mono, margin + Glyphs.width(fonts.serif, Answer.cash(item.balance), 52 * k, -1.8 * k) + 14 * k, foot - 2 * k, `balance · ${item.backers} rider${item.backers === 1 ? '' : 's'}`, 18 * k, { fill: quiet })
      : say(fonts.serif, margin, foot - 4 * k, 'Be the first rider', 36 * k, { spacing: -0.8 * k })
  const parts = [
    `<defs>${gradient('cover', item.mood)}</defs>`,
    box(0, 0, width, height, 0, '#ffffff'),
    box(panel.x, panel.y, panel.w, panel.h, 30 * k, 'url(#cover)'),
    far(hive, panel, tones[item.mood][2]),
    tag.svg,
    brand(fonts, margin, top, k),
    stack(fonts.serif, title, margin, first, size, leading, { spacing: -0.035 * size }),
    track,
    leftLabel ? say(fonts.mono, right, gauge.top + gauge.high / 2 + 6 * k, leftLabel, 17 * k, { anchor: 'end', fill: quiet }) : '',
    money,
    box(right - button, foot - 40 * k, button, 54 * k, 27 * k, deep),
    say(fonts.mono, right - button / 2, foot - 40 * k + 27 * k + 7 * k, `${cta} →`, 19 * k, { anchor: 'middle', fill: '#ffffff' }),
  ].join('')
  const typed = stack(fonts.serif, pitch, margin, pitchFirst, pitchSize, pitchLeading, { fill: soft })
  return { gauge: item.balance > 0 ? gauge : null, height, hives: [hive], lines, links: [], parts, pulse: tag.pulse, typed, width }
}

function place(spots: { r: number; x: number; y: number }[], avoid: { h: number; w: number; x: number; y: number }[], area: { h: number; w: number; x: number; y: number }, radius: number, seed: string) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const x = area.x + radius + hash(seed, 1000 + attempt * 2) * (area.w - radius * 2)
    const y = area.y + radius + hash(seed, 1001 + attempt * 2) * (area.h - radius * 2)
    const clear = avoid.every((zone) => x + radius < zone.x || x - radius > zone.x + zone.w || y + radius < zone.y || y - radius > zone.y + zone.h)
    const apart = spots.every((spot) => Math.hypot(spot.x - x, spot.y - y) > spot.r + radius + 12)
    if (clear && apart) {
      const spot = { r: radius, x, y }
      spots.push(spot)
      return spot
    }
  }
  return undefined
}

function sky(field: Field, width: number, height: number, k: number, avoid: { h: number; w: number; x: number; y: number }[], area: { h: number; w: number; x: number; y: number }) {
  const spots: { r: number; x: number; y: number }[] = []
  const hives: Hive[] = []
  for (const item of field.swarms.slice(0, 12)) {
    const reach = (item.mood === 'live' ? 74 : item.mood === 'money' ? 34 + Math.min(34, Math.log10(1 + item.balance) * 22) : 22) * k
    const spot = place(spots, avoid, area, reach * (item.mood === 'money' ? 1.25 : 1), item.id)
    if (spot) hives.push({ kind: item.mood === 'live' ? 'burst' : item.mood === 'money' ? 'smudge' : 'seed', mood: item.mood, reach, seed: item.id, x: spot.x, y: spot.y })
  }
  for (const idea of field.ideas.slice(0, 8)) {
    const spot = place(spots, avoid, area, 16 * k, idea.id)
    if (spot) hives.push({ kind: 'seed', mood: 'new', reach: 11 * k, seed: idea.id, x: spot.x, y: spot.y })
  }
  const links = hives.flatMap((hive, index) => {
    const near = hives.filter((_, other) => other !== index).sort((a, b) => Math.hypot(a.x - hive.x, a.y - hive.y) - Math.hypot(b.x - hive.x, b.y - hive.y))[0]
    if (!near || Math.hypot(near.x - hive.x, near.y - hive.y) > width * 0.3 || hash(hive.seed, 7) > 0.7) return []
    return [{ ax: hive.x, ay: hive.y, bx: near.x, by: near.y }]
  })
  return { hives, links }
}

export function home(fonts: Fonts, field: Field, width: number, height: number): Scene {
  const { k, margin } = scale(width, height)
  const top = margin + 36 * k
  const size = 104 * k
  const heroFirst = height * 0.5 - size * 0.62
  const hero = ['Make a breakthrough.', 'Ride a swarm.']
  const heroWide = Math.max(...hero.map((row) => Glyphs.width(fonts.serif, row, size, -0.05 * size)))
  const subSize = 28 * k
  const sub = Glyphs.wrap(fonts.serif, 'Chip in a few dollars. AI agents get to work, in public.', subSize, 520 * k, 2)
  const subFirst = heroFirst + size * 0.94 + 30 * k + subSize
  const liveY = subFirst + (sub.length - 1) * subSize * 1.36 + 50 * k
  const count = field.open + field.ideas.length
  const facts = [field.working ? `${field.working} working now` : '', `${count} idea${count === 1 ? '' : 's'}`, field.balance > 0 ? `${Answer.cash(field.balance)} to spend` : ''].filter(Boolean).join(' · ')
  const dot = field.working ? { color: dots.live, radius: 5.5 * k, x: margin + 5.5 * k, y: liveY - 6.5 * k } : null
  const avoid = [
    { h: 40 * k, w: 160 * k, x: margin, y: top - 32 * k },
    { h: liveY - heroFirst + size * 0.8 + 16 * k, w: Math.max(heroWide, 540 * k) + 30 * k, x: margin - 10 * k, y: heroFirst - size * 0.8 },
  ]
  const { hives, links } = sky(field, width, height, k, avoid, { h: height - margin, w: width - margin, x: margin / 2, y: margin / 2 })
  const parts = [
    box(0, 0, width, height, 0, '#ffffff'),
    brand(fonts, margin, top, k),
    stack(fonts.serif, hero, margin - 4 * k, heroFirst, size, 0.94, { spacing: -0.05 * size }),
    stack(fonts.serif, sub, margin, subFirst, subSize, 1.36, { fill: soft }),
    say(fonts.mono, margin + (dot ? 20 * k : 0), liveY, facts, 19 * k, { fill: quiet, spacing: 0.4 * k }),
  ].join('')
  return { gauge: null, height, hives, lines: [], links, parts, pulse: dot, typed: '', width }
}

function mini(fonts: Fonts, item: Swarm, x: number, y: number, wide: number, high: number, k: number, index: number) {
  const coverHigh = Math.round(high * 0.46)
  const hive: Hive = { kind: 'cover', mood: item.mood, reach: coverHigh * 0.3, seed: item.id, x: x + wide * (0.36 + hash(item.id, 1) * 0.28), y: y + coverHigh * (0.4 + hash(item.id, 2) * 0.24) }
  const size = 23 * k
  const title = Glyphs.wrap(fonts.serif, item.title, size, wide - 36 * k, 2)
  const tag = chip(fonts, x + 14 * k, y + 14 * k, item.word, item.mood, k * 0.82)
  const stats = item.balance > 0 ? `${Answer.cash(item.balance)} · ${item.backers} rider${item.backers === 1 ? '' : 's'}` : 'Be the first rider'
  const svg = [
    `<defs>${gradient(`mini${index}`, item.mood)}<clipPath id="clip${index}">${box(x, y, wide, high, 18 * k, '#fff')}</clipPath></defs>`,
    `<g clip-path="url(#clip${index})">`,
    box(x, y, wide, high, 0, '#ffffff'),
    box(x, y, wide, coverHigh, 0, `url(#mini${index})`),
    far(hive, { h: coverHigh, w: wide, x, y }, tones[item.mood][2]),
    '</g>',
    box(x + 0.75, y + 0.75, wide - 1.5, high - 1.5, 18 * k, 'none', ` stroke="${line}" stroke-width="1.5"`),
    tag.svg,
    stack(fonts.serif, title, x + 18 * k, y + coverHigh + 22 * k + size * 0.8, size, 1.2, { spacing: -0.3 * k }),
    say(fonts.mono, x + 18 * k, y + high - 20 * k, stats, 15 * k, { fill: quiet }),
    say(fonts.mono, x + wide - 18 * k, y + high - 20 * k, 'Ride it →', 15 * k, { anchor: 'end', fill: deep }),
  ].join('')
  return { hive, pulse: tag.pulse, svg }
}

function shelf(fonts: Fonts, heading: string, note: string, items: Swarm[], width: number, height: number): Scene {
  const { k, margin } = scale(width, height)
  const top = margin + 36 * k
  const size = 60 * k
  const headY = top + 34 * k + size
  const gap = 22 * k
  const count = Math.max(1, Math.min(3, items.length))
  const wide = (width - margin * 2 - gap * (count - 1)) / count
  const cardTop = headY + 42 * k
  const high = height - margin * 0.8 - cardTop
  const cards = items.slice(0, count).map((item, index) => mini(fonts, item, margin + index * (wide + gap), cardTop, wide, high, k, index))
  const parts = [
    box(0, 0, width, height, 0, '#ffffff'),
    brand(fonts, margin, top, k),
    say(fonts.serif, margin - 2 * k, headY, heading, size, { spacing: -0.04 * size }),
    say(fonts.mono, width - margin, headY - 6 * k, note, 18 * k, { anchor: 'end', fill: quiet }),
    ...cards.map((card) => card.svg),
  ].join('')
  return { gauge: null, height, hives: cards.map((card) => card.hive), lines: [], links: [], parts, pulse: cards.find((card) => card.pulse)?.pulse ?? null, typed: '', width }
}

export function ideas(fonts: Fonts, field: Field, width: number, height: number) {
  const count = field.open + field.ideas.length
  const note = [field.working ? `${field.working} working now` : '', `${count} idea${count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
  return shelf(fonts, 'All ideas', note, field.swarms, width, height)
}

export function start(fonts: Fonts, field: Field, width: number, height: number): Scene {
  const { k, margin } = scale(width, height)
  const top = margin + 36 * k
  const size = 60 * k
  const ask = Glyphs.wrap(fonts.serif, 'What should AI figure out or build?', size, width - margin * 2, 2, -0.04 * size)
  const askFirst = top + 62 * k + size * 0.8
  const fieldTop = askFirst + (ask.length - 1) * size * 1.04 + 36 * k
  const boxHigh = 92 * k
  const example = 'e.g. Find the cheapest way to make clean drinking water at home'
  const ideas = field.ideas.slice(0, 3)
  const listTop = fieldTop + boxHigh + 62 * k
  const rowHigh = Math.min(64 * k, (height - margin * 0.7 - listTop) / Math.max(1, ideas.length))
  const hives: Hive[] = []
  const rows = ideas
    .map((idea, index) => {
      const y = listTop + index * rowHigh
      hives.push({ kind: 'seed', mood: 'new', reach: 12 * k, seed: `idea:${idea.id}`, x: margin + 18 * k, y: y + rowHigh / 2 })
      return [
        index ? `<line x1="${margin}" y1="${y.toFixed(1)}" x2="${width - margin}" y2="${y.toFixed(1)}" stroke="${line}" stroke-width="1.5"/>` : '',
        say(fonts.serif, margin + 48 * k, y + rowHigh / 2 + 9 * k, Glyphs.wrap(fonts.serif, idea.title, 26 * k, width - margin * 2 - 260 * k, 1)[0] ?? '', 26 * k),
        say(fonts.mono, width - margin, y + rowHigh / 2 + 6 * k, 'Ride it →', 17 * k, { anchor: 'end', fill: deep }),
      ].join('')
    })
    .join('')
  const parts = [
    box(0, 0, width, height, 0, '#ffffff'),
    brand(fonts, margin, top, k),
    stack(fonts.serif, ask, margin - 2 * k, askFirst, size, 1.04, { spacing: -0.04 * size }),
    box(margin, fieldTop, width - margin * 2, boxHigh, 18 * k, '#fbfcf9', ` stroke="#cfd9c6" stroke-width="1.5"`),
    ideas.length ? say(fonts.mono, margin, listTop - 14 * k, 'Or back one of these', 16 * k, { fill: quiet, spacing: 0.4 * k }) : '',
    rows,
  ].join('')
  const asked = Glyphs.wrap(fonts.serif, example, 26 * k, width - margin * 2 - 60 * k, 1)[0] ?? ''
  const typed = say(fonts.serif, margin + 26 * k, fieldTop + boxHigh / 2 + 9 * k, asked, 26 * k, { fill: '#8a9a80' })
  const lines = [{ high: 26 * k * 1.32, left: margin + 24 * k, top: fieldTop + boxHigh / 2 + 9 * k - 26 * k * 0.98, wide: Glyphs.width(fonts.serif, asked, 26 * k) + 6 }]
  return { gauge: null, height, hives, lines, links: [], parts, pulse: null, typed, width }
}

export function about(fonts: Fonts, width: number, height: number): Scene {
  const { k, margin } = scale(width, height)
  const top = margin + 36 * k
  const size = 72 * k
  const headY = top + 52 * k + size * 0.8
  const steps = ['Pick a swarm, or start one', 'Put in a few dollars and say where it should go', 'AI agents work on it until the money runs out', 'Read what they find and steer again']
  const rowTop = headY + 52 * k
  const rowHigh = (height - margin - rowTop) / steps.length
  const rows = steps
    .map((step, index) => {
      const y = rowTop + index * rowHigh + rowHigh / 2
      return [
        `<circle cx="${(margin + 26 * k).toFixed(1)}" cy="${y.toFixed(1)}" r="${(26 * k).toFixed(1)}" fill="${deep}"/>`,
        say(fonts.mono, margin + 26 * k, y + 7 * k, String(index + 1), 20 * k, { anchor: 'middle', fill: '#ffffff' }),
        say(fonts.serif, margin + 76 * k, y + 11 * k, Glyphs.wrap(fonts.serif, step, 32 * k, width - margin * 2 - 90 * k, 1)[0] ?? '', 32 * k, { spacing: -0.4 * k }),
      ].join('')
    })
    .join('')
  const parts = [box(0, 0, width, height, 0, '#ffffff'), brand(fonts, margin, top, k), say(fonts.serif, margin - 3 * k, headY, 'How it works', size, { spacing: -0.045 * size }), rows].join('')
  return { gauge: null, height, hives: [], lines: [], links: [], parts, pulse: null, typed: '', width }
}

export function docs(fonts: Fonts, width: number, height: number): Scene {
  const { k, margin } = scale(width, height)
  const top = margin + 36 * k
  const size = 68 * k
  const headY = top + 52 * k + size * 0.8
  const lead = Glyphs.wrap(fonts.serif, 'Everything on this site is a public REST API and an MCP server. Reading is free and needs no account.', 27 * k, width - margin * 2, 2)
  const leadFirst = headY + 34 * k + 27 * k
  const codeTop = leadFirst + (lead.length - 1) * 27 * k * 1.38 + 36 * k
  const code = [
    ['GET', '/v1/swarms'],
    ['GET', '/v1/swarms/:id/updates'],
    ['POST', '/v1/swarms/:id/contributions'],
    ['POST', '/mcp  swarms_list · swarm_get · swarm_contribute'],
  ]
  const codeHigh = height - margin * 0.8 - codeTop
  const step = (codeHigh - 40 * k) / code.length
  const column = margin + 30 * k + Glyphs.width(fonts.mono, 'POST', 20 * k) + 22 * k
  const parts = [
    box(0, 0, width, height, 0, '#ffffff'),
    brand(fonts, margin, top, k),
    say(fonts.serif, margin - 3 * k, headY, 'Use swarms from code', size, { spacing: -0.04 * size }),
    stack(fonts.serif, lead, margin, leadFirst, 27 * k, 1.38, { fill: soft }),
    box(margin, codeTop, width - margin * 2, codeHigh, 18 * k, '#161616'),
    code
      .map(([method = '', path = ''], index) => {
        const y = codeTop + 20 * k + step * (index + 0.5) + 7 * k
        return say(fonts.mono, margin + 30 * k, y, method, 20 * k, { fill: '#9fe6a0' }) + say(fonts.mono, column, y, path, 20 * k, { fill: '#f3f6ee' })
      })
      .join(''),
  ].join('')
  return { gauge: null, height, hives: [], lines: [], links: [], parts, pulse: null, typed: '', width }
}
