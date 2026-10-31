import { keccak256, stringToHex } from 'viem'

export const maxNote = 280

export function units(amount: string) {
  const text = amount.trim()
  const negative = text.startsWith('-')
  const [whole = '0', fraction = ''] = text.replace(/^-/, '').split('.')
  const value = BigInt(whole || '0') * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))
  return negative ? -value : value
}

export function decimal(atomics: bigint) {
  const sign = atomics < 0n ? '-' : ''
  const value = atomics < 0n ? -atomics : atomics
  return `${sign}${value / 1_000_000n}.${(value % 1_000_000n).toString().padStart(6, '0')}`
}

export function memo(swarm: string, note?: string | null) {
  const text = note?.trim()
  return keccak256(stringToHex(text ? `note:${swarm}:${text}` : `swarm:${swarm}`))
}
