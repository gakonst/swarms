import * as readline from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import * as Limits from '../../src/shared/Limits.ts'
import * as Rpc from '../../src/shared/Rpc.ts'

export type Options = { token?: string | undefined; url: string }

export type Local = { input: Readable; output: Writable }

export const fallback = 'https://swarms.new'

const longest = 330_000

const forwarded = new Set(['resources/list', 'resources/read', 'resources/templates/list', 'tools/call', 'tools/list'])

class Refused extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

function refused(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error)
  const code = error instanceof Refused ? error.code : undefined
  const signIn = code === 401 || code === 403 || /needs the swarms:\w+ scope|invalid_token/.test(detail)
  return { content: [{ text: signIn ? `${detail}\nSign in with the swarms CLI first, or set SWARMS_TOKEN, so this tool runs as you.` : detail, type: 'text' as const }], isError: true }
}

function events(text: string) {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice('data:'.length).trimStart()).join('\n'))
    .filter((data) => data.length > 0)
}

function remote(options: Options) {
  const endpoint = `${options.url.replace(/\/+$/, '')}/mcp`
  const state: { id: number; session?: string; version?: string } = { id: 0 }
  const post = async (message: Rpc.Message, signal: AbortSignal) => {
    const headers: Record<string, string> = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }
    if (options.token) headers['authorization'] = `Bearer ${options.token}`
    if (state.session) headers['mcp-session-id'] = state.session
    if (state.version) headers['mcp-protocol-version'] = state.version
    const response = await fetch(endpoint, { body: JSON.stringify(message), headers, method: 'POST', signal })
    const session = response.headers.get('mcp-session-id')
    if (session) state.session = session
    const text = await response.text()
    if (response.status === Limits.Mcp.accepted) return undefined
    const type = response.headers.get('content-type') ?? ''
    const parsed = type.includes('text/event-stream') ? events(text).map(Rpc.parse).flatMap((each) => each?.messages ?? []) : (Rpc.parse(text)?.messages ?? [])
    const found = parsed.find((each) => each.id === message.id && each.method === undefined)
    if (!response.ok) throw new Refused(response.status, `Error POSTing to endpoint (HTTP ${response.status}): ${found?.error?.message ?? text}`)
    Rpc.assert(found, `The server answered no response to request ${String(message.id)}.`)
    return found
  }
  const request = async (method: string, params: Rpc.Params, signal: AbortSignal) => {
    state.id += 1
    const found = await post({ id: state.id, jsonrpc: '2.0', method, params }, signal)
    Rpc.assert(found, `The server accepted request ${method} without answering it.`)
    if (found.error) throw new Rpc.Failure(found.error.code, found.error.message)
    return found.result as Record<string, unknown>
  }
  const notify = (method: string, signal: AbortSignal) => post({ jsonrpc: '2.0', method }, signal)
  return { request, notify, state }
}

export async function serve(options: Options, local: Local = { input: process.stdin, output: process.stdout }) {
  const upstream = remote(options)
  const opened = AbortSignal.timeout(longest)
  const initialized = await upstream.request('initialize', { capabilities: {}, clientInfo: { name: 'swarms-cli', version: '1.0.0' }, protocolVersion: Rpc.versions[0] }, opened)
  upstream.state.version = Rpc.version(initialized['protocolVersion'])
  await upstream.notify('notifications/initialized', opened)
  const instructions = typeof initialized['instructions'] === 'string' ? initialized['instructions'] : undefined
  const info = initialized['serverInfo'] as { version?: unknown } | undefined
  const version = typeof info?.version === 'string' ? info.version : '1.0.0'
  const running = new Map<Rpc.Id, AbortController>()
  const write = (value: unknown) => void local.output.write(`${JSON.stringify(value)}\n`)

  const dispatch = async (method: string, params: Rpc.Params, signal: AbortSignal) => {
    if (method === 'initialize') return { protocolVersion: Rpc.version(params['protocolVersion']), capabilities: { resources: {}, tools: {} }, serverInfo: { name: 'swarms', version }, ...(instructions ? { instructions } : {}) }
    if (method === 'ping') return {}
    if (!forwarded.has(method)) throw new Rpc.Failure(Rpc.codes.method, 'Method not found')
    if (method !== 'tools/call') return upstream.request(method, params, signal)
    return upstream.request(method, params, AbortSignal.any([signal, AbortSignal.timeout(longest)])).catch(refused)
  }

  const answer = async (message: Rpc.Message & { id: Rpc.Id; method: string }) => {
    Rpc.assert(!running.has(message.id), `request ${String(message.id)} is answered once`)
    const controller = new AbortController()
    running.set(message.id, controller)
    try {
      write(Rpc.result(message.id, await dispatch(message.method, message.params ?? {}, controller.signal)))
    } catch (error) {
      write(Rpc.failure(message.id, error instanceof Rpc.Failure ? error.code : Rpc.codes.internal, error instanceof Error ? error.message : String(error)))
    } finally {
      running.delete(message.id)
    }
  }

  const receive = (line: string) => {
    if (line.trim().length === 0) return
    const parsed = line.length > Rpc.lineMost ? undefined : Rpc.parse(line)
    if (!parsed || parsed.batch) return write(Rpc.failure(null, Rpc.codes.parse, 'Parse error: Invalid JSON-RPC message'))
    for (const message of parsed.messages) {
      if (message.method === 'notifications/cancelled') running.get((message.params?.['requestId'] ?? null) as Rpc.Id)?.abort()
      if (Rpc.request(message)) void answer(message)
    }
  }

  const lines = readline.createInterface({ crlfDelay: Infinity, input: local.input })
  lines.on('line', receive)
  return {
    close: async () => {
      lines.close()
      for (const controller of running.values()) controller.abort()
    },
  }
}

export async function main(options: Options = { token: process.env['SWARMS_TOKEN'], url: process.env['SWARMS_URL'] ?? fallback }) {
  const served = await serve(options)
  const stop = () => void served.close().finally(() => process.exit(0))
  process.stdin.once('end', stop)
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

if (import.meta.main) await main()
