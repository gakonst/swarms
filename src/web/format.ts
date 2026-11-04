import { boot } from './boot.ts'
import type { Currency } from '../shared/Api.ts'
import { decimal, units } from '../shared/Memo.ts'

export const symbols = { mach: 'MACH', ousd: 'OUSD', pathusd: 'pathUSD', usdce: 'USDC.e' } as const satisfies Record<Currency, string>

export function mach(value: string) {
  const atomics = units(value)
  const sign = atomics < 0n ? '-' : ''
  const size = atomics < 0n ? -atomics : atomics
  if (size >= 995_000n || size === 0n) {
    const cents = (size + 5_000n) / 10_000n
    return `${sign}${(cents / 100n).toLocaleString('en-US')}.${String(cents % 100n).padStart(2, '0')}`
  }
  const step = 10n ** BigInt(Math.max(0, String(size).length - 2))
  const rounded = ((size + step / 2n) / step) * step
  const fraction = decimal(rounded).split('.')[1] ?? ''
  const digits = Math.max(2, fraction.replace(/0+$/, '').length)
  return `${sign}0.${fraction.slice(0, digits)}`
}

export function usd(value: string) {
  return `$${mach(value)}`
}

export function money(value: string, token: Currency) {
  return `${mach(value)} ${symbols[token]}`
}

export function ratio(part: string, whole: string) {
  const total = units(whole)
  if (total <= 0n) return 0
  return Math.min(1, Number((units(part) * 10_000n) / total) / 10_000)
}

export function percent(share: number) {
  const value = share * 100
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

export function short(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

export function ago(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86_400)} d ago`
}

export function duration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
}

export function clock(at: number) {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: zone() })
}

export function minute(at: number) {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: zone() })
}

export function stamp(at: number) {
  return new Date(at).toLocaleString('en-GB', { day: 'numeric', hour: '2-digit', minute: '2-digit', month: 'short', timeZone: zone(), year: 'numeric' })
}

function zone() {
  const current = boot()
  return current ? (current.zone ?? 'UTC') : undefined
}
