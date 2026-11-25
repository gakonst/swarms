import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { after, test } from 'node:test'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'

const persist = mkdtempSync(join(tmpdir(), 'swarms-workerd-'))
after(() => rmSync(persist, { force: true, recursive: true }))

const wasms = new Map<string, string>()
const bundled = await build({
  bundle: true,
  conditions: ['workerd', 'worker'],
  entryPoints: [new URL('./workerd/board.ts', import.meta.url).pathname],
  external: ['cloudflare:*', 'node:*'],
  format: 'esm',
  logLevel: 'error',
  platform: 'neutral',
  plugins: [
    {
      name: 'wasm-module',
      setup(build) {
        build.onResolve({ filter: /\.wasm(\?module)?$/ }, (args) => {
          const found = createRequire(args.importer).resolve(args.path.replace(/\?module$/, ''))
          wasms.set(basename(found), found)
          return { external: true, path: './' + basename(found) }
        })
      },
    },
  ],
  write: false,
})
const code = bundled.outputFiles[0]!.text
const imported = [...wasms].filter(([name]) => code.includes(`"./${name}"`))

function start() {
  return new Miniflare(
    convertV4MiniflareOptions({
      compatibilityDate: '2026-10-01',
      compatibilityFlags: ['nodejs_compat'],
      durableObjects: { BOARDS: { className: 'Boards', useSQLite: true } },
      modules: [{ contents: code, path: '/worker/index.js', type: 'ESModule' }, ...imported.map(([name, file]) => ({ contents: readFileSync(file), path: '/worker/' + name, type: 'CompiledWasm' as const }))],
      modulesRoot: '/worker',
      resourcePersistencePath: persist,
    }),
  )
}

type Answer = { error?: string; opened: { from: string }[]; task: { claim?: string; phase: string; replies: { body: string }[]; spec: string } | null; tasks?: string[] }

async function call(worker: Miniflare, path: string) {
  const response = await worker.dispatchFetch('http://board' + path)
  const body = (await response.json()) as Answer
  assert.equal(response.status, 200, body.error)
  return body
}

test('Host.open opens the board-only wasm over Durable Object SQLite in workerd, and a fresh object reads it back', { timeout: 60_000 }, async () => {
  assert.deepEqual(imported.map(([name]) => name), ['nanocode_board.wasm'])
  let claim: string | undefined
  const first = start()
  try {
    const wrote = await call(first, '/write')
    assert.equal(wrote.opened[0]?.from, 'replay')
    assert.equal(wrote.task?.spec, 'a task posted in workerd')
    assert.equal(wrote.task?.phase, 'claimed')
    assert.deepEqual(wrote.task?.replies.map((reply) => reply.body), ['a reply from workerd'])
    claim = wrote.task?.claim
    assert.ok(claim)
  } finally {
    await first.dispose()
  }
  const second = start()
  try {
    const read = await call(second, '/read')
    assert.equal(read.opened[0]?.from, 'checkpoint')
    assert.deepEqual(read.tasks, ['t1'])
    assert.equal(read.task?.phase, 'claimed')
    assert.equal(read.task?.claim, claim)
    assert.deepEqual(read.task?.replies.map((reply) => reply.body), ['a reply from workerd'])
  } finally {
    await second.dispose()
  }
})
