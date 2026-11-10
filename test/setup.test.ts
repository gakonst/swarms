import assert from 'node:assert/strict'
import test from 'node:test'
import * as Setup from '../src/shared/Setup.ts'
import * as Phase from '../src/worker/Phase.ts'

const prices = new Map<string, Setup.Price>([
  [Setup.opus, { cached: 0.2, id: Setup.opus, input: 4, output: 20 }],
  [Setup.sol, { cached: 0.1, id: Setup.sol, input: 2, output: 10 }],
  [Setup.astra, { cached: 1, id: Setup.astra, input: 10, output: 50 }],
  [Setup.flash, { cached: 0.0048, id: Setup.flash, input: 0.24, output: 0.96 }],
  [Setup.glmFlash, { cached: 0.024, id: Setup.glmFlash, input: 0.12, output: 0.4 }],
  [Setup.glm, { cached: 0.14, id: Setup.glm, input: 1.12, output: 3.52 }],
  [Setup.kimi, { cached: 0.2, id: Setup.kimi, input: 1.7, output: 8.5 }],
])

function priced(choice: Setup.Choice) {
  const resolved = Setup.resolve(choice)
  assert.notEqual(typeof resolved, 'string')
  const setup = Setup.priced(resolved as Exclude<typeof resolved, string>, prices)
  assert.notEqual(typeof setup, 'string')
  return setup as Setup.Setup
}

test('the default runs on the cheapest models Boundless serves: Codex on DeepSeek Flash leads, and subagents use DeepSeek Flash or GLM Flash', () => {
  assert.equal(Setup.fallback, 'cheap')
  const setup = priced({ template: Setup.fallback })
  assert.deepEqual({ harness: setup.harness, model: setup.model, subagents: setup.subagents }, { harness: 'codex', model: Setup.flash, subagents: { harnesses: ['codex', 'claude'], models: [Setup.flash, Setup.glmFlash] } })
  assert.equal(setup.most, String(Setup.least))
})

test('frontier mix leads with Claude Code on Opus and offers Opus, Kimi K3.1 Pro and GLM-5.3 under both harnesses', () => {
  const setup = priced({ template: 'frontier-mix' })
  assert.equal(setup.harness, 'claude')
  assert.equal(setup.model, Setup.opus)
  assert.deepEqual(setup.subagents, { harnesses: ['claude', 'codex'], models: [Setup.opus, Setup.kimi, Setup.glm] })
  assert.equal(setup.step, '37600')
  assert.equal(setup.most, '220480')
  assert.deepEqual(setup.steps, { [Setup.glm]: '12480', [Setup.kimi]: '21500', [Setup.opus]: '37600' })
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
  assert.match(told, /vercel\/moonshotai\/kimi-k3\.1-pro \(about \$0\.021 a call\)/)
  assert.match(told, /at least 20 of its model's calls/)
})
