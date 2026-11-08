import type { Summary } from './Api.ts'

export type Word = 'Running' | 'Starting' | 'Needs money' | 'Not started'

export type Mood = 'live' | 'money' | 'new'

export type Standing = { action: string | null; mood: Mood; word: Word }

export type Stood = Pick<Summary, 'raised' | 'remaining' | 'status'> & { setup?: Summary['setup'] | undefined; why?: Summary['why'] | undefined }

const pills: Record<Word, string> = {
  'Needs money': 'Needs funding',
  'Not started': 'New idea',
  Running: 'Working now',
  Starting: 'Starting',
}

const lines: Record<Word, string> = {
  'Needs money': 'Out of money. Back it to keep it going.',
  'Not started': 'Back it to get it started.',
  Running: 'AI is working on it right now.',
  Starting: 'Getting back to work.',
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

export function standing(swarm: Stood): Standing {
  if (swarm.status === 'running') return { action: null, mood: 'live', word: 'Running' }
  if (swarm.status === 'funding' && Number(swarm.raised) <= 0) return { action: 'Back it to start it', mood: 'new', word: 'Not started' }
  if (swarm.why === 'money' || swarm.why === 'unfunded' || !fueled(swarm)) return { action: 'Back it to keep it going', mood: 'money', word: 'Needs money' }
  return { action: null, mood: 'live', word: 'Starting' }
}

export function word(swarm: Stood): Word {
  return standing(swarm).word
}

const tests = /operator test|headless check|channel check|audit fixes check|second audit check|template check|settle check|start exactly two subagents|stop stays stopped|steer and stop check|branch budget check|channel open check/i

export function test(swarm: Pick<Summary, 'title'>) {
  return tests.test(swarm.title)
}

export function count(swarms: readonly Pick<Summary, 'remaining' | 'status'>[]) {
  const open = swarms.filter((swarm) => swarm.status !== 'done')
  const running = open.filter((swarm) => swarm.status === 'running').length
  return { open: open.length, running, text: running ? `${running} running` : `${open.length} open` }
}

export function lively(swarm: Pick<Summary, 'raised' | 'status' | 'updatedAt'>, now: number) {
  const hours = Math.max(0, now - swarm.updatedAt) / 3_600_000
  return (swarm.status === 'running' ? 1_000 : 0) + (1 + Number(swarm.raised)) / (1 + hours / 24)
}

export function ranked<T extends Pick<Summary, 'createdAt' | 'raised' | 'status' | 'updatedAt'>>(swarms: readonly T[], now: number) {
  return [...swarms].sort((a, b) => lively(b, now) - lively(a, now) || b.createdAt - a.createdAt)
}

export function ideas(count: number) {
  return `${count} idea${count === 1 ? '' : 's'} waiting`
}
