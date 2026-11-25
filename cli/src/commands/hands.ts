import { confirm, type Context, Failure, swarm, table } from '../context.ts'

type Lent = { at: number; connected: boolean; label: string; name: string }

type Issued = { command: string; label: string; name: string; swarm: string; token: string; url: string }

export async function hands(ctx: Context) {
  const action = ctx.args[1] ?? 'ls'
  if (action !== 'ls' && action !== 'add' && action !== 'rm') throw new Failure(`swarms hands ${action} is not a command.`, { code: 'usage', exit: 2, next: 'Run swarms hands ls|add|rm <swarm>.' })
  const id = await swarm(ctx, ctx.need(2, 'the swarm'))
  const path = `/v1/swarms/${encodeURIComponent(id)}/hands`
  if (action === 'ls') {
    const read = await ctx.api<{ hands: Lent[] }>('GET', path)
    return ctx.out(read, () => (read.hands.length ? table([['HAND', 'LABEL', 'CONNECTED', 'LENT'], ...read.hands.map((each) => [each.name, each.label, each.connected ? 'yes' : 'no', new Date(each.at).toISOString().slice(0, 16).replace('T', ' ')])]) : 'No hands yet. Lend your machine with swarms hands add <swarm>.'))
  }
  await ctx.signed()
  if (action === 'add') {
    const label = ctx.flag('label')
    const issued = await ctx.api<Issued>('POST', path, label ? { label } : {})
    return ctx.out(issued, `Issued hand ${issued.name}. Attach this machine with:\n\n  ${issued.command}`)
  }
  const hand = ctx.need(3, 'the hand, as swarms hands ls names it')
  await confirm(ctx, `Remove hand ${hand}? Its token stops working.`)
  const removed = await ctx.api<{ hand: string; removed: true; swarm: string }>('DELETE', `${path}/${encodeURIComponent(hand)}`)
  ctx.out(removed, `Removed hand ${removed.hand}.`)
}
