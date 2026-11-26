import { concat, keccak256, slice, stringToHex } from 'viem'
import * as Transfer from './Transfer.ts'
import * as Limits from './Limits.ts'

export const chainId = Limits.SharedCredit.chainId

export function backing(key: string) {
  return 'backing:' + key.toLowerCase()
}

export function app(swarm: string) {
  return `swarm-${swarm}`
}

export function tag(swarm: string, note?: string | null) {
  return slice(Transfer.memo(swarm, note), 0, Limits.SharedCredit.tagBytes)
}

export function memo(owner: string, swarm: string, note?: string | null) {
  return concat([
    slice(keccak256(stringToHex(`gateway:credit:${chainId}:${owner.toLowerCase()}:${app(swarm)}`)), 0, Limits.SharedCredit.tagBytes),
    tag(swarm, note),
  ])
}
