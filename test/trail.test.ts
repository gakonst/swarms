import assert from 'node:assert/strict'
import test from 'node:test'
import type { Entry } from '../src/shared/Api.ts'
import { crew, memory, merge, named, narrate, redact, step, subagent, trouble } from '../src/shared/Trail.ts'

function entry(input: Partial<Entry>): Entry {
  return { at: 1000, detail: null, event: null, kind: 'tool', seq: 0, text: '', who: null, ...input }
}

test('a subagent is named by its role, speaks under that name and reports its result once', () => {
  const buffers = memory()
  const known = crew()
  const added = subagent(buffers, known, 's', { agent: { id: 3, parent: 0, role: 'zstd tuner', task: 'Tune zstd levels.' }, type: 'added' })
  assert.deepEqual(added, { steps: [{ detail: 'Tune zstd levels.', kind: 'status', text: 'Started a subagent: zstd tuner' }], who: 'zstd tuner' })
  assert.equal(subagent(buffers, known, 's', { agent: { id: 4, role: 'zstd tuner' }, type: 'added' })?.who, 'zstd tuner #4')
  assert.deepEqual(subagent(buffers, known, 's', { event: { payload: { arguments: { cmd: 'zstd -19 a' }, tool: 'exec_command' }, type: 'tool.call' }, id: 3, type: 'event' })?.steps, [{ detail: '{"cmd":"zstd -19 a"}', kind: 'tool', text: '$ zstd -19 a' }])
  assert.deepEqual(subagent(buffers, known, 's', { id: 3, status: { state: 'completed' }, type: 'status' })?.steps, [])
  assert.deepEqual(subagent(buffers, known, 's', { id: 3, status: { output: 'level 19 wins', state: 'completed' }, type: 'completion' })?.steps, [{ detail: 'level 19 wins', kind: 'output', text: 'zstd tuner finished' }])
  assert.deepEqual(subagent(buffers, known, 's', { id: 3, status: { output: 'again', state: 'completed' }, type: 'completion' })?.steps, [])
  assert.equal(subagent(buffers, known, 's', { id: 9, status: { error: 'No capacity', state: 'failed' }, type: 'status' })?.steps[0]?.text, 'subagent 9 failed')
  assert.equal(subagent(buffers, known, 's', 'nonsense'), undefined)
})

test('a subagent keeps its own thinking until its model call completes', () => {
  const buffers = memory()
  assert.deepEqual(narrate(buffers, 'a:1', 'reasoning.summary.delta', { text: 'Compare ' }), [])
  assert.deepEqual(narrate(buffers, null, 'reasoning.summary.delta', { text: 'Plan the next step' }), [])
  narrate(buffers, 'a:1', 'reasoning.summary.delta', { text: 'the two codecs.' })
  const steps = narrate(buffers, 'a:1', 'model.call.completed', {})
  assert.deepEqual(steps, [{ detail: null, kind: 'thinking', text: 'Compare the two codecs.' }])
  assert.equal(narrate(buffers, null, 'assistant.message', { text: 'Done.' })[0]?.text, 'Plan the next step')
})

test('tool results become outputs, and failures errors', () => {
  const ok = step('tool.result', { result: [{ type: 'input_text', text: 'Script completed\nWall time 0.3 seconds\nOutput:\n' }, { type: 'input_text', text: '42' }], status: 'completed', tool: 'exec' })
  assert.deepEqual(ok, { detail: '42', kind: 'output', text: 'Script output' })
  const failed = step('tool.result', { result: 'Chunk ID: 1\nWall time: 0.2 seconds\nProcess exited with code 127\nOriginal token count: 5\nOutput:\nbash: python3: command not found', status: 'completed', tool: 'exec_command' })
  assert.deepEqual(failed, { detail: 'bash: python3: command not found', kind: 'output', text: 'Command output · exit 127' })
  assert.equal(step('tool.result', { result: 'Script running with cell ID 4\nWall time 11.0 seconds\nOutput:\n', status: 'completed', tool: 'exec' }), undefined)
  assert.equal(step('tool.result', { result: 'boom', status: 'failed', tool: 'exec_command' })?.kind, 'error')
  assert.equal(step('tool.result', { result: 'x', status: 'completed', tool: 'wait_agent' }), undefined)
  assert.equal(step('tool.call', { arguments: { cmd: 'ls -la' }, tool: 'exec_command' })?.text, '$ ls -la')
})

test('a stored entry replaces the live one it shares an event with', () => {
  const live = entry({ at: 1000, event: 7, text: '$ ls' })
  const stored = entry({ at: 1500, event: 7, seq: 12, text: '$ ls' })
  const merged = merge(merge([], [live]), [stored])
  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.seq, 12)
  assert.equal(merged[0]?.at, 1000)
  assert.equal(merge(merged, [live]), merged)
  const status = entry({ event: 7, kind: 'status', seq: 0 })
  assert.equal(merge(merged, [status]).length, 2)
})

test('secrets in clone URLs and JWTs are redacted', () => {
  assert.equal(redact('git clone https://user:token@code.storage/repo'), 'git clone https://***@code.storage/repo')
  assert.equal(redact('eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4'), '[redacted]')
})

test('a failed model call says why', () => {
  const error = `Responses HTTPS request was rejected with HTTP 429: {"error":{"message":"The payer refused to pay (429 busy): try again shortly.","type":"api_error"}}`
  assert.equal(step('model.call.failed', { error })?.text, "A model call failed: The payer refused to pay (429 busy): try again shortly.")
  assert.equal(step('model.call.failed', { error: 'timeout' })?.text, 'A model call failed.')
})

test('a tool step is named by what it did', () => {
  assert.equal(named({ detail: null, text: '$ cd /work && pytest -q tests' }), 'Ran pytest')
  assert.equal(named({ detail: null, text: '$ cat README.md' }), 'Read README.md')
  assert.equal(named({ detail: null, text: '$ python3 bench/run.py --n 4 on gpu-box-7a1c' }), 'Ran bench/run.py')
  assert.equal(named({ detail: null, text: '$ python -m swebench.harness.run_evaluation --run_id q' }), 'Ran swebench.harness.run_evaluation')
  assert.equal(named({ detail: null, text: "$ printf 'x' > ljmd/systems.py" }), 'Wrote ljmd/systems.py')
  assert.equal(named({ detail: null, text: '$ curl -fsSL -o p.gz https://deb.debian.org/debian/Packages.gz' }), 'Downloaded from deb.debian.org')
  assert.equal(named({ detail: 'await tools.Write({ file_path: "/workspace/ljmd/systems.py", content: "x" })', text: 'Ran a script: await tools.Write({' }), 'Wrote ljmd/systems.py')
  assert.equal(named({ detail: 'const r = await tools.exec_command({cmd:"cd /w && cargo test"})', text: 'Ran a script: const r' }), 'Ran cargo test')
  assert.equal(named({ detail: '{"key":"results/leaderboard.json","body":"{}"}', text: 'Called bucket_put' }), 'Saved results/leaderboard.json to the bucket')
  assert.equal(named({ detail: JSON.stringify({ message: 'Add tests\n\nMore' }), text: 'Called git_commit' }), 'Committed: Add tests')
  assert.equal(named({ detail: null, text: 'Called mystery_tool' }), 'Called mystery_tool')
})

test('payer and protocol errors read as one plain sentence', () => {
  assert.deepEqual(trouble({ detail: '{"error":"Responses HTTPS request was rejected with HTTP 402: {\"error\":{\"message\":\"The payer refused to pay (402 limit_reached)\"}}"}', text: 'A model call failed.' }), { money: true, text: 'Ran out of money for this step.' })
  assert.deepEqual(trouble({ detail: 'durable operation previously failed: HTTP 402', text: 'The agent stopped with an error after spending $0.046926.' }), { money: true, text: 'Ran out of money for this step. It had spent $0.047.' })
  assert.equal(trouble({ detail: '{"error":"Responses HTTPS request was rejected with HTTP 503: cannot"}', text: 'A model call failed.' }).text, 'The model service was unavailable, so the step stopped.')
  assert.equal(trouble({ detail: '{"status":"failed"}', text: 'The run failed.' }).text, "The agent's turn stopped on an error.")
  assert.equal(trouble({ detail: null, text: "The channel for 0x364e…7c19's pledge never opened on Tempo, so the next payment opens another." }).text, 'A payment channel did not open; the next payment tries again.')
  assert.equal(trouble({ detail: '429 busy', text: 'A model call failed.' }).money, false)
})
