import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Board } from 'nanocode-ts'
import * as Tree from '../src/shared/Tree.ts'

function task(id: string, phase: Board.Phase, stage: Board.Stage): Board.Task {
  return { assignee: null, attempts: 0, dueAtMs: null, id, labels: {}, needs: [], parent: null, phase, rank: null, replies: [], spec: id, stage }
}

test('status is derived from the node, its runs and its verifies', () => {
  const node = task('n:a', 'open', 'open')
  assert.equal(Tree.status({ node, runs: [], verifies: [] }), 'proposed')
  assert.equal(Tree.status({ node, runs: [task('r:a:1', 'done', 'done')], verifies: [] }), 'proposed')
  assert.equal(Tree.status({ node, runs: [task('r:a:1', 'open', 'open')], verifies: [] }), 'funded')
  assert.equal(Tree.status({ node, runs: [task('r:a:1', 'open', 'scheduled')], verifies: [] }), 'funded')
  assert.equal(Tree.status({ node, runs: [task('r:a:1', 'blocked', 'blocked')], verifies: [] }), 'funded')
  assert.equal(Tree.status({ node, runs: [task('r:a:1', 'claimed', 'held')], verifies: [] }), 'in flight')
  assert.equal(Tree.status({ node, runs: [task('r:a:1', 'claimed', 'lapsed')], verifies: [] }), 'in flight')
  assert.equal(Tree.status({ node, runs: [], verifies: [task('v:a:1', 'open', 'open')] }), 'in flight')
  assert.equal(Tree.status({ node, runs: [], verifies: [task('v:a:1', 'failed', 'failed')] }), 'proposed')
  assert.equal(Tree.status({ node: task('n:a', 'done', 'done'), runs: [task('r:a:1', 'claimed', 'held')], verifies: [] }), 'proven')
  assert.equal(Tree.status({ node: task('n:a', 'failed', 'failed'), runs: [], verifies: [] }), 'dead end')
  assert.equal(Tree.status({ node: task('n:a', 'cancelled', 'cancelled'), runs: [], verifies: [] }), 'dead end')
})

function node(id: string, status: Tree.Status, extra: Partial<Tree.Node> = {}): Tree.Node {
  const zero = '0.000000'
  return {
    by: { address: null, agent: null, handle: 'x' },
    children: [],
    counts: { 'dead end': 0, funded: 0, 'in flight': 0, proposed: 0, proven: 0 },
    createdAt: 0,
    end: null,
    form: 'lemma',
    funders: [],
    id,
    money: { committed: zero, granted: zero, inherited: zero, left: zero, pledged: zero, spent: zero, subtree: { left: zero, pledged: zero, spent: zero } },
    needs: [],
    parent: 'root',
    proof: null,
    riders: 0,
    run: null,
    spec: id,
    statement: null,
    status,
    title: id,
    updatedAt: 0,
    ...extra,
  }
}

test('the headline counts without a growing denominator', () => {
  const money = (spent: string, pledged: string) => ({ committed: '0', granted: '0', inherited: '0', left: '0', pledged, spent, subtree: { left: '0', pledged: '0', spent: '0' } })
  const proof = (at: number) => ({ at } as Tree.Check)
  const nodes = [
    node('root', 'funded', { form: 'goal', money: money('0.500000', '10.000000'), parent: null }),
    node('a', 'proven', { money: money('3.000000', '0'), proof: proof(5) }),
    node('b', 'proven', { money: money('2.000000', '0'), proof: proof(9) }),
    node('c', 'in flight', { needs: ['a'] }),
    node('d', 'proposed', { needs: ['a', 'e'] }),
    node('e', 'dead end'),
    node('f', 'funded', { form: 'program' }),
  ]
  assert.deepEqual(Tree.headline(nodes), { deadEnds: 1, frontier: 1, inFlight: 1, lastProvenAt: 9, pledged: '10.000000', perProven: '2.750000', proven: 2, spent: '5.500000' })
  assert.deepEqual(Tree.headline([]), { deadEnds: 0, frontier: 0, inFlight: 0, lastProvenAt: null, pledged: '0.000000', perProven: null, proven: 0, spent: '0.000000' })
})
