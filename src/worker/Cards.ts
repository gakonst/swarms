import * as Answer from '../shared/Answer.ts'
import type { Summary } from '../shared/Api.ts'
import type { Problem } from '../shared/ResearchBrief.ts'
import type { Mood } from '../shared/Status.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Status from '../shared/Status.ts'
import * as Glyphs from './Glyphs.ts'
import type { Face } from './Glyphs.ts'

export type Fonts = { mono: Face; serif: Face }

export type Swarm = { backers: number; balance: number; id: string; left: number; mood: Mood; pitch: string; title: string; word: Status.Word }

export type Field = { balance: number; ideas: { id: string; title: string }[]; open: number; swarms: Swarm[]; working: number }

export type Cell = 'dead' | 'flight' | 'open' | 'proven'

/** One node of a task tree in depth-first order: its parent's index (-1 for the root) and how it stands. */
export type Twig = { cell: Cell; up: number }

/** One "+" mark of a card's drawing. ring circles the node a node card is about; sway is how far it drifts in a film. */
export type Mark = { color: string; ring: boolean; size: number; sway: number; x: number; y: number }

export type Hub = { r: number; x: number; y: number }

export type Scene = { height: number; hub: Hub; marks: Mark[]; parts: string; width: number }

// Paradigm's link card: a flat grey page, a black serif title and one black drawing of "+" marks.
export const paper = '#F6F6F6'
export const ink = '#000000'
export const soft = '#333333'
export const quiet = '#666666'
export const faint = '#999999'

/** The only colours a mark takes: proven is the one accent. */
export const shades: Record<Cell, string> = { dead: '#999999', flight: '#000000', open: '#CCCCCC', proven: '#00E10A' }

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

function say(face: Face, x: number, y: number, content: string, size: number, fill = ink, spacing = 0) {
  const space = spacing ? ` letter-spacing="${spacing.toFixed(2)}"` : ''
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${face.family}" font-size="${size.toFixed(1)}"${space} fill="${fill}">${escape(content)}</text>`
}

function hash(text: string, seed: number) {
  let value = 2166136261 ^ seed
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619)
  return ((value >>> 0) % 100000) / 100000
}

/** Where things sit on a card of any size, measured from Paradigm's 1200x630 card. */
function frame(width: number, height: number) {
  const k = Math.min(width / 1200, height / 630)
  const kx = width / 1200
  const hub = { r: 158 * k, x: 895 * kx, y: height / 2 }
  const left = 152 * kx
  return { hub, k, left, room: hub.x - hub.r - 64 * k - left }
}

// ---------------------------------------------------------------- the drawing

type Point = { r: number; x: number; y: number }

/** A path from the right of the hub, up and round, curling inward: one sweep for a small tree, more turns for a big one. */
function path(hub: Hub, turns: number, inner: number, bend: number, start: number) {
  const sweep = turns * Math.PI * 2
  const step = 0.004
  const points: (Point & { at: number })[] = []
  let at = 0
  let last: Point | undefined
  for (let phi = 0; phi <= sweep + 1e-9; phi += step) {
    const r = hub.r - (hub.r - inner) * (phi / sweep) ** bend
    const angle = start - phi
    const point = { r, x: hub.x + r * Math.cos(angle), y: hub.y + r * Math.sin(angle) }
    if (last) at += Math.hypot(point.x - last.x, point.y - last.y)
    points.push({ ...point, at })
    last = point
  }
  return points
}

function along(points: readonly (Point & { at: number })[], at: number): Point {
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((points[mid]?.at ?? 0) < at) lo = mid + 1
    else hi = mid
  }
  const found = points[lo] ?? points[points.length - 1]
  return found ?? { r: 0, x: 0, y: 0 }
}

/**
 * Lays a task tree out as one airy spiral of marks: the leaves in tree order along the spiral, and every node with
 * children inside it, toward its leaves, nearer the middle the closer it is to the root. Returns one point per twig.
 */
export function layout(twigs: readonly Twig[], hub: Hub, k: number, seed = ''): { size: number; x: number; y: number }[] {
  const count = twigs.length
  if (!count) return []
  if (count === 1) return [{ size: 9 * k, x: hub.x, y: hub.y }]
  const kids: number[][] = twigs.map(() => [])
  twigs.forEach((twig, index) => {
    if (twig.up >= 0 && twig.up < index) kids[twig.up]?.push(index)
  })
  const leaves = twigs.map((_, index) => index).filter((index) => !kids[index]?.length)
  const start = -0.1 - hash(seed, 1) * 0.35
  const gap = 10.5 * k
  hub = { ...hub, r: hub.r * Math.min(1.28, Math.max(1, (leaves.length / 90) ** 0.14)) }
  const one = path(hub, 0.92, hub.r * 0.56, 2.2, start)
  const oneLong = one.at(-1)?.at ?? 0
  let points = one
  let spacing = Math.min(oneLong / leaves.length, 40 * k)
  let size = 9 * k
  if (leaves.length * 9.2 * k > oneLong) {
    // More turns, each further in, until every leaf has room: the rings stay wide apart for a mid-size tree.
    const floor = hub.r * 0.3
    for (let turns = 1.25; ; turns += 0.25) {
      points = path(hub, turns, floor, 1.3, start)
      const long = points.at(-1)?.at ?? 0
      if (long >= leaves.length * gap || (hub.r - floor) / turns <= 10 * k) {
        spacing = long / leaves.length
        size = Math.max(5 * k, Math.min(9 * k, spacing - 1.5 * k))
        break
      }
    }
  }
  const at: { size: number; x: number; y: number }[] = twigs.map(() => ({ size, x: hub.x, y: hub.y }))
  leaves.forEach((index, order) => {
    const point = along(points, order * spacing)
    at[index] = { size, x: point.x, y: point.y }
  })
  const inner = Math.min(...leaves.map((index) => Math.hypot((at[index]?.x ?? 0) - hub.x, (at[index]?.y ?? 0) - hub.y)))
  const depth = twigs.map(() => 0)
  for (let index = 1; index < count; index++) depth[index] = (depth[twigs[index]?.up ?? 0] ?? 0) + 1
  const sum = twigs.map(() => ({ n: 0, x: 0, y: 0 }))
  for (let index = count - 1; index >= 0; index--) {
    const own = sum[index]
    if (!own) continue
    if (!kids[index]?.length) {
      own.n += 1
      own.x += at[index]?.x ?? 0
      own.y += at[index]?.y ?? 0
    }
    const up = sum[twigs[index]?.up ?? -1]
    if (up) {
      up.n += own.n
      up.x += own.x
      up.y += own.y
    }
  }
  const forks = twigs.map((_, index) => index).filter((index) => kids[index]?.length)
  const deepest = Math.max(0, ...forks.map((index) => depth[index] ?? 0))
  const placed: { x: number; y: number }[] = leaves.map((index) => at[index] ?? { x: 0, y: 0 })
  for (const index of forks) {
    const own = sum[index] ?? { n: 1, x: hub.x, y: hub.y }
    const first = leaves.find((leaf) => leaf > index) ?? index
    const cx = own.x / Math.max(1, own.n) - hub.x
    const cy = own.y / Math.max(1, own.n) - hub.y
    let angle = Math.hypot(cx, cy) > hub.r * 0.12 ? Math.atan2(cy, cx) : Math.atan2((at[first]?.y ?? hub.y) - hub.y, (at[first]?.x ?? hub.x) - hub.x)
    const rim = Math.min(inner * 1.6, Math.hypot((at[first]?.x ?? hub.x) - hub.x, (at[first]?.y ?? hub.y) - hub.y))
    const reach = rim * 0.8 * ((depth[index] ?? 0) + 0.3) / (deepest + 0.3)
    let x = hub.x + reach * Math.cos(angle)
    let y = hub.y + reach * Math.sin(angle)
    for (let tries = 0; tries < 24 && placed.some((spot) => Math.hypot(spot.x - x, spot.y - y) < 12 * k); tries++) {
      angle += (13 * k) / Math.max(reach, 13 * k)
      x = hub.x + reach * Math.cos(angle)
      y = hub.y + reach * Math.sin(angle)
    }
    placed.push({ x, y })
    at[index] = { size, x, y }
  }
  const xs = at.map((point) => point.x)
  const ys = at.map((point) => point.y)
  const dx = hub.x - (Math.min(...xs) + Math.max(...xs)) / 2
  const dy = hub.y - (Math.min(...ys) + Math.max(...ys)) / 2
  return at.map((point) => ({ size: point.size, x: point.x + dx, y: point.y + dy }))
}

/** Marks for a task tree: one per node, coloured by how it stands. */
export function draw(twigs: readonly Twig[], hub: Hub, k: number, seed = '', ring = -1, sway = 0): Mark[] {
  return layout(twigs, hub, k, seed).map((point, index) => ({ color: shades[twigs[index]?.cell ?? 'open'], ring: index === ring, size: point.size, sway, x: point.x, y: point.y }))
}

/** A made-up swarm drawn in black, for pages that are not one swarm: a spiral of runs with a trail of programs inside it. */
export function flock(seed: string) {
  const twigs: Twig[] = [{ cell: 'flight', up: -1 }]
  let up = 0
  const programs = 6 + Math.floor(hash(seed, 2) * 3)
  for (let program = 0; program < programs; program++) {
    const leaves = 7 + Math.floor(hash(seed, 10 + program) * 4)
    for (let leaf = 0; leaf < leaves; leaf++) twigs.push({ cell: 'flight', up })
    twigs.push({ cell: 'flight', up })
    up = twigs.length - 1
  }
  for (let leaf = 0; leaf < 6; leaf++) twigs.push({ cell: 'flight', up })
  return twigs
}

// ---------------------------------------------------------------- the words

type Row = { cell?: Cell; fill?: string; text: string }

/** Wraps a small line onto at most two, breaking between " · " parts when it has them. */
function pack(face: Face, text: string, size: number, room: number) {
  const parts = text.split(' · ')
  if (parts.length < 2 || Glyphs.width(face, text, size) <= room) return Glyphs.wrap(face, text, size, room, 2)
  const lines: string[] = []
  for (const part of parts) {
    const last = lines.at(-1)
    if (last !== undefined && Glyphs.width(face, `${last} · ${part}`, size) <= room) lines[lines.length - 1] = `${last} · ${part}`
    else lines.push(part)
  }
  return lines.length <= 2 ? lines.flatMap((line) => Glyphs.wrap(face, line, size, room, 1)) : Glyphs.wrap(face, text, size, room, 2)
}

/** The left half: an optional small kicker, the serif title and a few small mono lines, centred on the card's height. */
function column(fonts: Fonts, width: number, height: number, kicker: string, title: string, rows: readonly Row[], biggest = 52) {
  const { k, left, room } = frame(width, height)
  const sizes = [biggest, 46, 40, 34].filter((size) => size <= biggest).map((size) => size * k)
  let size = sizes[0] ?? 52 * k
  let lines = [title]
  for (const next of sizes) {
    size = next
    const most = next === sizes.at(-1) ? 3 : next >= 46 * k ? 2 : 3
    lines = Glyphs.wrap(fonts.serif, title, size, room, most, -0.01 * size)
    const all = Glyphs.wrap(fonts.serif, title, size, room, 9, -0.01 * size)
    const orphan = all.length > 1 && Glyphs.width(fonts.serif, all.at(-1) ?? '', size) < room * 0.3
    if (all.length <= most && !orphan) break
  }
  const mono = 17 * k
  const lead = 29 * k
  const marked = rows.some((row) => row.cell)
  const indent = marked ? 22 * k : 0
  const shown = rows.flatMap((row) => pack(fonts.mono, row.text, mono, room - indent).map((text, index) => ({ ...row, cell: index ? undefined : row.cell, text })))
  const kickHigh = kicker ? 12 * k + 26 * k : 0
  const titleHigh = size * 0.72 + (lines.length - 1) * size * 1.12 + size * 0.2
  const rowsHigh = shown.length ? 34 * k + 12 * k + (shown.length - 1) * lead : 0
  let y = height / 2 - (kickHigh + titleHigh + rowsHigh) / 2
  const parts: string[] = []
  if (kicker) {
    parts.push(say(fonts.mono, left, y + 12 * k, Glyphs.wrap(fonts.mono, kicker, 15 * k, room, 1)[0] ?? '', 15 * k, faint))
    y += kickHigh
  }
  lines.forEach((line, index) => parts.push(say(fonts.serif, left - 2 * k, y + size * 0.72 + index * size * 1.12, line, size, ink, -0.01 * size)))
  y += titleHigh + 34 * k + 12 * k
  const marks: Mark[] = []
  shown.forEach((row, index) => {
    const base = y + index * lead
    if (row.cell) marks.push({ color: shades[row.cell], ring: false, size: 9 * k, sway: 0, x: left + 4.5 * k, y: base - 5.5 * k })
    parts.push(say(fonts.mono, left + indent, base, row.text, mono, row.fill ?? soft))
  })
  return { marks, parts: parts.join('') }
}

function page(width: number, height: number) {
  return `<rect width="${width}" height="${height}" fill="${paper}"/>`
}

function card(fonts: Fonts, width: number, height: number, words: { biggest?: number; kicker: string; rows: readonly Row[]; title: string }, drawing: (hub: Hub, k: number) => Mark[]): Scene {
  const { hub, k } = frame(width, height)
  const text = column(fonts, width, height, words.kicker, words.title, words.rows, words.biggest)
  return { height, hub, marks: [...drawing(hub, k), ...text.marks], parts: page(width, height) + text.parts, width }
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

function riders(count: number) {
  return plural(count, 'rider')
}

/** An earlier swarm, one agent in one thread, or an idea nobody started: its title and where its money stands. */
export function swarm(fonts: Fonts, item: Swarm, width: number, height: number): Scene {
  const money = item.balance > 0 ? `${Answer.cash(item.balance)} ridden · ${riders(item.backers)}` : 'No riders yet'
  const left = item.balance > 0 ? `${Answer.cash(Math.max(0, item.left))} left` : ''
  return card(fonts, width, height, { kicker: 'Swarms', rows: [{ text: Status.pill(item.word) }, ...(money === Status.pill(item.word) ? [] : [{ text: money }]), ...(left ? [{ fill: quiet, text: left }] : [])], title: item.title }, (hub, k) =>
    draw(flock(item.id), hub, k, item.id, -1, item.mood === 'live' ? 1 : 0.4),
  )
}

export function home(fonts: Fonts, field: Field, width: number, height: number): Scene {
  const count = field.open + field.ideas.length
  const facts = [field.working ? `${field.working} working now` : '', plural(count, 'idea'), field.balance > 0 ? `${Answer.cash(field.balance)} to spend` : ''].filter(Boolean).join(' · ')
  return card(fonts, width, height, { biggest: 46, kicker: '', rows: [{ text: 'Make a breakthrough. Ride a swarm.' }, { fill: quiet, text: facts }], title: 'Swarms' }, (hub, k) => draw(flock('home'), hub, k, 'home', -1, 1))
}

export function ideas(fonts: Fonts, field: Field, width: number, height: number): Scene {
  const count = field.open + field.ideas.length
  const rows = [field.working ? { text: `${field.working} working now` } : undefined, { text: plural(count, 'idea') }, field.balance > 0 ? { text: `${Answer.cash(field.balance)} to spend` } : undefined].filter((row): row is Row => !!row)
  return card(fonts, width, height, { kicker: 'Swarms', rows, title: 'All swarms' }, (hub, k) => draw(flock('ideas'), hub, k, 'ideas', -1, 1))
}

export function start(fonts: Fonts, field: Field, width: number, height: number): Scene {
  const rows = [{ text: 'What should AI figure out or build?' }, { fill: quiet, text: 'Chip in a few dollars. Agents work on it in public.' }]
  void field
  return card(fonts, width, height, { kicker: 'Swarms', rows, title: 'Start a swarm' }, (hub, k) => draw(flock('new'), hub, k, 'new', -1, 1))
}

export function about(fonts: Fonts, width: number, height: number): Scene {
  const rows = ['Ride a lemma, a program or the whole swarm', 'Money flows down to work that can start now', 'Lean decides what is proven', 'Every dead end is kept, with why'].map((text) => ({ text }))
  return card(fonts, width, height, { kicker: 'Swarms', rows, title: 'How it works' }, (hub, k) => draw(flock('about'), hub, k, 'about'))
}

export function docs(fonts: Fonts, width: number, height: number): Scene {
  const rows = [{ text: 'GET /v1/swarms/:id/tree' }, { text: 'POST /v1/swarms/:id/contributions' }, { text: 'MCP swarm_tree · swarm_node' }, { fill: quiet, text: 'Reading is free and needs no account' }]
  return card(fonts, width, height, { kicker: 'Swarms', rows, title: 'Use swarms from code' }, (hub, k) => draw(flock('docs'), hub, k, 'docs'))
}

// ---------------------------------------------------------------- the tree

export type Grove = { cells: Cell[]; deadEnds: number; frontier: number; id: string; inFlight: number; perProven: number | null; proven: number; ridden: number; spent: number; title: string; twigs: Twig[] }

export type Leaf = { at: number; checked: string | null; counts: Record<Tree.Status, number>; form: Tree.Form; id: string; review: boolean; ridden: number; riders: number; spent: number; status: Tree.Status; swarm: string; title: string; twigs: Twig[]; why: string; working: boolean }

const ends: Record<Tree.End['kind'], string> = {
  barrier: 'Stopped by a known barrier',
  exhausted: 'Ran out of ideas',
  merged: 'Merged into another node',
  refuted: 'Refuted',
  rejected: 'Rejected in triage',
  withdrawn: 'Withdrawn by its riders',
}

export const words: Record<Tree.Status, string> = { 'dead end': 'Dead end', funded: 'Ridden', 'in flight': 'In flight', proposed: 'Proposed', proven: 'Proven' }

export function why(node: Tree.Node) {
  if (node.status === 'proven') return node.proof ? `Lean checked ${node.proof.theorem} against its frozen statement.` : 'Lean checked it against its frozen statement.'
  if (node.status === 'dead end') {
    const kind = node.end ? (node.end.kind === 'refuted' && node.end.check ? 'Refuted, checked by Lean' : ends[node.end.kind]) : 'Ended'
    return node.end?.why ? `${kind}: ${node.end.why}` : `${kind}.`
  }
  if (node.status === 'in flight') return node.run?.checking ? 'A proof is in, and Lean is checking it.' : 'A worker is on it now.'
  if (node.status === 'funded') return node.needs.length ? 'Ridden, and waiting for what it needs to be proven.' : 'Ridden, and waiting for a free worker.'
  return Number(node.money.spent) > 0 ? 'Out of money. Ride it to start it again.' : 'Waiting for its first rider.'
}

export function cell(status: Tree.Status): Cell {
  return status === 'proven' ? 'proven' : status === 'dead end' ? 'dead' : status === 'in flight' ? 'flight' : 'open'
}

type View = { headline: Tree.Headline; nodes: readonly Tree.Node[] }

/** The tree in depth-first order from its root, then anything the read did not reach from it. */
export function order(nodes: readonly Tree.Node[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const found: Tree.Node[] = []
  const seen = new Set<string>()
  const walk = (id: string) => {
    const node = byId.get(id)
    if (!node || seen.has(id)) return
    seen.add(id)
    found.push(node)
    for (const child of node.children) walk(child)
  }
  walk('root')
  for (const node of nodes) walk(node.id)
  return found
}

export function twigs(nodes: readonly Tree.Node[]): Twig[] {
  const found = order(nodes)
  const index = new Map(found.map((node, at) => [node.id, at]))
  const above = new Map<string, number>()
  found.forEach((node, at) => {
    for (const child of node.children) if (!above.has(child) && (index.get(child) ?? -1) > at) above.set(child, at)
  })
  return found.map((node, at) => {
    const up = above.get(node.id) ?? (node.parent === null ? -1 : (index.get(node.parent) ?? (at ? 0 : -1)))
    return { cell: cell(node.status), up: up < at ? up : at ? 0 : -1 }
  })
}

export function grove(swarm: string, view: View): Grove {
  const found = order(view.nodes)
  const head = view.headline
  return {
    cells: found.filter((node) => node.form === 'lemma').map((node) => cell(node.status)),
    deadEnds: head.deadEnds,
    frontier: head.frontier,
    id: swarm,
    inFlight: head.inFlight,
    perProven: head.perProven === null ? null : Number(head.perProven),
    proven: head.proven,
    ridden: Number(head.pledged),
    spent: Number(head.spent),
    title: found.find((node) => node.id === 'root')?.title ?? 'Swarm',
    twigs: twigs(view.nodes),
  }
}

/** A node alone, without its tree: itself with what is under it, one mark per node its counts name. */
function alone(node: Tree.Node, counts: Record<Tree.Status, number>): Twig[] {
  const out: Twig[] = [{ cell: cell(node.status), up: -1 }]
  for (const status of ['proven', 'in flight', 'dead end', 'funded', 'proposed'] as const) for (let index = 0; index < Math.min(counts[status], 400); index++) out.push({ cell: cell(status), up: 0 })
  return out
}

export function leaf(swarm: string, title: string, node: Tree.Node & { review?: boolean }, view?: { nodes: readonly Tree.Node[] }): Leaf {
  const counts = { ...node.counts }
  counts[node.status] = Math.max(0, counts[node.status] - 1)
  const known = view ? order(view.nodes).findIndex((other) => other.id === node.id) : -1
  return {
    at: known >= 0 ? known : 0,
    checked: node.status === 'proven' && node.proof ? node.proof.commit.slice(0, 7) : null,
    counts,
    form: node.form,
    id: node.id,
    review: node.review === true,
    ridden: Number(node.money.subtree.pledged) + Number(node.money.inherited),
    riders: node.riders,
    spent: Number(node.money.subtree.spent),
    status: node.status,
    swarm: title,
    title: node.title,
    twigs: view && known >= 0 ? twigs(view.nodes) : alone(node, counts),
    why: why(node),
    working: node.status === 'in flight',
  }
}

export function below(counts: Record<Tree.Status, number>) {
  const parts = [counts.proven ? `${counts.proven.toLocaleString('en-US')} proven` : '', counts['in flight'] ? `${counts['in flight'].toLocaleString('en-US')} in flight` : '', counts['dead end'] ? plural(counts['dead end'], 'dead end') : '', counts.funded + counts.proposed ? `${(counts.funded + counts.proposed).toLocaleString('en-US')} open` : '']
  return parts.filter(Boolean).join(' · ')
}

export function tally(item: Grove) {
  return [`${item.frontier.toLocaleString('en-US')} on the frontier`, `${item.inFlight.toLocaleString('en-US')} in flight`, plural(item.deadEnds, 'dead end')]
}

const kinds: Record<Tree.Form, string> = { approach: 'approach', goal: 'whole swarm', idea: 'idea', lemma: 'lemma', program: 'program', triage: 'triage' }

export function ask(form: Tree.Form) {
  return `Ride this ${kinds[form]}`.replace('this whole', 'the whole')
}

function spent(value: number) {
  return value > 0 ? `${Answer.cash(value)} spent` : 'Nothing spent yet'
}

/** A swarm's card: its title, what is proven, in flight and dead, what it cost, and its whole tree as one spiral of marks. */
export function tree(fonts: Fonts, item: Grove, width: number, height: number): Scene {
  const rows: Row[] = [
    { cell: 'proven', text: `${item.proven.toLocaleString('en-US')} proven` },
    { cell: 'flight', text: `${item.inFlight.toLocaleString('en-US')} in flight` },
    { cell: 'dead', text: plural(item.deadEnds, 'dead end') },
    { text: spent(item.spent) },
  ]
  return card(fonts, width, height, { kicker: 'Swarms', rows, title: item.title }, (hub, k) => draw(item.twigs, hub, k, item.id))
}

/** A node's card: the swarm, the node's title, how it stands and why, what is under it, what it cost, and the tree with this node circled. */
export function node(fonts: Fonts, item: Leaf, width: number, height: number): Scene {
  const status = item.checked ? `Proven · checked by Lean · ${item.checked}` : words[item.status]
  const under = below(item.counts)
  const rows: Row[] = [
    { cell: cell(item.status), text: status },
    ...(item.review ? [{ fill: ink, text: 'Statement under review' }] : []),
    ...(item.status === 'dead end' ? [{ fill: quiet, text: item.why }] : []),
    ...(under ? [{ text: `Under it: ${under}` }] : []),
    { text: spent(item.spent) },
  ]
  return card(fonts, width, height, { biggest: 48, kicker: item.swarm, rows, title: item.title }, (hub, k) => draw(item.twigs, hub, k, item.swarm, item.at))
}
