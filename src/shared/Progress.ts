export type State = 'exploring' | 'promising' | 'dead end' | 'done'

export type Step = { commit: string; kept: boolean; merged: string | null; text: string; value: number | null }

export type Line = { explores: string; found: string; from?: string | null; merged: boolean; name: string; state: State }

export type Progress = { better: 'higher' | 'lower'; branches: Line[]; goal: number | null; main: Step[]; metric: string; source: 'git' | 'artifact'; title: string }

export type Commit = { date: string | null; message: string; parents: string[]; sha: string }

export type Hint = { better: Progress['better'] | null; explores: ReadonlyMap<string, string>; goal: number | null; metric: string; title: string }

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
  const first = text.trim().split('\n')[0]?.trim() ?? ''
  const named = /^merg(?:e|ed)\s+(?:remote-tracking\s+)?(?:branch(?:es)?\s+)?['"]?(?:origin\/)?([a-z0-9][\w./-]*?)['"]?(?:\s+into\s+\S+)?(?:\s*[:,(]|\s+-\s|\s*$)/i.exec(first)?.[1]
  return named ? named.toLowerCase().replace(/[.:,]+$/, '') : null
}

const lower = /loss|bpb|perplexity|latency|time|error|seconds|ms\b|cost/i

export function measure(message: string, metric: string): { metric: string; value: number } | undefined {
  if (metric) {
    const escaped = metric.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`)
    const named = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:=]\\s*(-?\\d+(?:\\.\\d+)?)`, 'i').exec(message)
    if (named) return { metric, value: Number(named[1]) }
  }
  const line = /(?:^|\n)\s*([a-z][\w ./-]{0,40}?)\s*[:=]\s*(-?\d+(?:\.\d+)?)\s*(?:x|×|%)?\s*(?:\n|$)/i.exec(message)
  if (line) return { metric: line[1]!.trim().toLowerCase(), value: Number(line[2]) }
  const times = /(\d+(?:\.\d+)?)\s*[x×](?![\w])/i.exec(message.split('\n')[0] ?? '')
  return times ? { metric: metric || 'speedup', value: Number(times[1]) } : undefined
}

export function fromGit(input: { branches: readonly { name: string; sha: string | null }[]; hint: Hint | undefined; live: readonly string[]; logs: Readonly<Record<string, readonly Commit[]>>; main: readonly Commit[]; trunk: string }): Progress | undefined {
  const known = new Map(input.main.map((commit) => [commit.sha, commit]))
  const head = input.main[0]
  if (!head) return undefined
  const chain: Commit[] = []
  for (let at: Commit | undefined = head; at && chain.length < 500; at = at.parents[0] ? known.get(at.parents[0]) : undefined) chain.push(at)
  chain.reverse()
  const onTrunk = new Set(chain.map((commit) => commit.sha))
  const onMain = new Set(input.main.map((commit) => commit.sha))
  const others = input.branches.filter((branch) => branch.name !== input.trunk)
  const owner = (sha: string) => others.find((branch) => branch.sha === sha || input.logs[branch.name]?.some((commit) => commit.sha === sha))?.name ?? null
  let metric = input.hint?.metric ?? ''
  const steps: Step[] = chain.map((commit) => {
    const merged = commit.parents.length > 1 ? (merges(commit.message) ?? owner(commit.parents[1]!) ?? 'a branch') : null
    const found = measure(commit.message, metric)
    if (found && !metric) metric = found.metric
    return { commit: commit.sha, kept: true, merged, text: commit.message.split('\n')[0]?.slice(0, 400) ?? '', value: found?.value ?? null }
  })
  const merged = new Set(steps.flatMap((step) => (step.merged ? [step.merged] : [])))
  const live = new Set(input.live.map((name) => name.toLowerCase()))
  const lines = others.flatMap((branch): Line[] => {
    const name = branch.name.toLowerCase()
    const log = input.logs[branch.name] ?? []
    const absorbed = merged.has(name) || (branch.sha !== null && onMain.has(branch.sha))
    const from = log.find((commit) => onTrunk.has(commit.sha))?.sha ?? null
    const own = log.find((commit) => !onMain.has(commit.sha))
    return [{
      explores: input.hint?.explores.get(name) ?? '',
      found: own?.message.split('\n')[0]?.slice(0, 400) ?? '',
      from,
      merged: absorbed,
      name,
      state: live.has(name) ? 'exploring' : absorbed ? 'done' : 'dead end',
    }]
  })
  if (!merged.size && !lines.length) return undefined
  return {
    better: input.hint?.better ?? (lower.test(metric) ? 'lower' : 'higher'),
    branches: lines,
    goal: input.hint?.goal ?? null,
    main: steps,
    metric,
    source: 'git',
    title: input.hint?.title ?? '',
  }
}

export function hint(data: unknown): Hint | undefined {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const fields = data as Record<string, unknown>
  const goal = Number(fields['goal'])
  const listed = Array.isArray(fields['branches']) ? fields['branches'] : []
  return {
    better: words(fields['better'], 10).toLowerCase() === 'lower' ? 'lower' : words(fields['better'], 10).toLowerCase() === 'higher' ? 'higher' : null,
    explores: new Map(listed.flatMap((item) => (typeof item === 'object' && item !== null ? [[words((item as Record<string, unknown>)['name'], 60).toLowerCase(), words((item as Record<string, unknown>)['explores'], 300)] as const] : []))),
    goal: Number.isFinite(goal) && goal > 0 ? goal : null,
    metric: words(fields['metric'], 60),
    title: words(fields['title'], 200),
  }
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
    source: 'artifact',
    title: words(fields['title'], 200),
  }
}
