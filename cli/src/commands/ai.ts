import { ask, type Context, Failure, swarm } from '../context.ts'
import * as Limits from '../../../src/shared/Limits.ts'

type OwnAi = { keys: { added_at: number; hint: string; provider: string }[]; plans: { claude: { state: string } } }

const actions = new Set(['status', 'set', 'rm', 'on', 'off'])

export async function byok(ctx: Context) {
  const action = ctx.args[1] ?? 'status'
  if (!actions.has(action)) throw new Failure(`swarms byok ${action} is not a command.`, { code: 'usage', exit: 2, next: 'Run swarms byok, swarms byok set|rm <provider> or swarms byok on|off <swarm>.' })
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
  let read: OwnAi
  if (action === 'set') {
    const provider = ctx.need(2, 'the provider, anthropic or openai')
    const key = ctx.flag('key') ?? (process.stdin.isTTY ? await ask(`${provider} API key: `) : (await new Response(process.stdin as unknown as ReadableStream).text()).trim())
    if (!key) throw new Failure('Missing the key.', { code: 'usage', exit: 2, next: `Pass --key, or pipe it: swarms byok set ${provider} < key.txt` })
    read = await ctx.api<OwnAi>('PUT', `/v1/me/ai/keys/${encodeURIComponent(provider)}`, { key })
  } else if (action === 'rm') read = await ctx.api<OwnAi>('DELETE', `/v1/me/ai/keys/${encodeURIComponent(ctx.need(2, 'the provider, anthropic or openai'))}`)
  else read = await ctx.api<OwnAi>('GET', '/v1/me/ai')
  ctx.out({ available: true, ...read }, [...(read.keys.length ? read.keys.map((each) => `${each.provider.padEnd(Limits.Cli.providerPad)} …${each.hint}`) : ['No keys yet. Add one with swarms byok set anthropic|openai.']), `claude     ${read.plans.claude.state}`].join('\n'))
}
