import type { Researcher } from './Api.ts'

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function identifier(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

function text(value: unknown, length: number) {
  return (typeof value === 'string' ? value : JSON.stringify(value) ?? '').slice(0, length)
}

const states = new Set<Researcher['state']>(['pending', 'running', 'completed', 'failed', 'interrupted', 'closing', 'closed'])

export function researchId(update: unknown, scope: string) {
  const row = object(update)
  const id = identifier(row?.['type'] === 'added' ? object(row['agent'])?.['id'] : row?.['id'])
  return id === undefined ? undefined : `${scope}:${id}`
}

export function advance(previous: Researcher | undefined, update: unknown, context: { scope: string; round: number; at: number; sequence: number }): Researcher | undefined {
  const row = object(update)
  const id = researchId(update, context.scope)
  if (!row || !id || (previous && context.sequence <= previous.lastSequence)) return previous
  const agent = object(row['agent'])
  const next: Researcher = previous ? { ...previous } : {
    id, parent: null, round: context.round, name: `Researcher ${identifier(agent?.['id'] ?? row['id'])}`, task: '', state: 'pending', action: null, output: null, updatedAt: context.at, events: 0, toolsCompleted: 0, lastSequence: 0,
  }
  if (row['type'] === 'added' && agent) {
    next.name = text(agent['role'] ?? next.name, 80)
    next.task = text(agent['task'] ?? '', 2000)
    const parent = identifier(agent['parent'])
    next.parent = parent === undefined ? null : `${context.scope}:${parent}`
    next.action = 'Joining the expedition'
  } else if (row['type'] === 'status' || row['type'] === 'completion') {
    const status = object(row['status'])
    const state = status?.['state']
    if (typeof state !== 'string' || !states.has(state as Researcher['state'])) return previous
    next.state = state as Researcher['state']
    if (state === 'completed') { next.output = text(status?.['output'] ?? '', 4000) || next.output; next.action = 'Result delivered' }
    if (state === 'failed') next.action = text(status?.['error'] ?? 'Research stopped with an error', 180)
    if (state === 'interrupted' || state === 'closed' || state === 'closing') next.action = 'Research stopped'
  } else if (row['type'] === 'event') {
    const event = object(row['event'])
    const payload = object(event?.['payload'])
    const kind = event?.['type']
    if (typeof kind !== 'string' || !['run.started', 'model.call.started', 'assistant.message', 'tool.call', 'tool.result', 'run.failed', 'run.completed'].includes(kind)) return previous
    if (kind === 'run.started') { next.state = 'running'; next.round = Math.max(next.round, context.round); next.action = 'Starting the next step' }
    if (kind === 'model.call.started') next.action = 'Thinking through the problem'
    if (kind === 'assistant.message') next.action = text(payload?.['text'] ?? 'Sharing an update', 180)
    if (kind === 'tool.call') {
      next.state = 'running'
      const tool = text(payload?.['tool'] ?? 'tool', 80).replace(/^mcp__gateway__/, '')
      next.action = `Using ${tool}`
    }
    if (kind === 'tool.result' && payload?.['status'] === 'completed') next.toolsCompleted++
    if (kind === 'run.failed') { next.state = 'failed'; next.action = 'The run failed' }
    if (kind === 'run.completed') next.action = 'Run finished; awaiting task status'
  } else return previous
  next.updatedAt = context.at
  next.events++
  next.lastSequence = context.sequence
  return next
}
