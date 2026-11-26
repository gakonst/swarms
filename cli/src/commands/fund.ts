import { browse, confirm, type Context, Failure, page, sleep, swarm, usd } from '../context.ts'
import type { Summary } from './swarms.ts'

type Prepared = { amount: string | null; link: string; memo: string; swarm: string; symbol: string; to: string; token: string }

function units(value: string) {
  const [whole = '0', part = ''] = value.split('.')
  return BigInt(whole) * 1_000_000n + BigInt((part + '000000').slice(0, 6))
}

export function asked(title: string) {
  return title.trim().replace(/[\s.,;:!?…]+$/u, '') || title.trim()
}

export type Ridden = { amount: string; balance: string; counted: boolean; hash: string | null; link: string | null; swarm: Summary; url: string }

export async function ride(ctx: Context, summary: Summary, amount: string): Promise<Ridden> {
  const given = amount.replace(/^\$/, '')
  if (!/^\d+(\.\d{1,6})?$/.test(given) || units(given) < 10_000n) throw new Failure(`${amount} is not an amount to send.`, { code: 'usage', exit: 2, next: 'Pass dollars, at least 0.01, such as swarms fund my-swarm 5.' })
  const path = `/v1/swarms/${encodeURIComponent(summary.id)}`
  const note = ctx.flag('note')
  const node = ctx.flag('node')
  const hash = ctx.flag('hash')
  if (hash) {
    const counted = await ctx.api<{ contribution: { amount: string }; swarm: Summary }>('POST', `${path}/contributions`, { hash, ...(note ? { note } : {}), ...(node ? { node } : {}) })
    return { amount: counted.contribution.amount, balance: counted.swarm.balance, counted: true, hash, link: null, swarm: counted.swarm, url: page(ctx.host, counted.swarm) }
  }
  if (summary.archivedAt) throw new Failure(`${summary.title} is archived: it takes no new rides.`, { code: 'gone', next: 'Pick another swarm with swarms ls.', status: 410 })
  await confirm(ctx, `Send ${usd(given)} of real money to ${asked(summary.title)}?`)
  const token = ctx.flag('token')
  const prepared = await ctx.api<Prepared>('POST', `${path}/transfer`, { amount: given, ...(note ? { note } : {}), ...(node ? { node } : {}), ...(token ? { token } : {}) })
  const before = units((await ctx.api<Summary>('GET', path)).balance)
  const opened = await browse(ctx, prepared.link)
  ctx.say(`${opened ? 'Opened' : 'Open'} ${prepared.link}\nSend ${usd(given)} with Tempo Wallet there. Waiting for the transfer to be counted…`)
  const until = Date.now() + Number(ctx.flag('timeout') ?? 900) * 1000
  const every = Math.max(250, Number(process.env['SWARMS_POLL_MS'] ?? 2000))
  for (;;) {
    await sleep(every)
    const now = await ctx.api<Summary>('GET', path)
    if (units(now.balance) - before >= units(given)) return { amount: given, balance: now.balance, counted: true, hash: null, link: prepared.link, swarm: now, url: page(ctx.host, now) }
    if (Date.now() > until) throw new Failure('No transfer was counted in time.', { code: 'timeout', next: `If you sent it, count it with swarms fund ${summary.nickname ?? summary.id} ${given} --hash <0x…>.` })
  }
}

export async function fund(ctx: Context) {
  const id = await swarm(ctx, ctx.need(1, 'the swarm'))
  const amount = ctx.need(2, 'the amount in dollars')
  const summary = await ctx.api<Summary>('GET', `/v1/swarms/${encodeURIComponent(id)}`)
  const ridden = await ride(ctx, summary, amount)
  ctx.out(ridden, `Counted ${usd(ridden.amount)} for ${ridden.swarm.title}: it has ${usd(ridden.swarm.remaining)} left.`)
}
