import { z } from 'zod'
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

const schemas = {
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
    auth: { description: "Where to sign in with Tempo Wallet: wallet_connect's capabilities.auth url.", type: 'string' },
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
        code: nullable(ref('Code')),
        contributions: { items: ref('Contribution'), type: 'array' },
        hands: { items: ref('Hand'), type: 'array' },
        notes: { items: ref('Note'), type: 'array' },
        reason: nullable({ description: 'Why the swarm is waiting, when it is.', type: 'string' }),
        why: nullable({ description: 'The reason as a code: unfunded (no money yet), money (too little payable), costly (the next call holds more than any one source can pay), rest (stopped after repeated errors) or idle (its agent ended its last update with Waiting for backers; new money or a funded steer wakes it).', enum: ['unfunded', 'money', 'costly', 'rest', 'idle'], type: 'string' }),
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
    balance: { ...mach, description: 'Everything backers put in, which the gateway can pull to pay for the swarm: each transfer at its amount and each approved backing at its limit, or at what it paid once it ended.' },
    contributors: integer,
    cover: nullable(object({ form: { enum: ['image', 'page'], type: 'string' }, url: { description: 'A path on this site: an image, or an HTML artifact to show in a sandboxed frame, with cover=1 in its query.', type: 'string' } }, "The swarm's preview, which it chooses by marking one artifact's manifest with cover: true. null: none yet.")),
    createdAt: time,
    goal: string,
    id: string,
    machines: integer,
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
          template: { enum: ['cheap', 'frontier-mix', 'frontier-anthropic', 'frontier-openai', 'free', 'custom'], type: 'string' },
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
  Exchange: object({ answer: string, question: string }),
  Seat: object({ address: string, handle: string, left: nullable(string), limit: nullable(string), role: string, spent: string }),
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
      description: `Swarms are crowdfunded, long-running AI agents on the Tempo gateway that research or build whatever their goal asks, in public. Backers send MACH, OUSD, USDC.e or pathUSD to the gateway with a memo that names the swarm and record it by hash; the gateway holds it as the swarm's credit and spends it on the agent's work. Notes on money steer the agent, weighted by the money behind them. Each swarm's backers talk in its room, where an @swarm message puts part of its author's backing behind an idea. Reading needs no account; posting needs a Tempo Wallet session from /v1/auth. Errors are problem JSON with a stable code. The same operations are MCP tools at ${origin}/mcp.`,
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
          responses: { ...ok(object({ swarms: { items: ref('Summary'), type: 'array' } }), 'Swarms.'), ...failures(400) },
          summary: 'List swarms',
        },
        post: {
          description: 'A new swarm waits in funding until someone sends it money.',
          operationId: 'createSwarm',
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.create) } }, required: true },
          responses: { ...ok(ref('Summary'), 'The swarm.', '201'), ...failures(400, 502, 503) },
          summary: 'Create a swarm',
        },
      },
      '/v1/swarms/{id}': {
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
      '/v1/swarms/{id}/backings': {
        post: {
          description:
            "Prepares a backing in MACH: a spending key of the gateway's for the wallet to approve, limited to amount, that may only open and fund payment channels. Nothing moves when it is approved; the swarm's agent is paid from the wallet as it works, model calls from the wallet to the model's provider and everything else over the key's channel with the gateway. Answers id and authorizeAccessKey, which Tempo Wallet approves with wallet_connect and capabilities.authorizeAccessKey. The approval is posted to /v1/swarms/{id}/backings/{request} within 30 minutes.",
          operationId: 'prepareBacking',
          parameters: [swarm],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.backing.omit({ swarm: true })) } },
            required: true,
          },
          responses: {
            ...ok(object({ amount: string, authorizeAccessKey: { type: 'object' }, expiresAt: integer, id: string, note: nullable(string), swarm: string }), 'The key to approve.'),
            ...failures(400, 404, 429, 502),
          },
          summary: 'Prepare a backing',
        },
      },
      '/v1/swarms/{id}/backings/{request}': {
        post: {
          description:
            "Counts an approved backing: the wallet's key authorization for the prepared key, or a transaction signed by one of the wallet's admin keys for a fee payer that carries it. The contribution counts at the approved limit; when the key ends it is lowered to what the key paid. A note counts only when it is the note the backing was prepared with.",
          operationId: 'countBacking',
          parameters: [swarm, { in: 'path', name: 'request', required: true, schema: { pattern: '^[0-9a-f]{32}$', type: 'string' } }],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.approved.omit({ request: true, swarm: true })) } },
            required: true,
          },
          responses: {
            ...ok(ref('Contributed'), 'The backing was counted.', '201'),
            ...failures(400, 404, 429, 502),
          },
          summary: 'Count an approved backing',
        },
      },
      '/v1/swarms/{id}/contributions': {
        post: {
          description:
            'Counts money sent to the swarm: the hash of a transferWithMemo of MACH, OUSD, USDC.e or pathUSD to the gateway (config.credit.recipient) whose memo is the first 16 bytes of keccak256("gateway:credit:4217:<config.credit.owner>:swarm-<id>") followed by the first 16 bytes of keccak256("swarm:<id>"), or of keccak256("note:<id>:<note>") to put it behind a note. The gateway credits it to the swarm once, and every token counts at $1. A note counts only when the memo commits to it; a counted transfer without a note can get one later. 201 when counted, 200 when a note was added, 404 while Tempo has no receipt yet, 409 when it was already counted.',
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
          responses: { ...ok(ref('Posted'), 'The message and the author\'s standing after it.', '201'), ...failures(400, 401, 403, 404, 409) },
          summary: 'Post to the room',
        },
      },
      '/v1/swarms/{id}/team': {
        get: {
          description:
            "Who steers the swarm. steering open: any backer steers with their own money, as @swarm in the room. steering team: only the members of the swarm's gateway team (tempoxyz/gateway Teams) steer it, with the swarm's money, each within their budget (limit, USD per 30 days; null is no limit), and only they ask it side questions; anyone still funds it and talks in its room. admins choose; until the swarm has a team, its admin is whoever started it signed in, or else its first backer.",
          operationId: 'getTeam',
          parameters: [swarm],
          responses: { ...ok(ref('Roster'), "The swarm's steering policy and team."), ...failures(404, 502) },
          summary: 'Who steers',
        },
        post: {
          description: "As a signed-in admin, sets steering to open or team and the team's default member budget. The first change creates the swarm's gateway team with the caller as its admin.",
          operationId: 'setSteering',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.steering.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Roster'), 'The roster after the change.'), ...failures(400, 401, 403, 404, 409, 502) },
          summary: 'Choose who steers',
        },
      },
      '/v1/swarms/{id}/team/members': {
        post: {
          description: "As a signed-in admin, adds a wallet to the swarm's team, as a member who steers or an admin who also manages, with an optional budget of the swarm's money per 30 days; adding it again changes its role and budget.",
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
            "Sign-in with Tempo Wallet (accounts' Handler.auth): a single-use SIWE message to sign. Tempo Wallet's wallet_connect does the whole exchange with capabilities.auth = { url: '/v1/auth', returnToken: true }.",
          operationId: 'authChallenge',
          requestBody: { content: { 'application/json': { schema: object({ chainId: integer }) } } },
          responses: ok(object({ message: string }), 'The message to sign.'),
          summary: 'Sign-in challenge',
        },
      },
      '/v1/auth': {
        post: {
          description: `Verifies the signed challenge and answers a session token for Authorization: Bearer, valid for ${Sessions.days} days.`,
          operationId: 'authVerify',
          requestBody: {
            content: { 'application/json': { schema: object({ address, message: string, signature: string }) } },
            required: true,
          },
          responses: ok(object({ token: string }), 'The session token.'),
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
