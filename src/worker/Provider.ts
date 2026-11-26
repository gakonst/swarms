import type { Provider } from '../shared/Api.ts'
import * as Limits from '../shared/Limits.ts'
import { clip, redact } from '../shared/Trail.ts'

export type Found = { message: string; provider: Provider; spent: boolean }

export type Seen = Found & { count: number; tool: string }

export const guards = { pause: true }

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

function who(tool: string, text: string): Provider {
  if (/\be2b\b/i.test(text)) return 'e2b'
  if (/browserbase/i.test(text) || tool.startsWith('browser_')) return 'browserbase'
  return 'modal'
}

export function found(tool: string, text: string, failed: boolean): Found | undefined {
  if (!machine(tool)) return undefined
  const spent = limited.test(text)
  if (!spent && !(failed && upstream.test(text))) return undefined
  return { message: clip(redact(said(text).trim()), Limits.Provider.messageMost), provider: who(tool, text), spent }
}

export function next(held: Seen | undefined, tool: string, seen: Found): Seen {
  const same = held !== undefined && held.tool === tool && held.message === seen.message
  return { ...seen, count: same ? held.count + 1 : 1, tool }
}

export function decisive(held: Seen | undefined): held is Seen {
  return held !== undefined && guards.pause && (held.spent || held.count >= repeats)
}

export function later(tries: number) {
  return Math.min(Limits.Provider.firstMs * 2 ** Math.max(0, tries - 1), Limits.Provider.mostMs)
}
