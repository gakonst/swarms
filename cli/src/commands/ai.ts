import { ask, type Context, Failure, sleep, swarm } from '../context.ts'
import * as Limits from '../../../src/shared/Limits.ts'

type OwnAi = { keys: { added_at: number; hint: string; provider: string }[]; plans: Partial<Record<string, { email?: string; state: string }>> }

const actions = new Set(['status', 'set', 'rm', 'connect', 'finish', 'signout', 'on', 'off'])

const plans = [
  ['claude', 'Claude plan'],
  ['codex', 'ChatGPT plan'],
  ['antigravity', 'Antigravity'],
] as const

function shown(read: OwnAi) {
  const keys = read.keys.length
    ? read.keys.map((each) => `${each.provider.padEnd(Limits.Cli.providerPad)} …${each.hint}`)
    : ['No keys yet. Add one with swarms byok set anthropic|openai.']
  return [
    ...keys,
    ...plans.map(
      ([plan]) =>
        `${plan.padEnd(Limits.Cli.providerPad)} ${read.plans[plan]?.state ?? 'coming soon'}${read.plans[plan]?.email ? ' as ' + read.plans[plan]?.email : ''}`,
    ),
  ].join('\n')
}

export async function byok(ctx: Context) {
  const action = ctx.args[1] ?? 'status'
  if (!actions.has(action))
    throw new Failure(`swarms byok ${action} is not a command.`, {
      code: 'usage',
      exit: 2,
      next: 'Run swarms byok, swarms byok set|rm <provider>, swarms byok connect|finish|signout <plan> or swarms byok on|off <swarm>.',
    })
  const config = await ctx.api<{ ownAi?: boolean }>('GET', '/v1/config')
  if (config.ownAi !== true) {
    if (action === 'status') return ctx.out({ available: false }, 'Own AI is not available yet: swarms run on the money riders send them.')
    throw new Failure('Own AI is not available yet.', {
      code: 'unavailable',
      next: 'Swarms run on the money riders send them until it is; ride one with swarms fund.',
      status: Limits.Http.unavailable,
    })
  }
  await ctx.signed()
  if (action === 'on' || action === 'off') {
    const id = await swarm(ctx, ctx.need(2, 'the swarm'))
    const read = await ctx.api<Record<string, unknown>>('POST', `/v1/swarms/${encodeURIComponent(id)}/ai`, { on: action === 'on' })
    return ctx.out(read, action === 'on' ? 'The swarm now runs on your own AI.' : 'The swarm runs on its own money again.')
  }
  if (action === 'connect') {
    const plan = ctx.need(2, 'the plan, claude, codex or antigravity')
    const started = await ctx.api<{ code?: string; expires_at?: number; poll_after_ms?: number; url: string }>(
      'POST',
      `/v1/me/ai/${encodeURIComponent(plan)}`,
      {},
    )
    if (started.code) {
      const url = new URL(started.url)
      url.searchParams.set('user_code', started.code)
      process.stderr.write(`Open ${url.href}
and enter ${started.code} if it asks. Waiting for ChatGPT…
`)
      const until = started.expires_at ?? Date.now() + Limits.OwnAiFlow.signInMs
      const waiting = async (gap: number): Promise<OwnAi | undefined> => {
        if (Date.now() >= until) return undefined
        await sleep(Math.min(gap, until - Date.now(), Limits.OwnAiFlow.pollCeilingMs))
        const now = await ctx.api<OwnAi>('GET', '/v1/me/ai')
        return now.plans[plan]?.state === 'authenticated' ? now : waiting(Math.min(gap * Limits.OwnAiFlow.pollBackoff, Limits.OwnAiFlow.pollCeilingMs))
      }
      const connected = await waiting(started.poll_after_ms ?? Limits.OwnAiFlow.pollMs)
      if (connected) return ctx.out({ available: true, ...connected }, shown(connected))
      throw new Failure("The ChatGPT sign-in didn't finish in time.", { code: 'expired', next: `Run swarms byok connect ${plan} again.` })
    }
    const finish =
      plan === 'codex'
        ? `then swarms byok finish ${plan}`
        : plan === 'antigravity'
          ? `then swarms byok finish ${plan} '<the address Google lands on>'`
          : `then swarms byok finish ${plan} <the code it shows>`
    return ctx.out(started, [`Open ${started.url}`, ...(started.code ? [`and enter ${started.code}`] : []), finish].join('\n'))
  }
  let read: OwnAi
  if (action === 'set') {
    const provider = ctx.need(2, 'the provider, anthropic or openai')
    const key =
      ctx.flag('key') ??
      (process.stdin.isTTY ? await ask(`${provider} API key: `) : (await new Response(process.stdin as unknown as ReadableStream).text()).trim())
    if (!key) throw new Failure('Missing the key.', { code: 'usage', exit: 2, next: `Pass --key, or pipe it: swarms byok set ${provider} < key.txt` })
    read = await ctx.api<OwnAi>('PUT', `/v1/me/ai/keys/${encodeURIComponent(provider)}`, { key })
  } else if (action === 'rm') read = await ctx.api<OwnAi>('DELETE', `/v1/me/ai/keys/${encodeURIComponent(ctx.need(2, 'the provider, anthropic or openai'))}`)
  else if (action === 'finish')
    read = await ctx.api<OwnAi>('POST', `/v1/me/ai/${encodeURIComponent(ctx.need(2, 'the plan, claude, codex or antigravity'))}/complete`, {
      code: ctx.args[Limits.Cli.planCodeArg] ?? '',
    })
  else if (action === 'signout') read = await ctx.api<OwnAi>('DELETE', `/v1/me/ai/${encodeURIComponent(ctx.need(2, 'the plan, claude, codex or antigravity'))}`)
  else read = await ctx.api<OwnAi>('GET', '/v1/me/ai')
  ctx.out({ available: true, ...read }, shown(read))
}
