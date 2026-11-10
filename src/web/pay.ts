import * as Api from './api.ts'
import { message } from './hooks.ts'

export type Owed = { amount: string; hash: string; note: string; swarm: string }

export type Counted = { at: 'counted'; hash: string } | { at: 'later' } | { at: 'refused'; reason: string }

export function code(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined
}

function refuses(error: unknown) {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 0
  return status >= 400 && status < 500 && status !== 404 && status !== 408 && status !== 429
}

export async function count(owed: Owed): Promise<Counted> {
  for (let attempt = 0; ; attempt++) {
    try {
      return { at: 'counted', hash: (await Api.contribute(owed.swarm, { hash: owed.hash, ...(owed.note ? { note: owed.note } : {}) })).contribution.hash ?? owed.hash }
    } catch (error) {
      if (code(error) === 'conflict') return { at: 'counted', hash: owed.hash }
      if (attempt < 3 && code(error) === 'not_found') {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        continue
      }
      return refuses(error) ? { at: 'refused', reason: message(error) } : { at: 'later' }
    }
  }
}
