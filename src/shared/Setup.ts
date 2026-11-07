export const harnesses = ['claude', 'codex'] as const

export type Harness = (typeof harnesses)[number]

export const templates = ['frontier-mix', 'frontier-anthropic', 'frontier-openai', 'free', 'custom'] as const

export type Template = (typeof templates)[number]

export type Offer = { harnesses: Harness[]; models: string[] }

export type Price = { cached: number; id: string; input: number; output: number }

export type Costs = { most: string; step: string; steps: Record<string, string> }

export type Setup = { harness: Harness; model: string; subagents: Offer | null; template: Template } & Costs

export type Choice = { harness?: Harness | undefined; model?: string | undefined; subagents?: Offer | null | undefined; template: Template }

export const opus = 'vercel/anthropic/claude-opus-5.5'

export const sol = 'vercel/openai/gpt-6.1-sol'

export const astra = 'vercel/openai/gpt-6-astra'

export const flash = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'

export const fallback: Template = 'frontier-mix'

export const presets: Record<Exclude<Template, 'custom'>, { harness: Harness; hint: string; label: string; model: string; subagents: Offer | null }> = {
  'frontier-mix': {
    harness: 'claude',
    hint: 'Claude Code on Opus 5.5 leads. Subagents use Opus 5.5, GPT-6.1 Sol or GPT-6 Astra, on Claude Code or Codex.',
    label: 'Frontier Mix',
    model: opus,
    subagents: { harnesses: ['claude', 'codex'], models: [opus, sol, astra] },
  },
  'frontier-anthropic': {
    harness: 'claude',
    hint: 'Claude Code on Opus 5.5, for the lead and every subagent.',
    label: 'Frontier Anthropic',
    model: opus,
    subagents: { harnesses: ['claude'], models: [opus] },
  },
  'frontier-openai': {
    harness: 'codex',
    hint: 'Codex on GPT-6.1 Sol leads. Subagents use GPT-6.1 Sol or GPT-6 Astra.',
    label: 'Frontier OpenAI',
    model: sol,
    subagents: { harnesses: ['codex'], models: [sol, astra] },
  },
  free: {
    harness: 'codex',
    hint: 'Codex on DeepSeek V4.1 Flash leads. Subagents use any model and harness the gateway offers.',
    label: 'Free For All',
    model: flash,
    subagents: null,
  },
}

export const labels: Record<Template, string> = {
  custom: 'Custom',
  free: presets.free.label,
  'frontier-anthropic': presets['frontier-anthropic'].label,
  'frontier-mix': presets['frontier-mix'].label,
  'frontier-openai': presets['frontier-openai'].label,
}

export const context = 50_000

export const fresh = 2_000

export const written = 1_000

export const longest = 1_024

export const least = 50_000n

export const budgetCalls = 20

export function resolve(choice: Choice): Omit<Setup, keyof Costs> | string {
  if (choice.template !== 'custom') {
    const preset = presets[choice.template]
    return { harness: preset.harness, model: preset.model, subagents: preset.subagents, template: choice.template }
  }
  if (!choice.harness || !choice.model) return 'A custom setup names the lead harness and model.'
  return { harness: choice.harness, model: choice.model, subagents: choice.subagents ?? null, template: 'custom' }
}

export function step(price: Price) {
  return ((context - fresh) * price.cached + fresh * price.input + written * price.output) / 1_000_000
}

export function most(price: Price) {
  return (context * price.input + longest * price.output) / 1_000_000
}

export function units(usd: number) {
  return BigInt(Math.ceil(usd * 1_000_000))
}

export function priced(setup: Omit<Setup, keyof Costs>, prices: ReadonlyMap<string, Price>): Setup | string {
  const lead = prices.get(setup.model)
  if (!lead) return `${setup.model} is not a gateway model that calls tools.`
  const missing = setup.subagents?.models.find((model) => !prices.has(model))
  if (missing) return `${missing} is not a gateway model that calls tools.`
  const reserve = units(most(lead))
  const steps = Object.fromEntries((setup.subagents?.models ?? []).map((model) => [model, String(units(step(prices.get(model)!)))]))
  return { ...setup, most: String(reserve > least ? reserve : least), step: String(units(step(lead))), steps }
}

export function told(setup: Setup) {
  const dollars = (value: string) => '$' + (Number(value) / 1_000_000).toFixed(Number(value) < 10_000 ? 4 : 3)
  const harness = (value: Harness) => (value === 'claude' ? 'Claude Code' : 'Codex')
  const lead = `Models (the swarm's ${labels[setup.template]} setup): you run on ${harness(setup.harness)} with ${setup.model}, about ${dollars(setup.step)} a model call at a ${context.toLocaleString('en-US')}-token context, mostly cached, and up to ${dollars(setup.most)} uncached.`
  if (!setup.subagents) return `${lead} Your subagents may use any harness and gateway model; frontier models cost far more a call, so size each subagent's budget_usd to the model you give it.`
  const offered = setup.subagents.models.map((model) => (setup.steps[model] ? `${model} (about ${dollars(setup.steps[model])} a call)` : model)).join(', ')
  return `${lead} Your subagents may use only the ${setup.subagents.harnesses.map(harness).join(' or ')} harness with ${offered}: name one of them as spawn_agent's model, since the gateway refuses any other. Give each subagent a budget_usd of at least ${budgetCalls} of its model's calls.`
}

export function reserve(setup: Pick<Setup, 'most'> | null | undefined) {
  return setup ? BigInt(setup.most) : least
}

export function call(setup: Pick<Setup, 'step'> | null | undefined, floor: bigint) {
  const typical = setup ? BigInt(setup.step) : 0n
  return typical > floor ? typical : floor
}

const brands: Record<string, string> = { claude: 'Claude', deepseek: 'DeepSeek', gemini: 'Gemini', glm: 'GLM-', gpt: 'GPT-', grok: 'Grok', kimi: 'Kimi' }

export function name(model: string) {
  const [first = model, ...rest] = (model.split('/').at(-1) ?? model).split('-').filter((part) => !/^\d{4}$/.test(part))
  const words = rest.map((part) => (/^[a-z]\d/.test(part) ? part.toUpperCase() : /^[a-z]/.test(part) ? part[0]!.toUpperCase() + part.slice(1) : part))
  const brand = brands[first] ?? first
  return brand.endsWith('-') ? `${brand}${words.join(' ')}` : [brand, ...words].join(' ')
}
