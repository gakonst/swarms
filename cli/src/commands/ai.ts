import { ask, type Context, Failure, swarm } from '../context.ts'
import * as Limits from '../../../src/shared/Limits.ts'

type OwnAi = { keys: { added_at: number; hint: string; provider: string }[]; plans: Partial<Record<string, { state: string }>> }

const actions = new Set(['status', 'set', 'rm', 'connect', 'finish', 'signout', 'on', 'off'])

const plans = [
  ['claude', 'Claude plan'],
  ['codex', 'ChatGPT plan'],
  ['antigravity', 'Antigravity'],
] as const

function shown(read: OwnAi) {
  const keys = read.keys.length ? read.keys.map((each) => `${each.provider.padEnd(Limits.Cli.providerPad)} …${each.hint}`) : ['No keys yet. Add one with swarms byok set anthropic|openai.']
  return [...keys, ...plans.map(([plan]) => `${plan.padEnd(Limits.Cli.providerPad)} ${read.plans[plan]?.state ?? 'coming soon'}`)].join('\n')
}

export async function byok(ctx: Context) {
  const action = ctx.args[1] ?? 'status'
  if (!actions.has(action)) throw new Failure(`swarms byok ${action} is not a command.`, { code: 'usage', exit: 2, next: 'Run swarms byok, swarms byok set|rm <provider>, swarms byok connect|finish|signout <plan> or swarms byok on|off <swarm>.' })
  const config = await ctx.api<{ ownAi?: boolean }>('GET', '/v1/config')
  if (config.ownAi !== true) {
    if (action === 'status') return ctx.out({ available: false }, 'Own AI is not available yet: swarms run on the money riders send them.')
    throw new Failure('Own AI is not available yet.', { code: 'unavailable', next: 'Swarms run on the money riders send them until it is; ride one with swarms fund.', status: Limits.Http.unavailable })
  }
  await ctx.signed()
  if (action === 'on' || action === 'off') {
    const id = await swarm(ctx, ctx.need(2, 'the swarm'))
    const read = await ctx.api<Record<string, unknown>>('POST', `/v1/swarms/${encodeURIComponent(id)}/ai`, { on: action === 'on' })
    return ctx.out(read, action === 'on' ? 'The swarm now runs on your own AI.' : "The swarm runs on its own money again.")
  }
  if (action === 'connect') {
    const plan = ctx.need(2, 'the plan, claude, codex or antigravity')
    const started = await ctx.api<{ code?: string; url: string }>('POST', `/v1/me/ai/${encodeURIComponent(plan)}`, {})
    const finish = plan === 'claude' ? `then swarms byok finish ${plan} <the code it shows>` : `then swarms byok finish ${plan}`
    return ctx.out(started, [`Open ${started.url}`, ...(started.code ? [`and enter ${started.code}`] : []), finish].join('\n'))
  }
  let read: OwnAi
  if (action === 'set') {
    const provider = ctx.need(2, 'the provider, anthropic or openai')
    const key = ctx.flag('key') ?? (process.stdin.isTTY ? await ask(`${provider} API key: `) : (await new Response(process.stdin as unknown as ReadableStream).text()).trim())
    if (!key) throw new Failure('Missing the key.', { code: 'usage', exit: 2, next: `Pass --key, or pipe it: swarms byok set ${provider} < key.txt` })
    read = await ctx.api<OwnAi>('PUT', `/v1/me/ai/keys/${encodeURIComponent(provider)}`, { key })
  } else if (action === 'rm') read = await ctx.api<OwnAi>('DELETE', `/v1/me/ai/keys/${encodeURIComponent(ctx.need(2, 'the provider, anthropic or openai'))}`)
  else if (action === 'finish') read = await ctx.api<OwnAi>('POST', `/v1/me/ai/${encodeURIComponent(ctx.need(2, 'the plan, claude, codex or antigravity'))}/complete`, { code: ctx.args[Limits.Cli.planCodeArg] ?? '' })
  else if (action === 'signout') read = await ctx.api<OwnAi>('DELETE', `/v1/me/ai/${encodeURIComponent(ctx.need(2, 'the plan, claude, codex or antigravity'))}`)
  else read = await ctx.api<OwnAi>('GET', '/v1/me/ai')
  ctx.out({ available: true, ...read }, shown(read))
}
