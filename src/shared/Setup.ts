export const harnesses = ['claude', 'codex'] as const

export type Harness = (typeof harnesses)[number]

export const templates = ['cheap', 'frontier-mix', 'fable', 'frontier-anthropic', 'frontier-openai', 'free', 'custom'] as const

export type Template = (typeof templates)[number]

export type Offer = { harnesses: Harness[]; models: string[] }

export type Price = { cached: number; id: string; input: number; output: number }

export type Costs = { most: string; step: string; steps: Record<string, string> }

export type Setup = { harness: Harness; model: string; subagents: Offer | null; template: Template } & Costs

export type Choice = { harness?: Harness | undefined; model?: string | undefined; subagents?: Offer | null | undefined; template: Template }

export const fable = 'boundless/anthropic/claude-fable-5.2'

export const fable51 = 'vercel/anthropic/claude-fable-5.1'

export const opus = 'vercel/anthropic/claude-opus-5.5'

export const sol = 'vercel/openai/gpt-6.1-sol'

export const astra = 'vercel/openai/gpt-6-astra'

export const flash = '@cf/deepseek-ai/deepseek-v4.1-flash-1017'

export const glmFlash = '@cf/zai-org/glm-5.3-flash'

export const glm = '@cf/zai-org/glm-5.3'

export const kimi = 'vercel/moonshotai/kimi-k3.1-pro'

const moves: Record<string, string> = {
  'boundless/anthropic/claude-fable-5.2': fable51,
  'boundless/anthropic/claude-opus-5.5': opus,
  'boundless/deepseek/deepseek-v4.1-flash-1017': flash,
  'boundless/moonshotai/kimi-k3.1-pro': kimi,
  'boundless/z-ai/glm-5.3': glm,
  'boundless/z-ai/glm-5.3-flash': glmFlash,
}

export function direct(model: string) {
  return model.startsWith('boundless/')
}

export function moved(setup: Omit<Setup, keyof Costs>, metered: { has(model: string): boolean }): Omit<Setup, keyof Costs> | undefined {
  const stranded = (model: string) => direct(model) && !metered.has(model)
  const models = [setup.model, ...(setup.subagents?.models ?? [])]
  if (!models.some(stranded)) return undefined
  const to = (model: string) => (stranded(model) ? (moves[model] ?? opus) : model)
  return {
    harness: setup.harness,
    model: to(setup.model),
    subagents: setup.subagents && { harnesses: setup.subagents.harnesses, models: [...new Set(setup.subagents.models.map(to))] },
    template: setup.template,
  }
}

export const fallback = 'frontier-anthropic' satisfies Template

export const presets: Record<Exclude<Template, 'custom'>, { harness: Harness; hint: string; label: string; model: string; subagents: Offer | null }> = {
  cheap: {
    harness: 'codex',
    hint: 'Codex on DeepSeek V4.1 Flash leads. Subagents use DeepSeek V4.1 Flash or GLM-5.3 Flash, the cheapest models the gateway offers, on Codex or Claude Code.',
    label: 'Cheapest',
    model: flash,
    subagents: { harnesses: ['codex', 'claude'], models: [flash, glmFlash] },
  },
  'frontier-mix': {
    harness: 'claude',
    hint: 'Claude Code on Opus 5.5 leads. Subagents use Opus 5.5, Kimi K3.1 Pro or GLM-5.3, on Claude Code or Codex.',
    label: 'Frontier Mix',
    model: opus,
    subagents: { harnesses: ['claude', 'codex'], models: [opus, kimi, glm] },
  },
  fable: {
    harness: 'claude',
    hint: 'Claude Code on Fable 5.2 leads. Subagents use Fable 5.2, Opus 5.5, Kimi K3.1 Pro or GLM-5.3, on Claude Code or Codex.',
    label: 'Fable 5.2',
    model: fable,
    subagents: { harnesses: ['claude', 'codex'], models: [fable, opus, kimi, glm] },
  },
  'frontier-anthropic': {
    harness: 'claude',
    hint: 'Claude Code on Opus 5.5, for the lead and every subagent.',
    label: 'Anthropic',
    model: opus,
    subagents: { harnesses: ['claude'], models: [opus] },
  },
  'frontier-openai': {
    harness: 'codex',
    hint: 'Codex on GPT-6.1 Sol leads. Subagents use GPT-6.1 Sol or GPT-6 Astra.',
    label: 'OpenAI',
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
  cheap: presets.cheap.label,
  custom: 'Custom',
  fable: presets.fable.label,
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
  const missing = [setup.model, ...(setup.subagents?.models ?? [])].find((model) => !prices.has(model))
  if (missing && direct(missing)) return `${missing} is not metered by the gateway right now: each rider would pay its provider apart, call by call, which strands their money. Pick a model from GET /v1/config.`
  if (missing) return `${missing} is not a gateway model that calls tools.`
  const lead = prices.get(setup.model)
  if (!lead) return `${setup.model} is not a gateway model that calls tools.`
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
