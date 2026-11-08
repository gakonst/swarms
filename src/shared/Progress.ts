export type State = 'exploring' | 'promising' | 'dead end' | 'done'

export type Step = { commit: string; kept: boolean; merged: string | null; text: string; value: number | null }

export type Line = { explores: string; found: string; merged: boolean; name: string; state: State }

export type Progress = { better: 'higher' | 'lower'; branches: Line[]; goal: number | null; main: Step[]; metric: string; title: string }

export const slug = 'autoresearch'

const states: readonly State[] = ['exploring', 'promising', 'dead end', 'done']

function words(value: unknown, most: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, most) : ''
}

function state(value: unknown): State {
  const text = words(value, 40).toLowerCase()
  return (states as readonly string[]).includes(text) ? (text as State) : /dead|drop|abandon|fail/.test(text) ? 'dead end' : /done|finish|complete|merged/.test(text) ? 'done' : 'exploring'
}

export function table(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 2000)
    .map((line) => line.split('\t').map((cell) => cell.trim()))
}

export function merges(text: string) {
  return /^merg(?:e|ed)\s+([a-z0-9][\w.-]*)/i.exec(text.trim())?.[1]?.toLowerCase().replace(/[:,]$/, '') ?? null
}

export function steps(text: string, metric: string): Step[] {
  const [head = [], ...rows] = table(text)
  const names = head.map((cell) => cell.toLowerCase())
  const at = (name: string) => names.indexOf(name)
  const measured = at(metric.toLowerCase()) >= 0 ? at(metric.toLowerCase()) : 1
  const status = at('status')
  const described = at('description') >= 0 ? at('description') : head.length - 1
  return rows.flatMap((row): Step[] => {
    const commit = row[0] ?? ''
    if (!commit) return []
    const raw = Number(row[measured])
    const said = row[described] ?? ''
    const kept = status < 0 ? true : (row[status] ?? '').toLowerCase() === 'keep'
    return [{ commit, kept, merged: kept ? merges(said) : null, text: said.slice(0, 400), value: Number.isFinite(raw) && raw > 0 ? raw : null }]
  })
}

export function parse(data: unknown, main: string | undefined): Progress | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const fields = data as Record<string, unknown>
  const metric = words(fields['metric'], 60)
  if (!metric || main === undefined) return undefined
  const line = steps(main, metric)
  if (!line.some((step) => step.kept && step.value !== null)) return undefined
  const merged = new Set(line.flatMap((step) => (step.merged ? [step.merged] : [])))
  const listed = Array.isArray(fields['branches']) ? fields['branches'] : []
  const branches = listed.slice(0, 200).flatMap((item): Line[] => {
    if (typeof item !== 'object' || item === null) return []
    const branch = item as Record<string, unknown>
    const name = words(branch['name'], 60).toLowerCase()
    if (!name || name === 'main') return []
    const found = words(branch['found'], 400)
    return [{ explores: words(branch['explores'], 300), found, merged: merged.has(name) || /\(merged\)/i.test(found), name, state: state(branch['state']) }]
  })
  const goal = Number(fields['goal'])
  return {
    better: words(fields['better'], 10).toLowerCase() === 'lower' ? 'lower' : 'higher',
    branches,
    goal: Number.isFinite(goal) && goal > 0 ? goal : null,
    main: line,
    metric,
    title: words(fields['title'], 200),
  }
}
