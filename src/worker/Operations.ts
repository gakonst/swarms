import { waitUntil } from 'cloudflare:workers'
import { encodeFunctionData, isAddress } from 'viem'
import type { Address, Hex } from 'viem'
import { Abis } from 'viem/tempo'
import { z } from 'zod'
import type {
  Account,
  Answered,
  Branch,
  Branches,
  Roster,
  Artifact,
  Config,
  Contributed,
  Detail,
  Entry,
  Found,
  Hit,
  Issued,
  Kind,
  Lent,
  Listing,
  Me,
  Member,
  Named,
  Note,
  Overview,
  Page,
  Posted,
  Prepared,
  Room,
  Snapshot,
  Update,
  Working,

  Status,
  Summary,
  Waited,
  Ledgered,
  NodeUpdates,
  NodeView,
  ProgressView,
  ProofsView,
  Proposed,
  Profile,
  Standing as Rider,
  Suggested,
  TreeView,
} from '../shared/Api.ts'
import type * as Tree from '../shared/Tree.ts'
import * as Nodes from './Nodes.ts'
import type * as Riding from './Riding.ts'
import * as Triage from './Triage.ts'
import * as Verify from './Verify.ts'
import * as Answer from '../shared/Answer.ts'
import * as Btw from '../shared/Btw.ts'
import * as Setup from '../shared/Setup.ts'
import * as Standing from '../shared/Status.ts'
import * as Connect from '../shared/Connect.ts'
import * as Credit from '../shared/Credit.ts'
import * as Door from '../shared/Door.ts'
import * as Memo from '../shared/Memo.ts'
import * as Mention from '../shared/Mention.ts'
import * as Nickname from '../shared/Nickname.ts'
import * as Artifacts from './Artifacts.ts'
import * as Chain from './Chain.ts'
import * as Clock from './Clock.ts'
import * as Edge from './Edge.ts'
import * as Gateway from './Gateway.ts'
import * as Hands from './Hands.ts'
import * as Persona from './Persona.ts'
import * as Progress from '../shared/Progress.ts'
import * as Phase from './Phase.ts'
import { within } from './Clock.ts'
import * as Problem from './Problem.ts'
import * as Search from './Search.ts'
import * as Sessions from './Sessions.ts'
import * as Timing from './Timing.ts'
import * as Store from './Store.ts'
import * as Team from './Team.ts'
import type { Stamp, Swarm } from './Swarm.ts'
import * as Words from './Words.ts'
import * as Fleet from '../shared/Fleet.ts'
import * as Brief from '../shared/ResearchBrief.ts'
import { clip } from '../shared/Trail.ts'
import { ids } from '../shared/ResearchBrief.ts'

export const statuses = ['funding', 'running', 'paused'] as const satisfies readonly Status[]

export const kinds = ['tool', 'output', 'message', 'thinking', 'steer', 'funds', 'status', 'machine', 'error'] as const satisfies readonly Kind[]

export const sources = ['swarm', 'update', 'note', 'feed'] as const satisfies readonly Hit['kind'][]

export const maxWait = 55

const id = z.string().trim().min(1).max(64).describe('The swarm id, the last part of its page URL /s/<id>.')

const nid = z.string().trim().regex(/^(root|triage|[0-9a-f]{10})$/, 'A node id is root, triage or 10 hex characters.').describe('A node id, as in /s/<id>/n/<nid>.')

const free = z.union([nid, z.literal('')])

const alias = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, context) => {
    const why = Nickname.invalid(value)
    if (why) context.addIssue({ code: 'custom', message: why })
  })
  .describe(`The swarm's nickname, its page at /<nickname>: ${Nickname.least} to ${Nickname.most} lowercase letters, digits and hyphens, starting and ending with a letter or digit, unique across swarms. Route names (such as new, ideas, docs, api and v1) and hex strings of 8 or more characters are reserved.`)

const lean = z.string().trim().min(1).max(8000)

function units(value: string | number) {
  return Memo.units(typeof value === 'number' ? value.toFixed(6) : value)
}

const decimal = z.union([z.string().regex(/^\d+(\.\d{1,6})?$/), z.number().positive()])

const exchanges = z
  .array(z.object({ answer: z.string().max(Btw.maxAnswer), question: z.string().trim().min(1).max(Btw.maxQuestion) }))
  .max(Btw.maxThread)
  .refine((thread) => Btw.size(thread) <= Btw.maxThreadBytes, `A side thread is at most ${Btw.maxThreadBytes} bytes of questions and answers; drop its oldest exchanges.`)

const wallet = z
  .string()
  .trim()
  .refine((value) => isAddress(value), 'A wallet address, 0x and 40 hex digits.')
  .transform((value) => value.toLowerCase() as Address)

const someone = z
  .string()
  .trim()
  .refine((value) => isAddress(value) || !Mention.invalid(value.replace(/^@/, '')), 'A wallet address, or a username such as @ada.')
  .transform((value) => (isAddress(value) ? (value.toLowerCase() as Address) : value.replace(/^@/, '').toLowerCase()))

const steerings = z
  .enum(['open', 'team'])
  .describe("Who steers the swarm. team: only its team, whoever started it signed in and the people they add; every other backer still funds it and chats in its room. open: every backer, with their own money.")

const allowance = z.number().min(0).max(1_000_000).nullable().describe('USD per 30 days of the swarm\'s money this member may put behind ideas; null means no limit, or the team\'s default.')

const thread = exchanges.default([]).describe('The earlier side questions and their answers in this /btw thread, oldest first.')

const subagentId = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

const note = z
  .string()
  .trim()
  .max(Memo.maxNote)
  .nullish()
  .describe('Optional steering note, weighted by the money behind it. The same text backs an existing note.')

function seconds(fallback: number, description: string) {
  return z.coerce.number().int().min(0).max(maxWait).default(fallback).describe(description)
}

export const schema = {
  contribution: z.object({
    hash: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .describe("The hash of a transferWithMemo of MACH, OUSD, USDC.e or pathUSD to the gateway's recipient (config.credit.recipient) whose memo names this swarm, as the MCP tool swarm_contribute prepares it."),
    node: nid.optional().describe('Tree swarms: the node the memo names (its tag is checked against the transfer); a tag that names no node counts to the root.'),
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
      .describe('The hash of a transfer already sent. With it the money is counted instead of prepared.'),
    node: nid.optional().describe('Tree swarms: the node to ride, by its id; the memo then names it. Default the root, which rides the whole swarm.'),
    note,
    swarm: id,
    token: z.enum(['mach', ...Chain.ids]).default('mach').describe('What to send: mach (MACH), ousd (OUSD), usdce (USDC.e) or pathusd (pathUSD). Each counts at $1.'),
  }),
  create: z.object({
    goal: z
      .string()
      .trim()
      .min(10)
      .max(12_000)
      .describe('What the swarm should find out or build, what done looks like and what its updates should report.'),
    problem: z.enum(ids).optional().describe('The id of the idea-bank problem this swarm works on, from GET /v1/problems. A problem with an open swarm is not offered again until that swarm finishes.'),
    title: z.string().trim().min(1).max(80).describe('A short name for the swarm.'),
    nickname: alias.optional(),
    steering: steerings.optional().describe("Who steers the swarm. team, the default when signed in: only you and the people you add with POST /v1/swarms/:id/team/members; every other backer still funds it and chats in its room. open, the default otherwise: every backer, with their own money. A team swarm started without a session belongs to whoever sends its first ride."),
    template: z
      .enum(Setup.templates)
      .default(Setup.fallback)
      .describe(
        "Agent swarms only: a tree swarm ignores template, harness, model and subagents, since riders never choose its models; its orchestrator, Claude Code on Claude Fable 5.2, picks each run's harness and model from the OpenAI, Anthropic and Google models the gateway lists, guided by riders' notes. " +
          'Which models the swarm runs on. frontier-anthropic (the default): Claude Code on Claude Fable 5.2, for the lead and every subagent. frontier-mix: Claude Code on Claude Opus 5.5 leads, and subagents use Opus 5.5, Kimi K3.1 Pro or GLM-5.3 on Claude Code or Codex. fable: Claude Code on Fable 5.2 leads, and subagents use Fable 5.2, Opus 5.5, Kimi K3.1 Pro or GLM-5.3. cheap: Codex on DeepSeek V4.1 Flash leads, and subagents use DeepSeek V4.1 Flash or GLM-5.3 Flash on Codex or Claude Code. frontier-openai: Codex on GPT-6.1 Sol leads, and subagents use Sol or GPT-6 Astra. Every template runs on models the gateway charges for by what each call uses; the Claude models come through Vercel, and no swarm runs on Boundless (the boundless/ ids) until it charges a call as it streams, so those are refused. free: Codex on DeepSeek V4.1 Flash leads, and subagents use any gateway model. custom: harness, model and subagents choose. GET /v1/config lists every model with its price.',
      ),
    harness: z.enum(Setup.harnesses).optional().describe('custom only: the lead agent\'s harness, claude (Claude Code) or codex.'),
    model: z.string().min(1).max(200).optional().describe('custom only: the lead agent\'s gateway model id, such as vercel/anthropic/claude-opus-5.5.'),
    subagents: z
      .object({
        harnesses: z.array(z.enum(Setup.harnesses)).min(1).max(Setup.harnesses.length),
        models: z.array(z.string().min(1).max(200)).min(1),
      })
      .nullable()
      .optional()
      .describe('custom only: the harnesses and gateway models the lead\'s subagents may use, every model under every harness; null or left out lets them use any.'),
    form: z.enum(['agent', 'tree']).default('agent').describe('tree: a tree of tasks riders put dollars and ideas into, worked by budgeted runs and checked in Lean; agent: one long-running agent (earlier swarms).'),
    statement: lean.nullable().optional().describe('tree only: the root goal as a Lean statement, frozen once posted.'),
    seed: z
      .array(
        z.object({
          form: z.enum(['program', 'approach', 'lemma', 'idea']).default('program'),
          key: z.string().trim().min(1).max(64),
          needs: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
          parent: z.string().trim().min(1).max(64).default('root'),
          spec: z.string().max(8000).default(''),
          statement: lean.nullable().optional(),
          title: z.string().trim().min(3).max(200),
        }),
      )
      .max(2000)
      .default([])
      .describe('tree only: nodes to post under the root at creation; parent and needs name other seed keys, or root.'),
    reviewed: z.boolean().default(false).describe("tree only: whether a person has read the seed's Lean statements; false shows each as under review until an admin signs it off."),
  }),
  seat: z.object({
    budget: allowance.optional(),
    member: someone.describe('The wallet or username to let steer the swarm.'),
    role: z.enum(['admin', 'member']).default('member').describe('An admin also manages who steers.'),
    swarm: id,
  }),
  steering: z.object({
    memberBudget: allowance.optional(),
    steering: steerings.optional(),
    swarm: id,
  }),
  unseat: z.object({ member: wallet, swarm: id }),
  branches: z.object({ swarm: id }),
  stop: z.object({
    branch: subagentId.describe('The branch to stop.'),
    swarm: id,
  }),
  fund: z.object({
    amount: decimal
      .refine((value) => units(value) >= Mention.smallestSteer, `A branch is funded with at least ${Memo.decimal(Mention.smallestSteer)}.`)
      .refine((value) => units(value) <= 100_000_000n, 'A branch is funded with at most 100.')
      .describe("How many dollars go behind the branch: of the caller's backing not yet behind a note, or of the swarm's money within their team budget when only its team steers."),
    branch: subagentId.describe('The branch, the id of one of the subagents the swarm\'s agent started itself, from GET /v1/swarms/:id/branches.'),
    message: z
      .string()
      .trim()
      .min(3)
      .refine((value) => Btw.bytes(value) <= Btw.maxMessageBytes, `A message to a branch is at most ${Btw.maxMessageBytes} bytes.`)
      .optional()
      .describe('Steer the branch with this message as well: it reaches the subagent at once, with the money behind it.'),
    artifact: z.boolean().default(false).describe("With message: ask the branch for an artifact. The swarm adds how to publish one, since a subagent does not have the swarm's instructions for it."),
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
    branch: subagentId.optional().describe("Ask this branch, a subagent from GET /v1/swarms/:id/branches, instead of the swarm's agent."),
    question: z.string().trim().min(1).max(Btw.maxQuestion).describe('The side question, answered from the agent\'s own conversation without interrupting or steering it.'),
    swarm: id,
    thread,
  }),
  say: z.object({
    artifact: z.boolean().default(false).describe('With btw: ask the agent for an artifact that shows what the side conversation asked about. The text must then be @swarm followed by "Artifact from /btw: <the first question>".'),
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
  nickname: z.object({ nickname: alias.nullable().describe('The new nickname, or null to drop it. The old one keeps sending its visitors to the new page until another swarm takes it.'), swarm: id }),
  named: z.object({ name: z.string().trim().toLowerCase().max(64) }),
  rider: z.object({ who: z.string().trim().toLowerCase().max(64).describe('A rider\'s username, with or without @, or their 0x address.') }),
  tree: z.object({
    depth: z.coerce.number().int().min(0).max(64).default(3).describe('How many levels under root to include; deeper nodes appear only as ids in children.'),
    root: nid.default('root').describe('The node to start from; root is the whole swarm.'),
    status: z.enum(['proposed', 'funded', 'in flight', 'proven', 'dead end']).optional().describe('Only nodes in this status.'),
    swarm: id,
  }),
  node: z.object({ node: nid, swarm: id }),
  nodeUpdates: z.object({
    after: z.coerce.number().int().min(0).default(0).describe('Return the deltas after this seq.'),
    limit: z.coerce.number().int().min(1).max(500).default(200),
    node: nid.optional().describe('Only this node\'s deltas; every node when left out.'),
    swarm: id,
  }),
  burn: z.object({ every: z.enum(['hour']).default('hour').describe('The step of the series.'), swarm: id }),
  propose: z.object({
    amount: decimal.optional().describe('How much the proposer will ride it with; at least ideaMin ($1) makes it a node.'),
    form: z.enum(['program', 'approach', 'lemma', 'idea']).default('lemma'),
    parent: nid.default('root').describe('The node it goes under.'),
    spec: z.string().max(8000).default('').describe('The proposal in words: what it claims and why it helps.'),
    statement: lean.nullable().optional().describe('For a lemma: its Lean statement, frozen once the node is posted.'),
    swarm: id,
    title: z.string().trim().min(3).max(200).describe('One line; the same title under the same parent is the same node.'),
    token: z.enum(['mach', ...Chain.ids]).default('mach'),
  }),
  suggest: z.object({ parent: nid.default('root'), swarm: id, text: z.string().trim().min(3).max(2000).describe('The idea, free of charge; triage may adopt it as a node credited to you.') }),
  nodeSteer: z.object({
    amount: z.string().regex(/^\d+(\.\d{1,6})?$/).default('0').describe('Dollars of your free money in this swarm to move onto the node with the note; 0 steers with what you already have on it.'),
    node: nid,
    note: z.string().trim().min(1).max(Memo.maxNote).describe('The note; the node\'s run reads it with the money behind it.'),
    swarm: id,
  }),
  nodeMove: z.object({
    amount: decimal.refine((value) => units(value) > 0n, 'Move more than nothing.'),
    node: free.describe('Where the money is now: a node id, or "" for your free money.'),
    swarm: id,
    to: free.describe('Where it goes: a node id, or "" for your free money.'),
  }),
  nodeEnd: z.object({ node: nid, swarm: id, why: z.string().trim().min(1).max(500) }),
  triage: z.object({ action: z.record(z.string(), z.unknown()).describe('One triage action: approve, adopt, merge, reject, grant or restate, as the triage node returns them.'), swarm: id }),
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
  return Timing.object(env.SWARMS.get(env.SWARMS.idFromName(id)))
}

function missing() {
  return Problem.fail(404, 'not_found', 'No swarm has this id.')
}

function identifier() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

function logged(task: Promise<unknown>) {
  return task.catch((error: unknown) => console.error('Indexing for search failed', error))
}

type Shape = { feed?: number; pushed?: boolean; texts?: boolean }

async function load(env: Cloudflare.Env, id: string, shape: Shape = {}) {
  const viewing = Store.seen(id) ? Promise.resolve(stub(env, id).view(shape)) : undefined
  const row = await Store.find(env, id)
  if (!row) return undefined
  const view = await (viewing ?? stub(env, id).view(shape))
  await backfill(env, row, view.updates.at(-1), shape)
  return { row, view }
}

async function ledgered(env: Cloudflare.Env, id: string, shape: Shape) {
  const viewing = Store.seen(id) ? Promise.resolve(stub(env, id).view(shape)) : undefined
  const ledger = await Store.ledger(env, id)
  if (!ledger) return undefined
  const row = ledger.row
  const view = await (viewing ?? stub(env, id).view(shape))
  await backfill(env, row, view.updates.at(-1), shape)
  if (Search.lags(view.ended, ledger.reports)) {
    const after = Math.min(...view.ended.map((turn) => turn.n)) - 1
    waitUntil(logged(Promise.resolve(stub(env, id).turns(after)).then((turns) => Search.sync(env, id, turns, after))))
  }
  return { ledger, row, view }
}

async function backfill(env: Cloudflare.Env, row: Store.Row, latest: Update | undefined, shape: Shape) {
  if (row.answer || !latest) return
  const last = shape.texts === false ? (await stub(env, row.id).pulse()).updates.at(-1) ?? latest : latest
  row.answer = JSON.stringify({ at: last.at, done: last.done, text: last.text })
  await Store.update(env, row.id, { answer: row.answer })
}

export async function config(env: Cloudflare.Env): Promise<Config> {
  const [owner, prices] = await Promise.all([Gateway.wallet(env), Gateway.prices(env)])
  return {
    models: [...(prices?.values() ?? [])],
    auth: Sessions.path,
    chainId: Chain.chain.id,
    credit: owner ? { owner: owner as Address, recipient: Chain.recipient } : null,
    explorer: Chain.chain.blockExplorers.default.url,
    gateway: env.GATEWAY_URL,
    reserve: Memo.decimal(Store.reserve),
    rpc: env.TEMPO_RPC,
    tokens: [{ address: Chain.mach.address, id: 'mach' as const, symbol: Chain.mach.symbol }, ...Chain.ids.map((id) => ({ address: Chain.tokens[id].address, id, symbol: Chain.tokens[id].symbol }))],
  }
}

export async function list(env: Cloudflare.Env, input: Input<'list'>): Promise<Problem.Result<Listing>> {
  const parsed = parse(schema.list, input)
  if (!parsed.ok) return parsed

  const status = parsed.value.status
  const [swarms, riding] = await Promise.all([
    Edge.cached(env, `swarms?status=${status ?? ''}`, listSeconds, async () => (await Store.list(env, status)).map((row) => Store.summary(row))),
    Edge.cached(env, 'riding', listSeconds, () => Store.riding(env)),
  ])
  const heads = await Edge.cached(env, `heads?status=${status ?? ''}`, listSeconds, () => headlines(env, swarms))
  resume(env, swarms)
  Store.know(swarms.map((swarm) => swarm.id))
  return Problem.ok({ funders: Object.fromEntries(swarms.flatMap((swarm) => (riding.funders[swarm.id] ? [[swarm.id, riding.funders[swarm.id]!]] : []))), heads, riders: riding.riders, swarms })
}

async function headlines(env: Cloudflare.Env, swarms: readonly Summary[]) {
  const trees = swarms.filter((swarm) => swarm.form === 'tree' && !swarm.archivedAt)
  const read = await Promise.all(trees.map(async (swarm) => [swarm.id, await Clock.within(tree(env, { depth: 0, swarm: swarm.id }), 800)] as const))
  return Object.fromEntries(read.flatMap(([id, view]) => (view?.ok ? [[id, view.value.headline]] : [])))
}

function resume(env: Cloudflare.Env, swarms: readonly Pick<Summary, 'id' | 'status' | 'why'>[]) {
  const stale = swarms.filter((swarm) => Phase.stale(swarm.why))
  if (stale.length) waitUntil(Promise.allSettled(stale.map((swarm) => stub(env, swarm.id).revive())))
}

export function listed(value: Listing) {
  return { ...value, swarms: value.swarms.map((swarm) => (swarm.answer ? { ...swarm, answer: { ...swarm.answer, text: Answer.lead(swarm.answer.text) } } : swarm)) }
}

export async function create(env: Cloudflare.Env, input: Input<'create'>, creator?: Address): Promise<Problem.Result<Summary>> {
  const parsed = parse(schema.create, input)
  if (!parsed.ok) return parsed

  const tree = parsed.value.form === 'tree'
  const asked = tree ? undefined : Setup.resolve(parsed.value)
  if (typeof asked === 'string') return Problem.fail(400, 'invalid_request', asked)
  if (!tree && parsed.value.template !== 'custom' && (parsed.value.harness || parsed.value.model || parsed.value.subagents !== undefined))
    return Problem.fail(400, 'invalid_request', 'harness, model and subagents go with template custom.')
  const prices = await Gateway.prices(env)
  if (!prices) return Problem.fail(503, 'unavailable', "The gateway's model prices could not be read, so the swarm's costs are unknown. Try again shortly.")
  const chosen = asked ?? Setup.board(prices)
  if (typeof chosen === 'string') return Problem.fail(503, 'unavailable', chosen)
  const setup = Setup.priced(tree || parsed.value.template === 'custom' ? chosen : (Setup.moved(chosen, prices) ?? chosen), prices)
  if (typeof setup === 'string') return Problem.fail(400, 'invalid_request', `${setup} GET /v1/config lists them.`)
  const policy = parsed.value.steering ?? (creator ? 'team' : 'open')
  const swarm = { goal: parsed.value.goal, id: identifier(), title: parsed.value.title }
  if (!tree && (parsed.value.seed.length || parsed.value.statement)) return Problem.fail(400, 'invalid_request', 'seed and statement go with form tree.')
  const named = parsed.value.nickname
  if (named && (await Store.called(env, named))?.current === named) return taken(named)
  const row = await Store.insert(env, { ...swarm, creator: creator ?? null, form: parsed.value.form, nickname: named, problem: parsed.value.problem ?? null, setup: JSON.stringify(setup), steering: policy }).catch((error: unknown) => {
    if (error instanceof Store.Taken) return 'taken' as const
    throw error
  })
  if (row === 'taken') return taken(named ?? '')
  if (!row) return Problem.fail(502, 'unavailable', 'The swarm was not saved.')
  if (tree) {
    const planted = await plant(env, row, parsed.value, setup)
    if (!planted.ok) return planted
  }
  await logged(Search.swarm(env, swarm))
  return Problem.ok(Store.summary(row))
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
  const loaded = await ledgered(env, parsed.value.swarm, { feed: feed ? firstFeed : 0, pushed: true, texts: false })
  if (!loaded) return missing()

  const { ledger, row, view } = loaded
  resume(env, [Store.summary(row)])
  const detail: Detail = {
    ...Store.summary(row),
    about: view.about,
    code: view.code,
    contributions: ledger.contributions,
    feed: view.feed,
    hands: view.hands,
    notes: ledger.notes(new Set(view.steered)),
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
    about: view.about,
    code: view.code,
    contributions: ledger.contributions,
    hands: view.hands,
    notes: ledger.notes(new Set(view.steered)),
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

  return Problem.ok(await stub(env, swarm).recent(parsed.value.limit))
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
  if ((await Store.find(env, parsed.value.swarm))?.form === 'tree') return treeLive(env, parsed.value, signal, after)

  const url = after !== undefined && /^\d{1,15}$/.test(after) ? `https://swarm/live?after=${after}` : 'https://swarm/live'
  return Problem.ok(await stub(env, parsed.value.swarm).fetch(new Request(url, { signal })))
}

export async function search(env: Cloudflare.Env, input: Input<'search'>): Promise<Problem.Result<Found>> {
  const parsed = parse(schema.search, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  const terms = Search.terms(query.query)
  if (!terms.length) return Problem.fail(400, 'invalid_request', 'The query has no words to search for.')
  const [row, stale] = await Promise.all([query.swarm === undefined ? undefined : Store.find(env, query.swarm), Search.lagging(env, query.swarm)])
  if (row === null) return missing()

  await Promise.all(stale.map(async (lag) => logged(Search.sync(env, lag.id, await stub(env, lag.id).turns(lag.after), lag.after))))
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
  if (!(await Store.exists(env, swarm))) return missing()
  const since = parsed.value.after ?? (await stub(env, swarm).latest(0)).update?.at ?? 0

  for (;;) {
    const pulse = await stub(env, swarm).waited(since, signal?.aborted ? 0 : deadline - Date.now())
    const reason = pulse.update ? 'updated' : !pulse.working ? 'idle' : Date.now() >= deadline || signal?.aborted ? 'timeout' : undefined
    if (reason) {
      const row = await Store.find(env, swarm)
      if (!row) return missing()
      return Problem.ok({
        changed: pulse.update !== null,
        reason,
        swarm: Store.summary(row),
        update: pulse.update,
        waited: Date.now() - started,
        working: pulse.working,
      })
    }
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

export async function progress(env: Cloudflare.Env, input: Input<'burn'>): Promise<Problem.Result<{ progress: Progress.Progress | null } | ProgressView>> {
  const parsed = parse(schema.burn, input)
  if (!parsed.ok) return parsed
  const swarm = parsed.value.swarm
  const row = await Store.find(env, swarm)
  if (!row) return missing()
  if (row.form === 'tree') return burn(env, parsed.value)
  const value = await Edge.cached(env, `progress/${swarm}`, progressSeconds, async () => {
    const shelf = await Artifacts.list(env, swarm)
    const recorded = shelf?.some((artifact) => artifact.slug === Progress.slug)
    const [data, main, tree] = await Promise.all([
      recorded ? Artifacts.read(env, swarm, Progress.slug, 'data.json') : undefined,
      recorded ? Artifacts.read(env, swarm, Progress.slug, 'main.tsv') : undefined,
      row.repo ? stub(env, swarm).tree(row.repo) : null,
    ])
    const json = (() => {
      try {
        return data === undefined ? undefined : (JSON.parse(data) as unknown)
      } catch {
        return undefined
      }
    })()
    const graphed = tree ? Progress.fromGit({ ...tree, hint: Progress.hint(json), live: tree.branches.length ? await exploring(env, swarm, tree.branches) : [] }) : undefined
    return graphed ?? Progress.parse(json, main) ?? null
  })
  return Problem.ok({ progress: value })
}

async function exploring(env: Cloudflare.Env, swarm: string, names: readonly { name: string }[]) {
  const running = await branches(env, { swarm }).catch(() => undefined)
  if (!running?.ok) return []
  const pattern = (name: string) => new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\/]/g, (char) => `\\${char}`)}($|[^\\w-])`, 'i')
  return running.value.branches
    .filter((branch) => branch.state === 'pending' || branch.state === 'running')
    .flatMap((branch) => names.filter((found) => pattern(found.name).test(branch.role)).map((found) => found.name))
}

const progressSeconds = 30

export async function room(env: Cloudflare.Env, input: Input<'room'>, address?: Address): Promise<Problem.Result<Room>> {
  const heard = await listened(env, input, address)
  return heard.ok ? Problem.ok(heard.value.room) : heard
}

export async function listened(env: Cloudflare.Env, input: Input<'room'>, address?: Address): Promise<Problem.Result<{ room: Room; stamp: Stamp }>> {
  const parsed = parse(schema.room, input)
  if (!parsed.ok) return parsed
  const query = parsed.value
  const seen = Store.seen(query.swarm)
  const listing = Store.members(env, query.swarm)
  const chatting = seen ? Promise.resolve(stub(env, query.swarm).chat({ after: query.after, before: query.before, limit: query.limit })) : undefined
  if (!seen && !(await Store.exists(env, query.swarm))) {
    listing.catch(() => undefined)
    return missing()
  }

  const [{ messages, stamp }, members] = await Promise.all([chatting ?? stub(env, query.swarm).chat({ after: query.after, before: query.before, limit: query.limit }), listing])
  return Problem.ok({ room: { me: address ? await self(env, members, address) : null, members, messages, next: messages.at(-1)?.id ?? query.after }, stamp })
}

export async function account(env: Cloudflare.Env, address?: Address): Promise<Problem.Result<Account>> {
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to read your account.')
  return Problem.ok(await Store.account(env, address))
}

export async function rename(env: Cloudflare.Env, input: Input<'rename'>, address?: Address): Promise<Problem.Result<Account>> {
  const parsed = parse(schema.rename, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to set your username.')

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
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to post in a room.')
  const shown = await Store.find(env, request.swarm)
  if (shown?.archived_at) return Problem.fail(410, 'gone', 'This swarm is archived and read-only.')
  if (shown?.form === 'tree' && request.steer !== undefined) return Problem.fail(410, 'gone', 'Tree swarms have no steering notes: steer a node with POST /v1/swarms/:id/nodes/:nid/steer.')
  const [found, account] = await Promise.all([Store.rostered(env, request.swarm), Store.account(env, address)])
  if (!found) return missing()
  if (!account.name) return unnamed()

  const row = found.row
  let members = found.members
  let author = members.find((member) => member.address === address)
  const steers = await Team.steerer(env, row, address, members)
  if (!steers.ok) return steers
  const seat = steers.value
  if (!author && !seat && (await lender(env, row.id, address))) {
    members = await Store.members(env, row.id)
    author = members.find((member) => member.address === address)
  }
  const door = Door.of(row.steering, { rider: !!author, seat: !!seat })
  if (!door.posts)
    return Problem.fail(403, 'not_member', 'Ride this swarm first: money or a lent machine lets you post in its room.')

  const steering = Mention.steers(request.text)
  if (steering && !door.steers)
    return Problem.fail(403, 'not_member', "Only this swarm's team steers it. Its admins add who may: ask one of them in the room.")
  if (!steering && request.steer !== undefined) return Problem.fail(400, 'invalid_request', 'steer goes with a message that mentions @swarm.')
  if (request.btw && (!steering || Mention.idea(request.text) !== Btw.note(request.btw, request.artifact)))
    return Problem.fail(400, 'invalid_request', `A /collapse is @swarm followed by "${Btw.note(request.btw, request.artifact)}".`)
  if (!(await stub(env, row.id).paced(address))) return Problem.fail(429, 'rate_limited', 'At most 10 messages a minute in a room; wait a moment.')
  if (request.btw && !(await stub(env, row.id).vouched(address, await Promise.all(request.btw.map(Btw.seal)))))
    return Problem.fail(400, 'invalid_request', 'Only questions this swarm answered for you on the side, with its answers as it gave them, can be collapsed into a steer. Ask them again.')
  let steer: { amount: string; note: string; noteId: string } | null = null
  let backing = 0n
  if (steering) {
    const note = Mention.idea(request.text)
    if (note.length < 3) return Problem.fail(400, 'invalid_request', 'Say what the swarm should do after @swarm.')
    if (note.length > Memo.maxNote) return Problem.fail(400, 'invalid_request', `A steer is at most ${Memo.maxNote} characters besides @swarm.`)
    if (request.steer === undefined)
      return Problem.fail(
        400,
        'invalid_request',
        seat
          ? `@swarm steers the swarm with its money: send steer, how much of your team budget (${dollars(seat.left)} left) goes behind this idea.`
          : `@swarm steers the swarm with money: send steer, how much of your ${dollars(author?.available ?? '0')} not yet behind a note goes behind this idea.`,
      )
    const amount = units(request.steer)
    const noteId = await Store.noteId(request.btw ? `${note}\n${Btw.conversation(request.btw)}` : note)
    const placed = seat
      ? await Store.allot(env, { amount, contributor: address, id: identifier(), limit: seat.limit === null ? null : Memo.units(seat.limit), note, note_id: noteId, since: Date.now() - Team.period, swarm: row.id })
      : await Store.steer(env, { amount, contributor: address, id: identifier(), note, note_id: noteId, swarm: row.id })
    if (!placed)
      return Problem.fail(
        409,
        'insufficient_balance',
        seat
          ? `Your team budget has ${dollars(seat.left)} left in these 30 days, less than ${dollars(Memo.decimal(amount))}.`
          : `You have ${dollars(author?.available ?? '0')} of backing not yet behind a note, less than ${dollars(Memo.decimal(amount))}. Put new money behind this idea instead.`,
      )
    if (seat) retold(env, row)
    else backing = amount
    await logged(Search.note(env, row.id, noteId, note))
    steer = { amount: Memo.decimal(amount), note, noteId, ...(request.btw ? { context: Btw.collapse(request.btw, request.artifact) } : {}) }
  }

  const named = Mention.mentioned(request.text)
  const message = await stub(env, row.id).say({
    author: address,
    mentions: members.filter((member) => named.includes(member.handle) || named.includes(Mention.handle(member.address))).map((member) => member.address),
    steer,
    swarm: row.id,
    text: request.text,
  })
  return Problem.ok({ me: await self(env, backing ? spend(members, address, backing) : members, address), message })
}

function spend(members: readonly Member[], address: Address, amount: bigint) {
  return members.map((member) =>
    member.address === address ? { ...member, available: Memo.decimal(units(member.available) - amount), steered: Memo.decimal(units(member.steered) + amount) } : member,
  )
}

async function lender(env: Cloudflare.Env, swarm: string, address: Address) {
  const rows = (await Hands.list(env, swarm)).filter((hand) => hand.contributor?.toLowerCase() === address.toLowerCase() && hand.seen_at === null)
  if (!rows.length) return false
  const lent: { rows: Hands.Row[] } = await stub(env, swarm).lent(swarm)
  return lent.rows.some((hand) => hand.contributor?.toLowerCase() === address.toLowerCase() && hand.seen_at !== null)
}

function unnamed() {
  return Problem.fail(403, 'username_required', 'Pick a username first: POST /v1/me with { name }. People in a swarm talk and steer under the name they chose.')
}

function reached<value>(call: Promise<Gateway.Result<value>>): Promise<Gateway.Result<value>> {
  return call.catch((error: unknown) => ({ detail: error instanceof Error ? error.message : String(error), ok: false as const, status: 503 }))
}

type Directed = { agent: string | null; list: Branch[]; members: Member[]; money: Awaited<ReturnType<typeof Store.funds>> }

async function directed(env: Cloudflare.Env, row: Pick<Store.Row, 'id'>, listing?: Promise<Gateway.Result<{ agent: string | null; list: Gateway.Subagent[] }>>): Promise<Problem.Result<Directed>> {
  const ledgers = Store.ledgers(env, row.id)
  ledgers.catch(() => undefined)
  const found = await (listing ?? reached(stub(env, row.id).subagents(row.id)))
  if (!found.ok) return Problem.fail(502, 'upstream_failed', `Could not list the swarm's subagents: ${found.detail}`)
  if (!Array.isArray(found.value.list)) return Problem.fail(502, 'upstream_failed', 'The swarm is starting on new code; try again in a few seconds.')
  const agent = found.value.agent
  const read = await ledgers
  const members = read.members
  const money = read.money(agent ?? '')
  const names = new Map<number, string>()
  for (const subagent of [...found.value.list].sort((a, b) => a.agent_id - b.agent_id)) {
    const role = clip(subagent.role.trim() || `subagent ${subagent.agent_id}`, 60)
    names.set(subagent.agent_id, [...names.values()].includes(role) ? `${role} #${subagent.agent_id}` : role)
  }
  return Problem.ok({ agent, list: found.value.list.map((subagent) => branched(subagent, money, members, names.get(subagent.agent_id))), members, money })
}

function branched(agent: Gateway.Subagent, money: Awaited<ReturnType<typeof Store.funds>>, members: readonly Member[], who = agent.role): Branch {
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
    result: agent.result?.slice(0, 4000) ?? null,
    role: agent.role,
    spent: spent === null ? null : Memo.decimal(spent),
    starved,
    state: money.settled.has(agent.agent_id) && agent.status.state !== 'closing' ? 'closed' : (agent.status.state as Branch['state']),
    task: agent.task.slice(0, 2000),
    who,
  }
}

function backed(money: Awaited<ReturnType<typeof Store.funds>>, branch: number) {
  const funded = [...(money.shares.get(branch)?.values() ?? [])].reduce((sum, amount) => sum + amount, 0n)
  const total = (money.bases.get(branch) ?? 0n) + funded
  return total > 0n ? total : 1n
}

function behind(money: Awaited<ReturnType<typeof Store.funds>>, branch: number) {
  return [...(money.shares.get(branch)?.values() ?? [])].reduce((sum, amount) => sum + amount, 0n)
}

function ended(branch: Branch) {
  return branch.state === 'closed' || branch.state === 'closing'
}

async function swept(env: Cloudflare.Env, swarm: string, found: Directed) {
  const agent = found.agent
  if (!agent) return
  for (const branch of found.list.filter((each) => each.parent === null && each.state === 'closed' && !found.money.settled.has(each.id))) {
    const returned = await stub(env, swarm).settle({ agent, branch: branch.id, left: branch.left === null ? null : Memo.units(branch.left), swarm })
    await refunded(env, swarm, branch, returned)
  }
}

async function refunded(env: Cloudflare.Env, swarm: string, branch: Branch, returned: readonly { amount: bigint }[]) {
  const back = returned.reduce((sum, item) => sum + item.amount, 0n)
  if (back > 0n) await reached(stub(env, swarm).voice(swarm, `${dollars(Memo.decimal(back))} that ${branch.who} had not spent went back to its backers, to put behind something else.`))
}

async function steerable(env: Cloudflare.Env, input: { address: Address | undefined; swarm: string }) {
  if (!input.address) return Problem.fail(401, 'unauthorized', "Sign in with Tempo ID to direct a swarm's money.")
  const [row, account] = await Promise.all([Store.find(env, input.swarm), Store.account(env, input.address)])
  if (!row) return missing()
  if (!account.name) return unnamed()
  const steers = await Team.steerer(env, row, input.address)
  if (!steers.ok) return steers
  const seat = steers.value
  if (row.steering === 'team' && !seat)
    return Problem.fail(403, 'not_member', "Only this swarm's team directs its money. Its admins add who may: ask one of them in the room.")
  return Problem.ok({ account, address: input.address, row, seat })
}

const shownSeconds = 5

const shownStale = 600

const shownPatience = 1500

export async function branches(env: Cloudflare.Env, input: Input<'branches'>): Promise<Problem.Result<Branches>> {
  const parsed = parse(schema.branches, input)
  if (!parsed.ok) return parsed
  const gone = await legacy(env, parsed.value.swarm, false)
  if (!gone.ok) return gone
  const id = parsed.value.swarm
  const held = Team.cached(id)?.steering
  const steering = held ? Promise.resolve(held) : Store.steering(env, id)

  let failed: Problem.Result<never> | undefined
  const listing = Edge.cached(
    env,
    `branches/${id}`,
    shownSeconds,
    async () => {
      const early = held || Store.seen(id) ? reached(stub(env, id).subagents(id)) : undefined
      if (!early && !(await steering)) {
        failed = missing()
        throw new Error('missing')
      }
      const found = await directed(env, { id }, early)
      if (found.ok) return found.value.list
      failed = found
      throw new Error(found.detail)
    },
    shownStale,
    shownPatience,
  ).catch(() => undefined)
  const [policy, list] = await Promise.all([steering, listing])
  if (!policy) return missing()
  if (!list) return failed ?? Problem.fail(502, 'upstream_failed', "Could not list the swarm's subagents; try again in a few seconds.")
  return Problem.ok({ branches: list, steering: policy })
}

async function fresh(env: Cloudflare.Env, row: Store.Row, ids: readonly number[], fallback: readonly Branch[]) {
  const found = await directed(env, row, reached(stub(env, row.id).subagents(row.id, true)))
  if (found.ok) Edge.put(env, `branches/${row.id}`, found.value.list, shownStale)
  return ids.map((id, index) => (found.ok ? found.value.list.find((branch) => branch.id === id) : undefined) ?? (fallback[index] as Branch))
}

export async function fund(env: Cloudflare.Env, input: Input<'fund'>, address?: Address): Promise<Problem.Result<Branch>> {
  const parsed = parse(schema.fund, input)
  if (!parsed.ok) return parsed
  const gone = await legacy(env, parsed.value.swarm, true)
  if (!gone.ok) return gone
  const request = parsed.value
  const allowed = await steerable(env, { address, swarm: request.swarm })
  if (!allowed.ok) return allowed
  const { account, row, seat } = allowed.value

  const found = await directed(env, row, reached(stub(env, row.id).subagents(row.id, true)))
  if (!found.ok) return found
  await swept(env, row.id, found.value)
  const agent = found.value.agent
  if (!agent) return Problem.fail(409, 'conflict', 'The swarm has no agent yet: it starts once money arrives.')
  const target = found.value.list.find((branch) => branch.id === request.branch)
  if (!target || target.parent !== null)
    return Problem.fail(404, 'not_found', `This swarm has no branch ${request.branch}: fund one of the subagents its agent started itself, from GET /v1/swarms/${row.id}/branches.`)
  if (ended(target)) return Problem.fail(409, 'conflict', `${target.who} is stopped; fund another branch.`)
  const author = found.value.members.find((member) => member.address === allowed.value.address)
  if (!seat && !author) return Problem.fail(403, 'not_member', 'Ride this swarm first: money or a lent machine lets you direct its money.')

  const amount = units(request.amount)
  const identity = identifier()
  const message = request.message ?? null
  const note = message ? clip(message.split('\n')[0] ?? message, Memo.maxNote) : `branch ${target.id}`
  const entry = { amount, branch: { agent, id: target.id }, contributor: allowed.value.address, id: identity, note, note_id: `branch:${target.id}`, swarm: row.id }
  const placed = seat
    ? await Store.allot(env, { ...entry, limit: seat.limit === null ? null : Memo.units(seat.limit), since: Date.now() - Team.period })
    : await Store.steer(env, entry)
  if (!placed)
    return Problem.fail(
      409,
      'insufficient_balance',
      seat
        ? `Your team budget has ${dollars(seat.left)} left in these 30 days, less than ${dollars(Memo.decimal(amount))}, or ${target.who} was just stopped.`
        : `You have ${dollars(author?.available ?? '0')} of backing not yet behind a note or branch, less than ${dollars(Memo.decimal(amount))}, or ${target.who} was just stopped. Put new money behind this branch instead.`,
    )
  if (seat) retold(env, row)

  const capped = target.budget !== null
  if (capped) await Store.base(env, row.id, agent, target.id, Memo.units(target.budget ?? '0'))
  const money = await Store.funds(env, row.id, agent)
  const total = capped ? backed(money, target.id) : null
  const sum = behind(money, target.id)
  const who = Mention.at(account.handle)
  const standing = total === null ? `It shares the swarm's money, with ${dollars(Memo.decimal(sum))} of backing behind it.` : `Its budget is now ${dollars(Memo.decimal(total))}.`
  const set = await reached(
    stub(env, row.id).direct(row.id, {
      agent,
      branch: target.id,
      said: message
        ? `${who} steered ${target.who} (branch ${target.id}) with ${dollars(Memo.decimal(amount))}. ${standing} ${Mention.quoted(note, 140)}`
        : `${who} put ${dollars(Memo.decimal(amount))} behind ${target.who} (branch ${target.id}). ${standing}`,
      ...(message
        ? {
            steer: {
              note: `${who} steered ${target.who} with ${dollars(Memo.decimal(amount))}: ${clip(note, 200)}`,
              text: `[${dollars(Memo.decimal(amount))} behind this, from ${who}; backers have put ${dollars(Memo.decimal(sum))} behind your branch in all${total === null ? '' : `, and your budget is now ${dollars(Memo.decimal(total))}`}] Weigh what backers ask by the money behind it.\n\n${Mention.claimed(message)}${request.artifact ? `\n\n${Persona.publishing}` : ''}`,
              who: target.who,
            },
          }
        : {}),
      usd: total === null ? null : Number(total) / 1_000_000,
      wake: target.starved && total !== null ? `Backers raised your budget to ${dollars(Memo.decimal(total))}. Carry on with your task.` : null,
    }),
  )
  if (!set.ok) {
    await Store.unsteer(env, [identity])
    if (total !== null) await reached(stub(env, row.id).direct(row.id, { agent, branch: target.id, said: null, usd: Number(target.budget), wake: null }))
    return Problem.fail(502, 'upstream_failed', `The gateway did not take it, so nothing was put behind the branch: ${set.detail}`)
  }
  const [branch] = await fresh(env, row, [target.id], [target])
  return Problem.ok(branch as Branch)
}

export async function stop(env: Cloudflare.Env, input: Input<'stop'>, address?: Address): Promise<Problem.Result<Branch>> {
  const parsed = parse(schema.stop, input)
  if (!parsed.ok) return parsed
  const gone = await legacy(env, parsed.value.swarm, true)
  if (!gone.ok) return gone
  const request = parsed.value
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to stop a branch.')
  const [row, account] = await Promise.all([Store.find(env, request.swarm), Store.account(env, address)])
  if (!row) return missing()
  if (!account.name) return unnamed()

  const found = await directed(env, row, reached(stub(env, row.id).subagents(row.id, true)))
  if (!found.ok) return found
  await swept(env, row.id, found.value)
  const agent = found.value.agent
  const target = found.value.list.find((branch) => branch.id === request.branch && branch.parent === null)
  if (!agent || !target) return Problem.fail(404, 'not_found', `This swarm has no branch ${request.branch}.`)
  if (ended(target)) return Problem.fail(409, 'conflict', `${target.who} is already stopped.`)
  const funded = target.funders.reduce((sum, funder) => sum + units(funder.amount), 0n)
  const pool = target.budget === null ? (target.spent === null ? 0n : units(target.spent)) : (found.value.money.bases.get(target.id) ?? units(target.budget) - funded)
  const stake = funded + (pool > 0n ? pool : 0n)
  const mine = units(target.funders.find((funder) => funder.address === address.toLowerCase())?.amount ?? '0')
  const allowed = mine * 2n > stake ? Problem.ok(true) : await Team.admin(env, row, address).then(Problem.ok, Team.unlisted)
  if (!allowed.ok) return allowed
  if (!allowed.value)
    return Problem.fail(
      403,
      'access_denied',
      `Only whoever holds more than half of what is behind ${target.who} (${dollars(Memo.decimal(stake))}, the swarm's own ${dollars(Memo.decimal(stake - funded))} included), or the swarm's admins, stop it.`,
    )

  const halted = await reached(stub(env, row.id).halt(row.id, { agent, branch: target.id, said: `${Mention.at(account.handle)} stopped ${target.who} (branch ${target.id}).` }))
  if (!halted.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not stop the branch: ${halted.detail}`)
  const closed = halted.value.find((agent) => agent.agent_id === target.id)
  const after = closed?.budget_usd === undefined ? undefined : Memo.units(closed.budget_usd.toFixed(6)) - Memo.units((closed.spent_usd ?? 0).toFixed(6))
  const left = target.budget === null ? null : after !== undefined ? (after > 0n ? after : 0n) : target.left === null ? 0n : Memo.units(target.left)
  await refunded(env, row.id, target, await stub(env, row.id).settle({ agent, branch: target.id, left, swarm: row.id }))
  const [branch] = await fresh(env, row, [target.id], [{ ...target, state: 'closed' }])
  return Problem.ok(branch as Branch)
}

export async function move(env: Cloudflare.Env, input: Input<'move'>, address?: Address): Promise<Problem.Result<Branch[]>> {
  const parsed = parse(schema.move, input)
  if (!parsed.ok) return parsed
  const gone = await legacy(env, parsed.value.swarm, true)
  if (!gone.ok) return gone
  const request = parsed.value
  if (request.branch === request.to) return Problem.fail(400, 'invalid_request', 'Move money to another branch.')
  const allowed = await steerable(env, { address, swarm: request.swarm })
  if (!allowed.ok) return allowed
  const { account, row, seat } = allowed.value

  const found = await directed(env, row, reached(stub(env, row.id).subagents(row.id, true)))
  if (!found.ok) return found
  await swept(env, row.id, found.value)
  if (!seat && !found.value.members.some((member) => member.address === allowed.value.address))
    return Problem.fail(403, 'not_member', 'Ride this swarm first: money or a lent machine lets you direct its money.')
  const agent = found.value.agent
  const source = found.value.list.find((branch) => branch.id === request.branch && branch.parent === null)
  const target = found.value.list.find((branch) => branch.id === request.to && branch.parent === null)
  if (!agent || !source || !target) return Problem.fail(404, 'not_found', `This swarm has no branch ${source ? request.to : request.branch}.`)
  if (ended(source)) return Problem.fail(409, 'conflict', `${source.who} is stopped: what it had not spent already went back to its backers.`)
  if (ended(target)) return Problem.fail(409, 'conflict', `${target.who} is stopped; move the money to another branch.`)

  const amount = units(request.amount)
  if (source.budget !== null && (source.left === null || Memo.units(source.left) < amount))
    return Problem.fail(409, 'insufficient_balance', `${source.who} has ${dollars(source.left ?? '0')} of its budget left, less than ${dollars(Memo.decimal(amount))}: money a branch spent stays spent.`)
  const ids = await Store.shift(env, { agent, amount, contributor: allowed.value.address, from: source.id, swarm: row.id, to: target.id })
  if (!ids.length)
    return Problem.fail(409, 'insufficient_balance', `You put less than ${dollars(Memo.decimal(amount))} behind ${source.who}; you move only what you put behind a branch.`)

  if (target.budget !== null) await Store.base(env, row.id, agent, target.id, Memo.units(target.budget))
  const money = await Store.funds(env, row.id, agent)
  const said = `${Mention.at(account.handle)} moved ${dollars(Memo.decimal(amount))} from ${source.who} (branch ${source.id}) to ${target.who} (branch ${target.id}).`
  const lowered =
    source.budget === null
      ? undefined
      : await reached(stub(env, row.id).direct(row.id, { agent, branch: source.id, said: null, usd: Number(backed(money, source.id)) / 1_000_000, wake: null }))
  const raised =
    lowered && !lowered.ok
      ? lowered
      : await reached(
          stub(env, row.id).direct(row.id, {
            agent,
            branch: target.id,
            said,
            usd: target.budget === null ? null : Number(backed(money, target.id)) / 1_000_000,
            wake: target.starved && target.budget !== null ? `Backers raised your budget to ${dollars(Memo.decimal(backed(money, target.id)))}. Carry on with your task.` : null,
          }),
        )
  if (!raised.ok) {
    await Store.unsteer(env, ids)
    if (lowered?.ok) await reached(stub(env, row.id).direct(row.id, { agent, branch: source.id, said: null, usd: Number(source.budget), wake: null }))
    return Problem.fail(502, 'upstream_failed', `The gateway did not move the budget, so nothing moved: ${raised.detail}`)
  }
  return Problem.ok(await fresh(env, row, [source.id, target.id], [source, target]))
}

export async function btw(env: Cloudflare.Env, input: Input<'btw'>, address?: Address): Promise<Problem.Result<Btw.Exchange>> {
  const parsed = parse(schema.btw, input)
  if (!parsed.ok) return parsed
  const gone = await legacy(env, parsed.value.swarm, true)
  if (!gone.ok) return gone
  const request = parsed.value
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to ask the swarm side questions.')
  const [found, account] = await Promise.all([Store.rostered(env, request.swarm), Store.account(env, address)])
  if (!found) return missing()
  if (!account.name) return unnamed()
  const row = found.row
  const steers = await Team.steerer(env, row, address, found.members)
  if (!steers.ok) return steers
  if (row.steering === 'team' && !steers.value)
    return Problem.fail(403, 'not_member', "Only this swarm's team asks it side questions, as only its team steers it.")
  if (row.steering !== 'team' && !found.members.some((member) => member.address === address && units(member.backed) >= Mention.smallestSteer))
    return Problem.fail(
      403,
      'not_member',
      `Side questions are paid from the swarm's money, so they take at least ${dollars(Memo.decimal(Mention.smallestSteer))} of your own money sent to the swarm.`,
    )

  const answered = await stub(env, row.id).btw({ address, ...(request.branch === undefined ? {} : { branch: request.branch }), prompt: Btw.ask(request.thread, request.question), question: request.question, swarm: row.id })
  if (!answered.ok) {
    if (answered.status === 429) return Problem.fail(429, 'rate_limited', answered.detail)
    if (/\b402\b|payment|over_limit|budget/i.test(answered.detail))
      return Problem.fail(409, 'insufficient_balance', `The swarm could not pay for the answer: it has ${row.status === 'paused' ? 'paused for want of money' : 'too little left right now'}. Fund it and ask again.`)
    return answered.status === 409 ? Problem.fail(409, 'conflict', answered.detail) : Problem.fail(502, 'upstream_failed', `The gateway did not answer the side question: ${answered.detail}`)
  }
  return Problem.ok({ answer: answered.value, question: request.question })
}

export async function team(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<Roster>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const held = Team.cached(parsed.value.swarm)
  if (held) return Problem.ok(held)
  const found = await Store.rostered(env, parsed.value.swarm)
  if (!found) return missing()
  return Team.roster(env, found.row, found.members).then(Problem.ok, (error: unknown) => Problem.fail(502, 'upstream_failed', String(error instanceof Error ? error.message : error)))
}

async function governed(env: Cloudflare.Env, swarm: string, address: Address | undefined): Promise<Problem.Result<Store.Row>> {
  if (!address) return Problem.fail(401, 'unauthorized', "Sign in with Tempo ID to manage who steers a swarm.")
  const row = await Store.find(env, swarm)
  if (!row) return missing()
  const admin = await Team.admin(env, row, address).then(Problem.ok, Team.unlisted)
  if (!admin.ok) return admin
  if (!admin.value)
    return Problem.fail(403, 'access_denied', "Only this swarm's admins choose who steers it: whoever started it signed in, or else its biggest backer, and the admins they add.")
  return Problem.ok(row)
}

export async function steer(env: Cloudflare.Env, input: Input<'steering'>, address?: Address): Promise<Problem.Result<Roster>> {
  const parsed = parse(schema.steering, input)
  if (!parsed.ok) return parsed
  const gone = await legacy(env, parsed.value.swarm, true)
  if (!gone.ok) return gone
  const request = parsed.value
  if (request.steering === undefined && request.memberBudget === undefined) return Problem.fail(400, 'invalid_request', 'Send steering, memberBudget or both.')
  const governing = await governed(env, request.swarm, address)
  if (!governing.ok) return governing
  const pinned = request.memberBudget === undefined && governing.value.creator !== null
  const teamed = pinned ? Problem.ok(governing.value) : await Team.ensure(env, governing.value, address as Address)
  if (!teamed.ok) return teamed
  const row = teamed.value

  if (request.memberBudget !== undefined) {
    const set = await Gateway.allowance(env, row.team as string, request.memberBudget)
    if (!set.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not set the team's budget: ${set.detail}`)
  }
  if (request.steering) await Store.update(env, row.id, { steering: request.steering })
  Team.forget(row.id)
  const fresh = await Store.find(env, row.id)
  return told(env, row.id, await Team.roster(env, fresh ?? row).then(Problem.ok, (error: unknown) => Problem.fail(502, 'upstream_failed', String(error instanceof Error ? error.message : error))))
}

function told(env: Cloudflare.Env, swarm: string, result: Problem.Result<Roster>) {
  if (result.ok) waitUntil(stub(env, swarm).rostered(result.value).catch(() => undefined))
  return result
}

function retold(env: Cloudflare.Env, row: Store.Row) {
  Team.forget(row.id)
  waitUntil(Team.roster(env, row).then((roster) => stub(env, row.id).rostered(roster)).catch(() => undefined))
}

export async function seat(env: Cloudflare.Env, input: Input<'seat'>, address?: Address): Promise<Problem.Result<Roster>> {
  const parsed = parse(schema.seat, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const governing = await governed(env, request.swarm, address)
  if (!governing.ok) return governing
  const member = isAddress(request.member) ? request.member : await Store.named(env, request.member)
  if (!member) return Problem.fail(404, 'not_found', `No one is called @${request.member}.`)
  const operator = await Gateway.wallet(env)
  if (!operator) return Problem.fail(502, 'unavailable', "The gateway did not answer, so the swarm's team cannot change right now.")
  if (member.toLowerCase() === operator) return Problem.fail(400, 'invalid_request', "That wallet holds every swarm's team for Swarms and steers none of them.")
  const teamed = await Team.ensure(env, governing.value, address as Address)
  if (!teamed.ok) return teamed
  const row = teamed.value

  const added = await Gateway.enlist(env, row.team as string, { ...(request.budget !== undefined ? { budget: request.budget } : {}), member, role: request.role })
  if (!added.ok) return Problem.fail(added.status === 409 ? 409 : 502, added.status === 409 ? 'conflict' : 'upstream_failed', `The gateway did not add ${member} to the swarm's team: ${added.detail}`)
  Team.forget(row.id)
  return told(env, row.id, await Team.roster(env, row).then(Problem.ok, (error: unknown) => Problem.fail(502, 'upstream_failed', String(error instanceof Error ? error.message : error))))
}

export async function unseat(env: Cloudflare.Env, input: Input<'unseat'>, address?: Address): Promise<Problem.Result<Roster>> {
  const parsed = parse(schema.unseat, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to leave or manage a swarm\'s team.')
  const row = await Store.find(env, request.swarm)
  if (!row) return missing()
  if (!row.team)
    return row.creator?.toLowerCase() === request.member
      ? Problem.fail(409, 'conflict', "The swarm's last admin stays: add another admin first.")
      : Problem.fail(404, 'not_found', "No one else is on this swarm's team.")
  const roster = await Team.roster(env, row).catch(() => undefined)
  if (!roster) return Problem.fail(502, 'upstream_failed', "The gateway did not list the swarm's team.")
  const self = request.member === address.toLowerCase()
  if (!self && !roster.admins.includes(address.toLowerCase() as Address))
    return Problem.fail(403, 'access_denied', "Only this swarm's admins remove others from its team; anyone may leave it.")
  if (roster.admins.length === 1 && roster.admins[0] === request.member)
    return Problem.fail(409, 'conflict', 'The swarm\'s last admin stays: add another admin first.')
  if (!roster.seats.some((seat) => seat.address === request.member)) return Problem.fail(404, 'not_found', `${request.member} is not on this swarm's team.`)

  const removed = await Gateway.dismiss(env, row.team, request.member)
  if (!removed.ok) return Problem.fail(502, 'upstream_failed', `The gateway did not remove ${request.member}: ${removed.detail}`)
  Team.forget(row.id)
  return told(env, row.id, await Team.roster(env, row).then(Problem.ok, (error: unknown) => Problem.fail(502, 'upstream_failed', String(error instanceof Error ? error.message : error))))
}

export async function chatter(env: Cloudflare.Env, input: Input<'swarm'>, request: Request): Promise<Problem.Result<Response>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return Problem.fail(400, 'invalid_request', 'Open this route as a WebSocket.')
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()

  return Problem.ok(await stub(env, parsed.value.swarm).fetch(new Request(`https://swarm/chat?swarm=${encodeURIComponent(parsed.value.swarm)}${new URL(request.url).searchParams.get('listen') === '1' ? '&listen=1' : ''}`, request)))
}

function dollars(amount: string) {
  return '$' + Words.trim(amount)
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
  const gone = await legacy(env, parsed.value.swarm, true)
  if (!gone.ok) return gone
  const row = await Store.find(env, parsed.value.swarm)
  if (!row) return missing()
  const label = parsed.value.label ?? ''
  const issued: Hands.Issued = await stub(env, row.id).lend(row.id, label, contributor ?? null)
  if (!issued.ok && issued.reason === 'full') return Problem.fail(409, 'conflict', `This swarm has ${Hands.limit} machines connected right now.`)
  if (!issued.ok && issued.reason === 'upstream') return Problem.fail(502, 'upstream_failed', `The gateway did not issue the hand: ${issued.detail}`)
  if (!issued.ok) return Problem.fail(502, 'unavailable', 'No free hand name was found. Try again.')
  const { minted, name } = issued
  lending.delete(row.id)
  return Problem.ok({
    cli: Connect.cli(minted),
    command: minted.command,
    label,
    library: Connect.library({ name, token: minted.token, url: minted.url }),
    name,
    npm: Connect.install,
    swarm: row.id,
    tab: minted.tab ?? null,
    token: minted.token,
    url: minted.url,
  })
}

const lending = new Map<string, { at: number; hands: Lent[] }>()

const lendingMs = 10_000

export async function hands(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<{ hands: Lent[] }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const gone = await legacy(env, parsed.value.swarm, false)
  if (!gone.ok) return gone
  const cached = lending.get(parsed.value.swarm)
  if (cached && Date.now() - cached.at < lendingMs) return Problem.ok({ hands: cached.hands })
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()
  const { listed, rows }: { listed: Gateway.Listed[] | undefined; rows: Hands.Row[] } = await stub(env, parsed.value.swarm).lent(parsed.value.swarm)
  const lent = Hands.lent(rows, listed)
  if (listed) lending.set(parsed.value.swarm, { at: Date.now(), hands: lent })
  return Problem.ok({ hands: lent })
}

export async function transfer(env: Cloudflare.Env, input: Input<'transfer'>, origin: string): Promise<Problem.Result<Prepared>> {
  const parsed = parse(schema.transfer, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const [row, owner] = await Promise.all([Store.find(env, request.swarm), Gateway.wallet(env)])
  if (!row) return missing()
  if (row.archived_at) return Problem.fail(410, 'gone', 'This swarm is archived: it takes no new rides.')
  if (!owner) return Problem.fail(502, 'unavailable', 'The gateway did not answer, so a transfer cannot be prepared right now.')
  if (request.node && row.form !== 'tree') return Problem.fail(400, 'invalid_request', 'node goes with tree swarms.')

  const note = row.form === 'tree' ? (request.node && request.node !== Nodes.root ? 'n:' + request.node : null) : request.note || null
  const amount = request.amount === undefined ? null : units(request.amount)
  const memo = Credit.memo(owner, row.id, note)
  const token = request.token === 'mach' ? Chain.mach : Chain.tokens[request.token]
  const query = new URLSearchParams({
    fund: '',
    token: request.token,
    ...(amount === null ? {} : { amount: Memo.decimal(amount) }),
    ...(note && row.form !== 'tree' ? { note } : {}),
  })
  return Problem.ok({
    amount: amount === null ? null : Memo.decimal(amount),
    call: amount === null ? null : { data: encodeFunctionData({ abi: Abis.tip20, args: [Chain.recipient, amount, memo], functionName: 'transferWithMemo' }), to: token.address },
    link: row.form === 'tree' && request.node ? `${origin}${Nickname.path(row)}/n/${request.node}?${query}` : `${origin}${Nickname.path(row)}?${query}`,
    memo,
    memoText: `bytes16(keccak256("gateway:credit:${Credit.chainId}:${owner}:${Credit.app(row.id)}")) ++ bytes16(keccak256("${note ? `note:${row.id}:${note}` : `swarm:${row.id}`}"))`,
    note,
    swarm: row.id,
    symbol: token.symbol,
    to: Chain.recipient,
    token: request.token,
    tokenAddress: token.address,
  })
}

export async function contribute(
  env: Cloudflare.Env,
  input: Input<'contribution'>,
): Promise<Problem.Result<{ contributed: Contributed; created: boolean }>> {
  const parsed = parse(schema.contribution, input)
  if (!parsed.ok) return parsed
  const request = parsed.value
  const row = await Store.find(env, request.swarm)
  if (!row) return missing()
  if (row.archived_at) return Problem.fail(410, 'gone', 'This swarm is archived: it takes no new rides.')

  const [credited, existing] = await Promise.all([Gateway.credited(env, row.id, request.hash), Store.gift(env, request.hash)])
  if (!credited.ok) {
    if (credited.status === 404) return Problem.fail(404, 'not_found', 'Tempo has no receipt for this transaction yet.')
    if (credited.status === 400)
      return Problem.fail(400, 'invalid_request', `That transaction is not a transfer to the gateway for this swarm: ${credited.detail}`)
    return Problem.fail(502, 'upstream_failed', `The gateway did not credit the transfer: ${credited.detail}`)
  }
  const first = credited.value.deposits[0]
  if (!first) return Problem.fail(502, 'upstream_failed', 'The gateway credited no transfer for this transaction.')

  const total = credited.value.deposits.reduce((sum, deposit) => sum + Memo.units(deposit.amount), 0n)
  if (row.form === 'tree') {
    const asked = request.node && request.node !== Nodes.root ? request.node : null
    const tagged = asked && credited.value.deposits.some((deposit) => deposit.tag.toLowerCase() === Credit.tag(row.id, 'n:' + asked).toLowerCase()) ? asked : null
    const gift = existing ?? (await Store.give(env, { amount: String(total), channel: null, contributor: first.from, id: request.hash as Hex, note: null, note_id: null, swarm: row.id, token: first.token })) ?? (await Store.gift(env, request.hash))
    if (!gift) return Problem.fail(502, 'unavailable', 'The contribution was not saved.')
    await stub(env, row.id).treePledge(row.id, { amount: gift.amount.includes('.') ? gift.amount : Memo.decimal(BigInt(gift.amount)), contributor: gift.contributor, hash: request.hash, nid: tagged })
    const updated = await Store.find(env, row.id)
    return Problem.ok({ contributed: { contribution: Store.contribution(gift), swarm: Store.summary(updated ?? row) }, created: !existing })
  }
  const asked = request.note || null
  const tagged = asked && credited.value.deposits.some((deposit) => deposit.tag.toLowerCase() === Credit.tag(row.id, asked).toLowerCase()) ? asked : null
  const steers = tagged ? await Team.steerer(env, row, first.from) : Problem.ok(undefined)
  if (!steers.ok) return steers
  const text = tagged && (row.steering !== 'team' || steers.value) ? tagged : null
  const noteId = text ? await Store.noteId(text) : null
  let written: Store.Gift | null
  let recovered = false
  if (existing) {
    written = text && noteId && !existing.note ? await Store.annotate(env, row.id, request.hash, { note: text, note_id: noteId }) : null
    if (!written) {
      await stub(env, row.id).funded(row.id)
      return Problem.fail(409, 'conflict', `This transaction is already counted${text && !existing.note ? ', and its money is already behind another idea or a branch' : ''}.`)
    }
  } else {
    written = await Store.give(env, { amount: String(total), channel: null, contributor: first.from, id: request.hash as Hex, note: text, note_id: noteId, swarm: row.id, token: first.token })
    if (!written && text && noteId) {
      written = await Store.annotate(env, row.id, request.hash, { note: text, note_id: noteId })
      recovered = written !== null
    }
  }
  if (written) {
    await stub(env, row.id).contributed({ amount: Memo.decimal(total), contributor: first.from, hash: request.hash, kind: existing || recovered ? 'noted' : 'new', note: text, noteId, swarm: row.id, token: first.token })
    if (text && noteId) await logged(Search.note(env, row.id, noteId, text))
    if (!row.creator) retold(env, row.steering === 'team' && !existing ? { ...row, creator: (await Store.claim(env, row.id, first.from)) ?? null } : row)
  }

  const [gift, updated] = await Promise.all([written ?? Store.gift(env, request.hash), Store.find(env, row.id)])
  if (!gift) return Problem.fail(502, 'unavailable', 'The contribution was not saved.')
  return Problem.ok({
    contributed: { contribution: Store.contribution(gift), swarm: Store.summary(updated ?? row) },
    created: !existing && !recovered && written !== null,
  })
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

export async function health(env: Cloudflare.Env): Promise<Problem.Result<{ ledgers: Ledgered[]; ok: boolean; refused: { id: string; remaining: string; title: string }[]; running: number; swarms: number }>> {
  const listed = await list(env, {})
  if (!listed.ok) return listed
  const refused = listed.value.swarms.filter((swarm) => swarm.form !== 'tree' && !swarm.archivedAt && Standing.refused(swarm)).map((swarm) => ({ id: swarm.id, remaining: swarm.remaining, title: swarm.title }))
  const books = await ledgers(env)
  return Problem.ok({ ledgers: books, ok: refused.length === 0 && books.every((book) => book.ok), refused, running: listed.value.swarms.filter((swarm) => swarm.status === 'running').length, swarms: listed.value.swarms.length })
}

export async function problems(env: Cloudflare.Env): Promise<Problem.Result<{ problems: (Brief.Problem & { open: boolean; swarm: string | null })[] }>> {
  const listed = await list(env, {})
  const rows = listed.ok ? listed.value.swarms : []
  const taken = new Map(rows.filter((row) => row.problem).map((row) => [row.problem as string, row.id]))
  return Problem.ok({ problems: Brief.problems.map((item) => ({ ...item, open: !taken.has(item.id), swarm: taken.get(item.id) ?? null })) })
}

const fleets = new Map<string, { at: number; machines: Fleet.Machine[] }>()

export async function machines(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<{ machines: Fleet.Machine[] }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const cached = fleets.get(parsed.value.swarm)
  if (cached && Date.now() - cached.at < lendingMs) return Problem.ok({ machines: cached.machines })
  if (!(await Store.exists(env, parsed.value.swarm))) return missing()
  const [folded, lent] = await Promise.all([stub(env, parsed.value.swarm).fleet(), hands(env, input)])
  const machines = Fleet.lend(folded as unknown as Fleet.Machine[], lent.ok ? lent.value.hands : []).map((machine) => ({ ...machine, runs: machine.runs ?? { count: 0, failed: 0, last: null } }))
  fleets.set(parsed.value.swarm, { at: Date.now(), machines })
  return Problem.ok({ machines })
}

export async function backers(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<{ backers: Member[]; ideas: Note[] }>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const id = parsed.value.swarm
  const viewing = Store.seen(id) ? Promise.resolve(stub(env, id).view({ feed: 0, pushed: true, texts: false })) : undefined
  const found = await Store.backed(env, id)
  if (!found) return missing()
  const view = await (viewing ?? stub(env, id).view({ feed: 0, pushed: true, texts: false }))
  const members = found.members
  const ideas = found.notes(new Set(view.steered))
  return Problem.ok({ backers: [...members].sort((a, b) => Number(BigInt(Math.round(Number(b.backed) * 1e6)) - BigInt(Math.round(Number(a.backed) * 1e6)))), ideas })
}


async function treeRow(env: Cloudflare.Env, swarm: string, writing = false): Promise<Problem.Result<Store.Row>> {
  const row = await Store.find(env, swarm)
  if (!row) return missing()
  if (row.form !== 'tree') return Problem.fail(404, 'not_found', 'This swarm is not a tree swarm; read it with /v1/swarms/:id.')
  if (writing && row.archived_at) return Problem.fail(410, 'gone', 'This swarm is archived and read-only.')
  return Problem.ok(row)
}

const answerCodes: Record<Riding.Fault['status'], Problem.Code> = { 400: 'invalid_request', 403: 'access_denied', 404: 'not_found', 409: 'conflict', 410: 'gone' }

function answered<value>(answer: Riding.Answer<value>): Problem.Result<value> {
  return answer.ok ? Problem.ok(answer.value) : Problem.fail(answer.status, answerCodes[answer.status], answer.detail)
}

async function legacy(env: Cloudflare.Env, swarm: unknown, writing: boolean): Promise<Problem.Result<null>> {
  if (typeof swarm !== 'string') return Problem.ok(null)
  const row = await Store.find(env, swarm.trim())
  if (row?.form === 'tree') return Problem.fail(410, 'gone', 'Tree swarms have no branches, lent hands or steering notes: ride and steer their nodes instead.')
  if (writing && row?.archived_at) return Problem.fail(410, 'gone', 'This swarm is archived and read-only.')
  return Problem.ok(null)
}

export async function tree(env: Cloudflare.Env, input: Input<'tree'>): Promise<Problem.Result<TreeView>> {
  const parsed = parse(schema.tree, input)
  if (!parsed.ok) return parsed
  const row = await treeRow(env, parsed.value.swarm)
  if (!row.ok) return row
  return answered(await stub(env, row.value.id).treeRead(row.value.id, { depth: parsed.value.depth, root: parsed.value.root, status: parsed.value.status }))
}

export async function node(env: Cloudflare.Env, input: Input<'node'>): Promise<Problem.Result<NodeView>> {
  const parsed = parse(schema.node, input)
  if (!parsed.ok) return parsed
  const row = await treeRow(env, parsed.value.swarm)
  if (!row.ok) return row
  return answered(await stub(env, row.value.id).nodeRead(row.value.id, parsed.value.node))
}

export async function nodeUpdates(env: Cloudflare.Env, input: Input<'nodeUpdates'>): Promise<Problem.Result<NodeUpdates>> {
  const parsed = parse(schema.nodeUpdates, input)
  if (!parsed.ok) return parsed
  const row = await treeRow(env, parsed.value.swarm)
  if (!row.ok) return row
  return answered(await stub(env, row.value.id).treeDeltas(row.value.id, { after: parsed.value.after, limit: parsed.value.limit, nid: parsed.value.node ?? null }))
}

export async function treeLive(env: Cloudflare.Env, input: Input<'swarm'>, signal: AbortSignal, after?: string): Promise<Problem.Result<Response>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const row = await treeRow(env, parsed.value.swarm)
  if (!row.ok) return row
  const from = after !== undefined && /^\d{1,15}$/.test(after) ? after : '0'
  return Problem.ok(await stub(env, row.value.id).fetch(new Request('https://swarm/tree?after=' + from, { signal })))
}

export async function burn(env: Cloudflare.Env, input: Input<'burn'>): Promise<Problem.Result<ProgressView>> {
  const parsed = parse(schema.burn, input)
  if (!parsed.ok) return parsed
  const row = await treeRow(env, parsed.value.swarm)
  if (!row.ok) return row
  return Problem.ok({ burn: await stub(env, row.value.id).treeBurn(row.value.id) })
}

export async function proofs(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<ProofsView>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const row = await treeRow(env, parsed.value.swarm)
  if (!row.ok) return row
  return Problem.ok(await stub(env, row.value.id).treeProofs(row.value.id))
}

export async function propose(env: Cloudflare.Env, input: Input<'propose'>, origin: string, address?: Address): Promise<Problem.Result<Proposed>> {
  const parsed = parse(schema.propose, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to propose a node.')
  const request = parsed.value
  const row = await treeRow(env, request.swarm, true)
  if (!row.ok) return row
  const nid = await Nodes.nid(request.parent, request.title)
  const proposal: Riding.Proposal = { by: address.toLowerCase(), form: request.form, parent: request.parent, statement: request.statement ?? null, title: request.title, words: request.spec }
  const kept = answered(await stub(env, row.value.id).treePropose(row.value.id, nid, proposal))
  if (!kept.ok) return kept
  const prepared = await transfer(env, { amount: request.amount ?? Nodes.defaults.ideaMin, node: nid, swarm: row.value.id, token: request.token }, origin)
  if (!prepared.ok) return prepared
  return Problem.ok({ nid, transfer: prepared.value })
}

const ideasPerDay = 5

export async function suggest(env: Cloudflare.Env, input: Input<'suggest'>, address?: Address): Promise<Problem.Result<Suggested>> {
  const parsed = parse(schema.suggest, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to suggest an idea.')
  const request = parsed.value
  const row = await treeRow(env, request.swarm, true)
  if (!row.ok) return row
  const shown = await stub(env, row.value.id).nodeRead(row.value.id, request.parent)
  if (!shown.ok) return answered(shown)
  if (shown.value.status === 'proven' || shown.value.status === 'dead end') return Problem.fail(409, 'conflict', 'That node has ended; suggest under an open one.')
  const idea = identifier()
  const written = await env.DB.prepare(
    'insert into ideas (id, swarm, parent, author, text, created_at) select ?1, ?2, ?3, ?4, ?5, ?6 where (select count(*) from ideas where author = ?4 and created_at > ?6 - 86400000) < ?7',
  )
    .bind(idea, row.value.id, request.parent, address.toLowerCase(), request.text, Date.now(), ideasPerDay)
    .run()
  if (!written.meta.changes) return Problem.fail(429, 'rate_limited', 'At most ' + ideasPerDay + ' suggestions a day from one account.')
  return Problem.ok({ id: idea })
}

export async function nodeSteer(env: Cloudflare.Env, input: Input<'nodeSteer'>, address?: Address): Promise<Problem.Result<Tree.Node>> {
  const parsed = parse(schema.nodeSteer, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to steer a node.')
  const row = await treeRow(env, parsed.value.swarm, true)
  if (!row.ok) return row
  return answered(await stub(env, row.value.id).treeSteer(row.value.id, { amount: parsed.value.amount, contributor: address, nid: parsed.value.node, note: parsed.value.note }))
}

export async function nodeMove(env: Cloudflare.Env, input: Input<'nodeMove'>, address?: Address): Promise<Problem.Result<Tree.Node | null>> {
  const parsed = parse(schema.nodeMove, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to move your money.')
  const row = await treeRow(env, parsed.value.swarm, true)
  if (!row.ok) return row
  return answered(await stub(env, row.value.id).treeMove(row.value.id, { amount: Memo.decimal(units(parsed.value.amount)), contributor: address, from: parsed.value.node, to: parsed.value.to }))
}

export async function nodeEnd(env: Cloudflare.Env, input: Input<'nodeEnd'>, address?: Address): Promise<Problem.Result<Tree.Node>> {
  const parsed = parse(schema.nodeEnd, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to end a node.')
  const row = await treeRow(env, parsed.value.swarm, true)
  if (!row.ok) return row
  const admin = await Team.admin(env, row.value, address).catch(() => false)
  return answered(await stub(env, row.value.id).treeEnd(row.value.id, { admin: !!admin, contributor: address, nid: parsed.value.node, why: parsed.value.why }))
}

export async function triage(env: Cloudflare.Env, input: Input<'triage'>, address?: Address): Promise<Problem.Result<{ applied: Triage.Applied[] }>> {
  const parsed = parse(schema.triage, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID as an admin of the swarm.')
  const row = await treeRow(env, parsed.value.swarm, true)
  if (!row.ok) return row
  if (!(await Team.admin(env, row.value, address).catch(() => false))) return Problem.fail(403, 'access_denied', "Only the swarm's admins take triage actions by hand.")
  const action = Triage.action(parsed.value.action)
  if (!action) return Problem.fail(400, 'invalid_request', 'action is one of approve { node, weight }, adopt { idea, title, spec, statement }, merge { node, into }, reject { node, why }, grant { node, amount } or restate { node, statement }.')
  return Problem.ok({ applied: await stub(env, row.value.id).treeTriage(row.value.id, action, 'admin:' + address.toLowerCase()) })
}

export async function review(env: Cloudflare.Env, input: Input<'node'>, address?: Address): Promise<Problem.Result<{ reviewed: boolean }>> {
  const parsed = parse(schema.node, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID as an admin of the swarm.')
  const row = await treeRow(env, parsed.value.swarm, true)
  if (!row.ok) return row
  if (!(await Team.admin(env, row.value, address).catch(() => false))) return Problem.fail(403, 'access_denied', "Only the swarm's admins sign off a seeded statement.")
  const done = answered(await stub(env, row.value.id).treeReview(row.value.id, parsed.value.node, address.toLowerCase()))
  return done.ok ? Problem.ok({ reviewed: done.value }) : done
}

export async function standing(env: Cloudflare.Env, input: Input<'swarm'>, address?: Address): Promise<Problem.Result<Rider>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (!address) return Problem.fail(401, 'unauthorized', 'Sign in with Tempo ID to read your standing.')
  const row = await treeRow(env, parsed.value.swarm)
  if (!row.ok) return row
  return Problem.ok(await stub(env, row.value.id).treeStanding(row.value.id, address))
}

async function digest(text: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

export async function keyed(env: Cloudflare.Env, bearer: string | undefined) {
  if (!bearer || !env.SWARMS_GATEWAY_KEY) return false
  const [given, held] = await Promise.all([digest(bearer), digest(env.SWARMS_GATEWAY_KEY)])
  return given.every((byte, index) => byte === held[index])
}

function taken(name: string) {
  return Problem.fail(409, 'conflict', `Another swarm is called ${name}.`)
}

async function owned(env: Cloudflare.Env, row: Store.Row, address: Address | undefined, operated: boolean): Promise<Problem.Result<null>> {
  if (operated) return Problem.ok(null)
  if (!address) return Problem.fail(401, 'unauthorized', "Sign in with Tempo ID as one of the swarm's admins or the operator, or send the operator's gateway key as the bearer token.")
  const operator = await Gateway.wallet(env)
  if (operator && address.toLowerCase() === operator.toLowerCase()) return Problem.ok(null)
  const admin = await Team.admin(env, row, address).then(Problem.ok, Team.unlisted)
  if (!admin.ok) return admin
  return admin.value ? Problem.ok(null) : Problem.fail(403, 'access_denied', "Only the swarm's admins and the operator name it.")
}

export async function nickname(env: Cloudflare.Env, input: Input<'nickname'>, address?: Address, operated = false): Promise<Problem.Result<Summary>> {
  const parsed = parse(schema.nickname, input)
  if (!parsed.ok) return parsed
  const row = await Store.find(env, parsed.value.swarm)
  if (!row) return missing()
  if (row.archived_at) return Problem.fail(410, 'gone', 'This swarm is archived and read-only.')
  const allowed = await owned(env, row, address, operated)
  if (!allowed.ok) return allowed
  const name = parsed.value.nickname
  if (name === (row.nickname ?? null)) return Problem.ok(Store.summary(row))
  if (name && (await Store.called(env, name))?.current === name) return taken(name)
  try {
    await Store.nickname(env, row.id, name)
  } catch (error) {
    if (error instanceof Store.Taken) return taken(name ?? '')
    throw error
  }
  const updated = await Store.find(env, row.id)
  return Problem.ok(Store.summary(updated ?? { ...row, nickname: name }))
}

export async function rider(env: Cloudflare.Env, input: Input<'rider'>): Promise<Problem.Result<Profile>> {
  const parsed = parse(schema.rider, input)
  if (!parsed.ok) return parsed
  const who = parsed.value.who.replace(/^@/, '')
  const address = isAddress(who) ? (who as Address) : await Store.holder(env, who)
  if (!address) return Problem.fail(404, 'not_found', 'No rider has this name.')
  const lower = address.toLowerCase()
  const [account, found] = await Promise.all([Store.account(env, address), Store.ridden(env, address)])
  const rows = await Promise.all(found.swarms.map((one) => Store.find(env, one.swarm)))
  const trees = await Promise.all(rows.map((row) => (row?.form === 'tree' ? within(tree(env, { depth: 64, swarm: row.id }), 2500) : undefined)))
  const swarms: Profile['swarms'] = []
  const items: Profile['items'] = []
  rows.forEach((row, index) => {
    const one = found.swarms[index]
    if (!row || !one) return
    const summary = Store.summary(row)
    swarms.push({ balance: summary.balance, form: summary.form, id: row.id, nickname: summary.nickname, ridden: Memo.decimal(BigInt(one.ridden)), riders: summary.contributors, since: one.since, started: !!one.started, title: row.title })
    const read = trees[index]
    const nodes = read?.ok ? read.value.nodes : []
    const mine = (node: Tree.Node) => node.by.agent === null && node.by.address?.toLowerCase() === lower
    const amounts = new Map(found.nodes.filter((each) => each.swarm === row.id).map((each) => [each.node, BigInt(each.ridden)]))
    for (const node of nodes) {
      if (node.form === 'goal' || node.form === 'triage') continue
      const amount = amounts.get(node.id)
      if (amount === undefined && !mine(node)) continue
      items.push({ created: mine(node), node: node.id, ridden: Memo.decimal(amount ?? 0n), status: node.status, swarm: row.id, title: node.title })
    }
  })
  const order = (a: { ridden: string }, b: { ridden: string }) => Number(Memo.units(b.ridden) - Memo.units(a.ridden))
  swarms.sort((a, b) => order(a, b) || b.since - a.since)
  items.sort(order)
  const total = found.swarms.reduce((sum, one) => sum + BigInt(one.ridden), 0n)
  return Problem.ok({ items, rider: account, ridden: Memo.decimal(total), swarms })
}

export async function named(env: Cloudflare.Env, input: Input<'named'>): Promise<Problem.Result<Named>> {
  const parsed = parse(schema.named, input)
  if (!parsed.ok) return parsed
  const name = parsed.value.name
  const found = Nickname.usable(name) ? await Store.called(env, name) : null
  if (!found) return Problem.fail(404, 'not_found', 'No swarm has this nickname.')
  return Problem.ok({ name, nickname: found.current, swarm: found.swarm })
}

export async function archive(env: Cloudflare.Env, input: Input<'swarm'>, address?: Address, operated = false): Promise<Problem.Result<Summary>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  if (!operated) {
    if (!address) return Problem.fail(401, 'unauthorized', "Sign in with Tempo ID as the operator, or send the operator's gateway key as the bearer token.")
    const operator = await Gateway.wallet(env)
    if (!operator) return Problem.fail(502, 'unavailable', 'The gateway did not answer, so the operator cannot be checked right now.')
    if (address.toLowerCase() !== operator.toLowerCase()) return Problem.fail(403, 'access_denied', 'Only the operator archives a swarm.')
  }
  const row = await Store.find(env, parsed.value.swarm)
  if (!row) return missing()
  const at = row.archived_at ?? Date.now()
  await stub(env, row.id).archive(row.id, at)
  await Store.archive(env, row.id, at)
  const updated = await Store.find(env, row.id)
  return Problem.ok(Store.summary(updated ?? row))
}

export async function verified(env: Cloudflare.Env, request: Request): Promise<Problem.Result<{ counted: boolean }>> {
  const read = await Verify.read(env, request)
  if (!read) return Problem.ok({ counted: false })
  const row = await Store.find(env, read.swarm)
  if (!row || row.form !== 'tree' || row.archived_at) return Problem.ok({ counted: false })
  await stub(env, row.id).treeVerified(row.id, read.nid, read.sha, read.outcome, read.claim ?? 'proof')
  return Problem.ok({ counted: true })
}

export async function ledger(env: Cloudflare.Env, input: Input<'swarm'>): Promise<Problem.Result<Ledgered>> {
  const parsed = parse(schema.swarm, input)
  if (!parsed.ok) return parsed
  const row = await treeRow(env, parsed.value.swarm)
  if (!row.ok) return row
  return Problem.ok(await stub(env, row.value.id).treeHealth(row.value.id))
}

const ledgerSeconds = 10

export async function ledgers(env: Cloudflare.Env): Promise<Ledgered[]> {
  return Edge.cached(env, 'ledgers', ledgerSeconds, async () => {
    const { results } = await env.DB.prepare("select id from swarms where form = 'tree' and archived_at is null limit 20").all<{ id: string }>()
    return Promise.all(results.map((row) => stub(env, row.id).treeHealth(row.id)))
  })
}

async function plant(env: Cloudflare.Env, row: Store.Row, request: z.output<typeof schema.create>, setup: Setup.Setup) {
  const keys = new Map<string, string>([['root', Nodes.root]])
  const seed: Nodes.Posting[] = []
  for (const one of request.seed) {
    if (one.key === Nodes.root) continue
    const parent = keys.get(one.parent)
    if (!parent) return Problem.fail(400, 'invalid_request', 'Seed node ' + one.key + ' names a parent that comes later or not at all: ' + one.parent + '.')
    const made = await Nodes.nid(parent, one.title)
    keys.set(one.key, made)
    const written = Nodes.parse(one.spec)
    const words = written.title.trim() === one.title.trim() ? written.words : one.spec
    seed.push({ by: 'seed', form: one.form, needs: one.needs.flatMap((need) => keys.get(need) ?? []), nid: made, parent, statement: one.statement ?? written.statement ?? null, title: one.title, words })
  }
  await stub(env, row.id).plant({
    dispatcher: Persona.orchestrator(),
    reviewed: request.reviewed,
    root: { statement: request.statement ?? null, title: request.title, words: request.goal },
    seed,
    rules: Persona.rules(setup),
    settings: Nodes.defaults,
    setup,
    swarm: row.id,
  })
  return Problem.ok(null)
}

