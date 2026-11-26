import type { Failure as Failed, Summary as Shared, Waiting, Why } from '../../../src/shared/Api.ts'
import * as Status from '../../../src/shared/Status.ts'
import { ask, browse, confirm, type Context, Failure, line, page, swarm, table, usd } from '../context.ts'

export type Summary = {
  archivedAt: number | null
  balance: string
  contributors: number
  form: string
  goal: string
  id: string
  machines: number
  nickname: string | null
  remaining: string
  spent: string
  setup?: Shared['setup'] | undefined
  status: string
  title: string
  updatedAt: number
  waiting?: Waiting | null
  why?: Why | null
}

export type Overview = Summary & { failure?: Failed | null; reason: string | null; updates: { at: number; done: boolean; excerpt?: string; spent: string }[]; working: { since: number; stalled?: boolean } | null }

type Headline = { inFlight?: number }

type Told = Summary & { failure?: Failed | null; reason?: string | null }

function stood(swarm: Told, head?: Headline): Status.Stood {
  return { ...swarm, inFlight: head?.inFlight, status: swarm.status as Status.Stood['status'] }
}

export function state(swarm: Told, head?: Headline) {
  return Status.badge(stood(swarm, head))
}

export function said(read: Overview, now = Date.now()) {
  const swarm = stood(read)
  const word = Status.word(swarm)
  const working = word === 'Working' && read.working ? ` · working for ${ago(read.working.since, now)}${read.working.stalled ? ' (stalled)' : ''}` : ''
  return { status: Status.badge(swarm, word) + working, why: word === 'Stuck' || word === 'Needs money' ? Status.told(swarm) : null }
}

type Entry = { at: number; kind: string; seq: number; text: string; who: string | null }

type Node = { children: string[]; id: string; money?: { pledged?: string; spent?: string }; parent: string | null; status: string; title: string }

type TreeView = { headline: { deadEnds: number; frontier: number; inFlight: number; proven: number; spent: string }; nodes: Node[] }

type Machine = { by: string | null; connected: boolean; kind: string; label: string | null; name: string; runs: { count: number; failed: number } | null }

function ago(at: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.round(seconds / 60)}m` : seconds < 86_400 ? `${Math.round(seconds / 3600)}h` : `${Math.round(seconds / 86_400)}d`
}

function clock(at: number) {
  return new Date(at).toISOString().slice(11, 19)
}

export async function ls(ctx: Context) {
  const status = ctx.flag('status')
  const listing = await ctx.api<{ heads?: Record<string, Headline>; swarms: Summary[] }>('GET', `/v1/swarms${status ? `?status=${encodeURIComponent(status)}` : ''}`)
  ctx.out(listing, () => {
    const shown = ctx.flags['all'] === true ? listing.swarms : listing.swarms.filter((each) => !each.archivedAt)
    if (!shown.length) return 'No swarms yet. Start one with swarms new <name>.'
    const hidden = listing.swarms.length - shown.length
    return table([['NAME', 'STATUS', 'LEFT', 'RIDERS', 'TITLE'], ...shown.map((each) => [each.nickname ?? each.id, state(each, listing.heads?.[each.id]), usd(each.remaining), String(each.contributors), line(each.title, 60)])]) + (hidden ? `\n\n+${hidden} archived (--all shows them)` : '')
  })
}

export async function names(ctx: Context) {
  const listing = await ctx.api<{ swarms: Summary[] }>('GET', '/v1/swarms')
  const shown = listing.swarms.filter((each) => !each.archivedAt).map((each) => each.nickname ?? each.id)
  ctx.out(shown, shown.join('\n'))
}

async function gather(ctx: Context): Promise<{ amount: string | undefined; goal: string }> {
  let goal = ctx.flag('goal')
  let amount = ctx.flag('amount')
  if (!goal && process.stdin.isTTY) goal = await ask('Goal (what should it find out or build?): ')
  if (!goal) throw new Failure('A swarm needs a goal.', { code: 'usage', exit: 2, next: 'Pass --goal "<what it should find out or build>".' })
  if (amount === undefined && process.stdin.isTTY) amount = (await ask('Ride it with how many dollars? (0 to skip) ')) || '0'
  return { amount: amount && Number(amount) > 0 ? amount : undefined, goal }
}

export async function create(ctx: Context) {
  const name = ctx.need(1, 'the name, such as swarms new my-swarm').replace(/^\//, '').toLowerCase()
  const asked = await gather(ctx)
  const title = ctx.flag('title') ?? name.replace(/[-_]+/g, ' ').replace(/^./, (first) => first.toUpperCase())
  const form = ctx.flag('form')
  const template = ctx.flag('template')
  const made = await ctx.api<Summary>('POST', '/v1/swarms', { goal: asked.goal, nickname: name, title, ...(form ? { form } : {}), ...(template ? { template } : {}) })
  const url = page(ctx.host, made)
  let funded: unknown = null
  if (asked.amount) {
    if (!ctx.json) ctx.say(`Started ${made.title} at ${url}`)
    funded = await (await import('./fund.ts')).ride(ctx, made, asked.amount)
  }
  ctx.out({ funded, swarm: made, url }, `Started ${made.title} at ${url}${funded ? `, riding it with ${usd(asked.amount)}` : ''}.${funded ? '' : `\nRide it with swarms fund ${made.nickname ?? made.id} <usd>.`}`)
}

export async function open(ctx: Context) {
  const given = ctx.args[1]
  const url = given ? page(ctx.host, await ctx.api<Summary>('GET', `/v1/swarms/${encodeURIComponent(await swarm(ctx, given))}`)) : ctx.host
  const opened = await browse(ctx, url)
  ctx.out({ opened, url }, opened ? `Opened ${url}` : url)
}

export async function status(ctx: Context) {
  const id = await swarm(ctx, ctx.need(1, 'the swarm'))
  const read = await ctx.api<Overview>('GET', `/v1/swarms/${encodeURIComponent(id)}`)
  ctx.out(read, () => {
    const latest = read.updates.at(-1)
    const told = said(read)
    return table(
      [
        ['swarm', `${read.title}  ${page(ctx.host, read)}`],
        ['status', told.status],
        ['money', `${usd(read.remaining)} left of ${usd(read.balance)} · ${usd(read.spent)} spent · ${read.contributors} rider${read.contributors === 1 ? '' : 's'}`],
        ['goal', line(read.goal, 200)],
        ...(told.why ? [['why', line(told.why, 200)]] : []),
        ...(latest ? [['latest', `${ago(latest.at)} ago: ${line(latest.excerpt ?? '', 200)}`]] : []),
      ],
    )
  })
}

export async function logs(ctx: Context) {
  if (ctx.flags['follow'] === true) return (await import('./watch.ts')).watch(ctx)
  const id = await swarm(ctx, ctx.need(1, 'the swarm'))
  const query = new URLSearchParams({ before: String(Number.MAX_SAFE_INTEGER), limit: ctx.flag('limit') ?? '50' })
  for (const key of ['kind', 'who']) if (ctx.flag(key)) query.set(key, ctx.flag(key)!)
  const read = await ctx.api<{ entries: Entry[]; next: number }>('GET', `/v1/swarms/${encodeURIComponent(id)}/feed?${query}`)
  ctx.out(read, () => (read.entries.length ? read.entries.map(entry).join('\n') : 'Nothing in the transcript yet.'))
}

export function entry(each: Entry) {
  return `${clock(each.at)} ${each.kind.padEnd(8)} ${each.who ? `${each.who}: ` : ''}${line(each.text)}`
}

export async function ideas(ctx: Context) {
  const action = ctx.need(1, 'what to do: swarms ideas add <swarm> <text>')
  if (action !== 'add') throw new Failure(`swarms ideas ${action} is not a command.`, { code: 'usage', exit: 2, next: 'Run swarms ideas add <swarm> <text>.' })
  const id = await swarm(ctx, ctx.need(2, 'the swarm'))
  const text = ctx.args.slice(3).join(' ').trim()
  if (!text) throw new Failure('Missing the idea.', { code: 'usage', exit: 2, next: 'Run swarms ideas add <swarm> "<your idea>".' })
  await ctx.signed()
  const parent = ctx.flag('parent')
  const made = await ctx.api<Record<string, unknown>>('POST', `/v1/swarms/${encodeURIComponent(id)}/ideas`, { text, ...(parent ? { parent } : {}) })
  ctx.out(made, 'Suggested. Triage may adopt it as a node credited to you.')
}

export async function tree(ctx: Context) {
  const id = await swarm(ctx, ctx.need(1, 'the swarm'))
  const query = new URLSearchParams({ depth: ctx.flag('depth') ?? '3' })
  for (const key of ['root', 'status']) if (ctx.flag(key)) query.set(key, ctx.flag(key)!)
  const read = await ctx.api<TreeView>('GET', `/v1/swarms/${encodeURIComponent(id)}/tree?${query}`)
  ctx.out(read, () => {
    const nodes = new Map(read.nodes.map((node) => [node.id, node]))
    const top = read.nodes.find((node) => node.id === (ctx.flag('root') ?? 'root')) ?? read.nodes.find((node) => !node.parent || !nodes.has(node.parent))
    const lines = [`${read.headline.proven} proven · ${read.headline.frontier} on the frontier · ${read.headline.inFlight} in flight · ${read.headline.deadEnds} dead ends · ${usd(read.headline.spent)} spent`]
    const draw = (node: Node, lead: string, last: boolean, first: boolean) => {
      lines.push(`${first ? '' : `${lead}${last ? '└─ ' : '├─ '}`}[${node.status}] ${line(node.title, 80)}  ${usd(node.money?.pledged)}  ${node.id}`)
      const next = first ? '' : lead + (last ? '   ' : '│  ')
      const shown = node.children.filter((child) => nodes.has(child))
      shown.forEach((child, at) => draw(nodes.get(child)!, next, at === shown.length - 1 && shown.length === node.children.length, false))
      if (shown.length < node.children.length) lines.push(`${next}└─ … ${node.children.length - shown.length} more (--depth or --root ${node.id})`)
    }
    if (top) draw(top, '', true, true)
    return lines.join('\n')
  })
}

export async function machines(ctx: Context) {
  const id = await swarm(ctx, ctx.need(1, 'the swarm'))
  const read = await ctx.api<{ machines: Machine[] }>('GET', `/v1/swarms/${encodeURIComponent(id)}/machines`)
  ctx.out(read, () => (read.machines.length ? table([['NAME', 'KIND', 'CONNECTED', 'RUNS', 'BY'], ...read.machines.map((each) => [each.label ?? each.name, each.kind, each.connected ? 'yes' : 'no', each.runs ? `${each.runs.count}${each.runs.failed ? ` (${each.runs.failed} failed)` : ''}` : '0', each.by ?? ''])]) : 'No machines yet.'))
}

const pictures: Record<string, string> = { '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

export async function edit(ctx: Context) {
  const id = await swarm(ctx, ctx.need(1, 'the swarm'))
  const field = ctx.args[2]
  const value = ctx.args.slice(3).join(' ').trim()
  const edits: { pfp?: string; slug?: string; title?: string } = {}
  if (field) {
    if (field !== 'title' && field !== 'slug' && field !== 'pfp') throw new Failure(`${field} is not something swarms edit changes.`, { code: 'usage', exit: 2, next: 'Run swarms edit <swarm> title|slug|pfp <value>.' })
    if (!value) throw new Failure(`Missing the new ${field}.`, { code: 'usage', exit: 2, next: `Run swarms edit <swarm> ${field} <value>.` })
    edits[field] = value
  }
  for (const key of ['title', 'slug', 'pfp'] as const) if (ctx.flag(key)) edits[key] = ctx.flag(key)!
  if (!Object.keys(edits).length) throw new Failure('Nothing to change.', { code: 'usage', exit: 2, next: 'Run swarms edit <swarm> title|slug|pfp <value>.' })
  await ctx.signed()
  const path = `/v1/swarms/${encodeURIComponent(id)}`
  let read: Summary | undefined
  if (edits.title !== undefined || edits.slug !== undefined)
    read = await ctx.api<Summary>('PATCH', path, { ...(edits.title !== undefined ? { title: edits.title } : {}), ...(edits.slug !== undefined ? { nickname: edits.slug === 'none' ? null : edits.slug.replace(/^\//, '').toLowerCase() } : {}) })
  if (edits.pfp === 'none') read = await ctx.api<Summary>('DELETE', `${path}/picture`)
  else if (edits.pfp !== undefined) {
    const [fs, nodePath] = await Promise.all([import('node:fs'), import('node:path')])
    const type = pictures[nodePath.extname(edits.pfp).toLowerCase()]
    if (!type) throw new Failure('The picture is a PNG, JPEG, WebP or GIF file.', { code: 'usage', exit: 2, next: 'Pass a path ending in .png, .jpg, .webp or .gif, or none to drop it.' })
    let bytes: Uint8Array
    try {
      bytes = fs.readFileSync(edits.pfp)
    } catch {
      throw new Failure(`Could not read ${edits.pfp}.`, { code: 'usage', exit: 2, next: 'Check the path to the picture.' })
    }
    read = await ctx.api<Summary>('PUT', `${path}/picture`, undefined, { bytes, type })
  }
  ctx.out(read, `Saved. ${read ? page(ctx.host, read) : ''}`)
}

export async function archive(ctx: Context) {
  const id = await swarm(ctx, ctx.need(1, 'the swarm'))
  const read = await ctx.api<Summary>('GET', `/v1/swarms/${encodeURIComponent(id)}`)
  await ctx.signed()
  await confirm(ctx, `Archive ${read.title}? Its work stops and it takes no more rides.`)
  const done = await ctx.api<Summary>('POST', `/v1/swarms/${encodeURIComponent(id)}/archive`, {})
  ctx.out(done, `Archived ${done.title}.`)
}
