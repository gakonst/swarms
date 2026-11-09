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

const commit = (sha: string, parents: string[], message: string) => ({ date: null, message, parents, sha })

test('a swarm repository becomes the tree: main first-parent chain, merges naming their branch and number, unmerged branches forking where they were cut', () => {
  const main = [
    commit('m4', ['m3', 'b2'], 'merge dense2: tuned GEMVs\n\nspeedup: 1.30'),
    commit('b2', ['b1'], 'dense2: fused pooler'),
    commit('m3', ['m2'], 'tune stages\n\nspeedup: 1.20'),
    commit('b1', ['m1'], 'dense2: tuned GEMVs'),
    commit('m2', ['m1', 'a1'], "Merge branch 'moe' into main\n\nspeedup: 1.10"),
    commit('a1', ['m1'], 'moe: post-expert norm kernel'),
    commit('m1', [], 'baseline\n\nspeedup: 1.00'),
  ]
  const logs = {
    attention: [commit('c2', ['c1'], 'attention: FP8 verify kernel loses to FA3'), commit('c1', ['m2'], 'attention: start'), commit('m2', ['m1', 'a1'], ''), commit('m1', [], '')],
    dense2: [commit('b2', ['b1'], ''), commit('b1', ['m1'], ''), commit('m1', [], '')],
    moe: [commit('a1', ['m1'], ''), commit('m1', [], '')],
    overlap: [commit('o1', ['m3'], 'overlap: side streams'), commit('m3', ['m2'], '')],
  }
  const branches = [{ name: 'main', sha: 'm4' }, { name: 'moe', sha: 'a1' }, { name: 'attention', sha: 'c2' }, { name: 'dense2', sha: 'b2' }, { name: 'overlap', sha: 'o1' }]
  const progress = Progress.fromGit({ branches, hint: undefined, live: ['overlap'], logs, main, trunk: 'main' })
  assert.ok(progress)
  assert.equal(progress.source, 'git')
  assert.equal(progress.metric, 'speedup')
  assert.equal(progress.better, 'higher')
  assert.deepEqual(progress.main.map((step) => [step.commit, step.merged, step.value]), [
    ['m1', null, 1],
    ['m2', 'moe', 1.1],
    ['m3', null, 1.2],
    ['m4', 'dense2', 1.3],
  ])
  assert.deepEqual(progress.branches.map((branch) => [branch.name, branch.merged, branch.state, branch.from, branch.found]), [
    ['moe', true, 'done', 'm1', ''],
    ['attention', false, 'dead end', 'm2', 'attention: FP8 verify kernel loses to FA3'],
    ['dense2', true, 'done', 'm1', ''],
    ['overlap', false, 'exploring', 'm3', 'overlap: side streams'],
  ])
})

test('a repository with nothing but main draws no tree, so the page falls back to the subagent list', () => {
  assert.equal(Progress.fromGit({ branches: [{ name: 'main', sha: 'm1' }], hint: undefined, live: [], logs: {}, main: [commit('m1', [], 'first')], trunk: 'main' }), undefined)
})

test('merge messages name their branch in our form and in git\'s', () => {
  assert.equal(Progress.merges('merge moe2: Marlin tuning'), 'moe2')
  assert.equal(Progress.merges("Merge branch 'dense3' into main"), 'dense3')
  assert.equal(Progress.merges("Merge remote-tracking branch 'origin/attn-4'"), 'attn-4')
  assert.equal(Progress.merges('merge dense-fusion - fused router'), 'dense-fusion')
  assert.equal(Progress.merges('fix the harness'), null)
})
