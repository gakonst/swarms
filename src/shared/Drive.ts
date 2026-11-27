import type { Plan } from './Api.ts'
import * as Limits from './Limits.ts'

export type Halt =
  | { from: 'backoff' | 'reset' | 'retry-after'; plan: Plan; tries: number; until: number; why: 'limited' }
  | { plan: Plan; why: 'revoked' }
  | { why: 'met' }
  | { cap: number; turns: number; why: 'capped' }
  | { misses: number; question: string; why: 'stuck' }

export type Source = 'plan' | 'credit'

export const itemStates = ['open', 'flying', 'done', 'dead'] as const

export type ItemState = (typeof itemStates)[number]

export type Origin = 'human' | 'lead'

export type Item = { at: number; id: number; message: number | null; source: Origin; state: ItemState; title: string; turn: number | null; why: string | null }

export type State = 'planning' | 'driving' | 'paused'

export type Board = {
  cap: number | null
  counts: Record<ItemState, number>
  halt: Halt | null
  items: Item[]
  plan: Plan | null
  root: number
  source: Source | null
  state: State
  turns: number
}

export type Mood = 'live' | 'money' | 'stuck' | 'done'

export const node = 'board'

const named: Record<Plan, string> = { antigravity: 'Antigravity', claude: 'Claude', codex: 'ChatGPT' }

export const connect = 'Connect your Antigravity'

export const ownAi = '/me/ai'

export function planName(plan: Plan) {
  return named[plan]
}

export function pill(board: Pick<Board, 'halt' | 'state'>): { mood: Mood; text: string } {
  const halt = board.halt
  if (!halt) return board.state === 'planning' ? { mood: 'live', text: 'Planning' } : { mood: 'live', text: 'Driving' }
  switch (halt.why) {
    case 'limited':
      return { mood: 'money', text: 'Plan rate limit' }
    case 'revoked':
      return { mood: 'stuck', text: halt.plan === 'antigravity' ? connect : 'Plan signed out' }
    case 'met':
      return { mood: 'done', text: 'Goal met' }
    case 'capped':
      return { mood: 'money', text: 'Cap reached' }
    case 'stuck':
      return { mood: 'stuck', text: 'Stuck' }
  }
}

export function reason(halt: Halt): string {
  switch (halt.why) {
    case 'limited':
      return `Paused: the creator's ${planName(halt.plan)} plan hit its rate limit. It resumes by itself at ${new Date(halt.until).toISOString().slice(Limits.SharedDrive.clockFrom, Limits.SharedDrive.clockTo)} UTC${halt.from === 'backoff' ? ', a backoff since the provider named no reset' : ''}.`
    case 'revoked':
      if (halt.plan === 'antigravity')
        return `Paused: this swarm runs only on its creator's Antigravity plan, and none is connected. It starts again on the plan within ${Limits.Drive.revokedReadMs / Limits.SharedDrive.minuteMs} minutes of [connecting it on ${ownAi}](${ownAi}), and never runs on credit.`
      return `Paused: the creator's ${planName(halt.plan)} plan is signed out. Reconnect it on /me/ai, or ride the swarm so it runs on credit.`
    case 'met':
      return 'Paused: the lead says the goal is met. Add an item in this thread to keep going.'
    case 'capped':
      return `Paused at the creator's cap of ${halt.cap} turns. The creator raises the cap to keep going.`
    case 'stuck':
      return halt.question
  }
}

export function plain(text: string) {
  return text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
}

export function connects(halt: Halt | null) {
  return halt?.why === 'revoked' && halt.plan === 'antigravity'
}

export function open(state: ItemState) {
  return state === 'open' || state === 'flying'
}
