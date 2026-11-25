import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { Board } from 'nanocode-ts'
import { Sql } from 'nanocode-ts/node'
import { Board as OldBoard } from 'nanocode-ts-old'
import { Sql as OldSql } from 'nanocode-ts-old/node'

const require = createRequire(import.meta.url)
const compile = (path: string) => WebAssembly.compile(readFileSync(require.resolve(path)))

type Build = { checkpoints: boolean; name: string; open(file: string): Promise<{ board: Board.Board; host: { close(): void } }> }

const scope = 'swarm:abc'
const oldWasm = await compile('nanocode-ts-old/nanocode_wasm.wasm')

const builds: Build[] = [
  {
    checkpoints: false,
    name: 'old full wasm',
    async open(file) {
      const host = OldSql.open(file)
      const board = (await OldBoard.open({ actor: scope, module: oldWasm, scope, sql: host })) as unknown as Board.Board
      return { board, host }
    },
  },
  ...([
    ['new board wasm', await compile('nanocode-ts/nanocode_board.wasm')],
    ['new full wasm', await compile('nanocode-ts/nanocode_wasm.wasm')],
  ] as const).map(([name, module]) => ({
    checkpoints: true,
    name,
    async open(file: string) {
      const host = Sql.open(file)
      return { board: await Board.open({ actor: scope, module, scope, sql: host }), host }
    },
  })),
]

const T = 1_800_000_000_000
const lease = 60_000
const later = T + 2 * lease

function ok(verdict: { ok: boolean }, what: string) {
  assert.ok(verdict.ok, what + ': ' + JSON.stringify(verdict))
}

async function snapshot(board: Board.Board, at: number) {
  const strip = (tasks: Board.Task[]) => tasks.map(({ claimSeq: _, ...task }) => task).sort((a, b) => a.id.localeCompare(b.id))
  return {
    held: strip(await board.held(at)),
    steers: Object.fromEntries(await Promise.all(['n:a', 'n:b', 'n:d'].map(async (id) => [id, await board.steers(id)] as const))),
    tasks: strip(await board.tasks(at)),
  }
}

const last = new Map<string, Build>()
const checkpointed = new Set<string>()

async function using<R>(build: Build, file: string, step: (board: Board.Board) => Promise<R>) {
  const { board, host } = await build.open(file)
  try {
    if (build.checkpoints) {
      const [opened] = await board.opened()
      if (!checkpointed.has(file)) assert.deepEqual(opened, { fallback: 'missing', from: 'replay' })
      else {
        assert.equal(opened?.from, 'checkpoint')
        assert.equal(opened.from === 'checkpoint' && opened.tail > 0, !last.get(file)?.checkpoints)
      }
      checkpointed.add(file)
    }
    last.set(file, build)
    return await step(board)
  } finally {
    await board.close()
    host.close()
  }
}

const root = { id: 'n:root', labels: { form: 'goal', kind: 'node' }, spec: 'Does P = NP?' }

function fold(board: Board.Board, id: string, at: number) {
  return board.submit({ body: 'folded ' + id, op: 'reply', task: 'n:root' }, { atMs: at, key: 'fold/' + id })
}

async function write(build: Build, file: string) {
  return using(build, file, async (board) => {
    ok(await board.post(root, { atMs: T, key: 'n:root' }), 'post root')
    ok(await board.post(root, { atMs: T, key: 'n:root' }), 'repost root')
    for (const id of ['n:a', 'n:c', 'n:d', 'n:f']) ok(await board.post({ id, labels: { kind: 'node' }, parent: 'n:root', spec: id }, { atMs: T + 1 }), 'post ' + id)
    ok(await board.post({ id: 'n:b', labels: { kind: 'node' }, needs: ['n:a'], parent: 'n:root', spec: 'after a' }, { atMs: T + 1 }), 'post n:b')
    const a = await board.claim('n:a', { atMs: T + 2, leaseMs: lease })
    assert.ok(a.ok)
    ok(await board.steer('n:a', 'look at the lower bound', { atMs: T + 3, key: 'steer:a:1' }), 'steer a')
    ok(await board.steer('n:a', 'look at the lower bound', { atMs: T + 3, key: 'steer:a:1' }), 'steer a again')
    ok(await board.reply('n:root', 'a plain note', T + 4), 'reply')
    ok(await fold(board, 'n:a', T + 4), 'fold a')
    ok(await fold(board, 'n:a', T + 4), 'fold a again')
    const grouped = await board.group([
      { atMs: T + 5, key: 'n:e', op: { op: 'post', task: { id: 'n:e', labels: { kind: 'node' }, needs: [], parent: 'n:root', spec: 'grouped' } } },
      { atMs: T + 5, key: 'g:reply', op: { body: 'grouped reply', op: 'reply', task: 'n:root' } },
    ])
    for (const verdict of grouped) ok(verdict, 'group')
    const steers = await board.steers('n:a', a.claim)
    ok(await board.heed('n:a', a.claim, steers.at(-1)!.seq, T + 6), 'heed')
    ok(await board.finish('n:a', a.claim, { done: 'proved' }, T + 7), 'finish a')
    ok(await board.cancel('n:c', 'withdrawn', T + 7), 'cancel c')
    const d = await board.claim('n:d', { atMs: T + 8, leaseMs: lease })
    const f = await board.claim('n:f', { atMs: T + 8, leaseMs: lease })
    assert.ok(d.ok && f.ok)
    ok(await board.steer('n:d', 'keep going', { atMs: T + 9, key: 'steer:d:1' }), 'steer d')
    if (build.checkpoints) assert.equal(await board.checkpoint(), true)
    return { d: d.claim, f: f.claim, seen: await snapshot(board, T + 10) }
  })
}

async function read(build: Build, file: string, written: Awaited<ReturnType<typeof write>>) {
  return using(build, file, async (board) => {
    assert.deepEqual(await snapshot(board, T + 10), written.seen)
    const refused = await board.claim('n:d', { atMs: T + 11, leaseMs: lease })
    assert.equal(refused.ok ? 'claimed' : refused.rejection.kind, 'Held')
    ok(await board.renew('n:d', written.d, lease, T + 12), 'renew d')
    ok(await board.heed('n:d', written.d, (await board.steers('n:d', written.d)).at(-1)!.seq, T + 13), 'heed d')
    ok(await board.finish('n:d', written.d, { done: 'shown' }, T + 13), 'finish d')
    assert.deepEqual((await board.ready({ atMs: T + 13 })).map((task) => task.id).sort(), ['n:b', 'n:e', 'n:root'])
    ok(await board.post(root, { atMs: T + 13, key: 'n:root' }), 'repost root')
    ok(await fold(board, 'n:a', T + 13), 'fold a after')
    const f = await board.claim('n:f', { atMs: later, leaseMs: lease })
    assert.ok(f.ok && f.tookOver, JSON.stringify(f))
    const b = await board.claim('n:b', { atMs: later, leaseMs: lease })
    assert.ok(b.ok)
    ok(await board.steer('n:b', 'from the other build', { atMs: later + 1, key: 'steer:b:1' }), 'steer b')
    ok(await fold(board, 'n:b', later + 1), 'fold b')
    if (build.checkpoints) assert.equal(await board.checkpoint(), true)
    return { b: b.claim, f: f.claim, seen: await snapshot(board, later + 10) }
  })
}

async function back(build: Build, file: string, seen: Awaited<ReturnType<typeof read>>) {
  return using(build, file, async (board) => {
    assert.deepEqual(await snapshot(board, later + 10), seen.seen)
    const refused = await board.claim('n:f', { atMs: later + 11, leaseMs: lease })
    assert.equal(refused.ok ? 'claimed' : refused.rejection.kind, 'Held')
    ok(await board.finish('n:f', seen.f, { done: 'taken over' }, later + 12), 'finish f')
    ok(await board.heed('n:b', seen.b, (await board.steers('n:b', seen.b)).at(-1)!.seq, later + 12), 'heed b')
    ok(await board.finish('n:b', seen.b, { failed: 'no' }, later + 12), 'finish b')
    const tasks = await board.tasks(later + 13)
    assert.deepEqual(Object.fromEntries(tasks.map((task) => [task.id, task.phase])), { 'n:a': 'done', 'n:b': 'failed', 'n:c': 'cancelled', 'n:d': 'done', 'n:e': 'open', 'n:f': 'done', 'n:root': 'open' })
    assert.deepEqual(tasks.find((task) => task.id === 'n:root')!.replies.map((reply) => reply.body), ['a plain note', 'folded n:a', 'grouped reply', 'folded n:b'])
  })
}

const directory = mkdtempSync(join(tmpdir(), 'swarms-compat-'))
process.once('exit', () => process.env.COMPAT_KEEP || rmSync(directory, { force: true, recursive: true }))

test('every build writes the same log entries, so the old one never reads a field it does not know', async () => {
  const logs = await Promise.all(
    builds.map(async (build) => {
      const file = join(directory, 'log-' + build.name.replaceAll(' ', '-') + '.db')
      await write(build, file)
      const db = new DatabaseSync(file)
      try {
        return db.prepare('select seq, body from nanocode_log order by seq').all().map((row) => [row.seq, String(row.body).replace(/"at_ms":\d+,("op":\{"op":"charter")/, '$1')])
      } finally {
        db.close()
      }
    }),
  )
  assert.equal(logs[0]!.length, 19)
  for (const log of logs.slice(1)) assert.deepEqual(log, logs[0])
})

for (const writer of builds)
  for (const reader of builds) {
    if (writer === reader) continue
    test('a board written by ' + writer.name + ' reads and writes the same under ' + reader.name + ', and back', async () => {
      const file = join(directory, (writer.name + '-' + reader.name).replaceAll(' ', '-') + '.db')
      await back(writer, file, await read(reader, file, await write(writer, file)))
    })
  }
