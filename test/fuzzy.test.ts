import assert from 'node:assert/strict'
import test from 'node:test'
import * as Fuzzy from '../src/shared/Fuzzy.ts'

function best(query: string, titles: readonly string[]) {
  return titles
    .map((title) => ({ hit: Fuzzy.match(query, title), title }))
    .filter((each) => each.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score)
    .map((each) => each.title)
}

const titles = ['Does P = NP?', 'Better post-quantum signatures', 'Benchmark every open-weight coding model', 'Port SQLite to Rust', 'Faster JSON parser', 'Prove the Riemann hypothesis in Lean']

test('a query matches substrings first, then letters in order, across words in any order', () => {
  assert.deepEqual(best('np', titles).slice(0, 1), ['Does P = NP?'])
  assert.deepEqual(best('quantum', titles), ['Better post-quantum signatures'])
  assert.deepEqual(best('pqs', titles)[0], 'Better post-quantum signatures')
  assert.deepEqual(best('rust port', titles), ['Port SQLite to Rust'])
  assert.deepEqual(best('bench code', titles), ['Benchmark every open-weight coding model'])
  assert.deepEqual(best('jsn', titles), ['Faster JSON parser'])
  assert.deepEqual(best('riemann lean', titles), ['Prove the Riemann hypothesis in Lean'])
  assert.deepEqual(best('zzz', titles), [])
  assert.equal(Fuzzy.match('', 'anything'), undefined)
  assert.equal(Fuzzy.match('x', 'Faster JSON parser'), undefined)
})

test('a word start or an early match ranks above one buried in the middle', () => {
  const ranked = best('par', ['Compare sorting', 'Faster JSON parser', 'Paradigm swarms'])
  assert.deepEqual(ranked, ['Paradigm swarms', 'Faster JSON parser', 'Compare sorting'])
})

test('accents fold, and marks cover exactly the matched letters', () => {
  assert.ok(Fuzzy.match('erdos', 'Erdős problems'))
  const hit = Fuzzy.match('np', 'Does P = NP?')!
  assert.deepEqual(hit.marks, [9, 10])
  assert.deepEqual(Fuzzy.spans('Does P = NP?', hit.marks), [{ lit: false, text: 'Does P = ' }, { lit: true, text: 'NP' }, { lit: false, text: '?' }])
  const spread = Fuzzy.match('pqs', 'Better post-quantum signatures')!
  assert.deepEqual(spread.marks.map((at) => 'Better post-quantum signatures'[at]), ['p', 'q', 's'])
})
