import * as fs from 'node:fs'
import * as url from 'node:url'

export const scope = 'board-swarm'

export const root = 'goal'

/** Board actors are kind:name principals; every process in the swarm is an agent. */
export function actor(name: string) {
  return `agent:${name}`
}

/** The worker an actor names, such as w2 for agent:w2; a finished or failed task's worker is who finished it. */
export function named(actor: string | undefined) {
  return actor === undefined ? null : actor.replace(/^agent:/, '')
}

export type Fields = { worker: string; event: string; task?: string; [field: string]: unknown }

export type Event = Fields & { atMs: number }

export function emit(event: Fields) {
  process.stdout.write(JSON.stringify({ atMs: Date.now(), ...event }) + '\n')
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function terminal(phase: string) {
  return phase === 'done' || phase === 'failed' || phase === 'cancelled'
}

export function text(outcome: unknown): string {
  if (outcome === undefined || outcome === null) return ''
  if (typeof outcome === 'string') return outcome
  if (typeof outcome === 'object') {
    const value = outcome as Record<string, unknown>
    const inner = value['done'] ?? value['failed'] ?? value['reason'] ?? value['note']
    if (typeof inner === 'string') return inner
  }
  return JSON.stringify(outcome)
}

export function env(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

/** The nanocode wasm module the package ships, which the optional agent turn runs on. */
export function module(): Promise<WebAssembly.Module> {
  return WebAssembly.compile(fs.readFileSync(url.fileURLToPath(import.meta.resolve('nanocode-ts/nanocode_wasm.wasm'))))
}

/** The board-only wasm module, which is all a board needs. */
export function board(): Promise<WebAssembly.Module> {
  return WebAssembly.compile(fs.readFileSync(url.fileURLToPath(import.meta.resolve('nanocode-ts/nanocode_board.wasm'))))
}
