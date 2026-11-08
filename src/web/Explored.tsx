import { useState } from 'react'
import type { Branch } from '../shared/Api.ts'
import type * as Progress from '../shared/Progress.ts'

function clip(text: string, most: number) {
  return text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text
}

function tidy(text: string) {
  return text
    .replace(/\b(?:best |retained |verified )?commit [0-9a-f]{7,40}\b[.:,;]?\s*/gi, '')
    .replace(/\s*\(?\/w\/[\w./-]+\)?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sentence(text: string) {
  const plain = tidy(text)
  return plain ? plain.charAt(0).toUpperCase() + plain.slice(1) : ''
}

function amount(value: number, metric: string) {
  if (/speed ?up|faster|times/i.test(metric)) return `${value.toFixed(2)}×`
  return String(Number(value.toPrecision(4)))
}

function change(value: number, before: number, better: Progress.Progress['better']) {
  const gain = better === 'lower' ? before / value - 1 : value / before - 1
  if (!Number.isFinite(gain) || Math.abs(gain) < 0.0005) return undefined
  return `${gain > 0 ? '+' : '−'}${Math.abs(gain * 100).toFixed(gain > 0.1 || gain < -0.1 ? 0 : 1)}%`
}

type Row =
  | { kind: 'merge'; branch: Progress.Line | undefined; key: string; name: string; step: Progress.Step; was: number | undefined }
  | { kind: 'main'; key: string; step: Progress.Step; was: number | undefined }
  | { kind: 'start'; key: string; step: Progress.Step }
  | { kind: 'tried'; branch: Progress.Line; key: string }
  | { kind: 'live'; branch: Progress.Line; key: string }
  | { count: number; kind: 'tweaks'; key: string }

function rows(progress: Progress.Progress): Row[] {
  const kept = progress.main.filter((step) => step.kept && step.value !== null)
  const where = (name: string) => kept.findIndex((step) => step.merged === name)
  const tried = new Map<number, Progress.Line[]>()
  const live: Progress.Line[] = []
  let at = 0
  for (const branch of progress.branches) {
    const merged = where(branch.name)
    if (merged >= 0) {
      at = Math.max(at, merged)
      continue
    }
    if (branch.state === 'exploring' || branch.state === 'promising') live.push(branch)
    else if (!branch.merged) tried.set(at, [...(tried.get(at) ?? []), branch])
  }
  const tweaks = new Map<number, number>()
  let index = -1
  for (const step of progress.main) {
    if (step.kept && step.value !== null) index += 1
    else if (index >= 0) tweaks.set(index, (tweaks.get(index) ?? 0) + 1)
  }
  const out: Row[] = live.map((branch) => ({ branch, key: `l-${branch.name}`, kind: 'live' as const }))
  for (let position = kept.length - 1; position >= 0; position--) {
    const step = kept[position]!
    const was = kept[position - 1]?.value ?? undefined
    const count = tweaks.get(position) ?? 0
    if (count) out.push({ count, key: `w-${position}`, kind: 'tweaks' })
    for (const branch of [...(tried.get(position) ?? [])].reverse()) out.push({ branch, key: `t-${branch.name}`, kind: 'tried' })
    if (position === 0 && !step.merged) out.push({ key: `s-${step.commit}`, kind: 'start', step })
    else if (step.merged) out.push({ branch: progress.branches.find((branch) => branch.name === step.merged), key: `m-${step.commit}`, kind: 'merge', name: step.merged, step, was })
    else out.push({ key: `c-${step.commit}`, kind: 'main', step, was })
  }
  return out
}

function Chart(props: { progress: Progress.Progress }) {
  const kept = props.progress.main.filter((step) => step.kept && step.value !== null).map((step) => ({ merged: !!step.merged, value: step.value as number }))
  if (kept.length < 2) return null
  const values = kept.map((step) => step.value)
  const goal = props.progress.goal
  const top = Math.max(...values)
  const bottom = Math.min(...values)
  const shownGoal = goal !== null && goal >= bottom && goal <= top + (top - bottom) * 0.6 ? goal : null
  const high = Math.max(top, shownGoal ?? top)
  const low = Math.min(bottom, shownGoal ?? bottom)
  const span = high - low || 1
  const lower = props.progress.better === 'lower'
  const width = 600
  const height = 96
  const x = (index: number) => 8 + (index / (kept.length - 1)) * (width - 16)
  const y = (value: number) => {
    const share = (value - low) / span
    return 8 + (lower ? share : 1 - share) * (height - 16)
  }
  const path = kept.map((step, index) => (index === 0 ? `M${x(0)},${y(step.value)}` : `H${x(index)}V${y(step.value)}`)).join('')
  return (
    <svg aria-hidden="true" className="flow-chart" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
      {shownGoal !== null && <line className="flow-goal" x1="0" x2={width} y1={y(shownGoal)} y2={y(shownGoal)} />}
      <path className="flow-area" d={`${path}V${height}H${x(0)}Z`} />
      <path className="flow-line" d={path} vectorEffect="non-scaling-stroke" />
      {kept.map((step, index) => <circle className="flow-point" cx={x(index)} cy={y(step.value)} data-merged={step.merged} key={index} r={step.merged ? 3.5 : 2.5} vectorEffect="non-scaling-stroke" />)}
    </svg>
  )
}

function Node(props: { row: Row; progress: Progress.Progress }) {
  const row = props.row
  const progress = props.progress
  const [open, setOpen] = useState(false)
  if (row.kind === 'tweaks')
    return (
      <li className="flow-row" data-kind="tweaks">
        <i aria-hidden="true" className="flow-dot" />
        <p className="flow-quiet">{row.count} small tweak{row.count === 1 ? '' : 's'} on main, not kept</p>
      </li>
    )
  const value = row.kind === 'merge' || row.kind === 'main' || row.kind === 'start' ? row.step.value : null
  const delta = (row.kind === 'merge' || row.kind === 'main') && value !== null && row.was !== undefined ? change(value, row.was, progress.better) : undefined
  const branch = row.kind === 'merge' || row.kind === 'tried' || row.kind === 'live' ? row.branch : undefined
  const name = row.kind === 'merge' ? row.name : branch?.name
  const said =
    row.kind === 'merge' ? sentence(row.step.text.replace(/^merg(?:e|ed)\s+[\w.-]+\s*[:,-]?\s*/i, '')) || sentence(branch?.explores ?? '')
    : row.kind === 'main' ? sentence(row.step.text)
    : row.kind === 'start' ? sentence(row.step.text.replace(/^baseline\s*[:,-]?\s*/i, '')) || 'The baseline'
    : row.kind === 'tried' ? sentence(branch?.found || branch?.explores || '')
    : sentence(branch?.explores ?? '')
  const title = row.kind === 'merge' ? 'Merged into main' : row.kind === 'main' ? 'On main' : row.kind === 'start' ? 'Started here' : row.kind === 'tried' ? "Tried, didn't beat main" : 'Exploring now'
  const more = branch && (row.kind === 'merge' ? branch.found : row.kind === 'tried' ? branch.explores : '')
  return (
    <li className="flow-row" data-kind={row.kind}>
      <i aria-hidden="true" className="flow-dot" />
      <button aria-expanded={more ? open : undefined} className="flow-card" disabled={!more} onClick={() => setOpen(!open)} type="button">
        <span className="flow-top">
          {name && <span className="flow-name">{name}</span>}
          <b>{title}</b>
          {value !== null && <span className="flow-value">{amount(value, progress.metric)}{delta && <small>{delta}</small>}</span>}
        </span>
        {said && <span className="flow-said">{clip(said, open ? 600 : 170)}</span>}
        {open && more && <span className="flow-more">{sentence(more)}</span>}
      </button>
    </li>
  )
}

function Tree(props: { progress: Progress.Progress; running: boolean }) {
  const progress = props.progress
  const kept = progress.main.filter((step) => step.kept && step.value !== null)
  const first = kept[0]?.value ?? 0
  const now = kept.at(-1)?.value ?? 0
  const merged = kept.filter((step) => step.merged).length
  const tried = progress.branches.filter((branch) => !branch.merged && branch.state !== 'exploring' && branch.state !== 'promising').length
  const goal = progress.goal
  const reach = goal !== null && goal !== first ? Math.max(0, Math.min(1, (now - first) / (goal - first))) : null
  const listed = rows(progress)
  return (
    <div className="flow">
      <div className="flow-head" data-live={props.running}>
        <p className="flow-now"><b>{amount(now, progress.metric)}</b>{progress.title && <span>{progress.title}</span>}</p>
        <p className="flow-stats">
          {merged} merged into main · {tried} tried and dropped{goal !== null ? ` · goal ${amount(goal, progress.metric)}` : ''}
        </p>
        {reach !== null && <span aria-hidden="true" className="flow-reach"><i style={{ width: `${Math.round(reach * 1000) / 10}%` }} /></span>}
        <Chart progress={progress} />
      </div>
      <ol className="flow-list">{listed.map((row) => <Node key={row.key} progress={progress} row={row} />)}</ol>
    </div>
  )
}

type Look = 'exploring' | 'done' | 'dead' | 'stopped'

const looks: Record<Look, string> = { dead: "Didn't finish", done: 'Done', exploring: 'Exploring now', stopped: 'Stopped' }

function look(branch: Branch): Look {
  if (branch.state === 'pending' || branch.state === 'running') return 'exploring'
  if (branch.result && branch.state !== 'failed') return 'done'
  if (branch.state === 'failed' || branch.error) return 'dead'
  return 'stopped'
}

function named(role: string) {
  const bare = role.replace(/^\s*(?:auto\s*research|research)?\s*branch\s*:\s*/i, '').trim()
  return sentence(bare.replace(/[-_]+/g, ' ')) || 'A direction'
}

function Flat(props: { branches: readonly Branch[]; running: boolean }) {
  const branches = [...props.branches].sort((a, b) => b.id - a.id)
  const live = branches.filter((branch) => look(branch) === 'exploring').length
  if (!branches.length) return <p className="result-quiet">{props.running ? 'The AI is working on it directly. Directions it splits off show up here.' : 'No directions tried yet.'}</p>
  return (
    <div className="flow">
      <p className="flow-stats">{branches.length} direction{branches.length === 1 ? '' : 's'} tried{live ? `, ${live} still going` : ''}</p>
      <ol className="flow-list">
        {branches.map((branch) => {
          const state = look(branch)
          const said = state === 'done' ? branch.result ?? '' : state === 'exploring' ? branch.task.replace(/^\s*CONTEXT\.[\s\S]*?\n\n/, '') : ''
          return (
            <li className="flow-row" data-kind={state === 'exploring' ? 'live' : state === 'done' ? 'branch' : 'tried'} key={branch.id}>
              <i aria-hidden="true" className="flow-dot" />
              <div className="flow-card">
                <span className="flow-top"><b>{named(branch.role)}</b><span className="flow-state">{looks[state]}</span></span>
                {said && <span className="flow-said">{clip(sentence(said), 170)}</span>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export function Explored(props: { branches: readonly Branch[] | undefined; progress: Progress.Progress | null | undefined; running: boolean }) {
  if (props.progress) return <Tree progress={props.progress} running={props.running} />
  if (props.progress === undefined || !props.branches) return <div aria-busy="true" className="explored-wait" />
  return <Flat branches={props.branches} running={props.running} />
}
