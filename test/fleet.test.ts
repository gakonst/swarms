import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fleet } from '../src/shared/Fleet.ts'

const entry = (seq: number, kind: string, text: string, detail: string | null = null, who: string | null = null) => ({ at: seq * 1000, detail, event: seq, kind, seq, text, who }) as never

test('fleet names machines by the call that made them and collects their commands', () => {
  const machines = fleet(
    [
      entry(1, 'machine', 'Starting machine sb-1 (python:3.12-slim)', '{"attach":"sb-1","image":"python:3.12-slim","cpu":2,"memory":4096,"lease":300}'),
      entry(2, 'tool', '$ ls on sb-1', '{"cmd":"ls","hand":"sb-1"}'),
      entry(3, 'output', 'Command output', 'a\nb'),
      entry(4, 'machine', "A contributor's machine joined the swarm as hand room-1 (data room)."),
      entry(5, 'tool', '$ cat q3.txt on room-1', '{"cmd":"cat q3.txt","hand":"room-1"}'),
      entry(6, 'error', 'exec_command failed', 'denied'),
      entry(7, 'machine', 'Shutting down a machine', '{"sandboxId":"sb-1"}'),
    ],
    [{ connected: true, name: 'room-1' }],
    [{ at: 0, channels: null, charged: '0.010000', connected: true, earned: null, label: 'data room', name: 'room-1', price: '$0.01 a read', requests: 2 }],
  )
  const box = machines.find((item) => item.name === 'sb-1')
  const room = machines.find((item) => item.name === 'room-1')
  assert.equal(box?.kind, 'sandbox')
  assert.deepEqual(box?.config, [['Image', 'python:3.12-slim'], ['CPU', '2'], ['Memory', '4 GB'], ['Lease', '5 min']])
  assert.equal(box?.commands[0]?.output, 'a\nb')
  assert.equal(box?.ended, 7000)
  assert.equal(room?.kind, 'hand')
  assert.equal(room?.label, 'data room')
  assert.equal(room?.charged, '0.010000')
  assert.equal(room?.commands[0]?.failed, true)
  assert.equal(machines[0]?.name, 'room-1')
})

test('fleet ties compute calls to the machine compute_create started and formats its settings', () => {
  const created = JSON.stringify([{ text: JSON.stringify({ hand: null, handError: 'A hand named h200 is already connected', sandboxId: 'sb-abc' }), type: 'text' }])
  const machines = fleet(
    [
      entry(1, 'machine', 'Starting machine h200 (pytorch/pytorch:2.9.0, H200)', '{"attach":"h200","cpuMax":4,"gpu":"H200","gpuCount":1,"image":"pytorch/pytorch:2.9.0","memoryMax":16384,"timeout":150,"volumes":[{"name":"muse","path":"/work"}],"env":{"TOKEN":"secret"}}'),
      entry(2, 'output', 'compute_create output', created),
      entry(3, 'tool', 'Called compute_write', '{"path":"/work/smoke.py","sandboxId":"sb-abc","text":"print(1)"}'),
      entry(4, 'output', 'compute_write output', '{"size":8}'),
      entry(5, 'tool', 'Called compute_exec', '{"command":["sh","-c","cd /work && python smoke.py"],"sandboxId":"sb-abc","timeout":110}'),
      entry(6, 'output', 'compute_exec output', '{"exitCode":0,"stdout":"1"}'),
      entry(7, 'machine', 'Shutting down a machine', '{"sandboxId":"sb-abc"}'),
    ],
    [],
    [],
  )
  assert.equal(machines.length, 1)
  const box = machines[0]
  assert.equal(box?.name, 'h200')
  assert.deepEqual(box?.config, [['CPU', '4'], ['GPU', 'H200'], ['Image', 'pytorch/pytorch:2.9.0'], ['Memory', '16 GB'], ['Timeout', '3 min'], ['Volumes', 'muse at /work'], ['Environment', 'TOKEN']])
  assert.deepEqual(box?.commands.map((run) => run.text), ['write /work/smoke.py', '$ cd /work && python smoke.py'])
  assert.equal(box?.commands[1]?.output, '{"exitCode":0,"stdout":"1"}')
  assert.equal(box?.ended, 7000)
})

test('fleet names a sandbox started without attach by its id', () => {
  const created = JSON.stringify([{ text: JSON.stringify({ hand: null, sandboxId: 'sb-xyz' }), type: 'text' }])
  const machines = fleet(
    [
      entry(1, 'machine', 'Starting machine  (python:3.12-slim)', '{"image":"python:3.12-slim","cpu":2}'),
      entry(2, 'output', 'compute_create output', created),
      entry(3, 'tool', 'Called compute_exec', '{"command":["python","-V"],"sandboxId":"sb-xyz"}'),
      entry(4, 'output', 'compute_exec output', '{"exitCode":0}'),
      entry(5, 'tool', 'Called compute_write', '{"path":"/work/big.py","sandboxId":"sb-xyz","text":"print(1)'),
    ],
    [],
    [],
  )
  assert.equal(machines.length, 1)
  assert.equal(machines[0]?.name, 'sb-xyz')
  assert.deepEqual(machines[0]?.config, [['Image', 'python:3.12-slim'], ['CPU', '2']])
  assert.deepEqual(machines[0]?.commands.map((run) => run.text), ['$ python -V', 'write /work/big.py'])
})

test('fleet marks a machine whose compute_create failed as never started, with the reason', () => {
  const failed = JSON.stringify([{ text: JSON.stringify({ code: 'payment_failed', detail: 'Every contribution to this swarm is spent.', status: 402 }), type: 'text' }])
  const machines = fleet([entry(1, 'machine', 'Starting machine judge (lmsysorg/sglang, H200)', '{"gpu":"H200","image":"lmsysorg/sglang"}'), entry(2, 'error', 'compute_create failed', failed)], [], [])
  assert.equal(machines[0]?.failed, 'Every contribution to this swarm is spent.')
  assert.equal(machines[0]?.ended, 2000)
})
