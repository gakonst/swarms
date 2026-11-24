import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Answer from '../src/shared/Answer.ts'
import * as Prose from '../src/shared/Prose.ts'

const report = '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.** It is memory bound.\n\n| Parser | GiB/s |\n| --- | --- |\n| sonic-rs | 1.55 |\n\n\`\`\`rust\nlet value = sonic_rs::from_slice(&line)?;\n\`\`\`\n\nNext: measure bandwidth with \`mbw\`.'

test('a block of Markdown becomes one line that keeps its inline markup and drops tables and code blocks', () => {
  assert.equal(Prose.line(report), '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.** It is memory bound. Next: measure bandwidth with \`mbw\`.')
  assert.equal(Prose.line('# Plan\n- first item\n- second item\n\nThen a paragraph\nthat wraps.'), 'Plan · first item · second item · Then a paragraph that wraps.')
})

test('a cut never ends inside markup', () => {
  assert.equal(Prose.clip(Prose.line(report), 40), '**Headline: sonic-rs parses a TiB for…**')
  assert.equal(Prose.clip('see \`sonic_rs::from_slice\` now', 12), 'see \`sonic_r\`…')
  assert.equal(Prose.clip('a [link text here](https://x.test/z) and more', 10), 'a link…')
  assert.equal(Prose.clip('*one* **two three four five six**', 20), '*one* **two three four…**')
  assert.equal(Prose.clip('short **enough**', 40), 'short **enough**')
})

test('sentences close and reopen the markup they span', () => {
  assert.deepEqual(Prose.sentences('**A one. B two.** C three. D'), ['**A one.**', '**B two.**', 'C three.', 'D'])
  assert.deepEqual(Prose.sentences('It costs 0.21 per TiB. Next.'), ['It costs 0.21 per TiB.', 'Next.'])
})

test('plain text drops the markup and keeps what it shows', () => {
  assert.equal(Prose.plain('**Bold** \`code_x\` [link](https://x.test) 2 * 3 snake_case'), 'Bold code_x link 2 * 3 snake_case')
})

test('one-line summaries of an update keep their markup whole', () => {
  assert.equal(Answer.opening(report, 'Parse a terabyte'), '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs, and 16 CPUs buys nothing.**')
  assert.equal(Answer.brief(report, 60), '**Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs,…**')
  assert.equal(Answer.excerpt(report, 60), 'Headline: sonic-rs parses a TiB for 0.21 MACH on 8 CPUs,…')
})
