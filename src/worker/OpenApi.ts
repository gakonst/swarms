import { z } from 'zod'
import * as Memo from '../shared/Memo.ts'
import * as Operations from './Operations.ts'
import * as Problem from './Problem.ts'
import * as Sessions from './Sessions.ts'
import * as Store from './Store.ts'

type Json = Record<string, unknown>

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })

const string = { type: 'string' }

const integer = { type: 'integer' }

const time = { description: 'Unix time in ms.', type: 'integer' }

const mach = { description: 'An amount with 6 decimals, such as "0.250000", in MACH or the pledge\'s token.', type: 'string' }

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

const pledge = parameter('pledge', 'path', string, 'The pledge id from the pledge request.')

const budget = parameter('budget', 'path', string, 'The budget id from the budget request.')

const usd = { description: 'A USD stablecoin amount with 6 decimals, such as "0.250000".', type: 'string' }

const token = { enum: ['ousd', 'pathusd', 'usdce'], type: 'string' }

const currency = { enum: ['mach', 'ousd', 'pathusd', 'usdce'], type: 'string' }

const address = { pattern: '^0x[0-9a-fA-F]{40}$', type: 'string' }

const authorizeAccessKey = { description: "Pass to Tempo Wallet's wallet_connect as capabilities.authorizeAccessKey." }

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
  Budget: object(
    {
      amount: usd,
      at: time,
      contributor: nullable(address),
      detail: nullable(string),
      expiresAt: time,
      id: string,
      left: nullable({ ...usd, description: 'What the budget can still give this period.' }),
      nextAt: nullable({ ...time, description: 'When the swarm may pull next.' }),
      note: nullable(string),
      period: { description: 'Seconds per period; 2592000 is 30 days.', type: 'integer' },
      pulled: usd,
      status: { enum: ['active', 'waiting', 'revoked', 'expired', 'ended'], type: 'string' },
      token,
    },
    "A monthly budget: the swarm pulls up to amount each period from the contributor's wallet into its own.",
  ),
  Budgeted: object({ budget: ref('Budget'), swarm: ref('Summary') }),
  BudgetRequested: object({ authorizeAccessKey, budget: string }),
  Code: object(
    { app: string, clone: { description: 'A read-only git remote: git clone <clone> fetches the whole history without a key; pushes are refused.', type: 'string' }, name: string, owner: address },
    'The public repository that keeps the swarm\'s code, cloned read-only from clone, or read without a key from the gateway at /p/<owner>/<app>/git/<name>/files, read, log and diff.',
  ),
  Config: object({
    auth: { description: "Where to sign in with Tempo Wallet: wallet_connect's capabilities.auth url.", type: 'string' },
    budget: object({ days: integer, max: usd, min: usd, period: integer }),
    chainId: integer,
    explorer: string,
    gateway: string,
    mach: string,
    minPledge: mach,
    reserve: mach,
    rpc: string,
    tokens: { items: object({ address, id: currency, pool: { description: 'Whether the swarm can pool it: transfers and budgets take pool tokens, pledges take all.', type: 'boolean' }, symbol: string }), type: 'array' },
  }),
  Contributed: object({ contribution: ref('Contribution'), swarm: ref('Summary') }),
  Contribution: object(
    {
      amount: usd,
      at: time,
      budget: nullable({ description: 'The budget a pull came from.', type: 'string' }),
      contributor: address,
      hash: { description: 'The transaction.', type: 'string' },
      kind: { description: 'transfer, a pull from a monthly budget, or a pull from a stablecoin pledge.', enum: ['transfer', 'pull', 'pledge'], type: 'string' },
      note: nullable(string),
      token,
    },
    "Money in the swarm's wallet: a one-off transfer, or a pull from a monthly budget.",
  ),
  Device: object(
    {
      expiresAt: time,
      interval: { description: 'Seconds between polls.', type: 'integer' },
      userCode: { description: 'The code Tempo Wallet shows; the user checks it matches.', type: 'string' },
      verificationUri: string,
      verificationUriFull: { description: 'The link to open, with the code in it.', type: 'string' },
    },
    'A Tempo Wallet approval on any device.',
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
    share: { description: 'Share of everything pledged, 0 to 1.', type: 'number' },
    steered: { description: 'The note reached the swarm.', type: 'boolean' },
    weight: mach,
  }),
  Overview: {
    allOf: [
      ref('Summary'),
      object({
        budgets: { items: ref('Budget'), type: 'array' },
        code: nullable(ref('Code')),
        contributions: { items: ref('Contribution'), type: 'array' },
        hands: { items: ref('Hand'), type: 'array' },
        notes: { items: ref('Note'), type: 'array' },
        pledges: { items: ref('Pledge'), type: 'array' },
        reason: nullable({ description: 'Why the swarm is waiting, when it is.', type: 'string' }),
        why: nullable({ description: 'The reason as a code: unfunded (no money yet), money (too little payable), costly (the next call holds more than any one source can pay), rest (stopped after repeated errors) or idle (swarms that rested before 2026-11-04, when a swarm stopped resting on its own; the next look at it starts it again if it has money).', enum: ['unfunded', 'money', 'costly', 'rest', 'idle'], type: 'string' }),
        updates: { items: ref('Brief'), type: 'array' },
        working: nullable(ref('Working')),
      }),
    ],
  },
  Page: object({
    entries: { items: ref('Entry'), type: 'array' },
    next: { description: 'Pass as after for the next page.', type: 'integer' },
  }),
  Pending: object({
    amount: mach,
    device: nullable(ref('Device')),
    note: nullable(string),
    pledge: string,
    status: { const: 'pending', type: 'string' },
  }),
  Pledge: object({
    amount: mach,
    at: time,
    contributor: string,
    id: string,
    note: nullable(string),
    spent: mach,
    status: { enum: ['active', 'spent', 'ended'], type: 'string' },
    token: currency,
  }),
  Pledged: object({
    pledge: ref('Pledge'),
    status: { enum: ['active', 'spent', 'ended'], type: 'string' },
    swarm: ref('Summary'),
  }),
  Problem: object({
    code: { enum: Object.keys(Problem.codes), type: 'string' },
    detail: string,
    status: integer,
  }),
  Requested: {
    properties: {
      authorizeAccessKey,
      device: ref('Device'),
      pledge: string,
    },
    required: ['authorizeAccessKey', 'pledge'],
    type: 'object',
  },
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
    contributors: integer,
    createdAt: time,
    daily: { ...usd, description: 'What active monthly budgets give a day.' },
    goal: string,
    id: string,
    machines: integer,
    pool: { ...usd, description: "What the swarm's wallet holds to spend." },
    raised: { ...mach, description: 'Everything pledged, sent and pulled, stablecoins at par.' },
    remaining: mach,
    spent: mach,
    status: ref('Status'),
    title: string,
    updatedAt: time,
    wallet: nullable({ ...address, description: "The swarm's own wallet, which takes transfers and budget pulls." }),
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
      backed: { ...usd, description: 'Everything the backer pledged, sent or had pulled, stablecoins at par.' },
      handle: { description: 'The name the room shows, derived from the address.', type: 'string' },
      since: time,
      steered: { ...usd, description: 'What the backer put behind notes, with money or with @swarm.' },
      ways: { items: { enum: ['pledge', 'budget', 'transfer', 'machine'], type: 'string' }, type: 'array' },
    },
    "A backer of the swarm, who may post in its room. A lent machine counts when its hand was issued to a signed-in caller.",
  ),
  Posted: object({ me: ref('Me'), message: ref('Said') }),
  Exchange: object({ answer: string, question: string }),
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
      share: { description: 'The note\'s weight as a share of everything raised.', type: 'number' },
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
      description: `Swarms are crowdfunded, long-running AI agents on the Tempo gateway, funded by pledges in MACH or a stablecoin, one-off stablecoin transfers to the swarm's wallet and monthly budgets, and steered by notes weighted by the money behind them. Each swarm's backers talk in its room, where an @swarm message puts part of its author's backing behind an idea. Reading needs no account; posting needs a Tempo Wallet session from /v1/auth. A pledge is a spending key the contributor approves in Tempo Wallet, at least ${Memo.decimal(Store.minPledge)} MACH; a monthly budget is a key the swarm pulls with, approved the same way. Errors are problem JSON with a stable code. The same operations are MCP tools at ${origin}/mcp.`,
      title: 'Swarms',
      version: '1',
    },
    openapi: '3.1.0',
    paths: {
      '/v1/config': { get: { operationId: 'config', responses: ok(ref('Config'), 'Chain, token and pledge sizes.'), summary: 'Configuration' } },
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
          description: 'A new swarm waits in funding until its first pledge.',
          operationId: 'createSwarm',
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.create) } }, required: true },
          responses: { ...ok(ref('Summary'), 'The swarm.', '201'), ...failures(400, 502) },
          summary: 'Create a swarm',
        },
      },
      '/v1/swarms/{id}': {
        get: {
          operationId: 'getSwarm',
          parameters: [swarm],
          responses: { ...ok(ref('Overview'), 'The swarm with its notes, pledges, machines and updates.'), ...failures(404) },
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
      '/v1/swarms/{id}/budgets': {
        post: {
          description:
            "Starts a monthly budget: pass authorizeAccessKey to Tempo Wallet's wallet_connect and post its keyAuthorization to the budget. The key may only send the token to the swarm's wallet, up to amount a day, for 30 days.",
          operationId: 'requestBudget',
          parameters: [swarm],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.budget.omit({ swarm: true })) } },
            required: true,
          },
          responses: { ...ok(ref('BudgetRequested'), 'The budget to approve.', '201'), ...failures(400, 404, 409) },
          summary: 'Request a monthly budget',
        },
      },
      '/v1/swarms/{id}/budgets/{budget}': {
        post: {
          description: 'Approves the budget with the keyAuthorization Tempo Wallet returned, or a signed transaction carrying it.',
          operationId: 'approveBudget',
          parameters: [swarm, budget],
          requestBody: {
            content: {
              'application/json': { schema: input(Operations.schema.allowance.omit({ budget: true, swarm: true })) },
            },
            required: true,
          },
          responses: { ...ok(ref('Budgeted'), 'The active budget and its swarm.', '201'), ...failures(400, 404, 409) },
          summary: 'Approve a monthly budget',
        },
      },
      '/v1/swarms/{id}/contributions': {
        post: {
          description:
            'Counts a transferWithMemo of USDC.e, pathUSD or OUSD from its sender to the swarm\'s wallet. A note counts only when the memo is keccak256("note:<swarm>:<note>"); a counted hash without a note can get one later. 201 when counted, 200 when a note was added.',
          operationId: 'contribute',
          parameters: [swarm],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.contribution.omit({ swarm: true })) } },
            required: true,
          },
          responses: {
            ...ok(ref('Contributed'), 'The note was added to a counted transfer.'),
            ...ok(ref('Contributed'), 'The transfer was counted.', '201'),
            ...failures(400, 404, 409, 502),
          },
          summary: 'Count a transfer',
        },
      },
      '/v1/problems': {
        get: { description: 'The curated idea bank: every problem with its brief, whether it is open, and the swarm working on it if any.', operationId: 'listProblems', responses: { ...ok({ type: 'object' }, 'The problems.') }, summary: 'Idea bank' },
      },
      '/v1/swarms/{id}/machines': {
        get: { description: "Every machine the swarm used: sandboxes with their settings, browsers and lent hands with price and payout, each with its state and the commands that ran on it with their output.", operationId: 'listMachines', parameters: [swarm], responses: { ...ok({ type: 'object' }, 'The machines.'), ...failures(404) }, summary: 'Machines' },
      },
      '/v1/swarms/{id}/backers': {
        get: { description: 'The ideas ranked by the money behind them, and every backer with what they put in and how.', operationId: 'listBackers', parameters: [swarm], responses: { ...ok({ type: 'object' }, 'Ideas and backers.'), ...failures(404) }, summary: 'Ideas and backers' },
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
      '/v1/swarms/{id}/btw': {
        post: {
          description:
            "Asks the swarm's agent a side question as the signed-in backer (Authorization: Bearer <token> from /v1/auth): the gateway answers it from the agent's own conversation, without tools and without interrupting or steering the running turn, as the nanocode CLI's /btw does. Send the thread's earlier questions and answers as thread, oldest first, to keep a side conversation. The answer is paid from the swarm's money, and a backer asks at most 20 an hour. To steer the agent with the thread, post @swarm Collapsed /btw: <the first question> to the room with btw set to the thread and steer to the money behind it.",
          operationId: 'askBtw',
          parameters: [swarm],
          requestBody: { content: { 'application/json': { schema: input(Operations.schema.btw.omit({ swarm: true })) } }, required: true },
          responses: { ...ok(ref('Exchange'), 'The question and its answer.'), ...failures(400, 401, 403, 404, 409, 429, 502) },
          summary: 'Ask a side question',
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
      '/v1/swarms/{id}/pledges': {
        get: {
          operationId: 'listPledges',
          parameters: [swarm],
          responses: { ...ok(object({ pledges: { items: ref('Pledge'), type: 'array' } }), 'Approved pledges, newest first.'), ...failures(404) },
          summary: 'List pledges',
        },
        post: {
          description:
            'Starts a pledge. In a browser, pass authorizeAccessKey to Tempo Wallet and post its keyAuthorization to the pledge. Without one, send device: true and show device.verificationUriFull and device.userCode to the user, who approves on any device, then poll the pledge.',
          operationId: 'requestPledge',
          parameters: [swarm],
          requestBody: {
            content: { 'application/json': { schema: input(Operations.schema.pledge.omit({ swarm: true })) } },
            required: true,
          },
          responses: { ...ok(ref('Requested'), 'The pledge to approve.', '201'), ...failures(400, 404, 409, 502) },
          summary: 'Request a pledge',
        },
      },
      '/v1/swarms/{id}/pledges/{pledge}': {
        get: {
          description:
            'The pledge. While a device pledge is pending this polls Tempo Wallet, for up to wait seconds; once approved it checks the wallet balance, activates the pledge and starts or steers the swarm.',
          operationId: 'getPledge',
          parameters: [
            swarm,
            pledge,
            parameter('wait', 'query', { default: 0, maximum: Operations.maxWait, minimum: 0, type: 'integer' }, 'Seconds to keep polling.'),
          ],
          responses: {
            '200': {
              content: { 'application/json': { schema: { oneOf: [ref('Pending'), ref('Pledged')] } } },
              description: 'Pending, or the approved pledge and its swarm.',
            },
            ...failures(400, 403, 404, 409, 410, 502),
          },
          summary: 'Pledge status',
        },
        post: {
          description:
            'Approves the pledge with the keyAuthorization Tempo Wallet returned, or a signed transaction carrying it. An empty body polls a device pledge (202 while pending).',
          operationId: 'approvePledge',
          parameters: [swarm, pledge],
          requestBody: {
            content: {
              'application/json': { schema: input(Operations.schema.approval.omit({ pledge: true, swarm: true })) },
            },
          },
          responses: {
            ...ok(ref('Pledged'), 'The active pledge and its swarm.', '201'),
            ...ok(ref('Pending'), 'Still pending in Tempo Wallet.', '202'),
            ...failures(400, 403, 404, 409, 410, 502),
          },
          summary: 'Approve a pledge',
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
