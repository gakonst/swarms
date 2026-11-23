import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Branch } from '../src/shared/Api.ts'
import * as Crew from '../src/shared/Crew.ts'

const branch = (fields: Partial<Branch>): Branch => ({ budget: '7.000000', error: null, funded: '0', funders: [], id: 1, left: null, parent: null, result: null, role: 'autoresearch branch: moe', spent: '0.5', starved: false, state: 'completed', task: 'Tune it.', who: 'autoresearch branch: moe', ...fields })

test('a branch reads its JSON result as a title, one line and its metric', () => {
  const result = JSON.stringify({ best_commit_dir: '/w/moe5_best', best_speedup: 1.3376, blockers: 'No active blockers.', files_changed: ['moe.py'], summary: 'Best commit cfae32e02012ad7a4e3f535c60530811cddf4557. Fused pre-expert RMSNorm with alignment in one Triton launch. Untouched control measured 1.3147x.' }, null, 2)
  const member = Crew.member(branch({ result, role: 'autoresearch branch: moe5 (routed experts + MoE glue)', who: 'autoresearch branch: moe5 (routed experts…' }))
  assert.equal(member.title, 'moe5 (routed experts + MoE glue)')
  assert.equal(member.summary, 'Fused pre-expert RMSNorm with alignment in one Triton launch.')
  assert.equal(member.metric, '1.34×')
  assert.equal(member.blockers, 'No active blockers.')
  assert.equal(member.state, 'done')
})

test('a summary skips sentences that only file commits and paths', () => {
  const result = (summary: string) => Crew.member(branch({ result: JSON.stringify({ summary }) })).summary
  assert.equal(result('Best remains commit e8c16f50c2ffbb32cc44f0ac88f6d27143eba7ec. Merge only /w/moe2_best/moe.py. Replacing Marlin lost 30%.'), 'Replacing Marlin lost 30%.')
  assert.equal(result('Best commit 655bf9f; exported logs to /w/attention6_best/.'), 'Best commit 655bf9f; exported logs to /w/attention6_best/.')
  assert.equal(result('Unknown model: configure max_tokens explicitly.'), 'Unknown model: configure max_tokens explicitly.')
})

test('a branch without JSON shows its first plain line, its error or its task', () => {
  assert.equal(Crew.member(branch({ result: '**Seven** of nine allow commercial use.\nDetails in licenses.md.' })).summary, 'Seven of nine allow commercial use.')
  assert.equal(Crew.member(branch({ error: 'subagent 4 could not resume after a runtime restart\n\nTool calls observed', result: '', state: 'failed' })).summary, 'could not resume after a runtime restart')
  assert.equal(Crew.member(branch({ state: 'running', task: '\nCONTEXT. You are one branch of a swarm.' })).summary, 'You are one branch of a swarm.')
  assert.equal(Crew.member(branch({ result: '{"files_changed": []}' })).summary, null)
})

test('the board puts working branches first, then the biggest spenders', () => {
  const list = Crew.board([
    branch({ id: 1, spent: '3.5' }),
    branch({ id: 2, spent: '0.2', state: 'running' }),
    branch({ id: 3, spent: '1.1', state: 'failed', starved: true }),
    branch({ id: 4, parent: 2, spent: '9', state: 'running' }),
  ])
  assert.deepEqual(list.map((member) => [member.id, member.state]), [[2, 'working'], [1, 'done'], [3, 'starved']])
})
