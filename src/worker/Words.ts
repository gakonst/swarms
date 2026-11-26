import * as Memo from '../shared/Memo.ts'
import * as Limits from '../shared/Limits.ts'

export function short(address: string) {
  return `${address.slice(0, Limits.SharedMention.headChars)}…${address.slice(-Limits.SharedMention.tailChars)}`
}

export function trim(amount: string) {
  return amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

export function dollars(atomics: bigint) {
  return '$' + trim(Memo.decimal(atomics))
}

export function capital(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function clock(at: number) {
  return new Date(at).toISOString().slice(Limits.WorkerWords.isoTimeFrom, Limits.WorkerWords.isoTimeTo)
}

export function percent(share: number) {
  return `${Math.round(share * 1000) / Limits.WorkerWords.percentTenths}%`
}

export function same(a: string, b: string) {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  return left.length === right.length && crypto.subtle.timingSafeEqual(left, right)
}

