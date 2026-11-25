import assert from 'node:assert/strict'
import test from 'node:test'
import type * as Tree from '../src/shared/Tree.ts'
import { fromTree } from '../src/web/channels.ts'

function node(id: string, children: string[], pledged = '0', status: Tree.Status = 'proposed') {
  return { children, counts: { 'in flight': 0 }, id, money: { subtree: { pledged } }, run: null, status, title: id, updatedAt: 1 } as unknown as Tree.Node
}

test('a swarm has one channel: every item of its tree is a thread of #general, with no per-program channels', () => {
  const shape = fromTree([node('root', ['a', 'b']), node('a', ['a1']), node('b', [], '5'), node('a1', [], '1', 'in flight')])
  assert.deepEqual(Object.keys(shape), ['threads'])
  assert.deepEqual(shape.threads.map((thread) => thread.id), ['a1', 'b', 'a'])
})
