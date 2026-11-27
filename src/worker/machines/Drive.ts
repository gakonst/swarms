import { z } from 'zod'
import { plans, type Plan } from '../../shared/Api.ts'
import * as Assert from '../../shared/Assert.ts'
import type { Halt, Item, Origin, Source } from '../../shared/Drive.ts'
import * as Setup from '../../shared/Setup.ts'
import { clip } from '../../shared/Trail.ts'
import * as Limits from '../../shared/Limits.ts'

export const version = 1

export type Stored = {
  cap: number | null
  counted: number
  halt: Halt | null
  limits: number
  misses: number
  plan: Plan | null
  planned: number
  rev: number
  root: number
  settled: number
  source: Source | null
  turns: number
  v: number
}

export type Fields = Omit<Stored, 'rev' | 'v'>

export type Counts = { flying: number; open: number }

export type Lifecycle =
  | { state: 'unboarded' }
  | { board: Stored; state: 'planning' }
  | { board: Stored; counts: Counts; state: 'driving' }
  | { board: Stored; halt: Halt; state: 'paused' }

export type Kind = Lifecycle['state']

export const next: Record<Kind, readonly Kind[]> = {
  driving: ['driving', 'planning', 'paused'],
  paused: ['paused', 'planning', 'driving'],
  planning: ['planning', 'driving', 'paused'],
  unboarded: ['planning', 'driving'],
}

export const guards = { dedupe: true, fence: true, flight: true, hourly: true, legal: true, planOnly: true, priority: true, reset: true, stuck: true }

export class Refused extends Error {
  readonly kind: 'Illegal' | 'Stale'
  constructor(kind: 'Illegal' | 'Stale', detail: string) {
    super(kind + ': ' + detail)
    this.kind = kind
  }
}

const plan = z.enum(plans)

const halt = z.discriminatedUnion('why', [
  z.object({ from: z.enum(['backoff', 'reset', 'retry-after']), plan, tries: z.number().int(), until: z.number(), why: z.literal('limited') }).loose(),
  z.object({ plan, why: z.literal('revoked') }).loose(),
  z.object({ why: z.literal('met') }).loose(),
  z.object({ cap: z.number().int(), turns: z.number().int(), why: z.literal('capped') }).loose(),
  z.object({ misses: z.number().int(), question: z.string(), why: z.literal('stuck') }).loose(),
])

export const haltSchema = halt

const stored = z
  .object({
    cap: z.number().int().nullable(),
    counted: z.number().int(),
    halt: halt.nullable(),
    limits: z.number().int(),
    misses: z.number().int(),
    plan: plan.nullable(),
    planned: z.number().int(),
    rev: z.number().int(),
    root: z.number().int(),
    settled: z.number().int(),
    source: z.enum(['plan', 'credit']).nullable(),
    turns: z.number().int(),
    v: z.number().int(),
  })
  .loose()

export type Store = { get(): unknown; put(board: Stored): void }

export function parse(raw: unknown): Stored | undefined {
  if (raw === undefined) return undefined
  const parsed = stored.safeParse(raw)
  if (!parsed.success) return Assert.fail('A stored Board does not parse.', parsed.error.issues)
  return parsed.data as Stored
}

export function derive(board: Stored | undefined, counts: Counts): Lifecycle {
  if (!board) return { state: 'unboarded' }
  if (board.halt) return { board, halt: board.halt, state: 'paused' }
  if (counts.open + counts.flying > 0) return { board, counts, state: 'driving' }
  return { board, state: 'planning' }
}

export function read(store: Store, counts: Counts): Lifecycle {
  return derive(parse(store.get()), counts)
}

export function rev(found: Lifecycle) {
  return found.state === 'unboarded' ? 0 : found.board.rev
}

export const flying = 'in-flight items stay within Drive.inFlightMost'

export function write(store: Store, before: Counts, fields: Fields, after: Counts, expect: number): Stored {
  const now = read(store, before)
  if (guards.fence && rev(now) !== expect) throw new Refused('Stale', 'rev ' + rev(now) + ', expected ' + expect)
  const board: Stored = { ...fields, rev: rev(now) + 1, v: version }
  const to = derive(board, after)
  if (guards.legal && !next[now.state].includes(to.state)) throw new Refused('Illegal', now.state + ' -> ' + to.state)
  if (now.state !== 'unboarded') Assert.assert(board.root === now.board.root, 'A swarm keeps one Board thread.', { from: now.board.root, to: board.root })
  Assert.assert(after.flying <= Limits.Drive.inFlightMost, flying, after)
  Assert.assert(board.cap === null || (board.cap >= 0 && board.cap <= Limits.Drive.capMost), 'A turn cap is bounded.', board.cap)
  store.put(board)
  return board
}

export function fields(board: Stored): Fields {
  const { rev: _rev, v: _v, ...rest } = board
  return rest
}

export function fresh(root: number): Fields {
  return { cap: null, counted: 0, halt: null, limits: 0, misses: 0, plan: null, planned: 0, root, settled: 0, source: null, turns: 0 }
}

export function key(title: string) {
  const words = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= Limits.Drive.keyWordLeast || /^\d+$/.test(word))
  const kept = [...new Set(words)].sort().slice(0, Limits.Drive.keyWordsMost)
  return kept.length ? kept.join(' ') : title.trim().toLowerCase()
}

export function title(text: string) {
  const line = text
    .split('\n')
    .map((one) => one.trim())
    .find((one) => one.length > 0)
  return clip((line ?? '').replace(/^([-*+]|\d+[.)])\s+/, '').replace(/^\[[ x]\]\s*/i, ''), Limits.Drive.titleChars)
}

function rank(source: Origin) {
  return source === 'human' ? 0 : 1
}

export function pick(items: readonly Pick<Item, 'id' | 'source' | 'state'>[]): number[] {
  const busy = items.filter((item) => item.state === 'flying').length
  const room = Limits.Drive.inFlightMost - busy
  const open = items.filter((item) => item.state === 'open').sort((a, b) => (guards.priority ? rank(a.source) - rank(b.source) : 0) || a.id - b.id)
  return open.slice(0, guards.flight ? Math.max(0, room) : open.length).map((item) => item.id)
}

export function room(made: readonly number[], now: number) {
  if (!guards.hourly) return Limits.Drive.batchMost
  const recent = made.filter((at) => at > now - Limits.Drive.hourMs).length
  return Math.max(0, Math.min(Limits.Drive.batchMost, Limits.Drive.generatedPerHour - recent))
}

export function proposals(text: string): string[] {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => /^[^\w\n]*next items?[^\w\n]*$/i.test(line.trim()))
  if (at < 0) return []
  const found: string[] = []
  for (const line of lines.slice(at + 1)) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (found.length) break
      continue
    }
    if (!/^([-*+]|\d+[.)])\s+/.test(trimmed)) break
    const named = title(trimmed)
    if (named) found.push(named)
  }
  return found
}

export function unseen(proposed: readonly string[], known: ReadonlySet<string>): string[] {
  const seen = new Set(known)
  const out: string[] = []
  for (const one of proposed) {
    const made = key(one)
    if (guards.dedupe && seen.has(made)) continue
    seen.add(made)
    out.push(one)
  }
  return out
}

export type Said = { done: boolean; why: string }

export function outcomes(text: string): Map<number, Said> {
  const out = new Map<number, Said>()
  for (const found of text.matchAll(/^[^\w\n]*(?<kind>done|dead end)[^\w\n]*#(?<id>\d+)\b[ \t:.,-]*(?<why>.*)$/gim)) {
    const id = Number(found.groups?.['id'])
    if (!out.has(id))
      out.set(id, { done: (found.groups?.['kind'] ?? '').toLowerCase() === 'done', why: clip((found.groups?.['why'] ?? '').trim(), Limits.Drive.whyChars) })
  }
  return out
}

export function met(text: string) {
  return /^[^\w\n]*goal met[^\w\n]*$/im.test(text)
}

export function limited(message: string | null) {
  return !!message && /\bHTTP 429\b|\b429 Too Many Requests\b|rate[_ -]?limit|usage limit|too many requests/i.test(message)
}

export function revoked(message: string | null) {
  return (
    !!message &&
    (/\b(Messages|Responses|Chat Completions|Chat)\b[^:]*\bHTTP 40[13]\b/.test(message) ||
      /signed[ -]out|not signed in|token (expired|revoked)|invalid_grant|plan (was )?revoked|reconnect|only on an Antigravity plan/i.test(message))
  )
}

export function backoff(tries: number) {
  return Math.min(Limits.Drive.limitFirstMs * 2 ** Math.max(0, tries - 1), Limits.Drive.limitMostMs)
}

function epoch(value: number) {
  return value < Limits.Drive.resetSecondsBelow ? value * 1000 : value
}

export function reset(message: string, now: number): { at: number; from: 'reset' | 'retry-after' } | undefined {
  if (!guards.reset) return undefined
  const after = /retry[-_ ]after\W{0,4}(\d+(?:\.\d+)?)/i.exec(message)
  if (after?.[1]) return { at: now + Math.ceil(Number(after[1]) * 1000), from: 'retry-after' }
  const stamp = /reset(?:s|_at|s_at|s at| at)?\W{0,4}(\d{9,13})\b/i.exec(message)
  if (stamp?.[1]) return { at: epoch(Number(stamp[1])), from: 'reset' }
  const iso = /reset(?:s|_at|s_at|s at| at)?\W{0,4}(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2}))/i.exec(message)
  if (iso?.[1] && Number.isFinite(Date.parse(iso[1]))) return { at: Date.parse(iso[1]), from: 'reset' }
  return undefined
}

export function limit(message: string, now: number, tries: number, plan: Plan): Halt {
  const named = reset(message, now)
  const at = named ? named.at : now + backoff(tries)
  const until = Math.max(now, Math.min(at, now + Limits.Drive.limitMostMs))
  return { from: named ? named.from : 'backoff', plan, tries, until, why: 'limited' }
}

export function serves(harness: Setup.Harness, signed: ReadonlySet<Plan>): Plan | null {
  const plan = Setup.planOf(harness)
  return signed.has(plan) ? plan : null
}

export function credited(plan: Plan) {
  return !guards.planOnly || Setup.metered.some((harness) => Setup.planOf(harness) === plan)
}

export type Plans = { known: boolean; signed: ReadonlySet<Plan> }

export type Choice = { plan: Plan; source: 'plan' } | { lost: Plan | null; source: 'credit' } | { halt: Halt }

export function choose(input: { funded: boolean; harness: Setup.Harness; hosted: boolean; last: Source | null; plans: Plans | undefined }): Choice {
  const plan = Setup.planOf(input.harness)
  if (!credited(plan)) {
    if (input.plans?.known && serves(input.harness, input.plans.signed)) return { plan, source: 'plan' }
    if (input.plans && !input.plans.known && input.last === 'plan' && !input.hosted) return { plan, source: 'plan' }
    return { halt: { plan, why: 'revoked' } }
  }
  if (input.hosted || !input.plans) return { lost: null, source: 'credit' }
  if (!input.plans.known) return input.last === 'plan' ? { plan, source: 'plan' } : { lost: null, source: 'credit' }
  if (serves(input.harness, input.plans.signed)) return { plan, source: 'plan' }
  if (input.last !== 'plan') return { lost: null, source: 'credit' }
  return input.funded ? { lost: plan, source: 'credit' } : { halt: { plan, why: 'revoked' } }
}

export function due(found: Halt, now: number): number | null {
  if (found.why === 'limited') return found.until > now ? found.until : now
  if (found.why === 'revoked') return now + Limits.Drive.revokedReadMs
  return null
}

export function resumes(found: Halt, input: { funded: boolean; now: number; plans: Plans | undefined }): 'reset' | 'plan' | 'credit' | null {
  if (found.why === 'limited') return input.now >= found.until ? 'reset' : null
  if (found.why !== 'revoked') return null
  if (input.plans?.known && input.plans.signed.has(found.plan)) return 'plan'
  return input.funded && credited(found.plan) ? 'credit' : null
}

export function wakes(found: Halt, reason: 'money' | 'note') {
  if (reason === 'note') return found.why === 'stuck' || found.why === 'met'
  return false
}

export function question(misses: readonly Pick<Item, 'id' | 'title' | 'why'>[], creator: string | null) {
  const listed = misses.slice(-Limits.Drive.missesShown).map((item) => '- #' + item.id + ' ' + item.title + (item.why ? ': ' + item.why : ''))
  return [
    "Stuck, here's why: the last " + misses.length + ' items ended without progress.',
    ...listed,
    (creator ? creator + ', ' : '') +
      'one question: what should the swarm try instead? Reply in this thread: your reply goes to the top of the board and the swarm starts again.',
  ].join('\n')
}

export function dispatched(items: readonly Pick<Item, 'id' | 'source' | 'title'>[]) {
  return [
    "Board items for this turn, from the swarm's Board thread (riders' items first):",
    ...items.map((item) => '#' + item.id + (item.source === 'human' ? ' (from a rider)' : '') + ' ' + item.title),
    'Work on them in order. End your update with one line per item: "Done: #id" when it is finished, or "Dead end: #id why" when it cannot work. Write "Goal met" on its own line only when the goal is reached and nothing is left.',
  ].join('\n')
}

export function planning(count: number, results: readonly Pick<Item, 'id' | 'title' | 'why'>[], ends: readonly Pick<Item, 'id' | 'title' | 'why'>[]) {
  return [
    "The swarm's Board has no open item. Plan the next steps toward the goal from what the swarm found, its dead ends and its open branches, and start on the first.",
    results.length ? 'Results so far:\n' + results.map((item) => '- #' + item.id + ' ' + item.title).join('\n') : '',
    ends.length
      ? 'Dead ends, do not repeat them:\n' + ends.map((item) => '- #' + item.id + ' ' + item.title + (item.why ? ': ' + item.why : '')).join('\n')
      : '',
    'End your update with a "Next items:" line and up to ' +
      count +
      ' lines under it, each "- " and one concrete step a turn can finish. Write "Goal met" on its own line only when the goal is reached and nothing is left.',
  ]
    .filter(Boolean)
    .join('\n\n')
}
