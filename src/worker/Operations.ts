import { encodeFunctionData, parseEventLogs } from 'viem'
import type { Address, Hex } from 'viem'
import { getTransactionReceipt } from 'viem/actions'
import { Abis } from 'viem/tempo'
import { z } from 'zod'
import type {
  Answered,
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
  Overview,
  Page,
  Pending,
  Pledge,
  Pledged,
  Prepared,
  Requested,
  Round,
  Running,
  Status,
  Summary,
  Waited,
} from '../shared/Api.ts'
import * as Answer from '../shared/Answer.ts'
import * as Connect from '../shared/Connect.ts'
import * as Memo from '../shared/Memo.ts'
import * as Budget from './Budget.ts'
import * as Chain from './Chain.ts'
import * as Devices from './Devices.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Problem from './Problem.ts'
import * as Seal from './Seal.ts'
import * as Search from './Search.ts'
import * as Store from './Store.ts'
import type { Swarm } from './Swarm.ts'
import * as Vault from './Vault.ts'

export const statuses = ['funding', 'running', 'paused', 'done'] as const satisfies readonly Status[]

export const kinds = ['tool', 'message', 'thinking', 'steer', 'funds', 'status', 'machine', 'error'] as const satisfies readonly Kind[]

export const sources = ['swarm', 'report', 'note', 'feed'] as const satisfies readonly Hit['kind'][]

export const maxWait = 55

const id = z.string().trim().min(1).max(64).describe('The swarm id, the last part of its page URL /s/<id>.')

const pledgeId = z.string().trim().min(1).max(64).describe('The pledge id that swarm_pledge or the pledge request returned.')

function units(value: string | number) {
  return Memo.units(typeof value === 'number' ? value.toFixed(6) : value)
}

const decimal = z.union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()])

const amount = decimal
  .refine((value) => units(value) >= Store.minPledge, `A pledge is at least ${Memo.decimal(Store.minPledge)}.`)
  .refine((value) => units(value) <= 100_000_000n, 'A pledge is at most 100.')
  .describe(`The amount to pledge in its token, from ${Memo.decimal(Store.minPledge)} to 100, as a decimal string such as "0.25" or a number.`)

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
      .refine((value) => units(value) >= Store.budget.min, `A daily budget is at least ${Memo.decimal(Store.budget.min)}.`)
      .refine((value) => units(value) <= Store.budget.max, `A daily budget is at most ${Memo.decimal(Store.budget.max)}.`)
      .describe(
        `Tokens the swarm may pull a day, from ${Memo.decimal(Store.budget.min)} to ${Memo.decimal(Store.budget.max)}, as a decimal string or a number.`,
      ),
    note,
    swarm: id,
    token: z.enum(Chain.ids).describe('The stablecoin the swarm pulls from the contributor.'),
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
      .describe('What the swarm should find out or build, what done looks like and what each round should report.'),
    title: z.string().trim().min(3).max(80).describe('A short name for the swarm.'),
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
    limit: z.coerce.number().int().min(1).max(200).default(200).describe('At most this many entries.'),
    swarm: id,
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
  round: z.object({
    round: z.coerce.number().int().min(1).optional().describe('Only this round.'),
    swarm: id,
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
      .describe('Return once a round newer than this one has ended. Defaults to the newest ended round, so it waits for the next.'),
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

function running(rounds: readonly Round[]): Running | null {
  const found = rounds.findLast((round) => round.status === 'running')
  return found ? { n: found.n, startedAt: found.startedAt } : null
}

async function provisioned(env: Cloudflare.Env, row: Store.Row) {
  if (row.wallet) return { ...row, wallet: row.wallet }
  await Store.provision(env, row.id, await Vault.create(env.SWARMS_SECRET))
  const updated = await Store.find(env, row.id)
  if (!updated?.wallet) throw new Error('The swarm has no wallet.')
  return { ...updated, wallet: updated.wallet }
}

async function load(env: Cloudflare.Env, id: string) {
  const found = await Store.find(env, id)
  if (!found) return undefined
  const row = await provisioned(env, found)

  const view = await stub(env, id).view()
  const answered = view.rounds.findLast((round) => round.status === 'completed' && round.message)
  if (!row.answer && answered?.message) {
    row.answer = JSON.stringify(Answer.parse(answered.n, answered.message, answered.endedAt ?? Date.now()))
    await Store.update(env, id, { answer: row.answer })
  }
  return { row, view }
}

export function config(env: Cloudflare.Env): Config {
  return {
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
    perWorker: Memo.decimal(Store.perWorker),
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

  const rows = await Store.list(env, parsed.value.status)
  return Problem.ok({ swarms: rows.map((row) => Store.summary(row)) })
}

export async function create(env: Cloudflare.Env, input: Input<'create'>): Promise<Problem.Result<Summary>> {
  const parsed = parse(schema.create, input)
  if (!parsed.ok) return parsed

  const swarm = { goal: parsed.value.goal, id: identifier(), title: parsed.value.title }
  await Store.insert(env, { ...swarm, ...(await Vault.create(env.SWARMS_SECRET)) })
  const [row] = await Promise.all([Store.find(env, swarm.id), logged(Search.swarm(env, swarm))])
  return row ? Problem.ok(Store.summary(row)) : Problem.fail(502, 'unavailable', 'The swarm was not saved.')
}

export async function detail(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<Detail>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const loaded = await load(env, parsed.value.swarm)
  if (!loaded) return missing()

  const row = loaded.row
  const view = loaded.view
  const [pledges, notes, budgets, contributions] = await Promise.all([
    Store.pledges(env, row.id),
    Store.notes(env, row.id, BigInt(row.raised), new Set(view.steered)),
    Store.budgets(env, row.id),
    Store.contributions(env, row.id),
    logged(Search.sync(env, row.id, view.rounds)),
  ])
  return Problem.ok({
    ...Store.summary(row, view.left === null ? undefined : Memo.units(view.left)),
    budgets,
    contributions,
    feed: view.feed,
    researchers: view.researchers,
    hands: view.hands,
    history: view.rounds,
    notes,
    pledges,
  })
}

export async function get(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<Overview>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const loaded = await load(env, parsed.value.swarm)
  if (!loaded) return missing()

  const row = loaded.row
  const view = loaded.view
  const [pledges, notes, budgets, contributions] = await Promise.all([
    Store.pledges(env, row.id),
    Store.notes(env, row.id, BigInt(row.raised), new Set(view.steered)),
    Store.budgets(env, row.id),
    Store.contributions(env, row.id),
    logged(Search.sync(env, row.id, view.rounds)),
  ])
  return Problem.ok({
    ...Store.summary(row, view.left === null ? undefined : Memo.units(view.left)),
    budgets,
    contributions,
    hands: view.hands,
    history: view.rounds.map((round) => ({
      endedAt: round.endedAt,
      excerpt: round.message ? Answer.excerpt(Answer.parse(round.n, round.message, 0).text) : null,
      n: round.n,
      spent: round.spent,
      startedAt: round.startedAt,
      status: round.status,
    })),
    notes,
    pledges,
    running: running(view.rounds),
    researchers: view.researchers,
  })
}

export async function answer(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<Answered>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const loaded = await load(env, parsed.value.swarm)
  if (!loaded) return missing()

  const summary = Store.summary(loaded.row)
  return Problem.ok({
    answer: summary.answer,
    running: running(loaded.view.rounds),
    status: summary.status,
    swarm: summary.id,
    title: summary.title,
  })
}

export async function rounds(env: Cloudflare.Env, input: Input<'round'>): Promise<Problem.Result<{ rounds: Round[] }>> {
  const parsed = parse(schema.round, input)
  if (!parsed.ok) return parsed
  const swarm = parsed.value.swarm
  if (!(await Store.exists(env, swarm))) return missing()

  const all = await stub(env, swarm).rounds()
  await logged(Search.sync(env, swarm, all))
  const wanted = parsed.value.round
  if (wanted === undefined) return Problem.ok({ rounds: all })
  const found = all.find((round) => round.n === wanted)
  return found ? Problem.ok({ rounds: [found] }) : Problem.fail(404, 'not_found', `This swarm has no round ${wanted}.`)
}

export async function feed(env: Cloudflare.Env, input: Input<'feed'>): Promise<Problem.Result<Page>> {
  const parsed = parse(schema.feed, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  if (!(await Store.exists(env, query.swarm))) return missing()

  const entries = await stub(env, query.swarm).feed(query.after, { kind: query.kind, limit: query.limit })
  return Problem.ok({ entries, next: entries.at(-1)?.seq ?? query.after })
}

export async function live(env: Cloudflare.Env, input: Input<'swarm'>, signal: AbortSignal): Promise<Problem.Result<Response>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()

  return Problem.ok(await stub(env, parsed.value.swarm).fetch(new Request('https://swarm/live', { signal })))
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
  await Promise.all(stale.map(async (swarm) => logged(Search.sync(env, swarm, await stub(env, swarm).rounds()))))
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
      round: entry.round,
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
  const first = await stub(env, swarm).rounds()
  const since = parsed.value.after ?? first.findLast((round) => round.endedAt !== null)?.n ?? 0

  let all = first
  for (;;) {
    const row = await Store.find(env, swarm)
    if (!row) return missing()
    const ended = all.findLast((round) => round.endedAt !== null && round.n > since) ?? null
    const current = running(all)
    const reason = ended
      ? 'ended'
      : !current && row.status !== 'running'
        ? 'idle'
        : Date.now() >= deadline || signal?.aborted
          ? 'timeout'
          : undefined
    if (reason) {
      if (ended) await logged(Search.sync(env, swarm, all))
      return Problem.ok({
        changed: ended !== null,
        reason,
        round: ended,
        running: current,
        swarm: Store.summary(row),
        waited: Date.now() - started,
      })
    }
    await sleep(Math.min(2000, deadline - Date.now()), signal)
    all = await stub(env, swarm).rounds()
  }
}

export async function hand(env: Cloudflare.Env, input: Input<'hand'>): Promise<Problem.Result<Issued>> {
  const parsed = parse(schema.hand, input)
  if (!parsed.ok) return parsed
  const found = await Store.find(env, parsed.value.swarm)
  if (!found) return missing()
  if (found.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is done.')
  if ((await Hands.count(env, found.id)) >= Hands.limit)
    return Problem.fail(409, 'conflict', `This swarm has ${Hands.limit} hands already.`)
  const row = await provisioned(env, found)

  const label = parsed.value.label ?? ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const name = await Hands.issue(env, row.id, label)
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
  const connected = rows.length ? new Set(await stub(env, parsed.value.swarm).lent()) : new Set<string>()
  return Problem.ok({ hands: Hands.lent(rows, connected) })
}

export async function transfer(env: Cloudflare.Env, input: Input<'transfer'>, origin: string): Promise<Problem.Result<Prepared>> {
  const parsed = parse(schema.transfer, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const found = await Store.find(env, request.swarm)
  if (!found) return missing()
  if (found.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is done.')
  const row = await provisioned(env, found)

  const note = request.note || null
  const amount = request.amount === undefined ? null : units(request.amount)
  const memo = Memo.memo(row.id, note)
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
  if (found.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is done.')
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
    symbol: Chain.tokens[request.token].symbol,
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
  const row = await Store.find(env, request.swarm)
  if (!row) return missing()
  if (row.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is done.')

  const atomics = units(request.amount)
  const deposit = Number(atomics) / 1e6
  const requested = await Gateway.request(env, {
    days: 7,
    deposit,
    device: request.device,
    limit: Math.max(1, Math.ceil(deposit)),
    token: request.token,
    topUp: 0,
  })
  if (!requested.ok)
    return Problem.fail(502, 'upstream_failed', `The gateway did not start a key: ${requested.detail}`)
  const device = requested.value.device
  if (request.device && !device)
    return Problem.fail(502, 'upstream_failed', 'The gateway did not register the key request with Tempo Wallet.')

  const note = request.note || null
  const id = identifier()
  await Store.request(env, {
    amount: String(atomics),
    id,
    note,
    note_id: note ? await Store.noteId(note) : null,
    request: requested.value.id,
    swarm: row.id,
    token: request.token,
  })
  if (device) await Devices.save(env, id, device)
  return Problem.ok({ authorizeAccessKey: requested.value.authorizeAccessKey, ...(device ? { device } : {}), pledge: id })
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
  if (found.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is done.')
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
  if (text && !memos.includes(Memo.memo(row.id, text).toLowerCase()))
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
  if (found.status === 'done') return Problem.fail(409, 'conflict', 'This swarm is done.')
  const row = await provisioned(env, found)

  const amount = units(request.amount)
  const requested = await Budget.request(env, {
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
  if (!row || !allowance) return Problem.fail(404, 'not_found', 'No budget has this id.')
  if (allowance.status !== 'pending') return Problem.fail(409, 'conflict', 'This budget is already approved.')

  const approved = await Budget.approve(env, JSON.parse(allowance.authorization) as Budget.Request, {
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

  const [row, backing] = await Promise.all([Store.find(env, approval.swarm), Store.backing(env, approval.swarm, approval.pledge)])
  if (!row || !backing) return Problem.fail(404, 'not_found', 'No pledge has this id.')
  if (backing.status !== 'pending') return Problem.fail(409, 'conflict', 'This pledge is already approved.')

  const completed = await Gateway.complete(env, {
    id: backing.request,
    ...(approval.keyAuthorization === undefined ? {} : { keyAuthorization: approval.keyAuthorization }),
    name: name(row),
    ...(approval.transaction === undefined ? {} : { transaction: approval.transaction }),
  })
  if (!completed.ok)
    return Problem.fail(400, 'invalid_request', `The gateway refused the approval: ${completed.detail}`)
  if (completed.value.status !== 'completed')
    return Problem.fail(400, 'invalid_request', 'The gateway did not complete the key.')
  return activate(env, row, backing, completed.value.key)
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
  const [row, backing] = await Promise.all([Store.find(env, input.swarm), Store.backing(env, input.swarm, input.pledge)])
  if (!row || !backing) return Problem.fail(404, 'not_found', 'No pledge has this id.')
  if (backing.status !== 'pending') return Problem.ok(pledged(row, backing))
  const device = await Devices.find(env, backing.id)
  if (!device) return Problem.ok(pending(backing, null))

  const completed = await Gateway.complete(env, { id: backing.request, name: name(row) })
  if (completed.ok)
    return completed.value.status === 'completed'
      ? activate(env, row, backing, completed.value.key)
      : Problem.ok(pending(backing, device))
  if (completed.status === 403) {
    await forget(env, backing.id)
    return Problem.fail(403, 'access_denied', 'The pledge was declined in Tempo Wallet.')
  }
  if (completed.status !== 404)
    return Problem.fail(502, 'upstream_failed', `The gateway did not report on the approval: ${completed.detail}`)

  const [now, again] = await Promise.all([Store.find(env, input.swarm), Store.backing(env, input.swarm, input.pledge)])
  if (now && again && again.status !== 'pending') return Problem.ok(pledged(now, again))
  if (Date.now() < device.expiresAt) return Problem.ok(pending(backing, device))
  await forget(env, backing.id)
  return Problem.fail(410, 'expired', 'The Tempo Wallet approval expired before anyone approved it. Pledge again.')
}

async function activate(
  env: Cloudflare.Env,
  row: Store.Row,
  backing: Store.Backing,
  key: string,
): Promise<Problem.Result<Pledged>> {
  const me = await Gateway.me(env, key)
  if (!me.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not describe the key: ${me.detail}`)

  const amount = Memo.decimal(BigInt(backing.amount))
  const balance = me.value.usage.wallet.balance
  if (balance !== null && Memo.units(balance) < BigInt(backing.amount)) {
    await Promise.all([Gateway.revoke(env, key), forget(env, backing.id)])
    return Problem.fail(
      409,
      'insufficient_balance',
      `The wallet holds ${balance} ${Chain.currencies[backing.token].symbol}, less than the ${amount} ${Chain.currencies[backing.token].symbol} pledge. Add some and pledge again.`,
    )
  }

  const contributor = me.value.wallet
  const activated = await Store.activate(env, backing.id, {
    contributor,
    sealed_key: await Seal.seal(env.SWARMS_SECRET, key),
  })
  if (!activated) {
    await Gateway.revoke(env, key)
    return Problem.fail(409, 'conflict', 'This pledge is already approved.')
  }
  await stub(env, row.id).pledged({ amount, contributor, note: backing.note, noteId: backing.note_id, swarm: row.id, token: backing.token })
  if (backing.note && backing.note_id) await logged(Search.note(env, row.id, backing.note_id, backing.note))

  const updated = (await Store.find(env, row.id)) ?? row
  return Problem.ok({
    pledge: { amount, at: backing.created_at, contributor, id: backing.id, note: backing.note, spent: '0.000000', status: 'active', token: backing.token },
    status: 'active',
    swarm: Store.summary(updated),
  })
}

async function forget(env: Cloudflare.Env, pledge: string) {
  await Promise.all([Store.forget(env, pledge), Devices.forget(env, pledge)])
}

function name(row: Store.Row) {
  return `Swarms: ${row.title}`.slice(0, 64)
}

function pledged(row: Store.Row, backing: Store.Backing): Pledged {
  const status = backing.status === 'pending' ? 'active' : backing.status
  return {
    pledge: {
      amount: Memo.decimal(BigInt(backing.amount)),
      at: backing.created_at,
      contributor: backing.contributor,
      id: backing.id,
      note: backing.note,
      spent: Memo.decimal(BigInt(backing.spent)),
      status,
      token: backing.token,
    },
    status,
    swarm: Store.summary(row),
  }
}

function pending(backing: Store.Backing, device: Pending['device']): Pending {
  return {
    amount: Memo.decimal(BigInt(backing.amount)),
    device,
    note: backing.note,
    pledge: backing.id,
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

