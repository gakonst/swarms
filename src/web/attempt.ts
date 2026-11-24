export type Attempt = { at: 'idle' } | { at: 'busy' } | { at: 'failed'; error: string }

export const idle: Attempt = { at: 'idle' }

export function start(now: Attempt): Attempt | undefined {
  return now.at === 'busy' ? undefined : { at: 'busy' }
}

export function settle(now: Attempt): Attempt {
  return now.at === 'busy' ? idle : now
}

export function fail(now: Attempt, error: string): Attempt {
  return now.at === 'busy' ? { at: 'failed', error } : now
}

export function busy(now: Attempt) {
  return now.at === 'busy'
}

export function error(now: Attempt) {
  return now.at === 'failed' ? now.error : undefined
}
