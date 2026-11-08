import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { folded, readable, track, tracker, type Tracked } from '../src/shared/Fleet.ts'
import type * as RunsModule from '../src/worker/Runs.ts'

registerHooks({
  resolve: (specifier, context, next) =>
    specifier === 'cloudflare:workers' ? { shortCircuit: true, url: 'data:text/javascript,export const waitUntil = () => {}; export class DurableObject {}' } : next(specifier, context),
})

const Runs: typeof RunsModule = await import('../src/worker/Runs.ts')

const entry = (seq: number, kind: string, text: string, detail: string | null = null, who: string | null = null, at = seq * 1000) => ({ at, detail, event: seq + 100, kind, seq, text, who }) as never

const created = (id: string) => JSON.stringify([{ text: JSON.stringify({ hand: null, sandboxId: id }), type: 'text' }])

const exec = (id: string, script: string) => JSON.stringify({ command: ['sh', '-c', script], sandboxId: id })

const said = (body: object) => JSON.stringify([{ text: JSON.stringify(body), type: 'text' }])

function world() {
  return [
    entry(1, 'machine', 'Starting machine  (lmsysorg/sglang, H200)', '{"gpu":"H200","image":"lmsysorg/sglang","lease":600}'),
    entry(2, 'output', 'compute_create output', created('sb-one')),
    entry(3, 'tool', 'Called compute_exec', exec('sb-one', 'nvidia-smi')),
    entry(4, 'output', 'compute_exec output', said({ exitCode: 0, stdout: 'H200' }), null, 4500),
    entry(5, 'tool', 'Called compute_exec', exec('sb-one', 'python bench.py'), 'branch: moe'),
    entry(6, 'thinking', 'thinking', null, 'branch: moe'),
    entry(7, 'tool', 'Called compute_status', '{"sandboxId":"sb-one"}', 'branch: attn'),
    entry(8, 'output', 'compute_status output', said({ status: 'running' }), 'branch: attn'),
    entry(9, 'output', 'compute_exec output', said({ exitCode: 1, stderr: 'boom' }), 'branch: moe'),
    entry(10, 'tool', 'Called compute_spawn', JSON.stringify({ command: ['sh', '-c', 'python train.py'], sandboxId: 'sb-one' })),
    entry(11, 'output', 'compute_spawn output', said({ exitPath: '/tmp/gateway/a.log.exit', logPath: '/tmp/gateway/a.log', pid: 7 })),
    entry(12, 'tool', 'Called compute_exec', exec('sb-one', 'sleep 1')),
    entry(13, 'tool', 'Called kv_set', '{"key":"a"}'),
    entry(14, 'tool', 'Called kv_get', '{"key":"a"}'),
    entry(15, 'tool', 'Called kv_get', '{"key":"b"}'),
    entry(16, 'tool', 'Called kv_get', '{"key":"c"}'),
    entry(17, 'tool', 'Called kv_get', '{"key":"d"}'),
    entry(18, 'output', 'compute_exec output', said({ exitCode: 0 })),
    entry(19, 'machine', "A contributor's machine joined the swarm as hand room-1 (data room)."),
    entry(20, 'tool', '$ cat q.txt on room-1', '{"cmd":"cat q.txt","hand":"room-1"}'),
    entry(21, 'output', 'Command output · exit 2', 'no such file'),
    entry(22, 'tool', 'Called compute_exec', exec('sb-one', 'x'.repeat(10))),
    entry(23, 'output', 'compute_exec output', 'y'.repeat(1999) + '…'),
  ]
}

function replay(entries: ReturnType<typeof world>, ms: Record<number, number> = {}) {
  const state = tracker()
  const runs = new Map<number, Record<string, unknown>>()
  for (const item of entries) for (const change of track(state, item, ms[(item as { seq: number }).seq] ?? null) as Tracked[]) {
    if (change.kind === 'command') runs.set(change.command.seq, { ...change.command })
    else Object.assign(runs.get(change.answer.seq) ?? {}, change.answer)
  }
  return { runs, state }
}

test('track names every command by its machine, as the fold does, and answers it with the next output of the same speaker within five entries', () => {
  const entries = world()
  const { runs, state } = replay(entries)
  const machines = folded(entries, [])
  for (const machine of machines)
    for (const run of machine.commands) {
      const found = runs.get(run.seq)
      assert.equal(found?.['machine'], machine.name)
      assert.equal(found?.['text'], run.text)
      assert.equal(found?.['who'], run.who)
      assert.equal(found?.['output'] === null ? null : (entries[(found?.['output'] as number) - 1] as { detail: string }).detail, run.output)
    }
  assert.equal(runs.size, machines.reduce((sum, machine) => sum + machine.commands.length, 0))
  assert.deepEqual(state.sandboxes, { 'sb-one': 'sb-one' })
  assert.equal(runs.get(12)?.['output'], null)
})

test('track reads the exit code, the failure, a spawned job log path, whether the feed cut the output and how long it took', () => {
  const { runs } = replay(world(), { 4: 1234 })
  assert.deepEqual([runs.get(3)?.['exit'], runs.get(3)?.['failed'], runs.get(3)?.['ms']], [0, false, 1234])
  assert.deepEqual([runs.get(5)?.['exit'], runs.get(5)?.['failed'], runs.get(5)?.['ms']], [1, true, 4000])
  assert.deepEqual([runs.get(7)?.['exit'], runs.get(7)?.['failed']], [null, false])
  assert.equal(runs.get(10)?.['log'], '/tmp/gateway/a.log')
  assert.deepEqual([runs.get(20)?.['machine'], runs.get(20)?.['exit'], runs.get(20)?.['failed']], ['room-1', 2, true])
  assert.equal(runs.get(22)?.['clipped'], true)
  assert.equal(runs.get(3)?.['clipped'], false)
  const lone = tracker()
  track(lone, entry(1, 'tool', '$ ls on room-1', '{"cmd":"ls","hand":"room-1"}'))
  const [done] = track(lone, entry(2, 'output', 'Command output', 'a'))
  assert.equal(done?.kind === 'answer' ? done.answer.exit : undefined, 0)
})

function storage() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE feed (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, detail TEXT, who TEXT, event INTEGER)')
  for (const statement of [...Runs.schema, ...Runs.indexes]) db.exec(statement)
  const kv = new Map<string, unknown>()
  const sql = {
    exec: (query: string, ...bindings: unknown[]) => {
      const statement = db.prepare(query)
      const rows = (/^\s*(SELECT|WITH|EXPLAIN)/i.test(query) || /RETURNING/i.test(query) ? statement.all(...(bindings as never[])) : (statement.run(...(bindings as never[])), [])) as Record<string, unknown>[]
      return { one: () => rows[0], toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() }
    },
  }
  const self = {
    ctx: { storage: { kv: { delete: (key: string) => kv.delete(key), get: (key: string) => kv.get(key), put: (key: string, value: unknown) => kv.set(key, structuredClone(value)) }, sql } },
    last: () => Number((db.prepare('SELECT MAX(seq) AS seq FROM feed').get() as { seq: number | null }).seq ?? 0),
  }
  const insert = (item: { at: number; detail: string | null; event: number; kind: string; text: string; who: string | null }) =>
    Number((db.prepare('INSERT INTO feed (at, kind, text, detail, who, event) VALUES (?, ?, ?, ?, ?, ?) RETURNING seq').get(item.at, item.kind, item.text, item.detail, item.who, item.event) as { seq: number }).seq)
  return { db, insert, kv, self: self as never }
}

test('runs backfill a feed, keep up with new entries with their duration, page a machine both ways and count every machine', () => {
  const { db, insert, kv, self } = storage()
  const entries = world()
  for (const item of entries.slice(0, 12)) insert(item as never)
  Runs.sync(self)
  assert.equal(kv.get('runs:cursor'), 12)
  for (const item of entries.slice(12)) {
    const seq = insert(item as never)
    Runs.logged(self, { ...(item as object), seq } as never, seq === 21 ? 777 : null)
  }
  assert.deepEqual(Runs.listed(self, 'sb-one', { limit: 2, order: 'oldest' }).commands.map((run) => run.seq), [3, 5])
  const newest = Runs.listed(self, 'sb-one', { limit: 2, order: 'newest' })
  assert.deepEqual([newest.commands.map((run) => run.seq), newest.next, newest.total], [[22, 12], 12, 6])
  assert.deepEqual(Runs.listed(self, 'sb-one', { cursor: 12, limit: 10, order: 'newest' }).commands.map((run) => run.seq), [10, 7, 5, 3])
  assert.equal(Runs.listed(self, 'room-1', { limit: 10, order: 'newest' }).commands[0]?.ms, 777)
  assert.equal(Runs.listed(self, 'sb-one', { limit: 10, order: 'newest' }).commands.find((run) => run.seq === 12)?.ms, null)
  const [opened] = Runs.opened(self, 'sb-one', [5])
  assert.deepEqual([opened?.output, opened?.event, opened?.call], [said({ exitCode: 1, stderr: 'boom' }), 109, 105])
  const machines = Runs.counted(self, folded(entries.filter((item) => ['machine', 'output'].includes((item as { kind: string }).kind)), []))
  assert.deepEqual(
    machines.map((machine) => [machine.name, machine.runs?.count, machine.runs?.failed, machine.sandboxes]),
    [['room-1', 1, 1, []], ['sb-one', 6, 1, ['sb-one']]],
  )
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT seq FROM runs WHERE machine = ? AND seq < ? ORDER BY seq DESC LIMIT 10").all('sb-one', 99) as { detail: string }[]
  assert.ok(plan.some((step) => /USING (COVERING )?INDEX runs_machine/.test(step.detail)), JSON.stringify(plan))
})

test('runs track again a feed an older tracker passed over, so an E2B sandbox it missed gets its commands', () => {
  const { insert, kv, self } = storage()
  const id = 'iajm8koswc342dpzhhv41'
  for (const item of [
    entry(1, 'machine', 'Starting machine  (default image)', '{"lease":900}'),
    entry(2, 'output', 'compute_create output', JSON.stringify({ text: created(id) })),
    entry(3, 'tool', 'Called compute_exec', exec(id, 'uname -a')),
    entry(4, 'output', 'compute_exec output', said({ exitCode: 0, stdout: 'Linux' })),
  ])
    insert(item as never)
  kv.set('runs:cursor', 4)
  kv.set('runs:tracker', tracker())
  Runs.sync(self)
  assert.deepEqual(Runs.listed(self, id, { limit: 10, order: 'oldest' }).commands.map((run) => [run.seq, run.text, run.exit]), [[3, '$ uname -a', 0]])
  assert.equal(kv.get('runs:v'), 2)
  assert.equal(kv.get('runs:cursor'), 4)
})

test('readable shows a compute call output as its stdout and stderr, and any other output as it came', () => {
  assert.equal(readable(said({ exitCode: 0, stderr: '', stdout: '6b1f6d2\n', timedOut: false })), '6b1f6d2')
  assert.equal(readable(JSON.stringify({ content: [{ text: JSON.stringify({ exitCode: 1, stderr: 'boom\n', stdout: 'a' }), type: 'text' }] })), 'a\nstderr:\nboom')
  assert.equal(readable(said({ path: '/w/a.py', size: 3 })), '{"path":"/w/a.py","size":3}')
  assert.equal(readable('plain text'), 'plain text')
  assert.equal(readable(JSON.stringify({ text: said({ exitCode: 0, stdout: 'TIME 1\n' }) })), 'TIME 1')
  assert.equal(readable('[{"text":"{\\"exitCode\\":0,\\"stdout\\":\\"cut…'), '[{"text":"{\\"exitCode\\":0,\\"stdout\\":\\"cut…')
})
