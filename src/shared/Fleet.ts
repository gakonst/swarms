import type { Entry, Hand, Lent } from './Api.ts'

export type Run = { at: number; failed: boolean; output: string | null; seq: number; text: string; who: string | null }

export type Machine = {
  by: string | null
  charged: string | null
  commands: Run[]
  config: [string, string][]
  connected: boolean
  ended: number | null
  failed: string | null
  kind: 'browser' | 'hand' | 'sandbox'
  label: string | null
  name: string
  price: string | null
  requests: number | null
  started: number | null
}

const shown: Record<string, string> = {
  apt: 'Packages',
  blockNetwork: 'Network',
  cpu: 'CPU',
  cpuMax: 'CPU',
  env: 'Environment',
  exitSnapshot: 'Snapshot on exit',
  gpu: 'GPU',
  gpuCount: 'GPUs',
  idleTimeout: 'Idle timeout',
  image: 'Image',
  lease: 'Lease',
  memory: 'Memory',
  memoryMax: 'Memory',
  minutes: 'Minutes',
  pip: 'Python packages',
  ports: 'Ports',
  provider: 'Provider',
  region: 'Region',
  snapshot: 'From snapshot',
  timeout: 'Timeout',
  volumes: 'Volumes',
  workdir: 'Folder',
}

const sandboxed = /^Called compute_(exec|write|read|logs|stream|spawn|renew|status|snapshot|terminate)$/

function json(text: string | null) {
  if (!text) return undefined
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function volume(raw: unknown) {
  if (typeof raw !== 'object' || raw === null) return String(raw)
  const { name, path, readOnly } = raw as { name?: unknown; path?: unknown; readOnly?: unknown }
  return [name, path ? `at ${String(path)}` : null, readOnly ? '(read-only)' : null].filter(Boolean).join(' ')
}

function value(key: string, raw: unknown): string {
  if (key === 'volumes' && Array.isArray(raw)) return raw.map(volume).join(', ')
  if (key === 'env' && typeof raw === 'object' && raw !== null) return Object.keys(raw).join(', ')
  if (key === 'blockNetwork') return raw ? 'blocked' : 'open'
  if (Array.isArray(raw)) return raw.map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item))).join(', ')
  if ((key === 'memory' || key === 'memoryMax') && typeof raw === 'number') return raw >= 1024 ? `${Math.round((raw / 1024) * 10) / 10} GB` : `${raw} MB`
  if ((key === 'lease' || key === 'timeout' || key === 'idleTimeout') && typeof raw === 'number') return raw >= 60 ? `${Math.round(raw / 60)} min` : `${raw} s`
  if (typeof raw === 'boolean') return raw ? 'yes' : 'no'
  if (typeof raw === 'object' && raw !== null) return JSON.stringify(raw)
  return String(raw)
}

function settings(input: Record<string, unknown>) {
  const capped = (key: string) => (key === 'cpu' && input['cpuMax'] !== undefined) || (key === 'memory' && input['memoryMax'] !== undefined) || (key === 'gpuCount' && input['gpuCount'] === 1)
  return Object.entries(input)
    .filter(([key, raw]) => key !== 'attach' && key !== 'name' && !capped(key) && raw !== null && raw !== undefined && raw !== '' && !(Array.isArray(raw) && !raw.length))
    .map(([key, raw]): [string, string] => [shown[key] ?? key, value(key, raw)])
}

function sandbox(text: string | null) {
  return /sandboxId\\?"\s*:\s*\\?"(sb-[A-Za-z0-9]+)/.exec(text ?? '')?.[1]
}

function reason(text: string | null) {
  const found = /\\?"detail\\?"\s*:\s*\\?"(.*?)\\?"\s*[,}]/.exec(text ?? '')?.[1]
  return found ? found.replace(/\\+"/g, '"') : text?.slice(0, 300) ?? null
}

function called(text: string, args: Record<string, unknown> | undefined, detail: string | null) {
  const command = args?.['command']
  const path = args?.['path'] ?? /"path"\s*:\s*"([^"]+)"/.exec(detail ?? '')?.[1]
  if (text === 'Called compute_exec' || text === 'Called compute_spawn' || text === 'Called compute_stream') {
    const parts = Array.isArray(command) ? command.map(String) : []
    const script = parts.length === 3 && /^(ba)?sh$/.test(parts[0] ?? '') && parts[1] === '-c' ? parts[2] : parts.join(' ')
    return script ? `$ ${script.trim()}` : text.replace('Called ', '')
  }
  if (text === 'Called compute_write' || text === 'Called compute_read') return `${text.replace('Called compute_', '')} ${String(path ?? '')}`.trim()
  return text.replace('Called compute_', '')
}

export function fleet(entries: readonly Entry[], hands: readonly Hand[], lent: readonly Lent[]): Machine[] {
  const found = new Map<string, Machine>()
  const get = (name: string, kind: Machine['kind'], at: number, by: string | null) => {
    let machine = found.get(name)
    if (!machine) {
      machine = { by, charged: null, commands: [], config: [], connected: false, ended: null, failed: null, kind, label: null, name, price: null, requests: null, started: at }
      found.set(name, machine)
    }
    return machine
  }
  const sorted = [...entries].sort((a, b) => a.at - b.at || a.seq - b.seq)
  const sandboxes = new Map<string, string>()
  let browsers = 0
  let starting: { at: number; config: [string, string][]; name: string | undefined; who: string | null } | undefined

  for (const [index, entry] of sorted.entries()) {
    const start = /^Starting machine (\S*)/.exec(entry.text)
    if (entry.kind === 'machine' && start) {
      const config = settings(json(entry.detail) ?? {})
      const name = start[1] || undefined
      if (name) {
        const machine = get(name, 'sandbox', entry.at, entry.who)
        machine.config = config
        machine.started = entry.at
        machine.ended = null
        machine.failed = null
      }
      starting = { at: entry.at, config, name, who: entry.who }
      continue
    }
    if (entry.kind === 'output' && entry.text.startsWith('compute_create') && starting && (entry.who ?? null) === (starting.who ?? null)) {
      const id = sandbox(entry.detail)
      if (id && starting.name) sandboxes.set(id, starting.name)
      else if (id) get(id, 'sandbox', starting.at, starting.who).config = starting.config
      starting = undefined
      continue
    }
    if (entry.kind === 'error' && entry.text.startsWith('compute_create') && starting && (entry.who ?? null) === (starting.who ?? null)) {
      const machine = starting.name ? found.get(starting.name) : undefined
      if (machine) {
        machine.ended = entry.at
        machine.failed = reason(entry.detail) ?? entry.text
      }
      starting = undefined
      continue
    }
    if (entry.kind === 'tool' && entry.text === 'Called browser_create') {
      const input = json(entry.detail) ?? {}
      browsers += 1
      const machine = get(String(input['name'] ?? `browser ${browsers}`), 'browser', entry.at, entry.who)
      machine.config = settings(input)
      continue
    }
    const joined = /^A contributor's machine joined the swarm as hand (\S+?)(?: \((.+)\))?\.$/.exec(entry.text)
    if (entry.kind === 'machine' && joined?.[1]) {
      const machine = get(joined[1], 'hand', entry.at, null)
      machine.label = joined[2] ?? machine.label
      continue
    }
    const left = /^Machine (\S+) left\.$/.exec(entry.text)
    if (entry.kind === 'machine' && left?.[1]) {
      const machine = found.get(left[1])
      if (machine) machine.ended = entry.at
      continue
    }
    if (entry.kind === 'machine' && entry.text === 'Shutting down a machine') {
      const id = sandbox(entry.detail)
      const named = id ? sandboxes.get(id) : undefined
      for (const machine of found.values()) if (machine.name === named || entry.detail?.includes(machine.name)) machine.ended = entry.at
      continue
    }
    if (entry.kind !== 'tool' || !/^(\$ |Called )/.test(entry.text)) continue
    const args = json(entry.detail)
    const boxed = sandboxed.test(entry.text) ? sandbox(entry.detail) : undefined
    const on = boxed ? (sandboxes.get(boxed) ?? boxed) : (/ on (\S+)$/.exec(entry.text)?.[1] ?? /"hand"\s*:\s*"([^"]+)"|hand:\s*["']([^"']+)["']/.exec(entry.detail ?? '')?.slice(1).find(Boolean))
    if (!on) continue
    const machine = found.get(on) ?? get(on, on.startsWith('sb-') ? 'sandbox' : 'hand', entry.at, entry.who)
    let output = args ? null : entry.detail
    let failed = false
    for (const next of sorted.slice(index + 1, index + 6)) {
      if ((next.who ?? null) !== (entry.who ?? null)) continue
      if (next.kind === 'tool') break
      if (next.kind === 'output' || next.kind === 'error') {
        output = [output, next.detail ?? next.text].filter(Boolean).join('\n')
        failed = next.kind === 'error' || /exit [1-9]/.test(next.text)
        break
      }
    }
    machine.commands.push({ at: entry.at, failed, output, seq: entry.seq, text: boxed ? called(entry.text, args, entry.detail) : entry.text.replace(/ on \S+$/, ''), who: entry.who })
  }

  for (const hand of hands) {
    const machine = found.get(hand.name) ?? get(hand.name, hand.name.startsWith('sb-') ? 'sandbox' : 'hand', 0, null)
    machine.connected = hand.connected
  }
  for (const hand of lent) {
    const machine = found.get(hand.name) ?? get(hand.name, 'hand', hand.at, null)
    machine.kind = 'hand'
    machine.label = hand.label || machine.label
    machine.connected = machine.connected || hand.connected
    machine.charged = hand.charged
    machine.price = hand.price
    machine.requests = hand.requests
    machine.started ??= hand.at
  }
  return [...found.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || (b.started ?? 0) - (a.started ?? 0))
}
