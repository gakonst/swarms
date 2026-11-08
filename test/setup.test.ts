import assert from 'node:assert/strict'
import test from 'node:test'
import * as Setup from '../src/shared/Setup.ts'
import * as Phase from '../src/worker/Phase.ts'

const prices = new Map<string, Setup.Price>([
  [Setup.opus, { cached: 0.2, id: Setup.opus, input: 4, output: 20 }],
  [Setup.sol, { cached: 0.1, id: Setup.sol, input: 2, output: 10 }],
  [Setup.astra, { cached: 1, id: Setup.astra, input: 10, output: 50 }],
  [Setup.flash, { cached: 0.0048, id: Setup.flash, input: 0.24, output: 0.96 }],
])

function priced(choice: Setup.Choice) {
  const resolved = Setup.resolve(choice)
  assert.notEqual(typeof resolved, 'string')
  const setup = Setup.priced(resolved as Exclude<typeof resolved, string>, prices)
  assert.notEqual(typeof setup, 'string')
  return setup as Setup.Setup
}

test('frontier mix leads with Claude Code on Opus and offers Opus, Sol and Astra under both harnesses', () => {
  const setup = priced({ template: 'frontier-mix' })
  assert.equal(setup.harness, 'claude')
  assert.equal(setup.model, Setup.opus)
  assert.deepEqual(setup.subagents, { harnesses: ['claude', 'codex'], models: [Setup.opus, Setup.sol, Setup.astra] })
  assert.equal(setup.step, '37600')
  assert.equal(setup.most, '220480')
  assert.deepEqual(setup.steps, { [Setup.astra]: '118000', [Setup.opus]: '37600', [Setup.sol]: '18800' })
})

test('frontier OpenAI leads on Sol, frontier Anthropic is Opus only, and free for all offers any subagent model', () => {
  assert.equal(priced({ template: 'frontier-openai' }).model, Setup.sol)
  assert.deepEqual(priced({ template: 'frontier-anthropic' }).subagents, { harnesses: ['claude'], models: [Setup.opus] })
  const free = priced({ template: 'free' })
  assert.equal(free.subagents, null)
  assert.equal(free.most, String(Setup.least))
})

test('a custom setup names its lead and only offers models the gateway prices', () => {
  assert.equal(typeof Setup.resolve({ template: 'custom' }), 'string')
  const resolved = Setup.resolve({ harness: 'codex', model: 'nope/model', subagents: null, template: 'custom' })
  assert.match(String(Setup.priced(resolved as Exclude<typeof resolved, string>, prices)), /nope\/model/)
  assert.deepEqual(priced({ harness: 'codex', model: Setup.sol, subagents: { harnesses: ['codex'], models: [Setup.sol] }, template: 'custom' }).subagents, { harnesses: ['codex'], models: [Setup.sol] })
})

test("a swarm's reserve and call come from its lead model, and older swarms keep the cheap defaults", () => {
  const setup = priced({ template: 'frontier-mix' })
  assert.equal(Setup.reserve(setup), 220_480n)
  assert.equal(Setup.reserve(null), 50_000n)
  assert.equal(Setup.call(setup, 20_000n), 37_600n)
  assert.equal(Setup.call(null, 20_000n), 20_000n)
})

test('the brief tells the agent its models, their costs and the budget floor', () => {
  const told = Setup.told(priced({ template: 'frontier-mix' }))
  assert.match(told, /Claude Code with vercel\/anthropic\/claude-opus-5\.5/)
  assert.match(told, /vercel\/openai\/gpt-6\.1-sol \(about \$0\.019 a call\)/)
  assert.match(told, /at least 20 of its model's calls/)
})
