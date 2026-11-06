import * as Memo from './Memo.ts'

export type Exchange = { answer: string; question: string }

export const maxQuestion = 4_000

export const maxAnswer = 20_000

export const maxThread = 20

export const perHour = 20

const collapsed = 'Collapsed /btw'

const requested = 'Artifact from /btw'

const instruction =
  'The user finished a /btw side conversation forked from this conversation. It ran separately while this thread continued, so its answers may reflect earlier context and any tool activity in it is not shown. Incorporate its relevant findings into the main task; do not repeat work it already settled unless current evidence contradicts it.'

const artifact =
  'The user asks, from a /btw side conversation forked from this conversation, for an artifact: publish one, or update the one that already covers this, so it shows what the side conversation asked about, with your real numbers. Then carry on with the main task.'

const earlier = 'Earlier questions and answers in this side conversation, for context:'

export function conversation(thread: readonly Exchange[]) {
  return thread.map((exchange) => `User:\n${exchange.question.trim()}\n\nAssistant:\n${exchange.answer.trim()}\n\n`).join('')
}

export function ask(thread: readonly Exchange[], question: string) {
  return thread.length ? `${earlier}\n<btw_conversation>\n${conversation(thread)}</btw_conversation>\n\n${question}` : question
}

export function note(thread: readonly Exchange[], asked = false) {
  const first = thread[0]?.question.trim().split('\n')[0]?.trim() ?? ''
  const full = `${asked ? requested : collapsed}: ${first}`
  return full.length > Memo.maxNote ? full.slice(0, Memo.maxNote - 1).trimEnd() + '…' : full
}

export function collapse(thread: readonly Exchange[], asked = false) {
  return `${note(thread, asked)}\n\n${asked ? artifact : instruction}\n\n<btw_conversation>\n${conversation(thread)}</btw_conversation>`
}

export function command(text: string) {
  const match = /^\/(btw|collapse|close)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return match ? { name: match[1] as 'btw' | 'close' | 'collapse', rest: (match[2] ?? '').trim() } : undefined
}
