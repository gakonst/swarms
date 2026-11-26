import type { Artifact } from './Api.ts'
import * as Limits from './Limits.ts'

export const slug = 'surface'

export type Tone = 'good' | 'bad' | 'warn' | 'live' | 'quiet'

export type Ask = { action: 'back' | 'chat'; amount: string | null; label: string; text: string; why: string | null }
export type Stat = { label: string; value: string }
export type Check = { group: string | null; state: 'done' | 'doing' | 'todo' | 'failed'; text: string }
export type Bar = { label: string; note: string | null; tone: Tone | null; value: number }
export type Row = { note: string | null; state: string | null; text: string; tone: Tone | null }
export type Tile = { label: string; state: string | null; tone: Tone | null }

type Base = { id: string; title: string | null; wide: boolean }

export type Node = Base &
  (
    | { kind: 'asks'; items: Ask[] }
    | { kind: 'stats'; items: Stat[] }
    | { kind: 'checklist'; items: Check[] }
    | { goal: number | null; goalLabel: string | null; kind: 'chart'; points: number[]; tried: [number, number][]; unit: string | null }
    | { kind: 'bars'; items: Bar[]; max: number | null; mark: number | null; unit: string | null }
    | { kind: 'list'; items: Row[]; numbered: boolean }
    | { kind: 'meter'; label: string | null; max: number; value: number }
    | { high: number; kind: 'range'; low: number; mid: number; note: string | null; unit: string | null }
    | { kind: 'tiles'; items: Tile[] }
    | { kind: 'text'; text: string }
    | { kind: 'status'; items: string[] }
  )

export type Kind = Node['kind']

const cap = Limits.SharedSurface
const most = cap.most

function text(value: unknown, limit: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, limit) : null
}

function number(value: unknown) {
  const cleaned = typeof value === 'string' ? value.trim().replace(/^\$|[,\s]|[%×x]$/g, '') : null
  const parsed = cleaned === null ? value : cleaned ? Number(cleaned) : NaN
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function list(value: unknown, limit: number) {
  return Array.isArray(value) ? value.slice(0, limit) : []
}

function tone(value: unknown): Tone | null {
  const said = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (/^(good|ok|done|pass|passing|kept|keep|supported|merged|high|tested|ported|proved|proven|verified|solved|complete|completed|shipped)$/.test(said)) return 'good'
  if (/^(bad|fail|failed|failing|crash|error|pruned|dropped|discard|discarded|refuted|low)$/.test(said)) return 'bad'
  if (/^(warn|warning|testing|pending|medium|waiting|blocked|parked|porting)$/.test(said)) return 'warn'
  if (/^(live|running|run|working|doing|active|in work|in progress|wip)$/.test(said)) return 'live'
  if (/^(quiet|todo|untouched|idle|none|open)$/.test(said)) return 'quiet'
  return null
}

function check(value: unknown): Check['state'] {
  const said = typeof value === 'string' ? value.trim().toLowerCase() : value === true ? 'done' : ''
  if (/done|complete|finished|passed|^ok$|^yes$/.test(said)) return 'done'
  if (/doing|running|working|current|active|in progress/.test(said)) return 'doing'
  if (/fail|error|blocked|dropped/.test(said)) return 'failed'
  return 'todo'
}

function asks(items: unknown[]) {
  return items.flatMap((item): Ask[] => {
    const fields = record(item)
    const said = fields ? text(fields['text'] ?? fields['ask'] ?? fields['want'], cap.askText) : text(item, cap.askText)
    if (!said) return []
    const action = fields && /chat|room|help|lend|invite|talk/i.test(String(fields['action'] ?? '')) ? 'chat' : 'back'
    const label = text(fields?.['label'] ?? fields?.['button'], 24) ?? (action === 'chat' ? 'Help in the chat' : 'Steer this')
    return [{ action, amount: text(fields?.['amount'], cap.askAmount), label, text: said, why: text(fields?.['why'], cap.askWhy) }]
  })
}

function node(value: unknown, index: number): Node[] {
  const fields = record(value)
  if (!fields) return []
  const base: Base = { id: text(fields['id'], cap.idChars) ?? String(index), title: text(fields['title'], cap.titleChars), wide: fields['wide'] === true }
  const items = (limit: number) => list(fields['items'] ?? fields['rows'], limit)
  switch (String(fields['kind'] ?? '').toLowerCase()) {
    case 'asks':
    case 'attention':
    case 'needs': {
      const read = asks(items(cap.asks))
      return read.length ? [{ ...base, items: read, kind: 'asks' }] : []
    }
    case 'stats': {
      const read = items(cap.stats).flatMap((item): Stat[] => {
        const row = record(item)
        const label = text(row?.['label'], cap.statLabel)
        const shown = text(row?.['value'], cap.statValue)
        return label && shown ? [{ label, value: shown }] : []
      })
      return read.length ? [{ ...base, items: read, kind: 'stats' }] : []
    }
    case 'checklist':
    case 'plan': {
      const read = items(cap.checks).flatMap((item): Check[] => {
        const row = record(item)
        const said = row ? text(row['text'] ?? row['item'], cap.checkText) : text(item, cap.checkText)
        return said ? [{ group: text(row?.['group'], 60), state: check(row?.['state'] ?? row?.['status'] ?? row?.['done']), text: said }] : []
      })
      return read.length ? [{ ...base, items: read, kind: 'checklist' }] : []
    }
    case 'chart': {
      const points = list(fields['points'], cap.points).flatMap((point) => {
        const read = number(point)
        return read === null ? [] : [read]
      })
      if (points.length < 2) return []
      const tried = list(fields['tried'], cap.points).flatMap((pair): [number, number][] => {
        const at = Array.isArray(pair) ? number(pair[0]) : null
        const read = Array.isArray(pair) ? number(pair[1]) : null
        return at !== null && read !== null ? [[at, read]] : []
      })
      return [{ ...base, goal: number(fields['goal']), goalLabel: text(fields['goalLabel'] ?? fields['goal_label'], cap.goalLabel), kind: 'chart', points, tried, unit: text(fields['unit'], cap.unitChars) }]
    }
    case 'bars':
    case 'budget': {
      const read = items(cap.bars).flatMap((item): Bar[] => {
        const row = record(item)
        const label = text(row?.['label'], cap.barLabel)
        const amount = number(row?.['value'])
        return label && amount !== null && amount >= 0 ? [{ label, note: text(row?.['note'], 24), tone: tone(row?.['tone'] ?? row?.['state']), value: amount }] : []
      })
      return read.length ? [{ ...base, items: read, kind: 'bars', mark: number(fields['mark']), max: number(fields['max']), unit: text(fields['unit'], cap.unitChars) }] : []
    }
    case 'list':
    case 'findings':
    case 'hypotheses':
    case 'sources': {
      const read = items(cap.rows).flatMap((item): Row[] => {
        const row = record(item)
        const said = row ? text(row['text'] ?? row['item'], cap.rowText) : text(item, cap.rowText)
        const state = text(row?.['state'] ?? row?.['status'], cap.rowState)
        return said ? [{ note: text(row?.['note'], cap.rowNote), state, text: said, tone: tone(row?.['tone'] ?? state) }] : []
      })
      return read.length ? [{ ...base, items: read, kind: 'list', numbered: fields['numbered'] === true }] : []
    }
    case 'meter': {
      const max = number(fields['max'])
      const read = number(fields['value'])
      return max !== null && max > 0 && read !== null ? [{ ...base, kind: 'meter', label: text(fields['label'], cap.meterLabel), max, value: Math.min(Math.max(read, 0), max) }] : []
    }
    case 'range':
    case 'estimate': {
      const low = number(fields['low'])
      const high = number(fields['high'])
      const mid = number(fields['mid'] ?? fields['value'])
      return low !== null && high !== null && mid !== null && low <= mid && mid <= high ? [{ ...base, high, kind: 'range', low, mid, note: text(fields['note'], cap.rangeNote), unit: text(fields['unit'], cap.rangeUnit) }] : []
    }
    case 'tiles': {
      const read = items(cap.tiles).flatMap((item): Tile[] => {
        const row = record(item)
        const label = row ? text(row['label'], cap.tileLabel) : text(item, cap.tileLabel)
        const state = text(row?.['state'] ?? row?.['status'], cap.tileState)
        return label ? [{ label, state, tone: tone(row?.['tone'] ?? state) }] : []
      })
      return read.length ? [{ ...base, items: read, kind: 'tiles' }] : []
    }
    case 'text':
    case 'note': {
      const said = typeof fields['text'] === 'string' ? fields['text'].trim().slice(0, cap.noteText) : ''
      return said ? [{ ...base, kind: 'text', text: said }] : []
    }
    case 'status':
    case 'now':
    case 'latest': {
      const read = items(cap.statuses).flatMap((item) => {
        const said = text(record(item)?.['text'] ?? item, cap.statusText)
        return said ? [said] : []
      })
      return read.length ? [{ ...base, items: read, kind: 'status' }] : []
    }
    default:
      return []
  }
}

export function is(artifact: Pick<Artifact, 'form' | 'slug' | 'title'>) {
  return artifact.form === 'json' && (artifact.slug === slug || artifact.title.trim().toLowerCase() === slug)
}

export function read(value: unknown): Node[] {
  const listed = record(value)?.['nodes'] ?? value
  if (!Array.isArray(listed)) return []
  const seen = new Set<string>()
  return listed
    .slice(0, most * 2)
    .flatMap(node)
    .filter((item) => !seen.has(item.id) && !!seen.add(item.id))
    .sort((a, b) => Number(b.kind === 'asks') - Number(a.kind === 'asks'))
    .slice(0, most)
}

export function status(nodes: readonly Node[]) {
  return nodes.flatMap((item) => (item.kind === 'status' ? item.items : [])).slice(0, cap.statuses)
}

export function shown(nodes: readonly Node[]) {
  return nodes.filter((item) => item.kind !== 'status')
}

export function parse(source: string) {
  try {
    return read(JSON.parse(source))
  } catch {
    return []
  }
}
