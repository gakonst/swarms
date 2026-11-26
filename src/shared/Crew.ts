import type { Branch } from './Api.ts'
import * as Prose from './Prose.ts'
import * as Limits from './Limits.ts'

export type State = 'working' | 'done' | 'failed' | 'stopped' | 'starved'

export type Member = { blockers: string | null; id: number; metric: string | null; spent: number; state: State; summary: string | null; title: string; told: string | null }

const words = ['summary', 'result', 'outcome', 'finding', 'findings', 'conclusion', 'answer', 'status', 'notes'] as const

function clean(text: string) {
  return Prose.line(text)
}

function record(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parsed(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  if (!trimmed.startsWith('{')) return null
  try {
    return record(JSON.parse(trimmed))
  } catch {
    return null
  }
}

function sentence(text: string) {
  const parts = Prose.sentences(clean(text))
  const ledger = (part: string) => /\bcommit [0-9a-f]{7,40}\b/i.test(Prose.plain(part)) || /(^|\s)\/\w[\w.-]*\//.test(Prose.plain(part))
  return parts.find((part) => !ledger(part)) ?? parts[0] ?? null
}

function number(value: number) {
  return Math.abs(value) >= Limits.SharedCrew.wholeFrom ? value.toFixed(0) : Math.abs(value) >= Limits.SharedCrew.tenthsFrom ? value.toFixed(1) : value.toFixed(2)
}

function metric(fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const name = key.toLowerCase()
    if (/speed_?up/.test(name)) return `${number(value)}×`
    if (/^best_/.test(name)) return `${name.slice('best_'.length).replace(/_/g, ' ')} ${number(value)}`
  }
  return null
}

export function title(branch: Pick<Branch, 'role' | 'who'>) {
  const name = (branch.role || branch.who).trim().replace(/^(auto)?research branch:\s*/i, '').replace(/^branch:\s*/i, '')
  return name || branch.who
}

function stated(branch: Branch): State {
  if (branch.state === 'pending' || branch.state === 'running') return 'working'
  if (branch.starved) return 'starved'
  if (branch.state === 'completed') return 'done'
  if (branch.state === 'failed') return 'failed'
  return 'stopped'
}

function told(text: string | null) {
  const line = (text ?? '').split('\n').map(clean).find(Boolean)
  return line ? line.replace(/^subagent \d+ /i, '').replace(/^[A-Z][A-Z ]{2,}[.:]\s*/, '') || null : null
}

export function member(branch: Branch): Member {
  const state = stated(branch)
  const result = branch.result?.trim() ?? ''
  const fields = result ? parsed(result) : null
  const said = fields ? words.map((word) => fields[word]).find((value): value is string => typeof value === 'string' && !!value.trim()) : undefined
  const blockers = fields && typeof fields['blockers'] === 'string' ? clean(fields['blockers']) || null : null
  const summary = said ? sentence(said) : fields ? null : result ? told(result) : state === 'failed' && branch.error ? told(branch.error) : state === 'working' ? told(branch.task) : null
  return {
    blockers,
    id: branch.id,
    metric: fields ? metric(fields) : null,
    spent: Number(branch.spent ?? 0) || 0,
    state,
    summary,
    title: title(branch),
    told: said ? clean(said) : fields ? null : result ? clean(result) : branch.error ? clean(branch.error.split('\n\n')[0] ?? '') : null,
  }
}

export function board(branches: readonly Branch[]) {
  return branches
    .filter((branch) => branch.parent === null)
    .map(member)
    .sort((a, b) => Number(b.state === 'working') - Number(a.state === 'working') || b.spent - a.spent || b.id - a.id)
}
