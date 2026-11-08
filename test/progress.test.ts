import assert from 'node:assert/strict'
import test from 'node:test'
import * as Progress from '../src/shared/Progress.ts'

const main = [
  'commit\tspeedup\tmemory_gb\tstatus\tdescription',
  'base0\t1.0019\t0\tkeep\tbaseline: SGLang modules split',
  'moe-34880e5\t1.0747\t0\tkeep\tmerge moe: post-expert norm kernel called directly',
  'df-0f697c7\t1.1160\t0\tkeep\tmerge dense-fusion: fused router',
  'rerun-bd6fcf8\t1.3186\t0\tkeep\tfresh H200 + rebuilt harness',
  'attn-tile-sweep\t0\t0\tdiscard\tsplit-KV attention sweep',
  'moe2-e8c16f5\t1.2777\t0\tkeep\tmerged moe2: Marlin block_m tuning',
].join('\n')

const data = {
  branches: [
    { explores: 'merged best of all branches', found: '1.4x', name: 'main', state: 'exploring' },
    { explores: 'routed experts', found: '1.075x (merged)', name: 'moe', state: 'done' },
    { explores: 'dense GEMVs', found: '1.036x alone', name: 'dense-fusion', state: 'done' },
    { explores: 'FP8 verify attention', found: 'both lose to FA3', name: 'attention2', state: 'dead end' },
    { explores: 'Marlin replacement', found: '1.278x', name: 'Moe2', state: 'Done' },
    { explores: 'overlap', found: '', name: 'overlap', state: 'running' },
  ],
  better: 'higher',
  goal: 2.61,
  metric: 'speedup',
  title: 'Speedup over SGLang',
}

test('main.tsv becomes the trunk: kept rows with their value, discards kept apart, merges naming their branch', () => {
  const steps = Progress.steps(main, 'speedup')
  assert.equal(steps.length, 6)
  assert.deepEqual(steps.map((step) => step.merged), [null, 'moe', 'dense-fusion', null, null, 'moe2'])
  assert.deepEqual(steps.map((step) => step.kept), [true, true, true, true, false, true])
  assert.equal(steps[4]?.value, null)
  assert.equal(steps[1]?.value, 1.0747)
})

test('a progress record needs a metric and a main line with a kept value', () => {
  assert.equal(Progress.parse(data, undefined), undefined)
  assert.equal(Progress.parse({ ...data, metric: '' }, main), undefined)
  assert.equal(Progress.parse(data, 'commit\tspeedup\tstatus\nx\t0\tdiscard'), undefined)
  assert.equal(Progress.parse(null, main), undefined)
})

test('branches leave main out, read their state loosely and are merged when main took them', () => {
  const progress = Progress.parse(data, main)
  assert.ok(progress)
  assert.equal(progress.goal, 2.61)
  assert.equal(progress.better, 'higher')
  assert.deepEqual(progress.branches.map((branch) => [branch.name, branch.state, branch.merged]), [
    ['moe', 'done', true],
    ['dense-fusion', 'done', true],
    ['attention2', 'dead end', false],
    ['moe2', 'done', true],
    ['overlap', 'exploring', false],
  ])
})
