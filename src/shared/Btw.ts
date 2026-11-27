import * as Limits from './Limits.ts'

export type Exchange = { answer: string; question: string }

export const maxQuestion = Limits.SharedBtw.maxQuestion

export const maxAnswer = Limits.SharedBtw.maxAnswer

export const maxThread = Limits.SharedBtw.maxThread

export const perHour = Limits.SharedBtw.perHour

export const perSwarmHour = Limits.SharedBtw.perSwarmHour

export const maxThreadBytes = Limits.SharedBtw.maxThreadBytes

export const maxMessageBytes = Limits.SharedBtw.maxMessageBytes

export function bytes(text: string) {
  return new TextEncoder().encode(text).length
}

export function size(thread: readonly Exchange[]) {
  return thread.reduce((sum, exchange) => sum + bytes(exchange.question) + bytes(exchange.answer), 0)
}

export function fit(thread: readonly Exchange[]) {
  const kept = [...thread].slice(-maxThread)
  while (kept.length > 1 && size(kept) > maxThreadBytes) kept.shift()
  return kept
}

const collapsed = 'Collapsed /btw'

const requested = 'Artifact from /btw'

const instruction =
  'The user finished a /btw side conversation forked from this conversation. It ran separately while this thread continued, so its answers may reflect earlier context and any tool activity in it is not shown. Incorporate its relevant findings into the main task; do not repeat work it already settled unless current evidence contradicts it.'

const artifact =
  'The user asks, from a /btw side conversation forked from this conversation, for an artifact: publish one, or update the one that already covers this, so it shows what the side conversation asked about, with your real numbers. Then carry on with the main task.'

const earlier = 'Earlier questions and answers in this side conversation, for context:'

function inert(text: string) {
  return text.trim().replace(/<(\/?)btw_conversation>/gi, '‹$1btw_conversation›')
}

export function conversation(thread: readonly Exchange[]) {
  return thread.map((exchange) => `User:\n${inert(exchange.question)}\n\nAssistant:\n${inert(exchange.answer)}\n\n`).join('')
}

export async function seal(exchange: Exchange) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${exchange.question.trim()}\u0000${exchange.answer.trim()}`))
  return Array.from(new Uint8Array(digest).slice(0, Limits.SharedBtw.idBytes), (byte) => byte.toString(Limits.SharedBtw.hexRadix).padStart(2, '0')).join('')
}

export function ask(thread: readonly Exchange[], question: string) {
  return thread.length ? `${earlier}\n<btw_conversation>\n${conversation(thread)}</btw_conversation>\n\n${question}` : question
}

export function note(thread: readonly Exchange[], asked = false) {
  const first = thread[0]?.question.trim().split('\n')[0]?.trim() ?? ''
  return `${asked ? requested : collapsed}: ${first}`
}

export function collapse(thread: readonly Exchange[], asked = false) {
  return `${note(thread, asked)}\n\n${asked ? artifact : instruction}\n\n<btw_conversation>\n${conversation(thread)}</btw_conversation>`
}

export function command(text: string) {
  const match = /^\/(btw|collapse|close)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return match ? { name: match[1] as 'btw' | 'close' | 'collapse', rest: (match[2] ?? '').trim() } : undefined
}
