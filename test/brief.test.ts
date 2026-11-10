import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Brief from '../src/shared/Brief.ts'
import * as Surface from '../src/shared/Surface.ts'

test('an update with a list gives its first three bullets, plain', () => {
  const lines = Brief.bullets('## Round 4 update\n\nSome intro.\n\n- **Proved** statement 3 on `main`\n- Wired [#9](https://x.test) to Kummer\n- Helper 2 is out of budget\n- A fourth point\n\nSTATUS: continue')
  assert.deepEqual(lines, ['Proved statement 3 on main', 'Wired #9 to Kummer', 'Helper 2 is out of budget'])
})

test('an update in prose gives its first three sentences, without headings and tables', () => {
  const lines = Brief.bullets('# Status\n\nThe baseline runs at 1.00x. Fusing the dense layers gave 1.07x, e.g. on v1.2 inputs. Attention is next.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nA fourth sentence.')
  assert.deepEqual(lines, ['The baseline runs at 1.00x.', 'Fusing the dense layers gave 1.07x, e.g. on v1.2 inputs.', 'Attention is next.'])
})

test('a long line is cut', () => {
  const [line = ''] = Brief.bullets('- ' + 'word '.repeat(80) + '\n- two')
  assert.equal(line.length, 220)
  assert.ok(line.endsWith('…'))
})

test('the status the lead keeps on its surface wins', () => {
  const status = Surface.status(Surface.read({ nodes: [{ kind: 'status', items: ['Six of 60 proved.', { text: 'Helper 3 is on the PID statements.' }, 'Next: Kummer.', 'A fourth'] }, { kind: 'stats', items: [{ label: 'a', value: '1' }] }] }))
  assert.deepEqual(status, ['Six of 60 proved.', 'Helper 3 is on the PID statements.', 'Next: Kummer.'])
  const brief = Brief.brief({ status, surfaced: { summary: 'old summary', updatedAt: 50 }, update: { at: 90, text: '- a later update\n- with bullets' } })
  assert.deepEqual(brief, { at: 50, lines: status })
})

test('without one, the newer of the latest update and the surface summary is told', () => {
  const update = { at: 100, text: 'Proved the first lemma. Started the second.' }
  const surfaced = { summary: '5 of 60 statements proved on main; 14 more wired to lower statements', updatedAt: 200 }
  assert.deepEqual(Brief.brief({ status: [], surfaced, update }), { at: 200, lines: ['5 of 60 statements proved on main', '14 more wired to lower statements'] })
  assert.deepEqual(Brief.brief({ status: [], surfaced: { ...surfaced, updatedAt: 50 }, update }), { at: 100, lines: ['Proved the first lemma.', 'Started the second.'] })
  assert.deepEqual(Brief.brief({ status: [], surfaced, update: undefined })?.lines.length, 2)
  assert.equal(Brief.brief({ status: [], surfaced: { summary: null, updatedAt: 1 }, update: { at: 2, text: '  ' } }), null)
  assert.equal(Brief.brief({ status: [] }), null)
})
