import type { Summary } from './Api.ts'

export type Word = 'Running' | 'Resting' | 'Needs money' | 'Not started' | 'Finished'

export const fuel = 0.05

export function fueled(swarm: Pick<Summary, 'remaining'>) {
  return Number(swarm.remaining) >= fuel
}

export function word(swarm: Pick<Summary, 'remaining' | 'status'>): Word {
  if (swarm.status === 'running') return 'Running'
  if (swarm.status === 'done') return 'Finished'
  if (!fueled(swarm)) return 'Needs money'
  return swarm.status === 'funding' ? 'Not started' : 'Resting'
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
