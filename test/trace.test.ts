import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Entry, Kind } from '../src/shared/Api.ts'
import * as Trace from '../src/shared/Trace.ts'

let seq = 0

function entry(kind: Kind, text: string, who: string | null = null, detail: string | null = null): Entry {
  seq += 1
  return { at: seq * 1000, detail, event: seq, kind, seq, text, who }
}

test('a run of the same errors folds into one row each, with its count and reason', () => {
  const failed = JSON.stringify({ error: 'exit 1', tool: 'x' })
  const entries = [
    entry('tool', 'Called compute_exec', 'helper-3'),
    entry('error', 'exec failed', null, failed),
    entry('error', 'git_read failed', null, '{"status":"failed"}'),
    entry('error', 'exec failed', null, failed),
    entry('error', 'git_read failed', null, '{"status":"failed"}'),
    entry('error', 'exec failed', 'helper-3', failed),
    entry('error', 'exec failed', null, failed),
    entry('thinking', 'Back **at** it', null),
    entry('error', 'exec failed', null, failed),
  ]
  const rows = Trace.rows(entries)
  assert.deepEqual(
    rows.map((row) => [row.kind, row.who, row.text, row.count]),
    [
      ['tool', 'helper-3', 'Called compute_exec', 1],
      ['error', null, 'exec failed: exit 1', 3],
      ['error', null, 'git_read failed', 2],
      ['error', 'helper-3', 'exec failed: exit 1', 1],
      ['thinking', null, 'Back at it', 1],
      ['error', null, 'exec failed: exit 1', 1],
    ],
  )
  assert.equal(rows[1]?.seq, entries[1]?.seq)
  assert.equal(rows[1]?.at, entries[6]?.at)
})

test('stall, restart and gateway plumbing never reach riders, while the work around it does', () => {
  const sponsor = JSON.stringify({ error: 'Messages HTTP 503: Tempo Agents cannot pay the network fee to open your key channel right now: its fee sponsor is out of funds.' })
  const rows = Trace.rows([
    entry('tool', 'Called compute_exec'),
    entry('error', 'A model call failed: Tempo Agents cannot pay the network fee to open your key channel right now', null, sponsor),
    entry('error', 'The run failed.', null, '{"status":"failed"}'),
    entry('error', 'The agent has made no model call or tool call for 21 minutes. Its session may be restarting without getting anywhere; after 30 minutes of it the swarm stops the turn and starts another.'),
    entry('error', 'The agent stopped with an error after spending $0.', null, 'The agent made no model call or tool call for 31 minutes, so the swarm stopped the turn to start another.'),
    entry('error', "The agent's turn failed 8 tries in a row, so the swarm starts a new agent with its goal, notes and updates; the old agent's workspace stays behind."),
    entry('error', 'The swarm hit an error and will retry.'),
    entry('error', 'The gateway did not take the next message for the agent.'),
    entry('error', 'A model call failed.', 'helper-3'),
    entry('error', 'exec failed', 'helper-3'),
  ])
  assert.deepEqual(rows.map((row) => [row.who, row.text]), [[null, 'Called compute_exec'], ['helper-3', 'exec failed']])
  assert.ok(Trace.operator({ kind: 'error', text: 'The run failed.' }))
  assert.ok(!Trace.operator({ kind: 'status', text: 'The run failed.' }))
})

test('status lines the page never shows are left out and old wording is rewritten', () => {
  const rows = Trace.rows([entry('status', 'Told the agent to keep going, with $2.68 left.'), entry('status', 'Started working with $0.62 to spend.')])
  assert.deepEqual(rows.map((row) => row.text), ['Started working.'])
})

test('an opened row shows its output as text', () => {
  assert.equal(Trace.shown({ detail: JSON.stringify({ exitCode: 0, stderr: '', stdout: 'ok\n' }), text: 'Script output' }), 'ok\n')
  assert.equal(Trace.shown({ detail: '{"a":1}', text: 'x' }), '{\n  "a": 1\n}')
  assert.equal(Trace.shown({ detail: 'plain text', text: 'x' }), 'plain text')
  assert.equal(Trace.shown({ detail: null, text: 'a whole thought' }), 'a whole thought')
})

test('a status line repeated in a row is one row, and the same tool call twice stays two', () => {
  const rows = Trace.rows([
    entry('status', 'Out of money: $0.021 left, and one step can cost up to $0.05. Fund it to keep going.'),
    entry('status', 'Out of money: $0.021 left, and one step can cost up to $0.05. Fund it to keep going.'),
    entry('tool', 'Called compute_exec'),
    entry('tool', 'Called compute_exec'),
    entry('status', 'Out of money: $0.021 left, and one step can cost up to $0.05. Fund it to keep going.'),
  ])
  assert.deepEqual(rows.map((row) => [row.kind, row.count]), [['status', 2], ['tool', 1], ['tool', 1], ['status', 1]])
})
