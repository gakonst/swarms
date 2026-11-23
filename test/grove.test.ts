import assert from 'node:assert/strict'
import { test } from 'node:test'
import type * as Tree from '../src/shared/Tree.ts'
import * as Grove from '../src/web/grove.ts'

function node(id: string, parent: string | null, status: Tree.Status, extra: Partial<Tree.Node> = {}): Tree.Node {
  const counts = { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 0 }
  counts[status] = 1
  return {
    by: { address: null, agent: null, handle: 'ada' },
    children: [],
    counts,
    createdAt: 1,
    end: null,
    form: 'lemma',
    funders: [],
    id,
    money: { committed: '0', granted: '0', inherited: '0', left: '0', pledged: '0', spent: '0', subtree: { left: '0', pledged: '0', spent: '0' } },
    needs: [],
    parent,
    proof: null,
    riders: 0,
    run: null,
    spec: id,
    statement: null,
    status,
    title: id,
    updatedAt: 1,
    ...extra,
  }
}

function world() {
  const a = node('a', 'root', 'proven')
  const b = node('b', 'root', 'in flight', { needs: ['a'] })
  const c = node('c', 'root', 'proposed', { needs: ['b'] })
  const root = node('root', null, 'proposed', { children: ['a', 'b', 'c'], counts: { 'dead end': 0, funded: 0, 'in flight': 1, proposed: 2, proven: 1 }, form: 'goal' })
  return Grove.grow({ headline: { deadEnds: 0, frontier: 1, inFlight: 1, lastProvenAt: null, pledged: '0', perProven: '0', proven: 1, spent: '0' }, nodes: [root, a, b, c], seq: 5 })
}

test('a proven delta moves its ancestors counts, the headline and the frontier once', () => {
  const grove = world()
  const proven = node('b', 'root', 'proven', { needs: ['a'], proof: { at: 9, axioms: [], checker: '', command: '', commit: 'x', contentHash: '', durationMs: 1, exitCode: 0, mathlib: '', repo: '', run: '1', statement: '', theorem: '', toolchain: '', url: 'u' } })
  const next = Grove.patch(grove, { at: 9, event: 'proven', node: proven, seq: 6, text: 'Checked by Lean' })
  assert.equal(next.nodes['root']!.counts.proven, 2)
  assert.equal(next.nodes['root']!.counts['in flight'], 0)
  assert.equal(next.headline.proven, 2)
  assert.equal(next.headline.inFlight, 0)
  assert.equal(next.headline.frontier, 1)
  assert.equal(next.headline.lastProvenAt, 9)
  assert.equal(next.landed['b'], 9)
  assert.equal(Grove.patch(next, { at: 9, event: 'proven', node: proven, seq: 6, text: '' }), next)
})

test('a posted node joins its parent and the subtree money', () => {
  const grove = world()
  const fresh = node('d', 'root', 'proposed', { money: { committed: '0', granted: '0', inherited: '0', left: '1.000000', pledged: '1.000000', spent: '0', subtree: { left: '1.000000', pledged: '1.000000', spent: '0' } } })
  const next = Grove.patch(grove, { at: 2, event: 'posted', node: fresh, seq: 6, text: '' })
  assert.deepEqual(next.nodes['root']!.children, ['a', 'b', 'c', 'd'])
  assert.equal(next.nodes['root']!.counts.proposed, 3)
  assert.equal(next.nodes['root']!.money.subtree.left, '1.000000')
})

test('filters keep the ancestors of what matches, dimmed', () => {
  const grove = world()
  const rows = Grove.rows(grove.nodes, 'root', new Set(['root']), 'proven')
  assert.deepEqual(rows.map((row) => [row.node.id, row.hit]), [['root', false], ['a', true]])
  assert.deepEqual(Grove.rows(grove.nodes, 'root', new Set(), 'all').map((row) => row.node.id), ['root'])
})

test('needs money is an unstarted node under the run minimum', () => {
  assert.equal(Grove.needsMoney(node('x', null, 'proposed')), true)
  assert.equal(Grove.needsMoney(node('x', null, 'funded')), false)
})

test('a doing delta carries the newest step without moving the cursor, and an older one is dropped', () => {
  const grove = world()
  const run: Tree.Run = { agent: 3, attempt: 1, budget: '1', checking: false, doing: { at: 7, text: 'Ran lake build' }, k: 1, since: 1, spent: '0', task: 'r', until: 0 }
  const busy = node('b', 'root', 'in flight', { needs: ['a'], run })
  const next = Grove.patch(grove, { at: 7, event: 'doing', node: busy, seq: 5, text: 'Ran lake build' })
  assert.equal(next.nodes['b']?.run?.doing?.text, 'Ran lake build')
  assert.equal(next.seq, 5)
  assert.deepEqual([next.headline.inFlight, next.headline.frontier, next.headline.proven], [grove.headline.inFlight, grove.headline.frontier, grove.headline.proven])
  assert.equal(Grove.patch(next, { at: 8, event: 'doing', node: busy, seq: 4, text: '' }), next)
  assert.equal(Grove.patch(next, { at: 8, event: 'progress', node: busy, seq: 5, text: '' }), next)
})
