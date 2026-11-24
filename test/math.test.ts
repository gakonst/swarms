import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Maths from '../src/shared/Math.ts'
import * as Prose from '../src/shared/Prose.ts'

test('math between dollar signs, parentheses and brackets is found, and prices are not', () => {
  assert.deepEqual(Maths.span('$x^2$ tail', 0), { body: 'x^2', display: false, end: 5 })
  assert.deepEqual(Maths.span('\\(a_i\\)', 0), { body: 'a_i', display: false, end: 7 })
  assert.deepEqual(Maths.span('\\[ a+b \\]', 0), { body: 'a+b', display: true, end: 9 })
  assert.deepEqual(Maths.span('$$ \\frac{a}{b} $$', 0), { body: '\\frac{a}{b}', display: true, end: 17 })
  assert.equal(Maths.span('$5 and $10', 0), undefined)
  assert.equal(Maths.span('$ x$', 0), undefined)
  assert.equal(Maths.span('$x$5', 0), undefined)
  assert.equal(Maths.span('\\(open', 0), undefined)
  assert.equal(Maths.span('\\[a\n\nb\\]', 0), undefined)
})

test('normalize turns LaTeX delimiters into the ones the renderer reads, outside code', () => {
  assert.equal(Maths.normalize('so \\(x^2\\) and \\[y\\] end', false), 'so $x^2$ and $$y$$ end')
  assert.equal(Maths.normalize('\\[\na &= b \\\\\n c\n\\]', false), '\n\n$$\na &= b \\\\\nc\n$$\n\n')
  assert.equal(Maths.normalize('so \\(x\\) and \\[y\\] and $$z$$ end', true), 'so $x$ and $y$ and $z$ end')
  assert.equal(Maths.normalize('keep $a$ and $$b$$', false), 'keep $a$ and $$b$$')
  assert.equal(Maths.normalize('code \x60\\(x\\)\x60 and \\$5 \\(y\\)', false), 'code \x60\\(x\\)\x60 and \\$5 $y$')
  assert.equal(Maths.normalize('\x60\x60\x60tex\n\\(x\\)\n\x60\x60\x60\n\\(y\\)', false), '\x60\x60\x60tex\n\\(x\\)\n\x60\x60\x60\n$y$')
  assert.equal(Maths.normalize('|S| = 2^e·3^{(n−e)/2}, ν = Σ⌊m_j/2⌋ costs $5 and $10', false), '|S| = 2^e·3^{(n−e)/2}, ν = Σ⌊m_j/2⌋ costs $5 and $10')
})

test('a one-line cut keeps a formula whole and its underscores are not emphasis', () => {
  assert.equal(Prose.clip('Bound $a_i + b_i$ then \\(c_j\\) holds across many rounds of work', 22), 'Bound $a_i + b_i$ then…')
  assert.equal(Prose.plain('Bound $a_i + b_i$ and \\(c_j\\)'), 'Bound a_i + b_i and c_j')
  assert.deepEqual(Prose.sentences('Show $x_1 = y_1$. Then \\(z\\) follows. Done'), ['Show $x_1 = y_1$.', 'Then \\(z\\) follows.', 'Done'])
  assert.equal(Prose.line('Claim\n\\[\nx_1 = 2\n\\]\nthen done'), 'Claim $x_1 = 2$ then done')
})
