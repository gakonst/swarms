import * as Limits from './Limits.ts'

export const bodyMost = Limits.Mcp.bodyBytes
export const batchMost = Limits.Mcp.batchMost
export const nameMost = Limits.Mcp.nameMost
export const lineMost = Limits.Mcp.lineBytes

export const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05', '2024-10-07'] as const

export const codes = Limits.JsonRpc

export type Id = string | number | null

export type Params = Record<string, unknown>

export type Problem = { code: number; data?: unknown; message: string }

export type Message = { error?: Problem; id?: Id; jsonrpc: '2.0'; method?: string; params?: Params; result?: unknown }

export type Parsed = { batch: boolean; messages: Message[] }

export class Failure extends Error {
  readonly code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export function version(asked: unknown): string {
  const found = versions.find((each) => each === asked)
  return found ?? versions[0]
}

export function result(id: Id, value: unknown) {
  return { result: value, jsonrpc: '2.0' as const, id }
}

export function failure(id: Id, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0' as const, id, error: data === undefined ? { code, message } : { code, data, message } }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function valid(value: unknown): value is Message {
  if (!record(value) || value['jsonrpc'] !== '2.0') return false
  const id = value['id']
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') return false
  if (value['method'] !== undefined && typeof value['method'] !== 'string') return false
  if (value['params'] !== undefined && !record(value['params'])) return false
  return value['method'] !== undefined || 'result' in value || 'error' in value
}

export function messages(body: unknown): Parsed | undefined {
  const batch = Array.isArray(body)
  const list: unknown[] = batch ? body : [body]
  if (list.length === 0 || list.length > batchMost) return undefined
  if (!list.every(valid)) return undefined
  return { batch, messages: list }
}

export function parse(text: string): Parsed | undefined {
  try {
    return messages(JSON.parse(text))
  } catch {
    return undefined
  }
}

export function request(message: Message): message is Message & { id: Id; method: string } {
  return message.method !== undefined && message.id !== undefined
}
