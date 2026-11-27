import * as Limits from './Limits.ts'

export function units(amount: string) {
  const text = amount.trim()
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = text.replace(/^-/, '').split('.')
  const value = BigInt(whole || '0') * Limits.SharedMemo.unit + BigInt(fraction.padEnd(Limits.SharedMemo.decimals, '0').slice(0, Limits.SharedMemo.decimals))
  return negative ? -value : value
}

export function decimal(atomics: bigint) {
  const sign = atomics < 0n ? '-' : ''
  const value = atomics < 0n ? -atomics : atomics
  return `${sign}${value / Limits.SharedMemo.unit}.${(value % Limits.SharedMemo.unit).toString().padStart(Limits.SharedMemo.decimals, '0')}`
}
