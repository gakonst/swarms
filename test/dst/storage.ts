import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Snapshot } from '../../src/shared/Api.ts'
import * as Storage from '../../src/worker/Storage.ts'

type Violation = { detail: string; invariant: string }

const limits = { commits: 30, files: 40, steps: 4000, violations: 20 }

function rng(...parts: string[]) {
  const digest = createHash('sha256').update(parts.join(':')).digest()
  let state = digest.readUInt32LE(0)
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    chance: (p: number) => next() < p,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(items: readonly T[]) => items[Math.floor(next() * items.length)] as T,
  }
}

const treasury = JSON.stringify({
  code: 'unavailable',
  detail: "The gateway's treasury cannot cover Code Storage now, and this caller cannot pay it directly.",
  status: 503,
})

const others = [
  { body: JSON.stringify({ commits: [] }), status: 200 },
  { body: JSON.stringify({ code: 'not_found', detail: 'No such file.', status: 404 }), status: 404 },
  { body: JSON.stringify({ code: 'unavailable', detail: 'The storage backend is down.', status: 503 }), status: 503 },
  { body: 'upstream connect error', status: 503 },
  { body: JSON.stringify({ code: 'over_limit', detail: 'Too many reads.', status: 429 }), status: 429 },
]

async function storage(seed: string) {
  const random = rng(seed, 'storage')
  const violations: Violation[] = []
  const fail = (invariant: string, detail: string) => {
    if (violations.length < limits.violations) violations.push({ detail, invariant })
  }
  let steps = 0
  for (; steps < limits.steps; steps++) {
    const commits = Array.from({ length: random.int(0, limits.commits) }, (_, index) => ({
      date: null,
      message: 'c' + index,
      sha: createHash('sha1')
        .update(seed + ':' + steps + ':' + index)
        .digest('hex'),
    }))
    const files = Array.from({ length: random.int(0, limits.files) }, (_, index) => 'src/f' + index + '.ts')
    const readme = random.chance(0.5) ? { path: 'README.md', text: 'hello ' + steps } : null
    const snapshot: Snapshot | null = random.chance(0.5)
      ? { at: steps, commits, diff: random.chance(0.5) ? [] : null, files: readme ? [readme.path, ...files] : files, name: 'repo', readme }
      : null
    const read = random.pick(['diff', 'files', 'log', 'read'] as const)
    const ref = random.pick(['main', commits[0]?.sha ?? 'main', 'feature', '0'.repeat(40)])
    const query = new URLSearchParams({
      ref,
      ...(read === 'log' ? { limit: String(random.pick([1, 20, 50, -1])) } : {}),
      ...(read === 'read' ? { path: random.pick(['README.md', 'src/f0.ts']) } : {}),
    })
    const unpaid = random.chance(0.5)
    const upstream = unpaid ? { body: treasury, status: 503 } : random.pick(others)
    const answered = Storage.degraded(read, query, snapshot, upstream.status, upstream.body)
    const at = `step ${steps} ${read}?${query} snapshot=${snapshot ? 'yes' : 'no'}`
    if (!unpaid) {
      if (answered) fail('passthrough', at + ' degraded a non-treasury answer ' + upstream.status)
      continue
    }
    if (!answered) {
      fail('treasury never fails', at + ' passed the treasury 503 through')
      continue
    }
    const covers = !!snapshot && ref === 'main' && (read === 'log' || read === 'files')
    if (covers && !answered.snapshot) fail('snapshot first', at + ' answered the empty state though the snapshot covers it')
    if (covers && read === 'files' && !isDeepStrictEqual(answered.body, { files: snapshot.files.map((path) => ({ path, type: 'blob' })) }))
      fail('snapshot first', at + ' files differ from the snapshot')
    if (
      covers &&
      read === 'log' &&
      !isDeepStrictEqual(
        (answered.body as { commits: unknown[] }).commits,
        snapshot.commits.slice(0, Math.max(0, Number(query.get('limit'))) || snapshot.commits.length),
      )
    )
      fail('snapshot first', at + ' log differs from the snapshot')
    if (!answered.snapshot && !isDeepStrictEqual(answered.body, Storage.unavailable()))
      fail('empty state', at + ' answered ' + JSON.stringify(answered.body).slice(0, 80))
  }
  return { steps, violations }
}

export const scenarios: Record<string, (seed: string) => Promise<{ steps: number; violations: Violation[] }>> = { storage }

function flag(key: keyof typeof Storage.guards) {
  return () => {
    Storage.guards[key] = false
    return () => {
      Storage.guards[key] = true
    }
  }
}

export const canaries = [
  { flip: flag('degrade'), invariant: 'treasury never fails', name: 'storage.degrade', scenario: 'storage', seeds: ['1', '2', '3'] },
  { flip: flag('snapshot'), invariant: 'snapshot first', name: 'storage.snapshot', scenario: 'storage', seeds: ['1', '2', '3'] },
]
