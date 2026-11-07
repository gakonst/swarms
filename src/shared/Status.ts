import type { Summary } from './Api.ts'

export type Word = 'Running' | 'Starting' | 'Resting' | 'Stopped after errors' | 'Needs money' | 'Not started'

export type Mood = 'live' | 'money' | 'resting' | 'errors' | 'new'

export type Standing = { action: string | null; mood: Mood; word: Word }

export type Stood = Pick<Summary, 'raised' | 'remaining' | 'status'> & { why?: Summary['why'] | undefined }

export const fuel = 0.05

export function fueled(swarm: Pick<Summary, 'remaining'>) {
  return Number(swarm.remaining) >= fuel
}

export function standing(swarm: Stood): Standing {
  if (swarm.status === 'running') return { action: null, mood: 'live', word: 'Running' }
  if (swarm.status === 'funding' && Number(swarm.raised) <= 0) return { action: 'Fund $2 to start it', mood: 'new', word: 'Not started' }
  if (swarm.status === 'funding' && !swarm.why) return { action: null, mood: 'live', word: 'Starting' }
  if (swarm.why === 'idle') return { action: null, mood: 'resting', word: 'Resting' }
  if (swarm.why === 'rest') return { action: null, mood: 'errors', word: 'Stopped after errors' }
  if (swarm.status === 'funding') return { action: 'Add $2 to start it', mood: 'money', word: 'Not started' }
  if (!swarm.why && fueled(swarm)) return { action: null, mood: 'resting', word: 'Resting' }
  return { action: 'Add $2 to wake it', mood: 'money', word: 'Needs money' }
}

export function word(swarm: Stood): Word {
  return standing(swarm).word
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
