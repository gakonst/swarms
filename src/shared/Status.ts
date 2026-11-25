import type { Summary } from './Api.ts'

export type Word = 'Working' | 'Stuck' | 'Starting' | 'Needs money' | 'Not started' | 'Stopped'

export type Mood = 'live' | 'stuck' | 'money' | 'new'

export type Standing = { action: string | null; mood: Mood; word: Word }

export type Stood = Pick<Summary, 'balance' | 'remaining' | 'status'> & {
  archivedAt?: number | null | undefined
  inFlight?: number | undefined
  setup?: Summary['setup'] | undefined
  why?: Summary['why'] | undefined
  reason?: string | null | undefined
}

export const reasons = {
  broke: 'Out of money. Ride it to keep it going.',
  refused: 'Its last step could not be paid for, though it has money. It tries again by itself.',
  sponsor: "Waiting on Tempo, not on money: Tempo can't pay the network fee for its AI calls right now. It tries again by itself.",
  stalled: 'Its last turns made no progress. It tries again by itself.',
  unfunded: 'Nobody is riding it yet.',
} as const

export function failing(answer: number | string | null) {
  return answer === null ? 'Its AI calls keep failing. It tries again by itself.' : `Its AI calls keep failing (error ${answer}). It tries again by itself.`
}

const pills: Record<Word, string> = {
  'Needs money': 'Needs money',
  'Not started': 'No riders yet',
  Starting: 'Starting',
  Stopped: 'Archived',
  Stuck: 'Retrying',
  Working: 'Working now',
}

const lines: Record<Word, string> = {
  'Needs money': 'Out of money: ride it to keep it going.',
  'Not started': 'Ride it to get it started.',
  Starting: 'Getting back to work.',
  Stopped: 'Archived: nothing here runs or takes rides.',
  Stuck: 'Stalled: it hit a problem and tries again by itself.',
  Working: 'AI is working on it right now.',
}

const tags: Record<Word, string | null> = {
  'Needs money': 'needs money',
  'Not started': null,
  Starting: null,
  Stopped: 'archived',
  Stuck: 'retrying',
  Working: 'working now',
}

export function tag(word: Word) {
  return tags[word]
}

export function pill(word: Word) {
  return pills[word]
}

export function line(word: Word) {
  return lines[word]
}

export const fuel = 0.05

export function fueled(swarm: Pick<Summary, 'remaining'> & { setup?: Summary['setup'] | undefined }) {
  return Number(swarm.remaining) >= (swarm.setup ? Number(swarm.setup.most) / 1_000_000 : fuel)
}

export function refused(swarm: Stood) {
  return swarm.status === 'paused' && swarm.why === 'money' && fueled(swarm)
}

export function standing(swarm: Stood): Standing {
  if (swarm.archivedAt) return { action: null, mood: 'new', word: 'Stopped' }
  if ((swarm.inFlight ?? 0) > 0) return { action: null, mood: 'live', word: 'Working' }
  if (swarm.status === 'funding' && Number(swarm.balance) <= 0) return { action: 'Ride it to start it', mood: 'new', word: 'Not started' }
  if (!fueled(swarm) || swarm.why === 'unfunded' || (swarm.status === 'paused' && swarm.why === 'money' && swarm.reason === reasons.broke)) return { action: 'Ride it to keep it going', mood: 'money', word: 'Needs money' }
  if (swarm.why === 'money' || (swarm.status === 'running' && swarm.why === 'stuck')) return { action: null, mood: 'stuck', word: 'Stuck' }
  if (swarm.status === 'running') return { action: null, mood: 'live', word: 'Working' }
  return { action: null, mood: 'live', word: 'Starting' }
}

export function told(swarm: Stood) {
  const word = standing(swarm).word
  return (word === 'Needs money' || word === 'Stuck') && swarm.reason ? swarm.reason : line(word)
}

export function word(swarm: Stood): Word {
  return standing(swarm).word
}

export function live(swarm: Stood) {
  return word(swarm) === 'Working'
}

const tests = /operator test|fund flow check|model guard check|headless check|channel check|audit fixes check|second audit check|template check|settle check|start exactly two subagents|stop stays stopped|steer and stop check|branch budget check|channel open check|setup check|\bL3 reliability\b|\be2e test\b|^asdasd$/i

export function test(swarm: Pick<Summary, 'title'>) {
  return tests.test(swarm.title)
}

export function count(swarms: readonly Stood[]) {
  const running = swarms.filter(live).length
  return { open: swarms.length, running, text: running ? `${running} running` : `${swarms.length} open` }
}

export function lively(swarm: Stood & Pick<Summary, 'updatedAt'>, now: number) {
  const hours = Math.max(0, now - swarm.updatedAt) / 3_600_000
  return (live(swarm) ? 1_000 : 0) + (1 + Number(swarm.balance)) / (1 + hours / 24)
}

export function ranked<T extends Stood & Pick<Summary, 'createdAt' | 'updatedAt'>>(swarms: readonly T[], now: number) {
  return [...swarms].sort((a, b) => lively(b, now) - lively(a, now) || b.createdAt - a.createdAt)
}

export function ideas(count: number) {
  return `${count} idea${count === 1 ? '' : 's'} waiting`
}
