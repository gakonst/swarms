import * as Turns from './Turns.ts'
import * as Repo from './Repo.ts'
import type { Hand, Live } from '../shared/Api.ts'
import { type Buffers, type Crew, type Thinking, appended, clip, crew, narrate, placed, redact, spoken, subagent, thought, tool } from '../shared/Trail.ts'
import * as Gateway from './Gateway.ts'
import * as Store from './Store.ts'
import * as Relay from './Relay.ts'
import * as Clock from './Clock.ts'
import * as Money from './Money.ts'
import type { Lead, Swarm, Turning } from './Swarm.ts'

function frame(block: string) {
  const lines = block.split('\n')
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')
  if (!data) return undefined
  return { data, live: lines.some((line) => /^event:\s*live$/.test(line)) }
}

function streamed(who: string | null, type: string | undefined, payload: Record<string, unknown>): Live[] {
  const text = typeof payload['text'] === 'string' ? redact(payload['text']) : ''
  const offset = typeof payload['offset'] === 'number' ? payload['offset'] : null
  if (type === 'assistant.delta') return [{ channel: 'text', delta: text, item: String(payload['item_id'] ?? ''), offset, type: 'delta', who }]
  if (type === 'reasoning.summary.delta') return [{ channel: 'thinking', delta: text, item: `reasoning:${String(payload['item_id'] ?? payload['model_call_index'] ?? '')}`, offset, type: 'delta', who }]
  if (type === 'tool.input.delta') return [{ channel: 'input', delta: text, item: String(payload['call_id'] ?? ''), offset, type: 'delta', who }]
  return []
}

function cues(payload: Record<string, unknown>): Cue[] {
  const said = `${tool(payload)} ${typeof payload['arguments'] === 'string' ? payload['arguments'] : JSON.stringify(payload['arguments'] ?? {})}`
  return [
    ...(/git_create|git_commit|git_remote|git push/.test(said) ? (['git'] as const) : []),
    ...(/kv_set|bucket_put/.test(said) && said.includes('artifacts/') ? (['artifacts'] as const) : []),
    ...(/compute_create|compute_hand|compute_terminate/.test(said) ? (['hands'] as const) : []),
  ]
}

export type Cue = 'artifacts' | 'credit' | 'git' | 'hands' | 'turn'

const streamFails = 2

const fallbackMs = 5 * 60_000

export const cueMs = 5_000

const spacingMs = 30_000

const lendingMs = 3_600_000

export async function follow(self: Swarm, row: Store.Row, run: Turning) {
  const agent = self.agent()
  if (!agent) return Turns.finish(self, row, run, { error: 'The agent is gone.', request_id: run.turn, status: 'failed' })

  let ended = false
  let down = false
  const window = self.fails < streamFails ? await listen(self, row, agent, run) : undefined
  if (window) {
    self.fails = 0
    ended = window.ended
  } else {
    if (self.fails < streamFails) self.fails += 1
    let cursor = agent.cursor
    for (let page = 0; page < 5; page++) {
      const read = await Gateway.events(self.env, row.id, agent.id, cursor)
      if (!read.ok) {
        down = read.status >= 500
        break
      }
      if (read.value.events.length) Turns.reached(self)
      for (const event of read.value.events) ended = digest(self, event, run.turn) || ended
      if (read.value.next_cursor !== cursor) self.kv.put('agent', { ...(self.agent() ?? agent), cursor: read.value.next_cursor })
      cursor = read.value.next_cursor
      if (!read.value.has_more) break
    }
  }

  const now = Date.now()
  if (!ended) stalled(self, now)
  if (!window && !ended && now - self.checked < Clock.refreshMs) return now + Clock.followMs

  self.checked = now
  const plan = window ? planned(self, now) : { ...Money.everything, artifacts: now - (self.kv.get<number>('shelvedAt') ?? 0) >= Clock.shelfMs, git: true, turn: true }
  const refreshing = plan.credit || plan.hands
  const reported = ended ? self.reported : undefined
  self.reported = undefined
  const [report] = await Promise.all([
    reported ? ({ ok: true, value: reported } as const) : ended || plan.turn ? Gateway.turn(self.env, row.id, agent.id, run.turn) : undefined,
    refreshing ? Money.refresh(self, row, plan) : undefined,
    plan.git ? Repo.watch(self, row) : undefined,
    plan.artifacts ? self.publish(row.id) : undefined,
  ])
  if (report?.ok && !['queued', 'running'].includes(report.value.status)) return Turns.finish(self, row, run, report.value)
  if (report && !report.ok && report.status !== 401 && report.status < 500)
    return Turns.finish(self, row, run, { error: report.detail, request_id: run.turn, status: 'failed' })
  if ((down || (report && !report.ok && report.status >= 500)) && Turns.unreachable(self, now)) {
    const detail = !report || report.ok ? 'its events did not load' : report.detail
    await Gateway.cancel(self.env, row.id, agent.id, run.turn).catch(() => undefined)
    Turns.abandon(self, agent.id, detail)
    return Turns.finish(self, row, run, { error: `The agent's session stopped answering: ${detail}`, request_id: run.turn, status: 'failed' })
  }
  return window ? Date.now() : now + Clock.followMs
}

export async function listen(self: Swarm, row: Store.Row, agent: Lead, run: Turning): Promise<{ ended: boolean } | undefined> {
  const stop = new AbortController()
  const opened = Date.now()
  let closing = Math.max(until(self, opened), opened + Clock.refreshMs)
  const timer = setTimeout(() => stop.abort(), closing - opened)
  self.window = { close: (at) => (closing = Math.min(closing, Math.max(at, opened + Clock.refreshMs))), stop }
  let ended = false
  let cursor = agent.cursor
  try {
    const response = await Gateway.stream(self.env, row.id, agent.id, cursor, stop.signal).catch(() => undefined)
    if (!response?.ok || !response.body) {
      await response?.body?.cancel().catch(() => undefined)
      return undefined
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = ''
    for (;;) {
      const read = await reader.read().catch(() => undefined)
      if (!read || read.done) {
        await reader.cancel().catch(() => undefined)
        if (stop.signal.aborted || ended) return { ended }
        return Date.now() - opened < Clock.refreshMs / 2 ? undefined : { ended }
      }
      buffer += read.value
      const blocks = buffer.split('\n\n')
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const found = frame(block)
        if (!found) continue
        const event = JSON.parse(found.data) as Gateway.Event
        if (found.live) {
          for (const delta of deltas(self, event, agent.id)) {
            if (delta.type === 'delta' && delta.channel === 'thinking') pondered(self, delta.who, delta.item, delta.offset, delta.delta)
            Relay.relay(self, delta)
          }
          continue
        }
        Turns.reached(self)
        ended = digest(self, event, run.turn) || ended
        cursor = Math.max(cursor, event.seq)
      }
      if (cursor !== (self.agent() ?? agent).cursor) self.kv.put('agent', { ...(self.agent() ?? agent), cursor })
      if (ended || Date.now() >= closing) stop.abort()
    }
  } finally {
    clearTimeout(timer)
    if (self.window?.stop === stop) self.window = undefined
  }
}

export function deltas(self: Swarm, event: Gateway.Event, agent: string): Live[] {
  const outer = event.event
  if (!outer || outer.source === undefined) return []
  if (outer.source === 'subagent') {
    const update = outer.update as { event?: { payload?: Record<string, unknown>; type?: string }; id?: unknown; type?: string } | undefined
    if (update?.type !== 'event') return []
    const who = crewed(self).names[`${outer.root_session_id ?? agent}:${String(update.id)}`] ?? `subagent ${String(update.id)}`
    return streamed(who, update.event?.type, update.event?.payload ?? {})
  }
  return streamed(null, outer.event?.type, outer.event?.payload ?? {})
}

export function due(self: Swarm, cue: Cue, every: number, now: number) {
  const last = self.polled.get(cue) ?? 0
  const cued = self.cues.get(cue)
  const hit = (cued !== undefined && cued > last && now - cued >= cueMs && now - last >= spacingMs) || now - last >= every
  if (hit) self.polled.set(cue, now)
  return hit
}

export function cued(self: Swarm, cue: Cue, since: number) {
  return (self.cues.get(cue) ?? 0) > since || self.born > since
}

function every(self: Swarm, now: number): Record<Cue, number> {
  const lent = (self.kv.get<Hand[]>('hands') ?? []).length > 0 || now - (self.kv.get<number>('issued') ?? 0) < lendingMs
  return {
    artifacts: fallbackMs,
    credit: self.listened() ? Clock.minuteMs : fallbackMs,
    git: fallbackMs,
    hands: lent ? Clock.minuteMs : fallbackMs,
    turn: fallbackMs,
  }
}

export function handsDue(self: Swarm, now: number) {
  return due(self, 'hands', every(self, now).hands, now)
}

export function planned(self: Swarm, now: number) {
  const intervals = every(self, now)
  return {
    artifacts: due(self, 'artifacts', intervals.artifacts, now),
    credit: due(self, 'credit', intervals.credit, now),
    git: due(self, 'git', intervals.git, now),
    hands: due(self, 'hands', intervals.hands, now),
    turn: due(self, 'turn', intervals.turn, now),
  }
}

export function until(self: Swarm, now: number) {
  let next = now + fallbackMs
  for (const [cue, interval] of Object.entries(every(self, now)) as [Cue, number][]) {
    const last = self.polled.get(cue) ?? 0
    const at = self.cues.get(cue)
    next = Math.min(next, last + interval, at !== undefined && at > last ? Math.max(at + cueMs, last + spacingMs) : Infinity)
  }
  return next
}

export function digest(self: Swarm, event: Gateway.Event, turn: string) {
  const outer = event.event
  if (!outer) return false
  if (outer.source === undefined) {
    if (outer.type !== 'result' || event.request_id !== turn) return false
    const result = outer as Record<string, unknown>
    if (typeof result['status'] === 'string') self.reported = { ...result, request_id: turn, status: result['status'] } as Gateway.Report
    Relay.ended(self)
    return true
  }

  const at = event.created_at ?? Date.now()
  if (outer.source === 'subagent' && outer.update) {
    const known = crewed(self)
    const found = subagent(buffers(self), known, outer.root_session_id ?? self.agent()?.id ?? 'session', outer.update)
    if (!found) return false
    const update = outer.update as { event?: { payload?: Record<string, unknown>; type?: string }; type?: string }
    if (update.type !== 'event') self.kv.put('crew', known)
    if (update.type === 'added' || update.type === 'status' || update.type === 'completion') {
      self.branched = Date.now()
      self.changed('branches')
    }
    if (update.type === 'event') {
      advanced(self, update.event?.type, at)
      if (update.event?.type === 'tool.call') for (const found of cues(update.event.payload ?? {})) self.cue(found)
      for (const delta of streamed(found.who, update.event?.type, update.event?.payload ?? {})) Relay.relay(self, delta)
    }
    for (const step of found.steps) self.log(step.kind, step.text, step.detail, { at, event: event.seq, ms: step.ms, who: found.who })
    return false
  }

  const inner = outer.event
  advanced(self, inner?.type, at)
  if (inner?.type === 'tool.call') for (const found of cues(inner.payload ?? {})) self.cue(found)
  for (const delta of streamed(null, inner?.type, inner?.payload ?? {})) Relay.relay(self, delta)
  record(self, null, inner?.type, inner?.payload ?? {}, event.seq, at)
  return false
}

const progress = new Set(['assistant.message', 'model.call.completed', 'run.completed', 'tool.result'])

export function advanced(self: Swarm, type: string | undefined, at: number) {
  if (type === undefined || !progress.has(type)) return
  if (at > (self.kv.get<number>('progressed') ?? 0)) self.kv.put('progressed', at)
}

export function stalled(self: Swarm, now: number) {
  const working = self.working()
  if (!working?.stalled || working.progressed === undefined) return
  if (self.kv.get<number>('stallNoted') === working.progressed) return
  self.kv.put('stallNoted', working.progressed)
  const minutes = Math.round((now - working.progressed) / 60_000)
  self.log('error', `The agent has made no model call or tool call for ${minutes} minutes. Its session may be restarting without getting anywhere; the swarm keeps waiting for it.`, null)
}

export function record(self: Swarm, who: string | null, type: string | undefined, payload: Record<string, unknown>, event: number, at: number) {
  for (const found of narrate(buffers(self), who, type, payload)) self.log(found.kind, found.text, found.detail, { at, event, ms: found.ms, who })
}

function pondering(who: string | null) {
  return who === null ? 'thinking' : `thinking:${who}`
}

export function buffers(self: Swarm): Buffers {
  return {
    add: (who, text) => {
      const held = spoken(self.kv.get<Thinking | string>(pondering(who)))
      const next = appended(held, text)
      if (next !== held) self.kv.put(pondering(who), next)
    },
    take: (who) => {
      const text = spoken(self.kv.get<Thinking | string>(pondering(who)))
      self.kv.delete(pondering(who))
      return text
    },
  }
}

export function pondered(self: Swarm, who: string | null, item: string, offset: number | null, text: string) {
  const held = self.kv.get<Thinking | string>(pondering(who))
  const next = placed(held, item, offset, text)
  if (next !== held) self.kv.put(pondering(who), next)
}

export function flush(self: Swarm) {
  const speakers = [null, ...[...self.kv.list({ prefix: 'thinking:' })].map(([name]) => name.slice('thinking:'.length))]
  for (const who of speakers) {
    const thinking = buffers(self).take(who).trim()
    if (thinking) self.log('thinking', clip(thinking, thought), null, { who })
  }
}

export function crewed(self: Swarm): Crew {
  return self.kv.get<Crew>('crew') ?? crew()
}
