import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Surface from '../src/shared/Surface.ts'

test('a surface reads the kinds it knows and drops the rest', () => {
  const nodes = Surface.read({
    nodes: [
      { id: 'stats', kind: 'stats', items: [{ label: 'best', value: '1.40×' }, { label: 'no value' }] },
      { id: 'plan', kind: 'checklist', items: [{ text: 'Baseline', state: 'done' }, { text: 'Attention', state: 'running' }, 'Glue fusion'] },
      { id: 'chart', kind: 'chart', points: [1, '1.07', 1.4], tried: [[2, 1.1], ['x', 1]], goal: 2.61 },
      { id: 'map', kind: 'graph', nodes: [] },
      { id: 'needs', kind: 'attention', items: [{ text: 'Fund the attention rewrite', amount: '$5', why: 'It is the slowest part' }, { text: 'Lend a Hand that knows CUTLASS', action: 'lend' }] },
      { id: 'empty', kind: 'list', items: [] },
      'not a node',
    ],
  })
  assert.deepEqual(nodes.map((node) => node.kind), ['asks', 'stats', 'checklist', 'chart'])
  const [asks, stats, plan, chart] = nodes
  assert.equal(asks?.kind === 'asks' && asks.items[0]?.action, 'back')
  assert.equal(asks?.kind === 'asks' && asks.items[1]?.action, 'chat')
  assert.equal(stats?.kind === 'stats' && stats.items.length, 1)
  assert.deepEqual(plan?.kind === 'checklist' && plan.items.map((item) => item.state), ['done', 'doing', 'todo'])
  assert.deepEqual(chart?.kind === 'chart' && [chart.points, chart.tried], [[1, 1.07, 1.4], [[2, 1.1]]])
})

test('a surface keeps values in range and ids unique', () => {
  const nodes = Surface.read([
    { id: 'tests', kind: 'meter', value: 1300, max: 1248 },
    { id: 'tests', kind: 'meter', value: 1, max: 2 },
    { id: 'est', kind: 'estimate', low: 1.2, mid: 2.1, high: 3.8, unit: 'T' },
    { id: 'bad', kind: 'range', low: 3, mid: 2, high: 4 },
    { id: 'files', kind: 'tiles', items: [{ label: 'parser.rs', state: 'tested' }, { label: 'ffi.rs', state: 'porting' }, 'utils.rs'] },
  ])
  assert.deepEqual(nodes.map((node) => node.id), ['tests', 'est', 'files'])
  assert.equal(nodes[0]?.kind === 'meter' && nodes[0].value, 1248)
  assert.deepEqual(nodes[2]?.kind === 'tiles' && nodes[2].items.map((tile) => tile.tone), ['good', 'warn', null])
})

test('a surface caps its size and ignores anything else', () => {
  assert.equal(Surface.read(Array.from({ length: 40 }, (_, index) => ({ id: String(index), kind: 'text', text: 'x' }))).length, 12)
  assert.deepEqual(Surface.parse('not json'), [])
  assert.deepEqual(Surface.parse('{"kind":"text","text":"x"}'), [])
  assert.equal(Surface.is({ form: 'json', slug: 'surface', title: 'Surface' }), true)
  assert.equal(Surface.is({ form: 'page', slug: 'surface', title: 'Surface' }), false)
})

test('the status node is kept apart from what the surface lays out, and a statement grid keeps every tile', () => {
  const nodes = Surface.read({ nodes: [{ id: 's', kind: 'status', items: ['one', 'two'] }, { id: 't', kind: 'tiles', items: Array.from({ length: 60 }, (_, index) => ({ label: String(index + 1), state: 'open' })) }] })
  assert.deepEqual(Surface.status(nodes), ['one', 'two'])
  assert.deepEqual(Surface.shown(nodes).map((node) => node.kind), ['tiles'])
  assert.equal(nodes[1]?.kind === 'tiles' && nodes[1].items.length, 60)
})

test('a swarm without a surface shows who is on what from its branches', () => {
  const branch = (id: number, state: 'running' | 'completed' | 'failed' | 'closed', extra: object = {}) => ({ budget: null, error: null, funded: '0', funders: [], id, left: null, parent: null, result: null, role: 'helper', spent: null, starved: false, state, task: 'Prove **statement** ' + id + '\nand more', who: 'helper-' + id, ...extra })
  assert.deepEqual(Surface.crew([]), [])
  assert.deepEqual(Surface.crew([branch(1, 'running', { parent: 7 })]), [])
  const [node] = Surface.crew([branch(1, 'completed', { result: 'Proved it.' }), branch(2, 'running'), branch(3, 'failed', { starved: true }), branch(4, 'closed'), branch(5, 'running', { parent: 2 })])
  assert.equal(node?.kind, 'list')
  assert.deepEqual(
    node?.kind === 'list' && node.items.map((row) => [row.text, row.state, row.tone, row.note]),
    [
      ['helper-2', 'working', 'live', 'Prove statement 2'],
      ['helper-4', 'stopped', 'quiet', 'Prove statement 4'],
      ['helper-3', 'out of budget', 'warn', 'Prove statement 3'],
      ['helper-1', 'done', 'good', 'Proved it.'],
    ],
  )
})
