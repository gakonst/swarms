import { createHash } from 'node:crypto'
import { registerHooks } from 'node:module'

export type Violation = { detail: string; invariant: string }

export type Outcome = { steps: number; violations: Violation[] }

export type Canary = { flip: () => () => void; invariant: string; name: string; scenario: string; seeds: string[] }

export type Mutant = { file: string; from: string; to: string }

export const limits = { start: Date.UTC(2027, 0, 4, 9), violations: 20 }

export type Rng = {
  chance: (p: number) => boolean
  int: (lo: number, hi: number) => number
  next: () => number
  pick: <T>(items: readonly T[]) => T
  shuffle: <T>(items: readonly T[]) => T[]
}

export function rng(...parts: (number | string)[]): Rng {
  const digest = createHash('sha256').update(parts.join(':')).digest()
  let a = digest.readUInt32LE(0)
  let b = digest.readUInt32LE(4)
  let c = digest.readUInt32LE(8)
  let d = digest.readUInt32LE(12)
  const next = () => {
    const t = (((a + b) >>> 0) + d) >>> 0
    d = (d + 1) >>> 0
    a = (b ^ (b >>> 9)) >>> 0
    b = (c + (c << 3)) >>> 0
    c = ((c << 21) | (c >>> 11)) >>> 0
    c = (c + t) >>> 0
    return t / 4294967296
  }
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  return {
    chance: (p) => next() < p,
    int,
    next,
    pick: (items) => items[Math.floor(next() * items.length)] as never,
    shuffle: (items) => {
      const out = [...items]
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i)
        ;[out[i], out[j]] = [out[j] as never, out[i] as never]
      }
      return out
    },
  }
}

export function recorder() {
  const violations: Violation[] = []
  const fail = (invariant: string, detail: string) => {
    if (violations.length < limits.violations) violations.push({ detail, invariant })
  }
  const same = (invariant: string, what: string, got: unknown, want: unknown) => {
    const a = JSON.stringify(got)
    const b = JSON.stringify(want)
    if (a !== b) fail(invariant, what + ': got ' + String(a).slice(0, 300) + ', want ' + String(b).slice(0, 300))
  }
  return { fail, same, violations }
}

const real = {
  error: console.error,
  info: console.info,
  log: console.log,
  now: Date.now,
  random: Math.random,
  uuid: crypto.randomUUID.bind(crypto),
  warn: console.warn,
}

export function pin(random: Rng, start = limits.start) {
  Date.now = () => start
  Math.random = () => random.next()
  crypto.randomUUID = () => {
    const hex = Array.from({ length: 32 }, () => Math.floor(random.next() * 16).toString(16)).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}` as ReturnType<Crypto['randomUUID']>
  }
  console.error = () => undefined
  console.info = () => undefined
  console.log = () => undefined
  console.warn = () => undefined
  return () => {
    console.info = real.info
    console.log = real.log
    console.warn = real.warn
    Date.now = real.now
    Math.random = real.random
    crypto.randomUUID = real.uuid
    console.error = real.error
  }
}

const root = new URL('../../', import.meta.url).href

const active: { mutant: Mutant | null; name: string; applied: boolean } = { applied: false, mutant: null, name: '' }

let hooked = false

function hook() {
  if (hooked) return
  hooked = true
  registerHooks({
    resolve: (specifier, context, next) => {
      const parent = context.parentURL ?? ''
      const tag = parent.startsWith(root) && parent.includes('?mh=') ? parent.slice(parent.indexOf('?mh=')) : ''
      if (!tag) return next(specifier, context)
      const plain = parent.slice(0, parent.indexOf('?mh='))
      if (specifier === './Host.ts' && plain.endsWith('/src/worker/Swarm.ts')) return { shortCircuit: true, url: new URL('test/board.ts', root).href }
      const found = next(specifier, { ...context, parentURL: plain })
      const url = found.url.split('?')[0] ?? ''
      return url.startsWith(root) && !url.includes('/node_modules/') && url.endsWith('.ts') ? { ...found, url: url + tag } : found
    },
    load: (url, context, next) => {
      const loaded = next(url, context)
      const mutant = active.mutant
      if (!mutant || !url.includes('?mh=' + active.name) || (url.split('?')[0] ?? '') !== new URL(mutant.file, root).href) return loaded
      const text = String(loaded.source)
      if (!text.includes(mutant.from)) throw new Error('Mutant ' + active.name + ' no longer matches ' + mutant.file)
      active.applied = true
      return { ...loaded, source: text.replace(mutant.from, mutant.to) }
    },
  })
}

export function mutant(name: string, file: string, from: string, to: string) {
  return () => {
    active.mutant = { file, from, to }
    active.name = name
    active.applied = false
    return () => {
      active.mutant = null
      active.name = ''
    }
  }
}

export async function load<T>(path: string): Promise<T> {
  const url = new URL(path, root).href
  if (!active.mutant) return (await import(url)) as T
  hook()
  return (await import(url + '?mh=' + active.name)) as T
}

export function applied() {
  if (active.mutant && !active.applied) throw new Error('Mutant ' + active.name + ' was not loaded')
}
