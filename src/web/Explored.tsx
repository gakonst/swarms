import { useState } from 'react'
import type { Branch } from '../shared/Api.ts'
import { Markdown } from './Markdown.tsx'

type Look = 'exploring' | 'found' | 'dead' | 'stopped'

type Metric = { key: string; value: number }

type Attempt = Branch & { children: Attempt[]; label: string; look: Look; metric: Metric | undefined; said: string; fields: [string, string][] | undefined }

const words: Record<Look, string> = { dead: "Didn't finish", exploring: 'Exploring', found: 'Done', stopped: 'Stopped' }

function look(branch: Branch): Look {
  if (branch.state === 'pending' || branch.state === 'running') return 'exploring'
  if (branch.result && branch.state !== 'failed') return 'found'
  if (branch.state === 'failed' || branch.error) return 'dead'
  return 'stopped'
}

function human(text: string) {
  const plain = text.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
  return plain ? plain.charAt(0).toUpperCase() + plain.slice(1) : ''
}

function role(text: string) {
  return text.replace(/^\s*(?:auto\s*research|research)?\s*branch\s*:\s*/i, '').trim()
}

function family(text: string) {
  const first = role(text).split(/[\s(:/]/)[0] ?? ''
  return first.toLowerCase().replace(/\d+$/, '') || text
}

function label(text: string, first: boolean) {
  const bare = role(text)
  const inside = /\(([^)]{3,})\)\s*$/.exec(bare)?.[1] ?? /:\s*(.{3,})$/.exec(bare)?.[1]
  if (inside) return human(inside)
  return first ? 'First try' : human(bare) || 'A direction'
}

function clip(text: string, most: number) {
  return text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text
}

function tidy(text: string) {
  return text
    .replace(/\b(?:best |retained |verified )?commit [0-9a-f]{7,40}\b[.:,;]?\s*/gi, '')
    .replace(/\s*\(?\/w\/[\w./-]+\)?/g, '')
    .replace(/^\s*[.:,;-]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parsed(text: string | null): Record<string, unknown> | undefined {
  if (!text) return undefined
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return undefined
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function measure(fields: Record<string, unknown> | undefined, text: string | null): Metric | undefined {
  if (fields) {
    const keys = Object.keys(fields).filter((key) => typeof fields[key] === 'number' && Number.isFinite(fields[key]))
    const key = keys.find((name) => /best/i.test(name)) ?? keys.find((name) => /speedup|score|accuracy|rate|loss|bpb/i.test(name))
    if (key) return { key, value: fields[key] as number }
  }
  const times = text ? /(\d+(?:\.\d+)?)\s*[x×]\s*(?:faster|speedup)/i.exec(text) : null
  return times ? { key: 'speedup', value: Number(times[1]) } : undefined
}

function shown(metric: Metric) {
  if (/speedup|faster/i.test(metric.key)) return `${metric.value.toFixed(metric.value >= 10 ? 1 : 2)}× faster`
  const name = human(metric.key.replace(/^best[ _-]?/i, ''))
  const value = Math.abs(metric.value) >= 100 ? metric.value.toFixed(0) : String(Number(metric.value.toPrecision(4)))
  return name ? `${name} ${value}` : value
}

function summary(fields: Record<string, unknown> | undefined) {
  if (!fields) return undefined
  const key = Object.keys(fields).find((name) => /summary|finding|found|conclusion|outcome|headline|answer|result/i.test(name) && typeof fields[name] === 'string')
  return key ? String(fields[key]) : undefined
}

function listed(fields: Record<string, unknown>): [string, string][] {
  return Object.entries(fields)
    .filter(([key, value]) => !/dir$|path$|commit/i.test(key) && value !== null && value !== '')
    .map(([key, value]): [string, string] => [
      human(key),
      typeof value === 'string' ? tidy(value) : typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ') : Object.entries(value as Record<string, unknown>).map(([name, item]) => `${name} ${typeof item === 'number' ? item : JSON.stringify(item)}`).join(' · '),
    ])
    .slice(0, 8)
}

function attempt(branch: Branch, first: boolean): Attempt {
  const state = look(branch)
  const fields = parsed(branch.result)
  const metric = state === 'found' ? measure(fields, branch.result) : undefined
  const found = summary(fields) ?? (fields ? '' : branch.result ?? '')
  const said = state === 'found' ? clip(tidy(found), 180) : state === 'dead' ? '' : clip(tidy(branch.task.replace(/^\s*CONTEXT\.[\s\S]*?\n\n/, '')), 160)
  return { ...branch, children: [], fields: fields ? listed(fields) : undefined, label: label(branch.role, first), look: state, metric, said }
}

function grow(branches: readonly Branch[]) {
  const seen = new Set<string>()
  const nodes = new Map<number, Attempt>([...branches].sort((a, b) => a.id - b.id).map((branch) => {
    const kind = family(branch.role)
    const first = !seen.has(kind)
    seen.add(kind)
    return [branch.id, attempt(branch, first)]
  }))
  const roots: Attempt[] = []
  for (const node of [...nodes.values()].sort((a, b) => a.id - b.id)) {
    const parent = node.parent === null ? undefined : nodes.get(node.parent)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const families = new Map<string, Attempt[]>()
  for (const node of roots) families.set(family(node.role), [...(families.get(family(node.role)) ?? []), node])
  return [...families.entries()].map(([key, attempts]) => ({ attempts, key, name: human(key) }))
}

function Step(props: { best: number | undefined; node: Attempt }) {
  const node = props.node
  const [open, setOpen] = useState(false)
  const more = node.look === 'found' && (!!node.fields?.length || (!!node.result && !node.fields))
  return (
    <li className="step" data-look={node.look}>
      <button aria-expanded={more ? open : undefined} className="step-row" disabled={!more} onClick={() => setOpen(!open)} type="button">
        <i aria-hidden="true" className="step-dot" />
        <span className="step-text">
          <b>{node.label}</b>
          {node.said && <span>{node.said}</span>}
        </span>
        <span className="step-end">
          {node.metric ? <span className="step-metric" data-best={props.best !== undefined && node.metric.value === props.best}>{shown(node.metric)}</span> : <span className="step-state">{words[node.look]}</span>}
        </span>
      </button>
      {open && (node.fields ? (
        <dl className="step-more">{node.fields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      ) : (
        <div className="step-more"><Markdown text={node.result ?? ''} /></div>
      ))}
      {node.children.length > 0 && <ol className="steps-sub">{node.children.map((child) => <Step best={props.best} key={child.id} node={child} />)}</ol>}
    </li>
  )
}

export function Explored(props: { branches: readonly Branch[] | undefined; running: boolean; title: string }) {
  if (!props.branches) return <div className="explored explored-wait" aria-busy="true" />
  const branches = props.branches
  const families = grow(branches)
  const all = families.flatMap((group) => group.attempts)
  const exploring = branches.filter((branch) => look(branch) === 'exploring').length
  const metrics = all.flatMap((node) => (node.metric ? [node.metric] : []))
  const key = metrics[0]?.key
  const same = metrics.length > 1 && metrics.every((metric) => metric.key === key)
  const lower = !!key && /loss|bpb|latency|time|error/i.test(key)
  const best = same ? (lower ? Math.min(...metrics.map((metric) => metric.value)) : Math.max(...metrics.map((metric) => metric.value))) : undefined
  const leader = best === undefined ? undefined : all.find((node) => node.metric?.value === best)
  return (
    <div className="explored">
      <div className="explored-root" data-live={props.running}>
        <i aria-hidden="true" />
        <span>
          <b>{branches.length ? `${all.length} direction${all.length === 1 ? '' : 's'} tried${exploring ? `, ${exploring} still going` : ''}` : props.running ? 'The AI is working on it directly' : 'No directions tried yet'}</b>
          {leader?.metric && <small>Best so far: {shown(leader.metric)}, from {leader.label.charAt(0).toLowerCase() + leader.label.slice(1)}</small>}
        </span>
      </div>
      {families.length > 0 && (
        <ol className="lines">
          {families.map((group) => (
            <li className="line" data-many={group.attempts.length > 1} key={group.key}>
              {group.attempts.length > 1 && (
                <p className="line-head">
                  <b>{group.name}</b>
                  <span>{group.attempts.length} attempts</span>
                </p>
              )}
              <ol className="line-steps">{group.attempts.map((node) => <Step best={best} key={node.id} node={node} />)}</ol>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
