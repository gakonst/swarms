import * as Memo from '../shared/Memo.ts'

export function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
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
  return new Date(at).toISOString().slice(11, 16)
}

export function percent(share: number) {
  return `${Math.round(share * 1000) / 10}%`
}

export function same(a: string, b: string) {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  return left.length === right.length && crypto.subtle.timingSafeEqual(left, right)
}

