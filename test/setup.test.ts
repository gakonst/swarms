import assert from 'node:assert/strict'
import test from 'node:test'
import * as Setup from '../src/shared/Setup.ts'
import * as Phase from '../src/worker/Phase.ts'

const prices = new Map<string, Setup.Price>([
  [Setup.fable, { cached: 0.2, id: Setup.fable, input: 8, output: 40 }],
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

test('the default is Anthropic, Claude Code on Opus 5.5 for the lead and every subagent', () => {
  assert.equal(Setup.fallback, 'frontier-anthropic')
  const setup = priced({ template: Setup.fallback })
  assert.deepEqual({ harness: setup.harness, model: setup.model, subagents: setup.subagents }, { harness: 'claude', model: Setup.opus, subagents: { harnesses: ['claude'], models: [Setup.opus] } })
  assert.equal(setup.step, '37600')
})

test('the cheap template leads with Codex on DeepSeek Flash, and subagents use DeepSeek Flash or GLM Flash', () => {
  const setup = priced({ template: 'cheap' })
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

test('the Fable template leads with Claude Code on Fable 5.1 and offers Fable, Opus, Kimi K3.1 Pro and GLM-5.3', () => {
  const setup = priced({ template: 'fable' })
  assert.deepEqual({ harness: setup.harness, model: setup.model }, { harness: 'claude', model: 'vercel/anthropic/claude-fable-5.1' })
  assert.deepEqual(setup.subagents, { harnesses: ['claude', 'codex'], models: [Setup.fable, Setup.opus, Setup.kimi, Setup.glm] })
  assert.equal(setup.step, '65600')
  assert.equal(setup.most, '440960')
})

test('OpenAI leads on Sol, Anthropic is Opus 5.5 only, and free for all offers any subagent model', () => {
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

test('no template names a Boundless model, a custom setup that does is refused, and a swarm that ran on one is moved off it', () => {
  for (const preset of Object.values(Setup.presets)) for (const model of [preset.model, ...(preset.subagents?.models ?? [])]) assert.ok(!Setup.direct(model), model)
  assert.ok(Setup.direct('boundless/anthropic/claude-fable-5.2') && !Setup.direct(Setup.fable) && !Setup.direct(Setup.opus))
  const custom = Setup.resolve({ harness: 'claude', model: 'boundless/anthropic/claude-fable-5.2', template: 'custom' })
  assert.match(String(Setup.priced(custom as Exclude<typeof custom, string>, prices)), /do not run on Boundless/)
  const lent = Setup.resolve({ harness: 'claude', model: Setup.opus, subagents: { harnesses: ['claude'], models: ['boundless/z-ai/glm-5.3'] }, template: 'custom' })
  assert.match(String(Setup.priced(lent as Exclude<typeof lent, string>, prices)), /boundless\/z-ai\/glm-5\.3 is not offered/)
  assert.equal(Setup.moved({ harness: 'claude', model: Setup.opus, subagents: null, template: 'custom' }, prices), undefined)
  assert.deepEqual(
    Setup.moved({ harness: 'claude', model: 'boundless/anthropic/claude-fable-5.2', subagents: { harnesses: ['claude', 'codex'], models: ['boundless/anthropic/claude-fable-5.2', 'boundless/anthropic/claude-opus-5.5', 'boundless/moonshotai/kimi-k3.1-pro', 'boundless/z-ai/glm-5.3', Setup.opus, 'boundless/unknown/model'] }, template: 'fable' }, prices),
    { harness: 'claude', model: Setup.fable, subagents: { harnesses: ['claude', 'codex'], models: [Setup.fable, Setup.opus, Setup.kimi, Setup.glm] }, template: 'fable' },
  )
  assert.equal(Setup.moved({ harness: 'codex', model: 'boundless/deepseek/deepseek-v4.1-flash-1017', subagents: null, template: 'cheap' }, prices)?.model, Setup.flash)
})
