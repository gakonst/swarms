import type { Provider } from '../shared/Api.ts'
import * as Limits from '../shared/Limits.ts'
import { clip, redact } from '../shared/Trail.ts'

export type Machine = Exclude<Provider, 'gateway'>

export type Asked = { gpu: boolean; provider: 'e2b' | 'modal' }

export type Found = { gpu: boolean; message: string; provider: Machine; spent: boolean }

export type Seen = Found & { count: number; tool: string }

export type Stalled = { count: number; message: string; tries: number }

export const guards = { attribute: true, gateway: true, gpu: true, pause: true, route: true }

export const repeats = Limits.Provider.repeats

const limited =
  /spend(ing)? limit|billing limit|over (its|the) (spend|budget)|exceeded (its|the) (spend|budget|quota)|quota exceeded|insufficient (credits|balance|funds)/i

const upstream =
  /upstream_failed|Compute provider error|"code":\s*"(unavailable|rate_limited|payment_required)"|\bHTTP (402|429|503)\b|\b(402|429|503) (Payment Required|Too Many Requests|Service Unavailable)\b|has no capacity/i

export function machine(tool: string) {
  return /^(compute|browser)_/.test(tool)
}

function said(text: string) {
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; error?: { message?: unknown } | unknown; message?: unknown }
    const error = typeof parsed.error === 'object' && parsed.error !== null ? (parsed.error as { message?: unknown }).message : parsed.error
    return [parsed.detail, error, parsed.message].find((value): value is string => typeof value === 'string') ?? text
  } catch {
    return text
  }
}

function input(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function given(value: unknown) {
  return value !== undefined && value !== null && value !== false && value !== '' && !(Array.isArray(value) && value.length === 0)
}

export function asked(args: unknown): Asked {
  const request = input(args)
  const gpu = given(request['gpu'])
  if (request['provider'] === 'e2b' || request['provider'] === 'modal') return { gpu, provider: request['provider'] }
  const region = request['region']
  const cpu = typeof request['cpu'] === 'number' ? request['cpu'] : 0
  const memory = typeof request['memory'] === 'number' ? request['memory'] : 0
  const modal =
    ['gpu', 'apt', 'pip', 'image', 'snapshot', 'volumes', 'idleTimeout', 'exitSnapshot', 'cpuMax', 'memoryMax'].some((field) => given(request[field])) ||
    (given(region) && region !== 'auto' && region !== 'any') ||
    cpu > Limits.Provider.e2bCpu ||
    memory > Limits.Provider.e2bMemory
  return { gpu, provider: modal ? 'modal' : 'e2b' }
}

function who(tool: string, text: string, request: Asked | undefined): Machine | undefined {
  if (!guards.attribute) return 'modal'
  if (/browserbase/i.test(text) || tool.startsWith('browser_')) return 'browserbase'
  if (/\be2b\b/i.test(text)) return 'e2b'
  if (/\bmodal\b|Compute provider error/i.test(text)) return 'modal'
  return request?.provider
}

export function found(tool: string, text: string, failed: boolean, request?: Asked): Found | undefined {
  if (!machine(tool)) return undefined
  const spent = limited.test(text)
  if (!spent && !(failed && upstream.test(text))) return undefined
  const provider = who(tool, text, request)
  if (!provider) return undefined
  const gpu = guards.gpu && provider === 'modal' && request?.gpu === true
  return { gpu, message: clip(redact(said(text).trim()), Limits.Provider.messageMost), provider, spent }
}

export function next(held: Seen | undefined, tool: string, seen: Found): Seen {
  const same = held !== undefined && held.tool === tool && held.provider === seen.provider && held.message === seen.message
  return { ...seen, count: same ? held.count + 1 : 1, tool }
}

export function avoidable(held: Pick<Found, 'gpu' | 'provider'>) {
  return guards.route && held.provider === 'modal' && !held.gpu
}

export function decisive(held: Seen | undefined): held is Seen {
  return held !== undefined && guards.pause && !avoidable(held) && (held.spent || held.count >= repeats)
}

export function reroute(held: Seen) {
  const { e2bCpu, e2bMemory } = Limits.Provider
  return `Modal is unavailable (${held.message}); retry with provider e2b. The E2B base template takes at most ${e2bCpu} cpu and ${e2bMemory} MiB; pass a larger E2B template as image with provider e2b for more. Install packages inside the sandbox with compute_exec (pip install, apt-get) instead of the pip and apt fields, and split work that needs more memory into steps that fit, writing each step to disk. Tell your subagents the same. Ask for Modal only for a GPU.`
}
export function later(tries: number) {
  return Math.min(Limits.Provider.firstMs * 2 ** Math.max(0, tries - 1), Limits.Provider.mostMs)
}

export function stalled(held: Stalled | undefined, text: string): Stalled {
  return { count: (held?.count ?? 0) + 1, message: clip(redact(said(text).trim()), Limits.Provider.messageMost), tries: held?.tries ?? 0 }
}

export function halted(held: Stalled) {
  return guards.gateway && (held.tries > 0 || held.count >= repeats)
}
