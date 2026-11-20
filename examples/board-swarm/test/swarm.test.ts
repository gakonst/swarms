import * as assert from 'node:assert/strict'
import * as child from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { test } from 'node:test'

test('the swarm finishes every task, survives a killed worker and heeds a steer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-swarm-'))
  const lead = path.join(import.meta.dirname, '..', 'src', 'lead.ts')
  const run = child.spawnSync(process.execPath, ['--no-warnings', lead, '--dir', dir], {
    encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_API_KEY: '' },
    timeout: 120_000,
  })
  assert.equal(run.status, 0, run.stdout + run.stderr)

  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'))
  assert.equal(summary.ok, true)
  assert.equal(summary.root.phase, 'done')
  assert.equal(summary.tasks.length, 7)
  for (const task of summary.tasks) assert.equal(task.phase, 'done', task.id)

  assert.equal(summary.killed.task, 'count-2')
  assert.equal(summary.takeover.tookOver, true)
  assert.notEqual(summary.takeover.by, summary.killed.worker)
  assert.ok(summary.takeover.afterKillMs > 0)
  assert.equal(summary.workers.find((entry: { name: string }) => entry.name === summary.killed.worker).exit, 'SIGKILL')

  assert.equal(summary.steer.text, 'List only the top 5 words')
  assert.ok(summary.steer.heededBy)
  assert.ok(summary.steer.heededUpto >= summary.steer.seq)
  assert.equal(summary.steer.finishedBy, summary.steer.heededBy)
  assert.equal(summary.tasks.find((task: { id: string }) => task.id === 'count-2').by, summary.takeover.by)
  const report = fs.readFileSync(path.join(dir, 'report.md'), 'utf8')
  assert.match(report, /^# Top 5 words/)
  assert.equal(report.split('\n').filter((line) => /^\| \d+ \|/.test(line)).length, 5)
  assert.match(report, /Steered: List only the top 5 words/)

  const counted = Object.values(
    JSON.parse(fs.readFileSync(path.join(dir, 'merged.json'), 'utf8')) as [string, number][],
  ).reduce((total, entry) => total + entry[1], 0)
  assert.equal(counted, 12_000)

  fs.rmSync(dir, { recursive: true, force: true })
})
