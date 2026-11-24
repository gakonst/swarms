import { z } from 'zod'
import * as Setup from '../shared/Setup.ts'
import * as Feedback from './Feedback.ts'
import * as Machines from './Machines.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Sessions from './Sessions.ts'

type Json = Record<string, unknown>

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

const string = { type: 'string' }

const integer = { type: 'integer' }

const time = { description: 'Unix time in ms.', type: 'integer' }

const mach = { description: 'An amount with 6 decimals, such as "0.250000", in USD at par.', type: 'string' }

const nullable = (schema: Json) => ({ anyOf: [schema, { type: 'null' }] })

function object(properties: Record<string, unknown>, description?: string): Json {
  return {
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties),
    type: 'object',
  }
}

function input(schema: z.ZodType): Json {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Json
  return Object.fromEntries(Object.entries(json).filter((entry) => entry[0] !== '$schema'))
}

function ok(schema: Json, description: string, status = '200') {
  return { [status]: { content: { 'application/json': { schema } }, description } }
}

function failures(...statuses: Problem.Status[]) {
  return Object.fromEntries(statuses.map((status) => [String(status), { $ref: '#/components/responses/Problem' }]))
}

function parameter(name: string, where: 'path' | 'query', schema: Json, description: string) {
  return { description, in: where, name, required: where === 'path', schema }
}

const swarm = parameter('id', 'path', string, 'The swarm id, as in /s/<id>.')

const machine = parameter('machine', 'path', string, "A machine's name, as /machines lists it.")

function queried(schema: z.ZodObject, names: string[]) {
  const shape = input(schema) as { properties?: Record<string, Json> }
  return names.map((name) => {
    const property = shape.properties?.[name] ?? {}
    return parameter(name, 'query', property, String(property['description'] ?? ''))
  })
}

const usd = { description: 'A USD stablecoin amount with 6 decimals, such as "0.250000".', type: 'string' }

const currency = { enum: ['mach', 'ousd', 'pathusd', 'usdce'], type: 'string' }

const address = { pattern: '^0x[0-9a-fA-F]{40}$', type: 'string' }

const dollars = { description: 'Dollars with 6 decimals, such as "1.250000".', type: 'string' }

const statuses = { enum: ['proposed', 'funded', 'in flight', 'proven', 'dead end'], type: 'string' }

const check = object(
  {
    at: time,
    axioms: { items: string, type: 'array' },
    checker: string,
    command: string,
    commit: string,
    contentHash: string,
    durationMs: integer,
    exitCode: integer,
    mathlib: string,
    repo: string,
    run: string,
    statement: { description: "16 hex of the sha256 of the node's frozen Lean statement.", type: 'string' },
    theorem: string,
    toolchain: string,
    url: { description: 'The public verifier run: the checked record.', type: 'string' },
  },
  'What the verifier checked: the theorem built against the frozen statement with only the allowed axioms.',
)

const who = object({ address: nullable(string), agent: nullable(string), handle: string })

const funder = object({ amount: dollars, since: time, who })

const treeNode = object({
  by: who,
  children: { items: string, type: 'array' },
  counts: { additionalProperties: integer, description: 'Nodes in the subtree by status, this one included.', type: 'object' },
  createdAt: time,
  end: nullable(object({ at: time, check: nullable(check), into: nullable(string), kind: { enum: ['refuted', 'barrier', 'exhausted', 'merged', 'withdrawn', 'rejected'], type: 'string' }, why: string })),
  form: { enum: ['goal', 'program', 'approach', 'lemma', 'idea', 'triage'], type: 'string' },
  funders: { description: 'The top five riders.', items: funder, type: 'array' },
  id: string,
  money: object({
    committed: dollars,
    granted: dollars,
    inherited: dollars,
    left: dollars,
    pledged: dollars,
    spent: dollars,
    subtree: object({ left: dollars, pledged: dollars, spent: dollars }),
  }),
  needs: { items: string, type: 'array' },
  parent: nullable(string),
  paused: nullable({ description: 'How many runs in a row ended without a proof, split or refutation, once that reached the cap: the node waits for a fresh pledge or a triage grant. null: not paused.', ...integer }),
  proof: nullable(check),
  review: { description: 'The statement is seeded and still under human review.', type: 'boolean' },
  riders: integer,
  run: nullable(object({ agent: nullable(integer), attempt: integer, budget: dollars, checking: { type: 'boolean' }, doing: nullable(object({ at: time, text: string }, "The run's latest step, its newest reasoning summary or tool call in one line, while it works.")), k: integer, model: nullable({ description: "The gateway model the orchestrator picked for this run; null when the swarm's own setup chose it.", type: 'string' }), since: time, spent: dollars, task: string, until: time })),
  spec: string,
  statement: nullable(string),
  status: statuses,
  title: string,
  updatedAt: time,
})

const delta = object({ at: time, event: { enum: ['posted', 'funded', 'started', 'progress', 'checking', 'proven', 'ended', 'steered', 'moved', 'doing'], type: 'string' }, node: treeNode, seq: integer, text: string })

const headline = object({ deadEnds: integer, frontier: integer, inFlight: integer, lastProvenAt: nullable(time), pledged: dollars, perProven: nullable(dollars), proven: integer, spent: dollars })

const schemas = {
  Check: check,
  TreeNode: treeNode,
  Delta: delta,
  TreeView: object({
    headline,
    nodes: { items: treeNode, type: 'array' },
    seq: { description: 'The newest delta seq: drop deltas at or below it.', type: 'integer' },
  }),
  NodeView: {
    allOf: [
      treeNode,
      object({
        funders: { items: funder, type: 'array' },
        runs: { items: object({ budget: dollars, commit: nullable(string), k: integer, outcome: nullable(string), since: time, spent: dollars, summary: string, task: string, until: nullable(time) }), type: 'array' },
        steers: { items: object({ amount: dollars, at: time, note: string, who }), type: 'array' },
        suggestions: { items: object({ at: time, id: string, text: string, who }), type: 'array' },
      }),
    ],
  },
  NodeUpdates: object({ deltas: { items: delta, type: 'array' }, next: integer }),
  Burn: object({ burn: { items: object({ at: time, deadEnds: integer, proven: integer, spent: dollars }), type: 'array' } }),
  Proofs: object({ proofs: { items: object({ check, node: string, title: string }), type: 'array' } }),
  Prepared: object({ amount: nullable(dollars), call: nullable(object({ data: string, to: string })), link: string, memo: string, memoText: string, note: nullable(string), swarm: string, symbol: string, to: string, token: string, tokenAddress: string }, 'A transfer ready to send: transferWithMemo of amount to `to` with memo, or open link.'),
  Proposed: object({ nid: string, transfer: ref('Prepared') }),
  Suggested: object({ id: string }),
  Standing: object({ buckets: { items: object({ amount: dollars, node: string, title: string }), type: 'array' }, committed: dollars, free: dollars, refundable: dollars, spent: dollars, swarm: string }),
  Account: object(
    {
      address,
      handle: { description: 'The name rooms show: the username, or one made from the address such as quark-1a2b.', type: 'string' },
      name: nullable({ description: 'The username the account chose, lower case.', type: 'string' }),
    },
    'The signed-in account.',
  ),
  Artifact: object(
    {
      cover: { description: "Whether the swarm marked it as its preview: the picture its card and page show. The manifest's cover: true.", type: 'boolean' },
      entry: { description: 'The file the artifact opens at, relative to its folder.', type: 'string' },
      form: { description: 'How the page shows it: page is HTML, run sandboxed.', enum: ['page', 'image', 'markdown', 'table', 'json', 'text'], type: 'string' },
      kind: { description: 'What the swarm calls it, such as dashboard, chart or write-up.', type: 'string' },
      slug: string,
      summary: nullable(string),
      title: string,
      updatedAt: nullable(time),
      url: { description: 'Where to load it: /a/<swarm>/<slug>/<entry>, served from the gateway bucket with a sandboxing Content-Security-Policy.', type: 'string' },
      version: { description: "The manifest's version, which grows with every update.", type: 'integer' },
    },
    "Something a swarm published for contributors to follow along: files under artifacts/<slug>/ in its gateway bucket and a manifest at artifacts/<slug> in its kv, both public.",
  ),
  Answer: object(
    {
      at: time,
      done: { description: 'The agent reports the goal met.', type: 'boolean' },
      text: { description: 'The update, markdown, without its STATUS line.', type: 'string' },
    },
    "The swarm's newest update.",
  ),
  Answered: object({
    answer: nullable(ref('Answer')),
    status: ref('Status'),
    swarm: string,
    title: string,
    working: nullable(ref('Working')),
  }),
  Brief: object({
    base: nullable({ description: 'The head of the repository when the agent last resumed; diff the last of commits against it.', type: 'string' }),
    commits: { description: 'Commits pushed since the update before, newest first.', items: string, type: 'array' },
    done: { description: 'The agent reports the goal met.', type: 'boolean' },
    spent: { ...mach, description: 'What the swarm spent since the update before.' },
    at: time,
    excerpt: { description: 'The start of the update as plain text.', type: 'string' },
  }),
  Code: object(
    { app: string, clone: { description: 'A read-only git remote: git clone <clone> fetches the whole history without a key; pushes are refused.', type: 'string' }, name: string, owner: address },
    'The public repository that keeps the swarm\'s code, cloned read-only from clone, or read without a key from the gateway at /p/<owner>/<app>/git/<name>/files, read, log and diff.',
  ),
  Config: object({
    auth: { description: 'Where to sign in with Tempo ID: POST <auth>/challenge, then POST <auth>.', type: 'string' },
    chainId: integer,
    credit: nullable(object({ owner: address, recipient: address }, "Where money for a swarm goes: recipient is the gateway's address a transfer is sent to, and owner the wallet whose gateway apps the swarms are, which the memo names. null while the gateway does not answer.")),
    explorer: string,
    gateway: string,
    models: {
      description: "Every gateway model that calls tools, with its USD price per million tokens: what a swarm's setup may name and what its costs are figured from.",
      items: object({ cached: { type: 'number' }, id: string, input: { type: 'number' }, output: { type: 'number' } }),
      type: 'array',
    },
    reserve: mach,
    rpc: string,
    tokens: { items: object({ address, id: currency, symbol: string }), type: 'array' },
  }),
  Contributed: object({ contribution: ref('Contribution'), swarm: ref('Summary') }),
  Contribution: object(
    {
      amount: usd,
      at: time,
      contributor: address,
      hash: nullable({ description: 'The transaction; null for money that came in before 2026-11-06 through a pledge or monthly budget.', type: 'string' }),
      note: nullable(string),
      token: currency,
    },
    "Money sent to the swarm. Before 2026-11-06 money also came through pledges and monthly budgets; what of it the swarm spent is listed here too, without a hash.",
  ),
  Entry: object({
    at: time,
    detail: nullable(string),
    event: nullable({ description: 'The gateway event it came from, which a live entry shares with the stored one.', type: 'integer' }),
    kind: { enum: [...Operations.kinds], type: 'string' },
    seq: { description: 'Its place in the feed, or 0 for an entry from the live stream not stored yet.', type: 'integer' },
    text: string,
    who: nullable({ description: "The subagent it came from, by the name it was spawned with, or null for the swarm's agent.", type: 'string' }),
  }),
  Found: object({
    hits: { items: ref('Hit'), type: 'array' },
    terms: { description: 'The words searched for.', items: string, type: 'array' },
  }),
  Hand: object({ connected: { type: 'boolean' }, name: string }),
  Issued: object(
    {
      cli: { description: "Run on the machine to lend it: nc hand '<url>' --token <token>.", type: 'string' },
      command: { description: 'The same, after installing nanocode.', type: 'string' },
      label: string,
      library: { description: 'A Node module that attaches the hand with nanocode-ts Hand.connect.', type: 'string' },
      name: { description: 'The hand name, unique in the swarm.', type: 'string' },
      npm: { description: 'Installs nanocode-ts for the library form.', type: 'string' },
      swarm: string,
      tab: nullable({ description: 'nanocode.xyz/hand with the URL and token, to attach a browser tab.', type: 'string' }),
      token: { description: 'The hand token. Anyone holding it can attach a machine under this name.', type: 'string' },
      url: { description: 'The hand socket.', type: 'string' },
    },
    "A hand for a contributor's machine.",
  ),
  Lent: object({
    at: time,
    channels: nullable({ description: "What the swarm paid the hand's owner over its own MPP channels and how much of it settled on Tempo, as the gateway reports it.", type: 'string' }),
    charged: nullable({ description: 'What the hand has charged this swarm, as the gateway reports it.', type: 'string' }),
    connected: { type: 'boolean' },
    earned: nullable({ description: "What the hand's owner has earned, as the gateway reports it.", type: 'string' }),
    label: string,
    name: string,
    price: nullable({ description: "The prices the hand set for itself, as the gateway summarizes them; null when it charges nothing.", type: 'string' }),
    requests: { description: 'Requests the gateway dispatched to the hand.', type: 'integer' },
  }),
  Hit: object({
    at: nullable(time),
    entry: nullable(object({ kind: { enum: [...Operations.kinds], type: 'string' }, seq: integer })),
    kind: { enum: [...Operations.sources], type: 'string' },
    snippet: { description: 'Matching text with the matches marked «like this».', type: 'string' },
    swarm: object({ id: string, status: ref('Status'), title: string }),
  }),
  Note: object({
    backers: integer,
    id: string,
    note: string,
    share: { description: 'Share of the balance, 0 to 1.', type: 'number' },
    steered: { description: 'The note reached the swarm.', type: 'boolean' },
    weight: mach,
  }),
  Overview: {
    allOf: [
      ref('Summary'),
      object({
        about: nullable({ description: "One paragraph on what the swarm is trying to do and why it matters, written once from its goal by the swarm's orchestrator and paid from the swarm's money; null until it is written.", type: 'string' }),
        code: nullable(ref('Code')),
        contributions: { items: ref('Contribution'), type: 'array' },
        hands: { items: ref('Hand'), type: 'array' },
        notes: { items: ref('Note'), type: 'array' },
        reason: nullable({ description: 'Why the swarm is waiting, when it is.', type: 'string' }),
        why: nullable({ description: 'The reason as a code: unfunded (no money yet), money (too little payable), costly (the next call holds more than any one source can pay), rest (stopped after repeated errors), idle (its agent ended its last update with Waiting for backers; new money or a funded steer wakes it) or, while running, stuck (its last turns failed without spending anything, or the current one has made no progress for 20 minutes; it keeps retrying with its money).', enum: ['unfunded', 'money', 'costly', 'rest', 'idle', 'stuck'], type: 'string' }),
        updates: { items: ref('Brief'), type: 'array' },
        working: nullable(ref('Working')),
      }),
    ],
  },
  Page: object({
    entries: { items: ref('Entry'), type: 'array' },
    next: { description: 'Pass as after for the next page.', type: 'integer' },
  }),
  Problem: object({
    code: { enum: Object.keys(Problem.codes), type: 'string' },
    detail: string,
    status: integer,
  }),
  Update: object(
    {
      at: { ...time, description: 'When the agent posted it.' },
      base: nullable({ description: 'The head of the repository when the agent last resumed; diff the last of commits against it.', type: 'string' }),
      commits: { description: 'Commits pushed since the update before, newest first.', items: string, type: 'array' },
      done: { description: 'The agent reports the goal met.', type: 'boolean' },
      spent: { ...mach, description: 'What the swarm spent since the update before.' },
      text: { description: 'The update, markdown, without its STATUS line.', type: 'string' },
    },
    'What the agent reported when it paused to reply; the swarm then told it to keep going.',
  ),
  Working: object({ since: { ...time, description: 'When the agent last started or resumed working without a stop.' } }),
  Status: { enum: [...Operations.statuses], type: 'string' },
  Summary: object({
    answer: nullable(ref('Answer')),
    archivedAt: nullable({ ...time, description: 'When the swarm was archived: read-only, taking no rides. null: live.' }),
    form: { description: 'tree: a tree of tasks riders put dollars and ideas into, checked in Lean; agent: one long-running agent (earlier swarms).', enum: ['agent', 'tree'], type: 'string' },
    balance: { ...mach, description: "Everything riders put in, which the gateway holds as the swarm's credit: each transfer at its amount. A spending approval from before 2026-11-11, when transfers became the only way in, counts at its limit, or at what it paid once it ended." },
    contributors: integer,
    cover: nullable(object({ form: { enum: ['image', 'page'], type: 'string' }, url: { description: 'A path on this site: an image, or an HTML artifact to show in a sandboxed frame, with cover=1 in its query.', type: 'string' } }, "The swarm's preview, which it chooses by marking one artifact's manifest with cover: true. null: none yet.")),
    createdAt: time,
    goal: string,
    id: string,
    machines: integer,
    nickname: nullable({ description: 'The swarm\'s nickname, its page at /<nickname>; null: none, and its page is /s/<id>.', type: 'string' }),
    pool: { ...usd, description: "What is left of the swarm's credit at the gateway." },
    remaining: { ...mach, description: 'The balance less what the swarm spent: what it has left to spend.' },
    setup: nullable(
      object(
        {
          harness: { enum: ['claude', 'codex'], type: 'string' },
          model: string,
          most: { description: 'Micro-dollars: what the gateway holds for one uncached step of the lead model (a 50,000-token context and 1,024 output tokens), which the swarm needs to start a step.', type: 'string' },
          step: { description: 'Micro-dollars: a typical step of the lead model, one call at a 50,000-token context, mostly cached.', type: 'string' },
          steps: { additionalProperties: string, description: "Micro-dollars: a typical step of each model the subagents may use.", type: 'object' },
          subagents: nullable(object({ harnesses: { items: { enum: ['claude', 'codex'], type: 'string' }, type: 'array' }, models: { items: string, type: 'array' } })),
          template: { enum: [...Setup.templates], type: 'string' },
        },
        "The models the swarm runs on: its template, the lead's harness and model, and the harnesses and models its subagents may use (null: any). null for swarms made before setups, which run on the gateway's default.",
      ),
    ),
    spent: mach,
    status: ref('Status'),
    title: string,
    updatedAt: time,
  }),
  Room: object({
    me: nullable({ ...ref('Me'), description: 'The signed-in caller, when the request carries a session token.' }),
    members: { items: ref('Member'), type: 'array' },
    messages: { items: ref('Said'), type: 'array' },
    next: { description: 'The newest message id; pass it as after to read what comes next.', type: 'integer' },
  }),
  Me: {
    allOf: [ref('Member'), object({ member: { description: 'Whether the caller backs the swarm and may post.', type: 'boolean' } })],
  },
  Member: object(
    {
      address,
      available: { ...usd, description: 'What the backer put in that is not behind a note yet: what an @swarm message can steer with.' },
      backed: { ...usd, description: 'Everything of the backer that reached the swarm, stablecoins at par: transfers, pulls, and what their MACH keys moved into channels.' },
      handle: { description: 'The name the room shows, derived from the address.', type: 'string' },
      since: time,
      steered: { ...usd, description: 'What the backer put behind notes, with money or with @swarm.' },
      ways: { items: { enum: ['transfer', 'machine'], type: 'string' }, type: 'array' },
    },
    "A backer of the swarm, who may post in its room. A lent machine counts when its hand was issued to a signed-in caller and has connected.",
  ),
  Posted: object({ me: ref('Me'), message: ref('Said') }),
  Hall: object({
    messages: { items: ref('Said'), type: 'array' },
    names: { additionalProperties: string, description: 'The username each author posted under, by address.', type: 'object' },
    next: { description: 'The newest message id; pass it as after to read what comes next.', type: 'integer' },
  }),
  Shouted: object({ message: ref('Said'), name: string }),
  Exchange: object({ answer: string, question: string }),
  Seat: object({ address: string, handle: string, left: string, limit: nullable(string), role: string, spent: string }),
  Roster: object({ admins: { items: string, type: 'array' }, memberBudget: nullable(string), seats: { items: ref('Seat'), type: 'array' }, steering: string, team: nullable(string) }),
  Funder: object({ address: string, amount: string, handle: string }),
  Branch: object(
    {
      budget: nullable({ ...string, description: 'The most this subagent and the subagents under it may spend together, in USD; null while it shares the swarm\'s money with no budget of its own.' }),
      error: nullable({ ...string, description: 'Why it failed, when it failed for another reason than its budget.' }),
      funded: { ...string, description: 'What backers put behind it, net of what they moved away.' },
      funders: { items: ref('Funder'), type: 'array' },
      id: { ...integer, description: 'The subagent id the gateway gives it, which fund and move take.' },
      left: nullable({ ...string, description: 'Its budget less what it spent; null without a budget.' }),
      parent: nullable({ ...integer, description: 'The subagent that started it; null for a branch the agent started itself, which backers fund.' }),
      result: nullable({ ...string, description: 'What it submitted when it finished, at most 4,000 characters.' }),
      role: string,
      spent: nullable({ ...string, description: 'What it and the subagents under it spent since it got a budget; null without one.' }),
      starved: { description: 'True when it stopped because its budget was spent; funding it starts it again.', type: 'boolean' },
      state: { enum: ['pending', 'running', 'completed', 'interrupted', 'failed', 'closing', 'closed'], type: 'string' },
      task: string,
      who: { ...string, description: "The name its entries carry in the feed's who, its role, or its role and id when two share a role." },
    },
    "One of the swarm agent's subagents. A branch is one the agent started itself, with the subagents under it.",
  ),
  Branches: object({ branches: { items: ref('Branch'), type: 'array' }, steering: string }),
  Said: object(
    {
      at: time,
      author: nullable({ ...address, description: 'The backer who wrote it; null for the swarm\'s own messages about money, its agent starting and stopping, and its updates.' }),
      id: integer,
      mentions: { description: 'Backers the message mentions with @<handle>.', items: address, type: 'array' },
      steer: nullable(ref('Steer')),
      text: string,
    },
    'A message in a swarm\'s room.',
  ),
  Steer: object(
    {
      amount: { ...usd, description: "What the author put behind the idea from their backing." },
      backers: integer,
      note: { description: 'The idea: the message without @swarm.', type: 'string' },
      live: { description: 'It reached the working agent at once; otherwise the agent reads it when it resumes.', type: 'boolean' },
      noteId: string,
      share: { description: 'The note\'s weight as a share of the balance.', type: 'number' },
      weight: { ...usd, description: 'Everything behind the note now.' },
    },
    'An @swarm message: part of its author\'s backing put behind the rest of the message as a steering note.',
  ),
  Waited: object({
    changed: { type: 'boolean' },
    reason: { enum: ['updated', 'idle', 'timeout'], type: 'string' },
    swarm: ref('Summary'),
    update: nullable(ref('Update')),
    waited: { description: 'Milliseconds waited.', type: 'integer' },
    working: nullable(ref('Working')),
  }),
}

export function document(origin: string) {
  return {
    components: {
      responses: {
        Problem: {
          content: { 'application/problem+json': { schema: ref('Problem') } },
          description: Object.entries(Problem.codes)
            .map((entry) => `${entry[0]}: ${entry[1]}`)
            .join(' '),
        },
      },
      schemas,
    },
    info: {
      description: `Swarms are crowdfunded, long-running AI agents on the Tempo gateway that research or build whatever their goal asks, in public. Backers send MACH, OUSD, USDC.e or pathUSD to the gateway with a memo that names the swarm and record it by hash; the gateway holds it as the swarm's credit and spends it on the agent's work. Notes on money steer the agent, weighted by the money behind them. Each swarm's backers talk in its room, where an @swarm message puts part of its author's backing behind an idea. Reading needs no account; posting needs a Tempo ID session from /v1/auth. Errors are problem JSON with a stable code. The same operations are MCP tools at ${origin}/mcp.`,
      title: 'Swarms',
      version: '1',
    },
    openapi: '3.1.0',
    paths: {
      '/v1/config': { get: { operationId: 'config', responses: ok(ref('Config'), 'Chain and tokens.'), summary: 'Configuration' } },
      '/v1/feedback': {
        post: {
          description:
            "Files a bug report, feature request or question about Swarms with the team that runs it, as an issue of the site's feedback board, and answers its id and a link where its status and resolution show. Free; never send credentials. Problems with the gateway's own tools go to the gateway's send_feedback.",
          operationId: 'feedback',
          requestBody: { content: { 'application/json': { schema: input(Feedback.schema) } }, required: true },
          responses: { ...ok(object({ id: string, link: string }), 'The issue was filed.', '201'), ...failures(400, 404, 502) },
          summary: 'Report a problem',
        },
      },
      '/v1/me': {
        get: {
          description: 'The signed-in account, from Authorization: Bearer <token>.',
          operationId: 'getAccount',
          responses: { ...ok(ref('Account'), 'The account.'), ...failures(401) },
          summary: 'Your account',
        },
        post: {
          description:
            "Sets the account's username, which every room shows and mentions as @name, unique and stored in lower case. Names made from an address (word-1a2b) and a few others, such as swarm, are reserved. A null or empty name goes back to the one made from the address.",
          operationId: 'rename',
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.rename) } }, required: true },
          responses: { ...ok(ref('Account'), 'The account.'), ...failures(400, 401, 409) },
          summary: 'Set your username',
        },
      },
      '/v1/names/{name}': {
        get: {
          description: 'Which swarm a nickname names: the swarm that has it now, or the one that had it, with that swarm\'s nickname now (null when it dropped it).',
          operationId: 'getName',
          parameters: [parameter('name', 'path', string, 'The nickname, as in /<nickname>.')],
          responses: { ...ok(object({ name: string, nickname: nullable(string), swarm: string }), 'The swarm the name names.'), ...failures(400, 404) },
          summary: 'Look up a nickname',
        },
      },
      '/v1/search': {
        get: {
          description:
            "Full-text search over every swarm's title and goal, its agent's updates and its notes, best first. Hits match any of the words. With swarm set, also searches that swarm's feed.",
          operationId: 'search',
          parameters: [
            parameter('q', 'query', string, 'Keywords.'),
            parameter('swarm', 'query', string, 'Only this swarm, including its feed.'),
            parameter('kind', 'query', { enum: [...Operations.sources], type: 'string' }, 'Only hits of this kind.'),
            parameter('limit', 'query', { default: 10, maximum: 50, minimum: 1, type: 'integer' }, 'Indexed hits, and as many feed hits.'),
          ],
          responses: { ...ok(ref('Found'), 'Hits.'), ...failures(400, 404) },
          summary: 'Search',
        },
      },
      '/v1/swarms': {
        get: {
          description: 'Funded swarms, most recently active first, at most 100.',
          operationId: 'listSwarms',
          parameters: [parameter('status', 'query', ref('Status'), 'Only swarms with this status.')],
          responses: {
            ...ok(
              object({
                funders: { additionalProperties: { items: funder, type: 'array' }, description: "Each listed swarm's top three riders by what they put in, by swarm id.", type: 'object' },
                heads: { additionalProperties: headline, description: "Each open tree swarm's headline counts, as its tree read gives them, by swarm id. A swarm whose tree did not answer in time is left out.", type: 'object' },
                riders: { ...integer, description: 'How many different people rode any swarm.' },
                swarms: { items: ref('Summary'), type: 'array' },
              }),
              'Swarms.',
            ),
            ...failures(400),
          },
          summary: 'List swarms',
        },
        post: {
          description: 'A new swarm waits in funding until someone sends it money. Signed in, it starts on steering team: only you and the people you add steer it, and every other backer funds it and chats, unless you send steering open.',
          operationId: 'createSwarm',
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.create) } }, required: true },
          responses: { ...ok(ref('Summary'), 'The swarm.', '201'), ...failures(400, 409, 502, 503) },
          summary: 'Create a swarm',
        },
      },
      '/v1/swarms/{id}': {
        patch: {
          description: "As one of the swarm's admins or the operator (signed in, or with the operator's gateway key as the bearer token): set the swarm's nickname, which makes its page /<nickname>; /s/<id> then sends its visitors there. A new nickname frees the old one, which keeps sending its visitors to the new page until another swarm takes it. null drops the nickname. 409 when another swarm has it.",
          operationId: 'nameSwarm',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.nickname.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Summary'), 'The swarm with its nickname.'), ...failures(400, 401, 403, 404, 409, 410, 502) },
          summary: 'Name a swarm',
        },
        get: {
          operationId: 'getSwarm',
          parameters: [swarm],
          responses: { ...ok(ref('Overview'), 'The swarm with its notes, transfers, machines and updates.'), ...failures(404) },
          summary: 'Get a swarm',
        },
      },
      '/v1/swarms/{id}/answer': {
        get: {
          operationId: 'getAnswer',
          parameters: [swarm],
          responses: { ...ok(ref('Answered'), 'The latest answer and whether the agent is working.'), ...failures(404) },
          summary: 'Latest answer',
        },
      },
      '/v1/swarms/{id}/feed': {
        get: {
          description: "The swarm's transcript, oldest first, 200 entries a page at most.",
          operationId: 'getFeed',
          parameters: [
            swarm,
            parameter('after', 'query', { default: 0, minimum: 0, type: 'integer' }, 'Entries after this seq.'),
            parameter('before', 'query', { minimum: 1, type: 'integer' }, 'The newest entries before this seq instead.'),
            parameter('who', 'query', string, "Only one speaker: agent, or a subagent's name."),
            parameter('kind', 'query', { enum: [...Operations.kinds], type: 'string' }, 'Only entries of this kind.'),
            parameter('limit', 'query', { default: 200, maximum: 200, minimum: 1, type: 'integer' }, 'Entries at most.'),
          ],
          responses: { ...ok(ref('Page'), 'A page of entries.'), ...failures(400, 404) },
          summary: 'Feed',
        },
      },
      '/v1/swarms/{id}/live': {
        get: {
          description:
            "Server-sent events while the agent works: {type: start, at}, then text, thinking and tool-input deltas of the agent and its subagents ({type: delta, who, channel: text|thinking|input, item, delta, offset}; who is null for the agent), each transcript entry as it happens ({type: entry, entry}, seq 0 until stored), and {type: end} when the agent pauses to post an update; reconnect, as it usually keeps going. {type: idle} when it is not working.",
          operationId: 'live',
          parameters: [swarm],
          responses: {
            '200': { content: { 'text/event-stream': { schema: string } }, description: 'An event stream.' },
            ...failures(404),
          },
          summary: 'Live stream',
        },
      },
      '/v1/swarms/{id}/contributions': {
        post: {
          description:
            'Counts money sent to the swarm: the hash of a transferWithMemo of MACH, OUSD, USDC.e or pathUSD to the gateway (config.credit.recipient) whose memo is the first 16 bytes of keccak256("gateway:credit:4217:<config.credit.owner>:swarm-<id>") followed by the first 16 bytes of keccak256("swarm:<id>"), or of keccak256("note:<id>:<note>") to put it behind a note. The gateway credits it to the swarm once, and every token counts at $1. A note counts only when the memo commits to it; a counted transfer without a note can get one later, while its money is behind nothing else. 201 when counted, 200 when a note was added, 404 while Tempo has no receipt yet, 409 when it was already counted.',
          operationId: 'contribute',
          parameters: [swarm],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.contribution.omit({ swarm: true })) } },
            required: true,
          },
          responses: {
            ...ok(ref('Contributed'), 'The note was added to a counted transfer.'),
            ...ok(ref('Contributed'), 'The transfer was counted.', '201'),
            ...failures(400, 404, 409, 429, 502, 503),
          },
          summary: 'Count money sent',
        },
      },
      '/v1/swarms/{id}/tree': {
        get: {
          description: 'A tree swarm: its headline (proven, frontier, in flight, dead ends, spent and cost per proof, with no growing denominator) and its nodes from root down to depth, each with its status (derived from its tasks, never stored), money, riders, run in flight and checked proof.',
          operationId: 'tree',
          parameters: [swarm, ...queried(Operations.schema.tree, ['root', 'depth', 'status'])],
          responses: { ...ok(ref('TreeView'), 'The headline and the nodes.'), ...failures(400, 404) },
          summary: 'Tree',
        },
      },
      '/v1/swarms/{id}/nodes': {
        post: {
          description: 'Signed in: propose a node under parent. Answers its id and a prepared transfer; the node is posted when a ride of at least $1 naming it is counted (POST contributions with node). The same title under the same parent is the same node.',
          operationId: 'propose',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.propose.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Proposed'), 'The node id and the transfer that makes it a node.', '201'), ...failures(400, 401, 404, 409, 410, 502) },
          summary: 'Propose a node',
        },
      },
      '/v1/swarms/{id}/nodes/{nid}': {
        get: { description: 'One node in full: words, Lean statement, status and why, checked record, every rider, runs, steers and suggestions.', operationId: 'node', parameters: [swarm, parameter('nid', 'path', string, 'The node id: root, triage or 10 hex characters.')], responses: { ...ok(ref('NodeView'), 'The node.'), ...failures(400, 404) }, summary: 'Node' },
      },
      '/v1/swarms/{id}/nodes/{nid}/updates': {
        get: { description: "A node's deltas after a seq, oldest first; the room socket and /live carry the same.", operationId: 'nodeUpdates', parameters: [swarm, parameter('nid', 'path', string, 'The node id: root, triage or 10 hex characters.'), ...queried(Operations.schema.nodeUpdates, ['after', 'limit'])], responses: { ...ok(ref('NodeUpdates'), 'The deltas and the seq to ask after next.'), ...failures(400, 404) }, summary: 'Node updates' },
      },
      '/v1/swarms/{id}/nodes/{nid}/steer': {
        post: {
          description: "Signed in, as a rider with money on the node: a note with the money behind it. amount first moves that much of your free money in the swarm onto the node. With a run in flight the note reaches its subagent at once; otherwise the next run reads it.",
          operationId: 'steerNode',
          parameters: [swarm, parameter('nid', 'path', string, 'The node id: root, triage or 10 hex characters.')],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.nodeSteer.omit({ node: true, swarm: true })) } }, required: true },
          responses: { ...ok(ref('TreeNode'), 'The node.'), ...failures(400, 401, 403, 404, 409, 410) },
          summary: 'Steer a node',
        },
      },
      '/v1/swarms/{id}/nodes/{nid}/move': {
        post: {
          description: 'Signed in: move your own uncommitted money from this node (or "" for your free money) to another node or to "".',
          operationId: 'moveMoney',
          parameters: [swarm, parameter('nid', 'path', string, 'Where the money is now: a node id.')],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.nodeMove.omit({ node: true, swarm: true })) } }, required: true },
          responses: { ...ok(nullable(ref('TreeNode')), 'The node the money went to.'), ...failures(400, 401, 404, 409, 410) },
          summary: 'Move money between nodes',
        },
      },
      '/v1/swarms/{id}/nodes/{nid}/end': {
        post: {
          description: "Signed in, holding more than half of what riders put on the node, or as an admin: end it as withdrawn. Its open children end with it, its runs stop and settle, and its money goes back the way it came: granted money to the parent, riders' own to their free money.",
          operationId: 'endNode',
          parameters: [swarm, parameter('nid', 'path', string, 'The node id: root, triage or 10 hex characters.')],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.nodeEnd.omit({ node: true, swarm: true })) } }, required: true },
          responses: { ...ok(ref('TreeNode'), 'The ended node.'), ...failures(400, 401, 403, 404, 409, 410) },
          summary: 'End a node',
        },
      },
      '/v1/swarms/{id}/nodes/{nid}/review': {
        post: { description: "As an admin of the swarm: sign off a seeded node's Lean statement, so the page stops showing it as under review.", operationId: 'reviewNode', parameters: [swarm, parameter('nid', 'path', string, 'The node id.')], responses: { ...ok(object({ reviewed: { type: 'boolean' } }), 'Signed off.'), ...failures(401, 403, 404, 410) }, summary: 'Sign off a statement' },
      },
      '/v1/swarms/{id}/ideas': {
        post: {
          description: 'Signed in: a suggestion without money, at most 5 a day. Triage may adopt it as a node credited to you.',
          operationId: 'suggest',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.suggest.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Suggested'), 'The suggestion id.', '201'), ...failures(400, 401, 404, 409, 410, 429) },
          summary: 'Suggest an idea',
        },
      },
      '/v1/swarms/{id}/transfer': {
        post: {
          description: 'Prepare a ride: the transfer to send and its memo. On a tree swarm node names the node to ride (default the root, the whole swarm).',
          operationId: 'transfer',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.transfer.omit({ hash: true, swarm: true })) } }, required: true },
          responses: { ...ok(ref('Prepared'), 'The transfer.'), ...failures(400, 404, 410, 502) },
          summary: 'Prepare a ride',
        },
      },
      '/v1/swarms/{id}/proofs': {
        get: { description: 'Every Lean-checked proof, newest first, each with its node and Check.', operationId: 'proofs', parameters: [swarm], responses: { ...ok(ref('Proofs'), 'The proofs.'), ...failures(404) }, summary: 'Proofs' },
      },
      '/v1/swarms/{id}/triage': {
        post: {
          description: "As an admin of the swarm: one triage action by hand (approve, adopt, merge, reject, grant or restate), bounded as the triage node's are.",
          operationId: 'triage',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.triage.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(object({ applied: { items: object({ action: { type: 'object' }, ok: { type: 'boolean' }, why: string }), type: 'array' } }), 'What was applied.'), ...failures(400, 401, 403, 404, 410) },
          summary: 'Triage by hand',
        },
      },
      '/v1/swarms/{id}/archive': {
        post: { description: "The operator only (signed in as the operator's wallet, or with the operator's gateway key as the bearer token): archive a swarm. Its running work stops, open branches settle, it takes no rides (410) and its pages stay read-only. Money left stays in its gateway credit.", operationId: 'archive', parameters: [swarm], responses: { ...ok(ref('Summary'), 'The archived swarm.'), ...failures(401, 403, 404, 502) }, summary: 'Archive a swarm' },
      },
      '/v1/swarms/{id}/ledger': {
        get: { description: "A tree swarm's books: everything riders put in, what runs spent, what the buckets hold, live spend of runs in flight, the gateway credit and the drift between them (ok within one metered call).", operationId: 'ledger', parameters: [swarm], responses: { ...ok(object({ drift: dollars, gateway: nullable(object({ deposited: string, left: string, spent: string })), held: dollars, live: dollars, ok: { type: 'boolean' }, pledged: dollars, spent: dollars, swarm: string }), 'The books.'), ...failures(404) }, summary: 'Ledger' },
      },
      '/v1/riders/{who}': {
        get: { description: "A rider's profile, by username or 0x address: every swarm they rode or started with the dollars they put in, the board items they created or rode with their dollars, and the total.", operationId: 'rider', parameters: [parameter('who', 'path', string, 'A username, with or without @, or a 0x address.')], responses: { ...ok(object({ items: { items: object({ created: { type: 'boolean' }, node: string, ridden: dollars, status: string, swarm: string, title: string }), type: 'array' }, rider: { type: 'object' }, ridden: dollars, swarms: { items: object({ balance: dollars, form: string, id: string, nickname: nullable(string), ridden: dollars, riders: integer, since: integer, started: { type: 'boolean' }, title: string }), type: 'array' } }), 'The profile.'), ...failures(404) }, summary: 'A rider' },
      },
      '/v1/me/swarms/{id}': {
        get: { description: "Signed in: your money in a tree swarm: each node's share that is yours, your free money (yours to move), what your rides spent and what is refundable.", operationId: 'standing', parameters: [swarm], responses: { ...ok(ref('Standing'), 'Your standing.'), ...failures(401, 404) }, summary: 'Your standing' },
      },
      '/v1/hooks/github': {
        post: { description: "The verifier's GitHub workflow_run webhook (signature checked).", operationId: 'verified', responses: ok(object({ counted: { type: 'boolean' } }), 'Whether it was a check of ours.'), summary: 'Verifier webhook' },
      },
      '/v1/health': {
        get: {
          description: 'Whether every swarm with money is able to spend it: refused lists the swarms that are paused though they hold at least one step of money, which means their payments are being refused. ok is false while there is one.',
          operationId: 'health',
          responses: { ...ok({ type: 'object' }, 'The health of the swarms.') },
          summary: 'Health',
        },
      },
      '/v1/problems': {
        get: { description: 'The curated idea bank: every problem with its brief, whether it is open, and the swarm working on it if any.', operationId: 'listProblems', responses: { ...ok({ type: 'object' }, 'The problems.') }, summary: 'Idea bank' },
      },
      '/v1/swarms/{id}/machines': {
        get: { description: "Every machine the swarm used over its whole life: sandboxes with their settings and sandbox ids, browsers and lent hands with price and payout, each with its state and how many commands ran on it (runs). The commands are listed by /machines/{machine}/commands.", operationId: 'listMachines', parameters: [swarm], responses: { ...ok({ type: 'object' }, 'The machines.'), ...failures(404) }, summary: 'Machines' },
      },
      '/v1/swarms/{id}/machines/{machine}/commands': {
        get: {
          description: "Every command that ran on one machine over the swarm's whole life, without their outputs: seq, at, who, text, exit, failed, ms (duration, when known), clipped (the feed kept only the start of its output) and log (a compute_spawn's log path).",
          operationId: 'listMachineCommands',
          parameters: [swarm, machine, ...queried(Machines.schema.commands, ['cursor', 'limit', 'order'])],
          responses: { ...ok(object({ commands: { items: { type: 'object' }, type: 'array' }, machine: string, next: nullable(integer), order: string, total: integer }), 'A page of commands; next is the cursor of the page after it.'), ...failures(400, 404) },
          summary: 'Machine commands',
        },
      },
      '/v1/swarms/{id}/machines/{machine}/commands/{seq}': {
        get: {
          description: "One command with its whole output: the gateway's copy of the tool result when the agent's session still has it (source gateway), else the feed's first 2,000 characters (source feed, truncated true when cut).",
          operationId: 'getMachineCommand',
          parameters: [swarm, machine, parameter('seq', 'path', integer, "The command's seq.")],
          responses: { ...ok({ type: 'object' }, 'The command and its output.'), ...failures(400, 404) },
          summary: 'Machine command',
        },
      },
      '/v1/swarms/{id}/machines/{machine}/commands/{seq}/log': {
        get: {
          description: "The log of a job started with compute_spawn, read from the sandbox through the gateway's compute/logs while it runs and kept by Swarms; exit once it finished.",
          operationId: 'getMachineJob',
          parameters: [swarm, machine, parameter('seq', 'path', integer, 'The compute_spawn command\'s seq.')],
          responses: { ...ok({ type: 'object' }, 'The job log.'), ...failures(400, 404) },
          summary: 'Spawned job log',
        },
      },
      '/v1/swarms/{id}/machines/{machine}/logs': {
        get: {
          description: "A sandbox's own log (system, stdout and stderr) from the gateway's compute/output, which keeps it up to 7 days after the sandbox ended; Swarms keeps what it fetched, asks again at most every 30 s while the sandbox may still log, and never once complete is true. Lines oldest first.",
          operationId: 'getMachineLogs',
          parameters: [swarm, machine, ...queried(Machines.schema.logs, ['before', 'limit', 'sandbox', 'stream'])],
          responses: { ...ok({ type: 'object' }, 'Log lines.'), ...failures(400, 404) },
          summary: 'Sandbox log',
        },
      },
      '/v1/swarms/{id}/machines/export': {
        get: {
          description: 'Everything about every machine of the swarm as one NDJSON file: an export line, then for each machine its machine line, every command with its whole output, each sandbox\'s logs and log lines, and each spawned job\'s log, and an end line.',
          operationId: 'exportMachines',
          parameters: [swarm],
          responses: { '200': { content: { 'application/x-ndjson': { schema: string } }, description: 'The NDJSON file.' }, ...failures(404) },
          summary: 'Export machines',
        },
      },
      '/v1/swarms/{id}/machines/{machine}/export': {
        get: {
          description: 'Everything about one machine as one NDJSON file, as /machines/export writes it.',
          operationId: 'exportMachine',
          parameters: [swarm, machine],
          responses: { '200': { content: { 'application/x-ndjson': { schema: string } }, description: 'The NDJSON file.' }, ...failures(404) },
          summary: 'Export a machine',
        },
      },
      '/v1/swarms/{id}/backers': {
        get: { description: 'The ideas ranked by the money behind them, and every backer with what they put in and how.', operationId: 'listBackers', parameters: [swarm], responses: { ...ok({ type: 'object' }, 'Ideas and backers.'), ...failures(404) }, summary: 'Ideas and backers' },
      },
      '/v1/swarms/{id}/progress': {
        get: {
          description: "The swarm's progress toward a goal that comes down to one number, read from its autoresearch artifact (data.json and main.tsv): the metric, whether higher or lower is better, the goal, main's history (each change to main with the metric after it, merges naming the branch they took) and every branch with what it explored, its state and what it found. null when the swarm keeps no such record.",
          operationId: 'getProgress',
          parameters: [swarm],
          responses: { ...ok(object({ progress: { type: ['object', 'null'] } }), 'The progress.'), ...failures(404) },
          summary: 'Progress',
        },
      },
      '/v1/swarms/{id}/artifacts': {
        get: {
          description: "The dashboards, charts, tables and write-ups the swarm's agents published, from the public manifests under artifacts/ in the swarm's gateway kv. Load each from its url.",
          operationId: 'listArtifacts',
          parameters: [swarm],
          responses: { ...ok(object({ artifacts: { items: ref('Artifact'), type: 'array' } }), 'The artifacts.'), ...failures(404, 502) },
          summary: 'Artifacts',
        },
      },
      '/v1/general/chat': {
        get: {
          description: "#general, the site's own room: its newest messages (or those after or before an id) and the username each author posted under.",
          operationId: 'getGeneral',
          parameters: [
            parameter('after', 'query', { default: 0, minimum: 0, type: 'integer' }, 'Messages after this id; 0 returns the newest.'),
            parameter('before', 'query', { minimum: 1, type: 'integer' }, 'Messages before this id.'),
            parameter('limit', 'query', { default: 100, maximum: 200, minimum: 1, type: 'integer' }, 'Messages at most.'),
          ],
          responses: { ...ok(ref('Hall'), 'The room.'), ...failures(400) },
          summary: 'Read #general',
        },
        post: {
          description: 'Posts to #general as the signed-in rider (Authorization: Bearer <token> from /v1/auth), under their username. Anyone with a username posts; at most 10 messages a minute.',
          operationId: 'postGeneral',
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.shout) } }, required: true },
          responses: { ...ok(ref('Shouted'), 'The message and the name it went out under.', '201'), ...failures(400, 401, 403, 429) },
          summary: 'Post to #general',
        },
      },
      '/v1/general/chat/live': {
        get: {
          description: 'A WebSocket. The server sends {type: welcome} on connect and {type: said, message, name} for every new message in #general. Send the text ping to get pong.',
          operationId: 'generalLive',
          responses: { '101': { description: 'Switching to the WebSocket.' }, ...failures(400) },
          summary: '#general live',
        },
      },
      '/v1/swarms/{id}/chat': {
        get: {
          description: "The swarm's room: its newest messages (or those after or before an id), its members, and with a session token the caller's standing.",
          operationId: 'getChat',
          parameters: [
            swarm,
            parameter('after', 'query', { default: 0, minimum: 0, type: 'integer' }, 'Messages after this id; 0 returns the newest.'),
            parameter('before', 'query', { minimum: 1, type: 'integer' }, 'Messages before this id.'),
            parameter('limit', 'query', { default: 100, maximum: 200, minimum: 1, type: 'integer' }, 'Messages at most.'),
          ],
          responses: { ...ok(ref('Room'), 'The room.'), ...failures(400, 404) },
          summary: 'Read the room',
        },
        post: {
          description: `Posts to the room as the signed-in backer: send Authorization: Bearer <token> from /v1/auth. @<handle> mentions a backer. A message with @swarm steers the swarm: steer is how much of the author's backing not yet behind a note goes behind the rest of the message as a note, which weighs like any other note and reaches the agent at once when it is working.`,
          operationId: 'postChat',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.say.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Posted'), 'The message and the author\'s standing after it.', '201'), ...failures(400, 401, 403, 404, 409, 429, 502) },
          summary: 'Post to the room',
        },
      },
      '/v1/swarms/{id}/team': {
        get: {
          description:
            "Who steers the swarm. steering open: any backer steers with their own money, as @swarm in the room. steering team: only its team (seats) steers it, with the swarm's money, each within their budget (limit, USD per 30 days; null is no limit), and only they ask it side questions; anyone else still funds it and talks in its room, and a note on their money is not kept. The team starts as whoever started it signed in, or else whoever sent its first ride; the people they add are members of the swarm's gateway team (tempoxyz/gateway Teams), created when the first one is added. admins choose.",
          operationId: 'getTeam',
          parameters: [swarm],
          responses: { ...ok(ref('Roster'), "The swarm's steering policy and team."), ...failures(404, 502) },
          summary: 'Who steers',
        },
        post: {
          description: "As a signed-in admin, sets steering to open or team and the team's default member budget. Setting a budget, or steering team on a swarm nobody started signed in, creates the swarm's gateway team with the caller as its admin.",
          operationId: 'setSteering',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.steering.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Roster'), 'The roster after the change.'), ...failures(400, 401, 403, 404, 409, 502) },
          summary: 'Choose who steers',
        },
      },
      '/v1/swarms/{id}/team/members': {
        post: {
          description: "As a signed-in admin, adds a wallet or username to the swarm's team, as a member who steers or an admin who also manages, with an optional budget of the swarm's money per 30 days; adding it again changes its role and budget. The first one creates the swarm's gateway team.",
          operationId: 'addSteerer',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.seat.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Roster'), 'The roster after the change.', '201'), ...failures(400, 401, 403, 404, 409, 502) },
          summary: 'Add a steerer',
        },
      },
      '/v1/swarms/{id}/team/members/{member}': {
        delete: {
          description: "Removes a wallet from the swarm's team: an admin removes anyone, a member leaves. The last admin stays.",
          operationId: 'removeSteerer',
          parameters: [swarm, parameter('member', 'path', string, 'The wallet to remove.')],
          responses: { ...ok(ref('Roster'), 'The roster after the change.'), ...failures(400, 401, 403, 404, 409, 502) },
          summary: 'Remove a steerer',
        },
      },
      '/v1/swarms/{id}/btw': {
        post: {
          description:
            "Asks the swarm's agent a side question as the signed-in backer (Authorization: Bearer <token> from /v1/auth): the gateway answers it from the agent's own conversation, without tools and without interrupting or steering the running turn, as the nanocode CLI's /btw does. Send the thread's earlier questions and answers as thread, oldest first, to keep a side conversation. The answer is paid from the swarm's money, so the asker needs at least $0.01 of their own behind the swarm (or a seat on its team); a backer asks at most 20 an hour, a swarm answers at most 120 an hour from everyone, and thread is at most 32 KiB. Answers have credentials redacted. To steer the agent with the thread, post @swarm Collapsed /btw: <the first question> to the room with btw set to the thread and steer to the money behind it.",
          operationId: 'askBtw',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.btw.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Exchange'), 'The question and its answer.'), ...failures(400, 401, 403, 404, 409, 429, 502) },
          summary: 'Ask a side question',
        },
      },
      '/v1/swarms/{id}/branches': {
        get: {
          description:
            "The swarm agent's subagents, as the gateway runs them: each with its role, task, state, budget (the most it and the subagents under it may spend together), what it spent since it got one, and what backers put behind it and who. A branch is a subagent the agent started itself (parent null); backers fund branches and move their money between them.",
          operationId: 'listBranches',
          parameters: [swarm],
          responses: { ...ok(ref('Branches'), 'Every subagent, branches first in the order the agent started them.'), ...failures(404, 502) },
          summary: 'Branches',
        },
      },
      '/v1/swarms/{id}/branches/{branch}/fund': {
        post: {
          description:
            "As a signed-in backer with a username (Authorization: Bearer <token> from /v1/auth), puts some of your backing not yet behind a note or branch behind one branch, or, when only the swarm's team steers it, some of the swarm's money within your team budget. The branch's budget becomes what it had when first funded (nothing for one that had no budget of its own) plus everything put behind it, and the gateway refuses its paid requests past it; a branch its budget had stopped starts again. With message, it also steers the branch: the message reaches the subagent at once, saying how much is behind it. To put new money behind a branch, fund the swarm first.",
          operationId: 'fundBranch',
          parameters: [swarm, parameter('branch', 'path', integer, 'The branch id from listBranches.')],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.fund.omit({ branch: true, swarm: true })) } }, required: true },
          responses: { ...ok(ref('Branch'), 'The branch with its new budget.'), ...failures(400, 401, 403, 404, 409, 502) },
          summary: 'Fund or steer a branch',
        },
      },
      '/v1/swarms/{id}/branches/{branch}/move': {
        post: {
          description:
            "As a signed-in backer, moves money you put behind one branch, which it has not spent, behind another: the first branch's budget falls and the other's rises by amount.",
          operationId: 'moveFunding',
          parameters: [swarm, parameter('branch', 'path', integer, 'The branch to take the money from.')],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.move.omit({ branch: true, swarm: true })) } }, required: true },
          responses: { ...ok({ items: ref('Branch'), type: 'array' }, 'Both branches after the move, the one it left first.'), ...failures(400, 401, 403, 404, 409, 502) },
          summary: 'Move funding between branches',
        },
      },
      '/v1/swarms/{id}/branches/{branch}/stop': {
        post: {
          description:
            "As the signed-in backer who holds more than half of the money behind the branch, or an admin of the swarm, stops a branch: its subagent closes, and what backers put behind it that it had not spent goes back to their available backing, in proportion to what each put in.",
          operationId: 'stopBranch',
          parameters: [swarm, parameter('branch', 'path', integer, 'The branch to stop.')],
          responses: { ...ok(ref('Branch'), 'The stopped branch.'), ...failures(401, 403, 404, 409, 502) },
          summary: 'Stop a branch',
        },
      },
      '/v1/swarms/{id}/chat/live': {
        get: {
          description:
            'A WebSocket. The server sends {type: said, message} for every new message, {type: presence, online, watching} as people come and go, and {type: typing, address}. Send {type: hello, token} to be counted online as the session\'s backer, {type: typing} while writing, and the text ping to get pong.',
          operationId: 'chatLive',
          parameters: [swarm],
          responses: { '101': { description: 'Switching to the WebSocket.' }, ...failures(400, 404) },
          summary: 'Room live',
        },
      },
      '/v1/auth/challenge': {
        post: {
          description:
            "Sign-in with Tempo ID (accounts' siwe plugin): a SIWE message for the signer's Tempo account, valid once for 10 minutes, and the id that /v1/auth takes with its signature. The page signs it in Tempo ID's dialog (dialog.signMessage). A script signs it with the account's own key; an access key's signature is refused. A request with an Origin header must come from the site's origin.",
          operationId: 'authChallenge',
          responses: { ...ok(object({ id: string, message: string }), 'The message to sign and its id.'), ...failures(401) },
          summary: 'Sign-in challenge',
        },
      },
      '/v1/auth': {
        post: {
          description: `Verifies the signed challenge and answers a session token for Authorization: Bearer, valid for ${Sessions.days} days.`,
          operationId: 'authVerify',
          requestBody: {
            content: { 'application/json': { schema: object({ address, id: string, message: string, signature: string }) } },
            required: true,
          },
          responses: { ...ok(object({ token: string }), 'The session token.'), ...failures(400, 401, 502) },
          summary: 'Sign in',
        },
      },
      '/v1/swarms/{id}/hands': {
        get: {
          operationId: 'listHands',
          parameters: [swarm],
          responses: { ...ok(object({ hands: { items: ref('Lent'), type: 'array' } }), 'Hands issued for contributor machines, newest first.'), ...failures(404) },
          summary: 'List contributor hands',
        },
        post: {
          description:
            "Issues a hand for a contributor's own machine: a unique name under the swarm's gateway app, with the nanocode CLI command and a nanocode-ts snippet that attach it. The swarm's agent and its subagents use connected hands, and are told they belong to contributors. With a session token from /v1/auth, the caller joins the swarm's room as a backer.",
          operationId: 'issueHand',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.hand.omit({ swarm: true })) } } },
          responses: { ...ok(ref('Issued'), 'The hand.', '201'), ...failures(400, 404, 409, 502) },
          summary: 'Issue a hand',
        },
      },
      '/v1/swarms/{id}/updates': {
        get: {
          description: "The agent's updates in full, oldest first: what it reported each time it paused to reply.",
          operationId: 'listUpdates',
          parameters: [swarm, parameter('limit', 'query', { default: 50, maximum: 200, minimum: 1, type: 'integer' }, 'The newest this many.')],
          responses: { ...ok(object({ updates: { items: ref('Update'), type: 'array' }, working: nullable(ref('Working')) }), 'The updates.'), ...failures(400, 404) },
          summary: 'Updates',
        },
      },
      '/v1/swarms/{id}/search': {
        get: {
          operationId: 'searchSwarm',
          parameters: [
            swarm,
            parameter('q', 'query', string, 'Keywords.'),
            parameter('kind', 'query', { enum: [...Operations.sources], type: 'string' }, 'Only hits of this kind.'),
            parameter('limit', 'query', { default: 10, maximum: 50, minimum: 1, type: 'integer' }, 'Indexed hits, and as many feed hits.'),
          ],
          responses: { ...ok(ref('Found'), 'Hits in this swarm, its feed included.'), ...failures(400, 404) },
          summary: 'Search a swarm',
        },
      },
      '/v1/swarms/{id}/wait': {
        get: {
          description: `Long poll: answers once the agent posts an update newer than after, at once when it is not working, or after timeout seconds (at most ${Operations.maxWait}).`,
          operationId: 'wait',
          parameters: [
            swarm,
            parameter('after', 'query', { minimum: 0, type: 'integer' }, "An update's at (Unix ms); defaults to the newest update."),
            parameter('timeout', 'query', { default: 45, maximum: Operations.maxWait, minimum: 0, type: 'integer' }, 'Seconds.'),
          ],
          responses: { ...ok(ref('Waited'), 'The new update, or why none came.'), ...failures(400, 404) },
          summary: 'Wait for the next update',
        },
      },
    },
    servers: [{ url: origin }],
  }
}
