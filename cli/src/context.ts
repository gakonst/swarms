import type { IncomingMessage } from 'node:http'

export type Flags = Record<string, string | boolean>

export type Requested = { body?: Uint8Array | string; headers?: Record<string, string>; method?: string; signal?: AbortSignal }

export async function request(url: string, options: Requested = {}) {
  const target = new URL(url)
  const transport = target.protocol === 'http:' ? await import('node:http') : await import('node:https')
  const headers = { 'user-agent': 'swarms-cli', ...options.headers, ...(options.body === undefined ? {} : { 'content-length': String(Buffer.byteLength(options.body)) }) }
  return new Promise<IncomingMessage>((resolve, reject) => {
    const sent = transport.request(target, { headers, method: options.method ?? 'GET', ...(options.signal ? { signal: options.signal } : {}) }, resolve)
    sent.once('error', reject)
    sent.end(options.body)
  })
}

export async function text(response: IncomingMessage) {
  response.setEncoding('utf8')
  let all = ''
  for await (const chunk of response) all += chunk
  return all
}

export class Failure extends Error {
  readonly code: string
  readonly exit: number
  readonly next: string | undefined
  readonly status: number | undefined
  constructor(message: string, options: { code?: string; exit?: number; next?: string | undefined; status?: number } = {}) {
    super(message)
    this.code = options.code ?? 'error'
    this.exit = options.exit ?? 1
    this.next = options.next
    this.status = options.status
  }
}

export type Context = {
  args: string[]
  flags: Flags
  host: string
  json: boolean
  yes: boolean
  api<T>(method: string, path: string, body?: unknown, options?: Sending): Promise<T>
  request(path: string, init?: Requested): Promise<IncomingMessage>
  flag(name: string): string | undefined
  need(index: number, what: string): string
  out(value: unknown, human: string | (() => string)): void
  say(text: string): void
  signed(): Promise<string>
  token(): Promise<string | undefined>
}

export type Sending = { bytes?: Uint8Array; token?: string; type?: string }

export const fallback = 'https://swarms.new'

export function host(flags: Flags, env: NodeJS.ProcessEnv = process.env) {
  const given = (typeof flags['host'] === 'string' ? flags['host'] : env['SWARMS_HOST'] || fallback).trim()
  const full = /^https?:\/\//i.test(given) ? given : `https://${given}`
  try {
    const url = new URL(full)
    return (url.origin + url.pathname).replace(/\/+$/, '')
  } catch {
    throw new Failure(`${given} is not a web address.`, { code: 'invalid_host', exit: 2, next: 'Pass --host https://swarms.new, or set SWARMS_HOST.' })
  }
}

const hints: Record<number, string> = {
  401: 'Run swarms login, then try again.',
  403: 'Only the swarm\'s admins can do this; check who you are with swarms whoami.',
  404: 'Check the name with swarms ls.',
  409: 'Nothing changed; read where it stands with swarms status <swarm>.',
  429: 'Wait a minute and try again.',
  502: 'The gateway did not answer; try again shortly.',
  503: 'Try again shortly.',
}

export function hint(status: number, code: string) {
  if (code === 'username_required') return 'Pick a username on the site at /me, then try again.'
  if (code === 'gone') return 'The swarm is archived and read-only.'
  return hints[status]
}

export function context(argv: { args: string[]; flags: Flags }, env: NodeJS.ProcessEnv = process.env): Context {
  const root = host(argv.flags, env)
  let held: Promise<string | undefined> | undefined
  const token = () => (held ??= import('./auth.ts').then((auth) => auth.load(root)).then((saved) => saved?.token))
  const ctx: Context = {
    args: argv.args,
    flags: argv.flags,
    host: root,
    json: argv.flags['json'] === true,
    yes: argv.flags['yes'] === true,
    async request(path, init = {}) {
      try {
        return await request(root + path, init)
      } catch (error) {
        if (init.signal?.aborted) throw error
        throw new Failure(`Could not reach ${root}: ${error instanceof Error ? error.message : String(error)}`, { code: 'unreachable', next: `Check your connection, or pass --host (now ${root}).` })
      }
    },
    async api<T>(method: string, path: string, body?: unknown, options: Sending = {}) {
      const bearer = options.token ?? (await token())
      const headers: Record<string, string> = { accept: 'application/json' }
      if (bearer) headers['authorization'] = `Bearer ${bearer}`
      let payload: Uint8Array | string | undefined
      if (options.bytes) {
        headers['content-type'] = options.type ?? 'application/octet-stream'
        payload = options.bytes
      } else if (body !== undefined) {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const response = await ctx.request(path, { ...(payload === undefined ? {} : { body: payload }), headers, method })
      const read = await text(response)
      const status = response.statusCode ?? 0
      let parsed: unknown = undefined
      try {
        parsed = read ? JSON.parse(read) : undefined
      } catch {}
      if (status >= 200 && status < 300) return parsed as T
      const problem = (parsed ?? {}) as { code?: string; detail?: string }
      const code = problem.code ?? `http_${status}`
      throw new Failure(problem.detail ?? `${method} ${path} answered ${status}.`, { code, next: hint(status, code), status })
    },
    flag(name) {
      const value = argv.flags[name]
      return typeof value === 'string' ? value : undefined
    },
    need(index, what) {
      const value = argv.args[index]
      if (value === undefined || value === '') throw new Failure(`Missing ${what}.`, { code: 'usage', exit: 2, next: `Run swarms ${argv.args.slice(0, index).join(' ') || 'help'} --help.` })
      return value
    },
    out(value, human) {
      process.stdout.write(ctx.json ? JSON.stringify(value, null, 2) + '\n' : (typeof human === 'function' ? human() : human) + '\n')
    },
    say(text) {
      process.stderr.write(text + '\n')
    },
    async signed() {
      const held = await token()
      if (!held) throw new Failure(`Not signed in to ${root}.`, { code: 'unauthorized', next: 'Run swarms login.' })
      return held
    },
    token,
  }
  return ctx
}

export async function swarm(ctx: Context, given: string): Promise<string> {
  let name = given.trim()
  if (/^https?:\/\//i.test(name)) {
    try {
      name = new URL(name).pathname
    } catch {}
  }
  const parts = name.split('/').filter(Boolean)
  if (parts[0] === 'swarms' && parts.length > 1) parts.shift()
  if (parts[0] === 's' && parts[1]) return decodeURIComponent(parts[1])
  name = decodeURIComponent(parts[0] ?? '').replace(/^@/, '').toLowerCase()
  if (!name) throw new Failure('Missing the swarm.', { code: 'usage', exit: 2, next: 'Pass its name, its id or its address, such as swarms status p-vs-np.' })
  if (/^[0-9a-f]{12}$/.test(name)) return name
  try {
    return (await ctx.api<{ swarm: string }>('GET', `/v1/names/${encodeURIComponent(name)}`)).swarm
  } catch (error) {
    if (error instanceof Failure && error.status === 404) throw new Failure(`No swarm is called ${name}.`, { code: 'not_found', next: 'List swarms with swarms ls, or pass its id.', status: 404 })
    throw error
  }
}

export function page(host: string, summary: { id: string; nickname?: string | null }) {
  return summary.nickname ? `${host}/${summary.nickname}` : `${host}/s/${summary.id}`
}

export function usd(value: string | number | null | undefined) {
  const amount = Number(value ?? 0)
  return `$${amount.toFixed(amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2)}`
}

export function table(rows: string[][]) {
  const widths = rows.reduce<number[]>((all, row) => row.map((cell, at) => Math.max(all[at] ?? 0, cell.length)), [])
  return rows.map((row) => row.map((cell, at) => (at === row.length - 1 ? cell : cell.padEnd(widths[at] ?? 0))).join('  ')).join('\n')
}

export function line(text: string, most = 160) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > most ? flat.slice(0, most - 1) + '…' : flat
}

export async function ask(question: string): Promise<string> {
  const readline = await import('node:readline/promises')
  const reader = readline.createInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await reader.question(question)).trim()
  } finally {
    reader.close()
  }
}

export async function confirm(ctx: Context, question: string) {
  if (ctx.yes) return
  if (!process.stdin.isTTY) throw new Failure(`${question} needs a yes.`, { code: 'confirmation_required', next: 'Pass --yes to go ahead without a prompt.' })
  const answer = await ask(`${question} [y/N] `)
  if (!/^y(es)?$/i.test(answer)) throw new Failure('Cancelled.', { code: 'cancelled' })
}

export async function browse(ctx: Context, url: string) {
  const chosen = process.env['SWARMS_BROWSER'] ?? process.env['BROWSER']
  if (chosen === 'none' || ctx.flags['no-browser'] === true) return false
  const { spawn } = await import('node:child_process')
  const [command, args] = chosen ? [chosen, [url]] : process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' })
      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
