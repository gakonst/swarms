import { cash } from './Answer.ts'
import type { Failure, Summary, Waiting } from './Api.ts'
import { decimal } from './Memo.ts'

export type Word = 'Working' | 'Stuck' | 'Starting' | 'Needs money' | 'Not started' | 'Stopped'

export type Mood = 'live' | 'stuck' | 'money' | 'new'

export type Standing = { action: string | null; mood: Mood; word: Word }

export type Stood = Pick<Summary, 'balance' | 'remaining' | 'status'> & {
  archivedAt?: number | null | undefined
  inFlight?: number | undefined
  setup?: Summary['setup'] | undefined
  why?: Summary['why'] | undefined
  reason?: string | null | undefined
  failure?: Partial<Failure> | null | undefined
  waiting?: Waiting | null | undefined
}

export const reasons = {
  broke: 'Out of money. Ride it to keep it going.',
  refused: 'Its last step could not be paid for, though it has money. It tries again by itself.',
  sponsor: "Waiting on Tempo, not on money: Tempo can't pay the network fee for its AI calls right now. It tries again by itself.",
  stalled: 'Its last turns made no progress. It tries again by itself.',
  unfunded: 'Nobody is riding it yet.',
} as const

const before = {
  sponsor:
    "Waiting on the gateway's fee sponsor: the gateway cannot pay the network fee for its AI calls right now, though the swarm has money. It tries again by itself.",
} as const

export type Short = { left: string; needs?: string | undefined; remaining?: string | undefined }

function usd(atomics: bigint) {
  return cash(Number(decimal(atomics)))
}

export function short(money: Short) {
  const left = BigInt(money.left)
  const has = money.remaining === undefined ? left : BigInt(money.remaining)
  if (money.needs === undefined || has <= 0n) return reasons.broke
  const needs = usd(BigInt(money.needs))
  if (has < BigInt(money.needs)) return `Needs more money: it has ${usd(has)} left, and its next step can cost up to ${needs}. Ride it to keep it going.`
  return `Capped by approvals: it still has ${usd(has)}, but its riders' approvals at the gateway let it spend only ${usd(left > 0n ? left : 0n)} now, and its next step can cost up to ${needs}. A rider raising their approval or a new ride wakes it.`
}

export const guards = { live: true }

export function restated(reason: string | null, live: { needs: bigint; remaining: bigint }) {
  if (reason !== reasons.broke || !guards.live || live.remaining <= 0n) return reason
  if (live.remaining < live.needs) return short({ left: String(live.remaining), needs: String(live.needs), remaining: String(live.remaining) })
  return `Capped by approvals: it still has ${usd(live.remaining)}, but its riders' approvals at the gateway let it spend less than its next step can cost, up to ${usd(live.needs)}. A rider raising their approval or a new ride wakes it.`
}

export function starved(reason: string | null | undefined) {
  return !!reason && (reason === reasons.broke || /^(Needs more money|Capped by approvals): /.test(reason))
}

export function sponsorless(message: string | null | undefined) {
  return !!message && message.includes('cannot pay the network fee') && message.includes('fee sponsor is out of funds')
}

export function waiting(swarm: Stood): Waiting | null {
  if (swarm.why !== 'money' && swarm.why !== 'stuck') return null
  if (swarm.waiting) return swarm.waiting
  return sponsorless(swarm.failure?.message) || swarm.reason === reasons.sponsor || swarm.reason === before.sponsor ? 'tempo' : null
}

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
  'Needs money': 'Needs more money for its next step: ride it to keep it going.',
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

export function tagged(swarm: Stood, word = standing(swarm).word) {
  return word === 'Stuck' && waiting(swarm) ? 'waiting on Tempo' : tag(word)
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
  if (swarm.archivedAt || swarm.status === 'archived') return { action: null, mood: 'new', word: 'Stopped' }
  if ((swarm.inFlight ?? 0) > 0) return { action: null, mood: 'live', word: 'Working' }
  if (swarm.status === 'funding' && Number(swarm.balance) <= 0) return { action: 'Ride it to start it', mood: 'new', word: 'Not started' }
  if (!fueled(swarm) || swarm.why === 'unfunded' || (swarm.status === 'paused' && swarm.why === 'money' && starved(swarm.reason)))
    return { action: 'Ride it to keep it going', mood: 'money', word: 'Needs money' }
  if (swarm.why === 'money' || (swarm.status === 'running' && swarm.why === 'stuck')) return { action: null, mood: 'stuck', word: 'Stuck' }
  if (swarm.status === 'running') return { action: null, mood: 'live', word: 'Working' }
  return { action: null, mood: 'live', word: 'Starting' }
}

export function told(swarm: Stood) {
  const word = standing(swarm).word
  if (word === 'Stuck' && waiting(swarm)) return reasons.sponsor
  return (word === 'Needs money' || word === 'Stuck') && swarm.reason ? swarm.reason : line(word)
}

export function badge(swarm: Stood, word = standing(swarm).word) {
  return word === 'Stuck' && waiting(swarm) ? 'Waiting on Tempo' : pill(word)
}

export function word(swarm: Stood): Word {
  return standing(swarm).word
}

export function live(swarm: Stood) {
  return word(swarm) === 'Working'
}

const tests =
  /operator test|fund flow check|model guard check|headless check|channel check|audit fixes check|second audit check|template check|settle check|start exactly two subagents|stop stays stopped|steer and stop check|branch budget check|channel open check|setup check|\bL3 reliability\b|\be2e test\b|^asdasd$/i

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
