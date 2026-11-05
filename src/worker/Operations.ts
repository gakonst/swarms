import { waitUntil } from 'cloudflare:workers'
import { encodeFunctionData, isAddress, parseEventLogs } from 'viem'
import type { Address, Hex } from 'viem'
import { getTransactionReceipt } from 'viem/actions'
import { Abis } from 'viem/tempo'
import { z } from 'zod'
import type {
  Account,
  Answered,
  Branch,
  Branches,
  Roster,
  Artifact,
  BudgetRequested,
  Budgeted,
  Config,
  Contributed,
  Detail,
  Entry,
  Found,
  Hit,
  Issued,
  Kind,
  Lent,
  Linked,
  Me,
  Member,
  Note,
  Overview,
  Page,
  Pending,
  Pledge,
  Pledged,
  Posted,
  Prepared,
  Requested,
  Room,
  Update,
  Working,

  Status,
  Summary,
  Waited,
} from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Btw from '../shared/Btw.ts'
import * as Connect from '../shared/Connect.ts'
import * as Memo from '../shared/Memo.ts'
import * as Transfer from '../shared/Transfer.ts'
import * as Mention from '../shared/Mention.ts'
import * as Artifacts from './Artifacts.ts'
import * as Chain from './Chain.ts'
import * as Devices from './Devices.ts'
import * as Edge from './Edge.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Keys from './Keys.ts'
import * as Problem from './Problem.ts'
import * as Search from './Search.ts'
import * as Sessions from './Sessions.ts'
import * as Store from './Store.ts'
import * as Team from './Team.ts'
import type { Snapshot } from './Payer.ts'
import type { Paid, Stamp, Swarm } from './Swarm.ts'
import * as Vault from './Vault.ts'
import * as Fleet from '../shared/Fleet.ts'
import * as Brief from '../shared/ResearchBrief.ts'
import { ids } from '../shared/ResearchBrief.ts'

export const statuses = ['funding', 'running', 'paused', 'done'] as const satisfies readonly Status[]

export const kinds = ['tool', 'output', 'message', 'thinking', 'steer', 'funds', 'status', 'machine', 'error'] as const satisfies readonly Kind[]

export const sources = ['swarm', 'update', 'note', 'feed'] as const satisfies readonly Hit['kind'][]

export const maxWait = 55

const id = z.string().trim().min(1).max(64).describe('The swarm id, the last part of its page URL /s/<id>.')

const pledgeDays = 7

const pledgeId = z.string().trim().min(1).max(64).describe('The pledge id that swarm_pledge or the pledge request returned.')

function units(value: string | number) {
  return Memo.units(typeof value === 'number' ? value.toFixed(6) : value)
}

const decimal = z.union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()])

const exchanges = z
  .array(z.object({ answer: z.string().max(Btw.maxAnswer), question: z.string().trim().min(1).max(Btw.maxQuestion) }))
  .max(Btw.maxThread)

const wallet = z
  .string()
  .trim()
  .refine((value) => isAddress(value), 'A wallet address, 0x and 40 hex digits.')
  .transform((value) => value.toLowerCase() as Address)

const allowance = z.number().min(0).max(1_000_000).nullable().describe('USD per 30 days of the swarm\'s money this member may put behind ideas; null means no limit, or the team\'s default.')

const thread = exchanges.default([]).describe('The earlier side questions and their answers in this /btw thread, oldest first.')

const subagentId = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

const amount = decimal
  .refine((value) => units(value) >= Store.minSteer, `A pledge is at least ${Memo.decimal(Store.minSteer)}.`)
  .refine((value) => units(value) <= 100_000_000n, 'A pledge is at most 100.')
  .describe(`The amount to pledge in its token, from ${Memo.decimal(Store.minPledge)} to 100, as a decimal string such as "2" or a number.`)

const note = z
  .string()
  .trim()
  .max(Memo.maxNote)
  .nullish()
  .describe('Optional steering note, weighted by the money behind it. The same text backs an existing note.')

const authorization = {
  keyAuthorization: z.unknown().optional().describe('The keyAuthorization Tempo Wallet returned from wallet_connect.'),
  transaction: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/)
    .optional()
    .describe('A signed Tempo transaction carrying the key authorization, as scripts send.'),
}

function seconds(fallback: number, description: string) {
  return z.coerce.number().int().min(0).max(maxWait).default(fallback).describe(description)
}

export const schema = {
  allowance: z.object({
    ...authorization,
    budget: z.string().trim().min(1).max(64).describe('The budget id the budget request returned.'),
    swarm: id,
  }),
  approval: z.object({ ...authorization, pledge: pledgeId, swarm: id }),
  budget: z.object({
    amount: decimal
      .refine((value) => units(value) >= Store.budget.min, `A monthly budget is at least ${Memo.decimal(Store.budget.min)}.`)
      .refine((value) => units(value) <= Store.budget.max, `A monthly budget is at most ${Memo.decimal(Store.budget.max)}.`)
      .describe(
        `Tokens the swarm pulls every 30 days, the first time on approval, from ${Memo.decimal(Store.budget.min)} to ${Memo.decimal(Store.budget.max)}, as a decimal string or a number.`,
      ),
    note,
    swarm: id,
    token: z.enum(Chain.pledgeable).describe('The token: a stablecoin the swarm pulls into its wallet each period, or MACH, which opens a payment channel to the gateway with the whole period at once.'),
  }),
  contribution: z.object({
    hash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .describe("The hash of a transferWithMemo of USDC.e, pathUSD or OUSD to the swarm's wallet."),
    note,
    swarm: id,
  }),
  transfer: z.object({
    amount: decimal
      .refine((value) => units(value) >= 10_000n, 'A transfer is at least 0.01.')
      .optional()
      .describe('How much to send, as a decimal string such as "1" or a number. With it the answer carries ready call data.'),
    hash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional()
      .describe('The hash of a transfer already sent. With it the transfer is counted instead of prepared.'),
    note,
    swarm: id,
    token: z.enum(Chain.ids).default('usdce').describe('The stablecoin to send: usdce (USDC.e), pathusd (pathUSD) or ousd (OUSD).'),
  }),
  create: z.object({
    goal: z
      .string()
      .trim()
      .min(10)
      .max(2000)
      .describe('What the swarm should find out or build, what done looks like and what its updates should report.'),
    problem: z.enum(ids).optional().describe('The id of the idea-bank problem this swarm works on, from GET /v1/problems. A problem with an open swarm is not offered again until that swarm finishes.'),
    title: z.string().trim().min(3).max(80).describe('A short name for the swarm.'),
  }),
  seat: z.object({
    budget: allowance.optional(),
    member: wallet.describe('The wallet to let steer the swarm.'),
    role: z.enum(['admin', 'member']).default('member').describe('An admin also manages who steers.'),
    swarm: id,
  }),
  steering: z.object({
    memberBudget: allowance.optional(),
    steering: z.enum(['open', 'team']).optional().describe('open: any backer steers with their own money. team: only the team steers, with the swarm\'s money, each member within their budget.'),
    swarm: id,
  }),
  unseat: z.object({ member: wallet, swarm: id }),
  branches: z.object({ swarm: id }),
  fund: z.object({
    amount: decimal
      .refine((value) => units(value) >= Mention.smallestSteer, `A branch is funded with at least ${Memo.decimal(Mention.smallestSteer)}.`)
      .refine((value) => units(value) <= 100_000_000n, 'A branch is funded with at most 100.')
      .describe("How many dollars go behind the branch: of the caller's backing not yet behind a note, or of the swarm's money within their team budget when only its team steers."),
    branch: subagentId.describe('The branch, the id of one of the subagents the swarm\'s agent started itself, from GET /v1/swarms/:id/branches.'),
    swarm: id,
  }),
  move: z.object({
    amount: decimal
      .refine((value) => units(value) >= 10_000n, 'Move at least 0.01.')
      .refine((value) => units(value) <= 100_000_000n, 'Move at most 100.')
      .describe('How many dollars of what the caller put behind the branch, and the branch has not spent, go behind the other branch.'),
    branch: subagentId.describe('The branch to take the money from.'),
    swarm: id,
    to: subagentId.describe('The branch to put it behind.'),
  }),
  hand: z.object({
    label: z
      .string()
      .trim()
      .max(32)
      .regex(/^[\p{L}\p{N} ._-]*$/u, 'Use letters, digits, spaces, dots, underscores and hyphens.')
      .optional()
      .describe('A short name for the machine, such as "georgios-mbp". The hand name is made from it plus a random suffix.'),
    swarm: id,
  }),
  feed: z.object({
    after: z.coerce.number().int().min(0).default(0).describe('Return entries after this seq; pass the previous page\'s next.'),
    kind: z.enum(kinds).optional().describe('Only entries of this kind.'),
    before: z.coerce.number().int().min(1).optional().describe('Return the newest entries before this seq instead, to read further back.'),
    limit: z.coerce.number().int().min(1).max(200).default(200).describe('At most this many entries.'),
    swarm: id,
    who: z
      .string()
      .max(160)
      .optional()
      .describe("Only entries of one speaker: agent for the swarm's agent, or a subagent's name as entries carry it in who."),
  }),
  list: z.object({ status: z.enum(statuses).optional().describe('Only swarms with this status.') }),
  pledge: z.object({
    amount,
    device: z
      .boolean()
      .default(false)
      .describe('Approve on any device through a Tempo Wallet link and user code, then poll the pledge.'),
    note: z
      .string()
      .trim()
      .max(Memo.maxNote)
      .nullish()
      .describe('Optional steering note, weighted by the money behind it. The same text backs an existing note.'),
    swarm: id,
    token: z
      .enum(Chain.pledgeable)
      .default('mach')
      .describe('The token to pledge: mach (the default), ousd, usdce or pathusd. A pledge in USDC.e or pathUSD opens its channel in OUSD through the stablecoin DEX.'),
  }),
  pledged: z.object({
    pledge: pledgeId,
    swarm: id,
    wait: seconds(0, `Seconds to keep polling Tempo Wallet while the pledge is pending, at most ${maxWait}.`),
  }),
  rename: z.object({
    name: z
      .string()
      .trim()
      .max(Mention.maxName)
      .nullable()
      .describe(`Your username, 3 to ${Mention.maxName} letters, digits, hyphens or underscores, starting with a letter; it is stored in lower case. null or "" goes back to the name made from your address.`),
  }),
  room: z.object({
    after: z.coerce.number().int().min(0).default(0).describe('Return the messages after this id; 0 returns the newest.'),
    before: z.coerce.number().int().min(1).optional().describe('Return the messages before this id, to read further back.'),
    limit: z.coerce.number().int().min(1).max(200).default(100).describe('At most this many messages.'),
    swarm: id,
  }),
  updates: z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50).describe('At most this many of the newest updates.'),
    swarm: id,
  }),
  btw: z.object({
    question: z.string().trim().min(1).max(Btw.maxQuestion).describe('The side question, answered from the agent\'s own conversation without interrupting or steering it.'),
    swarm: id,
    thread,
  }),
  say: z.object({
    btw: exchanges
      .min(1)
      .optional()
      .describe('With /collapse: the side questions and answers to steer the agent with. The text must be @swarm followed by the collapsed note, "Collapsed /btw: <the first question>".'),
    steer: decimal
      .refine((value) => units(value) >= Mention.smallestSteer, `A steer is at least ${Memo.decimal(Mention.smallestSteer)}.`)
      .refine((value) => units(value) <= 100_000_000n, 'A steer is at most 100.')
      .optional()
      .describe(
        "With @swarm in text: how many dollars of the author's backing not yet behind a note go behind this idea, as a decimal string or a number.",
      ),
    swarm: id,
    text: z
      .string()
      .trim()
      .min(1)
      .max(Mention.maxText)
      .describe('The message. @<handle> mentions a backer. @swarm steers the swarm with the rest of the text as a note, weighted by steer.'),
  }),
  search: z.object({
    kind: z.enum(sources).optional().describe('Only hits of this kind.'),
    limit: z.coerce.number().int().min(1).max(50).default(10).describe('At most this many indexed hits, and as many feed hits.'),
    query: z.string().trim().min(1).max(500).describe('Keywords. Hits match any of them, best first.'),
    swarm: id.optional().describe('Search only this swarm, including its feed.'),
  }),
  swarm: z.object({ swarm: id }),
  wait: z.object({
    after: z.coerce
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Return once an update newer than this time (Unix ms, an update's at) is posted. Defaults to the newest update, so it waits for the next."),
    swarm: id,
    timeout: seconds(45, `Seconds to wait at most, up to ${maxWait}.`),
  }),
}

type Input<name extends keyof typeof schema> = { [key in keyof z.input<(typeof schema)[name]>]?: unknown }

function parse<parser extends z.ZodType>(parser: parser, input: unknown): Problem.Result<z.output<parser>> {
  const parsed = parser.safeParse(input)
  return parsed.success ? Problem.ok(parsed.data) : Problem.invalid(parsed.error)
}

function stub(env: Cloudflare.Env, id: string): DurableObjectStub<Swarm> {
  return env.SWARMS.get(env.SWARMS.idFromName(id))
}

function missing() {
  return Problem.fail(404, 'not_found', 'No swarm has this id.')
}

function identifier() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

function sleep(ms: number, signal: AbortSignal | undefined) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms))
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

function logged(task: Promise<unknown>) {
  return task.catch((error: unknown) => console.error('Indexing for search failed', error))
}

async function provisioned(env: Cloudflare.Env, row: Store.Row) {
  if (row.wallet) return { ...row, wallet: row.wallet }
  await Store.provision(env, row.id, await Vault.create(env.SWARMS_SECRET))
  const updated = await Store.find(env, row.id)
  if (!updated?.wallet) throw new Error('The swarm has no wallet.')
  return { ...updated, wallet: updated.wallet }
}

type Shape = { feed?: number; texts?: boolean }

async function load(env: Cloudflare.Env, id: string, shape: Shape = {}) {
  const viewing = Store.seen(id) ? Promise.resolve(stub(env, id).view(shape)) : undefined
  const found = await Store.find(env, id)
  if (!found) return undefined
  const row = await provisioned(env, found)
  const view = await (viewing ?? stub(env, id).view(shape))
  await backfill(env, row, view.updates.at(-1), shape)
  return { row, view }
}

async function ledgered(env: Cloudflare.Env, id: string, shape: Shape) {
  const viewing = Store.seen(id) ? Promise.resolve(stub(env, id).view(shape)) : undefined
  const ledger = await Store.ledger(env, id)
  if (!ledger) return undefined
  const row = await provisioned(env, ledger.row)
  const view = await (viewing ?? stub(env, id).view(shape))
  await backfill(env, row, view.updates.at(-1), shape)
  if (Search.lags(view.ended, ledger.reports))
    waitUntil(logged(Promise.resolve(stub(env, id).turns()).then((turns) => Search.sync(env, id, turns))))
  return { ledger, row, view }
}

async function backfill(env: Cloudflare.Env, row: Store.Row, latest: Update | undefined, shape: Shape) {
  if (row.answer || !latest) return
  const last = shape.texts === false ? (await stub(env, row.id).pulse()).updates.at(-1) ?? latest : latest
  row.answer = JSON.stringify({ at: last.at, done: last.done, text: last.text })
  await Store.update(env, row.id, { answer: row.answer })
}

export function config(env: Cloudflare.Env): Config {
  return {
    auth: Sessions.path,
    budget: {
      days: Store.budget.days,
      max: Memo.decimal(Store.budget.max),
      min: Memo.decimal(Store.budget.min),
      period: Store.budget.period,
    },
    chainId: Chain.chain.id,
    explorer: Chain.chain.blockExplorers.default.url,
    gateway: env.GATEWAY_URL,
    mach: Chain.mach,
    minPledge: Memo.decimal(Store.minPledge),
    reserve: Memo.decimal(Store.reserve),
    rpc: env.TEMPO_RPC,
    tokens: Chain.pledgeable.map((id) => ({
      address: Chain.currencies[id].address,
      id,
      pool: id !== 'mach',
      symbol: Chain.currencies[id].symbol,
    })),
  }
}

export async function list(env: Cloudflare.Env, input: Input<'list'>): Promise<Problem.Result<{ swarms: Summary[] }>> {
  const parsed = parse(schema.list, input)
  if (!parsed.ok) return parsed

  const status = parsed.value.status
  return Problem.ok({ swarms: await Edge.cached(env, `swarms?status=${status ?? ''}`, listSeconds, async () => (await Store.list(env, status)).map((row) => Store.summary(row))) })
}

export function listed(value: { swarms: Summary[] }) {
  return { swarms: value.swarms.map((swarm) => (swarm.answer ? { ...swarm, answer: { ...swarm.answer, text: Answer.lead(swarm.answer.text) } } : swarm)) }
}

export async function create(env: Cloudflare.Env, input: Input<'create'>, creator?: Address): Promise<Problem.Result<Summary>> {
  const parsed = parse(schema.create, input)
  if (!parsed.ok) return parsed

  const swarm = { goal: parsed.value.goal, id: identifier(), title: parsed.value.title }
  await Store.insert(env, { ...swarm, creator: creator ?? null, problem: parsed.value.problem ?? null, ...(await Vault.create(env.SWARMS_SECRET)) })
  const [row] = await Promise.all([Store.find(env, swarm.id), logged(Search.swarm(env, swarm))])
  return row ? Problem.ok(Store.summary(row)) : Problem.fail(502, 'unavailable', 'The swarm was not saved.')
}

const firstFeed = 80

const listSeconds = 3

export async function stamp(env: Cloudflare.Env, swarm: string): Promise<Stamp | undefined> {
  return Store.seen(swarm) ? stub(env, swarm).version() : undefined
}

export async function detail(env: Cloudflare.Env, input: Input<'swarm'>, feed = true): Promise<Problem.Result<Detail>> {
  const shown = await stamped(env, input, feed)
  return shown.ok ? Problem.ok(shown.value.detail) : shown
}

export async function stamped(env: Cloudflare.Env, input: Input<'swarm'>, feed = true): Promise<Problem.Result<{ detail: Detail; stamp: Stamp }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const loaded = await ledgered(env, parsed.value.swarm, { feed: feed ? firstFeed : 0, texts: false })
  if (!loaded) return missing()

  const { ledger, row, view } = loaded
  const detail: Detail = {
    ...Store.summary(row),
    budgets: ledger.budgets,
    code: view.code,
    contributions: ledger.contributions,
    feed: view.feed,
    hands: view.hands,
    notes: ledger.notes(new Set(view.steered)),
    pledges: ledger.pledges,
    reason: view.reason,
    why: view.why,
    updates: view.updates.map(({ text: _text, ...update }) => update),
    working: view.working,
  }
  return Problem.ok({ detail, stamp: view.stamp })
}

export async function get(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<Overview>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const loaded = await ledgered(env, parsed.value.swarm, { feed: 0 })
  if (!loaded) return missing()

  const { ledger, row, view } = loaded
  return Problem.ok({
    ...Store.summary(row),
    budgets: ledger.budgets,
    code: view.code,
    contributions: ledger.contributions,
    hands: view.hands,
    notes: ledger.notes(new Set(view.steered)),
    pledges: ledger.pledges,
    reason: view.reason,
    why: view.why,
    updates: view.updates.map(({ text, ...update }) => ({ ...update, excerpt: Answer.excerpt(text) })),
    working: view.working,
  })
}

export async function answer(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<Answered>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const loaded = await load(env, parsed.value.swarm, { feed: 0, texts: false })
  if (!loaded) return missing()

  const summary = Store.summary(loaded.row)
  return Problem.ok({
    answer: summary.answer,
    status: summary.status,
    swarm: summary.id,
    title: summary.title,
    working: loaded.view.working,
  })
}

export async function updates(env: Cloudflare.Env, input: Input<'updates'>): Promise<Problem.Result<{ updates: Update[]; working: Working | null }>> {
  const parsed = parse(schema.updates, input)
  if (!parsed.ok) return parsed
  const swarm = parsed.value.swarm
  if (!(await Store.exists(env, swarm))) return missing()

  const pulse = await stub(env, swarm).pulse()
  await logged(Search.sync(env, swarm, pulse.turns))
  return Problem.ok({ updates: pulse.updates.slice(-parsed.value.limit), working: pulse.working })
}

export async function code(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<{ snapshot: Snapshot | null }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()
  return Problem.ok({ snapshot: (await stub(env, parsed.value.swarm).code()) as Snapshot | null })
}

export async function feed(env: Cloudflare.Env, input: Input<'feed'>): Promise<Problem.Result<Page>> {
  const read = await paged(env, input)
  return read.ok ? Problem.ok(read.value.page) : read
}

export async function paged(env: Cloudflare.Env, input: Input<'feed'>): Promise<Problem.Result<{ last: number; page: Page }>> {
  const parsed = parse(schema.feed, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  if (!(await Store.exists(env, query.swarm))) return missing()

  const { entries, last } = await stub(env, query.swarm).page(query.after, { before: query.before, kind: query.kind, limit: query.limit, who: query.who })
  return Problem.ok({ last, page: { entries, next: entries.at(-1)?.seq ?? query.after } })
}

export async function live(env: Cloudflare.Env, input: Input<'swarm'>, signal: AbortSignal, after?: string): Promise<Problem.Result<Response>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()

  const url = after !== undefined && /^\d{1,15}$/.test(after) ? `https://swarm/live?after=${after}` : 'https://swarm/live'
  return Problem.ok(await stub(env, parsed.value.swarm).fetch(new Request(url, { signal })))
}

export async function search(env: Cloudflare.Env, input: Input<'search'>): Promise<Problem.Result<Found>> {
  const parsed = parse(schema.search, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  const terms = Search.terms(query.query)
  if (!terms.length) return Problem.fail(400, 'invalid_request', 'The query has no words to search for.')
  const row = query.swarm === undefined ? undefined : await Store.find(env, query.swarm)
  if (row === null) return missing()

  const stale = row ? [row.id] : await Search.lagging(env)
  await Promise.all(stale.map(async (swarm) => logged(Search.sync(env, swarm, await stub(env, swarm).turns()))))
  const [indexed, entries] = await Promise.all([
    query.kind === 'feed' ? [] : Search.query(env, { kind: query.kind, limit: query.limit, swarm: row?.id, terms }),
    row && (query.kind === undefined || query.kind === 'feed') ? feedHits(env, row, terms, query.limit) : [],
  ])
  return Problem.ok({ hits: [...indexed, ...entries], terms })
}

async function feedHits(env: Cloudflare.Env, row: Store.Row, terms: string[], limit: number) {
  const entries = await stub(env, row.id).search(terms, limit)
  return entries.map(
    (entry): Hit => ({
      at: entry.at,
      entry: { kind: entry.kind, seq: entry.seq },
      kind: 'feed',
      snippet: excerpt(entry, terms),
      swarm: { id: row.id, status: row.status, title: row.title },
    }),
  )
}

export async function wait(env: Cloudflare.Env, input: Input<'wait'>, signal?: AbortSignal): Promise<Problem.Result<Waited>> {
  const parsed = parse(schema.wait, input)
  if (!parsed.ok) return parsed
  const swarm = parsed.value.swarm
  const started = Date.now()
  const deadline = started + parsed.value.timeout * 1000
  let pulse = await stub(env, swarm).pulse()
  const since = parsed.value.after ?? pulse.updates.at(-1)?.at ?? 0

  for (;;) {
    const row = await Store.find(env, swarm)
    if (!row) return missing()
    const posted = pulse.updates.findLast((update) => update.at > since) ?? null
    const reason = posted
      ? 'updated'
      : !pulse.working && row.status !== 'running'
        ? 'idle'
        : Date.now() >= deadline || signal?.aborted
          ? 'timeout'
          : undefined
    if (reason) {
      if (posted) await logged(Search.sync(env, swarm, pulse.turns))
      return Problem.ok({
        changed: posted !== null,
        reason,
        swarm: Store.summary(row),
        update: posted,
        waited: Date.now() - started,
        working: pulse.working,
      })
    }
    await sleep(Math.min(2000, deadline - Date.now()), signal)
    pulse = await stub(env, swarm).pulse()
  }
}

export async function artifacts(env: Cloudflare.Env, input: Input<'swarm'>, origin: string): Promise<Problem.Result<{ artifacts: Artifact[] }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()

  const found = await Artifacts.list(env, parsed.value.swarm)
  if (!found) return Problem.fail(502, 'upstream_failed', "The gateway did not list the swarm's artifacts.")
  return Problem.ok({ artifacts: found.map((artifact) => ({ ...artifact, url: origin + artifact.url })) })
}

export async function room(env: Cloudflare.Env, input: Input<'room'>, address?: Address): Promise<Problem.Result<Room>> {
  const heard = await listened(env, input, address)
  return heard.ok ? Problem.ok(heard.value.room) : heard
}

export async function listened(env: Cloudflare.Env, input: Input<'room'>, address?: Address): Promise<Problem.Result<{ room: Room; stamp: Stamp }>> {
  const parsed = parse(schema.room, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  if (!(await Store.exists(env, query.swarm))) return missing()

  const [{ messages, stamp }, members] = await Promise.all([
    stub(env, query.swarm).chat({ after: query.after, before: query.before, limit: query.limit }),
    Store.members(env, query.swarm),
  ])
  return Problem.ok({ room: { me: address ? await self(env, members, address) : null, members, messages, next: messages.at(-1)?.id ?? query.after }, stamp })
}

export async function account(env: Cloudflare.Env, address?: Address): Promise<Problem.Result<Account>> {
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo Wallet to read your account.')
  return Problem.ok(await Store.account(env, address))
}

export async function rename(env: Cloudflare.Env, input: Input<'rename'>, address?: Address): Promise<Problem.Result<Account>> {
  const parsed = parse(schema.rename, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo Wallet to set your username.')

  const name = parsed.value.name?.replace(/^@/, '').toLowerCase() || null
  const wrong = name ? Mention.invalid(name) : undefined
  if (wrong) return Problem.fail(400, 'invalid_request', wrong)
  if (!(await Store.rename(env, address, name))) return Problem.fail(409, 'conflict', `@${name} is taken. Pick another.`)
  return Problem.ok(await Store.account(env, address))
}

export async function say(env: Cloudflare.Env, input: Input<'say'>, address?: Address): Promise<Problem.Result<Posted>> {
  const parsed = parse(schema.say, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo Wallet to post in a room.')
  const [row, account] = await Promise.all([Store.find(env, request.swarm), Store.account(env, address)])
  if (!row) return missing()
  if (!account.name) return unnamed()

  const members = await Store.members(env, row.id)
  const author = members.find((member) => member.address === address)
  const policed = row.steering === 'team'
  const seat = policed ? await Team.seat(env, row, address).catch(() => undefined) : undefined
  if (!author && !seat)
    return Problem.fail(403, 'not_member', "Back this swarm first: a pledge, a transfer, a monthly budget or a lent machine lets you post in its room.")

  const steering = Mention.steers(request.text)
  if (steering && policed && !seat)
    return Problem.fail(403, 'not_member', "Only this swarm's team steers it. Its admins add who may: ask one of them in the room.")
  if (!steering && request.steer !== undefined) return Problem.fail(400, 'invalid_request', 'steer goes with a message that mentions @swarm.')
  if (request.btw && (!steering || Mention.idea(request.text) !== Btw.note(request.btw)))
    return Problem.fail(400, 'invalid_request', `A /collapse is @swarm followed by "${Btw.note(request.btw)}".`)
  let steer: { amount: string; note: string; noteId: string } | null = null
  if (steering) {
    const note = Mention.idea(request.text)
    if (note.length < 3) return Problem.fail(400, 'invalid_request', 'Say what the swarm should do after @swarm.')
    if (note.length > Memo.maxNote) return Problem.fail(400, 'invalid_request', `A steer is at most ${Memo.maxNote} characters besides @swarm.`)
    if (request.steer === undefined)
      return Problem.fail(
        400,
        'invalid_request',
        seat
          ? `@swarm steers the swarm with its money: send steer, how much of your team budget (${seat.left === null ? 'no limit' : dollars(seat.left) + ' left'}) goes behind this idea.`
          : `@swarm steers the swarm with money: send steer, how much of your ${dollars(author?.available ?? '0')} not yet behind a note goes behind this idea.`,
      )
    const amount = units(request.steer)
    const noteId = await Store.noteId(note)
    const placed = seat
      ? await Store.allot(env, { amount, contributor: address, id: identifier(), limit: seat.limit === null ? null : Memo.units(seat.limit), note, note_id: noteId, since: Date.now() - Team.period, swarm: row.id })
      : await Store.steer(env, { amount, contributor: address, id: identifier(), note, note_id: noteId, swarm: row.id })
    if (!placed)
      return Problem.fail(
        409,
        'insufficient_balance',
        seat
          ? `Your team budget has ${dollars(seat.left ?? '0')} left in these 30 days, less than ${dollars(Memo.decimal(amount))}.`
          : `You have ${dollars(author?.available ?? '0')} of backing not yet behind a note, less than ${dollars(Memo.decimal(amount))}. Put new money behind this idea instead.`,
      )
    if (seat) Team.forget(row.id)
    await logged(Search.note(env, row.id, noteId, note))
    steer = { amount: Memo.decimal(amount), note, noteId, ...(request.btw ? { context: Btw.collapse(request.btw) } : {}) }
  }

  const named = Mention.mentioned(request.text)
  const message = await stub(env, row.id).say({
    author: address,
    mentions: members.filter((member) => named.includes(member.handle) || named.includes(Mention.handle(member.address))).map((member) => member.address),
    steer,
    swarm: row.id,
    text: request.text,
  })
  return Problem.ok({ me: await self(env, steer ? await Store.members(env, row.id) : members, address), message })
}

function unnamed() {
  return Problem.fail(403, 'username_required', 'Pick a username first: POST /v1/me with { name }. People in a swarm talk and steer under the name they chose.')
}

function reached<value>(call: Promise<Gateway.Result<value>>): Promise<Gateway.Result<value>> {
  return call.catch((error: unknown) => ({ detail: error instanceof Error ? error.message : String(error), ok: false as const, status: 503 }))
}

async function directed(env: Cloudflare.Env, row: Store.Row): Promise<Problem.Result<{ list: Branch[]; members: Member[]; money: Awaited<ReturnType<typeof Store.funds>> }>> {
  const [found, money, members] = await Promise.all([reached(stub(env, row.id).subagents(row.id)), Store.funds(env, row.id), Store.members(env, row.id)])
  if (!found.ok) return Problem.fail(502, 'upstream_failed', `Could not list the swarm's subagents: ${found.detail}`)
  return Problem.ok({ list: found.value.map((agent) => branched(agent, money, members)), members, money })
}

function branched(agent: Gateway.Subagent, money: Awaited<ReturnType<typeof Store.funds>>, members: readonly Member[]): Branch {
  const shares = money.shares.get(agent.agent_id) ?? new Map<string, bigint>()
  const funded = [...shares.values()].reduce((sum, amount) => sum + amount, 0n)
  const budget = agent.budget_usd === undefined ? null : units(agent.budget_usd)
  const spent = agent.spent_usd === undefined ? null : units(agent.spent_usd)
  const error = agent.status.error ?? null
  const starved = agent.status.state === 'failed' && /of their \$[0-9.]+ budget/.test(error ?? '')
  return {
    budget: budget === null ? null : Memo.decimal(budget),
    error: starved || !error ? null : error.slice(0, 300),
    funded: Memo.decimal(funded > 0n ? funded : 0n),
    funders: [...shares]
      .filter(([, amount]) => amount > 0n)
      .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
      .map(([address, amount]) => ({
        address: address as Address,
        amount: Memo.decimal(amount),
        handle: members.find((member) => member.address === address)?.handle ?? Mention.short(address as Address),
      })),
    id: agent.agent_id,
    left: budget === null || spent === null ? null : Memo.decimal(budget > spent ? budget - spent : 0n),
    parent: agent.parent_agent_id,
    role: agent.role,
    spent: spent === null ? null : Memo.decimal(spent),
    starved,
    state: agent.status.state as Branch['state'],
    task: agent.task.slice(0, 2000),
  }
}

function backed(money: Awaited<ReturnType<typeof Store.funds>>, branch: number) {
  const funded = [...(money.shares.get(branch)?.values() ?? [])].reduce((sum, amount) => sum + amount, 0n)
  const total = (money.bases.get(branch) ?? 0n) + funded
  return total > 0n ? total : 1n
}

async function steerable(env: Cloudflare.Env, input: { address: Address | undefined; swarm: string }) {
  if (!input.address) return Problem.fail(401, 'unauthorized', "Sign in with Tempo Wallet to direct a swarm's money.")
  const [row, account] = await Promise.all([Store.find(env, input.swarm), Store.account(env, input.address)])
  if (!row) return missing()
  if (!account.name) return unnamed()
  if (row.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is finished.')
  const seat = row.steering === 'team' ? await Team.seat(env, row, input.address).catch(() => undefined) : undefined
  if (row.steering === 'team' && !seat)
    return Problem.fail(403, 'not_member', "Only this swarm's team directs its money. Its admins add who may: ask one of them in the room.")
  return Problem.ok({ account, address: input.address, row, seat })
}

export async function branches(env: Cloudflare.Env, input: Input<'branches'>): Promise<Problem.Result<Branches>> {
  const parsed = parse(schema.branches, input)
  if (!parsed.ok) return parsed
  const row = await Store.find(env, parsed.value.swarm)
  if (!row) return missing()

  const found = await directed(env, row)
  return found.ok ? Problem.ok({ branches: found.value.list, steering: row.steering }) : found
}

export async function fund(env: Cloudflare.Env, input: Input<'fund'>, address?: Address): Promise<Problem.Result<Branch>> {
  const parsed = parse(schema.fund, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const allowed = await steerable(env, { address, swarm: request.swarm })
  if (!allowed.ok) return allowed
  const { account, row, seat } = allowed.value

  const found = await directed(env, row)
  if (!found.ok) return found
  const target = found.value.list.find((branch) => branch.id === request.branch)
  if (!target || target.parent !== null)
    return Problem.fail(404, 'not_found', `This swarm has no branch ${request.branch}: fund one of the subagents its agent started itself, from GET /v1/swarms/${row.id}/branches.`)
  if (target.state === 'closed' || target.state === 'closing') return Problem.fail(409, 'conflict', `${target.role} is closed; fund another branch.`)
  const author = found.value.members.find((member) => member.address === allowed.value.address)
  if (!seat && !author) return Problem.fail(403, 'not_member', 'Back this swarm first: a pledge, a transfer, a monthly budget or a lent machine lets you direct its money.')

  const amount = units(request.amount)
  const identity = identifier()
  const entry = { amount, branch: target.id, contributor: allowed.value.address, id: identity, note: `branch ${target.id}`, note_id: `branch:${target.id}`, swarm: row.id }
  const placed = seat
    ? await Store.allot(env, { ...entry, limit: seat.limit === null ? null : Memo.units(seat.limit), since: Date.now() - Team.period })
    : await Store.steer(env, entry)
  if (!placed)
    return Problem.fail(
      409,
      'insufficient_balance',
      seat
        ? `Your team budget has ${dollars(seat.left ?? '0')} left in these 30 days, less than ${dollars(Memo.decimal(amount))}.`
        : `You have ${dollars(author?.available ?? '0')} of backing not yet behind a note or branch, less than ${dollars(Memo.decimal(amount))}. Put new money behind this branch instead.`,
    )
  if (seat) Team.forget(row.id)

  await Store.base(env, row.id, target.id, target.budget === null ? 0n : Memo.units(target.budget))
  const money = await Store.funds(env, row.id)
  const total = backed(money, target.id)
  const set = await reached(stub(env, row.id).direct(row.id, {
    branch: target.id,
    said: `${Mention.at(account.handle)} put ${dollars(Memo.decimal(amount))} behind ${target.role} (branch ${target.id}), whose budget is now ${dollars(Memo.decimal(total))}.`,
    usd: Number(total) / 1_000_000,
    wake: target.starved ? `Backers raised your budget to ${dollars(Memo.decimal(total))}. Carry on with your task.` : null,
  }))
  if (!set.ok) {
    await Store.unsteer(env, [identity])
    return Problem.fail(502, 'upstream_failed', `The gateway did not raise the branch's budget, so nothing was put behind it: ${set.detail}`)
  }
  return Problem.ok(branched(set.value, money, await Store.members(env, row.id)))
}

export async function move(env: Cloudflare.Env, input: Input<'move'>, address?: Address): Promise<Problem.Result<Branch[]>> {
  const parsed = parse(schema.move, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  if (request.branch === request.to) return Problem.fail(400, 'invalid_request', 'Move money to another branch.')
  const allowed = await steerable(env, { address, swarm: request.swarm })
  if (!allowed.ok) return allowed
  const { account, row } = allowed.value

  const found = await directed(env, row)
  if (!found.ok) return found
  const source = found.value.list.find((branch) => branch.id === request.branch && branch.parent === null)
  const target = found.value.list.find((branch) => branch.id === request.to && branch.parent === null)
  if (!source || !target) return Problem.fail(404, 'not_found', `This swarm has no branch ${source ? request.to : request.branch}.`)
  if (target.state === 'closed' || target.state === 'closing') return Problem.fail(409, 'conflict', `${target.role} is closed; move the money to another branch.`)

  const amount = units(request.amount)
  if (source.left === null || Memo.units(source.left) < amount)
    return Problem.fail(409, 'insufficient_balance', `${source.role} has ${dollars(source.left ?? '0')} of its budget left, less than ${dollars(Memo.decimal(amount))}: money a branch spent stays spent.`)
  const ids = [identifier(), identifier()] as const
  if (!(await Store.shift(env, { amount, contributor: allowed.value.address, from: source.id, ids, swarm: row.id, team: row.steering === 'team', to: target.id })))
    return Problem.fail(409, 'insufficient_balance', `You put less than ${dollars(Memo.decimal(amount))} behind ${source.role}; you move only what you put behind a branch.`)

  await Store.base(env, row.id, target.id, target.budget === null ? 0n : Memo.units(target.budget))
  const money = await Store.funds(env, row.id)
  const lowered = await reached(stub(env, row.id).direct(row.id, { branch: source.id, said: null, usd: Number(backed(money, source.id)) / 1_000_000, wake: null }))
  const raised = lowered.ok
    ? await reached(stub(env, row.id).direct(row.id, {
        branch: target.id,
        said: `${Mention.at(account.handle)} moved ${dollars(Memo.decimal(amount))} from ${source.role} (branch ${source.id}) to ${target.role} (branch ${target.id}).`,
        usd: Number(backed(money, target.id)) / 1_000_000,
        wake: target.starved ? `Backers raised your budget to ${dollars(Memo.decimal(backed(money, target.id)))}. Carry on with your task.` : null,
      }))
    : lowered
  if (!raised.ok) {
    await Store.unsteer(env, ids)
    if (lowered.ok) await reached(stub(env, row.id).direct(row.id, { branch: source.id, said: null, usd: Number(backed(await Store.funds(env, row.id), source.id)) / 1_000_000, wake: null }))
    return Problem.fail(502, 'upstream_failed', `The gateway did not move the budget, so nothing moved: ${raised.detail}`)
  }
  const members = await Store.members(env, row.id)
  return Problem.ok([branched(lowered.ok ? lowered.value : raised.value, money, members), branched(raised.value, money, members)])
}

export async function btw(env: Cloudflare.Env, input: Input<'btw'>, address?: Address): Promise<Problem.Result<Btw.Exchange>> {
  const parsed = parse(schema.btw, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo Wallet to ask the swarm side questions.')
  const [row, account] = await Promise.all([Store.find(env, request.swarm), Store.account(env, address)])
  if (!row) return missing()
  if (!account.name) return unnamed()
  if (row.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is finished.')
  if (row.steering === 'team' && !(await Team.seat(env, row, address).catch(() => undefined)))
    return Problem.fail(403, 'not_member', "Only this swarm's team asks it side questions, as only its team steers it.")
  if (row.steering !== 'team' && !(await Store.members(env, row.id)).some((member) => member.address === address))
    return Problem.fail(403, 'not_member', 'Back this swarm first: a pledge, a transfer, a monthly budget or a lent machine lets you ask it side questions.')

  const answered = await stub(env, row.id).btw({ address, prompt: Btw.ask(request.thread, request.question), swarm: row.id })
  if (!answered.ok)
    return answered.status === 429
      ? Problem.fail(429, 'rate_limited', answered.detail)
      : answered.status === 409
        ? Problem.fail(409, 'conflict', answered.detail)
        : Problem.fail(502, 'upstream_failed', `The gateway did not answer the side question: ${answered.detail}`)
  return Problem.ok({ answer: answered.value, question: request.question })
}

export async function team(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<Roster>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const row = await Store.find(env, parsed.value.swarm)
  if (!row) return missing()
  return Team.roster(env, row).then(Problem.ok, (error: unknown) => Problem.fail(502, 'upstream_failed', String(error instanceof Error ? error.message : error)))
}

async function governed(env: Cloudflare.Env, swarm: string, address: Address | undefined): Promise<Problem.Result<Store.Row>> {
  if (!address) return Problem.fail(401, 'unauthorized', "Sign in with Tempo Wallet to manage who steers a swarm.")
  const row = await Store.find(env, swarm)
  if (!row) return missing()
  if (row.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is finished.')
  if (!(await Team.admin(env, row, address).catch(() => false)))
    return Problem.fail(403, 'access_denied', "Only this swarm's admins choose who steers it: whoever started it signed in, or else its first backer, and the admins they add.")
  return Problem.ok(row)
}

export async function steer(env: Cloudflare.Env, input: Input<'steering'>, address?: Address): Promise<Problem.Result<Roster>> {
  const parsed = parse(schema.steering, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  if (request.steering === undefined && request.memberBudget === undefined) return Problem.fail(400, 'invalid_request', 'Send steering, memberBudget or both.')
  const governing = await governed(env, request.swarm, address)
  if (!governing.ok) return governing
  const teamed = await Team.ensure(env, governing.value, address as Address)
  if (!teamed.ok) return teamed
  const row = teamed.value

  if (request.memberBudget !== undefined) {
    const set = await Gateway.allowance(env, row.team as string, request.memberBudget)
    if (!set.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not set the team's budget: ${set.detail}`)
  }
  if (request.steering) await Store.update(env, row.id, { steering: request.steering })
  Team.forget(row.id)
  const fresh = await Store.find(env, row.id)
  return Team.roster(env, fresh ?? row).then(Problem.ok, (error: unknown) => Problem.fail(502, 'upstream_failed', String(error instanceof Error ? error.message : error)))
}

export async function seat(env: Cloudflare.Env, input: Input<'seat'>, address?: Address): Promise<Problem.Result<Roster>> {
  const parsed = parse(schema.seat, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const governing = await governed(env, request.swarm, address)
  if (!governing.ok) return governing
  const teamed = await Team.ensure(env, governing.value, address as Address)
  if (!teamed.ok) return teamed
  const row = teamed.value

  const added = await Gateway.enlist(env, row.team as string, { ...(request.budget !== undefined ? { budget: request.budget } : {}), member: request.member, role: request.role })
  if (!added.ok) return Problem.fail(added.status === 409 ? 409 : 502, added.status === 409 ? 'conflict' : 'upstream_failed', `The gateway did not add ${request.member} to the swarm's team: ${added.detail}`)
  Team.forget(row.id)
  return Team.roster(env, row).then(Problem.ok, (error: unknown) => Problem.fail(502, 'upstream_failed', String(error instanceof Error ? error.message : error)))
}

export async function unseat(env: Cloudflare.Env, input: Input<'unseat'>, address?: Address): Promise<Problem.Result<Roster>> {
  const parsed = parse(schema.unseat, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo Wallet to leave or manage a swarm\'s team.')
  const row = await Store.find(env, request.swarm)
  if (!row) return missing()
  if (!row.team) return Problem.fail(404, 'not_found', 'This swarm has no team yet.')
  const roster = await Team.roster(env, row).catch(() => undefined)
  if (!roster) return Problem.fail(502, 'upstream_failed', "The gateway did not list the swarm's team.")
  const self = request.member === address.toLowerCase()
  if (!self && !roster.admins.includes(address.toLowerCase() as Address))
    return Problem.fail(403, 'access_denied', "Only this swarm's admins remove others from its team; anyone may leave it.")
  if (roster.admins.length === 1 && roster.admins[0] === request.member)
    return Problem.fail(409, 'conflict', 'The swarm\'s last admin stays: add another admin first.')

  const removed = await Gateway.dismiss(env, row.team, request.member)
  if (!removed.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not remove ${request.member}: ${removed.detail}`)
  Team.forget(row.id)
  return Team.roster(env, row).then(Problem.ok, (error: unknown) => Problem.fail(502, 'upstream_failed', String(error instanceof Error ? error.message : error)))
}

export async function chatter(env: Cloudflare.Env, input: Input<'swarm'>, request: Request): Promise<Problem.Result<Response>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return Problem.fail(400, 'invalid_request', 'Open this route as a WebSocket.')
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()

  return Problem.ok(await stub(env, parsed.value.swarm).fetch(new Request(`https://swarm/chat?swarm=${encodeURIComponent(parsed.value.swarm)}`, request)))
}

function dollars(amount: string) {
  return '$' + amount.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

async function self(env: Cloudflare.Env, members: readonly Member[], address: Address): Promise<Me> {
  const found = members.find((member) => member.address === address)
  if (found) return { ...found, member: true }
  const known = await Store.account(env, address)
  return { address, available: Memo.decimal(0n), backed: Memo.decimal(0n), handle: known.handle, member: false, since: 0, steered: Memo.decimal(0n), ways: [] }
}

export async function hand(env: Cloudflare.Env, input: Input<'hand'>, contributor?: Address): Promise<Problem.Result<Issued>> {
  const parsed = parse(schema.hand, input)
  if (!parsed.ok) return parsed
  const found = await Store.find(env, parsed.value.swarm)
  if (!found) return missing()
  if ((await Hands.count(env, found.id)) >= Hands.limit)
    return Problem.fail(409, 'conflict', `This swarm has ${Hands.limit} hands already.`)
  const row = await provisioned(env, found)

  const label = parsed.value.label ?? ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const name = await Hands.issue(env, row.id, label, contributor ?? null)
    if (!name) break
    const minted = await stub(env, row.id).hand(row.id, name)
    if (minted.ok)
      return Problem.ok({
        cli: Connect.cli(minted.value),
        command: minted.value.command,
        label,
        library: Connect.library({ name, token: minted.value.token, url: minted.value.url }),
        name,
        npm: Connect.install,
        swarm: row.id,
        tab: minted.value.tab ?? null,
        token: minted.value.token,
        url: minted.value.url,
      })
    await Hands.forget(env, row.id, name)
    if (minted.status !== 409) return Problem.fail(502, 'upstream_failed', `The gateway did not issue the hand: ${minted.detail}`)
  }
  return Problem.fail(502, 'unavailable', 'No free hand name was found. Try again.')
}

export async function hands(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<{ hands: Lent[] }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()

  const rows = await Hands.list(env, parsed.value.swarm)
  return Problem.ok({ hands: Hands.lent(rows, rows.length ? await stub(env, parsed.value.swarm).lent() : []) })
}

export async function transfer(env: Cloudflare.Env, input: Input<'transfer'>, origin: string): Promise<Problem.Result<Prepared>> {
  const parsed = parse(schema.transfer, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const found = await Store.find(env, request.swarm)
  if (!found) return missing()
  const row = await provisioned(env, found)

  const note = request.note || null
  const amount = request.amount === undefined ? null : units(request.amount)
  const memo = Transfer.memo(row.id, note)
  const token = Chain.tokens[request.token]
  const query = new URLSearchParams({
    fund: 'transfer',
    token: request.token,
    ...(amount === null ? {} : { amount: Memo.decimal(amount) }),
    ...(note ? { note } : {}),
  })
  return Problem.ok({
    amount: amount === null ? null : Memo.decimal(amount),
    call:
      amount === null
        ? null
        : { data: encodeFunctionData({ abi: Abis.tip20, args: [row.wallet, amount, memo], functionName: 'transferWithMemo' }), to: token.address },
    link: `${origin}/s/${row.id}?${query}`,
    memo,
    memoText: note ? `note:${row.id}:${note}` : `swarm:${row.id}`,
    note,
    swarm: row.id,
    symbol: token.symbol,
    token: request.token,
    tokenAddress: token.address,
    wallet: row.wallet,
  })
}

export async function link(env: Cloudflare.Env, input: Input<'budget'>, origin: string): Promise<Problem.Result<Linked>> {
  const parsed = parse(schema.budget, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const found = await Store.find(env, request.swarm)
  if (!found) return missing()
  const row = await provisioned(env, found)

  const amount = Memo.decimal(units(request.amount))
  const note = request.note || null
  const query = new URLSearchParams({ amount, fund: 'budget', token: request.token, ...(note ? { note } : {}) })
  return Problem.ok({
    amount,
    days: Store.budget.days,
    link: `${origin}/s/${row.id}?${query}`,
    note,
    swarm: row.id,
    symbol: Chain.currencies[request.token].symbol,
    token: request.token,
    wallet: row.wallet,
  })
}

export async function pledges(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<{ pledges: Pledge[] }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()

  return Problem.ok({ pledges: await Store.pledges(env, parsed.value.swarm) })
}

export async function pledge(env: Cloudflare.Env, input: Input<'pledge'>): Promise<Problem.Result<Requested>> {
  const parsed = parse(schema.pledge, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const found = await Store.find(env, request.swarm)
  if (!found) return missing()
  const row = await provisioned(env, found)

  const amount = units(request.amount)
  const requested = await Keys.request(env, { amount, days: pledgeDays, period: 0, recipient: row.wallet, token: request.token })
  const device = request.device ? await Devices.register(requested.authorizeAccessKey, Chain.chain.id, env.SWARMS_URL) : undefined
  if (request.device && !device) return Problem.fail(502, 'upstream_failed', 'Tempo Wallet did not register the approval request.')

  const note = request.note || null
  const id = identifier()
  await Store.allow(env, {
    access_key: requested.authorizeAccessKey.address,
    amount: String(amount),
    authorization: JSON.stringify(requested.authorizeAccessKey),
    expires_at: requested.authorizeAccessKey.expiry * 1000,
    id,
    note,
    note_id: note ? await Store.noteId(note) : null,
    period: 0,
    sealed_key: requested.sealed,
    swarm: row.id,
    token: request.token,
  })
  if (device) await Devices.save(env, id, device)
  return Problem.ok({
    authorizeAccessKey: requested.authorizeAccessKey,
    ...(device
      ? { device: { expiresAt: device.expiresAt, interval: device.interval, userCode: device.userCode, verificationUri: device.verificationUri, verificationUriFull: device.verificationUriFull } }
      : {}),
    pledge: id,
  })
}

export async function pay(env: Cloudflare.Env, swarm: string, authorization: string, input: Record<string, unknown>): Promise<Paid> {
  const secret = /^Bearer (.+)$/.exec(authorization)?.[1]
  const challenge = input['challenge']
  if (secret && input['operation'] === 'budget') {
    if (!(await Store.exists(env, swarm))) return { code: 'unauthorized', detail: 'No swarm has this id.', status: 401 }
    return stub(env, swarm).budget(secret, typeof input['app'] === 'string' ? input['app'] : undefined)
  }
  if (!secret || !(typeof challenge === 'string' || (Array.isArray(challenge) && challenge.every((value) => typeof value === 'string'))))
    return { code: 'unauthorized', detail: 'Send the payer secret as a bearer token, and the challenge.', status: 401 }
  if (!(await Store.exists(env, swarm))) return { code: 'unauthorized', detail: 'No swarm has this id.', status: 401 }
  return stub(env, swarm).pay({
    amount: typeof input['amount'] === 'string' ? input['amount'] : undefined,
    operation: typeof input['operation'] === 'string' ? input['operation'] : undefined,
    path: typeof input['path'] === 'string' ? input['path'].slice(0, 2048) : undefined,
    app: typeof input['app'] === 'string' ? input['app'] : undefined,
    attempt: typeof input['attempt'] === 'number' ? input['attempt'] : undefined,
    challenge: challenge as string | string[],
    channels: Array.isArray(input['channels']) ? (input['channels'] as Snapshot[]) : undefined,
    hand: typeof input['hand'] === 'string' ? input['hand'].slice(0, 64) : undefined,
    recipient: typeof input['recipient'] === 'string' && isAddress(input['recipient']) ? input['recipient'] : undefined,
    rejected: typeof input['rejected'] === 'object' && input['rejected'] !== null ? (input['rejected'] as { detail: string; status: number }) : undefined,
    secret,
  })
}

export async function contribute(
  env: Cloudflare.Env,
  input: Input<'contribution'>,
): Promise<Problem.Result<{ contributed: Contributed; created: boolean }>> {
  const parsed = parse(schema.contribution, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const found = await Store.find(env, request.swarm)
  if (!found) return missing()
  const row = await provisioned(env, found)

  const receipt = await getTransactionReceipt(Chain.client(env), { hash: request.hash as Hex }).catch(() => undefined)
  if (!receipt) return Problem.fail(404, 'not_found', 'Tempo has no receipt for this transaction yet.')
  if (receipt.status !== 'success') return Problem.fail(400, 'invalid_request', 'The transaction reverted.')

  const wallet = row.wallet.toLowerCase()
  const sender = receipt.from.toLowerCase()
  const logs = parseEventLogs({ abi: Abis.tip20, logs: receipt.logs })
  const transfers = logs.flatMap((log) => {
    const token = Chain.token(log.address)
    return log.eventName === 'Transfer' &&
      token &&
      log.args.to.toLowerCase() === wallet &&
      log.args.from.toLowerCase() === sender &&
      sender !== wallet
      ? [{ amount: log.args.amount, token }]
      : []
  })
  const first = transfers[0]
  if (!first)
    return Problem.fail(
      400,
      'invalid_request',
      `That transaction sends no USDC.e, pathUSD or OUSD from its sender to this swarm's address ${row.wallet}. MACH cannot be sent to a swarm: pledge it instead.`,
    )

  const text = request.note || null
  const memos = logs.flatMap((log) =>
    log.eventName === 'TransferWithMemo' && log.args.to.toLowerCase() === wallet ? [log.args.memo.toLowerCase()] : [],
  )
  if (text && !memos.includes(Transfer.memo(row.id, text).toLowerCase()))
    return Problem.fail(
      400,
      'invalid_request',
      `The transfer's memo does not commit to this note. Send it with the memo keccak256("note:${row.id}:<note>").`,
    )

  const total = transfers.reduce((sum, transfer) => sum + transfer.amount, 0n)
  const noteId = text ? await Store.noteId(text) : null
  const existing = await Store.gift(env, request.hash)
  if (existing) {
    if (!text || existing.note || existing.kind !== 'transfer' || !noteId)
      return Problem.fail(409, 'conflict', 'This transaction is already counted.')
    await Store.annotate(env, request.hash, { note: text, note_id: noteId })
  } else {
    await Store.give(env, {
      amount: String(total),
      budget: null,
      contributor: sender as Address,
      id: request.hash as Hex,
      kind: 'transfer',
      note: text,
      note_id: noteId,
      swarm: row.id,
      token: first.token,
    })
  }
  await stub(env, row.id).contributed({
    amount: Memo.decimal(total),
    contributor: sender as Address,
    hash: request.hash,
    note: text,
    noteId,
    swarm: row.id,
    token: first.token,
  })
  if (text && noteId) await logged(Search.note(env, row.id, noteId, text))

  const [gift, updated] = await Promise.all([Store.gift(env, request.hash), Store.find(env, row.id)])
  if (!gift) return Problem.fail(502, 'unavailable', 'The contribution was not saved.')
  return Problem.ok({
    contributed: { contribution: Store.contribution(gift), swarm: Store.summary(updated ?? row) },
    created: !existing,
  })
}

export async function budget(env: Cloudflare.Env, input: Input<'budget'>): Promise<Problem.Result<BudgetRequested>> {
  const parsed = parse(schema.budget, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const found = await Store.find(env, request.swarm)
  if (!found) return missing()
  const row = await provisioned(env, found)

  const amount = units(request.amount)
  const requested = await Keys.request(env, {
    amount,
    days: Store.budget.days,
    period: Store.budget.period,
    recipient: row.wallet,
    token: request.token,
  })
  const text = request.note || null
  const id = identifier()
  await Store.allow(env, {
    access_key: requested.authorizeAccessKey.address,
    amount: String(amount),
    authorization: JSON.stringify(requested.authorizeAccessKey),
    expires_at: requested.authorizeAccessKey.expiry * 1000,
    id,
    note: text,
    note_id: text ? await Store.noteId(text) : null,
    period: Store.budget.period,
    sealed_key: requested.sealed,
    swarm: row.id,
    token: request.token,
  })
  return Problem.ok({ authorizeAccessKey: requested.authorizeAccessKey, budget: id })
}

export async function allow(env: Cloudflare.Env, input: Input<'allowance'>): Promise<Problem.Result<Budgeted>> {
  const parsed = parse(schema.allowance, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  if (request.keyAuthorization === undefined && request.transaction === undefined)
    return Problem.fail(400, 'invalid_request', 'Send the keyAuthorization Tempo Wallet returned, or a signed transaction carrying it.')
  const [row, allowance] = await Promise.all([Store.find(env, request.swarm), Store.allowance(env, request.swarm, request.budget)])
  if (!row || !allowance || !allowance.period) return Problem.fail(404, 'not_found', 'No budget has this id.')
  if (allowance.status !== 'pending') return Problem.fail(409, 'conflict', 'This budget is already approved.')

  const approved = await Keys.approve(env, JSON.parse(allowance.authorization) as Keys.Request, {
    keyAuthorization: request.keyAuthorization,
    transaction: request.transaction as Hex | undefined,
  })
  if (typeof approved === 'string') return Problem.fail(400, 'invalid_request', approved)
  const activated = await Store.approve(env, allowance.id, {
    amount: String(approved.limit),
    contributor: approved.contributor,
    key_authorization: JSON.stringify(approved.keyAuthorization),
    published: approved.published,
  })
  if (!activated) return Problem.fail(409, 'conflict', 'This budget is already approved.')
  await stub(env, row.id).budgeted({
    amount: Memo.decimal(approved.limit),
    id: allowance.id,
    contributor: approved.contributor,
    note: allowance.note,
    period: allowance.period,
    swarm: row.id,
    token: allowance.token,
  })
  if (allowance.note && allowance.note_id) await logged(Search.note(env, row.id, allowance.note_id, allowance.note))

  const [updated, saved] = await Promise.all([Store.find(env, row.id), Store.allowance(env, row.id, allowance.id)])
  return Problem.ok({ budget: Store.view(saved ?? allowance), swarm: Store.summary(updated ?? row) })
}

export async function approve(env: Cloudflare.Env, input: Input<'approval'>): Promise<Problem.Result<Pledged | Pending>> {
  const parsed = parse(schema.approval, input)
  if (!parsed.ok) return parsed
  const approval = parsed.value
  if (approval.keyAuthorization === undefined && approval.transaction === undefined) {
    const polled = await poll(env, approval)
    if (polled.ok && polled.value.status === 'pending' && !polled.value.device)
      return Problem.fail(
        400,
        'invalid_request',
        'Send the keyAuthorization Tempo Wallet returned, or a signed transaction carrying it. A pledge requested with device: true is polled instead.',
      )
    return polled
  }

  const [row, key] = await Promise.all([Store.find(env, approval.swarm), Store.allowance(env, approval.swarm, approval.pledge)])
  if (!row || !key || key.period) return Problem.fail(404, 'not_found', 'No pledge has this id.')
  if (key.status !== 'pending') return Problem.fail(409, 'conflict', 'This pledge is already approved.')
  return activate(env, row, key, { keyAuthorization: approval.keyAuthorization, transaction: approval.transaction as Hex | undefined })
}

export async function status(
  env: Cloudflare.Env,
  input: Input<'pledged'>,
  signal?: AbortSignal,
): Promise<Problem.Result<Pledged | Pending>> {
  const parsed = parse(schema.pledged, input)
  if (!parsed.ok) return parsed
  const deadline = Date.now() + parsed.value.wait * 1000

  for (;;) {
    const polled = await poll(env, parsed.value)
    if (!polled.ok || polled.value.status !== 'pending' || !polled.value.device) return polled
    if (Date.now() >= deadline || signal?.aborted) return polled
    await sleep(Math.min(Math.max(3, polled.value.device.interval) * 1000, deadline - Date.now()), signal)
  }
}

async function poll(env: Cloudflare.Env, input: { pledge: string; swarm: string }): Promise<Problem.Result<Pledged | Pending>> {
  const [row, key] = await Promise.all([Store.find(env, input.swarm), Store.allowance(env, input.swarm, input.pledge)])
  if (!row || !key || key.period) return Problem.fail(404, 'not_found', 'No pledge has this id.')
  if (key.status !== 'pending') return Problem.ok(pledged(row, key))
  const device = await Devices.find(env, key.id)
  if (!device) return Problem.ok(pending(key, null))

  const polled = await Devices.poll(env, key.id)
  if (polled.status === 'pending') return Problem.ok(pending(key, device))
  if (polled.status === 'approved') return activate(env, row, key, { keyAuthorization: polled.keyAuthorization })
  if (polled.status === 'denied') {
    await forget(env, key.id)
    return Problem.fail(403, 'access_denied', polled.detail)
  }

  const again = await Store.allowance(env, input.swarm, input.pledge)
  if (again && again.status !== 'pending') return Problem.ok(pledged(row, again))
  if (polled.status === 'failed' && Date.now() < device.expiresAt)
    return Problem.fail(502, 'upstream_failed', `Tempo Wallet did not report on the approval: ${polled.detail}`)
  await forget(env, key.id)
  return Problem.fail(410, 'expired', 'The Tempo Wallet approval expired before anyone approved it. Pledge again.')
}

async function activate(
  env: Cloudflare.Env,
  row: Store.Row,
  key: Store.Allowance,
  input: { keyAuthorization?: unknown; transaction?: Hex | undefined },
): Promise<Problem.Result<Pledged>> {
  const approved = await Keys.approve(env, JSON.parse(key.authorization) as Keys.Request, input)
  if (typeof approved === 'string') return Problem.fail(400, 'invalid_request', approved)

  const symbol = Chain.currencies[key.token].symbol
  const balance = await Keys.balance(env, approved.contributor, key.token).catch(() => undefined)
  if (balance !== undefined && balance < approved.limit) {
    await forget(env, key.id)
    return Problem.fail(
      409,
      'insufficient_balance',
      `The wallet holds ${Memo.decimal(balance)} ${symbol}, less than the ${Memo.decimal(approved.limit)} ${symbol} pledge. Add some and pledge again.`,
    )
  }

  const activated = await Store.approve(env, key.id, {
    amount: String(approved.limit),
    contributor: approved.contributor,
    key_authorization: JSON.stringify(approved.keyAuthorization),
    published: approved.published,
  })
  if (!activated) {
    const again = await Store.allowance(env, row.id, key.id)
    return again && again.status !== 'pending' ? Problem.ok(pledged(row, again)) : Problem.fail(409, 'conflict', 'This pledge is already approved.')
  }
  await Devices.forget(env, key.id)
  await stub(env, row.id).pledged({
    amount: Memo.decimal(approved.limit),
    id: key.id,
    contributor: approved.contributor,
    note: key.note,
    noteId: key.note_id,
    swarm: row.id,
    token: key.token,
  })
  if (key.note && key.note_id) await logged(Search.note(env, row.id, key.note_id, key.note))

  const [updated, saved] = await Promise.all([Store.find(env, row.id), Store.allowance(env, row.id, key.id)])
  return Problem.ok(pledged(updated ?? row, saved ?? key))
}

async function forget(env: Cloudflare.Env, pledge: string) {
  await Promise.all([Store.forget(env, pledge), Devices.forget(env, pledge)])
}

function pledged(row: Store.Row, key: Store.Allowance): Pledged {
  const pledge = Store.pledge(key)
  return { pledge, status: pledge.status, swarm: Store.summary(row) }
}

function pending(key: Store.Allowance, device: Pending['device']): Pending {
  return {
    amount: Memo.decimal(BigInt(key.amount)),
    device,
    note: key.note,
    pledge: key.id,
    status: 'pending',
  }
}

function excerpt(entry: Entry, terms: readonly string[], size = 240) {
  const text = entry.detail ? `${entry.text}\n${entry.detail}` : entry.text
  const lower = text.toLowerCase()
  const at = Math.min(...terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0), text.length)
  const start = at < size / 2 ? 0 : at - size / 3
  const pattern = new RegExp([...terms].sort((a, b) => b.length - a.length).join('|'), 'giu')
  const marked = text.slice(start, start + size).replace(pattern, (found) => `«${found}»`)
  return `${start > 0 ? '…' : ''}${marked}${start + size < text.length ? '…' : ''}`
}

export async function problems(env: Cloudflare.Env): Promise<Problem.Result<{ problems: (Brief.Problem & { open: boolean; swarm: string | null })[] }>> {
  const listed = await list(env, {})
  const rows = listed.ok ? listed.value.swarms : []
  const taken = new Map(rows.filter((row) => row.status !== 'done' && row.problem).map((row) => [row.problem as string, row.id]))
  return Problem.ok({ problems: Brief.problems.map((item) => ({ ...item, open: !taken.has(item.id), swarm: taken.get(item.id) ?? null })) })
}

export async function machines(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<{ machines: Fleet.Machine[] }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const loaded = await load(env, parsed.value.swarm, { feed: 0, texts: false })
  if (!loaded) return missing()
  const [entries, lent] = await Promise.all([stub(env, parsed.value.swarm).feed(0, { limit: 2000 }), hands(env, input)])
  return Problem.ok({ machines: Fleet.fleet(entries, loaded.view.hands, lent.ok ? lent.value.hands : []) })
}

export async function backers(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<{ backers: Member[]; ideas: Note[] }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const loaded = await load(env, parsed.value.swarm, { feed: 0, texts: false })
  if (!loaded) return missing()
  const { row, view } = loaded
  const [members, ideas] = await Promise.all([Store.members(env, row.id), Store.notes(env, row.id, BigInt(row.raised), new Set(view.steered))])
  return Problem.ok({ backers: [...members].sort((a, b) => Number(BigInt(Math.round(Number(b.backed) * 1e6)) - BigInt(Math.round(Number(a.backed) * 1e6)))), ideas })
}
