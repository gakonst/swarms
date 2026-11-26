// The real nanocode-ts Board for tests, over nanocode-ts/node's SQLite on
// temporary files. Swarm.ts opens its boards here instead of in Host.ts (see
// host.ts): one file per Durable Object storage, so a swarm that starts again
// over the same storage finds its board where its last life left it.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Board } from 'nanocode-ts'
import { Sql } from 'nanocode-ts/node'
import * as Work from '../src/worker/Work.ts'

export const module = await (WebAssembly as unknown as { compile(bytes: Uint8Array): Promise<WebAssembly.Module> }).compile(readFileSync(createRequire(import.meta.url).resolve('nanocode-ts/nanocode_wasm.wasm')))

const directory = mkdtempSync(join(tmpdir(), 'swarms-board-'))
const hosts: ReturnType<typeof Sql.open>[] = []
process.once('exit', () => {
  for (const host of hosts) host.close()
  rmSync(directory, { force: true, recursive: true })
})

// A fresh SQLite file for one or more boards.
export function sql() {
  const host = Sql.open(join(directory, `${hosts.length + 1}.db`))
  hosts.push(host)
  return host
}

// A board of its own, or on `host` beside others, handed out as the swarm
// hands out its own: opened on its first call.
export function board(scope = 'swarm:abc', actor = 'swarm:abc', host = sql()) {
  return Work.opening(scope, actor, () => Board.open({ actor, module, scope, sql: host }))
}

const stored = new WeakMap<object, ReturnType<typeof Sql.open>>()

// Host.open, for a Durable Object storage of test/run.ts.
export function open(storage: object, scope: string, actor: string) {
  let host = stored.get(storage)
  if (!host) stored.set(storage, (host = sql()))
  return Board.open({ actor, module, scope, sql: host })
}

// A board for a test's stand-in object, acting as the swarm its scope names.
export function fresh(scope = 'swarm:test') {
  return board(scope, scope.split(':').slice(0, 2).join(':'))
}
