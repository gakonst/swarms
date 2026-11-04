import type { Entry, Kind } from './Api.ts'

export type Step = { detail: string | null; kind: Kind; text: string }

export type Buffers = { add(who: string | null, text: string): void; take(who: string | null): string }

const quiet = new Set(['write_stdin', 'wait', 'wait_agent', 'list_agents', 'spawn_agent'])

export function clip(text: string, length: number) {
  return text.length > length ? text.slice(0, length - 1) + '…' : text
}

export function redact(text: string) {
  return text.replace(/(https?:\/\/)[^\s/@:'"]+:[^\s/@'"]+@/g, '$1***@').replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[redacted]')
}

export function tool(payload: Record<string, unknown>) {
  return String(payload['tool'] ?? 'a tool').replace(/^mcp__gateway__/, '')
}

export function call(payload: Record<string, unknown>): Step | undefined {
  const name = tool(payload)
  const raw = typeof payload['arguments'] === 'string' ? payload['arguments'] : JSON.stringify(payload['arguments'] ?? {})
  const input =
    typeof payload['arguments'] === 'object' && payload['arguments'] !== null
      ? (payload['arguments'] as Record<string, unknown>)
      : {}
  const on = typeof input['hand'] === 'string' ? ` on ${input['hand']}` : ''

  if (name === 'exec') return { detail: clip(raw, 4000), kind: 'tool', text: `Ran a script: ${clip(raw.split('\n')[0] ?? '', 120)}` }
  if (name === 'spawn_agent')
    return { detail: clip(String(input['task'] ?? ''), 2000), kind: 'tool', text: `Spawned a subagent: ${clip(String(input['role'] ?? 'worker'), 80)}` }
  if (name === 'wait_agent') return { detail: null, kind: 'tool', text: 'Waiting on subagents' }
  if (name === 'compute_create')
    return {
      detail: raw,
      kind: 'machine',
      text: `Starting machine ${String(input['attach'] ?? '')} (${String(input['image'] ?? 'default image')}${input['gpu'] ? ', ' + String(input['gpu']) : ''})`,
    }
  if (name === 'compute_terminate') return { detail: raw, kind: 'machine', text: 'Shutting down a machine' }
  if (name === 'exec_command') return { detail: raw, kind: 'tool', text: `$ ${clip(String(input['cmd'] ?? ''), 140)}${on}` }
  if (name === 'write_stdin' || name === 'wait') return undefined
  return { detail: clip(raw, 2000), kind: 'tool', text: `Called ${name}${on}` }
}

export function output(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value))
    return value
      .map((part) => (typeof part === 'object' && part !== null && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n')
  return value === undefined || value === null ? '' : JSON.stringify(value)
}

export function result(name: string, text: string) {
  const exited = /^Process exited with code (-?\d+)$/m.exec(text)?.[1]
  const running = /^Process running with session ID/m.test(text) || /^Script running with cell ID/m.test(text)
  const marker = /^Output:$/m.exec(text)
  const body = (/^(Chunk ID|Script (completed|running|failed)|Wall time|Process (exited|running)|Original token count)/.test(text) && marker ? text.slice(marker.index + 'Output:'.length) : text).trim()
  const label = name === 'exec' ? 'Script' : name === 'exec_command' ? 'Command' : name
  const status = exited === undefined ? (running ? ' · still running' : '') : exited === '0' ? '' : ` · exit ${exited}`
  return { body, text: `${label} output${status}` }
}

export function step(type: string | undefined, payload: Record<string, unknown>): Step | undefined {
  if (type === 'tool.call') return call(payload)
  if (type === 'tool.result') {
    const name = tool(payload)
    const text = output(payload['result']).trim()
    if (payload['status'] !== 'completed') return { detail: clip(text || JSON.stringify(payload['result'] ?? ''), 2000), kind: 'error', text: `${name} failed` }
    if (quiet.has(name) || !text) return undefined
    const shown = result(name, text)
    if (!shown.body) return undefined
    return { detail: clip(shown.body, 2000), kind: 'output', text: shown.text }
  }
  if (type === 'assistant.message') return { detail: null, kind: 'message', text: clip(String(payload['text'] ?? ''), 4000) }
  if (type === 'run.failed') return { detail: clip(JSON.stringify(payload), 2000), kind: 'error', text: 'The run failed.' }
  if (type === 'model.call.failed') {
    const said = String(payload['error'] ?? '')
    const reason = /"message":"((?:[^"\\]|\\.)*)"/.exec(said)?.[1]?.replace(/\\"/g, '"') ?? ''
    return { detail: clip(JSON.stringify(payload), 2000), kind: 'error', text: reason ? `A model call failed: ${clip(reason, 240)}` : 'A model call failed.' }
  }
  return undefined
}

export function narrate(buffers: Buffers, who: string | null, type: string | undefined, payload: Record<string, unknown>): Step[] {
  if (type === 'reasoning.summary.delta') {
    buffers.add(who, String(payload['text'] ?? ''))
    return []
  }
  const steps: Step[] = []
  if (type === 'assistant.message' || type === 'model.call.completed') {
    const thinking = buffers.take(who).trim()
    if (thinking) steps.push({ detail: null, kind: 'thinking', text: clip(thinking, 1500) })
  }
  const found = step(type, payload)
  if (found) steps.push(found)
  return steps
}

export type Crew = { ended: Record<string, string>; names: Record<string, string> }

export function crew(): Crew {
  return { ended: {}, names: {} }
}

type Subagent = { agent?: Record<string, unknown>; event?: { payload?: Record<string, unknown>; type?: string }; id?: unknown; status?: Record<string, unknown>; type?: string }

function label(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

export function subagent(buffers: Buffers, crew: Crew, scope: string, update: unknown): { steps: Step[]; who: string } | undefined {
  if (typeof update !== 'object' || update === null) return undefined
  const row = update as Subagent
  const id = label(row.type === 'added' ? row.agent?.['id'] : row.id)
  if (id === undefined) return undefined
  const key = `${scope}:${id}`
  if (row.type === 'added') {
    const role = clip(String(row.agent?.['role'] ?? '').trim() || `subagent ${id}`, 60)
    const taken = Object.entries(crew.names).some(([other, name]) => other !== key && name === role)
    const who = taken ? `${role} #${id}` : role
    crew.names[key] = who
    return { steps: [{ detail: clip(String(row.agent?.['task'] ?? ''), 2000) || null, kind: 'status', text: `Started a subagent: ${who}` }], who }
  }
  const who = crew.names[key] ?? `subagent ${id}`
  if (row.type === 'event') return { steps: narrate(buffers, who, row.event?.type, row.event?.payload ?? {}), who }
  if (row.type === 'status' || row.type === 'completion') {
    const state = String(row.status?.['state'] ?? '')
    if (!['completed', 'failed', 'interrupted', 'closed'].includes(state) || crew.ended[key] === state || (row.type === 'status' && state === 'completed')) return { steps: [], who }
    crew.ended[key] = state
    if (state === 'completed') {
      const result = output(row.status?.['output']).trim()
      return { steps: [{ detail: result ? clip(result, 20_000) : null, kind: 'output', text: `${who} finished` }], who }
    }
    if (state === 'failed') return { steps: [{ detail: clip(output(row.status?.['error']), 2000) || null, kind: 'error', text: `${who} failed` }], who }
    if (state === 'interrupted' || state === 'closed') return { steps: [{ detail: null, kind: 'status', text: `${who} stopped` }], who }
  }
  return { steps: [], who }
}

export function memory(): Buffers {
  const texts = new Map<string, string>()
  return {
    add: (who, text) => texts.set(who ?? '', (texts.get(who ?? '') ?? '') + text),
    take: (who) => {
      const text = texts.get(who ?? '') ?? ''
      texts.delete(who ?? '')
      return text
    },
  }
}

function args(detail: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(detail ?? '')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function base(path: string) {
  const trimmed = path.replace(/^['"]|['"]$/g, '').replace(/\/+$/, '')
  const parts = trimmed.split('/').filter(Boolean)
  return parts.length > 2 ? parts.slice(-2).join('/') : trimmed
}

export function command(line: string) {
  const hops = line.replace(/\s+on [\w.-]+$/, '').split(/\s*(?:&&|\|\||;)\s*/).map((part) => part.trim()).filter((part) => part && !/^(cd|export|set|source|\.)\s/.test(part))
  const main = hops.find((part) => !/^(mkdir|echo|true)\b/.test(part)) ?? hops[0] ?? ''
  const piped = main.split(/\s+\|\s+/)[0] ?? main
  const words = piped.split(/\s+/).filter(Boolean)
  const head = (words[0] ?? '').replace(/^.*\//, '')
  const rest = words.slice(1).filter((word) => !word.startsWith('-'))
  const target = rest.at(-1)
  const wrote = /(?:^|\s)(?:>|>>|tee)\s*([^\s|&;]+)/.exec(main)?.[1]
  if (wrote && !wrote.startsWith('/dev/')) return `Wrote ${base(wrote)}`
  if (!head) return 'Ran a command'
  if (['cat', 'head', 'tail', 'less', 'bat', 'wc'].includes(head)) return target ? `Read ${base(target)}` : 'Read a file'
  if (head === 'sed' && words.includes('-n')) return target ? `Read ${base(target)}` : 'Read a file'
  if (['ls', 'find', 'tree'].includes(head)) return target ? `Listed ${base(target)}` : 'Listed files'
  if (['grep', 'rg', 'ag'].includes(head)) return rest[0] ? `Searched for ${clip(rest[0].replace(/^['"]|['"]$/g, ''), 40)}` : 'Searched the files'
  if (['curl', 'wget'].includes(head)) {
    const url = words.find((word) => /^['"]?https?:\/\//.test(word))
    return url ? `Downloaded from ${new URL(url.replace(/^['"]|['"]$/g, '')).host}` : 'Downloaded a file'
  }
  if (head === 'mkdir') return target ? `Made ${base(target)}` : 'Made a folder'
  if (['pip', 'pip3', 'apt', 'apt-get', 'brew', 'uv'].includes(head) && words.includes('install')) return 'Installed packages'
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(head) && rest[0] === 'install') return 'Installed packages'
  if (['python', 'python3', 'node', 'deno', 'bash', 'sh', 'ruby'].includes(head)) {
    if (rest[0] === 'm' || words[1] === '-m') return `Ran ${words[2] ?? head}`
    return rest[0] && !words.includes('-c') && !words.includes('-e') ? `Ran ${base(rest[0])}` : `Ran ${head}`
  }
  if (['git', 'cargo', 'go', 'npm', 'pnpm', 'yarn', 'make', 'docker', 'uv'].includes(head)) return `Ran ${head}${rest[0] ? ` ${clip(rest[0], 24)}` : ''}`
  return `Ran ${clip(head, 30)}`
}

function script(code: string) {
  const ran = /(?:cmd|command)\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(code)?.[2]
  const path = /file_path\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(code)?.[2]
  const used = [...code.matchAll(/tools\.(?:mcp__gateway__)?(\w+)\s*\(/g)].map((found) => found[1] ?? '')
  const first = used[0]
  if (first === 'Write' && path) return `Wrote ${base(path)}`
  if (first === 'Edit' && path) return `Edited ${base(path)}`
  if (first === 'Read' && path) return `Read ${base(path)}`
  if ((first === 'exec_command' || first === 'Bash' || first === 'compute_exec') && ran) return command(ran)
  if (first === 'spawn_agent') return 'Started subagents'
  if (first === 'wait_agent') return 'Waited on subagents'
  const names = [...new Set(used.filter((name) => !['text', 'image'].includes(name)))]
  if (names.length) return `Called ${names.slice(0, 2).join(', ')}${names.length > 2 ? '…' : ''}`
  return 'Ran a script'
}

export function named(entry: Pick<Entry, 'detail' | 'text'>) {
  const text = entry.text
  if (text.startsWith('$ ')) return command(text.slice(2))
  if (text.startsWith('Ran a script:')) return script(entry.detail ?? text.slice(13))
  const called = /^Called (\w+)/.exec(text)?.[1]
  if (!called) return text
  const input = args(entry.detail)
  const pick = (...keys: string[]) => keys.map((name) => input[name]).find((value) => typeof value === 'string' && value) as string | undefined
  const where = pick('key', 'path', 'name', 'file')
  if (called === 'bucket_put') return where ? `Saved ${base(where)} to the bucket` : 'Saved a file to the bucket'
  if (called === 'bucket_get') return where ? `Read ${base(where)} from the bucket` : 'Read a file from the bucket'
  if (called === 'kv_set') return where ? `Saved ${clip(where, 40)}` : 'Saved a value'
  if (called === 'kv_get' || called === 'kv_list') return where ? `Read ${clip(where, 40)}` : 'Read saved values'
  if (called === 'git_commit') return pick('message') ? `Committed: ${clip(pick('message')?.split('\n')[0] ?? '', 60)}` : 'Committed code'
  if (called === 'git_create') return where ? `Created the repository ${where}` : 'Created a repository'
  if (called === 'fetch') {
    const url = pick('url')
    try {
      return url ? `Fetched ${new URL(url).host}` : 'Fetched a page'
    } catch {
      return 'Fetched a page'
    }
  }
  if (called === 'web__run' || called === 'web_search' || called === 'search') return pick('query', 'q') ? `Searched the web for ${clip(pick('query', 'q') ?? '', 50)}` : 'Searched the web'
  if (called === 'compute_exec') return pick('command', 'cmd') ? `${command(pick('command', 'cmd') ?? '')} on a machine` : 'Ran a command on a machine'
  if (called === 'compute_read') return where ? `Read ${base(where)} on a machine` : 'Read a file on a machine'
  if (called === 'compute_write') return where ? `Wrote ${base(where)} on a machine` : 'Wrote a file on a machine'
  if (called === 'compute_renew') return 'Kept a machine running'
  if (called === 'compute_list') return 'Listed its machines'
  if (called === 'compute_spawn') return 'Started a process on a machine'
  if (called === 'submit_result') return 'Handed in its result'
  if (called === 'browser_create') return 'Opened a browser'
  if (called.startsWith('browser_')) return `Used the browser: ${called.slice(8).replace(/_/g, ' ')}`
  return text
}

export type Trouble = { money: boolean; text: string }

export function trouble(entry: Pick<Entry, 'detail' | 'text'>): Trouble {
  const all = `${entry.text}\n${entry.detail ?? ''}`
  const spent = /after spending \$(\d+(?:\.\d+)?)/.exec(entry.text)?.[1]
  const tail = spent ? ` It had spent ${spentCash(Number(spent))}.` : ''
  if (/\b402\b|limit_reached|refused to pay|spent for now|cannot pay this much/i.test(all)) return { money: true, text: `Ran out of money for this step.${tail}` }
  if (/\b429\b|reservations|busy/i.test(all)) return { money: false, text: 'Waited for earlier payments to clear, then carried on.' }
  if (/did not answer within/i.test(all)) return { money: false, text: `The payment service was slow to answer, so the step stopped.${tail}` }
  if (/never opened on Tempo|Could not open .*channel/i.test(entry.text)) return { money: false, text: 'A payment channel did not open; the next payment tries again.' }
  if (/HTTP 5\d\d|unavailable|overloaded|timed? ?out/i.test(all) && /model call|run failed|stopped with an error/i.test(entry.text)) return { money: false, text: `The model service was unavailable, so the step stopped.${tail}` }
  if (/^A model call failed/.test(entry.text)) return { money: false, text: 'A model call failed.' }
  if (/^The run failed/.test(entry.text) || /stopped with an error/.test(entry.text)) return { money: false, text: `The agent's turn stopped on an error.${tail}` }
  return { money: false, text: entry.text.replace(/\$(\d+\.\d{3,})/g, (_, value: string) => spentCash(Number(value))) }
}

function spentCash(value: number) {
  return value >= 0.1 ? `$${value.toFixed(2)}` : `$${Number(value.toPrecision(2))}`
}

export function key(entry: Pick<Entry, 'event' | 'kind' | 'seq'>) {
  return typeof entry.event === 'number' ? `e${entry.event}${entry.kind}` : `s${entry.seq}`
}

export function merge(previous: readonly Entry[], next: readonly Entry[], cap = 5000) {
  if (next.length === 0) return previous
  const byKey = new Map(previous.map((entry) => [key(entry), entry]))
  let changed = false
  for (const entry of next) {
    const known = byKey.get(key(entry))
    if (known && (known.seq !== 0 || entry.seq === 0)) continue
    byKey.set(key(entry), known ? { ...entry, at: Math.min(known.at, entry.at) } : entry)
    changed = true
  }
  if (!changed) return previous
  return [...byKey.values()].sort((a, b) => a.at - b.at || (a.event ?? 0) - (b.event ?? 0) || a.seq - b.seq).slice(-cap)
}
