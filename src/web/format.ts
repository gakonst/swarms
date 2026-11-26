import { boot } from './boot.ts'
import type { Currency } from '../shared/Api.ts'
import { Money } from '../shared/Limits.ts'
import { decimal, units } from '../shared/Memo.ts'
import * as Limits from '../shared/Limits.ts'

export const symbols = { mach: 'MACH', ousd: 'OUSD', pathusd: 'pathUSD', usdce: 'USDC.e' } as const satisfies Record<Currency, string>

export function mach(value: string) {
  const atomics = units(value)
  const sign = atomics < 0n ? '-' : ''
  const size = atomics < 0n ? -atomics : atomics
  if (size >= Limits.WebFormat.wholeLeastUnits || size === 0n) {
    const cents = (size + Limits.WebFormat.halfCentUnits) / Limits.WebFormat.centUnits
    return `${sign}${(cents / Limits.WebFormat.centsPerDollar).toLocaleString('en-US')}.${String(cents % Limits.WebFormat.centsPerDollar).padStart(2, '0')}`
  }
  const step = Limits.WebFormat.decimalBase ** BigInt(Math.max(0, String(size).length - 2))
  const rounded = ((size + step / 2n) / step) * step
  const fraction = decimal(rounded).split('.')[1] ?? ''
  const digits = Math.max(2, fraction.replace(/0+$/, '').length)
  return `${sign}0.${fraction.slice(0, digits)}`
}

export function usd(value: string) {
  return `$${mach(value)}`
}

export function spent(value: string) {
  const amount = Number(value)
  return amount > 0 && amount < Money.cent ? '<$0.01' : usd(value)
}

export function money(value: string, token: Currency) {
  return `${mach(value)} ${symbols[token]}`
}

export function percent(share: number) {
  const value = share * Limits.Web.percent
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`
}

export function short(value: string) {
  return `${value.slice(0, Limits.SharedMention.headChars)}…${value.slice(-Limits.SharedMention.tailChars)}`
}

export function signed(account: { name: string | null } | undefined, address: string, email?: string) {
  return account?.name ? `@${account.name}` : (email ?? short(address))
}

export function ago(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < Limits.WebFormat.justNowSeconds) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < Limits.WebFormat.daySeconds) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / Limits.WebFormat.daySeconds)} d ago`
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

export function day(at: number, now: number) {
  const key = (time: number) => new Date(time).toLocaleDateString('en-CA', { timeZone: zone() })
  if (key(at) === key(now)) return 'Today'
  if (key(at) === key(now - Limits.Clock.dayMs)) return 'Yesterday'
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: zone(), ...(new Date(at).getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) })
}

function zone() {
  const current = boot()
  return current ? (current.zone ?? 'UTC') : undefined
}
